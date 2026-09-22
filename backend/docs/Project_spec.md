# Doctor Appointment System — Project Spec

> Stack: **Next.js (App Router) + NestJS + Prisma + PostgreSQL + Redis/BullMQ + Socket.IO**  
> Goal: Production-grade multi-clinic appointment, telemedicine, e-prescription, and billing platform suitable for portfolio demonstration of advanced concurrency, scheduling, and healthcare workflows.

---

## 1. Overview & Goals

### Product
A multi-clinic healthcare platform where patients book appointments (in-person or telemedicine), doctors manage recurring schedules with exceptions, clinics prevent overbooking via transactional locks, and staff issue e-prescriptions with full patient history.

### Engineering goals
- Demonstrate **optimistic/pessimistic locking** for slot booking race conditions.
- **Recurring schedule engine** with RRULE-like recurrence + exception dates.
- **State machines** for Appointment, Prescription, Payment, TelemedicineSession.
- RBAC across Patient / Doctor / ClinicAdmin / Receptionist / SuperAdmin.
- Audit trail for PHI-adjacent actions (login as if HIPAA-aware; Bangladesh-friendly privacy practices).
- Background jobs: reminders (SMS/email), no-show detection, prescription expiry, payout reconciliation.

### Non-goals (v1)
- Full HL7/FHIR interoperability (document adapter interfaces only).
- Native mobile apps (PWA-ready Next.js is enough).
- Drug inventory / pharmacy fulfillment (e-Rx PDF + share link only).

---

## 2. User Roles & Permissions (RBAC)

| Role | Scope | Key permissions |
|------|-------|-----------------|
| `SUPER_ADMIN` | Platform | Manage clinics, feature flags, global users |
| `CLINIC_ADMIN` | Clinic | Doctors, rooms, schedules, billing config, reports |
| `DOCTOR` | Own profile + assigned clinics | Schedule, appointments, notes, prescriptions, telemedicine |
| `RECEPTIONIST` | Clinic | Book/cancel/reschedule for patients, check-in, collect payment |
| `PATIENT` | Self | Book, cancel (policy), view history, join telemedicine, pay |
| `NURSE` (optional) | Clinic | Vitals entry, assist check-in |

### Permission model
- Tables: `User`, `Role`, `Permission`, `RolePermission`, `UserClinicRole` (user can have different roles per clinic).
- NestJS: `@Roles()` + `@ClinicScope()` guards; Prisma middleware filters by `clinicId` when role ≠ SUPER_ADMIN.
- Soft-delete users; never hard-delete clinical records.

---

## 3. Feature Modules

### 3.1 Auth & Profiles
- Email/phone OTP + password; JWT access + refresh rotation; device sessions.
- Patient profile: DOB, blood group, allergies, emergency contact.
- Doctor profile: specialties, licenses, languages, consultation fee (in-person vs tele).

### 3.2 Multi-clinic
- Clinic entity: timezone, address, GeoJSON point, rooms, services.
- Doctor can work at multiple clinics with different fees/schedules.
- Cross-clinic patient history visible only with consent flag OR same national ID hash match (document privacy rule clearly in UI).

### 3.3 Schedule engine
- `DoctorScheduleRule`: weekday bitmask or RRULE (`FREQ=WEEKLY;BYDAY=MO,WE`), `startTime`, `endTime`, `slotDurationMinutes`, `bufferMinutes`, `maxParallel` (usually 1), `effectiveFrom`/`effectiveTo`, `clinicId`, `roomId?`.
- `ScheduleException`: date + type `DAY_OFF | CUSTOM_HOURS | BLOCK`, optional custom windows.
- Generated virtual slots (not all persisted): algorithm expands rules for date range; materialize `AppointmentSlot` only on book/hold (or cache generated slots in Redis for 24h).

### 3.4 Booking & overbooking prevention
- Flow: Search → Hold slot (2–5 min TTL) → Confirm + pay (or pay-later policy) → Confirmed.
- **Critical logic**: `SELECT … FOR UPDATE` on `SlotHold` / unique constraint `(doctorId, clinicId, startAt)` on confirmed appointments where `status NOT IN (CANCELLED, NO_SHOW)`.
- Use Prisma interactive transaction + raw SQL advisory lock `pg_advisory_xact_lock(hashtext(doctorId||startAt))`.
- Waitlist when slot full; auto-offer on cancellation.

### 3.5 Appointment lifecycle
Statuses: `HELD → PENDING_PAYMENT → CONFIRMED → CHECKED_IN → IN_PROGRESS → COMPLETED | CANCELLED | NO_SHOW | RESCHEDULED`.

