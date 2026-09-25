import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { lockDoctors } from '../common/locks/pg-advisory.lock';
import { paymentProvider, ProviderReceipt } from './payment.providers';
import { BkashPaymentProvider } from './bangladesh-payment.providers';
import { postLedger } from './billing.domain';
import { RealtimeGateway } from './realtime.gateway';
import { notify } from './outbox';
@Injectable()
export class ReconciliationService {
  constructor(
    private db: PrismaService,
    private realtime: RealtimeGateway,
  ) {}
  async apply(paymentId: string, receipt: ProviderReceipt) {
    const initial = await this.db.payment.findUniqueOrThrow({
      where: { id: paymentId },
      include: { appointment: true },
    });
    if (receipt.reference !== initial.providerRef)
      throw new BadRequestException('Provider reference did not match');
    if (!receipt.paid) return { changed: false };
    if (
      !Number.isSafeInteger(receipt.amountMinor) ||
      receipt.amountMinor !== initial.amountMinor ||
      receipt.currency !== initial.currency
    )
      throw new BadRequestException(
        'Provider amount, currency, or transaction reference did not match',
      );
    const result = await this.db.$transaction(async (tx) => {
      await lockDoctors(tx, initial.appointment.doctorId);
      const p = await tx.payment.findUniqueOrThrow({
        where: { id: paymentId },
        include: { appointment: true },
      });
      let changed = false;
      if (['CREATED', 'REQUIRES_ACTION', 'FAILED', 'CANCELLED'].includes(p.status)) {
        const cancelled = ['CANCELLED', 'RESCHEDULED', 'NO_SHOW'].includes(p.appointment.status);
        await tx.payment.update({
          where: { id: p.id },
          data: {
            status: cancelled ? 'REFUND_PENDING' : 'SUCCEEDED',
            paidAt: new Date(),
            ...(receipt.transactionId
              ? { providerTransactionId: `${p.provider}:${receipt.transactionId}` }
              : {}),
            ...(cancelled ? { refundMinor: p.amountMinor } : {}),
          },
        });
        if (p.appointment.status === 'PENDING_PAYMENT')
          await tx.appointment.update({
            where: { id: p.appointmentId },
            data: { status: 'CONFIRMED' },
          });
        await notify(
          tx,
          p.appointment.patientId,
          'Payment verified',
          'Your payment was verified by the payment provider. Your invoice is available in Payments & invoices.',
          p.appointment.clinicId,
        );
        changed = true;
      }
      const current = await tx.payment.findUniqueOrThrow({
        where: { id: p.id },
        include: { appointment: true },
      });
      if (['SUCCEEDED', 'REFUND_PENDING', 'REFUNDED'].includes(current.status))
        await postLedger(tx, current, 'CAPTURE');
      if (
        (receipt.refundedMinor || 0) > 0 &&
        (receipt.refundedMinor || 0) <= current.amountMinor &&
        (receipt.refundedMinor || 0) >= current.refundMinor
      ) {
        const refund = await tx.payment.update({
          where: { id: p.id },
          data: { status: 'REFUNDED', refundMinor: receipt.refundedMinor, refundedAt: new Date() },
          include: { appointment: true },
        });
        await postLedger(tx, refund, 'REFUND');
        changed = true;
      }
      await tx.payment.update({ where: { id: p.id }, data: { lastReconciledAt: new Date() } });
      await tx.auditLog.create({
        data: {
          clinicId: p.appointment.clinicId,
          action: 'PAYMENT_RECONCILED',
          entity: 'Payment',
          entityId: p.id,
        },
      });
      return { changed, appointment: current.appointment };
    });
    this.realtime.appointmentUpdated(result.appointment);
    return { changed: result.changed };
  }
  async sync(paymentId: string, validationId?: string, complete = false) {
    const p = await this.db.payment.findUniqueOrThrow({ where: { id: paymentId } });
    if (!p.providerRef) throw new BadRequestException('Payment has not been initiated');
    const provider = paymentProvider(p.provider);
    if (!provider.verify) throw new BadRequestException('This provider has no remote verification');
    const receipt =
      complete && provider instanceof BkashPaymentProvider
        ? await provider.complete(p.providerRef)
        : await provider.verify(p.providerRef, validationId);
    return this.apply(p.id, receipt);
  }
  async run(runId: string) {
    const run = await this.db.reconciliationRun.findUniqueOrThrow({ where: { id: runId } });
    if (run.status === 'COMPLETED') return;
    await this.db.reconciliationRun.update({
      where: { id: runId },
      data: { status: 'RUNNING', startedAt: new Date(), checked: 0, repaired: 0, errors: 0 },
    });
    const payments = await this.db.payment.findMany({
      where: {
        provider: run.provider,
        appointment: { clinicId: run.clinicId },
        createdAt: { gte: new Date(Date.now() - 30 * 86400000) },
      },
      include: { appointment: true },
      take: 500,
      orderBy: { createdAt: 'desc' },
    });
    let checked = 0,
      repaired = 0,
      errors = 0;
    for (const p of payments) {
      try {
        if (p.provider === 'demo') {
          if (['SUCCEEDED', 'REFUND_PENDING', 'REFUNDED'].includes(p.status)) {
            const existing = await this.db.ledgerEntry.count({ where: { paymentId: p.id } });
            await this.db.$transaction(async (tx) => {
              await lockDoctors(tx, p.appointment.doctorId);
              await postLedger(tx, p, 'CAPTURE');
              if (p.status === 'REFUNDED') await postLedger(tx, p, 'REFUND');
            });
            if (!existing) repaired++;
          }
        } else if (p.providerRef) {
          const result = await this.sync(p.id);
          if (result.changed) repaired++;
        }
        checked++;
      } catch {
        errors++;
        checked++;
      }
    }
    await this.db.reconciliationRun.update({
      where: { id: runId },
      data: {
        status: errors ? 'COMPLETED_WITH_ERRORS' : 'COMPLETED',
        checked,
        repaired,
        errors,
        completedAt: new Date(),
      },
    });
  }
}
