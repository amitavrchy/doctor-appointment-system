import { DateTime } from 'luxon';
import { generateSlots } from './schedule.engine';
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
    const clinic = await this.db.clinic.findUniqueOrThrow({ where: { id: clinicId } });
    const from = DateTime.now().setZone(clinic.timezone).minus({ days: 6 }).startOf('day'),
      to = from.plus({ days: 6 }).endOf('day');
    const [rules, exceptions, doctors] = await Promise.all([
      this.db.doctorScheduleRule.findMany({
        where: { clinicId, active: true, ...(doctor ? { doctorId: actor.id } : {}) },
      }),
      this.db.scheduleException.findMany({ where: { clinicId } }),
      this.db.doctorClinic.findMany({
        where: { clinicId, ...(doctor ? { doctorId: actor.id } : {}) },
        include: { doctor: { include: { user: { select: { fullName: true } } } } },
      }),
    ]);
    const unionMinutes = (windows: { startAt: Date; endAt: Date }[]) => {
      const sorted = windows
        .map((w) => [
          Math.max(w.startAt.getTime(), from.toMillis()),
          Math.min(w.endAt.getTime(), to.toMillis()),
        ])
        .filter((w) => w[1] > w[0])
        .sort((a, b) => a[0] - b[0]);
      let total = 0,
        end = 0;
      for (const w of sorted) {
        total += Math.max(0, w[1] - Math.max(w[0], end));
        end = Math.max(end, w[1]);
      }
      return total / 60000;
    };
    const utilization = doctors.map((d) => {
      const slots = generateSlots(
        rules.filter((r) => r.doctorId === d.doctorId),
        exceptions.filter((e) => e.doctorId === d.doctorId),
        [],
        from.toISODate()!,
        to.toISODate()!,
        clinic.timezone,
        new Date(0),
      );
      const scheduledMinutes = unionMinutes(slots),
        bookedMinutes = unionMinutes(
          appointments.filter(
            (a) =>
              a.doctorId === d.doctorId &&
              !['CANCELLED', 'RESCHEDULED', 'PENDING_PAYMENT'].includes(a.status),
          ),
        );
      return {
        doctorId: d.doctorId,
        name: d.doctor.user.fullName,
        scheduledMinutes,
        bookedMinutes,
        percent: scheduledMinutes ? Math.round((bookedMinutes / scheduledMinutes) * 1000) / 10 : 0,
      };
    });
    const completed = appointments.filter((a) => a.status === 'COMPLETED').length;
    const noShow = appointments.filter((a) => a.status === 'NO_SHOW').length;
    const checked = appointments.filter((a) => a.checkedInAt && a.startedAt);
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
        timeZone: clinic.timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(d);
      return {
        date,
        count: appointments.filter(
          (a) =>
            new Intl.DateTimeFormat('en-CA', {
              timeZone: clinic.timezone,
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
            }).format(a.startAt) === date,
        ).length,
      };
    });
    return {
      utilization,
      utilizationFrom: from.toISODate(),
      utilizationTo: to.toISODate(),
      total: appointments.length,
      completed,
      noShow,
      revenueMinor: revenue,
      noShowRate: appointments.length ? (noShow / appointments.length) * 100 : 0,
      averageWaitMinutes: checked.length
        ? checked.reduce(
            (s, a) => s + Math.max(0, (a.startedAt!.getTime() - a.checkedInAt!.getTime()) / 60000),
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
