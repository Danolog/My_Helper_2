# syntax=docker/dockerfile:1
#
# Obraz MyHelper pod Cloud Run (brief C, zadanie 0.2).
# Etapy: deps → builder → runner (domyślny, serwer Next.js standalone)
#        prod-deps → migrator (Cloud Run Job, infra/db/migrate.mjs).
#
# Zasady (strażnik G-C1, __tests__/lib/container-config.test.ts):
# - etap `runner` działa jako `USER node` (uid 1000), nigdy root;
# - żadnego `COPY .env*` — `.dockerignore` wycina `.env*` z kontekstu budowy;
# - w etapie `runner` brak `ARG`/`ENV` z nazwą sekretu; sekrety przychodzą
#   w czasie działania (Cloud Run `--set-secrets`), nie przy budowie.
# - budowa nie potrzebuje adresu bazy ani sekretu: `src/lib/db.ts` łączy się
#   leniwie (C3, #110), więc w Dockerfile nie ma żadnych wartości zastępczych;
# - pliki aplikacji w `runner` i `migrator` należą do root (proces `node`
#   nie nadpisze `server.js`); zapisywalny jest tylko `.next/cache`.
#
# Debian slim, nie Alpine: sharp ma gotowe binaria pod glibc.

ARG NODE_IMAGE=node:22-bookworm-slim

# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
# pnpm z pola `packageManager` (10.28.2).
ENV COREPACK_HOME=/opt/corepack
RUN corepack enable \
 && corepack prepare pnpm@10.28.2 --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------
FROM deps AS builder
# BUILD_STANDALONE=1 (niżej) włącza `output: "standalone"` w next.config.ts —
# tylko tu; Vercel i CI budują bez niego (do C4).
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
    NEXT_TELEMETRY_DISABLED=1 \
    BUILD_STANDALONE=1
COPY . .
RUN pnpm build:ci

# ---------------------------------------------------------------------------
# Tylko zależności produkcyjne — migrator nie niesie narzędzi deweloperskich
# obok produkcyjnego POSTGRES_URL (Ryan, #110 P2).
FROM ${NODE_IMAGE} AS prod-deps
WORKDIR /app
ENV COREPACK_HOME=/opt/corepack
RUN corepack enable \
 && corepack prepare pnpm@10.28.2 --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod

# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS migrator
WORKDIR /app
ENV NODE_ENV=production
COPY --from=prod-deps /app/node_modules ./node_modules
COPY drizzle ./drizzle
COPY infra/db/migrate.mjs ./migrate.mjs
COPY infra/db/pg-socket.mjs ./pg-socket.mjs
USER node
# POSTGRES_URL przychodzi z Secret Manager w czasie uruchomienia Joba.
# drizzle-orm/migrator: ta sama tabela dziennika co `drizzle-kit migrate`
# (drizzle.__drizzle_migrations), te same pliki drizzle/ + meta/_journal.json.
CMD ["node", "migrate.mjs"]

# ---------------------------------------------------------------------------
# Domyślny cel: ostatni etap w pliku.
FROM ${NODE_IMAGE} AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=8080
# Pliki należą do root: proces `node` czyta, ale nie nadpisze kodu (Ryan, P3).
# Zapisywalny jest tylko .next/cache (optymalizacja obrazów Next). `public/`
# nie jest zapisywalny — sterownik `local` i tak jest odrzucany w produkcji
# (src/lib/storage.ts), a Next nie serwuje plików dodanych do public/ po budowie.
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
RUN mkdir -p .next/cache && chown node:node .next/cache
USER node
EXPOSE 8080
# Lokalnie (docker / compose). Cloud Run ignoruje HEALTHCHECK — tam sonda
# startowa HTTP na /api/health (infra/gcp/run-deploy.sh, C3). Sondy
# żywotności NIE ustawiamy: /api/health pinguje bazę, chwilowy brak bazy
# restartowałby wszystkie instancje.
HEALTHCHECK --interval=30s --timeout=6s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "server.js"]
