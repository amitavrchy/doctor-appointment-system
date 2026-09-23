import { notify } from './outbox';
import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { z } from 'zod';
import { DateTime } from 'luxon';
import { PrismaService } from '../common/prisma.service';
import { Actor, AuthGuard, CurrentUser, requireRole, hasRole } from '../common/access';
import { parse, id } from '../common/validation';
import { lockDoctors } from '../common/locks/pg-advisory.lock';
import { appointmentInclude } from './appointments.service';
import { RealtimeGateway } from './realtime.gateway';
@Controller('queue')
@UseGuards(AuthGuard)
export class QueueController {
  constructor(
    private db: PrismaService,
    private realtime: RealtimeGateway,
  ) {}
  @Get('clinic/:id') async list(
    @CurrentUser() actor: Actor,
    @Param('id') clinicId: string,
    @Query('doctorId') doctorId?: string,
  ) {
    requireRole(actor, clinicId, ['CLINIC_ADMIN', 'DOCTOR', 'RECEPTIONIST', 'NURSE']);
    const clinic = await this.db.clinic.findUniqueOrThrow({ where: { id: clinicId } }),
      today = DateTime.now().setZone(clinic.timezone).toISODate()!;
    const restricted = !hasRole(actor, clinicId, ['CLINIC_ADMIN', 'RECEPTIONIST', 'NURSE']);
    const appointments = await this.db.appointment.findMany({
      where: {
        clinicId,
        queueDate: today,
        ...(restricted ? { doctorId: actor.id } : doctorId ? { doctorId } : {}),
        status: { in: ['CHECKED_IN', 'IN_PROGRESS', 'COMPLETED'] },
      },
      include: appointmentInclude,
      orderBy: [{ priority: 'desc' }, { startAt: 'asc' }, { checkedInAt: 'asc' }],
    });
    const waiting = appointments.filter((a) => a.status === 'CHECKED_IN'),
      live = appointments.filter((a) => a.status === 'IN_PROGRESS'),
      completed = appointments.filter((a) => a.status === 'COMPLETED');
    const waits = appointments
      .filter((a) => a.startedAt && a.checkedInAt)
      .map((a) => Math.max(0, (a.startedAt!.getTime() - a.checkedInAt!.getTime()) / 60000));
    return {
      date: today,
      waiting,
      live,
      completed,
      averageWaitMinutes: waits.length ? waits.reduce((a, b) => a + b, 0) / waits.length : 0,
      longestWaitMinutes: waiting.length
        ? Math.max(...waiting.map((a) => (Date.now() - a.checkedInAt!.getTime()) / 60000))
        : 0,
    };
  }
  @Get('mine') async mine(@CurrentUser() actor: Actor) {
    const own = await this.db.appointment.findMany({
      where: { patientId: actor.id, status: { in: ['CHECKED_IN', 'IN_PROGRESS'] } },
      include: { clinic: true },
    });
    return Promise.all(
      own.map(async (a) => {
        const queue = await this.db.appointment.findMany({
          where: {
            doctorId: a.doctorId,
            clinicId: a.clinicId,
            queueDate: a.queueDate,
            status: 'CHECKED_IN',
          },
          select: { id: true },
          orderBy: [{ priority: 'desc' }, { startAt: 'asc' }, { checkedInAt: 'asc' }],
        });
        return {
          appointmentId: a.id,
          clinic: a.clinic.name,
          number: a.queueNumber,
          status: a.status,
          position: a.status === 'IN_PROGRESS' ? 0 : queue.findIndex((q) => q.id === a.id) + 1,
        };
      }),
    );
  }
  @Patch(':id/priority') async priority(
    @CurrentUser() actor: Actor,
    @Param('id') appointmentId: string,
    @Body() body: unknown,
  ) {
    const { priority } = parse(z.object({ priority: z.number().int().min(0).max(2) }), body);
    const a = await this.db.appointment.findUniqueOrThrow({ where: { id: appointmentId } });
    requireRole(actor, a.clinicId, ['DOCTOR', 'NURSE', 'CLINIC_ADMIN']);
    if (a.status !== 'CHECKED_IN')
      throw new ConflictException('Only waiting patients can be reprioritized');
    if (actor.id !== a.doctorId && !hasRole(actor, a.clinicId, ['CLINIC_ADMIN', 'NURSE']))
      throw new ForbiddenException('Treating doctor required');
    const result = await this.db.appointment.update({ where: { id: a.id }, data: { priority } });
    await this.db.auditLog.create({
      data: {
        actorId: actor.id,
        clinicId: a.clinicId,
        action: 'QUEUE_PRIORITY_UPDATED',
        entity: 'Appointment',
        entityId: a.id,
      },
    });
    this.realtime.appointmentUpdated(result);
    void this.realtime.refreshQueue?.(result.doctorId, result.clinicId);
    return result;
  }
  @Post('call-next') async next(@CurrentUser() actor: Actor, @Body() body: unknown) {
    const i = parse(z.object({ clinicId: id, doctorId: id }), body);
    if (i.doctorId !== actor.id)
      throw new ForbiddenException('Only the treating doctor can call the next patient');
    requireRole(actor, i.clinicId, ['DOCTOR']);
    const result = await this.db.$transaction(async (tx) => {
      await lockDoctors(tx, i.doctorId);
      if (await tx.appointment.count({ where: { doctorId: i.doctorId, status: 'IN_PROGRESS' } }))
        throw new ConflictException(
          'Complete the current consultation before calling another patient',
        );
      const clinic = await tx.clinic.findUniqueOrThrow({ where: { id: i.clinicId } });
      const queueDate = DateTime.now().setZone(clinic.timezone).toISODate()!;
      const next = await tx.appointment.findFirst({
        where: { clinicId: i.clinicId, doctorId: i.doctorId, queueDate, status: 'CHECKED_IN' },
        orderBy: [{ priority: 'desc' }, { startAt: 'asc' }, { checkedInAt: 'asc' }],
      });
      if (!next) throw new ConflictException('No patients are waiting');
      const a = await tx.appointment.update({
        where: { id: next.id },
        data: { status: 'IN_PROGRESS', startedAt: new Date() },
        include: appointmentInclude,
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          clinicId: i.clinicId,
          action: 'QUEUE_PATIENT_CALLED',
          entity: 'Appointment',
          entityId: a.id,
        },
      });
      await notify(
        tx,
        a.patientId,
        'Your doctor is ready',
        'Please proceed to your consultation room.',
        a.clinicId,
      );
      return a;
    });
    this.realtime.appointmentUpdated(result);
    void this.realtime.refreshQueue?.(result.doctorId, result.clinicId);
    return result;
  }
}
