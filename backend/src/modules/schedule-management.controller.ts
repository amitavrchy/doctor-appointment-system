import {
  Body,
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { DateTime } from 'luxon';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { Actor, AuthGuard, CurrentUser, requireRole } from '../common/access';
import { parse, id, iso, kind } from '../common/validation';
import { lockDoctors } from '../common/locks/pg-advisory.lock';
import { parseRecurrence, recurrenceDates } from './recurrence';
import { generateSlots } from './schedule.engine';
const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const recurrence = z
  .string()
  .max(500)
  .refine((value) => {
    try {
      parseRecurrence(value, new Date(), 'UTC');
      return true;
    } catch {
      return false;
    }
  }, 'Use a valid DAILY, WEEKLY, or MONTHLY RRULE');
const ruleSchema = z
  .object({
    doctorId: id,
    clinicId: id,
    rrule: recurrence,
    startTimeLocal: time,
    endTimeLocal: time,
    slotDurationMinutes: z.number().int().min(5).max(180),
    bufferMinutes: z.number().int().min(0).max(60),
    effectiveFrom: iso,
    effectiveTo: iso.nullable().optional(),
    consultationType: kind,
    feeMinor: z.number().int().min(0).max(100000000),
    roomId: id.nullable().optional(),
  })
  .refine((i) => i.endTimeLocal > i.startTimeLocal, 'End must follow start')
  .refine(
    (i) => !i.effectiveTo || new Date(i.effectiveTo) >= new Date(i.effectiveFrom),
    'Effective end must follow start',
  );
type Tx = Prisma.TransactionClient;
class SchedulePreview extends Error {
  constructor(readonly conflicts: Awaited<ReturnType<typeof affected>>) {
    super('Schedule impact preview');
  }
}
async function affected(tx: Tx, doctorId: string, clinicId: string) {
  const [clinic, rules, exceptions, appointments] = await Promise.all([
    tx.clinic.findUniqueOrThrow({ where: { id: clinicId } }),
    tx.doctorScheduleRule.findMany({ where: { doctorId, clinicId, active: true } }),
    tx.scheduleException.findMany({ where: { doctorId, clinicId } }),
    tx.appointment.findMany({
      where: {
        doctorId,
        clinicId,
        startAt: { gt: new Date() },
        status: { in: ['HELD', 'PENDING_PAYMENT', 'CONFIRMED', 'CHECKED_IN', 'IN_PROGRESS'] },
      },
      take: 500,
      include: { patient: { select: { fullName: true } } },
    }),
  ]);
  return appointments.filter((a) => {
    const day = DateTime.fromJSDate(a.startAt).setZone(clinic.timezone).toISODate()!;
    return !generateSlots(rules, exceptions, [], day, day, clinic.timezone, new Date(0)).some(
      (s) =>
        s.startAt.getTime() === a.startAt.getTime() &&
        s.endAt.getTime() === a.endAt.getTime() &&
        s.type === a.type &&
        (!a.roomId || s.roomId === a.roomId),
    );
  });
}
async function flag(tx: Tx, actor: Actor, doctorId: string, clinicId: string, sourceId: string) {
  const conflicts = await affected(tx, doctorId, clinicId);
  for (const a of conflicts)
    await tx.appointmentConflict.upsert({
      where: { appointmentId_sourceId: { appointmentId: a.id, sourceId } },
      create: {
        appointmentId: a.id,
        sourceId,
        reason: 'Schedule change no longer covers this booked consultation',
      },
      update: { status: 'OPEN', resolvedAt: null, resolvedBy: null },
    });
  await tx.appointmentConflict.updateMany({
    where: { sourceId, status: 'OPEN', appointmentId: { notIn: conflicts.map((a) => a.id) } },
    data: { status: 'RESOLVED', resolvedBy: actor.id, resolvedAt: new Date() },
  });
  return conflicts;
}
@Controller('schedules')
@UseGuards(AuthGuard)
export class ScheduleManagementController {
  constructor(private db: PrismaService) {}
  @Post('preview') async preview(@CurrentUser() actor: Actor, @Body() body: unknown) {
    const input = parse(z.object({ ruleId: id.optional(), rule: z.unknown() }), body),
      i = parse(ruleSchema, input.rule);
    await this.authorize(actor, i.doctorId, i.clinicId, i.roomId);
    try {
      await this.db.$transaction(
        async (tx) => {
          await lockDoctors(tx, i.doctorId);
          if (input.ruleId) {
            const existing = await tx.doctorScheduleRule.findUniqueOrThrow({
              where: { id: input.ruleId },
            });
            if (existing.doctorId !== i.doctorId || existing.clinicId !== i.clinicId)
              throw new BadRequestException('Schedule ownership does not match');
            await tx.doctorScheduleRule.update({
              where: { id: input.ruleId },
              data: {
                ...i,
                effectiveFrom: new Date(i.effectiveFrom),
                effectiveTo: i.effectiveTo ? new Date(i.effectiveTo) : null,
              },
            });
          } else
            await tx.doctorScheduleRule.create({
              data: {
                ...i,
                effectiveFrom: new Date(i.effectiveFrom),
                effectiveTo: i.effectiveTo ? new Date(i.effectiveTo) : null,
              },
            });
          throw new SchedulePreview(await affected(tx, i.doctorId, i.clinicId));
        },
        { timeout: 15000 },
      );
    } catch (error) {
      if (error instanceof SchedulePreview) return { conflicts: error.conflicts };
      throw error;
    }
  }
  @Post('rules/:id/restore') async restore(
    @CurrentUser() actor: Actor,
    @Param('id') ruleId: string,
  ) {
    const r = await this.db.doctorScheduleRule.findUniqueOrThrow({ where: { id: ruleId } });
    await this.authorize(actor, r.doctorId, r.clinicId);
    return this.db.$transaction(async (tx) => {
      await lockDoctors(tx, r.doctorId);
      const rule = await tx.doctorScheduleRule.update({
        where: { id: ruleId },
        data: { active: true },
      });
      const conflicts = await flag(tx, actor, r.doctorId, r.clinicId, ruleId);
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          clinicId: r.clinicId,
          action: 'SCHEDULE_RULE_RESTORED',
          entity: 'DoctorScheduleRule',
          entityId: ruleId,
        },
      });
      return { rule, conflicts };
    });
  }
  private async authorize(
    actor: Actor,
    doctorId: string,
    clinicId: string,
    roomId?: string | null,
  ) {
    requireRole(
      actor,
      clinicId,
      actor.id === doctorId ? ['DOCTOR', 'CLINIC_ADMIN'] : ['CLINIC_ADMIN'],
    );
    if (
      !(await this.db.doctorClinic.findUnique({
        where: { doctorId_clinicId: { doctorId, clinicId } },
      }))
    )
      throw new BadRequestException('Doctor is not assigned to this clinic');
    if (
      roomId &&
      !(await this.db.room.findFirst({ where: { id: roomId, clinicId, active: true } }))
    )
      throw new BadRequestException('Choose an active room in this clinic');
  }
  @Post('advanced/rules') async create(@CurrentUser() actor: Actor, @Body() body: unknown) {
    const i = parse(ruleSchema, body);
    await this.authorize(actor, i.doctorId, i.clinicId, i.roomId);
    return this.db.$transaction(async (tx) => {
      await lockDoctors(tx, i.doctorId);
      const rule = await tx.doctorScheduleRule.create({
        data: {
          ...i,
          effectiveFrom: new Date(i.effectiveFrom),
          effectiveTo: i.effectiveTo ? new Date(i.effectiveTo) : null,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          clinicId: i.clinicId,
          action: 'SCHEDULE_RULE_CREATED',
          entity: 'DoctorScheduleRule',
          entityId: rule.id,
        },
      });
      return { rule, conflicts: await flag(tx, actor, i.doctorId, i.clinicId, rule.id) };
    });
  }
  @Patch('rules/:id') async update(
    @CurrentUser() actor: Actor,
    @Param('id') ruleId: string,
    @Body() body: unknown,
  ) {
    const existing = await this.db.doctorScheduleRule.findUniqueOrThrow({ where: { id: ruleId } });
    const i = parse(ruleSchema, body);
    if (existing.doctorId !== i.doctorId || existing.clinicId !== i.clinicId)
      throw new BadRequestException('A schedule cannot be moved between doctors or clinics');
    await this.authorize(actor, i.doctorId, i.clinicId, i.roomId);
    return this.db.$transaction(async (tx) => {
      await lockDoctors(tx, i.doctorId);
      const rule = await tx.doctorScheduleRule.update({
        where: { id: ruleId },
        data: {
          ...i,
          effectiveFrom: new Date(i.effectiveFrom),
          effectiveTo: i.effectiveTo ? new Date(i.effectiveTo) : null,
        },
      });
      const conflicts = await flag(tx, actor, i.doctorId, i.clinicId, ruleId);
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          clinicId: i.clinicId,
          action: 'SCHEDULE_RULE_UPDATED',
          entity: 'DoctorScheduleRule',
          entityId: rule.id,
        },
      });
      return { rule, conflicts };
    });
  }
  @Delete('rules/:id') async remove(@CurrentUser() actor: Actor, @Param('id') ruleId: string) {
    const rule = await this.db.doctorScheduleRule.findUniqueOrThrow({ where: { id: ruleId } });
    await this.authorize(actor, rule.doctorId, rule.clinicId);
    return this.db.$transaction(async (tx) => {
      await lockDoctors(tx, rule.doctorId);
      await tx.doctorScheduleRule.update({ where: { id: ruleId }, data: { active: false } });
      const conflicts = await flag(tx, actor, rule.doctorId, rule.clinicId, ruleId);
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          clinicId: rule.clinicId,
          action: 'SCHEDULE_RULE_ARCHIVED',
          entity: 'DoctorScheduleRule',
          entityId: ruleId,
        },
      });
      return { conflicts };
    });
  }
  @Post('blocks') async block(@CurrentUser() actor: Actor, @Body() body: unknown) {
    const i = parse(
      z
        .object({
          doctorId: id,
          clinicId: id,
          dateLocal: z.iso.date(),
          type: z.enum(['DAY_OFF', 'CUSTOM_HOURS', 'BLOCK']),
          startTimeLocal: time.optional(),
          endTimeLocal: time.optional(),
          reason: z.string().max(500).optional(),
          rrule: recurrence.optional(),
          until: z.iso.date().optional(),
        })
        .refine(
          (i) =>
            i.type === 'DAY_OFF' ||
            !!(i.startTimeLocal && i.endTimeLocal && i.endTimeLocal > i.startTimeLocal),
          'Provide valid hours',
        ),
      body,
    );
    await this.authorize(actor, i.doctorId, i.clinicId);
    if (
      i.rrule &&
      (!i.until || DateTime.fromISO(i.until).diff(DateTime.fromISO(i.dateLocal), 'days').days > 365)
    )
      throw new BadRequestException('Recurring blocks require an end within one year');
    const dates = i.rrule
      ? Array.from(recurrenceDates(i.rrule, new Date(i.dateLocal), i.dateLocal, i.until!, 'UTC'))
      : [i.dateLocal];
    if (!dates.length) throw new BadRequestException('The recurrence does not match any dates');
    const seriesId = i.rrule ? randomUUID() : null;
    return this.db.$transaction(
      async (tx) => {
        await lockDoctors(tx, i.doctorId);
        const records = [];
        for (const date of dates)
          records.push(
            await tx.scheduleException.create({
              data: {
                doctorId: i.doctorId,
                clinicId: i.clinicId,
                dateLocal: new Date(date),
                type: i.type,
                startTimeLocal: i.startTimeLocal,
                endTimeLocal: i.endTimeLocal,
                reason: i.reason,
                seriesId,
              },
            }),
          );
        const conflicts = await flag(tx, actor, i.doctorId, i.clinicId, seriesId || records[0].id);
        await tx.auditLog.create({
          data: {
            actorId: actor.id,
            clinicId: i.clinicId,
            action: 'SCHEDULE_BLOCK_CREATED',
            entity: 'ScheduleException',
            entityId: seriesId || records[0].id,
          },
        });
        return { records, conflicts };
      },
      { timeout: 15000 },
    );
  }
  @Delete('exceptions/:id') async removeBlock(
    @CurrentUser() actor: Actor,
    @Param('id') exceptionId: string,
    @Query('scope') scope = 'this_only',
  ) {
    const e = await this.db.scheduleException.findUniqueOrThrow({ where: { id: exceptionId } });
    await this.authorize(actor, e.doctorId, e.clinicId);
    if (!['this_only', 'this_and_future'].includes(scope))
      throw new BadRequestException('Choose this_only or this_and_future');
    return this.db.$transaction(async (tx) => {
      await lockDoctors(tx, e.doctorId);
      await tx.scheduleException.deleteMany({
        where:
          e.seriesId && scope === 'this_and_future'
            ? { seriesId: e.seriesId, dateLocal: { gte: e.dateLocal } }
            : { id: e.id },
      });
      await flag(tx, actor, e.doctorId, e.clinicId, e.seriesId || e.id);
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          clinicId: e.clinicId,
          action: 'SCHEDULE_BLOCK_REMOVED',
          entity: 'ScheduleException',
          entityId: e.id,
        },
      });
      return { ok: true };
    });
  }
  @Get('conflicts') async conflicts(
    @CurrentUser() actor: Actor,
    @Query('clinicId') clinicId: string,
  ) {
    requireRole(actor, clinicId, ['CLINIC_ADMIN', 'DOCTOR']);
    return this.db.appointmentConflict.findMany({
      where: {
        status: 'OPEN',
        appointment: {
          clinicId,
          ...(!actor.roles.some((r) => r.clinicId === clinicId && r.role === 'CLINIC_ADMIN') &&
          actor.globalRole !== 'SUPER_ADMIN'
            ? { doctorId: actor.id }
            : {}),
        },
      },
      include: {
        appointment: {
          include: {
            patient: { select: { fullName: true } },
            doctor: { include: { user: { select: { fullName: true } } } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
  @Post('conflicts/:id/resolve') async resolve(
    @CurrentUser() actor: Actor,
    @Param('id') conflictId: string,
  ) {
    const c = await this.db.appointmentConflict.findUniqueOrThrow({
      where: { id: conflictId },
      include: { appointment: true },
    });
    await this.authorize(actor, c.appointment.doctorId, c.appointment.clinicId);
    return this.db.appointmentConflict.update({
      where: { id: conflictId },
      data: { status: 'RESOLVED', resolvedAt: new Date(), resolvedBy: actor.id },
    });
  }
}
