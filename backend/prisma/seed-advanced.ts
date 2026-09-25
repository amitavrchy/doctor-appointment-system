import { PrismaClient } from '@prisma/client';
import { DateTime } from 'luxon';
import { issueInvoice, postLedger } from '../src/modules/billing.domain';

/** Synthetic, stable fixtures: reruns preserve records edited through the product. */
export async function seedAdvanced(db: PrismaClient) {
  const clinicId = 'clinic-dhanmondi',
    doctorId = 'doctor-sara',
    patientId = 'patient-demo';
  for (const [name, feeMinor] of [
    ['ECG assessment', 60000],
    ['Basic health screening', 45000],
  ] as const)
    await db.clinicService.upsert({
      where: { clinicId_name: { clinicId, name } },
      create: { clinicId, name, feeMinor },
      update: {},
    });
  await db.clinicalTemplate.upsert({
    where: { id: 'seed-template-follow-up' },
    create: {
      id: 'seed-template-follow-up',
      clinicId,
      authorId: doctorId,
      title: 'Routine follow-up',
      specialty: 'Cardiology',
      shared: true,
      soap: {
        subjective: 'Interval symptoms and medication adherence:',
        objective: 'Observations and examination:',
        assessment: 'Clinical assessment:',
        plan: 'Shared treatment plan and review date:',
      },
    },
    update: {},
  });
  await db.carePlan.upsert({
    where: { id: 'seed-care-plan' },
    create: {
      id: 'seed-care-plan',
      clinicId,
      doctorId,
      patientId,
      title: 'Your wellbeing, one step at a time',
      description:
        'Synthetic demonstration plan. Review your agreed goals and bring questions to your next visit.',
      reviewAt: DateTime.now().plus({ days: 14 }).toJSDate(),
      tasks: {
        create: [
          {
            title: 'Keep a daily wellbeing journal',
            dueAt: DateTime.now().plus({ days: 3 }).toJSDate(),
          },
          {
            title: 'Bring your current medication list to your review',
            dueAt: DateTime.now().plus({ days: 14 }).toJSDate(),
          },
          {
            title: 'Review your care information',
            completedAt: new Date(),
            completedBy: patientId,
          },
        ],
      },
    },
    update: {},
  });
  const visits = await db.appointment.findMany({
    where: { id: { startsWith: 'seed-appointment-' }, status: 'COMPLETED' },
    include: { clinic: true, patient: true, doctor: { include: { user: true } }, payment: true },
    orderBy: { startAt: 'asc' },
  });
  for (const a of visits) {
    await db.$transaction(async (tx) => {
      await issueInvoice(tx, a);
      if (a.payment?.status === 'SUCCEEDED')
        await postLedger(tx, { ...a.payment, appointment: a }, 'CAPTURE');
    });
    await db.vital.upsert({
      where: { id: `seed-vital-${a.id}` },
      create: {
        id: `seed-vital-${a.id}`,
        appointmentId: a.id,
        authorId: a.doctorId,
        systolic: 118,
        diastolic: 78,
        pulse: 72,
        temperature: 36.7,
        oxygen: 98,
        weight: 67,
        createdAt: a.startAt,
      },
      update: {},
    });
  }
  const a =
    visits.find((a) => a.patientId === patientId && a.doctorId === doctorId) ||
    visits.find((a) => a.patientId === patientId);
  if (a) {
    await db.labOrder.upsert({
      where: { id: 'seed-lab-order' },
      create: {
        id: 'seed-lab-order',
        appointmentId: a.id,
        title: 'Routine screening (synthetic)',
        tests: [
          { name: 'Complete blood count', instructions: 'Follow your clinician instructions.' },
        ],
        status: 'REVIEWED',
        reviewedAt: new Date(),
        results: [
          {
            name: 'Hemoglobin',
            value: '13.4',
            unit: 'g/dL',
            reference: 'Synthetic example',
            flag: 'NORMAL',
          },
        ],
      },
      update: {},
    });
    await db.referral.upsert({
      where: { id: 'seed-referral' },
      create: {
        id: 'seed-referral',
        appointmentId: a.id,
        targetDoctorId: 'doctor-imran',
        specialty: 'General Medicine',
        reason: 'Synthetic example: coordinate a routine wellness review.',
      },
      update: {},
    });
  }
}
