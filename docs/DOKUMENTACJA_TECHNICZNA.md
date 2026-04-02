# MyHelper — Dokumentacja techniczna

> Wersja: marzec 2026 | Stack: Next.js 16 + PostgreSQL 18 + Better Auth + Stripe + AI

---

## Spis treści

1. [Architektura systemu](#1-architektura)
2. [Wymagania środowiskowe](#2-wymagania)
3. [Instalacja i uruchomienie](#3-instalacja)
4. [Konfiguracja zmiennych środowiskowych](#4-env)
5. [Schemat bazy danych](#5-baza-danych)
6. [API — przegląd endpointów](#6-api)
7. [Uwierzytelnianie i autoryzacja](#7-auth)
8. [Integracje zewnętrzne](#8-integracje)
9. [Subskrypcje i płatności (Stripe)](#9-stripe)
10. [Funkcje AI](#10-ai)
11. [Testowanie](#11-testowanie)
12. [Deployment (Vercel)](#12-deployment)
13. [Monitorowanie i logi](#13-monitoring)

---

## 1. Architektura

```
┌─────────────────────────────────────────────┐
│                  Przeglądarka                │
│   Next.js 16 (React 19, Turbopack dev)      │
│   Tailwind CSS 4 + shadcn/ui 3.7            │
└──────────────┬──────────────────────────────┘
               │ HTTPS
┌──────────────▼──────────────────────────────┐
│              Vercel Edge / Node.js 22+       │
│   ~190 API Routes (Next.js App Router)       │
│   Better Auth 1.4.18 (session middleware)    │
└──────┬───────────────────────┬──────────────┘
       │                       │
┌──────▼──────┐    ┌───────────▼──────────────┐
│ PostgreSQL 18│    │      Zewnętrzne API       │
│ (pgvector)  │    │  Stripe / OpenRouter /    │
│ Drizzle ORM │    │  ElevenLabs / Google AI / │
│ 45 tabel    │    │  Twilio / Vercel Blob     │
└─────────────┘    └──────────────────────────┘
```

**Warstwa frontendowa:**
- `src/app/` — strony Next.js (App Router)
- `src/components/` — komponenty React
- `src/hooks/` — custom hooks
- PWA: Service Worker + manifest

**Warstwa backendowa:**
- `src/app/api/` — ~190 REST endpointów
- `src/lib/` — logika biznesowa, konfiguracja auth
- `src/lib/ai/` — abstrakcje dla providerów AI

---

## 2. Wymagania

| Narzędzie | Wersja |
|-----------|--------|
| Node.js | 22+ |
| pnpm | 9+ |
| PostgreSQL | 18 (pgvector) |
| Docker | (opcjonalnie, dla dev DB) |

---

## 3. Instalacja

```bash
# Klonowanie i instalacja zależności
git clone <repo>
cd My_Helper_2
pnpm install

# Uruchom bazę danych (Docker)
docker-compose up -d

# Kopiuj zmienne środowiskowe
cp .env.example .env.local
# Uzupełnij .env.local (patrz sekcja 4)

# Uruchom migracje
pnpm db:migrate

# Opcjonalnie: seed danych testowych
pnpm db:seed:test

# Uruchom dev server
pnpm dev
```

Aplikacja dostępna pod: `http://localhost:3000`

### Komendy

```bash
pnpm dev            # Dev server (Turbopack)
pnpm build          # Build produkcyjny (z migracjami)
pnpm build:ci       # Build bez migracji (Vercel)
pnpm lint           # ESLint
pnpm typecheck      # TypeScript strict
pnpm check          # lint + typecheck
pnpm test           # Vitest (unit)
pnpm test:e2e       # Playwright (E2E)
pnpm test:all       # unit + E2E
pnpm db:push        # Push schema (dev)
pnpm db:generate    # Generuj migracje
pnpm db:migrate     # Uruchom migracje
pnpm db:studio      # Drizzle Studio UI
```

---

## 4. Zmienne środowiskowe

Plik: `.env.local`

### Wymagane

```env
# Baza danych
POSTGRES_URL=postgresql://user:pass@localhost:5432/pos_dev

# Autentykacja
BETTER_AUTH_SECRET=min-32-znakowy-sekret
BETTER_AUTH_URL=http://localhost:3000  # produkcja: https://yourdomain.com
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### Płatności (wymagane dla subskrypcji i zadatków)

```env
STRIPE_SECRET_KEY=sk_test_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_BASIC=price_...   # ID cennika w Stripe
STRIPE_PRICE_PRO=price_...     # ID cennika w Stripe
```

### AI (wymagane dla planu Pro)

```env
OPENROUTER_API_KEY=sk-or-...
OPENROUTER_MODEL=anthropic/claude-sonnet-4-5-20250929  # domyślnie

ELEVENLABS_API_KEY=sk_...      # TTS i STT
GOOGLE_AI_API_KEY=AIza...      # Imagen (obrazy) i Veo (wideo)
```

### Opcjonalne

```env
GOOGLE_CLIENT_ID=...           # OAuth Google
GOOGLE_CLIENT_SECRET=...
BLOB_READ_WRITE_TOKEN=...      # Vercel Blob (upload zdjęć)
TWILIO_ACCOUNT_SID=...         # Asystent głosowy
TWILIO_AUTH_TOKEN=...
TWILIO_PHONE_NUMBER=+48...
```

---

## 5. Baza danych

Schema: `src/lib/schema.ts` (1057 linii, 45 tabel)

### Główne grupy tabel

**Autentykacja (text PKs)**
- `user` — konta użytkowników
- `session` — aktywne sesje (timeout 15 min)
- `account` — powiązania OAuth
- `verification` — weryfikacja email

**Rdzeń biznesowy (UUID PKs)**
- `salons` — salony
- `clients` — kartoteka klientów
- `employees` — pracownicy z rolą i kolorem
- `serviceCategories`, `services`, `serviceVariants` — usługi
- `appointments` — wizyty
- `timeBlocks` — blokady czasu w kalendarzu

**Kadry**
- `employeeServices` — usługi przypisane do pracownika
- `employeeServicePrices` — indywidualne cenniki pracownika
- `workSchedules` — harmonogramy pracy
- `employeeCommissions` — konfiguracja prowizji

**Magazyn**
- `products`, `productCategories` — produkty
- `productUsage` — zużycie produktów
- `serviceProducts` — produkty potrzebne do usługi
- `appointmentMaterials` — zużycie przy konkretnej wizycie
- `treatmentHistory` — karty zabiegów

**Marketing**
- `promotions`, `promoCodes` — promocje
- `loyaltyPoints`, `loyaltyTransactions` — program lojalnościowy
- `newsletters` — baza newsletterów
- `marketingConsents` — zgody RODO
- `scheduledPosts` — zaplanowane posty social media

**Powiadomienia**
- `notifications` — historia powiadomień
- `waitingList` — lista oczekujących
- `temporaryAccess` — jednorazowy dostęp
- `pushSubscriptions` — subskrypcje web push

**Płatności**
- `subscriptionPlans` — definicje planów (Basic, Pro)
- `salonSubscriptions` — aktywne subskrypcje
- `subscriptionPayments` — historia płatności Stripe
- `depositPayments` — zadatki
- `invoices`, `fiscalReceipts` — dokumenty finansowe

**AI i inne**
- `aiConversations` — historia rozmów AI
- `aiGeneratedMedia` — wygenerowane media
- `favoriteSalons` — ulubione salony klientów
- `galleryPhotos`, `albums`, `photoAlbums` — galeria

### Docker Compose (dev)

```yaml
# docker-compose.yml
services:
  postgres:
    image: pgvector/pgvector:pg18
    ports: ["5432:5432"]
    environment:
      POSTGRES_DB: pos_dev
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
```

---

## 6. API

Wszystkie endpointy w `src/app/api/`. Poniżej przegląd domen.

### Wzorzec odpowiedzi

```json
// Sukces
{ "success": true, "data": { ... } }

// Błąd
{ "success": false, "error": "Opis błędu" }
```

### Kluczowe endpointy

**Dashboard**
- `GET /api/dashboard/stats` — statystyki dashboardu

**Wizyty**
- `GET /api/appointments` — lista wizyt
- `POST /api/appointments` — nowa wizyta
- `GET /api/appointments/[id]` — szczegóły
- `PUT /api/appointments/[id]` — edycja
- `POST /api/appointments/[id]/complete` — zakończenie
- `GET /api/appointments/[id]/materials` — zużyte materiały
- `POST /api/appointments/[id]/materials` — dodaj materiał
- `GET /api/appointments/[id]/invoice` — faktura
- `POST /api/appointments/[id]/fiscal-receipt` — paragon
- `GET /api/appointments/[id]/refund-status` — status zwrotu zadatku

**Klienci**
- `GET /api/clients` — lista
- `POST /api/clients` — nowy klient
- `GET /api/clients/[id]` — profil
- `PUT /api/clients/[id]` — edycja
- `DELETE /api/clients/[id]` — usunięcie

**Pracownicy**
- `GET /api/employees` — lista
- `POST /api/employees` — nowy
- `GET /api/employees/[id]` — szczegóły
- `PUT /api/employees/[id]` — edycja
- `GET /api/work-schedules` — harmonogramy

**Usługi**
- `GET /api/services` — lista usług
- `POST /api/services` — nowa usługa
- `GET /api/services/[id]` — szczegóły
- `PUT /api/services/[id]` — edycja

**Raporty**
- `GET /api/reports/revenue` — przychody
- `GET /api/reports/employee-occupancy` — obciążenie
- `GET /api/reports/employee-payroll` — wynagrodzenia
- `GET /api/reports/services-popularity` — popularność usług
- `GET /api/reports/promotions` — efektywność promocji
- `GET /api/reports/cancellations` — anulacje
- `GET /api/reports/monthly-comparison` — porównanie miesięczne
- `GET /api/reports/yearly-comparison` — porównanie roczne

**AI (wymaga Pro)**
- `POST /api/ai/appointments/auto-summary` — podsumowanie po wizycie
- `POST /api/ai/categorize` — auto-kategoryzacja
- `POST /api/ai/clients/insights` — analiza klienta
- `POST /api/ai/search` — wyszukiwanie naturalne (Cmd+K)
- `POST /api/ai/voice/tts` — ElevenLabs TTS
- `POST /api/ai/voice/stt` — ElevenLabs STT
- `POST /api/ai/voice/interpret-command` — interpretacja komendy głosowej
- `POST /api/ai/image/generate` — Imagen
- `POST /api/ai/image/enhance` — ulepszenie zdjęcia
- `POST /api/ai/image/banner` — baner promocyjny
- `POST /api/ai/image/service-illustration` — ilustracja usługi
- `POST /api/ai/video/generate` — generowanie Veo
- `GET /api/ai/video/status/[taskId]` — status generowania
- `POST /api/ai/video/story` — animated story
- `POST /api/ai/video/testimonial-template` — skrypt testimonial
- `GET /api/ai/usage` — monitoring kosztów AI

**Subskrypcje**
- `GET /api/subscription-plans` — lista planów
- `POST /api/subscriptions/checkout` — inicjacja Stripe Checkout
- `GET /api/subscriptions/current` — aktywna subskrypcja
- `POST /api/subscriptions/cancel` — anulowanie
- `POST /api/stripe/webhook` — Stripe webhook

**Powiadomienia i Cron**
- `GET /api/cron/birthday` — automatyczne urodzinowe
- `GET /api/cron/low-stock` — alerty magazynowe
- `GET /api/cron/we-miss-you` — "tęsknimy za Tobą"
- `GET /api/cron/push-reminders` — przypomnienia push

---

## 7. Autentykacja i autoryzacja

### Better Auth

Konfiguracja: `src/lib/auth.ts` i `src/lib/auth-client.ts`

```typescript
// Sprawdzenie sesji po stronie serwera
import { auth } from "@/lib/auth";

const session = await auth.api.getSession({
  headers: request.headers
});
if (!session?.user) {
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}
```

```typescript
// Po stronie klienta
import { useSession } from "@/lib/auth-client";

const { data: session, isPending } = useSession();
```

### Middleware autoryzacji

`src/lib/auth-middleware.ts` — helper `requireAuth(role?)`:

```typescript
// Przykład użycia w API route
import { requireAuth } from "@/lib/auth-middleware";

export async function GET(request: Request) {
  const authResult = await requireAuth(request, "owner");
  if (!authResult.success) return authResult.response;

  const { session } = authResult;
  // ...
}
```

### Role

| Role | Wartość w DB |
|------|-------------|
| Właściciel | `owner` |
| Pracownik | `employee` |
| Recepcja | `reception` |
| Klient | `client` (portal klienta) |

### Timeout sesji

Sesja wygasa po **15 minutach nieaktywności**. Konfiguracja w `src/lib/auth.ts`.

---

## 8. Integracje zewnętrzne

### OpenRouter (LLM)

```typescript
// src/lib/ai/openrouter.ts
import { createAIClient, getAIModel, requireProAI } from "@/lib/ai/openrouter";

// Weryfikacja planu Pro
const proCheck = await requireProAI(salonId);
if (!proCheck.ok) return Response.json({ error: proCheck.error }, { status: 403 });

const client = createAIClient();
const model = getAIModel(); // domyślnie: anthropic/claude-sonnet-4-5-20250929
```

### ElevenLabs (Voice AI)

```typescript
// src/lib/ai/elevenlabs.ts
import { createElevenLabsClient, DEFAULT_VOICE_ID } from "@/lib/ai/elevenlabs";

const client = createElevenLabsClient();
// TTS: client.generate({ voice: DEFAULT_VOICE_ID, text: "..." })
// STT: client.speechToText.convert(...)
```

### Google Imagen/Veo

```typescript
// src/lib/ai/google-imagen.ts
import { generateImage, IMAGE_STYLE_PRESETS, IMAGE_SIZES } from "@/lib/ai/google-imagen";

// src/lib/ai/google-veo.ts
import { startVideoGeneration, checkVideoStatus, VEO_MODEL } from "@/lib/ai/google-veo";
```

### Twilio (Voice calls)

```typescript
// src/lib/ai/twilio.ts
import { createTwilioClient, isTwilioConfigured } from "@/lib/ai/twilio";

if (!isTwilioConfigured()) {
  // Twilio opcjonalny — nie blokuj działania
}
```

### Stripe

Webhooks: `src/app/api/stripe/webhook/route.ts`

Obsługiwane eventy:
- `checkout.session.completed` — aktywacja subskrypcji / zadatku
- `invoice.payment_succeeded` — odnowienie subskrypcji
- `customer.subscription.deleted` — anulowanie
- `payment_intent.succeeded` — płatność zadatku

---

## 9. Subskrypcje i płatności (Stripe)

### Konfiguracja w Stripe Dashboard

1. Utwórz dwa produkty: **Basic** i **Pro**
2. Utwórz cenniki miesięczne (recurring)
3. Skopiuj ID cenników do `.env.local` (`STRIPE_PRICE_BASIC`, `STRIPE_PRICE_PRO`)
4. Skonfiguruj webhook do `https://yourdomain.com/api/stripe/webhook`
5. Skopiuj `Webhook Secret` do `STRIPE_WEBHOOK_SECRET`

### Płatności w Stripe Dashboard (wypełnianie bazy)

```sql
-- Ręczne dodanie planów jeśli seed nie zadziałał
INSERT INTO "subscriptionPlans" (id, name, slug, "priceMonthly", features, "isActive")
VALUES
  (gen_random_uuid(), 'Basic', 'basic', '49.00', ARRAY['...'], true),
  (gen_random_uuid(), 'Pro', 'pro', '149.00', ARRAY['...'], true);
```

### Zadatki

Klient płaci zadatek przy rezerwacji. System:
1. Tworzy `PaymentIntent` w Stripe
2. Przechowuje ID w `depositPayments`
3. Przy anulacji: właściciel może zlecić zwrot przez UI

---

## 10. Funkcje AI

### Wymagania planu Pro

Wszystkie endpointy AI sprawdzają plan przez `requireProAI(salonId)`:

```typescript
// src/lib/ai/openrouter.ts
export async function requireProAI(salonId: string) {
  const subscription = await db.query.salonSubscriptions...;
  if (subscription?.plan?.slug !== 'pro') {
    return { ok: false, error: "Funkcja dostępna tylko w planie Pro" };
  }
  return { ok: true };
}
```

Po stronie klienta komponent `ProPlanGate` chroni sekcje UI:

```tsx
<ProPlanGate featureName="..." proBenefits={[...]}>
  <FeatureContent />
</ProPlanGate>
```

### Monitoring kosztów AI

Każde wywołanie AI jest rejestrowane w tabeli `aiConversations` z:
- `salonId`
- `tokensUsed`
- `modelName`
- `cost` (szacunkowy)
- `createdAt`

Endpoint `GET /api/ai/usage` zwraca sumy per salonId.

---

## 11. Testowanie

### Testy jednostkowe (Vitest)

```bash
pnpm test              # wszystkie
pnpm test:watch        # tryb watch
pnpm test:coverage     # z raportem pokrycia
```

Pliki testów: `__tests__/`

**Pokrycie:**
- API endpoints: `__tests__/api/`
- Utilities: `__tests__/lib/`
- Hooks: `__tests__/hooks/`
- Komponenty: `__tests__/components/`

### Testy E2E (Playwright)

```bash
pnpm test:e2e          # wszystkie
pnpm test:e2e:ui       # Playwright UI mode
```

**Konfiguracja:** `playwright.config.ts`

**Pliki testów:** `tests/`
- `tests/auth/` — logowanie, rejestracja
- `tests/dashboard/` — CRUD, wizyty, pracownicy
- `tests/client-portal/` — przepływ klienta
- `tests/ai-tools/` — funkcje AI (plan Pro)
- `tests/production/health.spec.ts` — health checks produkcyjne

**Global auth state:** `tests/.auth/` — zalogowany użytkownik dla E2E (nie loguj per test!)

**Tagi:**
- `@smoke` — szybkie (CI na każdym push)
- `@full` — pełne (CI na push do main)
- `@production` — health checks po deploymencie

### CI/CD (GitHub Actions)

`.github/workflows/quality-gate.yml` — uruchamia się na push/PR do main:
1. TypeScript check
2. Unit tests z coverage
3. E2E Smoke (`@smoke`, 4 workers, timeout 10 min)
4. E2E Full (`@full`, 2 workers, timeout 35 min — tylko push do main)
5. Security audit (`pnpm audit`)

`.github/workflows/e2e-production.yml` — po deploy na Vercel:
- Production Health Checks (`@production`, 2 workers, timeout 5 min)

---

## 12. Deployment (Vercel)

### Konfiguracja Vercel

`vercel.json`:
```json
{
  "buildCommand": "pnpm build:ci"
}
```

`pnpm build:ci` = `next build` bez uruchamiania migracji (migracje uruchamiać ręcznie lub przez osobny krok).

### Zmienne środowiskowe Vercel

Dodaj wszystkie zmienne z sekcji 4 w dashboardzie Vercel → Settings → Environment Variables.

### Baza danych w produkcji

Zalecane: **Neon** (PostgreSQL as a Service, kompatybilny z pgvector) lub **Supabase**.

Connection string: `POSTGRES_URL=postgresql://...`

### Uruchomienie migracji produkcyjnych

```bash
# Lokalnie, wskazując na produkcyjną DB
POSTGRES_URL=postgresql://prod... pnpm db:migrate
```

---

## 13. Monitorowanie i logi

### Logi aplikacji

Aktualnie: `console.log` (do refactoringu na structured logging — Priorytet 2 w audycie).

Zalecane: Vercel Log Drains → Datadog/LogTail.

### Health check

`GET /api/health` — zwraca status aplikacji i DB.

Używany w produkcyjnych testach E2E (`@production` tag).

### Alerty biznesowe

Automatyczne cron joby (wywoływane przez Vercel Cron lub zewnętrzny scheduler):

| Endpoint | Częstotliwość | Opis |
|----------|---------------|------|
| `/api/cron/birthday` | Codziennie rano | Wiadomości urodzinowe |
| `/api/cron/low-stock` | Codziennie | Alerty niskiego stanu magazynu |
| `/api/cron/we-miss-you` | Co tydzień | Powiadomienia do nieaktywnych klientów |
| `/api/cron/push-reminders` | Co godzinę | Przypomnienia o wizytach |

Konfiguracja w `vercel.json` (lub zewnętrzny cron service).

---

## Znane ograniczenia i TODO

Aktualny audit bezpieczeństwa: `docs/AUDIT_2026-03.md`

**Blokers (przed produkcją):**
- 91 endpointów API bez weryfikacji autoryzacji
- Brakujące FK w schema (fiscalReceipts, appointmentMaterials)
- N+1 queries w cron jobs

**Priorytet 1:**
- 6 brakujących indeksów DB
- Walidacja Zod na 62 endpointach POST/PUT
- Aktualizacja wrażliwych zależności (xlsx, jsPDF)

Pełna lista: `docs/AUDIT_2026-03.md`

---

*Dokumentacja techniczna MyHelper v1.0 — marzec 2026*
