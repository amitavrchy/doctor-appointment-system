# Careflow backend

NestJS, Prisma/PostgreSQL, Redis/BullMQ and Socket.IO services for the Careflow healthcare platform. The repository root contains only `frontend/` and `backend/`; each is independently installable.

## Start locally

From this folder:

```powershell
npm ci
npm run setup
docker compose up -d postgres redis
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev
```

In another terminal, run `npm ci` and `npm run dev` inside `../frontend`. Open http://localhost:3000. API health: http://localhost:4000/health. PostgreSQL: localhost:55435; Redis: localhost:6380.

`npm run setup` creates random secrets for a fresh backend `.env` and creates a public-only frontend `.env.local`. Existing configuration is retained. Copy changes from `.env.example` when adding provider credentials. Do not commit local environment files.

## Docker

From `backend/`:

```powershell
docker compose up --build -d
docker compose exec api npm run db:seed
```

The compose file builds both applications from their respective folders and retains named database/Redis volumes. Stop local servers on ports 3000/4000 before starting the containers. `docker compose down` preserves the data volumes.

## Demo accounts

| Account | Email |
| --- | --- |
| Patient | patient@careflow.demo |
| Doctor | sara@careflow.demo |
| Platform admin | admin@careflow.demo |
| Receptionist | reception@careflow.demo |

Default local seed password: `CareflowDemo2026!`. The seed requires `DEMO_MODE=true`, creates two clinics, five doctors, patients and synthetic history, and never overwrites existing records/passwords.

## Checks

```powershell
npm run typecheck
npm test
npm run build
npm audit
npm run check:all -- --browser
```

The combined check command also checks/builds `../frontend`; install dependencies in both folders first. Browser tests live in `../frontend/e2e/`. PostgreSQL integration tests use isolated fixtures and do not truncate existing records. A database must be running when `DATABASE_URL` is configured.

## Documentation

- [Original project specification](docs/Project_spec.md)
- [Architecture and provider configuration](docs/architecture.md)
- [Frontend setup](../frontend/README.md)

The CI workflow in `ci/workflows/ci.yml` is a template. GitHub only discovers workflows in a root `.github` directory, which is excluded by the requested two-folder layout. The same checks can run through `npm run check:all -- --browser` or an external CI job.

At the owner's request, implementation commit timestamps are arranged across August?September 2026. These are deliberately backdated portfolio-history timestamps, rather than actual work dates. The original scaffold commit is retained.
