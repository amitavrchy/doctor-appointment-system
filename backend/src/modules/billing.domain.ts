import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
export function priceVisit(
  baseFeeMinor: number,
  addons: { id: string; name: string; feeMinor: number }[],
  taxBasisPoints: number,
) {
  const subtotal = baseFeeMinor + addons.reduce((s, a) => s + a.feeMinor, 0),
    taxMinor = Math.round((subtotal * taxBasisPoints) / 10000),
    total = subtotal + taxMinor;
  if (!Number.isSafeInteger(total) || total < 0 || total > 1000000000)
    throw new BadRequestException('Consultation amount exceeds the supported range');
  return { baseFeeMinor, addons, taxMinor, total, subtotal };
}
export async function postLedger(
  tx: Prisma.TransactionClient,
  p: {
    id: string;
    appointment: { clinicId: string; taxMinor: number };
    amountMinor: number;
    refundMinor: number;
    currency: string;
  },
  kind: 'CAPTURE' | 'REFUND',
) {
  const prior =
    kind === 'REFUND'
      ? await tx.ledgerEntry.aggregate({
          where: { paymentId: p.id, account: 'CASH', side: 'CREDIT' },
          _sum: { amountMinor: true },
        })
      : null;
  const refunded = prior ? prior._sum.amountMinor || 0 : 0;
  const amount = kind === 'CAPTURE' ? p.amountMinor : p.refundMinor - refunded;
  if (amount <= 0) return;
  const tax =
    kind === 'CAPTURE'
      ? p.appointment.taxMinor
      : Math.min(
          amount,
          Math.round((p.appointment.taxMinor * p.refundMinor) / Math.max(1, p.amountMinor)) -
            Math.round((p.appointment.taxMinor * refunded) / Math.max(1, p.amountMinor)),
        );
  const journalId = kind === 'CAPTURE' ? `capture-${p.id}` : `refund-${p.id}-${p.refundMinor}`,
    debit = kind === 'CAPTURE' ? 'DEBIT' : 'CREDIT',
    credit = kind === 'CAPTURE' ? 'CREDIT' : 'DEBIT';
  const entries = [
    { account: 'CASH', side: debit, amountMinor: amount },
    { account: 'CONSULTATION_REVENUE', side: credit, amountMinor: amount - tax },
    ...(tax ? [{ account: 'TAX_PAYABLE', side: credit, amountMinor: tax }] : []),
  ];
  await tx.ledgerEntry.createMany({
    data: entries
      .filter((e) => e.amountMinor > 0)
      .map((e) => ({
        ...e,
        journalId,
        clinicId: p.appointment.clinicId,
        paymentId: p.id,
        currency: p.currency,
      })),
    skipDuplicates: true,
  });
}
export async function issueInvoice(
  tx: Prisma.TransactionClient,
  a: {
    id: string;
    clinicId: string;
    feeMinor: number;
    taxMinor: number;
    baseFeeMinor: number | null;
    addons: Prisma.JsonValue;
    currency: string;
    clinic: { name: string; address: string; invoicePrefix: string; slug: string };
    patient: { fullName: string };
    doctor: { user: { fullName: string } };
  },
) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`invoice:${a.id}`}, 2))`;
  const existing = await tx.invoice.findUnique({ where: { appointmentId: a.id } });
  if (existing) return existing;
  const year = new Date().getUTCFullYear();
  const counter = await tx.clinicQueueCounter.upsert({
    where: { id: `invoice:${a.clinicId}:${year}` },
    create: { id: `invoice:${a.clinicId}:${year}`, value: 1 },
    update: { value: { increment: 1 } },
  });
  return tx.invoice.create({
    data: {
      appointmentId: a.id,
      number: `${a.clinic.invoicePrefix}-${a.clinic.slug.toUpperCase()}-${year}-${String(counter.value).padStart(5, '0')}`,
      subtotalMinor: a.feeMinor - a.taxMinor,
      taxMinor: a.taxMinor,
      totalMinor: a.feeMinor,
      currency: a.currency,
      snapshot: {
        patient: a.patient.fullName,
        doctor: a.doctor.user.fullName,
        clinic: a.clinic.name,
        address: a.clinic.address,
        baseFeeMinor: a.baseFeeMinor ?? a.feeMinor,
        addons: a.addons,
      },
    },
  });
}
