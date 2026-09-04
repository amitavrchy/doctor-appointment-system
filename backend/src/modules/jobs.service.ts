import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Queue, Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import { createTransport } from 'nodemailer';
import { PrismaService } from '../common/prisma.service';
import { paymentProvider } from './payment.providers';
@Injectable()
export class JobsService implements OnModuleInit,OnModuleDestroy {
  redis=new Redis(process.env.REDIS_URL!,{maxRetriesPerRequest:null});
  private queue!:Queue;private worker!:Worker;private timer?:NodeJS.Timeout;private scanning=false;
  constructor(private db:PrismaService){}
  async onModuleInit(){
    const connection={host:new URL(process.env.REDIS_URL!).hostname,port:Number(new URL(process.env.REDIS_URL!).port||6379),password:new URL(process.env.REDIS_URL!).password||undefined};
    this.queue=new Queue('careflow',{connection,defaultJobOptions:{attempts:5,backoff:{type:'exponential',delay:5000},removeOnComplete:{age:7*86400},removeOnFail:{age:30*86400}}});
    this.worker=new Worker('careflow',job=>this.process(job),{connection,concurrency:5});
    this.worker.on('failed',job=>console.error(`Background job ${job?.name} failed; inspect queue metadata.`));
    await this.scan();this.timer=setInterval(()=>{void this.scan().catch(()=>console.error('Background scan failed'));},60000);
  }
  async scan(){if(this.scanning)return;this.scanning=true;try{
    await this.db.slotHold.deleteMany({where:{expiresAt:{lte:new Date()}}});
    await this.db.appointment.updateMany({where:{status:'CONFIRMED',startAt:{lt:new Date(Date.now()-30*60000)}},data:{status:'NO_SHOW'}});
    await this.db.prescription.updateMany({where:{status:'SIGNED',expiresAt:{lt:new Date()}},data:{status:'EXPIRED'}});
    await this.db.otpChallenge.deleteMany({where:{expiresAt:{lt:new Date()}}});
    await this.db.refreshSession.deleteMany({where:{expiresAt:{lt:new Date()}}});
    const payments=await this.db.payment.findMany({where:{status:'REFUND_PENDING'}});
    for(const p of payments)await this.queue.add('refund',{paymentId:p.id},{jobId:`refund-${p.id}`});
    const upcoming=await this.db.appointment.findMany({where:{status:'CONFIRMED',startAt:{gt:new Date(),lt:new Date(Date.now()+24*3600000)}}});
    for(const a of upcoming)for(const minutes of [1440,120,15]){const diff=(a.startAt.getTime()-Date.now())/60000;if(diff<=minutes&&diff>minutes-2)await this.queue.add('reminder',{appointmentId:a.id,minutes},{jobId:`reminder-${a.id}-${minutes}`});}
    const waitlist=await this.db.waitlistEntry.findMany({where:{status:'ACTIVE'}});
    for(const entry of waitlist){const cancelled=await this.db.appointment.findFirst({where:{doctorId:entry.doctorId,clinicId:entry.clinicId,status:'CANCELLED',updatedAt:{gt:entry.createdAt},startAt:{gt:entry.preferredStart&&entry.preferredStart>new Date()?entry.preferredStart:new Date(),...(entry.preferredEnd?{lt:entry.preferredEnd}:{})}}});if(cancelled)await this.queue.add('waitlist',{entryId:entry.id},{jobId:`waitlist-${entry.id}`});}
  }finally{this.scanning=false;}}
  private async process(job:Job){
    if(job.name==='refund'){const p=await this.db.payment.findUniqueOrThrow({where:{id:job.data.paymentId}});if(p.status!=='REFUND_PENDING')return;if(p.refundMinor>0&&p.providerRef)await paymentProvider(p.provider).refund(p.providerRef,p.refundMinor,`refund-${p.id}`);await this.db.payment.updateMany({where:{id:p.id,status:'REFUND_PENDING'},data:{status:'REFUNDED'}});return;}
    if(job.name==='waitlist'){await this.db.$transaction(async tx=>{const entry=await tx.waitlistEntry.findUniqueOrThrow({where:{id:job.data.entryId}});const updated=await tx.waitlistEntry.updateMany({where:{id:entry.id,status:'ACTIVE'},data:{status:'OFFERED'}});if(updated.count)await tx.notification.create({data:{userId:entry.patientId,title:'An appointment slot opened',body:'A cancellation matched your waitlist. Open Find a doctor to view current availability. Slots are offered to all matching patients and are not reserved.'}});});return;}
    if(job.name==='reminder'){const a=await this.db.appointment.findUniqueOrThrow({where:{id:job.data.appointmentId},include:{patient:true,clinic:true}});if(a.status!=='CONFIRMED')return;const title='Appointment reminder';const body=`Your appointment at ${a.clinic.name} starts at ${a.startAt.toISOString()}. ${a.type==='TELEMEDICINE'?`Join: ${process.env.APP_URL}/telemedicine`:''}`;if(process.env.SMTP_URL)await createTransport(process.env.SMTP_URL).sendMail({from:'Careflow <no-reply@careflow.local>',to:a.patient.email,subject:title,text:body});if(process.env.SMS_API_URL&&process.env.SMS_API_KEY&&a.patient.phone){const response=await fetch(process.env.SMS_API_URL,{method:'POST',headers:{Authorization:`Bearer ${process.env.SMS_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({to:a.patient.phone,text:body})});if(!response.ok)throw new Error('SMS delivery failed');}await this.db.notification.upsert({where:{id:job.id!},create:{id:job.id!,userId:a.patientId,title,body},update:{}});}
  }
  async onModuleDestroy(){if(this.timer)clearInterval(this.timer);await this.worker?.close();await this.queue?.close();await this.redis.quit();}
}