### 3.6 Telemedicine
- On confirm (tele type): create `TelemedicineSession` with Daily.co / LiveKit room tokens (adapter interface).
- Waiting room; doctor admits; recording consent flag; session events via WebSocket.
- Fallback: join link email/SMS if WS fails.

### 3.7 Clinical notes & patient history
- SOAP notes; attachments (S3/R2); versioned notes (`NoteRevision`).
- Timeline: appointments, prescriptions, vitals, documents.
- Search: full-text on notes (Postgres `tsvector`) — redact in logs.

### 3.8 E-prescription
- Structured meds: name, dosage, frequency, duration, route, instructions.
- Digital signature field (doctor PIN / WebCrypto signature stub).
- PDF generation (queue job); shareable QR verification code.
- Drug interaction warning stub (static list or external API adapter).

### 3.9 Payments & invoices
- Adapter: Stripe + SSLCommerz + bKash (same pattern as e-commerce).
- Consultation fee + optional service add-ons; refunds on cancel per policy.
- Invoice PDF; clinic ledger entries (double-entry optional advanced).

### 3.10 Reminders & notifications
- T-24h, T-2h, T-15m; post-visit follow-up.
- Channels: email, SMS (Twilio/local BD gateway adapter), in-app, push (optional).

### 3.11 Analytics
- Doctor utilization, no-show rate, revenue by clinic, average wait time.

---

## 4. Advanced Business Logic

### 4.1 Slot generation algorithm
```
Input: doctorId, clinicId, fromDate, toDate
1. Load ScheduleRules overlapping range + Exceptions
2. For each day D in range (clinic timezone):
   a. If exception DAY_OFF → skip
   b. Windows = exception CUSTOM_HOURS else rules for weekday
   c. For each window [Wstart, Wend]:
      t = Wstart
      while t + duration <= Wend:
        candidate = {start:t, end:t+duration}
        if overlaps BLOCK exception → skip
        if exists Confirmed/Held appointment overlapping → mark UNAVAILABLE
        else AVAILABLE
        t += duration + buffer
3. Return slots (do not persist available ones)
```

### 4.2 Hold & confirm (race-safe)
```
BEGIN;
  acquire advisory lock(doctorId, startAt);
  assert no overlapping ACTIVE appointment;
  assert hold not taken OR hold.userId == current;
  upsert SlotHold(expiresAt = now()+3min);
COMMIT;
-- on confirm:
BEGIN;
  lock hold row;
  assert not expired;
  insert Appointment UNIQUE(doctorId, startAt) WHERE status active;
  delete hold;
  enqueue payment / tele session jobs;
COMMIT;
```

### 4.3 Cancellation policy
- >24h: full refund; 2–24h: partial; <2h: no refund (clinic configurable).
- Doctor cancel: always full refund + auto waitlist notify.

### 4.4 Edge cases
- DST / timezone: store all instants in UTC; display in clinic TZ.
- Doctor schedule change after bookings: never auto-cancel; flag conflicts for admin.
- Double tab booking: hold ownership + unique constraint.
- No-show job: if CONFIRMED and startAt + grace < now and not CHECKED_IN → NO_SHOW.
- Recurring series cancel: `this_only | this_and_future` (patient bookings are single; doctor blocks can be series).

---

## 5. State Machines

### Appointment
`HELD → PENDING_PAYMENT → CONFIRMED → CHECKED_IN → IN_PROGRESS → COMPLETED`  
Branches: any pre-COMPLETED → `CANCELLED`; CONFIRMED past grace → `NO_SHOW`; CONFIRMED → `RESCHEDULED` (creates new, links `rescheduledFromId`).

### Prescription
`DRAFT → SIGNED → DISPENSED_EXTERNAL | REVOKED | EXPIRED`

### Payment
`CREATED → REQUIRES_ACTION → SUCCEEDED | FAILED | CANCELLED → REFUND_PENDING → REFUNDED`

### TelemedicineSession
`SCHEDULED → WAITING → LIVE → ENDED | CANCELLED`

Implement with explicit transition tables in domain services; reject illegal transitions with `409`.

---

## 6. Prisma Schema Draft

