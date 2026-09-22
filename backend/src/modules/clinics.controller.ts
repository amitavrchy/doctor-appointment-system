import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Query,
  Body,
  UseGuards,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../common/prisma.service';
import { Actor, AuthGuard, CurrentUser, requireRole } from '../common/access';
import { id, parse } from '../common/validation';
import { DateTime } from 'luxon';
@Controller()
export class ClinicsController {
  constructor(private db: PrismaService) {}
  @Get('clinics') clinics() {
    return this.db.clinic.findMany({
      where: { active: true },
      include: { rooms: true, _count: { select: { doctors: true } } },
      orderBy: { name: 'asc' },
    });
  }
  @Get('doctors') doctors(@Query('clinicId') clinicId?: string) {
    return this.db.doctorProfile.findMany({
      where: {
        user: { deletedAt: null },
        ...(clinicId ? { memberships: { some: { clinicId } } } : {}),
      },
      include: {
        user: { select: { id: true, fullName: true } },
        memberships: { include: { clinic: true } },
      },
    });
  }
  @Get('clinics/:id/doctors') clinicDoctors(@Param('id') id: string) {
    return this.doctors(id);
  }
  @Post('clinics') @UseGuards(AuthGuard) create(
    @CurrentUser() actor: Actor,
    @Body() body: unknown,
  ) {
    if (actor.globalRole !== 'SUPER_ADMIN')
      throw new ForbiddenException('Platform administrator required');
    const i = parse(
      z.object({
        name: z.string().min(2).max(100),
        slug: z
          .string()
          .regex(/^[a-z0-9-]+$/)
          .max(100),
        address: z.string().min(3).max(300),
        timezone: z
          .string()
          .refine((zone) => DateTime.now().setZone(zone).isValid, 'Invalid timezone'),
      }),
      body,
    );
    return this.db.clinic.create({ data: i });
  }
  @Patch('clinics/:id') @UseGuards(AuthGuard) update(
    @CurrentUser() actor: Actor,
    @Param('id') clinicId: string,
    @Body() body: unknown,
  ) {
    requireRole(actor, clinicId, ['CLINIC_ADMIN']);
    return this.db.clinic.update({
      where: { id: clinicId },
      data: parse(
        z.object({ name: z.string().min(2).max(100), address: z.string().min(3).max(300) }),
        body,
      ),
    });
  }
  @Post('clinics/:id/rooms') @UseGuards(AuthGuard) room(
    @CurrentUser() actor: Actor,
    @Param('id') clinicId: string,
    @Body() body: unknown,
  ) {
    requireRole(actor, clinicId, ['CLINIC_ADMIN']);
    return this.db.room.create({
      data: { clinicId, ...parse(z.object({ name: z.string().min(1).max(100) }), body) },
    });
  }
  @Post('clinics/:id/members') @UseGuards(AuthGuard) async member(
    @CurrentUser() actor: Actor,
    @Param('id') clinicId: string,
    @Body() body: unknown,
  ) {
    requireRole(actor, clinicId, ['CLINIC_ADMIN']);
    const i = parse(
      z.object({
        email: z.email(),
        role: z.enum(['DOCTOR', 'RECEPTIONIST', 'CLINIC_ADMIN', 'NURSE']),
      }),
      body,
    );
    const user = await this.db.user.findFirst({
      where: { email: i.email.toLowerCase(), deletedAt: null },
    });
    if (!user) throw new BadRequestException('Register the user first');
    if (
      i.role === 'DOCTOR' &&
      !(await this.db.doctorProfile.findUnique({ where: { userId: user.id } }))
    )
      throw new BadRequestException('Create a doctor profile first');
    return this.db.userClinicRole.upsert({
      where: { userId_clinicId_role: { userId: user.id, clinicId, role: i.role } },
      create: { userId: user.id, clinicId, role: i.role },
      update: {},
    });
  }
  @Post('doctors') @UseGuards(AuthGuard) async createDoctor(
    @CurrentUser() actor: Actor,
    @Body() body: unknown,
  ) {
    const i = parse(
      z.object({
        userId: id,
        clinicId: id,
        specialties: z.array(z.string().min(1).max(80)).min(1).max(10),
        licenseNumber: z.string().min(3).max(80),
        bio: z.string().max(2000),
        languages: z.array(z.string().max(50)).max(10),
        feeMinor: z.number().int().nonnegative(),
        teleFeeMinor: z.number().int().nonnegative(),
      }),
      body,
    );
    requireRole(actor, i.clinicId, ['CLINIC_ADMIN']);
    return this.db.$transaction(async (tx) => {
      await tx.doctorProfile.upsert({
        where: { userId: i.userId },
        create: {
          userId: i.userId,
          specialties: i.specialties,
          licenseNumber: i.licenseNumber,
          bio: i.bio,
          languages: i.languages,
        },
        update: {},
      });
      await tx.userClinicRole.upsert({
        where: { userId_clinicId_role: { userId: i.userId, clinicId: i.clinicId, role: 'DOCTOR' } },
        create: { userId: i.userId, clinicId: i.clinicId, role: 'DOCTOR' },
        update: {},
      });
      return tx.doctorClinic.upsert({
        where: { doctorId_clinicId: { doctorId: i.userId, clinicId: i.clinicId } },
        create: {
          doctorId: i.userId,
          clinicId: i.clinicId,
          feeMinor: i.feeMinor,
          teleFeeMinor: i.teleFeeMinor,
        },
        update: { feeMinor: i.feeMinor, teleFeeMinor: i.teleFeeMinor },
      });
    });
  }
  @Get('patients') @UseGuards(AuthGuard) async patients(
    @CurrentUser() actor: Actor,
    @Query('clinicId') clinicId: string,
    @Query('email') email?: string,
  ) {
    requireRole(actor, clinicId, ['DOCTOR', 'RECEPTIONIST', 'CLINIC_ADMIN']);
    const isDoctor = actor.roles.some((r) => r.clinicId === clinicId && r.role === 'DOCTOR');
    if (email) parse(z.email().max(254), email);
    return this.db.user.findMany({
      where: {
        deletedAt: null,
        ...(email && !isDoctor
          ? { email: email.toLowerCase() }
          : { appointments: { some: { clinicId, ...(isDoctor ? { doctorId: actor.id } : {}) } } }),
      },
      select: { id: true, fullName: true, email: true },
      take: 200,
    });
  }
}
