import { WebSocketGateway, WebSocketServer, OnGatewayConnection } from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import { PrismaService } from '../common/prisma.service';
import { DateTime } from 'luxon';
@WebSocketGateway({
  namespace: '/ws',
  path: '/socket.io',
  addTrailingSlash: false,
  cors: { origin: false },
})
export class RealtimeGateway implements OnGatewayConnection {
  @WebSocketServer() server!: Server;
  constructor(
    private jwt: JwtService,
    private db: PrismaService,
  ) {}
  async handleConnection(client: Socket) {
    try {
      const cookies = Object.fromEntries(
        (client.handshake.headers.cookie || '').split(';').map((c) => c.trim().split('=')),
      );
      const payload = this.jwt.verify(cookies.access || client.handshake.auth.token, {
        secret: process.env.JWT_ACCESS_SECRET,
        issuer: 'careflow',
        audience: 'careflow-web',
      });
      const user = await this.db.user.findFirst({
        where: {
          id: payload.sub,
          deletedAt: null,
          sessions: { some: { id: payload.sid || 'missing', expiresAt: { gt: new Date() } } },
        },
        include: { roles: true },
      });
      if (!user) throw new Error();
      client.join(`session:${payload.sid}`);
      client.join(`user:${user.id}`);
      client.join(`doctor:${user.id}`);
      for (const role of user.roles.filter((r) =>
        ['CLINIC_ADMIN', 'RECEPTIONIST', 'NURSE'].includes(r.role),
      ))
        client.join(`clinic:${role.clinicId}`);
      // Access tokens cannot keep a websocket alive after their expiry.
      const timer = setTimeout(
        () => client.disconnect(true),
        Math.max(0, payload.exp * 1000 - Date.now()),
      );
      client.on('disconnect', () => clearTimeout(timer));
    } catch {
      client.disconnect(true);
    }
  }
  appointmentUpdated(a: {
    id: string;
    clinicId: string;
    doctorId: string;
    patientId: string;
    status: string;
  }) {
    this.server
      ?.to([`clinic:${a.clinicId}`, `doctor:${a.doctorId}`, `user:${a.patientId}`])
      .emit('appointment.updated', { id: a.id, status: a.status });
  }
  disconnectSession(sessionId: string) {
    this.server?.to(`session:${sessionId}`).disconnectSockets(true);
  }
  disconnectUser(userId: string) {
    this.server?.to(`user:${userId}`).disconnectSockets(true);
  }
  holdExpiring(userId: string, id: string, expiresAt: Date) {
    this.server?.to(`user:${userId}`).emit('hold.expiring', { id, expiresAt });
  }
  message(patientId: string, doctorId: string, appointmentId: string) {
    this.server
      ?.to([`user:${patientId}`, `doctor:${doctorId}`])
      .emit('tele.message', { appointmentId });
  }
  async refreshQueue(doctorId: string, clinicId: string) {
    const clinic = await this.db.clinic.findUnique({ where: { id: clinicId } });
    if (!clinic) return;
    const date = DateTime.now().setZone(clinic.timezone).toISODate()!;
    const queue = await this.db.appointment.findMany({
      where: { doctorId, clinicId, queueDate: date, status: { in: ['CHECKED_IN', 'IN_PROGRESS'] } },
      orderBy: [{ priority: 'desc' }, { startAt: 'asc' }, { checkedInAt: 'asc' }],
    });
    let position = 0;
    for (const a of queue) {
      if (a.status !== 'IN_PROGRESS') position++;
      this.server?.to(`user:${a.patientId}`).emit('queue.position', {
        appointmentId: a.id,
        position: a.status === 'IN_PROGRESS' ? 0 : position,
        number: a.queueNumber,
      });
    }
    this.server
      ?.to([`clinic:${clinicId}`, `doctor:${doctorId}`])
      .emit('queue.updated', { clinicId, doctorId });
  }
  teleUpdated(patientId: string, doctorId: string, status: string) {
    this.server?.to([`user:${patientId}`, `doctor:${doctorId}`]).emit('tele.updated', { status });
  }
}
