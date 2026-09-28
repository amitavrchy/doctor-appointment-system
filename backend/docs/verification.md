# Verification record

Verified locally on 4 November 2026 with Node 24, PostgreSQL 17, Redis 7 and Chromium. Docker builds use Node 22. No live merchant transactions, SMS/email delivery, object-storage account or LiveKit media session was exercised.

| Check                                          | Result                                 |
| ---------------------------------------------- | -------------------------------------- |
| Independent backend/frontend TypeScript checks | Passed                                 |
| Backend tests                                  | 61 passed across 5 suites              |
| Browser journeys                               | 11 passed in Chromium                  |
| Next.js production build with Webpack          | Passed                                 |
| NestJS production build                        | Passed                                 |
| Backend and frontend dependency audits         | 0 vulnerabilities reported             |
| Docker Compose API and web image builds        | Passed                                 |
| Mobile overflow and visible text >=14px        | Passed on patient and advanced screens |

Backend tests include real concurrent PostgreSQL booking/room constraints and isolated clinical/security/finance fixtures. Provider transport tests use mocked responses. Browser tests verify booking/payment/cancellation, clinical PDFs, consultation/signing, registration/profile, care-task persistence, reviewed labs/referrals, calendar/queue/impact preview, finance/CSV/job monitor, authenticated realtime connection/revocation and mobile layouts.

Reproduce from `backend` after installing both apps and setting up PostgreSQL/Redis:

```powershell
npm run db:migrate
npm run db:seed
npm run check:all -- --browser
```

Run `npm run format:check` inside each app. For packaged execution, use `docker compose up -d --build` from backend. Screenshots are in [frontend/docs/images](../../frontend/docs/images).
