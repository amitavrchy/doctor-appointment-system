import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Req,
  Res,
  UseGuards,
  Param,
} from '@nestjs/common';
import { z } from 'zod';
import type { Response } from 'express';
import { AuthService } from './auth.service';
import { AuthGuard, Actor, AuthRequest, CurrentUser } from '../common/access';
import { parse, id } from '../common/validation';
import { PrismaService } from '../common/prisma.service';
import { RealtimeGateway } from './realtime.gateway';
@Controller('auth')
export class AuthController {
  constructor(
    private auth: AuthService,
    private db: PrismaService,
    private realtime: RealtimeGateway,
  ) {}
  private cookies(res: Response, tokens: { access: string; refresh: string }) {
    const base = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax' as const,
      path: '/',
    };
    res.cookie('access', tokens.access, { ...base, maxAge: 900000 });
    res.cookie('refresh', tokens.refresh, { ...base, maxAge: 30 * 86400000 });
    return { ok: true };
  }
  @Post('register') async register(@Body() body: unknown) {
    return this.auth.register(
      parse(
        z.object({
          email: z.email().max(254),
          password: z.string().min(12).max(128),
          fullName: z.string().trim().min(2).max(100),
        }),
        body,
      ),
    );
  }
  @Post('login') async login(
    @Body() body: unknown,
    @Req() req: AuthRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const input = parse(z.object({ email: z.email(), password: z.string().min(1).max(128) }), body);
    return this.cookies(
      res,
      await this.auth.login(
        input.email,
        input.password,
        req.headers['user-agent'] || 'Unknown device',
      ),
    );
  }
  @Post('refresh') async refresh(
    @Req() req: AuthRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.cookies(
      res,
      await this.auth.refresh(
        req.cookies?.refresh || '',
        req.headers['user-agent'] || 'Unknown device',
      ),
    );
  }
  @Post('logout') async logout(@Req() req: AuthRequest, @Res({ passthrough: true }) res: Response) {
    const sessionId = await this.auth.logout(req.cookies?.refresh || '');
    if (sessionId) this.realtime.disconnectSession(sessionId);
    res.clearCookie('access', { path: '/' });
    res.clearCookie('refresh', { path: '/' });
    return { ok: true };
  }
  @Post('otp/request') requestOtp(@Body() body: unknown) {
    const i = parse(
      z
        .object({
          email: z.email().optional(),
          phone: z
            .string()
            .regex(/^\+[1-9]\d{6,14}$/)
            .optional(),
        })
        .refine((i) => !!i.email !== !!i.phone, 'Choose email or phone'),
      body,
    );
    return this.auth.requestOtp(i.email || '', i.phone);
  }
  @Post('otp/verify') async verifyOtp(
    @Body() body: unknown,
    @Req() req: AuthRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const i = parse(z.object({ challengeId: id, code: z.string().regex(/^\d{6}$/) }), body);
    return this.cookies(
      res,
      await this.auth.verifyOtp(
        i.challengeId,
        i.code,
        req.headers['user-agent'] || 'Unknown device',
      ),
    );
  }
  @Get('me') @UseGuards(AuthGuard) me(@CurrentUser() actor: Actor) {
    return this.auth.me(actor);
  }
  @Patch('me') @UseGuards(AuthGuard) async profile(
    @CurrentUser() actor: Actor,
    @Body() body: unknown,
  ) {
    const input = parse(
      z.object({
        fullName: z.string().trim().min(2).max(100),
        phone: z
          .string()
          .regex(/^\+?[0-9]{7,15}$/)
          .nullable()
          .optional(),
        bloodGroup: z
          .enum(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'])
          .nullable()
          .optional(),
        allergies: z.array(z.string().max(100)).max(30),
        consentHistory: z.boolean(),
        dateOfBirth: z.iso.date().nullable().optional(),
        emergencyContact: z
          .object({ name: z.string().max(100), phone: z.string().max(30) })
          .optional(),
      }),
      body,
    );
    const current = await this.db.user.findUniqueOrThrow({
      where: { id: actor.id },
      select: { phone: true },
    });
    return this.db.user.update({
      where: { id: actor.id },
      data: {
        ...(input.phone !== undefined && input.phone !== current.phone
          ? { phoneVerifiedAt: null }
          : {}),
        ...input,
        dateOfBirth: input.dateOfBirth ? new Date(input.dateOfBirth) : null,
      },
      select: { id: true, fullName: true },
    });
  }
  @Get('sessions') @UseGuards(AuthGuard) sessions(@CurrentUser() actor: Actor) {
    return this.db.refreshSession.findMany({
      where: { userId: actor.id, expiresAt: { gt: new Date() } },
      select: { id: true, device: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }
  @Delete('sessions/:id') @UseGuards(AuthGuard) async revoke(
    @CurrentUser() actor: Actor,
    @Param('id') sessionId: string,
  ) {
    const result = await this.db.refreshSession.deleteMany({
      where: { id: sessionId, userId: actor.id },
    });
    if (result.count) this.realtime.disconnectSession(sessionId);
    return result;
  }
}
