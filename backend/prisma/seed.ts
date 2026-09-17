import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { hash, argon2id } from 'argon2';
import { DateTime } from 'luxon';
const db=new PrismaClient();
async function main(){
  if(process.env.DEMO_MODE!=='true')throw new Error('Demo seed requires DEMO_MODE=true');
  const password=process.env.SEED_PASSWORD;if(!password||password.length<12)throw new Error('Set a SEED_PASSWORD of at least 12 characters');
  const passwordHash=await hash(password,{type:argon2id});
  const clinics=[{id:'clinic-dhanmondi',name:'Dhanmondi Care Center',slug:'dhanmondi',address:'House 24, Road 7, Dhanmondi, Dhaka',lat:23.7461,lng:90.3742},{id:'clinic-gulshan',name:'Gulshan Health Studio',slug:'gulshan',address:'House 18, Road 11, Gulshan 1, Dhaka',lat:23.7806,lng:90.4163}];
  for(const clinic of clinics){await db.clinic.upsert({where:{id:clinic.id},create:clinic,update:{}});await db.room.upsert({where:{clinicId_name:{clinicId:clinic.id,name:'Consultation 01'}},create:{clinicId:clinic.id,name:'Consultation 01'},update:{}});}
  const people=[{id:'patient-demo',email:'patient@careflow.demo',fullName:'Amitav Roy Chowdhury',globalRole:'PATIENT'},{id:'admin-demo',email:'admin@careflow.demo',fullName:'Nadia Rahman',globalRole:'SUPER_ADMIN'},{id:'reception-demo',email:'reception@careflow.demo',fullName:'Rafi Ahmed',globalRole:'PATIENT'}];
  const doctors=[['doctor-sara','Dr. Sara Ahmed','Cardiology','teal'],['doctor-imran','Dr. Imran Hasan','General Medicine','blue'],['doctor-ayesha','Dr. Ayesha Khan','Dermatology','rose'],['doctor-rahim','Dr. Rahim Uddin','Neurology','amber'],['doctor-nusrat','Dr. Nusrat Jahan','Pediatrics','violet']];
  for(let index=0;index<20;index++)people.push({id:`patient-${index}`,email:`patient${index+1}@careflow.demo`,fullName:['Farhana Islam','Tanvir Hasan','Maliha Chowdhury','Arif Rahman','Sadia Akter'][index%5]+(index>4?` ${index+1}`:''),globalRole:'PATIENT'});
  for(const [id,fullName] of doctors)people.push({id,email:`${id.replace('doctor-','')}@careflow.demo`,fullName,globalRole:'PATIENT'});
  for(const person of people)await db.user.upsert({where:{id:person.id},create:{...person,passwordHash,allergies:person.id==='patient-demo'?['Penicillin']:[],bloodGroup:'B+',dateOfBirth:new Date('1997-04-18')},update:{}});
  const role=async(userId:string,clinicId:string,role:string)=>db.userClinicRole.upsert({where:{userId_clinicId_role:{userId,clinicId,role}},create:{userId,clinicId,role},update:{}});
  await role('admin-demo',clinics[0].id,'CLINIC_ADMIN');await role('admin-demo',clinics[1].id,'CLINIC_ADMIN');await role('reception-demo',clinics[0].id,'RECEPTIONIST');
  const today=DateTime.now().setZone('Asia/Dhaka').startOf('day');
  for(const [index,[userId,fullName,specialty,color]] of doctors.entries()){
    await db.doctorProfile.upsert({where:{userId},create:{userId,specialties:[specialty],licenseNumber:`BMDC-${84021+index}`,bio:`${fullName} offers thoughtful, evidence-informed ${specialty.toLowerCase()} consultations with time to listen and answer your questions.`,languages:['Bangla','English'],color},update:{}});
    for(const clinic of clinics){await role(userId,clinic.id,'DOCTOR');await db.doctorClinic.upsert({where:{doctorId_clinicId:{doctorId:userId,clinicId:clinic.id}},create:{doctorId:userId,clinicId:clinic.id,feeMinor:(1000+index*200)*100,teleFeeMinor:(800+index*100)*100},update:{}});
      for(const type of ['IN_PERSON','TELEMEDICINE']){const id=`rule-${userId}-${clinic.id}-${type}`;const start=clinic.id===clinics[0].id?(type==='IN_PERSON'?'09:00':'12:00'):(type==='IN_PERSON'?'15:00':'18:00');const end=clinic.id===clinics[0].id?(type==='IN_PERSON'?'12:00':'14:00'):(type==='IN_PERSON'?'18:00':'20:00');await db.doctorScheduleRule.upsert({where:{id},create:{id,doctorId:userId,clinicId:clinic.id,rrule:'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR,SA,SU',startTimeLocal:start,endTimeLocal:end,slotDurationMinutes:30,bufferMinutes:0,effectiveFrom:today.minus({days:30}).toJSDate(),consultationType:type,feeMinor:type==='IN_PERSON'?(1000+index*200)*100:(800+index*100)*100},update:{}});}
    }
  }
  for(let index=0;index<16;index++){
    const doctor=doctors[index%5];const start=today.plus({days:index<6?index+1:-(index-4),hours:9+(index%3),minutes:index%2*30});const patientId=index%2===0?'patient-demo':`patient-${index}`;const id=`seed-appointment-${index}`;const type=index%3===0?'TELEMEDICINE':'IN_PERSON';const completed=index>=6;
    await db.appointment.upsert({where:{id},create:{id,clinicId:clinics[0].id,doctorId:doctor[0],patientId,type,status:completed?'COMPLETED':'CONFIRMED',startAt:start.toJSDate(),endAt:start.plus({minutes:30}).toJSDate(),feeMinor:120000,idempotencyKey:id,reason:completed?'Follow-up consultation':'Routine health consultation',payment:{create:{provider:'demo',status:completed?'SUCCEEDED':'CREATED',amountMinor:120000,idempotencyKey:`pay-${id}`,providerRef:completed?`demo-${id}`:null}},...(type==='TELEMEDICINE'?{teleSession:{create:{provider:'demo',roomName:`room-${id}`,status:completed?'ENDED':'SCHEDULED'}}}:{}),...(completed?{notes:{create:{authorId:doctor[0],soap:{subjective:'Patient reports improved wellbeing.',objective:'Follow-up observations recorded.',assessment:'Stable at follow-up.',plan:'Continue the agreed care plan and return as advised.'}}},prescription:{create:{doctorId:doctor[0],status:'SIGNED',signedAt:start.toJSDate(),expiresAt:start.plus({days:90}).toJSDate(),signature:'demo-seed-signature',verificationCode:`verify-${id}`,items:[{name:'Demonstration medication',dosage:'Example only',frequency:'As prescribed',duration:'7 days',route:'Oral',instructions:'Synthetic demo record. Not medical advice.'}]}}}:{})},update:{}});
  }
  await db.notification.upsert({where:{id:'welcome'},create:{id:'welcome',userId:'patient-demo',title:'A little care, all in one place',body:'Welcome to Careflow. Find your doctor, book a visit, and keep your care history together.'},update:{}});
  console.log('Seed complete: 2 clinics, 5 doctors, 21 patients, staff, schedules and synthetic care history.');
}
main().finally(()=>db.$disconnect());
