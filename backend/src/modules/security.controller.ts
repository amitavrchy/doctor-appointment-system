import {
  Body,
  Controller,
  Get,
  Post,
  Delete,
  Param,
  UseGuards,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { z } from 'zod';
import { hash, verify, argon2id } from 'argon2';
import { PrismaService } from '../common/prisma.service';
import { Actor, AuthGuard, CurrentUser } from '../common/access';
import { parse, id, iso } from '../common/validation';
import { AuthService } from './auth.service';
import { RealtimeGateway } from './realtime.gateway';
@Controller()
export class SecurityController {
  constructor(
    private db: PrismaService,
    private auth: AuthService,
    private realtime: RealtimeGateway,
  ) {}
  @Post('auth/phone/request') @UseGuards(AuthGuard) request(
    @CurrentUser() actor: Actor,
    @Body() body: unknown,
  ) {
    const { phone } = parse(z.object({ phone: z.string().regex(/^\+[1-9]\d{6,14}$/) }), body);
    return this.auth.requestOtp('', phone, 'VERIFY_PHONE', actor.id);
  }
  @Post('auth/phone/verify') @UseGuards(AuthGuard) async phone(
    @CurrentUser() actor: Actor,
    @Body() body: unknown,
  ) {
    const i = parse(z.object({ challengeId: id, code: z.string().regex(/^\d{6}$/) }), body);
    const { challenge } = await this.auth.consumeOtp(
      i.challengeId,
      i.code,
      'VERIFY_PHONE',
      actor.id,
    );
    try {
      await this.db.$transaction(async (tx) => {
        const previous = await tx.user.findFirst({
          where: { phone: challenge.phone, id: { not: actor.id } },
        });
        if (previous?.phoneVerifiedAt)
          throw new ConflictException('Phone number already verified by another account');
        if (previous)
          await tx.user.update({
            where: { id: previous.id },
            data: { phone: null, phoneVerifiedAt: null },
          });
        await tx.user.update({
          where: { id: actor.id },
          data: { phone: challenge.phone, phoneVerifiedAt: new Date() },
        });
      });
    } catch {
      throw new ConflictException('This phone number is registered to another account');
    }
    return { ok: true };
  }
  @Post('auth/password') @UseGuards(AuthGuard) async password(
    @CurrentUser() actor: Actor,
    @Body() body: unknown,
  ) {
    const i = parse(
      z.object({
        currentPassword: z.string().min(1).max(128),
        newPassword: z.string().min(12).max(128),
      }),
      body,
    );
    const user = await this.db.user.findUniqueOrThrow({ where: { id: actor.id } });
    if (!(await verify(user.passwordHash, i.currentPassword)))
      throw new ForbiddenException('Current password is incorrect');
    await this.db.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: actor.id },
        data: { passwordHash: await hash(i.newPassword, { type: argon2id }) },
      });
      await tx.refreshSession.deleteMany({ where: { userId: actor.id } });
      await tx.auditLog.create({
        data: { actorId: actor.id, action: 'PASSWORD_CHANGED', entity: 'User', entityId: actor.id },
      });
    });
    this.realtime.disconnectUser(actor.id);
    return { ok: true, signInRequired: true };
  }
  @Post('auth/password/request-reset') resetRequest(@Body() body: unknown) {
    const { email } = parse(z.object({ email: z.email().max(254) }), body);
    return this.auth.requestOtp(email, undefined, 'RESET_PASSWORD');
  }
  @Post('auth/password/reset') async reset(@Body() body: unknown) {
    const i = parse(
      z.object({
        challengeId: id,
        code: z.string().regex(/^\d{6}$/),
        newPassword: z.string().min(12).max(128),
      }),
      body,
    );
    const { user } = await this.auth.consumeOtp(i.challengeId, i.code, 'RESET_PASSWORD');
    await this.db.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { passwordHash: await hash(i.newPassword, { type: argon2id }) },
      });
      await tx.refreshSession.deleteMany({ where: { userId: user.id } });
      await tx.auditLog.create({
        data: { actorId: user.id, action: 'PASSWORD_RESET', entity: 'User', entityId: user.id },
      });
    });
    this.realtime.disconnectUser(user.id);
    return { ok: true };
  }
  @Get('consents') @UseGuards(AuthGuard) consents(@CurrentUser() actor: Actor) {
    return this.db.consentGrant.findMany({
      where: { patientId: actor.id },
      include: { doctor: { select: { id: true, fullName: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }
  @Post('consents') @UseGuards(AuthGuard) async grant(
    @CurrentUser() actor: Actor,
    @Body() body: unknown,
  ) {
    const i = parse(
      z
        .object({ doctorId: id, expiresAt: iso })
        .refine(
          (i) =>
            new Date(i.expiresAt) > new Date() &&
            new Date(i.expiresAt).getTime() < Date.now() + 366 * 86400000,
          'Consent must expire within a year',
        ),
      body,
    );
    if (
      !(await this.db.doctorProfile.findFirst({
        where: { userId: i.doctorId, user: { deletedAt: null } },
      }))
    )
      throw new ConflictException('Doctor is not available');
    const grant = await this.db.consentGrant.create({
      data: { patientId: actor.id, doctorId: i.doctorId, expiresAt: new Date(i.expiresAt) },
    });
    await this.db.auditLog.create({
      data: {
        actorId: actor.id,
        action: 'CONSENT_GRANTED',
        entity: 'ConsentGrant',
        entityId: grant.id,
      },
    });
    return grant;
  }
  @Delete('consents/:id') @UseGuards(AuthGuard) async revoke(
    @CurrentUser() actor: Actor,
    @Param('id') grantId: string,
  ) {
    const result = await this.db.consentGrant.updateMany({
      where: { id: grantId, patientId: actor.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.db.auditLog.create({
      data: {
        actorId: actor.id,
        action: 'CONSENT_REVOKED',
        entity: 'ConsentGrant',
        entityId: grantId,
      },
    });
    return result;
  }
}