```prisma
generator client { provider = "prisma-client-js" }
datasource db { provider = "postgresql"; url = env("DATABASE_URL") }

enum GlobalRole { SUPER_ADMIN PATIENT }
enum ClinicRole { CLINIC_ADMIN DOCTOR RECEPTIONIST NURSE }
enum AppointmentStatus { HELD PENDING_PAYMENT CONFIRMED CHECKED_IN IN_PROGRESS COMPLETED CANCELLED NO_SHOW RESCHEDULED }
enum AppointmentType { IN_PERSON TELEMEDICINE }
enum ExceptionType { DAY_OFF CUSTOM_HOURS BLOCK }
enum PaymentStatus { CREATED REQUIRES_ACTION SUCCEEDED FAILED CANCELLED REFUND_PENDING REFUNDED }
enum PrescriptionStatus { DRAFT SIGNED REVOKED EXPIRED DISPENSED_EXTERNAL }

model User {
  id            String   @id @default(cuid())
  email         String?  @unique
  phone         String?  @unique
  passwordHash  String?
  globalRole    GlobalRole @default(PATIENT)
  fullName      String
  dateOfBirth   DateTime?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  patientProfile PatientProfile?
  doctorProfile  DoctorProfile?
  clinicRoles    UserClinicRole[]
  appointmentsAsPatient Appointment[] @relation("PatientAppointments")
  sessions       RefreshSession[]
}

model PatientProfile {
  userId           String @id
  user             User @relation(fields: [userId], references: [id])
  bloodGroup       String?
  allergies        String[]
  emergencyContact Json?
  nationalIdHash   String? @unique
}

model DoctorProfile {
  userId          String @id
  user            User @relation(fields: [userId], references: [id])
  specialties     String[]
  licenseNumber   String?
  bio             String?
  schedules       DoctorScheduleRule[]
  exceptions      ScheduleException[]
  appointments    Appointment[] @relation("DoctorAppointments")
  prescriptions   Prescription[]
}

model Clinic {
  id        String @id @default(cuid())
  name      String
  slug      String @unique
  timezone  String @default("Asia/Dhaka")
  address   String?
  lat       Float?
  lng       Float?
  rooms     Room[]
  members   UserClinicRole[]
  appointments Appointment[]
  createdAt DateTime @default(now())
}

model UserClinicRole {
  id       String @id @default(cuid())
  userId   String
  clinicId String
  role     ClinicRole
  user     User @relation(fields: [userId], references: [id])
  clinic   Clinic @relation(fields: [clinicId], references: [id])
  @@unique([userId, clinicId, role])
  @@index([clinicId])
}

model Room {
  id       String @id @default(cuid())
  clinicId String
  name     String
  clinic   Clinic @relation(fields: [clinicId], references: [id])
  @@unique([clinicId, name])
}

model DoctorScheduleRule {
  id                  String @id @default(cuid())
  doctorId            String
  clinicId            String
  // e.g. "FREQ=WEEKLY;BYDAY=MO,WE,FR"
  rrule               String
  startTimeLocal      String // "09:00"
  endTimeLocal        String // "13:00"
  slotDurationMinutes Int @default(30)
  bufferMinutes       Int @default(0)
  maxParallel         Int @default(1)
  effectiveFrom       DateTime
  effectiveTo         DateTime?
  roomId              String?
  consultationType    AppointmentType @default(IN_PERSON)
  feeMinor            Int // amount in paisa/cents
  currency            String @default("BDT")
  doctor              DoctorProfile @relation(fields: [doctorId], references: [userId])
  @@index([doctorId, clinicId])
}

model ScheduleException {
  id           String @id @default(cuid())
  doctorId     String
  clinicId     String
  dateLocal    DateTime @db.Date
  type         ExceptionType
  startTimeLocal String?
  endTimeLocal   String?
  reason       String?
  doctor       DoctorProfile @relation(fields: [doctorId], references: [userId])
  @@index([doctorId, clinicId, dateLocal])
}

model SlotHold {
  id         String @id @default(cuid())
  doctorId   String
  clinicId   String
  patientId  String
  startAt    DateTime
  endAt      DateTime
  expiresAt  DateTime
  createdAt  DateTime @default(now())
  @@unique([doctorId, startAt])
  @@index([expiresAt])
}

model Appointment {
  id              String @id @default(cuid())
  clinicId        String
  doctorId        String
  patientId       String
  roomId          String?
  type            AppointmentType
  status          AppointmentStatus
  startAt         DateTime
  endAt           DateTime
  feeMinor        Int
  currency        String @default("BDT")
  cancelReason    String?
  rescheduledFromId String?
  checkedInAt     DateTime?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  clinic          Clinic @relation(fields: [clinicId], references: [id])
  doctor          DoctorProfile @relation("DoctorAppointments", fields: [doctorId], references: [userId])
  patient         User @relation("PatientAppointments", fields: [patientId], references: [id])
  notes           ClinicalNote[]
  prescription    Prescription?
  payment         Payment?
  teleSession     TelemedicineSession?
  @@index([doctorId, startAt])
  @@index([patientId, startAt])
  @@index([clinicId, status])
  // Partial unique for active statuses enforced via raw SQL migration:
  // CREATE UNIQUE INDEX appointment_doctor_start_active_uq ON "Appointment" ("doctorId","startAt") WHERE status IN ('HELD','PENDING_PAYMENT','CONFIRMED','CHECKED_IN','IN_PROGRESS');
}

model ClinicalNote {
  id            String @id @default(cuid())
  appointmentId String
  authorId      String
  soap          Json
  searchVector  Unsupported("tsvector")?
  createdAt     DateTime @default(now())
  appointment   Appointment @relation(fields: [appointmentId], references: [id])
  revisions     NoteRevision[]
}

model NoteRevision {
  id     String @id @default(cuid())
  noteId String
  soap   Json
  editedBy String
  editedAt DateTime @default(now())
  note   ClinicalNote @relation(fields: [noteId], references: [id])
}

model Prescription {
  id            String @id @default(cuid())
  appointmentId String @unique
  doctorId      String
  status        PrescriptionStatus @default(DRAFT)
  items         Json // [{name,dose,frequency,duration,route,instructions}]
  signedAt      DateTime?
  verificationCode String @unique @default(cuid())
  pdfUrl        String?
  appointment   Appointment @relation(fields: [appointmentId], references: [id])
  doctor        DoctorProfile @relation(fields: [doctorId], references: [userId])
}

model Payment {
  id            String @id @default(cuid())
  appointmentId String @unique
  provider      String
  status        PaymentStatus
  amountMinor   Int
  currency      String
  providerRef   String?
  idempotencyKey String @unique
  rawWebhook    Json?
  appointment   Appointment @relation(fields: [appointmentId], references: [id])
}

model TelemedicineSession {
  id            String @id @default(cuid())
  appointmentId String @unique
  provider      String
  roomName      String
  status        String
  startedAt     DateTime?
  endedAt       DateTime?
  appointment   Appointment @relation(fields: [appointmentId], references: [id])
}

model RefreshSession {
  id        String @id @default(cuid())
  userId    String
  tokenHash String @unique
  expiresAt DateTime
  user      User @relation(fields: [userId], references: [id])
}

model AuditLog {
  id        String @id @default(cuid())
  actorId   String?
  clinicId  String?
  action    String
  entity    String
  entityId  String?
  meta      Json?
  createdAt DateTime @default(now())
  @@index([clinicId, createdAt])
}

model WaitlistEntry {
  id        String @id @default(cuid())
  doctorId  String
  clinicId  String
  patientId String
  preferredStart DateTime?
  preferredEnd   DateTime?
  status    String @default("ACTIVE")
  createdAt DateTime @default(now())
  @@index([doctorId, clinicId, status])
}
```

