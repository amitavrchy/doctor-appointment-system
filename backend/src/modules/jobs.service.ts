import { Injectable, OnModuleInit, OnModuleDestroy, ConflictException } from '@nestjs/common';
import { Queue, Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import { createTransport } from 'nodemailer';
import { DateTime } from 'luxon';
import { RoomServiceClient } from 'livekit-server-sdk';
import { PrismaService } from '../common/prisma.service';
import { lockDoctors } from '../common/locks/pg-advisory.lock';
import { paymentProvider } from './payment.providers';
import { PdfService } from './pdf.service';
import { ReconciliationService } from './reconciliation.service';
import { RealtimeGateway } from './realtime.gateway';
import { postLedger } from './billing.domain';
import { notify } from './outbox';
@Injectable()
export class JobsService implements OnModuleInit, OnModuleDestroy {
  readonly redis = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });
  private queue!: Queue;
  private worker!: Worker;
  private timer?: NodeJS.Timeout;
  private scanning = false;
  constructor(
    private db: PrismaService,
    private pdf: PdfService,
    private reconciler: ReconciliationService,
    private realtime: RealtimeGateway,
  ) {}
  async onModuleInit() {
    const url = new URL(process.env.REDIS_URL!),
      connection = {
        host: url.hostname,
        port: Number(url.port || 6379),
        username: url.username || undefined,
        password: url.password || undefined,
        db: Number(url.pathname.slice(1) || 0),
        ...(url.protocol === 'rediss:' ? { tls: {} } : {}),
      };
    this.queue = new Queue('careflow', {
      connection,
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: { age: 7 * 86400 },
        removeOnFail: { age: 30 * 86400 },
      },
    });
    this.worker = new Worker('careflow', (job) => this.process(job), {
      connection,
      concurrency: 5,
    });
    this.worker.on('failed', (job) =>
      console.error(`Background job ${job?.name} failed. Clinical payloads are omitted.`),
    );
    await this.scan();
    this.timer = setInterval(() => {
      void this.scan().catch(() => console.error('Background scan failed'));
    }, 30000);
  }
  async scan() {
    if (this.scanning) return;
    this.scanning = true;
    try {
      const expiring = await this.db.slotHold.findMany({
        where: { expiresAt: { gt: new Date(), lt: new Date(Date.now() + 40000) } },
      });
      for (const h of expiring) this.realtime.holdExpiring(h.patientId, h.id, h.expiresAt);
      await this.db.slotHold.deleteMany({ where: { expiresAt: { lte: new Date() } } });
      const due = await this.db.appointment.findMany({
        where: {
          OR: [
            { status: 'CONFIRMED', startAt: { lt: new Date() } },
            { status: 'PENDING_PAYMENT', createdAt: { lt: new Date(Date.now() - 15 * 60000) } },
          ],
        },
        include: { clinic: true },
        take: 200,
      });
      for (const a of due) {
        const updated = await this.db.$transaction(async (tx) => {
          await lockDoctors(tx, a.doctorId);
          const current = await tx.appointment.findUnique({ where: { id: a.id } });
          if (!current) return;
          const noShow =
              current.status === 'CONFIRMED' &&
              current.startAt.getTime() + a.clinic.noShowGraceMinutes * 60000 < Date.now(),
            unpaid =
              current.status === 'PENDING_PAYMENT' &&
              current.createdAt.getTime() + 15 * 60000 < Date.now();
          if (!noShow && !unpaid) return;
          const result = await tx.appointment.update({
            where: { id: a.id },
            data: {
              status: noShow ? 'NO_SHOW' : 'CANCELLED',
              ...(unpaid ? { cancelReason: 'Payment window expired' } : {}),
            },
          });
          await tx.telemedicineSession.updateMany({
            where: { appointmentId: a.id },
            data: { status: 'CANCELLED' },
          });
          await tx.auditLog.create({
            data: {
              clinicId: a.clinicId,
              action: noShow ? 'APPOINTMENT_NO_SHOW' : 'PAYMENT_WINDOW_EXPIRED',
              entity: 'Appointment',
              entityId: a.id,
            },
          });
          return result;
        });
        if (updated) this.realtime.appointmentUpdated(updated);
      }
      await this.db.prescription.updateMany({
        where: { status: 'SIGNED', expiresAt: { lt: new Date() } },
        data: { status: 'EXPIRED' },
      });
      await this.db.otpChallenge.deleteMany({ where: { expiresAt: { lt: new Date() } } });
      await this.db.refreshSession.deleteMany({ where: { expiresAt: { lt: new Date() } } });
      const signed = await this.db.prescription.findMany({
        where: { status: 'SIGNED' },
        select: { id: true },
        take: 1000,
      });
      const artifacts = await this.db.pdfArtifact.findMany({
          where: { id: { in: signed.map((p) => `${p.id}-SIGNED`) } },
          select: { id: true },
        }),
        available = new Set(artifacts.map((a) => a.id));
      for (const p of signed)
        if (!available.has(`${p.id}-SIGNED`))
          await this.queue.add('pdf', { prescriptionId: p.id }, { jobId: `pdf-${p.id}` });
      for (const p of await this.db.payment.findMany({
        where: { status: 'REFUND_PENDING' },
        take: 200,
      }))
        await this.queue.add(
          'refund',
          { paymentId: p.id },
          { jobId: `refund-${p.id}-${Math.floor(Date.now() / 300000)}` },
        );
      const upcoming = await this.db.appointment.findMany({
        where: {
          status: 'CONFIRMED',
          startAt: { gt: new Date(), lt: new Date(Date.now() + 24 * 3600000) },
        },
        take: 1000,
      });
      for (const a of upcoming)
        for (const minutes of [1440, 120, 15])
          await this.queue.add(
            'reminder',
            { appointmentId: a.id, minutes },
            {
              jobId: `reminder-${a.id}-${minutes}`,
              delay: Math.max(0, a.startAt.getTime() - Date.now() - minutes * 60000),
            },
          );
      const completed = await this.db.appointment.findMany({
        where: {
          status: 'COMPLETED',
          completedAt: {
            gte: new Date(Date.now() - 7 * 86400000),
            lt: new Date(Date.now() - 86400000),
          },
        },
        take: 1000,
      });
      for (const a of completed)
        await this.queue.add('follow-up', { appointmentId: a.id }, { jobId: `follow-up-${a.id}` });
      for (const entry of await this.db.waitlistEntry.findMany({
        where: { status: 'ACTIVE' },
        take: 500,
      })) {
        const cancelled = await this.db.appointment.findFirst({
          where: {
            doctorId: entry.doctorId,
            clinicId: entry.clinicId,
            status: { in: ['CANCELLED', 'RESCHEDULED'] },
            updatedAt: { gt: entry.createdAt },
            startAt: {
              gt:
                entry.preferredStart && entry.preferredStart > new Date()
                  ? entry.preferredStart
                  : new Date(),
              ...(entry.preferredEnd ? { lt: entry.preferredEnd } : {}),
            },
          },
        });
        if (cancelled)
          await this.queue.add(
            'waitlist',
            { entryId: entry.id },
            { jobId: `waitlist-${entry.id}` },
          );
      }
      for (const e of await this.db.outboxEvent.findMany({
        where: { processedAt: null, nextAttemptAt: { lte: new Date() } },
        take: 200,
        orderBy: { createdAt: 'asc' },
      }))
        await this.queue.add('outbox', { eventId: e.id }, { jobId: `event-${e.id}` });
      for (const run of await this.db.reconciliationRun.findMany({
        where: { status: { in: ['PENDING', 'RUNNING'] } },
        take: 20,
      }))
        await this.queue.add('reconcile', { runId: run.id }, { jobId: `reconcile-${run.id}` });
      const closed = await this.db.telemedicineSession.findMany({
        where: { provider: 'livekit', status: { in: ['ENDED', 'CANCELLED'] } },
        take: 1000,
      });
      for (const s of closed)
        await this.db.outboxEvent.upsert({
          where: { id: `tele-close-${s.id}` },
          create: {
            id: `tele-close-${s.id}`,
            type: 'TELE_CLOSE',
            aggregateId: s.id,
            payload: { roomName: s.roomName },
          },
          update: {},
        });
    } finally {
      this.scanning = false;
    }
  }
  async processRefund(paymentId: string) {
    const p = await this.db.payment.findUniqueOrThrow({
      where: { id: paymentId },
      include: { appointment: true },
    });
    if (p.status !== 'REFUND_PENDING') return;
    const result =
      p.refundMinor > 0 && p.providerRef
        ? await paymentProvider(p.provider).refund(
            p.providerRef,
            p.refundMinor,
            `refund-${p.id}`,
            p.refundReference || undefined,
          )
        : undefined;
    if (result?.pending) {
      if (result.reference)
        await this.db.payment.updateMany({
          where: { id: p.id, status: 'REFUND_PENDING' },
          data: { refundReference: result.reference },
        });
      return;
    }
    await this.db.$transaction(async (tx) => {
      await lockDoctors(tx, p.appointment.doctorId);
      const changed = await tx.payment.updateMany({
        where: { id: p.id, status: 'REFUND_PENDING' },
        data: {
          status: 'REFUNDED',
          refundedAt: new Date(),
          ...(result?.reference ? { refundReference: result.reference } : {}),
        },
      });
      if (!changed.count) return;
      await postLedger(tx, p, 'CAPTURE');
      await postLedger(tx, p, 'REFUND');
      await notify(
        tx,
        p.appointment.patientId,
        'Your refund was processed',
        'Your eligible consultation refund has been processed. View the invoice for the amount and payment status.',
        p.appointment.clinicId,
      );
      await tx.auditLog.create({
        data: {
          clinicId: p.appointment.clinicId,
          action: 'PAYMENT_REFUNDED',
          entity: 'Payment',
          entityId: p.id,
        },
      });
    });
    this.realtime.appointmentUpdated(p.appointment);
  }
  private async process(job: Job) {
    if (job.name === 'refund') return this.processRefund(job.data.paymentId);
    if (job.name === 'reconcile') return this.reconciler.run(job.data.runId);
    if (job.name === 'pdf') {
      const p = await this.db.prescription.findUnique({
        where: { id: job.data.prescriptionId },
        include: {
          appointment: {
            include: {
              patient: { select: { fullName: true } },
              doctor: { include: { user: { select: { fullName: true } } } },
              clinic: true,
            },
          },
        },
      });
      if (!p || p.status !== 'SIGNED') return;
      const bytes = await this.pdf.prescription(p);
      await this.db.pdfArtifact.upsert({
        where: { id: `${p.id}-SIGNED` },
        create: { id: `${p.id}-SIGNED`, bytes: new Uint8Array(bytes) },
        update: {},
      });
      return;
    }
    if (job.name === 'waitlist') {
      await this.db.$transaction(async (tx) => {
        const e = await tx.waitlistEntry.findUnique({ where: { id: job.data.entryId } });
        if (!e) return;
        const changed = await tx.waitlistEntry.updateMany({
          where: { id: e.id, status: 'ACTIVE' },
          data: { status: 'OFFERED' },
        });
        if (changed.count)
          await notify(
            tx,
            e.patientId,
            'An appointment slot opened',
            'A cancellation matched your waitlist. View current availability to reserve a time. This offer does not reserve the slot.',
            e.clinicId,
          );
      });
      return;
    }
    if (job.name === 'reminder' || job.name === 'follow-up') {
      const a = await this.db.appointment.findUnique({
        where: { id: job.data.appointmentId },
        include: { clinic: true },
      });
      if (!a) return;
      const pref = await this.db.notificationPreference.findUnique({
        where: { userId: a.patientId },
      });
      if (
        job.name === 'reminder' &&
        (a.status !== 'CONFIRMED' || a.startAt <= new Date() || pref?.reminders === false)
      )
        return;
      if (job.name === 'follow-up' && (a.status !== 'COMPLETED' || pref?.followUps === false))
        return;
      const title =
        job.name === 'reminder'
          ? 'A reminder for your upcoming visit'
          : 'A little check-in after your visit';
      const body =
        job.name === 'reminder'
          ? `Your appointment at ${a.clinic.name} is scheduled for ${DateTime.fromJSDate(a.startAt).setZone(a.clinic.timezone).toFormat('dd LLL yyyy, h:mm a')} (${a.clinic.timezone}). ${a.type === 'TELEMEDICINE' ? `Waiting room: ${process.env.APP_URL}/telemedicine` : ''}`
          : `Your recent consultation is complete. Review your care plan and prescriptions, or book a follow-up when advised. ${process.env.APP_URL}/care-plans`;
      const eventId = `notification-${job.id}`;
      await this.db.$transaction(async (tx) => {
        if (await tx.outboxEvent.findUnique({ where: { id: eventId } })) return;
        const p = await tx.notificationPreference.findUnique({ where: { userId: a.patientId } });
        if (p?.inApp !== false)
          await tx.notification.upsert({
            where: { id: eventId },
            create: { id: eventId, userId: a.patientId, title, body },
            update: {},
          });
        await tx.outboxEvent.create({
          data: {
            id: eventId,
            type: 'NOTIFICATION',
            aggregateId: eventId,
            userId: a.patientId,
            clinicId: a.clinicId,
            payload: { title, body },
          },
        });
      });
      return;
    }
    if (job.name === 'outbox') {
      const event = await this.db.outboxEvent.findUnique({ where: { id: job.data.eventId } });
      if (!event || event.processedAt) return;
      try {
        if (
          event.type === 'TELE_CLOSE' &&
          process.env.LIVEKIT_URL &&
          process.env.LIVEKIT_API_KEY &&
          process.env.LIVEKIT_API_SECRET
        ) {
          const service = new RoomServiceClient(
            process.env.LIVEKIT_URL.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:'),
            process.env.LIVEKIT_API_KEY,
            process.env.LIVEKIT_API_SECRET,
          );
          try {
            await service.deleteRoom((event.payload as { roomName: string }).roomName);
          } catch (error) {
            if (!(error instanceof Error && /not found|does not exist/i.test(error.message)))
              throw error;
          }
        }
        if (event.type === 'NOTIFICATION' && event.userId) {
          const user = await this.db.user.findFirst({
            where: { id: event.userId, deletedAt: null },
            include: { notificationPreference: true },
          });
          if (user) {
            const payload = event.payload as { title: string; body: string },
              pref = user.notificationPreference;
            if (pref?.email !== false && process.env.SMTP_URL)
              await createTransport(process.env.SMTP_URL).sendMail({
                from: process.env.SMTP_FROM || 'Careflow <no-reply@careflow.local>',
                to: user.email,
                subject: payload.title,
                text: payload.body,
                headers: { 'X-Careflow-Event': event.id },
              });
            if (
              pref?.sms === true &&
              user.phoneVerifiedAt &&
              user.phone &&
              process.env.SMS_API_URL &&
              process.env.SMS_API_KEY
            ) {
              const response = await fetch(process.env.SMS_API_URL, {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${process.env.SMS_API_KEY}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  to: user.phone,
                  text: payload.body,
                  idempotencyKey: event.id,
                }),
                signal: AbortSignal.timeout(15000),
              });
              if (!response.ok) throw new Error('SMS delivery failed');
            }
          }
        }
        await this.db.outboxEvent.update({
          where: { id: event.id },
          data: { processedAt: new Date(), attempts: { increment: 1 } },
        });
      } catch {
        await this.db.outboxEvent.update({
          where: { id: event.id },
          data: { attempts: { increment: 1 }, nextAttemptAt: new Date(Date.now() + 60000) },
        });
        throw new Error('Notification or provider operation failed; sensitive content omitted');
      }
      return;
    }
  }
  async monitor() {
    const counts = await this.queue.getJobCounts(
      'waiting',
      'active',
      'delayed',
      'completed',
      'failed',
    );
    const jobs = await this.queue.getJobs(
      ['failed', 'active', 'waiting', 'delayed', 'completed'],
      0,
      49,
      true,
    );
    return {
      counts,
      workerRunning: this.worker.isRunning(),
      jobs: await Promise.all(
        jobs.map(async (j) => ({
          id: j.id,
          name: j.name,
          state: await j.getState(),
          attempts: j.attemptsMade,
          createdAt: new Date(j.timestamp),
          processedAt: j.processedOn ? new Date(j.processedOn) : null,
          finishedAt: j.finishedOn ? new Date(j.finishedOn) : null,
          failed: !!j.failedReason,
        })),
      ),
      pendingOutbox: await this.db.outboxEvent.count({ where: { processedAt: null } }),
    };
  }
  async retry(id: string) {
    const job = await this.queue.getJob(id);
    if (!job || (await job.getState()) !== 'failed')
      throw new ConflictException('Only failed jobs can be retried');
    await job.retry('failed');
    return { ok: true };
  }
  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    await this.worker?.close();
    await this.queue?.close();
    await this.redis.quit();
  }
}
