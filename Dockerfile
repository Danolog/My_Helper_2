# syntax=docker/dockerfile:1
#
# Obraz MyHelper pod Cloud Run (brief C, zadanie 0.2).
# Etapy: deps → builder → runner (domyślny, serwer Next.js standalone)
#        deps → migrator (Cloud Run Job `pnpm db:migrate`).
#
# Zasady (strażnik G-C1, __tests__/lib/container-config.test.ts):
# - etap `runner` działa jako `USER node` (uid 1000), nigdy root;
# - żadnego `COPY .env*` — `.dockerignore` wycina `.env*` z kontekstu budowy;
# - w etapie `runner` brak `ARG`/`ENV` z nazwą sekretu; sekrety przychodzą
#   w czasie działania (Cloud Run `--set-secrets`), nie przy budowie.
# - wartości zastępcze potrzebne samej budowie (`src/lib/db.ts` rzuca przy
#   imporcie bez POSTGRES_URL) żyją tylko w jednym `RUN` etapu `builder` —
#   nie trafiają do metadanych żadnego obrazu.
#
# Debian slim, nie Alpine: sharp ma gotowe binaria pod glibc.

ARG NODE_IMAGE=node:22-bookworm-slim

# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
# pnpm z pola `packageManager` (10.28.2). Corepack w katalogu czytelnym dla
# każdego użytkownika — `migrator` uruchamia pnpm jako `node`.
ENV COREPACK_HOME=/opt/corepack
RUN corepack enable \
 && corepack prepare pnpm@10.28.2 --activate \
 && chmod -R a+rX /opt/corepack
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------
FROM deps AS builder
# Publiczne zmienne są wpiekane w bundel przy budowie (także po stronie
# serwera) — obraz jest związany z adresem aplikacji. Zmiana domeny = nowa budowa.
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_VAPID_PUBLIC_KEY
# Nazwa zasobnika (nie sekret): `next.config.ts` dopisuje go do
# `images.remotePatterns` przy budowie. W czasie działania usługa dostaje
# GCS_BUCKET osobno (Cloud Run --set-env-vars).
ARG GCS_BUCKET
ENV NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL} \
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=${NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY} \
    NEXT_PUBLIC_VAPID_PUBLIC_KEY=${NEXT_PUBLIC_VAPID_PUBLIC_KEY} \
    GCS_BUCKET=${GCS_BUCKET} \
    NEXT_TELEMETRY_DISABLED=1
COPY . .
# Wartości zastępcze tylko na czas tego polecenia (nie ENV): budowa nie łączy
# się z bazą, ale import `src/lib/db.ts` wymaga niepustego adresu.
RUN POSTGRES_URL="postgresql://build:build@127.0.0.1:1/build" \
    BETTER_AUTH_SECRET="build-time-placeholder-not-a-secret-000000" \
    pnpm build:ci

# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS migrator
WORKDIR /app
ENV COREPACK_HOME=/opt/corepack \
    NODE_ENV=production
COPY --from=deps /opt/corepack /opt/corepack
COPY --from=deps /app/node_modules ./node_modules
COPY package.json pnpm-lock.yaml drizzle.config.ts ./
COPY drizzle ./drizzle
COPY src/lib/schema.ts ./src/lib/schema.ts
RUN corepack enable
USER node
# POSTGRES_URL przychodzi z Secret Manager w czasie uruchomienia Joba.
CMD ["pnpm", "db:migrate"]

# ---------------------------------------------------------------------------
# Domyślny cel: ostatni etap w pliku.
FROM ${NODE_IMAGE} AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=8080
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
USER node
EXPOSE 8080
# Lokalnie (docker / compose). Cloud Run ignoruje HEALTHCHECK — tam sonda
# startowa HTTP na /api/health (infra/gcp/run-deploy.sh, C3). Sondy
# żywotności NIE ustawiamy: /api/health pinguje bazę, chwilowy brak bazy
# restartowałby wszystkie instancje.
HEALTHCHECK --interval=30s --timeout=6s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "server.js"]
