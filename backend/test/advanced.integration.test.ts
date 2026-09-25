import { TelemedicineController } from '../src/modules/telemedicine.controller';
import 'dotenv/config';
import { beforeAll, beforeEach, afterAll, afterEach, describe, it, expect, vi } from 'vitest';
import { hash, argon2id } from 'argon2';
import { JwtService } from '@nestjs/jwt';
import { DateTime } from 'luxon';
import type { ExecutionContext } from '@nestjs/common';
import { PrismaService } from '../src/common/prisma.service';
import { Actor, AuthGuard } from '../src/common/access';
import { AuditService } from '../src/common/audit.service';
import { AppointmentsService } from '../src/modules/appointments.service';
import { SchedulesService } from '../src/modules/schedules.service';
import { ScheduleManagementController } from '../src/modules/schedule-management.controller';
import { QueueController } from '../src/modules/queue.controller';
import { ClinicalService } from '../src/modules/clinical.service';
import { ClinicalWorkflowsController } from '../src/modules/clinical-workflows.controller';
import { SecurityController } from '../src/modules/security.controller';
import { AuthService } from '../src/modules/auth.service';
import { AuthController } from '../src/modules/auth.controller';
import { ReconciliationService } from '../src/modules/reconciliation.service';
import { RealtimeGateway } from '../src/modules/realtime.gateway';
import { PaymentsController } from '../src/modules/payments.controller';
import { JobsService } from '../src/modules/jobs.service';
import { PdfService } from '../src/modules/pdf.service';
import { BkashPaymentProvider } from '../src/modules/bangladesh-payment.providers';
import { postLedger } from '../src/modules/billing.domain';
import { notify } from '../src/modules/outbox';
const suite = process.env.DATABASE_URL ? describe : describe.skip;
suite('advanced clinical, scheduling, finance and security boundaries', () => {
  const db = new PrismaService(),
    gateway = {
      appointmentUpdated: () => {},
      refreshQueue: async () => {},
      disconnectUser: () => {},
      holdExpiring: () => {},
      message: () => {},
    } as unknown as RealtimeGateway;
  const schedules = new SchedulesService(db),
    appointments = new AppointmentsService(db, schedules, gateway),
    clinical = new ClinicalService(db, appointments),
    workflows = new ClinicalWorkflowsController(db, clinical),
    queue = new QueueController(db, gateway),
    management = new ScheduleManagementController(db),
    auth = new AuthService(db, new JwtService()),
    security = new SecurityController(db, auth, gateway),
    reconcile = new ReconciliationService(db, gateway),
    payments = new PaymentsController(db, appointments, new PdfService(), new AuditService(db));
  const prefix = `advanced-${Date.now()}`,
    clinicId = `${prefix}-clinic`,
    secondClinic = `${prefix}-other`,
    roomId = `${prefix}-room`,
    doctorIds = [`${prefix}-d1`, `${prefix}-d2`],
    patientIds = Array.from({ length: 5 }, (_, i) => `${prefix}-p${i}`),
    receptionId = `${prefix}-reception`,
    allUsers = [...doctorIds, ...patientIds, receptionId];
  const actor = (id: string, roles: { clinicId: string; role: string }[] = []): Actor => ({
    id,
    email: `${id}@test.local`,
    fullName: 'Synthetic test user',
    globalRole: 'PATIENT',
    roles,
  });
  const doctor = actor(doctorIds[0], [
      { clinicId, role: 'DOCTOR' },
      { clinicId: secondClinic, role: 'DOCTOR' },
    ]),
    otherDoctor = actor(doctorIds[1], [{ clinicId, role: 'DOCTOR' }]),
    patients = patientIds.map((id) => actor(id)),
    reception = actor(receptionId, [{ clinicId, role: 'RECEPTIONIST' }]);
  const day = DateTime.now().setZone('Asia/Dhaka').plus({ days: 16 }).toISODate()!,
    password = 'AdvancedFixture2026!';
  let passwordHash = '';
  beforeAll(async () => {
    await db.$connect();
    passwordHash = await hash(password, { type: argon2id });
    await db.clinic.createMany({
      data: [
        {
          id: clinicId,
          name: 'Advanced test clinic',
          slug: clinicId,
          address: 'Synthetic clinic address',
        },
        {
          id: secondClinic,
          name: 'Other test clinic',
          slug: secondClinic,
          address: 'Synthetic second address',
        },
      ],
    });
    await db.room.create({ data: { id: roomId, clinicId, name: 'Shared consultation room' } });
    await db.user.createMany({
      data: allUsers.map((id) => ({
        id,
        email: `${id}@test.local`,
        fullName: `Synthetic ${id.slice(-2)}`,
        passwordHash,
        allergies: [],
      })),
    });
    for (const [index, id] of doctorIds.entries()) {
      await db.doctorProfile.create({
        data: {
          userId: id,
          licenseNumber: `${prefix}-license-${index}`,
          specialties: ['Synthetic specialty'],
          bio: 'Synthetic fixture',
          languages: ['English'],
        },
      });
      await db.doctorClinic.create({
        data: { doctorId: id, clinicId, feeMinor: 100000, teleFeeMinor: 100000 },
      });
      await db.userClinicRole.create({ data: { userId: id, clinicId, role: 'DOCTOR' } });
      await db.doctorScheduleRule.create({
        data: {
          id: `${prefix}-rule-${index}`,
          doctorId: id,
          clinicId,
          roomId,
          rrule: 'FREQ=DAILY',
          startTimeLocal: '09:00',
          endTimeLocal: '17:00',
          effectiveFrom: new Date(),
          feeMinor: 100000,
        },
      });
    }
    await db.doctorClinic.create({
      data: {
        doctorId: doctorIds[0],
        clinicId: secondClinic,
        feeMinor: 100000,
        teleFeeMinor: 100000,
      },
    });
    await db.userClinicRole.create({
      data: { userId: doctorIds[0], clinicId: secondClinic, role: 'DOCTOR' },
    });
    await db.doctorScheduleRule.create({
      data: {
        id: `${prefix}-rule-other`,
        doctorId: doctorIds[0],
        clinicId: secondClinic,
        rrule: 'FREQ=DAILY',
        startTimeLocal: '17:00',
        endTimeLocal: '20:00',
        effectiveFrom: new Date(),
        feeMinor: 100000,
      },
    });
  });
  async function clear() {
    const clinicWhere = { clinicId: { in: [clinicId, secondClinic] } };
    await db.outboxEvent.deleteMany({ where: clinicWhere });
    await db.ledgerEntry.deleteMany({ where: clinicWhere });
    await db.carePlanTask.deleteMany({ where: { plan: { patientId: { in: patientIds } } } });
    await db.carePlan.deleteMany({ where: clinicWhere });
    await db.consentGrant.deleteMany({ where: { patientId: { in: patientIds } } });
    await db.clinicalTemplate.deleteMany({ where: clinicWhere });
    await db.labOrder.deleteMany({ where: { appointment: clinicWhere } });
    await db.referral.deleteMany({ where: { appointment: clinicWhere } });
    await db.consultationMessage.deleteMany({ where: { appointment: clinicWhere } });
    await db.appointmentConflict.deleteMany({ where: { appointment: clinicWhere } });
    await db.invoice.deleteMany({ where: { appointment: clinicWhere } });
    await db.attachment.deleteMany({ where: { appointment: clinicWhere } });
    await db.vital.deleteMany({ where: { appointment: clinicWhere } });
    await db.noteRevision.deleteMany({ where: { note: { appointment: clinicWhere } } });
    await db.clinicalNote.deleteMany({ where: { appointment: clinicWhere } });
    await db.prescription.deleteMany({ where: { appointment: clinicWhere } });
    await db.payment.deleteMany({ where: { appointment: clinicWhere } });
    await db.telemedicineSession.deleteMany({ where: { appointment: clinicWhere } });
    await db.appointment.deleteMany({ where: clinicWhere });
    await db.slotHold.deleteMany({ where: { doctorId: { in: doctorIds } } });
    await db.scheduleException.deleteMany({ where: { doctorId: { in: doctorIds } } });
    await db.doctorSigningCredential.deleteMany({ where: { doctorId: { in: doctorIds } } });
    await db.notification.deleteMany({ where: { userId: { in: allUsers } } });
    await db.notificationPreference.deleteMany({ where: { userId: { in: allUsers } } });
    await db.refreshSession.deleteMany({ where: { userId: { in: allUsers } } });
    await db.otpChallenge.deleteMany({
      where: {
        OR: [{ userId: { in: allUsers } }, { email: { endsWith: `${prefix}@test.local` } }],
      },
    });
    await db.clinicService.deleteMany({ where: clinicWhere });
    await db.clinic.updateMany({
      where: { id: { in: [clinicId, secondClinic] } },
      data: {
        fullRefundHours: 24,
        partialRefundHours: 2,
        partialRefundPercent: 50,
        allowPayLater: true,
        taxBasisPoints: 0,
      },
    });
    await db.doctorScheduleRule.updateMany({
      where: { doctorId: { in: doctorIds } },
      data: { active: true },
    });
    await db.user.updateMany({
      where: { id: { in: allUsers } },
      data: { phone: null, phoneVerifiedAt: null, consentHistory: false, passwordHash },
    });
  }
  beforeEach(clear);
  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => {
    await clear();
    await db.auditLog.deleteMany({
      where: {
        OR: [{ clinicId: { in: [clinicId, secondClinic] } }, { actorId: { in: allUsers } }],
      },
    });
    await db.doctorScheduleRule.deleteMany({ where: { doctorId: { in: doctorIds } } });
    await db.doctorClinic.deleteMany({ where: { doctorId: { in: doctorIds } } });
    await db.userClinicRole.deleteMany({ where: { userId: { in: allUsers } } });
    await db.doctorProfile.deleteMany({ where: { userId: { in: doctorIds } } });
    await db.room.delete({ where: { id: roomId } });
    await db.user.deleteMany({ where: { id: { in: allUsers } } });
    await db.clinic.deleteMany({ where: { id: { in: [clinicId, secondClinic] } } });
    await db.clinicQueueCounter.deleteMany({ where: { id: { contains: prefix } } });
    await db.$disconnect();
  });
  async function book(
    patient = patients[0],
    hour = 9,
    selectedDoctor = doctorIds[0],
    selectedClinic = clinicId,
    addons?: string[],
  ) {
    const hold = await appointments.hold(patient, {
      doctorId: selectedDoctor,
      clinicId: selectedClinic,
      startAt: `${day}T${String(hour).padStart(2, '0')}:00:00+06:00`,
      type: 'IN_PERSON',
      addonIds: addons,
    });
    return appointments.confirm(patient, hold.id, `${prefix}-${crypto.randomUUID()}`);
  }
  async function encounter() {
    const a = await book();
    await db.appointment.update({
      where: { id: a.id },
      data: { status: 'IN_PROGRESS', startedAt: new Date() },
    });
    return a;
  }
  it('serializes two doctors competing for one room', async () => {
    const outcomes = await Promise.allSettled(
      doctorIds.map((doctorId, index) =>
        appointments.hold(patients[index], {
          doctorId,
          clinicId,
          startAt: `${day}T09:00:00+06:00`,
          type: 'IN_PERSON',
        }),
      ),
    );
    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    expect(await db.slotHold.count({ where: { roomId } })).toBe(1);
  });
  it('the database itself rejects overlapping room windows with different starts', async () => {
    await book();
    await expect(
      db.appointment.create({
        data: {
          doctorId: doctorIds[1],
          clinicId,
          patientId: patientIds[1],
          roomId,
          type: 'IN_PERSON',
          status: 'CONFIRMED',
          startAt: new Date(`${day}T09:15:00+06:00`),
          endAt: new Date(`${day}T09:45:00+06:00`),
          feeMinor: 100000,
          idempotencyKey: `${prefix}-raw-overlap`,
        },
      }),
    ).rejects.toThrow();
  });
  it('flags recurring schedule blocks without cancelling bookings and supports series scopes', async () => {
    const a = await book();
    const until = DateTime.fromISO(day).plus({ days: 2 }).toISODate()!;
    const result = await management.block(doctor, {
      doctorId: doctor.id,
      clinicId,
      dateLocal: day,
      type: 'DAY_OFF',
      rrule: 'FREQ=DAILY',
      until,
    });
    expect(result.records).toHaveLength(3);
    expect(result.conflicts.map((c) => c.id)).toContain(a.id);
    expect((await db.appointment.findUniqueOrThrow({ where: { id: a.id } })).status).toBe(
      'CONFIRMED',
    );
    await management.removeBlock(doctor, result.records[0].id, 'this_only');
    expect(
      await db.scheduleException.count({ where: { seriesId: result.records[0].seriesId } }),
    ).toBe(2);
    await management.removeBlock(doctor, result.records[1].id, 'this_and_future');
    expect(
      await db.scheduleException.count({ where: { seriesId: result.records[0].seriesId } }),
    ).toBe(0);
  });
  it('queue numbers are unique and call-next respects priority and doctor ownership', async () => {
    const a = await book(patients[0], 9),
      b = await book(patients[1], 10);
    const checked = await Promise.all([
      appointments.transition(doctor, a.id, 'CHECKED_IN'),
      appointments.transition(doctor, b.id, 'CHECKED_IN'),
    ]);
    expect(new Set(checked.map((a) => a.queueNumber)).size).toBe(2);
    await queue.priority(doctor, b.id, { priority: 2 });
    const called = await queue.next(doctor, { clinicId, doctorId: doctor.id });
    expect(called.id).toBe(b.id);
    await expect(queue.next(doctor, { clinicId, doctorId: doctor.id })).rejects.toThrow('Complete');
    await expect(queue.next(otherDoctor, { clinicId, doctorId: doctor.id })).rejects.toThrow();
    const mine = await queue.mine(patients[1]);
    expect(mine).toHaveLength(1);
    expect(mine[0].position).toBe(0);
    expect(mine[0]).not.toHaveProperty('patient');
  });
  it('care-plan tasks are writable by the patient and treating doctor only', async () => {
    await book();
    const plan = await workflows.plan(doctor, {
      patientId: patients[0].id,
      clinicId,
      title: 'Synthetic follow-up plan',
      description: 'Synthetic instructions',
      tasks: [{ title: 'Review care instructions' }],
    });
    await workflows.task(patients[0], plan.id, plan.tasks[0].id, { completed: true });
    expect(
      (await db.carePlanTask.findUniqueOrThrow({ where: { id: plan.tasks[0].id } })).completedBy,
    ).toBe(patients[0].id);
    await expect(
      workflows.task(patients[1], plan.id, plan.tasks[0].id, { completed: false }),
    ).rejects.toThrow();
    expect(await workflows.plans(reception)).toEqual([]);
  });
  it('lab orders enforce result and review transitions and clinical role boundaries', async () => {
    const a = await encounter(),
      order = await workflows.order(doctor, {
        appointmentId: a.id,
        title: 'Synthetic test order',
        tests: [{ name: 'Synthetic lab', instructions: '' }],
      });
    await expect(workflows.result(doctor, order.id, { status: 'REVIEWED' })).rejects.toThrow();
    await expect(
      workflows.result(reception, order.id, { status: 'RESULT_UPLOADED', results: [] }),
    ).rejects.toThrow();
    await workflows.result(doctor, order.id, { status: 'SAMPLE_COLLECTED' });
    await workflows.result(doctor, order.id, {
      status: 'RESULT_UPLOADED',
      results: [
        {
          name: 'Synthetic lab',
          value: 'Example',
          unit: 'demo',
          reference: 'synthetic',
          flag: 'UNKNOWN',
        },
      ],
    });
    const reviewed = await workflows.result(doctor, order.id, { status: 'REVIEWED' });
    expect(reviewed.reviewedAt).toBeTruthy();
    expect((await workflows.labs(patients[0]))[0].id).toBe(order.id);
    expect(await workflows.labs(reception)).toEqual([]);
  });
  it('private SOAP templates are not exposed to another doctor in the same clinic', async () => {
    const soap = { subjective: '', objective: '', assessment: '', plan: '' };
    const t = await workflows.template(doctor, {
      clinicId,
      title: 'Private fixture',
      soap,
      shared: false,
    });
    expect(await workflows.templates(otherDoctor, clinicId)).toEqual([]);
    await workflows.updateTemplate(doctor, t.id, { title: t.title, soap, shared: true });
    expect((await workflows.templates(otherDoctor, clinicId))[0].id).toBe(t.id);
    await expect(workflows.deleteTemplate(otherDoctor, t.id)).rejects.toThrow();
  });
  it('referrals can be accepted only by their receiving doctor', async () => {
    const a = await encounter();
    const r = await workflows.refer(doctor, {
      appointmentId: a.id,
      targetDoctorId: otherDoctor.id,
      specialty: 'Synthetic specialty',
      reason: 'Synthetic referral handover',
    });
    await expect(workflows.referralStatus(doctor, r.id, { status: 'ACCEPTED' })).rejects.toThrow();
    await workflows.referralStatus(otherDoctor, r.id, { status: 'ACCEPTED' });
    expect((await workflows.referrals(patients[0]))[0].status).toBe('ACCEPTED');
    await expect(
      workflows.referralStatus(patients[0], r.id, { status: 'CLOSED' }),
    ).rejects.toThrow();
  });
  it('time-limited consent permits cross-clinic history until revoked', async () => {
    await book();
    await book(patients[0], 18, doctor.id, secondClinic);
    await expect(clinical.history(doctor, patients[0].id)).rejects.toThrow('consent');
    const grant = await security.grant(patients[0], {
      doctorId: doctor.id,
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    });
    expect(await clinical.history(doctor, patients[0].id)).toHaveLength(2);
    await security.revoke(patients[0], grant.id);
    await expect(clinical.history(doctor, patients[0].id)).rejects.toThrow('consent');
  });
  it('signing PINs are private and required once configured', async () => {
    const a = await encounter();
    await workflows.signingPin(doctor, { password, pin: '193827' });
    const draft = await clinical.draft(doctor, a.id, [
      {
        name: 'Synthetic medication',
        dosage: 'demo',
        frequency: 'demo',
        duration: 'demo',
        route: 'Oral',
        instructions: 'Synthetic fixture only',
      },
    ]);
    await expect(clinical.sign(doctor, draft.prescription.id)).rejects.toThrow('PIN');
    await expect(clinical.sign(doctor, draft.prescription.id, '000000')).rejects.toThrow('PIN');
    expect((await clinical.sign(doctor, draft.prescription.id, '193827')).status).toBe('SIGNED');
    expect(JSON.stringify(await auth.me(doctor))).not.toContain('pinHash');
  });
  it('SMS enrollment codes cannot be reused as login codes and only verified numbers can sign in', async () => {
    vi.stubEnv('DEMO_MODE', 'true');
    const phone = `+8801${String(Date.now()).slice(-9)}`;
    const enrollment = await auth.requestOtp('', phone, 'VERIFY_PHONE', patients[0].id);
    await expect(
      auth.verifyOtp(enrollment.challengeId, enrollment.demoCode!, 'Wrong purpose'),
    ).rejects.toThrow();
    await security.phone(patients[0], {
      challengeId: enrollment.challengeId,
      code: enrollment.demoCode,
    });
    const challenge = await auth.requestOtp('', phone);
    const token = await auth.verifyOtp(
      challenge.challengeId,
      challenge.demoCode!,
      'Synthetic phone login',
    );
    expect(
      new JwtService().verify(token.access, { secret: process.env.JWT_ACCESS_SECRET }).sub,
    ).toBe(patients[0].id);
  });
  it('session revocation invalidates an already-issued access token immediately', async () => {
    const token = await auth.issue(patients[0].id, 'Synthetic device');
    const request = { cookies: { access: token.access }, headers: {} };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    const guard = new AuthGuard(new JwtService(), db);
    expect(await guard.canActivate(context)).toBe(true);
    await auth.logout(token.refresh);
    await expect(guard.canActivate(context)).rejects.toThrow('Session expired');
  });
  it('password-reset challenges are purpose bound and revoke all sessions', async () => {
    vi.stubEnv('DEMO_MODE', 'true');
    const token = await auth.issue(patients[0].id, 'Before reset');
    const challenge = await auth.requestOtp(patients[0].email, undefined, 'RESET_PASSWORD');
    await expect(
      auth.verifyOtp(challenge.challengeId, challenge.demoCode!, 'Not a login challenge'),
    ).rejects.toThrow();
    await security.reset({
      challengeId: challenge.challengeId,
      code: challenge.demoCode,
      newPassword: 'ChangedFixture2026!',
    });
    await expect(auth.refresh(token.refresh, 'Revoked')).rejects.toThrow();
    expect(
      await auth.login(patients[0].email, 'ChangedFixture2026!', 'After reset'),
    ).toHaveProperty('access');
  });
  it('held add-on prices, taxes and refund policy remain stable after configuration changes', async () => {
    await db.clinic.update({
      where: { id: clinicId },
      data: {
        taxBasisPoints: 500,
        fullRefundHours: 48,
        partialRefundHours: 6,
        partialRefundPercent: 25,
      },
    });
    const service = await db.clinicService.create({
      data: { clinicId, name: 'Synthetic service', feeMinor: 50000 },
    });
    const hold = await appointments.hold(patients[0], {
      clinicId,
      doctorId: doctor.id,
      startAt: `${day}T09:00:00+06:00`,
      type: 'IN_PERSON',
      addonIds: [service.id],
    });
    expect(hold.feeMinor).toBe(157500);
    await db.clinicService.update({ where: { id: service.id }, data: { feeMinor: 90000 } });
    await db.clinic.update({
      where: { id: clinicId },
      data: { taxBasisPoints: 1000, partialRefundPercent: 0 },
    });
    const a = await appointments.confirm(patients[0], hold.id, `${prefix}-quoted`);
    expect(a.feeMinor).toBe(157500);
    expect((a.refundPolicy as { partialRefundPercent: number }).partialRefundPercent).toBe(25);
    const invoice = await db.invoice.findUniqueOrThrow({ where: { appointmentId: a.id } });
    expect(invoice.taxMinor).toBe(7500);
    expect(invoice.totalMinor).toBe(157500);
  });
  it('pay-first clinics confirm only after settlement and post balanced ledger entries', async () => {
    await db.clinic.update({
      where: { id: clinicId },
      data: { allowPayLater: false, taxBasisPoints: 500 },
    });
    const a = await book();
    expect(a.status).toBe('PENDING_PAYMENT');
    await payments.demo(patients[0], a.payment!.id);
    expect((await db.appointment.findUniqueOrThrow({ where: { id: a.id } })).status).toBe(
      'CONFIRMED',
    );
    const ledger = await db.ledgerEntry.findMany({ where: { paymentId: a.payment!.id } });
    expect(ledger.filter((e) => e.side === 'DEBIT').reduce((s, e) => s + e.amountMinor, 0)).toBe(
      ledger.filter((e) => e.side === 'CREDIT').reduce((s, e) => s + e.amountMinor, 0),
    );
    expect(ledger.find((e) => e.account === 'TAX_PAYABLE')?.amountMinor).toBe(5000);
  });
  it('provider capture verifies amount and currency and is idempotent', async () => {
    const a = await book(),
      reference = `remote-${a.id}`;
    await db.payment.update({
      where: { id: a.payment!.id },
      data: { providerRef: reference, status: 'REQUIRES_ACTION' },
    });
    await expect(
      reconcile.apply(a.payment!.id, {
        reference,
        amountMinor: a.feeMinor + 1,
        currency: 'BDT',
        paid: true,
      }),
    ).rejects.toThrow('amount');
    await reconcile.apply(a.payment!.id, {
      reference,
      amountMinor: a.feeMinor,
      currency: 'BDT',
      paid: true,
    });
    await reconcile.apply(a.payment!.id, {
      reference,
      amountMinor: a.feeMinor,
      currency: 'BDT',
      paid: true,
    });
    expect(
      await db.ledgerEntry.count({
        where: { paymentId: a.payment!.id, account: 'CASH', side: 'DEBIT' },
      }),
    ).toBe(1);
  });
  it('a verified late capture after cancellation is queued for a full refund', async () => {
    const a = await book(),
      reference = `late-${a.id}`;
    await db.payment.update({
      where: { id: a.payment!.id },
      data: { providerRef: reference, status: 'REQUIRES_ACTION' },
    });
    await appointments.transition(patients[0], a.id, 'CANCELLED');
    await reconcile.apply(a.payment!.id, {
      reference,
      amountMinor: a.feeMinor,
      currency: 'BDT',
      paid: true,
    });
    const p = await db.payment.findUniqueOrThrow({ where: { id: a.payment!.id } });
    expect(p.status).toBe('REFUND_PENDING');
    expect(p.refundMinor).toBe(a.feeMinor);
    expect((await db.appointment.findUniqueOrThrow({ where: { id: a.id } })).status).toBe(
      'CANCELLED',
    );
  });
  it('provider-pending refunds are not prematurely marked refunded', async () => {
    for (const key of ['BKASH_APP_KEY', 'BKASH_APP_SECRET', 'BKASH_USERNAME', 'BKASH_PASSWORD'])
      vi.stubEnv(key, 'synthetic');
    const a = await book();
    await db.payment.update({
      where: { id: a.payment!.id },
      data: {
        provider: 'bkash',
        providerRef: `bkash-${a.id}`,
        status: 'REFUND_PENDING',
        refundMinor: a.feeMinor,
      },
    });
    const mock = vi
      .spyOn(BkashPaymentProvider.prototype, 'refund')
      .mockResolvedValue({ pending: true, reference: 'refund-reference' });
    const jobs = new JobsService(db, new PdfService(), reconcile, gateway);
    try {
      await jobs.processRefund(a.payment!.id);
      expect((await db.payment.findUniqueOrThrow({ where: { id: a.payment!.id } })).status).toBe(
        'REFUND_PENDING',
      );
      mock.mockResolvedValue({ pending: false, reference: 'refund-reference' });
      await jobs.processRefund(a.payment!.id);
      await jobs.processRefund(a.payment!.id);
      expect((await db.payment.findUniqueOrThrow({ where: { id: a.payment!.id } })).status).toBe(
        'REFUNDED',
      );
      expect(mock).toHaveBeenCalledTimes(2);
    } finally {
      mock.mockRestore();
      await jobs.onModuleDestroy();
    }
  });
  it('cumulative partial refunds append only the new ledger amount', async () => {
    const a = await book();
    const p = await db.payment.findUniqueOrThrow({
      where: { id: a.payment!.id },
      include: { appointment: true },
    });
    await db.$transaction(async (tx) => {
      await postLedger(tx, p, 'CAPTURE');
      await postLedger(tx, { ...p, refundMinor: 20000 }, 'REFUND');
      await postLedger(tx, { ...p, refundMinor: 40000 }, 'REFUND');
      await postLedger(tx, { ...p, refundMinor: 40000 }, 'REFUND');
    });
    const refunded = await db.ledgerEntry.aggregate({
      where: { paymentId: p.id, account: 'CASH', side: 'CREDIT' },
      _sum: { amountMinor: true },
    });
    expect(refunded._sum.amountMinor).toBe(40000);
  });
  it('notification preferences and transactional outbox writes are enforced', async () => {
    await db.notificationPreference.create({
      data: { userId: patients[0].id, inApp: false, email: false, sms: false },
    });
    await db.$transaction((tx) =>
      notify(tx, patients[0].id, 'Synthetic notification', 'Synthetic body', clinicId),
    );
    expect(await db.notification.count({ where: { userId: patients[0].id } })).toBe(0);
    expect(await db.outboxEvent.count({ where: { userId: patients[0].id } })).toBe(1);
    await expect(
      db.$transaction(async (tx) => {
        await notify(tx, patients[0].id, 'Rollback fixture', 'Synthetic body', clinicId);
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect(await db.outboxEvent.count({ where: { userId: patients[0].id } })).toBe(1);
  });
  it('schedule impact preview rolls back changes and creates no conflict records', async () => {
    const a = await book();
    const rule = await db.doctorScheduleRule.findFirstOrThrow({
      where: { doctorId: doctor.id, clinicId },
    });
    const result = await management.preview(doctor, {
      ruleId: rule.id,
      rule: {
        doctorId: doctor.id,
        clinicId,
        rrule: rule.rrule,
        startTimeLocal: '14:00',
        endTimeLocal: '16:00',
        slotDurationMinutes: 30,
        bufferMinutes: 0,
        consultationType: 'IN_PERSON',
        feeMinor: rule.feeMinor,
        roomId: rule.roomId,
        effectiveFrom: rule.effectiveFrom.toISOString(),
        effectiveTo: null,
      },
    });
    expect(result?.conflicts.map((c) => c.id)).toContain(a.id);
    expect(
      (await db.doctorScheduleRule.findUniqueOrThrow({ where: { id: rule.id } })).startTimeLocal,
    ).toBe(rule.startTimeLocal);
    expect(await db.appointmentConflict.count({ where: { appointmentId: a.id } })).toBe(0);
  });
  it('consultation chat requires participants, the room time window and an open session', async () => {
    const a = await book();
    await db.appointment.update({
      where: { id: a.id },
      data: {
        type: 'TELEMEDICINE',
        startAt: new Date(Date.now() - 60000),
        endAt: new Date(Date.now() + 29 * 60000),
        teleSession: { create: { provider: 'demo', roomName: `chat-${a.id}`, status: 'WAITING' } },
      },
    });
    const tele = new TelemedicineController(db, appointments, gateway);
    const message = await tele.message(patients[0], a.id, {
      text: 'Synthetic consultation message',
    });
    expect((await tele.messages(doctor, a.id))[0].id).toBe(message.id);
    await expect(tele.messages(patients[1], a.id)).rejects.toThrow();
    await db.telemedicineSession.update({
      where: { appointmentId: a.id },
      data: { status: 'ENDED' },
    });
    await expect(tele.message(doctor, a.id, { text: 'Another message' })).rejects.toThrow(
      'Open the waiting room',
    );
    await db.appointment.update({ where: { id: a.id }, data: { status: 'PENDING_PAYMENT' } });
    await expect(tele.token(patients[0], a.id, {})).rejects.toThrow('No active');
  });
});
