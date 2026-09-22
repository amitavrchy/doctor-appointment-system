import {
  Body,
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Query,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { Actor, AuthGuard, CurrentUser, requireRole } from '../common/access';
import { id, iso, parse } from '../common/validation';
import { z } from 'zod';
@Controller()
@UseGuards(AuthGuard)
export class OperationsController {
  constructor(private db: PrismaService) {}
  @Get('notifications') notifications(@CurrentUser() actor: Actor) {
    return this.db.notification.findMany({
      where: { userId: actor.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }
  @Patch('notifications/read') read(@CurrentUser() actor: Actor) {
    return this.db.notification.updateMany({
      where: { userId: actor.id, readAt: null },
      data: { readAt: new Date() },
    });
  }
  @Get('waitlist') waitlist(@CurrentUser() actor: Actor) {
    return this.db.waitlistEntry.findMany({
      where: { patientId: actor.id, status: { in: ['ACTIVE', 'OFFERED'] } },
      orderBy: { createdAt: 'asc' },
    });
  }
  @Post('waitlist') async join(@CurrentUser() actor: Actor, @Body() body: unknown) {
    if (
      (await this.db.featureFlag.findUnique({ where: { key: 'WAITLIST_ENABLED' } }))?.enabled ===
      false
    )
      throw new BadRequestException('The waitlist is temporarily unavailable');
    const i = parse(
      z.object({
        doctorId: id,
        clinicId: id,
        preferredStart: iso.optional(),
        preferredEnd: iso.optional(),
      }),
      body,
    );
    if (
      !(await this.db.doctorClinic.findUnique({
        where: { doctorId_clinicId: { doctorId: i.doctorId, clinicId: i.clinicId } },
      }))
    )
      throw new BadRequestException('Doctor is not assigned to clinic');
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${actor.id + ':' + i.doctorId + ':' + i.clinicId}, 2))`;
      const existing = await tx.waitlistEntry.findFirst({
        where: {
          patientId: actor.id,
          doctorId: i.doctorId,
          clinicId: i.clinicId,
          status: 'ACTIVE',
        },
      });
      if (existing) return existing;
      return tx.waitlistEntry.create({
        data: {
          ...i,
          patientId: actor.id,
          preferredStart: i.preferredStart ? new Date(i.preferredStart) : null,
          preferredEnd: i.preferredEnd ? new Date(i.preferredEnd) : null,
        },
      });
    });
  }
  @Post('waitlist/:id/leave') leave(@CurrentUser() actor: Actor, @Param('id') id: string) {
    return this.db.waitlistEntry.updateMany({
      where: { id, patientId: actor.id },
      data: { status: 'CANCELLED' },
    });
  }
  @Get('analytics/clinic/:id/summary') async summary(
    @CurrentUser() actor: Actor,
    @Param('id') clinicId: string,
  ) {
    requireRole(actor, clinicId, ['CLINIC_ADMIN', 'DOCTOR']);
    const doctor =
      actor.roles.some((r) => r.clinicId === clinicId && r.role === 'DOCTOR') &&
      !actor.roles.some((r) => r.clinicId === clinicId && r.role === 'CLINIC_ADMIN');
    const appointments = await this.db.appointment.findMany({
      where: { clinicId, ...(doctor ? { doctorId: actor.id } : {}) },
      include: { payment: true },
    });
    const completed = appointments.filter((a) => a.status === 'COMPLETED').length;
    const noShow = appointments.filter((a) => a.status === 'NO_SHOW').length;
    const checked = appointments.filter((a) => a.checkedInAt);
    const revenue = appointments.reduce(
      (sum, a) =>
        sum +
        (a.payment && ['SUCCEEDED', 'REFUND_PENDING', 'REFUNDED'].includes(a.payment.status)
          ? a.payment.amountMinor - a.payment.refundMinor
          : 0),
      0,
    );
    const byDay = Array.from({ length: 7 }, (_, index) => {
      const d = new Date(Date.now() - (6 - index) * 86400000);
      const date = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Dhaka',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(d);
      return {
        date,
        count: appointments.filter(
          (a) =>
            new Intl.DateTimeFormat('en-CA', {
              timeZone: 'Asia/Dhaka',
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
            }).format(a.startAt) === date,
        ).length,
      };
    });
    return {
      total: appointments.length,
      completed,
      noShow,
      revenueMinor: revenue,
      noShowRate: appointments.length ? (noShow / appointments.length) * 100 : 0,
      averageWaitMinutes: checked.length
        ? checked.reduce(
            (s, a) => s + Math.max(0, (a.checkedInAt!.getTime() - a.startAt.getTime()) / 60000),
            0,
          ) / checked.length
        : 0,
      byDay,
      completionRate: appointments.length ? (completed / appointments.length) * 100 : 0,
    };
  }
  @Get('audit') audit(@CurrentUser() actor: Actor, @Query('clinicId') clinicId: string) {
    requireRole(actor, clinicId, ['CLINIC_ADMIN']);
    return this.db.auditLog.findMany({
      where: { clinicId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }
}
