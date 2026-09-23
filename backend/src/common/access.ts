import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  ForbiddenException,
  createParamDecorator,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from './prisma.service';
import type { Request } from 'express';
export type Actor = {
  id: string;
  email: string;
  fullName: string;
  globalRole: string;
  roles: { clinicId: string; role: string }[];
};
export type AuthRequest = Request & { actor: Actor; cookies: Record<string, string> };
export const CurrentUser = createParamDecorator(
  (_data, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<AuthRequest>().actor,
);
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private jwt: JwtService,
    private db: PrismaService,
  ) {}
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<AuthRequest>();
    const token = req.cookies?.access || req.headers.authorization?.replace(/^Bearer /, '');
    if (!token) throw new UnauthorizedException('Please sign in');
    try {
      const payload = this.jwt.verify(token, {
        secret: process.env.JWT_ACCESS_SECRET,
        issuer: 'careflow',
        audience: 'careflow-web',
      });
      const user = await this.db.user.findFirst({
        where: {
          id: payload.sub,
          deletedAt: null,
          sessions: { some: { id: payload.sid || 'missing', expiresAt: { gt: new Date() } } },
        },
        select: {
          id: true,
          email: true,
          fullName: true,
          globalRole: true,
          roles: { select: { clinicId: true, role: true } },
        },
      });
      if (!user) throw new Error();
      req.actor = user;
    } catch {
      throw new UnauthorizedException('Session expired. Please sign in again.');
    }
    return true;
  }
}
export function hasRole(actor: Actor, clinicId: string, roles: string[]) {
  return (
    actor.globalRole === 'SUPER_ADMIN' ||
    actor.roles.some((r) => r.clinicId === clinicId && roles.includes(r.role))
  );
}
export function requireRole(actor: Actor, clinicId: string, roles: string[]) {
  if (!hasRole(actor, clinicId, roles))
    throw new ForbiddenException('You do not have access to this clinic');
}
export function canReadAppointment(
  actor: Actor,
  a: { patientId: string; doctorId: string; clinicId: string },
) {
  if (
    actor.id !== a.patientId &&
    actor.id !== a.doctorId &&
    !hasRole(actor, a.clinicId, ['CLINIC_ADMIN', 'RECEPTIONIST', 'NURSE'])
  )
    throw new ForbiddenException('Appointment access denied');
}
export function canReadClinical(
  actor: Actor,
  a: { patientId: string; doctorId: string; clinicId: string },
) {
  if (actor.id !== a.patientId && actor.id !== a.doctorId)
    throw new ForbiddenException(
      'Clinical records are available only to the patient and treating doctor',
    );
}
