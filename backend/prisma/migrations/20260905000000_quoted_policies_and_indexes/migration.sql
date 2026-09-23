-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "refundPolicy" JSONB;

-- AlterTable
ALTER TABLE "SlotHold" ADD COLUMN     "refundPolicy" JSONB;

-- CreateIndex
CREATE INDEX "Appointment_status_completedAt_idx" ON "Appointment"("status", "completedAt");

-- CreateIndex
CREATE INDEX "LedgerEntry_paymentId_idx" ON "LedgerEntry"("paymentId");

-- CreateIndex
CREATE INDEX "ReconciliationRun_status_startedAt_idx" ON "ReconciliationRun"("status", "startedAt");
