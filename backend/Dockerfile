# syntax=docker/dockerfile:1
# Build context: repository root (docker build -f backend/Dockerfile .)
FROM node:22-bookworm-slim AS base
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Compile TypeScript with dev dependencies
FROM base AS build
COPY backend/package*.json ./
RUN npm ci --no-audit --no-fund
COPY backend/ ./
RUN npm run db:generate && npm run build

# Production-only node_modules (+ generated Prisma client)
FROM base AS deps
COPY backend/package*.json ./
COPY backend/prisma ./prisma
RUN npm ci --omit=dev --no-audit --no-fund \
  && npx prisma generate \
  && npm cache clean --force

FROM base AS runtime
ENV NODE_ENV=production \
    PORT=4000 \
    NODE_OPTIONS=--max-old-space-size=352
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY backend/package.json backend/tsconfig.json ./
# prisma/ = schema + migrations (prisma migrate deploy) + seed scripts; the seed imports src/.
COPY backend/prisma ./prisma
COPY backend/src ./src
USER node
EXPOSE 4000
# Migrations are applied by the deploy workflow (`npx prisma migrate deploy`) before `up -d`.
CMD ["node", "dist/main.js"]
