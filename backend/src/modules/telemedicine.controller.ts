import {
  Body,
  Controller,
  Get,
  Post,
  Param,
  UseGuards,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { z } from 'zod';
import { AccessToken } from 'livekit-server-sdk';
import { Actor, AuthGuard, CurrentUser } from '../common/access';
import { parse } from '../common/validation';
import { PrismaService } from '../common/prisma.service';
import { AppointmentsService } from './appointments.service';
import { assertTransition } from '../common/domain';
import { RealtimeGateway } from './realtime.gateway';
import { lockDoctors } from '../common/locks/pg-advisory.lock';
@Controller('telemedicine')
@UseGuards(AuthGuard)
export class TelemedicineController {
  constructor(
    private db: PrismaService,
    private appointments: AppointmentsService,
    private realtime: RealtimeGateway,
  ) {}
  private async session(actor: Actor, appointmentId: string) {
    const a = await this.appointments.get(actor, appointmentId);
    if (actor.id !== a.patientId && actor.id !== a.doctorId)
      throw new ForbiddenException('Only the patient and doctor can join');
    if (
      !a.teleSession ||
      ['PENDING_PAYMENT', 'COMPLETED', 'CANCELLED', 'RESCHEDULED', 'NO_SHOW'].includes(a.status)
    )
      throw new ConflictException('No active telemedicine session');
    return a;
  }
  @Get(':id') async get(@CurrentUser() actor: Actor, @Param('id') id: string) {
    return (await this.session(actor, id)).teleSession;
  }
  @Get(':id/messages') async messages(@CurrentUser() actor: Actor, @Param('id') id: string) {
    await this.session(actor, id);
    const messages = await this.db.consultationMessage.findMany({
      where: { appointmentId: id },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return messages.reverse();
  }
  @Post(':id/messages') async message(
    @CurrentUser() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const { text } = parse(z.object({ text: z.string().trim().min(1).max(2000) }), body);
    const a = await this.session(actor, id);
    if (
      a.startAt.getTime() - Date.now() > 15 * 60000 ||
      Date.now() > a.endAt.getTime() + 60 * 60000
    )
      throw new ConflictException('Chat opens with your consultation room');
    const message = await this.db.$transaction(async (tx) => {
      await lockDoctors(tx, a.doctorId);
      const current = await tx.appointment.findUniqueOrThrow({
        where: { id },
        include: { teleSession: true },
      });
      if (
        !['CONFIRMED', 'CHECKED_IN', 'IN_PROGRESS'].includes(current.status) ||
        !['WAITING', 'LIVE'].includes(current.teleSession?.status || '')
      )
        throw new ConflictException('Open the waiting room before sending a message');
      return tx.consultationMessage.create({
        data: { appointmentId: id, authorId: actor.id, text },
      });
    });
    this.realtime.message(a.patientId, a.doctorId, id);
    return message;
  }
  @Post(':id/token') async token(
    @CurrentUser() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const { recordingConsent } = parse(
      z.object({ recordingConsent: z.boolean().default(false) }),
      body || {},
    );
    const a = await this.session(actor, id);
    const session = a.teleSession!;
    if (
      a.startAt.getTime() - Date.now() > 15 * 60000 ||
      Date.now() > a.endAt.getTime() + 60 * 60000
    )
      throw new ConflictException(
        'The room opens 15 minutes before your appointment and closes one hour after it ends',
      );
    if (['ENDED', 'CANCELLED'].includes(session.status))
      throw new ConflictException('Session has ended');
    if (actor.id === a.patientId) {
      await this.db.telemedicineSession.updateMany({
        where: { id: session.id, status: 'SCHEDULED' },
        data: { status: 'WAITING', recordingConsent },
      });
      this.realtime.teleUpdated(a.patientId, a.doctorId, 'WAITING');
    }
    if (session.provider === 'demo')
      return {
        provider: 'demo',
        status: session.status,
        roomName: session.roomName,
        message: 'Demo waiting room. Video requires a configured LiveKit server.',
      };
    if (
      session.provider !== 'livekit' ||
      !process.env.LIVEKIT_API_KEY ||
      !process.env.LIVEKIT_API_SECRET ||
      !process.env.LIVEKIT_URL
    )
      throw new ConflictException('Video provider is not configured');
    if (actor.id === a.patientId && session.status !== 'LIVE')
      return {
        provider: 'livekit',
        status: 'WAITING',
        message: 'Your doctor will admit you shortly',
      };
    const token = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, {
      identity: actor.id,
      name: actor.fullName,
      ttl: 900,
    });
    token.addGrant({
      room: session.roomName,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
    });
    return {
      provider: 'livekit',
      token: await token.toJwt(),
      url: process.env.LIVEKIT_URL,
      status: session.status,
    };
  }
  @Post(':id/transition') async transition(
    @CurrentUser() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const { status } = parse(
      z.object({ status: z.enum(['WAITING', 'LIVE', 'ENDED', 'CANCELLED']) }),
      body,
    );
    const a = await this.session(actor, id);
    if (actor.id !== a.doctorId)
      throw new ForbiddenException('Only your doctor can admit or end the session');
    assertTransition('telemedicine', a.teleSession!.status, status);
    const result = await this.db.telemedicineSession.updateMany({
      where: { id: a.teleSession!.id, status: a.teleSession!.status },
      data: {
        status,
        ...(status === 'LIVE' ? { startedAt: new Date() } : {}),
        ...(status === 'ENDED' ? { endedAt: new Date() } : {}),
      },
    });
    if (!result.count) throw new ConflictException('Session state changed');
    this.realtime.teleUpdated(a.patientId, a.doctorId, status);
    return { status };
  }
}
