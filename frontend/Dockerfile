# syntax=docker/dockerfile:1
# Build context: repository root (docker build -f frontend/Dockerfile .)
FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 \
    NEXT_OUTPUT_STANDALONE=1
COPY frontend/package*.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
# The browser calls same-origin /api/*; Next.js proxies it to API_INTERNAL_URL (prefix stripped).
# Rewrites are resolved at build time, so this must be a build arg.
ARG API_INTERNAL_URL=http://api:4000
ARG NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
ENV API_INTERNAL_URL=$API_INTERNAL_URL \
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=$NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    NEXT_TELEMETRY_DISABLED=1 \
    NODE_OPTIONS=--max-old-space-size=256
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
USER node
EXPOSE 3000
CMD ["node", "server.js"]
