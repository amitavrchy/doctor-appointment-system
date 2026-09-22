import {
  Body,
  Controller,
  Get,
  Post,
  Param,
  Query,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { z } from 'zod';
import { Actor, AuthGuard, CurrentUser, requireRole } from '../common/access';
import { id, iso, kind, parse } from '../common/validation';
import { PrismaService } from '../common/prisma.service';
import { SchedulesService } from './schedules.service';
import { lockDoctors } from '../common/locks/pg-advisory.lock';
const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
@Controller()
export class SchedulesController {
  constructor(
    private db: PrismaService,
    private schedules: SchedulesService,
  ) {}
  @Get('doctors/:id/slots') slots(@Param('id') doctorId: string, @Query() query: unknown) {
    const q = parse(
      z.object({ clinicId: id, from: z.iso.date(), to: z.iso.date(), type: kind.optional() }),
      query,
    );
    return this.schedules.slots(doctorId, q.clinicId, q.from, q.to, q.type);
  }
  @Get('schedules') @UseGuards(AuthGuard) async list(
    @CurrentUser() actor: Actor,
    @Query('clinicId') clinicId: string,
  ) {
    requireRole(actor, clinicId, ['DOCTOR', 'CLINIC_ADMIN']);
    const where = {
      clinicId,
      ...(actor.globalRole !== 'SUPER_ADMIN' &&
      !actor.roles.some((r) => r.clinicId === clinicId && r.role === 'CLINIC_ADMIN')
        ? { doctorId: actor.id }
        : {}),
    };
    return {
      rules: await this.db.doctorScheduleRule.findMany({
        where,
        include: { doctor: { include: { user: { select: { fullName: true } } } } },
      }),
      exceptions: await this.db.scheduleException.findMany({ where }),
    };
  }
  private async authorize(actor: Actor, doctorId: string, clinicId: string) {
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
      throw new BadRequestException('Doctor is not assigned to clinic');
  }
  @Post('schedules/rules') @UseGuards(AuthGuard) async rule(
    @CurrentUser() actor: Actor,
    @Body() body: unknown,
  ) {
    const i = parse(
      z
        .object({
          doctorId: id,
          clinicId: id,
          rrule: z
            .string()
            .regex(/^FREQ=WEEKLY;BYDAY=(MO|TU|WE|TH|FR|SA|SU)(,(MO|TU|WE|TH|FR|SA|SU))*$/),
          startTimeLocal: time,
          endTimeLocal: time,
          slotDurationMinutes: z.number().int().min(5).max(180),
          bufferMinutes: z.number().int().min(0).max(60),
          effectiveFrom: iso,
          effectiveTo: iso.optional(),
          consultationType: kind,
          feeMinor: z.number().int().min(0).max(100000000),
        })
        .refine((i) => i.endTimeLocal > i.startTimeLocal, 'End time must follow start time'),
      body,
    );
    await this.authorize(actor, i.doctorId, i.clinicId);
    return this.db.$transaction(async (tx) => {
      await lockDoctors(tx, i.doctorId);
      return tx.doctorScheduleRule.create({
        data: {
          ...i,
          effectiveFrom: new Date(i.effectiveFrom),
          effectiveTo: i.effectiveTo ? new Date(i.effectiveTo) : null,
        },
      });
    });
  }
  @Post('schedules/exceptions') @UseGuards(AuthGuard) async exception(
    @CurrentUser() actor: Actor,
    @Body() body: unknown,
  ) {
    const i = parse(
      z
        .object({
          doctorId: id,
          clinicId: id,
          dateLocal: z.iso.date(),
          type: z.enum(['DAY_OFF', 'CUSTOM_HOURS', 'BLOCK']),
          startTimeLocal: time.optional(),
          endTimeLocal: time.optional(),
          reason: z.string().max(200).optional(),
        })
        .refine(
          (i) =>
            i.type === 'DAY_OFF' ||
            !!(i.startTimeLocal && i.endTimeLocal && i.endTimeLocal > i.startTimeLocal),
          'Valid hours are required',
        ),
      body,
    );
    await this.authorize(actor, i.doctorId, i.clinicId);
    return this.db.$transaction(async (tx) => {
      await lockDoctors(tx, i.doctorId);
      const exception = await tx.scheduleException.create({
        data: { ...i, dateLocal: new Date(i.dateLocal) },
      });
      const conflicts = await tx.appointment.count({
        where: {
          doctorId: i.doctorId,
          clinicId: i.clinicId,
          startAt: {
            gte: new Date(`${i.dateLocal}T00:00:00+06:00`),
            lt: new Date(new Date(`${i.dateLocal}T00:00:00+06:00`).getTime() + 86400000),
          },
          status: { in: ['CONFIRMED', 'CHECKED_IN', 'IN_PROGRESS'] },
        },
      });
      return {
        exception,
        conflicts,
        message: conflicts
          ? 'Existing bookings were retained. Review affected appointments.'
          : 'Schedule updated',
      };
    });
  }
}
