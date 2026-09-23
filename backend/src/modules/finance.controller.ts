import { Body, Controller, Get, Post, Patch, Param, Query, Res, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import type { Response } from 'express';
import { DateTime } from 'luxon';
import { PrismaService } from '../common/prisma.service';
import { Actor, AuthGuard, CurrentUser, requireRole } from '../common/access';
import { parse } from '../common/validation';
import { paymentProvider } from './payment.providers';
@Controller()
export class FinanceController {
  constructor(private db: PrismaService) {}
  @Get('clinics/:id/services') services(@Param('id') clinicId: string) {
    return this.db.clinicService.findMany({
      where: { clinicId, active: true, clinic: { active: true } },
      orderBy: { name: 'asc' },
    });
  }
  @Post('finance/clinic/:id/services') @UseGuards(AuthGuard) async createService(
    @CurrentUser() actor: Actor,
    @Param('id') clinicId: string,
    @Body() body: unknown,
  ) {
    requireRole(actor, clinicId, ['CLINIC_ADMIN']);
    const i = parse(
      z.object({
        name: z.string().trim().min(2).max(120),
        feeMinor: z.number().int().min(0).max(100000000),
      }),
      body,
    );
    return this.db.clinicService.create({ data: { clinicId, ...i } });
  }
  @Patch('finance/services/:id') @UseGuards(AuthGuard) async service(
    @CurrentUser() actor: Actor,
    @Param('id') serviceId: string,
    @Body() body: unknown,
  ) {
    const s = await this.db.clinicService.findUniqueOrThrow({ where: { id: serviceId } });
    requireRole(actor, s.clinicId, ['CLINIC_ADMIN']);
    const i = parse(
      z.object({
        name: z.string().min(2).max(120).optional(),
        feeMinor: z.number().int().min(0).max(100000000).optional(),
        active: z.boolean().optional(),
      }),
      body,
    );
    return this.db.clinicService.update({ where: { id: serviceId }, data: i });
  }
  @Patch('finance/clinic/:id/policy') @UseGuards(AuthGuard) async policy(
    @CurrentUser() actor: Actor,
    @Param('id') clinicId: string,
    @Body() body: unknown,
  ) {
    requireRole(actor, clinicId, ['CLINIC_ADMIN']);
    const i = parse(
      z
        .object({
          fullRefundHours: z.number().int().min(1).max(720),
          partialRefundHours: z.number().int().min(0).max(720),
          partialRefundPercent: z.number().int().min(0).max(100),
          noShowGraceMinutes: z.number().int().min(0).max(180),
          allowPayLater: z.boolean(),
          taxBasisPoints: z.number().int().min(0).max(10000),
          invoicePrefix: z.string().regex(/^[A-Z0-9]{1,10}$/),
        })
        .refine(
          (i) => i.fullRefundHours > i.partialRefundHours,
          'Full-refund threshold must exceed partial-refund threshold',
        ),
      body,
    );
    await this.db.auditLog.create({
      data: {
        actorId: actor.id,
        clinicId,
        action: 'BILLING_POLICY_UPDATED',
        entity: 'Clinic',
        entityId: clinicId,
      },
    });
    return this.db.clinic.update({ where: { id: clinicId }, data: i });
  }
  @Get('finance/clinic/:id') @UseGuards(AuthGuard) async summary(
    @CurrentUser() actor: Actor,
    @Param('id') clinicId: string,
  ) {
    requireRole(actor, clinicId, ['CLINIC_ADMIN']);
    const [clinic, payments, ledger, runs, totals] = await Promise.all([
      this.db.clinic.findUniqueOrThrow({ where: { id: clinicId }, include: { services: true } }),
      this.db.payment.findMany({
        where: { appointment: { clinicId } },
        include: {
          appointment: {
            include: {
              patient: { select: { fullName: true } },
              doctor: { include: { user: { select: { fullName: true } } } },
              invoice: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 500,
      }),
      this.db.ledgerEntry.findMany({
        where: { clinicId },
        orderBy: { createdAt: 'desc' },
        take: 1000,
      }),
      this.db.reconciliationRun.findMany({
        where: { clinicId },
        orderBy: { startedAt: 'desc' },
        take: 20,
      }),
      this.db.ledgerEntry.groupBy({
        by: ['side'],
        where: { clinicId },
        _sum: { amountMinor: true },
      }),
    ]);
    const paid = payments.filter((p) =>
        ['SUCCEEDED', 'REFUND_PENDING', 'REFUNDED'].includes(p.status),
      ),
      captured = paid.reduce((s, p) => s + p.amountMinor, 0),
      refunds = paid.filter((p) => p.status === 'REFUNDED').reduce((s, p) => s + p.refundMinor, 0),
      pendingRefunds = paid
        .filter((p) => p.status === 'REFUND_PENDING')
        .reduce((s, p) => s + p.refundMinor, 0),
      due = payments
        .filter(
          (p) =>
            ['CREATED', 'REQUIRES_ACTION'].includes(p.status) &&
            !['CANCELLED', 'RESCHEDULED', 'NO_SHOW'].includes(p.appointment.status),
        )
        .reduce((s, p) => s + p.amountMinor, 0);
    const trend = Array.from({ length: 14 }, (_, index) => {
      const date = DateTime.now()
        .setZone(clinic.timezone)
        .minus({ days: 13 - index })
        .toISODate()!;
      return {
        date,
        revenueMinor: paid
          .filter(
            (p) =>
              DateTime.fromJSDate(p.paidAt || p.createdAt)
                .setZone(clinic.timezone)
                .toISODate() === date,
          )
          .reduce((s, p) => s + p.amountMinor - (p.status === 'REFUNDED' ? p.refundMinor : 0), 0),
      };
    });
    return {
      clinic,
      payments,
      ledger,
      runs,
      capturedMinor: captured,
      refundedMinor: refunds,
      pendingRefundMinor: pendingRefunds,
      netMinor: captured - refunds,
      dueMinor: due,
      trend,
      ledgerDebitMinor: totals.find((t) => t.side === 'DEBIT')?._sum.amountMinor || 0,
      ledgerCreditMinor: totals.find((t) => t.side === 'CREDIT')?._sum.amountMinor || 0,
    };
  }
  @Post('finance/clinic/:id/reconcile') @UseGuards(AuthGuard) async reconcile(
    @CurrentUser() actor: Actor,
    @Param('id') clinicId: string,
    @Body() body: unknown,
  ) {
    requireRole(actor, clinicId, ['CLINIC_ADMIN']);
    const { provider } = parse(
      z.object({ provider: z.enum(['demo', 'stripe', 'bkash', 'sslcommerz']) }),
      body,
    );
    paymentProvider(provider);
    return this.db.reconciliationRun.create({ data: { clinicId, actorId: actor.id, provider } });
  }
  @Get('finance/clinic/:id/export') @UseGuards(AuthGuard) async export(
    @CurrentUser() actor: Actor,
    @Param('id') clinicId: string,
    @Res() res: Response,
  ) {
    requireRole(actor, clinicId, ['CLINIC_ADMIN']);
    const invoices = await this.db.invoice.findMany({
      where: { appointment: { clinicId } },
      include: {
        appointment: { include: { patient: { select: { fullName: true } }, payment: true } },
      },
      orderBy: { issuedAt: 'desc' },
      take: 5000,
    });
    const cell = (value: unknown) => {
      let text = String(value ?? '');
      if (/^[=+@\-\t\r]/.test(text)) text = `'${text}`;
      return `"${text.replaceAll('"', '""')}"`;
    };
    const rows = [
      [
        'Invoice',
        'Patient',
        'Issued at',
        'Subtotal',
        'Tax',
        'Total',
        'Currency',
        'Payment status',
        'Refund',
      ],
      ...invoices.map((i) => [
        i.number,
        i.appointment.patient.fullName,
        i.issuedAt.toISOString(),
        (i.subtotalMinor / 100).toFixed(2),
        (i.taxMinor / 100).toFixed(2),
        (i.totalMinor / 100).toFixed(2),
        i.currency,
        i.appointment.payment?.status || '',
        ((i.appointment.payment?.refundMinor || 0) / 100).toFixed(2),
      ]),
    ];
    await this.db.auditLog.create({
      data: {
        actorId: actor.id,
        clinicId,
        action: 'FINANCE_EXPORTED',
        entity: 'Clinic',
        entityId: clinicId,
      },
    });
    res
      .type('text/csv; charset=utf-8')
      .attachment('careflow-invoices.csv')
      .send('\uFEFF' + rows.map((row) => row.map(cell).join(',')).join('\r\n'));
  }
}
