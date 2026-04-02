# Project: [NAZWA PROJEKTU]
# Living Skill Version: 1.0.0

## Stack
- Frontend: Next.js [WERSJA] + TypeScript strict
- Backend: Next.js API Routes
- DB: PostgreSQL + Drizzle ORM
- Auth: better-auth
- State: [Zustand/Jotai/Context]
- Testy: Vitest + Playwright
- Deploy: Vercel + Neon (prod) / Docker (local)

## Struktura projektu
- `src/app/` — Next.js App Router (strony i API routes)
- `src/components/` — komponenty React
- `src/lib/` — logika biznesowa, helpery, schema DB
- `tests/` — E2E testy Playwright
- `__tests__/` — unit testy Vitest
- `scripts/` — seed, migracje, narzędzia

## Komendy
- `pnpm dev` — development server
- `pnpm build:ci` — build bez połączenia z DB (używaj w CI)
- `pnpm start` — production server (po build)
- `pnpm test` — unit testy
- `pnpm test:coverage` — unit testy + raport coverage
- `pnpm typecheck` — TypeScript check (bez emitowania)
- `pnpm lint` — ESLint
- `pnpm db:migrate` — uruchom migracje
- `pnpm db:seed:test` — seed testowej bazy (idempotentny)

## Zasady dla agentów (KRYTYCZNE)

### Kolejność napraw
TypeScript → Security → Unit Tests → E2E → CI/CD

### E2E — nigdy nie rób
- `keyboard.press('Enter')` → używaj `button[type="submit"].click()`
- `waitUntil: 'networkidle'` → używaj `'load'`
- Login przez UI w global-setup → używaj API call
- `loginAsUser()` w testach dashboardu → używaj `storageState`

### Database
- Seed zawsze idempotentny (`onConflictDoUpdate`)
- Better Auth wymaga wpisu w tabeli `verification`
- Sprawdź N+1 zanim commitniesz API endpoint

### Ogólne
- Po każdej zmianie: `pnpm test`
- Nie commituj z czerwonymi testami
- Nie hardcoduj produkcyjnych URL (używaj env vars)

## Środowiska
- Local: http://localhost:3000
- CI: http://localhost:3000 (GitHub Actions)
- Produkcja: [POBIERZ Z ENV BETTER_AUTH_BASE_URL_PROD]

## Znane pre-existing issues
<!-- Dokumentuj tu rzeczy które widzisz ale nie naprawiasz teraz -->
- [ ] [opis]

## Kontekst biznesowy
<!-- 2-3 zdania o tym co robi aplikacja -->
[OPIS APLIKACJI]
