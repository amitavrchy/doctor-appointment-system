import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Post,
  Query,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { z } from 'zod';
import { AppointmentsService } from './appointments.service';
import { Actor, AuthGuard, CurrentUser } from '../common/access';
import { id, iso, kind, parse } from '../common/validation';
@Controller('appointments')
@UseGuards(AuthGuard)
export class AppointmentsController {
  constructor(private appointments: AppointmentsService) {}
  private key(value: string) {
    if (!value || value.length < 8 || value.length > 100)
      throw new BadRequestException('An idempotency-key header of 8–100 characters is required');
    return value;
  }
  @Post('holds') hold(@CurrentUser() actor: Actor, @Body() body: unknown) {
    return this.appointments.hold(
      actor,
      parse(
        z.object({
          doctorId: id,
          clinicId: id,
          startAt: iso,
          type: kind,
          patientId: id.optional(),
        }),
        body,
      ),
    );
  }
  @Delete('holds/:id') release(@CurrentUser() actor: Actor, @Param('id') id: string) {
    return this.appointments.release(actor, id);
  }
  @Post() confirm(
    @CurrentUser() actor: Actor,
    @Headers('idempotency-key') key: string,
    @Body() body: unknown,
  ) {
    const i = parse(z.object({ holdId: id, reason: z.string().max(1000).optional() }), body);
    return this.appointments.confirm(actor, i.holdId, this.key(key), i.reason);
  }
  @Get() list(@CurrentUser() actor: Actor, @Query('clinicId') clinicId?: string) {
    return this.appointments.list(actor, clinicId);
  }
  @Get(':id') get(@CurrentUser() actor: Actor, @Param('id') id: string) {
    return this.appointments.get(actor, id);
  }
  @Post(':id/cancel') cancel(
    @CurrentUser() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const i = parse(z.object({ reason: z.string().max(500).optional() }), body || {});
    return this.appointments.transition(actor, id, 'CANCELLED', i.reason);
  }
  @Post(':id/reschedule') reschedule(
    @CurrentUser() actor: Actor,
    @Param('id') appointmentId: string,
    @Headers('idempotency-key') key: string,
    @Body() body: unknown,
  ) {
    const i = parse(z.object({ holdId: id }), body);
    return this.appointments.confirm(actor, i.holdId, this.key(key), undefined, appointmentId);
  }
  @Post(':id/check-in') checkIn(@CurrentUser() actor: Actor, @Param('id') id: string) {
    return this.appointments.transition(actor, id, 'CHECKED_IN');
  }
  @Post(':id/start') start(@CurrentUser() actor: Actor, @Param('id') id: string) {
    return this.appointments.transition(actor, id, 'IN_PROGRESS');
  }
  @Post(':id/complete') complete(@CurrentUser() actor: Actor, @Param('id') id: string) {
    return this.appointments.transition(actor, id, 'COMPLETED');
  }
}
