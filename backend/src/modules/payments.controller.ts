import { RealtimeGateway } from './realtime.gateway';
import {
  Body,
  Optional,
  Controller,
  Get,
  Post,
  Param,
  Req,
  Res,
  Headers,
  UseGuards,
  ConflictException,
  RawBodyRequest,
  BadRequestException,
} from '@nestjs/common';
import { z } from 'zod';
import type { Request, Response } from 'express';
import { Actor, AuthGuard, CurrentUser } from '../common/access';
import { PrismaService } from '../common/prisma.service';
import { id, parse } from '../common/validation';
import { AppointmentsService } from './appointments.service';
import { paymentProvider } from './payment.providers';
import { PdfService } from './pdf.service';
import { AuditService } from '../common/audit.service';
import { lockDoctors } from '../common/locks/pg-advisory.lock';
import { issueInvoice, postLedger } from './billing.domain';
import { notify } from './outbox';
@Controller('payments')
export class PaymentsController {
  constructor(
    private db: PrismaService,
    private appointments: AppointmentsService,
    private pdf: PdfService,
    private audit: AuditService,
    @Optional() private realtime?: RealtimeGateway,
  ) {}
  @Post('intent') @UseGuards(AuthGuard) async intent(
    @CurrentUser() actor: Actor,
    @Body() body: unknown,
  ) {
    const { appointmentId, billing } = parse(
      z.object({
        appointmentId: id,
        billing: z
          .object({
            phone: z.string().min(7).max(20),
            address: z.string().min(3).max(250),
            city: z.string().min(2).max(100),
          })
          .optional(),
      }),
      body,
    );
    const a = await this.appointments.get(actor, appointmentId);
    return this.db.$transaction(
      async (tx) => {
        await lockDoctors(tx, a.doctorId);
        const p = await tx.payment.findUnique({
          where: { appointmentId },
          include: { appointment: true },
        });
        if (!p) throw new ConflictException('No payment exists');
        if (['CANCELLED', 'RESCHEDULED', 'NO_SHOW'].includes(p.appointment.status))
          throw new ConflictException('This appointment cannot be paid');
        if (!['CREATED', 'REQUIRES_ACTION'].includes(p.status))
          throw new ConflictException('Payment is already processed');
        if (p.checkoutUrl && p.providerRef)
          return {
            reference: p.providerRef,
            checkoutUrl: p.checkoutUrl,
            paymentId: p.id,
            provider: p.provider,
            amountMinor: p.amountMinor,
            currency: p.currency,
          };
        const intent = await paymentProvider(p.provider).createIntent(
          p.amountMinor,
          p.currency,
          p.idempotencyKey,
          {
            customerId: a.patientId,
            customerName: a.patient.fullName,
            email: a.patient.email,
            billing,
          },
        );
        await tx.payment.update({
          where: { id: p.id },
          data: {
            providerRef: intent.reference,
            status: 'REQUIRES_ACTION',
            ...(intent.checkoutUrl ? { checkoutUrl: intent.checkoutUrl } : {}),
          },
        });
        return {
          ...intent,
          paymentId: p.id,
          provider: p.provider,
          amountMinor: p.amountMinor,
          currency: p.currency,
        };
      },
      { timeout: 35000, maxWait: 15000 },
    );
  }
  @Post(':id/demo-settle') @UseGuards(AuthGuard) async demo(
    @CurrentUser() actor: Actor,
    @Param('id') id: string,
  ) {
    const initial = await this.db.payment.findUniqueOrThrow({ where: { id } });
    const a = await this.appointments.get(actor, initial.appointmentId);
    if (initial.provider !== 'demo' || process.env.DEMO_MODE !== 'true')
      throw new BadRequestException('Demo settlement is disabled');
    return this.db.$transaction(async (tx) => {
      await lockDoctors(tx, a.doctorId);
      const p = await tx.payment.findUniqueOrThrow({
        where: { id },
        include: { appointment: true },
      });
      if (['CANCELLED', 'RESCHEDULED', 'NO_SHOW'].includes(p.appointment.status))
        throw new ConflictException('Appointment is no longer payable');
      if (p.status === 'SUCCEEDED') return p;
      if (!['CREATED', 'REQUIRES_ACTION'].includes(p.status))
        throw new ConflictException('Payment has changed');
      const paid = await tx.payment.update({
        where: { id },
        data: {
          status: 'SUCCEEDED',
          paidAt: new Date(),
          providerRef: p.providerRef || `demo_${p.id}`,
        },
      });
      await postLedger(tx, { ...paid, appointment: p.appointment }, 'CAPTURE');
      if (p.appointment.status === 'PENDING_PAYMENT')
        await tx.appointment.update({
          where: { id: p.appointmentId },
          data: { status: 'CONFIRMED' },
        });
      await notify(
        tx,
        p.appointment.patientId,
        'Payment completed',
        'Your payment is complete. View your invoice in Payments & invoices.',
        p.appointment.clinicId,
      );
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          clinicId: a.clinicId,
          action: 'PAYMENT_SUCCEEDED',
          entity: 'Payment',
          entityId: id,
        },
      });
      return paid;
    });
  }
  @Post('webhooks/:provider') async webhook(
    @Param('provider') provider: string,
    @Headers('stripe-signature') signature: string,
    @Req() req: RawBodyRequest<Request>,
  ) {
    if (!req.rawBody) throw new BadRequestException('Raw request body required');
    const event = paymentProvider(provider).parseWebhook(req.rawBody, signature || '');
    if (!event.paid) return { received: true };
    const initial = await this.db.payment.findUnique({
      where: { providerRef: event.reference },
      include: { appointment: true },
    });
    if (
      !initial ||
      initial.provider !== provider ||
      initial.amountMinor !== event.amountMinor ||
      initial.currency !== event.currency
    )
      throw new BadRequestException('Webhook payment mismatch');
    return this.db
      .$transaction(async (tx) => {
        await lockDoctors(tx, initial.appointment.doctorId);
        if (await tx.webhookEvent.findUnique({ where: { id: event.eventId } }))
          return { received: true };
        const p = await tx.payment.findUniqueOrThrow({
          where: { id: initial.id },
          include: { appointment: true },
        });
        await tx.webhookEvent.create({ data: { id: event.eventId } });
        const changed = await tx.payment.updateMany({
          where: {
            id: p.id,
            status: { in: ['CREATED', 'REQUIRES_ACTION', 'FAILED', 'CANCELLED'] },
          },
          data: ['CANCELLED', 'RESCHEDULED', 'NO_SHOW'].includes(p.appointment.status)
            ? { status: 'REFUND_PENDING', refundMinor: p.amountMinor }
            : { status: 'SUCCEEDED' },
        });
        if (changed.count)
          await notify(
            tx,
            p.appointment.patientId,
            'Payment verified',
            'Your payment is verified. View your invoice in Payments & invoices.',
            p.appointment.clinicId,
          );
        await postLedger(tx, p, 'CAPTURE');
        await tx.payment.update({ where: { id: p.id }, data: { paidAt: p.paidAt || new Date() } });
        if (p.appointment.status === 'PENDING_PAYMENT')
          await tx.appointment.update({
            where: { id: p.appointmentId },
            data: { status: 'CONFIRMED' },
          });
        return { received: true };
      })
      .then((result) => {
        this.realtime?.appointmentUpdated(initial.appointment);
        return result;
      });
  }
  @Get(':appointmentId/invoice') @UseGuards(AuthGuard) async invoice(
    @CurrentUser() actor: Actor,
    @Param('appointmentId') id: string,
    @Res() res: Response,
  ) {
    const a = await this.appointments.get(actor, id);
    const p = a.payment;
    if (!p) throw new ConflictException('No invoice exists');
    const invoice = await this.db.$transaction((tx) => issueInvoice(tx, a));
    const data = await this.pdf.render('Consultation invoice', [
      `Invoice: ${invoice.number}`,
      `Patient: ${a.patient.fullName}`,
      `Clinic: ${a.clinic.name}`,
      `Doctor: ${a.doctor.user.fullName}`,
      `Date: ${a.startAt.toISOString()}`,
      `Amount: ${(p.amountMinor / 100).toFixed(2)} ${p.currency}`,
      `Subtotal: ${(invoice.subtotalMinor / 100).toFixed(2)} ${p.currency}`,
      `Tax: ${(invoice.taxMinor / 100).toFixed(2)} ${p.currency}`,
      `Payment status: ${p.status}`,
      `Refund: ${(p.refundMinor / 100).toFixed(2)} ${p.currency}`,
    ]);
    await this.audit.record(actor.id, 'INVOICE_EXPORTED', 'Payment', p.id, a.clinicId);
    res.type('application/pdf').attachment(`invoice-${p.id}.pdf`).send(data);
  }
}
