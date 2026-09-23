import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PrismaService } from './common/prisma.service';
import { AuditService } from './common/audit.service';
import { AuthGuard } from './common/access';
import { AuthService } from './modules/auth.service';
import { AuthController } from './modules/auth.controller';
import { SchedulesService } from './modules/schedules.service';
import { SchedulesController } from './modules/schedules.controller';
import { AppointmentsService } from './modules/appointments.service';
import { AppointmentsController } from './modules/appointments.controller';
import { ClinicsController } from './modules/clinics.controller';
import { ClinicalService } from './modules/clinical.service';
import { ClinicalController } from './modules/clinical.controller';
import { PaymentsController } from './modules/payments.controller';
import { PdfService } from './modules/pdf.service';
import { RealtimeGateway } from './modules/realtime.gateway';
import { TelemedicineController } from './modules/telemedicine.controller';
import { OperationsController } from './modules/operations.controller';
import { JobsService } from './modules/jobs.service';
import { AdminController } from './modules/admin.controller';
import { DocumentsController } from './modules/documents.controller';
import { QueueController } from './modules/queue.controller';
import { ScheduleManagementController } from './modules/schedule-management.controller';
import { ClinicalWorkflowsController } from './modules/clinical-workflows.controller';
import { SecurityController } from './modules/security.controller';
import { PreferencesController } from './modules/preferences.controller';
import { ObjectStorageService } from './common/object-storage.service';
import { FinanceController } from './modules/finance.controller';
import { PaymentReturnsController } from './modules/payment-returns.controller';
import { ReconciliationService } from './modules/reconciliation.service';
import { JobsController } from './modules/jobs.controller';
@Module({
  imports: [JwtModule.register({})],
  controllers: [
    AuthController,
    ClinicsController,
    SchedulesController,
    AppointmentsController,
    ClinicalController,
    PaymentsController,
    TelemedicineController,
    OperationsController,
    DocumentsController,
    AdminController,
    QueueController,
    ScheduleManagementController,
    ClinicalWorkflowsController,
    SecurityController,
    PreferencesController,
    FinanceController,
    PaymentReturnsController,
    JobsController,
  ],
  providers: [
    PrismaService,
    AuditService,
    AuthGuard,
    AuthService,
    SchedulesService,
    AppointmentsService,
    ClinicalService,
    PdfService,
    RealtimeGateway,
    JobsService,
    ObjectStorageService,
    ReconciliationService,
  ],
})
export class AppModule {}
