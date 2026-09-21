import { Injectable, BadRequestException, ConflictException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { AppointmentStatus } from '@prisma/client';
import { DateTime } from 'luxon';
import { PrismaService } from '../common/prisma.service';
import { Actor, canReadAppointment, hasRole, requireRole } from '../common/access';
import { lockDoctors } from '../common/locks/pg-advisory.lock';
import { SchedulesService } from './schedules.service';
import { assertTransition, refundAmount } from '../common/domain';
import { RealtimeGateway } from './realtime.gateway';
export const appointmentInclude = {doctor:{include:{user:{select:{fullName:true}}}},clinic:true,patient:{select:{id:true,fullName:true,email:true}},payment:true,teleSession:true} as const;
@Injectable()
export class AppointmentsService {
  constructor(private db:PrismaService,private schedules:SchedulesService,private realtime:RealtimeGateway) {}
  async get(actor:Actor,id:string) {
    const a = await this.db.appointment.findUnique({where:{id},include:appointmentInclude});
    if (!a) throw new NotFoundException('Appointment not found');canReadAppointment(actor,a);return a;
  }
  list(actor:Actor,clinicId?:string) {
    const privileged = clinicId && hasRole(actor,clinicId,['CLINIC_ADMIN','RECEPTIONIST','NURSE']);
    return this.db.appointment.findMany({where:{...(clinicId?{clinicId}:{}),...(!privileged&&actor.globalRole!=='SUPER_ADMIN'?{OR:[{patientId:actor.id},{doctorId:actor.id}]}:{})},include:appointmentInclude,orderBy:{startAt:'desc'},take:200});
  }
  async hold(actor:Actor,i:{doctorId:string;clinicId:string;startAt:string;type:string;patientId?:string}) {
    if(i.type==='TELEMEDICINE'&&(await this.db.featureFlag.findUnique({where:{key:'TELEMEDICINE_ENABLED'}}))?.enabled===false)throw new BadRequestException('Telemedicine booking is temporarily unavailable');
    const patientId = i.patientId || actor.id;
    if (patientId !== actor.id) requireRole(actor,i.clinicId,['RECEPTIONIST','CLINIC_ADMIN']);
    if (!await this.db.user.findFirst({where:{id:patientId,deletedAt:null}})) throw new BadRequestException('Patient not found');
    const clinic = await this.db.clinic.findUnique({where:{id:i.clinicId}});
    if (!clinic) throw new NotFoundException('Clinic not found');
    return this.db.$transaction(async tx=>{
      await lockDoctors(tx,i.doctorId);
      await tx.slotHold.deleteMany({where:{doctorId:i.doctorId,expiresAt:{lte:new Date()}}});
      const existing=await tx.slotHold.findUnique({where:{doctorId_startAt:{doctorId:i.doctorId,startAt:new Date(i.startAt)}}});
      if (existing?.patientId===patientId&&existing.clinicId===i.clinicId&&existing.type===i.type) return existing;
      const date = DateTime.fromISO(i.startAt).setZone(clinic.timezone).toISODate()!;
      const slots=await this.schedules.slots(i.doctorId,i.clinicId,date,date,i.type,tx);
      const slot=slots.find(s=>s.startAt.getTime()===new Date(i.startAt).getTime()&&s.available);
      if (!slot) throw new ConflictException('This slot is no longer available. Choose another time.');
      return tx.slotHold.create({data:{doctorId:i.doctorId,clinicId:i.clinicId,patientId,startAt:slot.startAt,endAt:slot.endAt,type:slot.type,feeMinor:slot.feeMinor,roomId:slot.roomId,expiresAt:new Date(Date.now()+180000)}});
    },{timeout:15000,maxWait:30000});
  }
  async release(actor:Actor,id:string) {
    const h=await this.db.slotHold.findUnique({where:{id}});
    if (!h) return {ok:true};
    if(h.patientId!==actor.id) requireRole(actor,h.clinicId,['RECEPTIONIST','CLINIC_ADMIN']);
    await this.db.$transaction(async tx=>{await lockDoctors(tx,h.doctorId);await tx.slotHold.deleteMany({where:{id}});});return {ok:true};
  }
  async confirm(actor:Actor,holdId:string,key:string,reason?:string,rescheduledFromId?:string) {
    const previous=await this.db.appointment.findUnique({where:{idempotencyKey:key},include:appointmentInclude});
    if(previous){canReadAppointment(actor,previous);return previous;}
    const hold=await this.db.slotHold.findUnique({where:{id:holdId}});
    if(!hold) throw new ConflictException('Your hold expired. Select a time again.');
    if(hold.patientId!==actor.id) requireRole(actor,hold.clinicId,['RECEPTIONIST','CLINIC_ADMIN']);
    const old = rescheduledFromId ? await this.get(actor,rescheduledFromId):null;
    if (old && old.patientId!==hold.patientId) throw new ForbiddenException('Patient does not match');
    const result=await this.db.$transaction(async tx=>{
      await lockDoctors(tx,hold.doctorId,...(old?[old.doctorId]:[]));
      const duplicate=await tx.appointment.findUnique({where:{idempotencyKey:key},include:appointmentInclude});
      if(duplicate){canReadAppointment(actor,duplicate);return duplicate;}
      const current=await tx.slotHold.findUnique({where:{id:holdId}});
      if(!current||current.expiresAt<=new Date()) throw new ConflictException('Your hold expired. Select a time again.');
      const clinic=await tx.clinic.findUniqueOrThrow({where:{id:hold.clinicId}});
      const date=DateTime.fromJSDate(hold.startAt).setZone(clinic.timezone).toISODate()!;
      const slots=await this.schedules.slots(hold.doctorId,hold.clinicId,date,date,hold.type,tx,hold.id);
      if(!slots.some(s=>s.startAt.getTime()===hold.startAt.getTime()&&s.available)) throw new ConflictException('Schedule changed. Choose another time.');
      if(old){
        const prior=await tx.appointment.findUniqueOrThrow({where:{id:old.id},include:{payment:true}});
        assertTransition('appointment',prior.status,'RESCHEDULED');
        if(prior.startAt<=new Date()) throw new ConflictException('Past appointments cannot be rescheduled');
        await tx.appointment.update({where:{id:old.id},data:{status:'RESCHEDULED'}});
        if(prior.payment?.status==='SUCCEEDED') await tx.payment.update({where:{id:prior.payment.id},data:{status:'REFUND_PENDING',refundMinor:refundAmount(prior.feeMinor,prior.startAt)}});
        await tx.telemedicineSession.updateMany({where:{appointmentId:old.id},data:{status:'CANCELLED'}});
      }
      const a=await tx.appointment.create({data:{doctorId:hold.doctorId,clinicId:hold.clinicId,patientId:hold.patientId,roomId:hold.roomId,startAt:hold.startAt,endAt:hold.endAt,type:hold.type,feeMinor:hold.feeMinor,idempotencyKey:key,reason,rescheduledFromId,status:'CONFIRMED',payment:{create:{provider:process.env.PAYMENT_PROVIDER||'demo',amountMinor:hold.feeMinor,idempotencyKey:`payment:${key}`}},...(hold.type==='TELEMEDICINE'?{teleSession:{create:{provider:process.env.TELEMEDICINE_PROVIDER||'demo',roomName:`careflow-${key}`}}}:{})},include:appointmentInclude});
      await tx.slotHold.delete({where:{id:hold.id}});
      await tx.notification.create({data:{userId:hold.patientId,title:old?'Appointment rescheduled':'Appointment confirmed',body:`Your appointment at ${clinic.name} is confirmed.`}});
      await tx.auditLog.create({data:{actorId:actor.id,action:old?'APPOINTMENT_RESCHEDULED':'APPOINTMENT_BOOKED',entity:'Appointment',entityId:a.id,clinicId:a.clinicId}});
      return a;
    },{timeout:15000,maxWait:30000});
    this.realtime.appointmentUpdated(result);return result;
  }
  async transition(actor:Actor,id:string,status:AppointmentStatus,reason?:string) {
    const a=await this.get(actor,id);
    if(status==='CANCELLED'&&actor.id!==a.patientId&&actor.id!==a.doctorId)requireRole(actor,a.clinicId,['RECEPTIONIST','CLINIC_ADMIN']);
    if(status!=='CANCELLED') {
      if(actor.id!==a.doctorId) requireRole(actor,a.clinicId,status==='CHECKED_IN'?['RECEPTIONIST','CLINIC_ADMIN']:['DOCTOR']);
      if(['IN_PROGRESS','COMPLETED'].includes(status)&&actor.id!==a.doctorId) throw new ForbiddenException('Only the treating doctor can update the consultation');
    }
    const result=await this.db.$transaction(async tx=>{
      await lockDoctors(tx,a.doctorId);
      const current=await tx.appointment.findUniqueOrThrow({where:{id},include:{payment:true}});
      assertTransition('appointment',current.status,status);
      if(status==='CANCELLED'&&current.startAt<=new Date()&&actor.id===current.patientId) throw new ConflictException('Past appointments cannot be cancelled');
      if(status==='CANCELLED'&&current.payment?.status==='SUCCEEDED') {
        const amount=refundAmount(current.feeMinor,current.startAt,new Date(),actor.id===current.doctorId);
        if(amount>0) await tx.payment.update({where:{id:current.payment.id},data:{status:'REFUND_PENDING',refundMinor:amount}});
      }
      if(status==='CANCELLED') await tx.telemedicineSession.updateMany({where:{appointmentId:id},data:{status:'CANCELLED'}});
      const result=await tx.appointment.update({where:{id},data:{status,...(status==='CANCELLED'?{cancelReason:reason||'Cancelled by user'}:{}),...(status==='CHECKED_IN'?{checkedInAt:new Date()}: {})},include:appointmentInclude});
      await tx.auditLog.create({data:{actorId:actor.id,clinicId:a.clinicId,action:`APPOINTMENT_${status}`,entity:'Appointment',entityId:id}});
      return result;
    });
    this.realtime.appointmentUpdated(result);return result;
  }
}
