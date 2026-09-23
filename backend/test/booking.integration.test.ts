import 'dotenv/config';
import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import { PrismaService } from '../src/common/prisma.service';
import { Actor, canReadAppointment, canReadClinical } from '../src/common/access';
import { AppointmentsService } from '../src/modules/appointments.service';
import { SchedulesService } from '../src/modules/schedules.service';
import { ClinicalService } from '../src/modules/clinical.service';
import { RealtimeGateway } from '../src/modules/realtime.gateway';
import { DateTime } from 'luxon';
import { PdfService } from '../src/modules/pdf.service';
import { AuditService } from '../src/common/audit.service';
import { DocumentsController } from '../src/modules/documents.controller';
import { TelemedicineController } from '../src/modules/telemedicine.controller';
import { PaymentsController } from '../src/modules/payments.controller';
import { AuthService } from '../src/modules/auth.service';
import { JwtService } from '@nestjs/jwt';
// Runs against a real PostgreSQL database with isolated IDs; never truncates existing records.
const enabled = Boolean(process.env.DATABASE_URL);
const suite = enabled ? describe : describe.skip;
suite('PostgreSQL booking and clinic boundaries', () => {
  const db = new PrismaService(),
    schedule = new SchedulesService(db),
    gateway = { appointmentUpdated: () => {} } as unknown as RealtimeGateway;
  const service = new AppointmentsService(db, schedule, gateway),
    clinical = new ClinicalService(db, service),
    pdf = new PdfService(),
    audit = new AuditService(db);
  const prefix = `test-${Date.now()}`,
    doctorId = `${prefix}-doctor`,
    clinicId = `${prefix}-clinic`;
  const actors: Actor[] = Array.from({ length: 50 }, (_, i) => ({
    id: `${prefix}-patient-${i}`,
    email: `${prefix}-${i}@test.local`,
    fullName: `Test ${i}`,
    globalRole: 'PATIENT',
    roles: [],
  }));
  const day = DateTime.now().setZone('Asia/Dhaka').plus({ days: 15 }).toISODate()!,
    startAt = `${day}T09:00:00+06:00`;
  beforeAll(async () => {
    await db.$connect();
    await db.clinic.create({
      data: { id: clinicId, name: 'Integration clinic', slug: clinicId, address: 'Test address' },
    });
    await db.user.createMany({
      data: [
        {
          id: doctorId,
          email: `${prefix}-doctor@test.local`,
          fullName: 'Test doctor',
          passwordHash: 'not-a-login',
          allergies: [],
        },
        ...actors.map((a) => ({
          id: a.id,
          email: a.email,
          fullName: a.fullName,
          passwordHash: 'not-a-login',
          allergies: [],
        })),
      ],
    });
    await db.doctorProfile.create({
      data: {
        userId: doctorId,
        licenseNumber: prefix,
        bio: 'Test',
        specialties: ['Test'],
        languages: ['English'],
        memberships: { create: { clinicId, feeMinor: 100000, teleFeeMinor: 100000 } },
        rules: {
          create: {
            clinicId,
            rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR,SA,SU',
            startTimeLocal: '09:00',
            endTimeLocal: '17:00',
            slotDurationMinutes: 30,
            bufferMinutes: 0,
            effectiveFrom: new Date(),
            feeMinor: 100000,
          },
        },
      },
    });
  });
  async function clear() {
    await db.invoice.deleteMany({ where: { appointment: { clinicId } } });
    await db.appointmentConflict.deleteMany({ where: { appointment: { clinicId } } });
    await db.ledgerEntry.deleteMany({ where: { clinicId } });
    await db.outboxEvent.deleteMany({ where: { clinicId } });
    await db.attachment.deleteMany({ where: { appointment: { clinicId } } });
    await db.vital.deleteMany({ where: { appointment: { clinicId } } });
    await db.refreshSession.deleteMany({ where: { userId: { in: actors.map((a) => a.id) } } });
    await db.noteRevision.deleteMany({ where: { note: { appointment: { clinicId } } } });
    await db.clinicalNote.deleteMany({ where: { appointment: { clinicId } } });
    await db.prescription.deleteMany({ where: { appointment: { clinicId } } });
    await db.payment.deleteMany({ where: { appointment: { clinicId } } });
    await db.telemedicineSession.deleteMany({ where: { appointment: { clinicId } } });
    await db.appointment.deleteMany({ where: { clinicId } });
    await db.slotHold.deleteMany({ where: { doctorId } });
    await db.scheduleException.deleteMany({ where: { doctorId } });
  }
  beforeEach(clear);
  afterAll(async () => {
    await clear();
    await db.auditLog.deleteMany({ where: { clinicId } });
    await db.notification.deleteMany({ where: { userId: { in: actors.map((a) => a.id) } } });
    await db.doctorScheduleRule.deleteMany({ where: { doctorId } });
    await db.doctorClinic.deleteMany({ where: { doctorId } });
    await db.doctorProfile.delete({ where: { userId: doctorId } });
    await db.user.deleteMany({ where: { id: { in: [doctorId, ...actors.map((a) => a.id)] } } });
    await db.clinic.delete({ where: { id: clinicId } });
    await db.$disconnect();
  });
  const input = { doctorId, clinicId, startAt, type: 'IN_PERSON' };
  it('50 simultaneous holds produce exactly one holder and one confirmed appointment', async () => {
    const results = await Promise.allSettled(actors.map((a) => service.hold(a, input)));
    const won = results.map((r, i) => ({ r, i })).filter((x) => x.r.status === 'fulfilled');
    expect(won).toHaveLength(1);
    const winner = won[0];
    const hold = (winner.r as PromiseFulfilledResult<{ id: string }>).value;
    await service.confirm(actors[winner.i], hold.id, `${prefix}-race-confirm`);
    expect(await db.appointment.count({ where: { clinicId, status: 'CONFIRMED' } })).toBe(1);
    expect(await db.slotHold.count({ where: { doctorId } })).toBe(0);
  });
  it('concurrent confirms cannot consume a hold twice', async () => {
    const hold = await service.hold(actors[0], input);
    const results = await Promise.allSettled([
      service.confirm(actors[0], hold.id, `${prefix}-confirm-one`),
      service.confirm(actors[0], hold.id, `${prefix}-confirm-two`),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });
  it('returns the same booking on an idempotent retry', async () => {
    const hold = await service.hold(actors[0], input);
    const a = await service.confirm(actors[0], hold.id, `${prefix}-retry-key`);
    const b = await service.confirm(actors[0], hold.id, `${prefix}-retry-key`);
    expect(a.id).toBe(b.id);
  });
  it('reclaims expired holds without waiting for cleanup', async () => {
    const hold = await service.hold(actors[0], input);
    await db.slotHold.update({
      where: { id: hold.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const replacement = await service.hold(actors[1], input);
    expect(replacement.patientId).toBe(actors[1].id);
  });
  it('rechecks a new day-off exception when confirming', async () => {
    const hold = await service.hold(actors[0], input);
    await db.scheduleException.create({
      data: { doctorId, clinicId, dateLocal: new Date(day), type: 'DAY_OFF' },
    });
    await expect(service.confirm(actors[0], hold.id, `${prefix}-day-off`)).rejects.toThrow(
      'Schedule changed',
    );
  });
  it('cancels with a full refund and makes the slot available', async () => {
    const hold = await service.hold(actors[0], input);
    const a = await service.confirm(actors[0], hold.id, `${prefix}-cancel-refund`);
    await db.payment.update({
      where: { appointmentId: a.id },
      data: { status: 'SUCCEEDED', providerRef: `demo-${a.id}` },
    });
    await service.transition(actors[0], a.id, 'CANCELLED');
    const payment = await db.payment.findUniqueOrThrow({ where: { appointmentId: a.id } });
    expect(payment.status).toBe('REFUND_PENDING');
    expect(payment.refundMinor).toBe(a.feeMinor);
    expect((await service.hold(actors[1], input)).patientId).toBe(actors[1].id);
  });
  it('denies another clinic’s receptionist and unrelated patient', async () => {
    const hold = await service.hold(actors[0], input);
    const a = await service.confirm(actors[0], hold.id, `${prefix}-access-check`);
    const receptionist = {
      ...actors[2],
      roles: [{ clinicId: 'different-clinic', role: 'RECEPTIONIST' }],
    };
    expect(() => canReadAppointment(receptionist, a)).toThrow();
    expect(() =>
      canReadClinical({ ...actors[2], roles: [{ clinicId, role: 'RECEPTIONIST' }] }, a),
    ).toThrow();
    await expect(clinical.history(actors[1], actors[0].id, clinicId)).rejects.toThrow();
  });
  it('contains the active-status unique index', async () => {
    const rows = await db.$queryRaw<
      { indexdef: string }[]
    >`SELECT indexdef FROM pg_indexes WHERE indexname='appointment_doctor_start_active_uq'`;
    expect(rows[0].indexdef).toContain('UNIQUE');
    expect(rows[0].indexdef).toContain('CONFIRMED');
  });
  it('preserves clinical revisions and verifies a signed prescription without leaking patient data', async () => {
    const h = await service.hold(actors[0], input);
    const a = await service.confirm(actors[0], h.id, `${prefix}-clinical`);
    await db.appointment.update({ where: { id: a.id }, data: { status: 'IN_PROGRESS' } });
    const doctor = { ...actors[0], id: doctorId, roles: [{ clinicId, role: 'DOCTOR' }] };
    const soap = {
      subjective: 'Follow-up',
      objective: 'Stable',
      assessment: 'Review',
      plan: 'Return',
    };
    const note = await clinical.notes(doctor, a.id, soap);
    await clinical.notes(doctor, a.id, { ...soap, plan: 'Updated follow-up' }, note.id);
    expect(await db.noteRevision.count({ where: { noteId: note.id } })).toBe(1);
    const draft = await clinical.draft(doctor, a.id, [
      {
        name: 'Synthetic medicine',
        dosage: 'Demo',
        frequency: 'Demo',
        duration: 'Demo',
        route: 'Oral',
        instructions: 'Synthetic test record',
      },
    ]);
    const signed = await clinical.sign(doctor, draft.prescription.id);
    const verification = await clinical.verify(signed.verificationCode);
    expect(verification.status).toBe('SIGNED');
    expect(verification).not.toHaveProperty('items');
    expect(verification).not.toHaveProperty('patient');
    await expect(clinical.draft(doctor, a.id, [])).rejects.toThrow('Signed prescriptions');
    const bytes = await pdf.prescription(await clinical.prescription(doctor, signed.id));
    expect(bytes.subarray(0, 4).toString()).toBe('%PDF');
  });
  it('encrypts documents and rejects uploads by unrelated patients', async () => {
    process.env.ATTACHMENT_ENCRYPTION_KEY = 'a'.repeat(64);
    const h = await service.hold(actors[0], input);
    const a = await service.confirm(actors[0], h.id, `${prefix}-file`);
    const docs = new DocumentsController(db, service, audit);
    const content = Buffer.from('%PDF-1.4\nSynthetic fixture');
    const file = await docs.upload(actors[0], a.id, {
      name: 'result.pdf',
      mime: 'application/pdf',
      base64: content.toString('base64'),
    });
    const stored = await db.attachment.findUniqueOrThrow({ where: { id: file.id } });
    expect(Buffer.from(stored.encrypted).includes(content)).toBe(false);
    expect(stored.size).toBe(content.length);
    await expect(
      docs.upload(actors[1], a.id, {
        name: 'result.pdf',
        mime: 'application/pdf',
        base64: content.toString('base64'),
      }),
    ).rejects.toThrow();
    await expect(
      docs.upload(actors[0], a.id, {
        name: 'wrong.png',
        mime: 'image/png',
        base64: content.toString('base64'),
      }),
    ).rejects.toThrow('does not match');
  });
  it('allows only participants into telemedicine and signs scoped LiveKit tokens after admission', async () => {
    const a = await db.appointment.create({
      data: {
        doctorId,
        clinicId,
        patientId: actors[0].id,
        type: 'TELEMEDICINE',
        status: 'CONFIRMED',
        feeMinor: 100000,
        startAt: new Date(Date.now() + 5 * 60000),
        endAt: new Date(Date.now() + 35 * 60000),
        idempotencyKey: `${prefix}-tele`,
        teleSession: { create: { provider: 'livekit', roomName: `${prefix}-room` } },
      },
    });
    const tele = new TelemedicineController(db, service, {
      teleUpdated: () => {},
    } as unknown as RealtimeGateway);
    const doctor = { ...actors[0], id: doctorId, roles: [{ clinicId, role: 'DOCTOR' }] };
    process.env.LIVEKIT_API_KEY = 'integration-key';
    process.env.LIVEKIT_API_SECRET = 'integration-secret-that-is-at-least-32-characters';
    process.env.LIVEKIT_URL = 'wss://video.test.local';
    const waiting = await tele.token(actors[0], a.id, {});
    expect(waiting.status).toBe('WAITING');
    expect(waiting).not.toHaveProperty('token');
    await expect(tele.token(actors[1], a.id, {})).rejects.toThrow();
    await expect(tele.transition(actors[0], a.id, { status: 'LIVE' })).rejects.toThrow();
    await tele.transition(doctor, a.id, { status: 'LIVE' });
    const joined = await tele.token(actors[0], a.id, {});
    const claims = JSON.parse(Buffer.from(joined.token!.split('.')[1], 'base64url').toString());
    expect(claims.sub).toBe(actors[0].id);
    expect(claims.video.room).toBe(`${prefix}-room`);
  });
  it('serializes payment capture with cancellation so a successful capture is refundable', async () => {
    process.env.DEMO_MODE = 'true';
    const h = await service.hold(actors[0], input);
    const a = await service.confirm(actors[0], h.id, `${prefix}-payment-race`);
    const controller = new PaymentsController(db, service, pdf, audit);
    await Promise.allSettled([
      controller.demo(actors[0], a.payment!.id),
      service.transition(actors[0], a.id, 'CANCELLED'),
    ]);
    const p = await db.payment.findUniqueOrThrow({ where: { id: a.payment!.id } });
    expect(
      p.status === 'CREATED' || (p.status === 'REFUND_PENDING' && p.refundMinor === a.feeMinor),
    ).toBe(true);
    expect((await db.appointment.findUniqueOrThrow({ where: { id: a.id } })).status).toBe(
      'CANCELLED',
    );
  });
  it('rotates a refresh token exactly once under concurrent reuse', async () => {
    process.env.JWT_ACCESS_SECRET = 'integration-secret-that-is-at-least-32-characters';
    const auth = new AuthService(db, new JwtService());
    const tokens = await auth.issue(actors[0].id, 'Integration device');
    const results = await Promise.allSettled([
      auth.refresh(tokens.refresh, 'Device A'),
      auth.refresh(tokens.refresh, 'Device B'),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    await expect(auth.refresh(tokens.refresh, 'Device C')).rejects.toThrow();
  });
});