---

## 7. REST API (NestJS modules)

Modules: `AuthModule`, `UsersModule`, `ClinicsModule`, `SchedulesModule`, `AppointmentsModule`, `PrescriptionsModule`, `PaymentsModule`, `TelemedicineModule`, `NotificationsModule`, `AnalyticsModule`, `AdminModule`.

| Method | Path | Notes |
|--------|------|-------|
| POST | `/auth/register` | patient default |
| POST | `/auth/login` | |
| POST | `/auth/refresh` | rotate |
| POST | `/auth/otp/request` | |
| GET | `/clinics` | public search |
| POST | `/clinics` | super/admin |
| GET | `/clinics/:id/doctors` | |
| GET | `/doctors/:id/slots?from&to&clinicId&type` | generated |
| POST | `/appointments/holds` | create hold |
| DELETE | `/appointments/holds/:id` | release |
| POST | `/appointments` | confirm from hold |
| GET | `/appointments/:id` | |
| POST | `/appointments/:id/cancel` | |
| POST | `/appointments/:id/reschedule` | |
| POST | `/appointments/:id/check-in` | receptionist/doctor |
| POST | `/appointments/:id/notes` | |
| POST | `/prescriptions` | draft |
| POST | `/prescriptions/:id/sign` | |
| GET | `/prescriptions/verify/:code` | public |
| POST | `/payments/intent` | |
| POST | `/payments/webhooks/:provider` | raw body |
| POST | `/telemedicine/:appointmentId/token` | |
| GET | `/patients/me/history` | |
| POST | `/schedules/rules` | doctor/admin |
| POST | `/schedules/exceptions` | |
| POST | `/waitlist` | |
| GET | `/analytics/clinic/:id/summary` | |

