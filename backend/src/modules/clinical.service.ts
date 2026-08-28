import { Injectable, ForbiddenException, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { Actor, canReadClinical } from '../common/access';
import { AppointmentsService } from './appointments.service';
import { assertTransition } from '../common/domain';
import { Prisma } from '@prisma/client';
import { createHmac } from 'crypto';
export type Medication={name:string;dosage:string;frequency:string;duration:string;route:string;instructions:string};
@Injectable()
export class ClinicalService {
  constructor(private db:PrismaService,private appointments:AppointmentsService) {}
  async history(actor:Actor,patientId=actor.id,clinicId?:string) {
    if(actor.id!==patientId){
      const care=await this.db.appointment.findFirst({where:{patientId,doctorId:actor.id,...(clinicId?{clinicId}:{})}});
      if(!care)throw new ForbiddenException('A treating relationship is required');
      const patient=await this.db.user.findUniqueOrThrow({where:{id:patientId}});
      if(!patient.consentHistory&&!clinicId)throw new ForbiddenException('Choose a clinic. Cross-clinic history requires patient consent.');
    }
    const appointments=await this.db.appointment.findMany({where:{patientId,...(actor.id!==patientId&&clinicId?{clinicId}:{})},include:{clinic:true,doctor:{include:{user:{select:{fullName:true}}}},notes:{include:{revisions:true}},prescription:true},orderBy:{startAt:'desc'},take:100});
    await this.db.auditLog.create({data:{actorId:actor.id,action:'HISTORY_VIEWED',entity:'User',entityId:patientId,clinicId}});return appointments;
  }
  async notes(actor:Actor,appointmentId:string,soap:Prisma.InputJsonValue,noteId?:string) {
    const a=await this.appointments.get(actor,appointmentId);
    if(actor.id!==a.doctorId)throw new ForbiddenException('Only the treating doctor can write clinical notes');
    if(!['IN_PROGRESS','COMPLETED'].includes(a.status))throw new ConflictException('Start the consultation before writing notes');
    return this.db.$transaction(async tx=>{
      let result;
      if(noteId){const note=await tx.clinicalNote.findFirst({where:{id:noteId,appointmentId}});if(!note)throw new NotFoundException('Note not found');await tx.noteRevision.create({data:{noteId,soap:note.soap as Prisma.InputJsonValue,editedBy:actor.id}});result=await tx.clinicalNote.update({where:{id:noteId},data:{soap}});}
      else result=await tx.clinicalNote.create({data:{appointmentId,authorId:actor.id,soap}});
      await tx.$executeRaw`UPDATE "ClinicalNote" SET "searchVector" = to_tsvector('english', ${JSON.stringify(soap)}) WHERE id = ${result.id}`;
      await tx.auditLog.create({data:{actorId:actor.id,clinicId:a.clinicId,action:noteId?'NOTE_EDITED':'NOTE_CREATED',entity:'ClinicalNote',entityId:result.id}});return result;
    });
  }
  async draft(actor:Actor,appointmentId:string,items:Medication[]) {
    const a=await this.appointments.get(actor,appointmentId);if(actor.id!==a.doctorId)throw new ForbiddenException('Only the treating doctor can prescribe');
    if(!['IN_PROGRESS','COMPLETED'].includes(a.status))throw new ConflictException('Start the consultation before prescribing');
    return this.db.$transaction(async tx=>{
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${appointmentId}, 1))`;
      const existing=await tx.prescription.findUnique({where:{appointmentId}});if(existing&&existing.status!=='DRAFT')throw new ConflictException('Signed prescriptions cannot be edited');
      const prescription=await tx.prescription.upsert({where:{appointmentId},create:{appointmentId,doctorId:actor.id,items},update:{items}});
      const names=items.map(i=>i.name.toLowerCase());const warnings=names.some(n=>n.includes('warfarin'))&&names.some(n=>n.includes('ibuprofen'))?['Potential interaction: warfarin and ibuprofen. Review before signing.']:[];
      return {prescription,warnings,interactionCheck:'Static demonstration list; not a clinical decision system'};
    });
  }
  async sign(actor:Actor,id:string) {
    return this.db.$transaction(async tx=>{
      const p=await tx.prescription.findUnique({where:{id},include:{appointment:true}});if(!p)throw new NotFoundException('Prescription not found');
      if(p.doctorId!==actor.id)throw new ForbiddenException('Only the prescribing doctor can sign');assertTransition('prescription',p.status,'SIGNED');
      const signature=createHmac('sha256',process.env.JWT_REFRESH_SECRET!).update(`${p.id}:${JSON.stringify(p.items)}`).digest('hex');
      const changed=await tx.prescription.updateMany({where:{id,status:'DRAFT'},data:{status:'SIGNED',signedAt:new Date(),expiresAt:new Date(Date.now()+90*86400000),signature}});
      if(!changed.count)throw new ConflictException('Prescription has already changed');
      await tx.auditLog.create({data:{actorId:actor.id,clinicId:p.appointment.clinicId,action:'PRESCRIPTION_SIGNED',entity:'Prescription',entityId:id}});return tx.prescription.findUniqueOrThrow({where:{id}});
    });
  }
  async verify(code:string) {
    const p=await this.db.prescription.findUnique({where:{verificationCode:code},include:{appointment:{include:{clinic:true,doctor:{include:{user:{select:{fullName:true}}}}}}}});
    if(!p)throw new NotFoundException('Verification code not found');
    return {status:p.expiresAt&&p.expiresAt<new Date()&&p.status==='SIGNED'?'EXPIRED':p.status,signedAt:p.signedAt,doctor:p.appointment.doctor.user.fullName,license:p.appointment.doctor.licenseNumber,clinic:p.appointment.clinic.name,verificationCode:code};
  }
  async prescription(actor:Actor,id:string){const p=await this.db.prescription.findUnique({where:{id},include:{appointment:{include:{patient:{select:{fullName:true}},doctor:{include:{user:{select:{fullName:true}}}},clinic:true}}}});if(!p)throw new NotFoundException('Prescription not found');canReadClinical(actor,p.appointment);return p;}
  async revoke(actor:Actor,id:string){const p=await this.prescription(actor,id);if(actor.id!==p.doctorId)throw new ForbiddenException('Prescribing doctor required');assertTransition('prescription',p.status,'REVOKED');const changed=await this.db.prescription.updateMany({where:{id,status:'SIGNED'},data:{status:'REVOKED'}});if(!changed.count)throw new ConflictException('Prescription changed');await this.db.auditLog.create({data:{actorId:actor.id,clinicId:p.appointment.clinicId,action:'PRESCRIPTION_REVOKED',entity:'Prescription',entityId:id}});return {ok:true};}
}
