import { WebSocketGateway, WebSocketServer, OnGatewayConnection } from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import { PrismaService } from '../common/prisma.service';
@WebSocketGateway({namespace:'/ws',cors:{origin:false}})
export class RealtimeGateway implements OnGatewayConnection {
  @WebSocketServer() server!:Server;
  constructor(private jwt:JwtService,private db:PrismaService) {}
  async handleConnection(client:Socket) {
    try {
      const cookies=Object.fromEntries((client.handshake.headers.cookie||'').split(';').map(c=>c.trim().split('=')));
      const payload=this.jwt.verify(cookies.access||client.handshake.auth.token,{secret:process.env.JWT_ACCESS_SECRET});
      const user=await this.db.user.findFirst({where:{id:payload.sub,deletedAt:null},include:{roles:true}});
      if(!user) throw new Error();
      client.join(`user:${user.id}`);client.join(`doctor:${user.id}`);
      for(const role of user.roles.filter(r=>['CLINIC_ADMIN','RECEPTIONIST','NURSE'].includes(r.role))) client.join(`clinic:${role.clinicId}`);
      // Access tokens cannot keep a websocket alive after their expiry.
      const timer=setTimeout(()=>client.disconnect(true),Math.max(0,payload.exp*1000-Date.now()));client.on('disconnect',()=>clearTimeout(timer));
    } catch {client.disconnect(true);}
  }
  appointmentUpdated(a:{id:string;clinicId:string;doctorId:string;patientId:string;status:string}) {
    this.server?.to([`clinic:${a.clinicId}`,`doctor:${a.doctorId}`,`user:${a.patientId}`]).emit('appointment.updated',{id:a.id,status:a.status});
  }
  teleUpdated(patientId:string,doctorId:string,status:string) {this.server?.to([`user:${patientId}`,`doctor:${doctorId}`]).emit('tele.updated',{status});}
}
