import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { JobsService } from './modules/jobs.service';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import type { Request, Response, NextFunction } from 'express';
import { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaService } from './common/prisma.service';
async function bootstrap(){
  for(const key of ['DATABASE_URL','REDIS_URL','JWT_ACCESS_SECRET','JWT_REFRESH_SECRET','OTP_PEPPER'])if(!process.env[key])throw new Error(`${key} is required`);
  if(process.env.NODE_ENV==='production'&&process.env.DEMO_MODE==='true')throw new Error('DEMO_MODE must be disabled for production');
  for(const key of ['JWT_ACCESS_SECRET','JWT_REFRESH_SECRET','OTP_PEPPER'])if(process.env[key]!.length<32)throw new Error(`${key} must contain at least 32 characters`);
  const app=await NestFactory.create<NestExpressApplication>(AppModule,{rawBody:true});
  app.useBodyParser('json',{limit:'8mb'});
  app.enableShutdownHooks();app.use(helmet());app.use(cookieParser());
  const origins=(process.env.CORS_ORIGINS||'http://localhost:3000').split(',');app.enableCors({origin:origins,credentials:true});
  const redis=app.get(JobsService).redis;
  app.use(async(req:Request,res:Response,next:NextFunction)=>{
    res.setHeader('Cache-Control','no-store');
    if(!['GET','HEAD','OPTIONS'].includes(req.method)&&req.headers.origin&&!origins.includes(req.headers.origin)){res.status(403).json({message:'Origin is not allowed'});return;}
    try{const auth=req.path.startsWith('/auth/')&&req.method==='POST';const bucket=`rate:${auth?'auth':'api'}:${req.ip}:${Math.floor(Date.now()/60000)}`;const count=await redis.incr(bucket);if(count===1)await redis.expire(bucket,61);if(count>(auth?20:300)){res.status(429).json({message:'Too many requests. Try again in a minute.'});return;}next();}catch{res.status(503).json({message:'Service is temporarily unavailable'});}
  });
  app.getHttpAdapter().getInstance().get('/health',async(_req:Request,res:Response)=>{try{await app.get(JobsService).redis.ping();await app.get(PrismaService).$queryRaw`SELECT 1`;res.json({status:'ok',service:'careflow-api'});}catch{res.status(503).json({status:'unavailable'});}});
  await app.listen(Number(process.env.PORT||4000),'0.0.0.0');
}
void bootstrap();
