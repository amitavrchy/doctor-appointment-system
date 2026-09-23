import { Injectable, BadRequestException } from '@nestjs/common';
import { Prisma, AppointmentStatus } from '@prisma/client';
import { DateTime } from 'luxon';
import { PrismaService } from '../common/prisma.service';
import { generateSlots } from './schedule.engine';
import { activeStatuses } from '../common/domain';
import { overlaps } from '../common/domain';
type DB = PrismaService | Prisma.TransactionClient;
@Injectable()
export class SchedulesService {
  constructor(private db: PrismaService) {}
  async slots(
    doctorId: string,
    clinicId: string,
    from: string,
    to: string,
    type?: string,
    tx: DB = this.db,
    ignoreHoldId?: string,
  ) {
    const clinic = await tx.clinic.findFirst({ where: { id: clinicId, active: true } });
    if (!clinic) throw new BadRequestException('Clinic not found');
    if (
      !(await tx.doctorClinic.findFirst({
        where: { doctorId, clinicId, doctor: { user: { deletedAt: null } } },
      }))
    )
      throw new BadRequestException('Doctor is not available at this clinic');
    const start = DateTime.fromISO(from, { zone: clinic.timezone }).startOf('day');
    const end = DateTime.fromISO(to, { zone: clinic.timezone }).endOf('day');
    if (!start.isValid || !end.isValid || end < start || end.diff(start, 'days').days > 31)
      throw new BadRequestException('Choose a date range of up to 31 days');
    const [rules, exceptions, appointments, holds] = await Promise.all([
      tx.doctorScheduleRule.findMany({
        where: { doctorId, clinicId, active: true, ...(type ? { consultationType: type } : {}) },
      }),
      tx.scheduleException.findMany({ where: { doctorId, clinicId } }),
      tx.appointment.findMany({
        where: {
          doctorId,
          status: { in: [...activeStatuses] as AppointmentStatus[] },
          startAt: { lt: end.toJSDate() },
          endAt: { gt: start.toJSDate() },
        },
      }),
      tx.slotHold.findMany({
        where: {
          doctorId,
          expiresAt: { gt: new Date() },
          ...(ignoreHoldId ? { id: { not: ignoreHoldId } } : {}),
          startAt: { lt: end.toJSDate() },
          endAt: { gt: start.toJSDate() },
        },
      }),
    ]);
    const roomIds = [...new Set(rules.flatMap((r) => (r.roomId ? [r.roomId] : [])))];
    const roomBusy = roomIds.length
      ? await tx.appointment.findMany({
          where: {
            roomId: { in: roomIds },
            doctorId: { not: doctorId },
            status: { in: [...activeStatuses] as AppointmentStatus[] },
            startAt: { lt: end.toJSDate() },
            endAt: { gt: start.toJSDate() },
          },
        })
      : [];
    const roomHolds = roomIds.length
      ? await tx.slotHold.findMany({
          where: {
            roomId: { in: roomIds },
            doctorId: { not: doctorId },
            expiresAt: { gt: new Date() },
            startAt: { lt: end.toJSDate() },
            endAt: { gt: start.toJSDate() },
          },
        })
      : [];
    return generateSlots(
      rules,
      exceptions,
      [...appointments, ...holds],
      from,
      to,
      clinic.timezone,
    ).map((s) => ({
      ...s,
      available:
        s.available &&
        ![...roomBusy, ...roomHolds].some(
          (b) => s.roomId && b.roomId === s.roomId && overlaps(s, b),
        ),
    }));
  }
}
