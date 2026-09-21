import { Controller, Get, Post, Body, Param, Query, UseGuards, Res, ConflictException } from '@nestjs/common';
import { z } from 'zod';
import type { Response } from 'express';
import { Actor, AuthGuard, CurrentUser } from '../common/access';
import { id, parse, soapSchema } from '../common/validation';
import { ClinicalService } from './clinical.service';
import { PdfService } from './pdf.service';
import { AuditService } from '../common/audit.service';
import { PrismaService } from '../common/prisma.service';
const med=z.object({name:z.string().min(1).max(150),dosage:z.string().min(1).max(100),frequency:z.string().min(1).max(100),duration:z.string().min(1).max(100),route:z.string().max(80),instructions:z.string().max(500)});
@Controller()
export class ClinicalController {
  constructor(private clinical:ClinicalService,private pdf:PdfService,private audit:AuditService,private db:PrismaService){}
  @Get('patients/me/history') @UseGuards(AuthGuard) mine(@CurrentUser() actor:Actor){return this.clinical.history(actor);}
  @Get('patients/:id/history') @UseGuards(AuthGuard) history(@CurrentUser() actor:Actor,@Param('id') patientId:string,@Query('clinicId') clinicId?:string){return this.clinical.history(actor,patientId,clinicId);}
  @Post('appointments/:id/notes') @UseGuards(AuthGuard) notes(@CurrentUser() actor:Actor,@Param('id') appointmentId:string,@Body() body:unknown){const i=parse(z.object({soap:soapSchema,noteId:id.optional()}),body);return this.clinical.notes(actor,appointmentId,i.soap,i.noteId);}
  @Post('prescriptions') @UseGuards(AuthGuard) draft(@CurrentUser() actor:Actor,@Body() body:unknown){const i=parse(z.object({appointmentId:id,items:z.array(med).min(1).max(30)}),body);return this.clinical.draft(actor,i.appointmentId,i.items);}
  @Post('prescriptions/:id/sign') @UseGuards(AuthGuard) sign(@CurrentUser() actor:Actor,@Param('id') id:string){return this.clinical.sign(actor,id);}
  @Post('prescriptions/:id/revoke') @UseGuards(AuthGuard) revoke(@CurrentUser() actor:Actor,@Param('id') id:string){return this.clinical.revoke(actor,id);}
  @Get('prescriptions/verify/:code') verify(@Param('code') code:string){return this.clinical.verify(code);}
  @Get('prescriptions/:id/pdf') @UseGuards(AuthGuard) async download(@CurrentUser() actor:Actor,@Param('id') id:string,@Res() res:Response){const p=await this.clinical.prescription(actor,id);if(p.status==='DRAFT')throw new ConflictException('Sign the prescription first');const artifactId=`${p.id}-${p.status}`;const existing=await this.db.pdfArtifact.findUnique({where:{id:artifactId}});const data=existing?Buffer.from(existing.bytes):await this.pdf.prescription(p);if(!existing)await this.db.pdfArtifact.upsert({where:{id:artifactId},create:{id:artifactId,bytes:new Uint8Array(data)},update:{}});await this.audit.record(actor.id,'PRESCRIPTION_EXPORTED','Prescription',id,p.appointment.clinicId);res.type('application/pdf').attachment(`prescription-${id}.pdf`).send(data);}
}
