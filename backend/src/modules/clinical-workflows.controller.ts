import { notify } from './outbox';
import {
  Body,
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  Res,
  Optional,
  UseGuards,
  ForbiddenException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { z } from 'zod';
import { hash, verify, argon2id } from 'argon2';
import { PrismaService } from '../common/prisma.service';
import { Actor, AuthGuard, CurrentUser } from '../common/access';
import { id, iso, parse, soapSchema } from '../common/validation';
import { ClinicalService } from './clinical.service';
import { PdfService } from './pdf.service';
import type { Response } from 'express';
@Controller('clinical')
@UseGuards(AuthGuard)
export class ClinicalWorkflowsController {
  constructor(
    private db: PrismaService,
    private clinical: ClinicalService,
    @Optional() private pdf?: PdfService,
  ) {}
  private doctor(actor: Actor, clinicId: string) {
    if (!actor.roles.some((r) => r.clinicId === clinicId && r.role === 'DOCTOR'))
      throw new ForbiddenException('A doctor membership in this clinic is required');
  }
  private async treat(actor: Actor, patientId: string, clinicId: string) {
    this.doctor(actor, clinicId);
    if (
      !(await this.db.appointment.findFirst({ where: { doctorId: actor.id, patientId, clinicId } }))
    )
      throw new ForbiddenException('A treating relationship is required');
  }
  private async encounter(actor: Actor, appointmentId: string) {
    const a = await this.db.appointment.findUniqueOrThrow({ where: { id: appointmentId } });
    if (a.doctorId !== actor.id) throw new ForbiddenException('Treating doctor required');
    this.doctor(actor, a.clinicId);
    return a;
  }
  @Get('patients/:id/export') async export(
    @CurrentUser() actor: Actor,
    @Param('id') patientId: string,
    @Query('clinicId') clinicId: string | undefined,
    @Res() res: Response,
  ) {
    const history = await this.clinical.history(actor, patientId, clinicId),
      patient = await this.db.user.findUniqueOrThrow({
        where: { id: patientId },
        select: { fullName: true, bloodGroup: true, allergies: true },
      });
    const lines = [
      `Patient: ${patient.fullName}`,
      `Blood group: ${patient.bloodGroup || 'Not recorded'}`,
      `Allergies: ${patient.allergies.join(', ') || 'None recorded'}`,
      `Recent visits: ${history.length}`,
    ];
    for (const a of history) {
      lines.push(
        `${a.startAt.toISOString()} | ${a.clinic.name} | ${a.doctor.user.fullName} | ${a.status}`,
      );
      for (const note of a.notes)
        for (const [key, value] of Object.entries(note.soap as Record<string, string>))
          lines.push(`${key.toUpperCase()}: ${value}`);
      if (a.prescription)
        lines.push(
          `Prescription: ${a.prescription.status}; verification ${a.prescription.verificationCode}`,
        );
    }
    const data = await (this.pdf || new PdfService()).render('Recent care history', lines);
    await this.db.auditLog.create({
      data: {
        actorId: actor.id,
        clinicId,
        action: 'CARE_HISTORY_EXPORTED',
        entity: 'User',
        entityId: patientId,
      },
    });
    res.type('application/pdf').attachment('careflow-care-summary.pdf').send(data);
  }
  @Get('templates') templates(@CurrentUser() actor: Actor, @Query('clinicId') clinicId: string) {
    this.doctor(actor, clinicId);
    return this.db.clinicalTemplate.findMany({
      where: { clinicId, OR: [{ authorId: actor.id }, { shared: true }] },
      orderBy: { title: 'asc' },
    });
  }
  @Post('templates') async template(@CurrentUser() actor: Actor, @Body() body: unknown) {
    const i = parse(
      z.object({
        clinicId: id,
        title: z.string().trim().min(2).max(120),
        specialty: z.string().max(80).optional(),
        shared: z.boolean().default(false),
        soap: soapSchema,
      }),
      body,
    );
    this.doctor(actor, i.clinicId);
    return this.db.clinicalTemplate.create({ data: { ...i, authorId: actor.id } });
  }
  @Patch('templates/:id') async updateTemplate(
    @CurrentUser() actor: Actor,
    @Param('id') templateId: string,
    @Body() body: unknown,
  ) {
    const template = await this.db.clinicalTemplate.findUniqueOrThrow({
      where: { id: templateId },
    });
    if (template.authorId !== actor.id)
      throw new ForbiddenException('Only the template author can edit it');
    const i = parse(
      z.object({ title: z.string().min(2).max(120), soap: soapSchema, shared: z.boolean() }),
      body,
    );
    return this.db.clinicalTemplate.update({ where: { id: templateId }, data: i });
  }
  @Delete('templates/:id') async deleteTemplate(
    @CurrentUser() actor: Actor,
    @Param('id') templateId: string,
  ) {
    const t = await this.db.clinicalTemplate.findUniqueOrThrow({ where: { id: templateId } });
    if (t.authorId !== actor.id) throw new ForbiddenException('Template author required');
    await this.db.clinicalTemplate.delete({ where: { id: templateId } });
    return { ok: true };
  }
  @Get('plans') plans(@CurrentUser() actor: Actor) {
    return this.db.carePlan.findMany({
      where: { OR: [{ patientId: actor.id }, { doctorId: actor.id }] },
      include: {
        tasks: true,
        patient: { select: { fullName: true } },
        doctor: { select: { fullName: true } },
        clinic: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }
  @Post('plans') async plan(@CurrentUser() actor: Actor, @Body() body: unknown) {
    const i = parse(
      z.object({
        patientId: id,
        clinicId: id,
        title: z.string().trim().min(2).max(150),
        description: z.string().max(5000),
        reviewAt: iso.optional(),
        tasks: z
          .array(z.object({ title: z.string().min(2).max(300), dueAt: iso.optional() }))
          .min(1)
          .max(30),
      }),
      body,
    );
    await this.treat(actor, i.patientId, i.clinicId);
    return this.db.$transaction(async (tx) => {
      const plan = await tx.carePlan.create({
        data: {
          patientId: i.patientId,
          doctorId: actor.id,
          clinicId: i.clinicId,
          title: i.title,
          description: i.description,
          reviewAt: i.reviewAt ? new Date(i.reviewAt) : null,
          tasks: {
            create: i.tasks.map((t) => ({ ...t, dueAt: t.dueAt ? new Date(t.dueAt) : null })),
          },
        },
        include: { tasks: true },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          clinicId: i.clinicId,
          action: 'CARE_PLAN_CREATED',
          entity: 'CarePlan',
          entityId: plan.id,
        },
      });
      await notify(
        tx,
        i.patientId,
        'Your care plan is ready',
        'Your doctor added a plan with follow-up tasks. Open Care plans to review it.',
        i.clinicId,
      );
      return plan;
    });
  }
  @Patch('plans/:id') async planStatus(
    @CurrentUser() actor: Actor,
    @Param('id') planId: string,
    @Body() body: unknown,
  ) {
    const { status } = parse(
      z.object({ status: z.enum(['ACTIVE', 'COMPLETED', 'ARCHIVED']) }),
      body,
    );
    const plan = await this.db.carePlan.findUniqueOrThrow({ where: { id: planId } });
    if (plan.doctorId !== actor.id)
      throw new ForbiddenException('Only the treating doctor can update the plan');
    await this.db.auditLog.create({
      data: {
        actorId: actor.id,
        clinicId: plan.clinicId,
        action: `CARE_PLAN_${status}`,
        entity: 'CarePlan',
        entityId: planId,
      },
    });
    return this.db.carePlan.update({ where: { id: planId }, data: { status } });
  }
  @Patch('plans/:id/tasks/:taskId') async task(
    @CurrentUser() actor: Actor,
    @Param('id') planId: string,
    @Param('taskId') taskId: string,
    @Body() body: unknown,
  ) {
    const { completed } = parse(z.object({ completed: z.boolean() }), body);
    const p = await this.db.carePlan.findUniqueOrThrow({ where: { id: planId } });
    if (p.patientId !== actor.id && p.doctorId !== actor.id)
      throw new ForbiddenException('Care plan access denied');
    if (p.status !== 'ACTIVE') throw new ConflictException('This care plan is no longer active');
    return this.db.carePlanTask.updateMany({
      where: { id: taskId, planId },
      data: {
        completedAt: completed ? new Date() : null,
        completedBy: completed ? actor.id : null,
      },
    });
  }
  @Get('labs') labs(@CurrentUser() actor: Actor) {
    return this.db.labOrder.findMany({
      where: { appointment: { OR: [{ patientId: actor.id }, { doctorId: actor.id }] } },
      include: {
        appointment: {
          select: {
            id: true,
            doctorId: true,
            clinicId: true,
            patientId: true,
            patient: { select: { fullName: true } },
            doctor: { select: { user: { select: { fullName: true } } } },
            clinic: { select: { name: true } },
            startAt: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }
  @Post('labs') async order(@CurrentUser() actor: Actor, @Body() body: unknown) {
    const i = parse(
      z.object({
        appointmentId: id,
        title: z.string().min(2).max(150),
        tests: z
          .array(
            z.object({
              name: z.string().min(2).max(150),
              instructions: z.string().max(500).default(''),
            }),
          )
          .min(1)
          .max(30),
      }),
      body,
    );
    const a = await this.encounter(actor, i.appointmentId);
    if (!['IN_PROGRESS', 'COMPLETED'].includes(a.status))
      throw new ConflictException('Start the consultation first');
    return this.db.$transaction(async (tx) => {
      const order = await tx.labOrder.create({ data: i });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          clinicId: a.clinicId,
          action: 'LAB_ORDER_CREATED',
          entity: 'LabOrder',
          entityId: order.id,
        },
      });
      await notify(
        tx,
        a.patientId,
        'A laboratory order was added',
        'Open Clinical studio to view the requested tests and instructions.',
        a.clinicId,
      );
      return order;
    });
  }
  @Patch('labs/:id') async result(
    @CurrentUser() actor: Actor,
    @Param('id') orderId: string,
    @Body() body: unknown,
  ) {
    const i = parse(
      z.object({
        status: z.enum(['SAMPLE_COLLECTED', 'RESULT_UPLOADED', 'REVIEWED', 'CANCELLED']),
        results: z
          .array(
            z.object({
              name: z.string().min(1).max(150),
              value: z.string().max(200),
              unit: z.string().max(60),
              reference: z.string().max(150),
              flag: z.enum(['NORMAL', 'LOW', 'HIGH', 'UNKNOWN']),
            }),
          )
          .max(100)
          .optional(),
        resultAttachmentId: id.optional(),
      }),
      body,
    );
    const order = await this.db.labOrder.findUniqueOrThrow({
      where: { id: orderId },
      include: { appointment: true },
    });
    const a = order.appointment;
    const doctor = a.doctorId === actor.id,
      nurse = actor.roles.some((r) => r.clinicId === a.clinicId && r.role === 'NURSE');
    if (!doctor && !nurse) throw new ForbiddenException('Treating doctor or clinic nurse required');
    if (['REVIEWED', 'CANCELLED'].includes(i.status) && !doctor)
      throw new ForbiddenException('Only the treating doctor can review or cancel tests');
    const transitions: Record<string, string[]> = {
      ORDERED: ['SAMPLE_COLLECTED', 'RESULT_UPLOADED', 'CANCELLED'],
      SAMPLE_COLLECTED: ['RESULT_UPLOADED', 'CANCELLED'],
      RESULT_UPLOADED: ['REVIEWED', 'CANCELLED'],
      REVIEWED: [],
      CANCELLED: [],
    };
    if (!transitions[order.status]?.includes(i.status))
      throw new ConflictException('Invalid laboratory status transition');
    if (i.status === 'RESULT_UPLOADED' && !i.results?.length && !i.resultAttachmentId)
      throw new BadRequestException('Add structured results or a result document');
    if (
      i.resultAttachmentId &&
      !(await this.db.attachment.findFirst({
        where: { id: i.resultAttachmentId, appointmentId: a.id },
      }))
    )
      throw new BadRequestException('The result document must belong to this visit');
    return this.db.$transaction(async (tx) => {
      const changed = await tx.labOrder.updateMany({
        where: { id: orderId, status: order.status },
        data: {
          status: i.status,
          ...(i.results ? { results: i.results } : {}),
          ...(i.resultAttachmentId ? { resultAttachmentId: i.resultAttachmentId } : {}),
          ...(i.status === 'REVIEWED' ? { reviewedAt: new Date() } : {}),
        },
      });
      if (!changed.count)
        throw new ConflictException('Laboratory order changed. Reload and try again.');
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          clinicId: a.clinicId,
          action: `LAB_${i.status}`,
          entity: 'LabOrder',
          entityId: orderId,
        },
      });
      return tx.labOrder.findUniqueOrThrow({ where: { id: orderId } });
    });
  }
  @Get('referrals') referrals(@CurrentUser() actor: Actor) {
    return this.db.referral.findMany({
      where: {
        OR: [
          { targetDoctorId: actor.id },
          { appointment: { OR: [{ doctorId: actor.id }, { patientId: actor.id }] } },
        ],
      },
      include: {
        appointment: {
          select: {
            id: true,
            doctorId: true,
            clinicId: true,
            patientId: true,
            patient: { select: { fullName: true } },
            doctor: { select: { user: { select: { fullName: true } } } },
            clinic: { select: { name: true } },
          },
        },
        targetDoctor: { select: { user: { select: { fullName: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }
  @Post('referrals') async refer(@CurrentUser() actor: Actor, @Body() body: unknown) {
    const i = parse(
      z.object({
        appointmentId: id,
        targetDoctorId: id.optional(),
        specialty: z.string().min(2).max(100),
        reason: z.string().min(5).max(3000),
      }),
      body,
    );
    const a = await this.encounter(actor, i.appointmentId);
    if (
      i.targetDoctorId &&
      !(await this.db.doctorProfile.findFirst({
        where: { userId: i.targetDoctorId, user: { deletedAt: null } },
      }))
    )
      throw new BadRequestException('The receiving doctor is unavailable');
    const referral = await this.db.referral.create({ data: i });
    await this.db.auditLog.create({
      data: {
        actorId: actor.id,
        clinicId: a.clinicId,
        action: 'REFERRAL_CREATED',
        entity: 'Referral',
        entityId: referral.id,
      },
    });
    return referral;
  }
  @Patch('referrals/:id') async referralStatus(
    @CurrentUser() actor: Actor,
    @Param('id') referralId: string,
    @Body() body: unknown,
  ) {
    const { status } = parse(z.object({ status: z.enum(['ACCEPTED', 'CLOSED']) }), body);
    const r = await this.db.referral.findUniqueOrThrow({
      where: { id: referralId },
      include: { appointment: true },
    });
    if (actor.id !== r.targetDoctorId && actor.id !== r.appointment.doctorId)
      throw new ForbiddenException('Referring or receiving doctor required');
    if (r.status === 'CLOSED' || (status === 'ACCEPTED' && actor.id !== r.targetDoctorId))
      throw new ConflictException('Referral cannot be transitioned by this user');
    return this.db.referral.update({ where: { id: referralId }, data: { status } });
  }
  @Get('signing-status') async signingStatus(@CurrentUser() actor: Actor) {
    const c = await this.db.doctorSigningCredential.findUnique({
      where: { doctorId: actor.id },
      select: { doctorId: true },
    });
    return { configured: !!c };
  }
  @Post('signing-pin') async signingPin(@CurrentUser() actor: Actor, @Body() body: unknown) {
    const i = parse(
      z.object({ password: z.string().min(1).max(128), pin: z.string().regex(/^\d{6}$/) }),
      body,
    );
    if (!(await this.db.doctorProfile.findUnique({ where: { userId: actor.id } })))
      throw new ForbiddenException('Doctor profile required');
    const user = await this.db.user.findUniqueOrThrow({ where: { id: actor.id } });
    if (!(await verify(user.passwordHash, i.password)))
      throw new ForbiddenException('Current password is incorrect');
    await this.db.doctorSigningCredential.upsert({
      where: { doctorId: actor.id },
      create: { doctorId: actor.id, pinHash: await hash(i.pin, { type: argon2id }) },
      update: { pinHash: await hash(i.pin, { type: argon2id }) },
    });
    await this.db.auditLog.create({
      data: {
        actorId: actor.id,
        action: 'SIGNING_PIN_UPDATED',
        entity: 'DoctorProfile',
        entityId: actor.id,
      },
    });
    return { ok: true };
  }
}
