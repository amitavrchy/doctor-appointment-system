import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../common/prisma.service';
import { Actor, AuthGuard, CurrentUser } from '../common/access';
import { parse } from '../common/validation';
@Controller('preferences')
@UseGuards(AuthGuard)
export class PreferencesController {
  constructor(private db: PrismaService) {}
  @Get('notifications') async get(@CurrentUser() actor: Actor) {
    return (
      (await this.db.notificationPreference.findUnique({ where: { userId: actor.id } })) || {
        userId: actor.id,
        email: true,
        sms: false,
        inApp: true,
        reminders: true,
        followUps: true,
      }
    );
  }
  @Patch('notifications') update(@CurrentUser() actor: Actor, @Body() body: unknown) {
    const i = parse(
      z.object({
        email: z.boolean(),
        sms: z.boolean(),
        inApp: z.boolean(),
        reminders: z.boolean(),
        followUps: z.boolean(),
      }),
      body,
    );
    return this.db.notificationPreference.upsert({
      where: { userId: actor.id },
      create: { ...i, userId: actor.id },
      update: i,
    });
  }
}
