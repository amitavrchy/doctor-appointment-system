import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';
@Injectable()
export class AuditService {
  constructor(private db:PrismaService) {}
  record(actorId:string,action:string,entity:string,entityId?:string,clinicId?:string) {
    return this.db.auditLog.create({data:{actorId,action,entity,entityId,clinicId}});
  }
}
