# MyHelper — Project Instructions

## Overview

MyHelper to alternatywa dla Booksy dla malych firm uslugowych (salony kosmetyczne, fryzjerzy, gabinety). Model subskrypcyjny: Basic (49 PLN/mies.) i Pro (149 PLN/mies. z AI). 14-dniowy trial. Panel salonu, portal klienta z rezerwacja online i platnoscia zadatkow, magazyn, promocje, raporty.

## Technology Stack

- **Frontend**: Next.js 16.1.6 + React 19.2.4, Tailwind CSS 4 + shadcn/ui 3.7, Framer Motion, next-themes
- **Backend**: Node.js 22+, Next.js API Routes (~160 endpointow), PostgreSQL 18 (pgvector, Docker)
- **ORM**: Drizzle ORM 0.44.7, schema: `src/lib/schema.ts` (1057 lines, 44 tabele)
- **Auth**: Better Auth 1.4.18 (email/password + Google OAuth), 15-min session timeout
- **Payments**: Stripe 20.3.1 (subskrypcje + zadatki) + Blik P2P
- **AI**: Vercel AI SDK 5 + OpenRouter (anthropic/claude-sonnet-4-5-20250929) — tylko plan Pro
- **Validation**: Zod 4.3.6
- **PWA**: Service Worker, install prompt, offline fallback
- **Package manager**: pnpm
- **Deployment**: Vercel (build: `pnpm build:ci`)

## Project Structure

```
src/app/(auth)/          # logowanie, rejestracja, reset hasla
src/app/(client)/        # portal klienta (salony, rezerwacja, wizyty, ulubione)
src/app/dashboard/       # panel wlasciciela (~50 podstron, ~82 page.tsx total)
src/app/api/             # ~160 endpointow REST (~176 katalogow)
src/app/calendar/        # widok kalendarza pracownikow
src/components/ui/       # shadcn/ui
src/components/calendar/ # time-grid, week-time-grid, event, legend, dialogi
src/components/auth/     # formularze autentykacji
src/components/appointments/ # dialogi wizyt
src/components/reports/  # filtry dat, filtry pracownikow
src/components/subscription/ # bramka planu Pro
src/components/pwa/      # install prompt, service worker
src/hooks/               # custom React hooks
src/lib/                 # core utilities, auth config, schema, server logic
src/types/               # definicje typow TypeScript
drizzle/                 # migracje SQL
docs/                    # dokumentacja biznesowa i techniczna
scripts/                 # setup, seed-test.ts
__tests__/               # testy jednostkowe Vitest (~55 plikow)
tests/                   # testy E2E Playwright (~10 spec files)
```

## Commands

```bash
# Development
pnpm dev                  # Next.js dev (Turbopack)
pnpm build                # build produkcyjny (z migracjami)
pnpm build:ci             # build bez migracji (Vercel)

# Quality
pnpm lint                 # ESLint
pnpm typecheck            # TypeScript strict check
pnpm check                # lint + typecheck

# Testing
pnpm test                 # testy jednostkowe (Vitest)
pnpm test:watch           # Vitest w trybie watch
pnpm test:coverage        # Vitest z raportem pokrycia
pnpm test:e2e             # testy E2E (Playwright)
pnpm test:e2e:ui          # Playwright UI mode
pnpm test:all             # unit + E2E

# Database
pnpm db:push              # push schema do DB (dev)
pnpm db:generate          # generuj migracje
pnpm db:migrate           # uruchom migracje
pnpm db:studio            # Drizzle Studio
pnpm db:seed:test         # seed danych testowych
```

## Test Infrastructure

### Unit Tests (Vitest)
- `__tests__/api/` — testy API (appointments, clients, employees, services, products, health, work-schedules, appointment-materials, appointment-complete)
- `__tests__/lib/` — testy utilities (validations, utils, date-utils, session, stripe, refund, subscription, sms, push, storage, env, excel-export, fetch-with-retry, api-validation, content-templates, error-messages, notification-settings, temporary-access, web-push, get-user-salon)
- `__tests__/hooks/` — testy hooks (use-diagnostics, use-draggable, use-salon-id, use-unsaved-changes, use-subscription, use-form-recovery, use-network-status, use-tab-sync)
- `__tests__/components/` — testy komponentow (Calendar*, DateRangeFilter, EmployeeFilter, auth forms, PWA, ProPlanGate, UnsavedChangesDialog)

### E2E Tests (Playwright)
- `tests/auth/authentication.spec.ts` — logowanie, rejestracja, reset hasla
- `tests/dashboard/` — services, inventory, appointments, employees, reports, subscriptions
- `tests/client-portal/client-flows.spec.ts` — flow klienta
- `tests/ai-tools/ai-features.spec.ts` — AI (plan Pro)
- `tests/production/health.spec.ts` — health checks produkcyjne (@production tag)
- Tags: `@smoke` (szybkie), `@full` (pelne), `@production` (health checks)
- Global auth: `tests/.auth/` — storageState dla zalogowanego uzytkownika

