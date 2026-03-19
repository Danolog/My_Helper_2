# MyHelper — Project Instructions

## Overview

MyHelper to alternatywa dla Booksy dla malych firm uslugowych (salony kosmetyczne, fryzjerzy, gabinety). Model subskrypcyjny: Basic (49 PLN/mies.) i Pro (149 PLN/mies. z AI). 14-dniowy trial. Panel salonu, portal klienta z rezerwacja online i platnoscia zadatkow, magazyn, promocje, raporty.

## Technology Stack

- **Frontend**: Next.js 16.1.6 + React 19.2.4, Tailwind CSS 4 + shadcn/ui 3.7, Framer Motion, next-themes
- **Backend**: Node.js 22+, Next.js API Routes (~190 endpointow), PostgreSQL 18 (pgvector, Docker)
- **ORM**: Drizzle ORM 0.44.7, schema: `src/lib/schema.ts` (1057 lines, 45 tabele)
- **Auth**: Better Auth 1.4.18 (email/password + Google OAuth), 15-min session timeout
- **Payments**: Stripe 20.3.1 (subskrypcje + zadatki) + Blik P2P
- **AI**: Vercel AI SDK 5 + OpenRouter (anthropic/claude-sonnet-4-5-20250929) — tylko plan Pro
- **Voice AI**: ElevenLabs (TTS, STT) via `elevenlabs` SDK
- **Image AI**: Google Imagen 3 via `@google/genai` SDK
- **Video AI**: Google Veo 3.1 via `@google/genai` SDK
- **Telephony**: Twilio (voice calls, optional)
- **Validation**: Zod 4.3.6
- **PWA**: Service Worker, install prompt, offline fallback
- **Package manager**: pnpm
- **Deployment**: Vercel (build: `pnpm build:ci`)

## Project Structure

