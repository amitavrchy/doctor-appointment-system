CREATE UNIQUE INDEX "appointment_doctor_start_active_uq" ON "Appointment" ("doctorId", "startAt") WHERE "status" IN ('HELD','PENDING_PAYMENT','CONFIRMED','CHECKED_IN','IN_PROGRESS');
CREATE INDEX "clinical_note_search_idx" ON "ClinicalNote" USING GIN ("searchVector");
ALTER TABLE "Appointment" ADD CONSTRAINT "appointment_positive_window" CHECK ("endAt" > "startAt");
ALTER TABLE "SlotHold" ADD CONSTRAINT "hold_positive_window" CHECK ("endAt" > "startAt");
ALTER TABLE "Payment" ADD CONSTRAINT "payment_nonnegative_amount" CHECK ("amountMinor" >= 0 AND "refundMinor" >= 0 AND "refundMinor" <= "amountMinor");
ALTER TABLE "DoctorScheduleRule" ADD CONSTRAINT "schedule_positive_duration" CHECK ("slotDurationMinutes" > 0 AND "bufferMinutes" >= 0 AND "maxParallel" = 1);