### CI/CD (GitHub Actions)
- **quality-gate.yml** (push/PR na main):
  - TypeScript Check
  - Unit Tests (z coverage)
  - E2E Smoke (@smoke, 4 workers, timeout 10min)
  - E2E Full (@full, 2 workers, timeout 35min — tylko push na main)
  - Security Audit (pnpm audit)
- **e2e-production.yml** (po deploy na Vercel):
  - Production Health Checks (@production, 2 workers, timeout 5min)

## Claude Code Setup

### Agents (`.claude/agents/`)
- **coder** (opus) — implementacja kodu, nowe funkcje, refactoring
- **code-review** (opus) — code review, quality checks
- **deep-dive** (opus) — analiza architektury, debugging, badanie rozwiazań
- **better-auth-expert** (sonnet) — review implementacji Better Auth
- **stripe-payments-expert** (sonnet) — integracja Stripe, webhooks, subskrypcje

### Commands (`.claude/commands/`)
- `/checkpoint` — commit z szczegolowym opisem
- `/create-spec` — nowa specyfikacja z wymaganiami i planem
- `/continue-feature` — kontynuacja implementacji feature z GitHub
- `/review-pr` — review pull requestu
- `/publish-to-github` — publikacja feature na GitHub Issues/Projects
- `/orchestrator` — orkiestrator testowania
- `/faza0` - `/faza7` — fazy workflow implementacji

### MCP Servers (`.mcp.json`)
- **shadcn** — shadcn/ui component management
- **playwright** — browser automation i testowanie
- **next-devtools** — Next.js dev tools, docs, upgrade

## User Roles & Access

| Role | Permissions |
|------|------------|
| **owner** | Pelny dostep do dashboard, settings, reports, employees, promocje |
| **employee** | Wlasny kalendarz, podglad ogolny, galeria, swoje statystyki |
| **receptionist** | Umawianie wizyt, klienci, podglad kalendarza |
| **client** | Przegladanie salonow, rezerwacja, platnosci, opinie, ulubione |

## Database Schema (44 tabele)

- **Auth**: user, session, account, verification (text PKs)
- **Core**: salons, clients, employees, serviceCategories, services, serviceVariants, appointments, timeBlocks (UUID PKs)
- **Staff**: employeeServices, employeeServicePrices, workSchedules, employeeCommissions
- **Inventory**: products, productCategories, productUsage, serviceProducts, appointmentMaterials, treatmentHistory
- **Gallery**: galleryPhotos, albums, photoAlbums
- **Marketing**: promotions, promoCodes, loyaltyPoints, loyaltyTransactions, newsletters, marketingConsents, scheduledPosts
- **Notifications**: notifications, waitingList, temporaryAccess, pushSubscriptions
- **Payments**: subscriptionPlans, salonSubscriptions, subscriptionPayments, depositPayments, invoices, fiscalReceipts
- **AI & Other**: aiConversations, favoriteSalons

## API Domains

- **AI (Pro)**: Business (alerts, analytics, chat, recommendations), Content (descriptions, social-post, newsletter), Voice (book, cancel, reschedule)
- **Core CRUD**: appointments, clients, employees, services, products, salons, gallery, invoices, promotions, promo-codes, reviews, work-schedules, time-blocks, waiting-list, scheduled-posts, temporary-access
- **Client Portal**: /api/client/appointments, reviews, waiting-list, /api/favorites/salons
- **Finance**: deposits, subscriptions, stripe webhooks, reports (revenue, occupancy, payroll, popularity, profitability, materials, promotions, cancellations, monthly/yearly comparison)
- **Notifications & Cron**: birthday, low-stock, we-miss-you, push, reminders, cron jobs

## Environment Variables

```
POSTGRES_URL                          # PostgreSQL connection string
BETTER_AUTH_SECRET                    # min 32 znaki
BETTER_AUTH_URL                       # bazowy URL (produkcja)
GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET  # OAuth (opcjonalne)
OPENROUTER_API_KEY                    # AI via OpenRouter (tylko Pro)
OPENROUTER_MODEL                      # domyslnie anthropic/claude-sonnet-4-5-20250929
NEXT_PUBLIC_APP_URL                   # bazowy URL (domyslnie http://localhost:3000)
BLOB_READ_WRITE_TOKEN                 # Vercel Blob (opcjonalnie)
STRIPE_SECRET_KEY / NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
STRIPE_WEBHOOK_SECRET
STRIPE_PRICE_BASIC / STRIPE_PRICE_PRO
```

## Key Config Files

