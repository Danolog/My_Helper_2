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

@.claude/docs/test-infrastructure.md
@.claude/docs/env-variables.md
@.claude/docs/context-management.md
@.claude/docs/audit.md