All mutating routes: idempotency-key header where payments/booking.

---

## 8. Real-time (Socket.IO)

Namespace `/ws`:
- Rooms: `clinic:{id}`, `doctor:{id}`, `appointment:{id}`, `user:{id}`
- Events: `appointment.updated`, `queue.position`, `tele.participant_joined`, `tele.admitted`, `hold.expiring`
- Auth: JWT in handshake; join only authorized rooms.

---

## 9. Background Jobs (BullMQ)

| Queue | Job | Trigger |
|-------|-----|---------|
| `reminders` | send reminder | cron scan T-24h/2h/15m |
| `holds` | expire holds | every minute |
| `noshow` | mark no-show | every 5 min |
| `pdf` | prescription PDF | on sign |
| `notifications` | email/sms fanout | domain events |
| `waitlist` | offer slot | on cancel |
| `webhooks-retry` | payment webhook replay | failed |

---

## 10. Security

- Argon2id passwords; refresh token hash only.
- Rate limit auth & OTP.
- Encrypt attachments at rest (SSE-KMS or provider).
- Audit every prescription sign / note edit / export.
- CORS allowlist; Helmet; validation pipes (zod/class-validator).
- Never log prescription body or national IDs in plaintext.

---

## 11. Caching

- Redis: generated slots cache key `slots:{doctor}:{clinic}:{date}` TTL 60–120s; invalidate on schedule/appointment change.
- Clinic public profile CDN cache.

---

## 12. Testing Strategy

- Unit: slot generator, cancellation fee calculator, state transitions.
- Integration: booking race (parallel 50 holds → exactly 1 win) with Testcontainers Postgres.
- E2E: Playwright book → pay stub → join tele room mock.
- Contract tests for payment webhook adapters.

---

## 13. Folder Structure

```
doctor-appointment-system/
  Project_spec.md
  frontend/          # Next.js App Router
    src/app/(public)/
    src/app/(patient)/
    src/app/(doctor)/
    src/app/(clinic-admin)/
    src/components/
    src/lib/api.ts
    src/lib/socket.ts
  backend/
    src/main.ts
    src/modules/...
    src/common/guards/
    src/common/locks/
    prisma/schema.prisma
    prisma/migrations/
    test/
```

---

## 14. Environment Variables (names only)

`DATABASE_URL`, `REDIS_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `APP_URL`, `CORS_ORIGINS`, `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `SMTP_URL`, `SMS_PROVIDER`, `SMS_API_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `SSLCOMMERZ_STORE_ID`, `SSLCOMMERZ_STORE_PASSWORD`, `BKASH_APP_KEY`, `BKASH_APP_SECRET`, `BKASH_USERNAME`, `BKASH_PASSWORD`, `TELEMEDICINE_PROVIDER`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `LIVEKIT_URL`, `OTP_PEPPER`

---

## 15. Milestones

1. **M1 Auth + Clinic + Doctor profiles** — CRUD, RBAC guards.
2. **M2 Schedule engine + slot API** — unit tests for generator.
3. **M3 Hold/Confirm with locks** — race integration test green.
4. **M4 Payments + invoices** — one provider live, others stubbed.
5. **M5 Clinical notes + e-Rx PDF**.
6. **M6 Telemedicine + WS events**.
7. **M7 Reminders, waitlist, analytics, harden**.

---

## 16. Acceptance Criteria

- [ ] Two concurrent booking requests for same slot → exactly one `CONFIRMED`.
- [ ] Recurring weekly schedule + one DAY_OFF exception hides that day's slots.
- [ ] Hold expires and slot becomes bookable again without manual cleanup.
- [ ] Signed prescription verifies via public code and PDF exists.
- [ ] Tele appointment yields join tokens for patient & doctor only.
- [ ] Cancel >24h triggers full refund job (stub OK).
- [ ] Receptionist cannot access another clinic's appointments.
- [ ] Partial unique index present in migration SQL.
- [ ] README with docker-compose: Postgres, Redis, API, Web.

---

## 17. Agent Implementation Notes

- Prefer domain services over fat controllers.
- Put advisory lock helper in `common/locks/pg-advisory.lock.ts`.
- Payment providers implement `PaymentProvider` interface: `createIntent`, `parseWebhook`, `refund`.
- Frontend: TanStack Query + Zustand for hold countdown timer.
- Seed script: 2 clinics, 5 doctors, 20 patients, rules for next 14 days.