- `drizzle.config.ts` — dialect postgresql, schema src/lib/schema.ts
- `next.config.ts` — Turbopack dev, image domains, CSP headers, TS build errors ignored
- `docker-compose.yml` — pgvector/pgvector:pg18, port 5432, baza pos_dev
- `tsconfig.json` — target ES2017, strict mode, path alias @/* -> ./src/*
- `vitest.config.ts` — konfiguracja Vitest
- `playwright.config.ts` — konfiguracja Playwright
- `vercel.json` — build command pnpm build:ci
- `components.json` — konfiguracja shadcn/ui

## Guidelines

1. Be concise and helpful
2. Before writing any code, describe your approach and wait for approval
3. If the requirements are ambiguous, ask clarifying questions
4. After finishing code, list edge cases and suggest test cases
5. If a task requires changes to more than 3 files, break it into smaller tasks
6. When there's a bug, start by writing a test that reproduces it
7. Every time the user corrects you, reflect on the mistake and plan to avoid it
8. When explaining code, reference specific file paths and line numbers
9. Search the codebase to find relevant information before answering

## Testing Rules

- Po kazdej zmianie uruchom PELNY zestaw testow (regresja)
- Naprawiaj bledy od fundamentalnych (typy, importy) do zlozonych (logika)
- Kazdy test musi pokrywac: happy path + error path + edge cases
- API testy musza sprawdzac: 200, 400, 401, 403, 404, 500
- E2E: zawsze czekaj na hydration przed interakcja z formularzami
- E2E: uzywaj storageState dla auth zamiast logowania per test
- E2E: uzywaj `waitUntil: 'load'` lub `'domcontentloaded'` zamiast `'networkidle'`

## Context Management

Agent MUSI aktywnie zarzadzac oknem kontekstowym podczas dlugich zadan.

### Checkpoints

1. **Przed duzym zadaniem** — zapisz plan do `memory/current-task.md`
2. **Po kazdym etapie** — zaktualizuj `memory/current-task.md`
3. **Regularnie kompresuj kontekst** — po kazdych 3-4 etapach uzyj `/compact`
4. **Przed `/clear`** — ZAWSZE zaktualizuj `memory/current-task.md`
5. **Po `/clear` lub nowej sesji** — przeczytaj `memory/current-task.md` i `memory/MEMORY.md`

### Format `memory/current-task.md`

```markdown
# Biezace zadanie
**Cel:** [opis]
**Rozpoczeto:** [data]
**Status:** w trakcie / zakonczone

## Plan
- [x] Krok 1
- [ ] Krok 2 (NASTEPNY)

## Kluczowe decyzje
## Zmodyfikowane pliki
## Problemy i rozwiazania
## Notatki dla nastepnej sesji
```

## Known Issues

- [ ] Weryfikacja autorow sesji (timeout 15 min)
- [ ] Walidacje formularzy we wszystkich CRUD
- [ ] Obsluga bledow w endpointach AI
- [ ] Testy responsywnosci mobile-first
- [ ] E2E stabilnosc w CI — hydration timing, cold start delays (aktywnie naprawiane)

## Aktywny Audit (marzec 2026)

Pełny raport: docs/AUDIT_2026-03.md

### Ocena
| Obszar | Ocena |
|--------|-------|
| Architektura | 8/10 |
| Bezpieczeństwo | 3/10 — 91 endpointów bez auth |
| Performance | 6/10 — N+1 w cron jobs |
| Code Quality | 7/10 — console.log, memory leaks |
| Testy | 7/10 — brakują edge cases |

### Priorytet 0: BLOKERY (przed produkcją)
1. Auth middleware → stwórz requireAuth(role?) w src/lib/auth-middleware.ts → dodaj do 91 API routes
2. TypeScript errors → napraw waiting-list.ts, subscriptions/cancel
3. Brakujące FK → schema.ts (fiscalReceipts, appointmentMaterials, appointments)
4. N+1 queries → batch insert w newsletter send, batch update w push reminders cron

### Priorytet 1: Stabilność
5. Dodaj 6 brakujących indeksów (appointments.serviceId, pushSubscriptions.userId, clients.birthday)
6. Unique constraints (favoriteSalons, employeeServices, loyaltyPoints)
7. Zod validation na 62 endpointach POST/PUT/PATCH
8. Update vulnerable deps (xlsx, jsPDF, minimatch)

### Priorytet 2: Jakość
9. Usuń 254 console.log → structured logging
10. Cleanup useEffect (5 bez cleanup, 11 bez AbortController)
11. Napraw 20 unused variables + 15 null checks
12. Error states w komponentach (calendar, employees)
13. Brakujące testy (transactions, load, error scenarios)

### Zasady napraw
- Po każdej naprawie: pnpm typecheck && pnpm test
- Nie commituj z czerwonymi testami
- Jeden commit = jedna naprawa (atomic commits)
- Czytaj docs/AUDIT_2026-03.md przed każdym zadaniem
```

Czyli plik będzie wyglądał tak na końcu:
```
...
## Znane problemy do naprawienia     ← istniejąca sekcja
- [ ] Weryfikacja autorów sesji...
- [ ] Walidacje formularzy...
- [ ] Obsługa błędów w endpointach AI
- [ ] Testy responsywności mobile-first

## Aktywny Audit (marzec 2026)       ← NOWA SEKCJA
Pełny raport: docs/AUDIT_2026-03.md
...
