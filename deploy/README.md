# EC2 deployment (Careflow)

Every push to `main` (or a manual *Run workflow*) runs `.github/workflows/deploy.yml`:

1. Builds `backend/Dockerfile` and `frontend/Dockerfile` (context = repo root) with Buildx + GHA cache and
   pushes `ghcr.io/amitavrchy/careflow-backend` and `ghcr.io/amitavrchy/careflow-frontend`
   tagged `latest` and the commit SHA.
2. SSHes to the server (`EC2_HOST`, `EC2_USER`, `EC2_SSH_KEY` secrets), copies
   `deploy/docker-compose.prod.yml` to `/opt/apps/careflow/docker-compose.yml`, logs in to GHCR with the
   workflow token, pulls, runs `npx prisma migrate deploy` in a one-off backend container,
   `docker compose up -d`, then `docker image prune -f`.

| Service  | Container           | Host port        | Public URL                                   |
|----------|---------------------|------------------|----------------------------------------------|
| frontend | `careflow-frontend` | `127.0.0.1:3002` | https://careflow.13.203.3.1.sslip.io          |
| backend  | `careflow-backend`  | `127.0.0.1:4002` | https://api.careflow.13.203.3.1.sslip.io (no `/api` prefix, health at `/health`) |

The browser only talks to the frontend origin: `/api/*` (including Socket.IO polling at `/api/socket.io`)
is proxied by Next.js to `http://careflow-backend:4000` over `apps-net` (`API_INTERNAL_URL` build arg).
Optional build-time Stripe key: set the repository Actions **variable** `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`.

## Requirements

- `shared-postgres` with a `careflow` role/database, and the `apps-net` network.
- **Redis is required** (`REDIS_URL`): the API refuses to start without it and `/health` pings it.
- `/opt/apps/careflow/.env` created from `deploy/.env.example` (`chmod 600`).

## Demo data (optional, once)

`prisma/seed.ts` is a demo seed and only runs with `DEMO_MODE=true` (the API itself must keep `DEMO_MODE=false`):

```bash
cd /opt/apps/careflow
docker compose run --rm -e DEMO_MODE=true -e SEED_PASSWORD='<at least 12 chars>' backend npx tsx prisma/seed.ts
```

It creates demo clinics, doctors and users such as `admin@careflow.demo` and `patient@careflow.demo`.
