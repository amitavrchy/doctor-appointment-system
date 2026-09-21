import { Body,Controller,Get,Post,Param,Query,Res,UseGuards,BadRequestException,ForbiddenException } from '@nestjs/common';
import { z } from 'zod';
import { createCipheriv,createDecipheriv,randomBytes } from 'crypto';
import type { Response } from 'express';
import { PrismaService } from '../common/prisma.service';
import { Actor,AuthGuard,CurrentUser,canReadClinical,requireRole } from '../common/access';
import { parse } from '../common/validation';
import { AppointmentsService } from './appointments.service';
import { AuditService } from '../common/audit.service';
@Controller() @UseGuards(AuthGuard)
export class DocumentsController {
  constructor(private db:PrismaService,private appointments:AppointmentsService,private audit:AuditService){}
  @Post('appointments/:id/attachments') async upload(@CurrentUser() actor:Actor,@Param('id') appointmentId:string,@Body() body:unknown){
    const a=await this.appointments.get(actor,appointmentId);canReadClinical(actor,a);
    const input=parse(z.object({name:z.string().min(1).max(150),mime:z.enum(['application/pdf','image/png','image/jpeg']),base64:z.string().max(7*1024*1024)}),body);
    const bytes=Buffer.from(input.base64,'base64');if(bytes.length===0||bytes.length>5*1024*1024)throw new BadRequestException('Files must be between 1 byte and 5 MB');
    const valid=input.mime==='application/pdf'?bytes.subarray(0,5).toString()==='%PDF-':input.mime==='image/png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
    if(!valid)throw new BadRequestException('The file content does not match its declared format');
    const key=process.env.ATTACHMENT_ENCRYPTION_KEY;if(!key||!/^[a-f0-9]{64}$/i.test(key))throw new BadRequestException('Document encryption is not configured');
    const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',Buffer.from(key,'hex'),iv);cipher.setAAD(Buffer.from(appointmentId));const encrypted=Buffer.concat([iv,cipher.update(bytes),cipher.final(),cipher.getAuthTag()]);
    const file=await this.db.attachment.create({data:{appointmentId,uploadedBy:actor.id,name:input.name.replace(/[\r\n\\/]/g,'_'),mime:input.mime,size:bytes.length,encrypted},select:{id:true,name:true,mime:true,size:true,createdAt:true}});
    await this.audit.record(actor.id,'DOCUMENT_UPLOADED','Attachment',file.id,a.clinicId);return file;
  }
  @Get('appointments/:id/attachments') async list(@CurrentUser() actor:Actor,@Param('id') appointmentId:string){const a=await this.appointments.get(actor,appointmentId);canReadClinical(actor,a);return this.db.attachment.findMany({where:{appointmentId},select:{id:true,name:true,mime:true,size:true,createdAt:true},orderBy:{createdAt:'desc'}});}
  @Get('attachments/:id') async download(@CurrentUser() actor:Actor,@Param('id') id:string,@Res() res:Response){const file=await this.db.attachment.findUniqueOrThrow({where:{id},include:{appointment:true}});canReadClinical(actor,file.appointment);const encrypted=Buffer.from(file.encrypted);const decipher=createDecipheriv('aes-256-gcm',Buffer.from(process.env.ATTACHMENT_ENCRYPTION_KEY!,'hex'),encrypted.subarray(0,12));decipher.setAAD(Buffer.from(file.appointmentId));decipher.setAuthTag(encrypted.subarray(-16));const bytes=Buffer.concat([decipher.update(encrypted.subarray(12,-16)),decipher.final()]);await this.audit.record(actor.id,'DOCUMENT_EXPORTED','Attachment',id,file.appointment.clinicId);res.type(file.mime).attachment(file.name).send(bytes);}
  @Get('patients/:id/profile') async profile(@CurrentUser() actor:Actor,@Param('id') patientId:string,@Query('clinicId') clinicId:string){if(patientId!==actor.id&&!await this.db.appointment.findFirst({where:{patientId,doctorId:actor.id,clinicId}}))throw new ForbiddenException('Treating doctor required');return this.db.user.findUniqueOrThrow({where:{id:patientId},select:{id:true,fullName:true,dateOfBirth:true,allergies:true,bloodGroup:true,emergencyContact:true,consentHistory:true}});}
  @Get('appointments/:id/vitals') async vitals(@CurrentUser() actor:Actor,@Param('id') appointmentId:string){const a=await this.appointments.get(actor,appointmentId);if(actor.id!==a.patientId&&actor.id!==a.doctorId)requireRole(actor,a.clinicId,['NURSE']);return this.db.vital.findMany({where:{appointmentId},orderBy:{createdAt:'desc'}});}
  @Post('appointments/:id/vitals') async record(@CurrentUser() actor:Actor,@Param('id') appointmentId:string,@Body() body:unknown){const a=await this.appointments.get(actor,appointmentId);if(actor.id!==a.doctorId)requireRole(actor,a.clinicId,['NURSE']);const input=parse(z.object({systolic:z.number().int().min(40).max(300).optional(),diastolic:z.number().int().min(20).max(200).optional(),pulse:z.number().int().min(20).max(250).optional(),temperature:z.number().min(30).max(45).optional(),oxygen:z.number().min(50).max(100).optional(),weight:z.number().min(1).max(500).optional()}).refine(i=>Object.values(i).some(v=>v!==undefined),'At least one observation is required'),body);const vital=await this.db.vital.create({data:{...input,appointmentId,authorId:actor.id}});await this.audit.record(actor.id,'VITALS_RECORDED','Vital',vital.id,a.clinicId);return vital;}
  @Get('notes/search') async search(@CurrentUser() actor:Actor,@Query('q') query:string){const q=parse(z.string().trim().min(2).max(100),query);return this.db.$queryRaw<{id:string;appointmentId:string;createdAt:Date}[]>`SELECT n.id, n."appointmentId", n."createdAt" FROM "ClinicalNote" n JOIN "Appointment" a ON a.id=n."appointmentId" WHERE (a."patientId"=${actor.id} OR a."doctorId"=${actor.id}) AND n."searchVector" @@ plainto_tsquery('english', ${q}) ORDER BY n."createdAt" DESC LIMIT 50`;}
}