```
src/app/(auth)/          # logowanie, rejestracja, reset hasla
src/app/(client)/        # portal klienta (salony, rezerwacja, wizyty, ulubione)
src/app/dashboard/       # panel wlasciciela (~50 podstron, ~82 page.tsx total)
src/app/api/             # ~190 endpointow REST (~200 katalogow)
src/app/calendar/        # widok kalendarza pracownikow
src/components/ui/       # shadcn/ui
src/components/calendar/ # time-grid, week-time-grid, event, legend, dialogi
src/components/auth/     # formularze autentykacji
src/components/appointments/ # dialogi wizyt
src/components/reports/  # filtry dat, filtry pracownikow
src/components/subscription/ # bramka planu Pro
src/components/pwa/      # install prompt, service worker
src/components/content-generator/ # image, video, story, testimonial generators
src/components/promotions/       # banner generator
src/components/services/         # service illustration button
src/hooks/               # custom React hooks
src/lib/                 # core utilities, auth config, schema, server logic
src/lib/ai/              # AI provider abstractions (openrouter, elevenlabs, google-imagen, google-veo)
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
- `__tests__/api/ai-*.test.ts` — testy AI endpoints (categorize, auto-summary, search, notifications)
- `__tests__/hooks/use-ai-search.test.ts` — test AI search hook
- `__tests__/components/` — testy komponentow (Calendar*, DateRangeFilter, EmployeeFilter, auth forms, PWA, ProPlanGate, UnsavedChangesDialog)

### E2E Tests (Playwright)
- `tests/auth/authentication.spec.ts` — logowanie, rejestracja, reset hasla
- `tests/dashboard/` — services, inventory, appointments, employees, reports, subscriptions
- `tests/client-portal/client-flows.spec.ts` — flow klienta
- `tests/ai-tools/ai-features.spec.ts` — AI (plan Pro)
- `tests/ai-features/ai-smoke.spec.ts` — smoke testy stron AI
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

## Database Schema (45 tabele)

- **Auth**: user, session, account, verification (text PKs)
- **Core**: salons, clients, employees, serviceCategories, services, serviceVariants, appointments, timeBlocks (UUID PKs)
- **Staff**: employeeServices, employeeServicePrices, workSchedules, employeeCommissions
- **Inventory**: products, productCategories, productUsage, serviceProducts, appointmentMaterials, treatmentHistory
- **Gallery**: galleryPhotos, albums, photoAlbums
- **Marketing**: promotions, promoCodes, loyaltyPoints, loyaltyTransactions, newsletters, marketingConsents, scheduledPosts
- **Notifications**: notifications, waitingList, temporaryAccess, pushSubscriptions
- **Payments**: subscriptionPlans, salonSubscriptions, subscriptionPayments, depositPayments, invoices, fiscalReceipts
- **AI & Other**: aiConversations, aiGeneratedMedia, favoriteSalons

## API Domains

- **AI (Pro)**: Business (alerts, analytics, chat, recommendations, categorize, search, insights), Content (descriptions, social-post, newsletter, auto-summary), Voice (book, cancel, reschedule, tts, stt, interpret-command, twilio), Image (generate, enhance, banner, service-illustration), Video (generate, status, story, testimonial-template), Usage monitoring
- **Core CRUD**: appointments, clients, employees, services, products, salons, gallery, invoices, promotions, promo-codes, reviews, work-schedules, time-blocks, waiting-list, scheduled-posts, temporary-access
- **Client Portal**: /api/client/appointments, reviews, waiting-list, /api/favorites/salons
- **Finance**: deposits, subscriptions, stripe webhooks, reports (revenue, occupancy, payroll, popularity, profitability, materials, promotions, cancellations, monthly/yearly comparison)
- **Notifications & Cron**: birthday, low-stock, we-miss-you, push, reminders, cron jobs

## AI Features (Pro Plan)

All AI features require Pro plan (149 PLN/mies). Gated by `requireProAI()` server-side and `ProPlanGate` component client-side.

### Shared Utilities (`src/lib/ai/`)
- `openrouter.ts` — createAIClient(), getAIModel(), requireProAI(), isProAIError(), getSalonContext(), gatherSalonData(), trackAIUsage()
- `elevenlabs.ts` — createElevenLabsClient(), DEFAULT_VOICE_ID, DEFAULT_TTS_MODEL
- `google-imagen.ts` — createGoogleAIClient(), generateImage(), IMAGE_STYLE_PRESETS, IMAGE_SIZES
- `google-veo.ts` — startVideoGeneration(), checkVideoStatus(), VEO_MODEL
- `twilio.ts` — createTwilioClient(), getTwilioPhoneNumber(), isTwilioConfigured()

### AI API Endpoints
| Endpoint | Purpose |
|----------|---------|
| POST /api/ai/appointments/auto-summary | AI summary after appointment completion |
| POST /api/ai/categorize | Auto-categorize services/products |
| POST /api/ai/clients/insights | Client analysis (churn risk, trends) |
| POST /api/ai/search | Natural language search (Cmd+K) |
| POST /api/ai/notifications/personalize | Personalize notification messages |
| POST /api/ai/voice/tts | ElevenLabs Text-to-Speech |
| POST /api/ai/voice/stt | ElevenLabs Speech-to-Text |
| POST /api/ai/voice/interpret-command | Voice command interpretation |
| POST /api/ai/image/generate | Google Imagen image generation |
| POST /api/ai/image/enhance | Sharp photo enhancement (7 presets) |
| POST /api/ai/image/banner | Promotional banner (AI bg + text overlay) |
| POST /api/ai/image/service-illustration | Service placeholder illustration |
| POST /api/ai/video/generate | Google Veo async video generation |
| GET /api/ai/video/status/[taskId] | Video generation polling |
| POST /api/ai/video/story | Animated Instagram Stories (9:16) |
| POST /api/ai/video/testimonial-template | Video testimonial text scripts |
| GET /api/ai/usage | AI cost monitoring stats |
| POST /api/ai/voice/twilio/webhook | Twilio incoming call handler |
| POST /api/ai/voice/twilio/status | Twilio call status callback |

### AI Components
- `VoiceTextarea` — Textarea with ElevenLabs mic button
- `ReadAloudButton` — TTS playback button
- `VoiceCommandButton` — Floating mic for voice commands
- `ClientInsightsTab` — AI analysis tab on client profile
- `ImageGenerator` — Social media graphics generator
- `VideoGenerator` — Promotional video clips (Veo)
- `StoryGenerator` — Animated Instagram Stories
- `TestimonialTemplate` — Video testimonial scripts
- `BannerGenerator` — Promotional banners
- `PhotoEnhanceDialog` — Gallery photo enhancement
- `ServiceIllustrationButton` — Service image generation

### AI Hooks
- `useVoiceInput` — MediaRecorder + ElevenLabs STT
- `useTextToSpeech` — ElevenLabs TTS playback
- `useAISearch` — Debounced natural language search (>3 words)

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
ELEVENLABS_API_KEY                    # ElevenLabs voice AI (TTS, STT)
GOOGLE_AI_API_KEY                     # Google Imagen + Veo (images, video)
TWILIO_ACCOUNT_SID                    # Twilio telephony (optional)
TWILIO_AUTH_TOKEN                     # Twilio telephony (optional)
TWILIO_PHONE_NUMBER                   # Twilio phone number (optional)
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
