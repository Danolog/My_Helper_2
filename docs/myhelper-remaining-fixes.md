# MyHelper — Remaining Issues: Instrukcje napraw

Skopiuj do `docs/REMAINING_FIXES.md`. Każde zadanie = osobny commit.
Po każdym: `pnpm typecheck && pnpm test`.

---

## Zadanie 1: Zod validation na 33 mutation routes (2-3h)

### Commit: `feat(security): add Zod validation to remaining 33 mutation routes`

**33 route'y bez walidacji** (pominięto `auth/[...all]` — Better Auth obsługuje sam):

**Grupa A — AI Voice (6 plików, stwórz schemat):**
```
src/app/api/ai/voice/book/route.ts
src/app/api/ai/voice/cancel/route.ts
src/app/api/ai/voice/config/route.ts
src/app/api/ai/voice/incoming/route.ts
src/app/api/ai/voice/message/route.ts
src/app/api/ai/voice/reschedule/route.ts
```
Stwórz w `api-validation.ts`:
```typescript
export const voiceBookSchema = z.object({
  salonId: z.string().uuid(),
  serviceId: z.string().uuid(),
  employeeId: z.string().uuid().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  clientName: z.string().min(2).max(100),
  clientPhone: z.string().min(9).max(15),
});

export const voiceCancelSchema = z.object({
  appointmentId: z.string().uuid(),
  reason: z.string().max(500).optional(),
});

export const voiceRescheduleSchema = z.object({
  appointmentId: z.string().uuid(),
  newDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  newTime: z.string().regex(/^\d{2}:\d{2}$/),
});

export const voiceMessageSchema = z.object({
  message: z.string().min(1).max(2000),
  conversationId: z.string().uuid().optional(),
});

export const voiceConfigSchema = z.object({
  salonId: z.string().uuid(),
  enabled: z.boolean(),
  language: z.enum(["pl", "en"]).default("pl"),
});
```

**Grupa B — Subskrypcje (5 plików):**
```
src/app/api/subscriptions/cancel/route.ts
src/app/api/subscriptions/downgrade/route.ts
src/app/api/subscriptions/renew/route.ts
src/app/api/subscriptions/expiration-warning/route.ts
src/app/api/subscriptions/payments/[id]/receipt/route.ts
```
Stwórz:
```typescript
export const cancelSubscriptionSchema = z.object({
  reason: z.string().max(500).optional(),
  immediate: z.boolean().default(false),
});

export const downgradeSubscriptionSchema = z.object({
  targetPlan: z.enum(["basic"]),
});

export const renewSubscriptionSchema = z.object({
  planId: z.string().uuid(),
});
```
Dla `expiration-warning` i `receipt` — cron/GET, Zod na query params jeśli przyjmują.

**Grupa C — Client portal (2 pliki):**
```
src/app/api/client/appointments/[id]/cancel/route.ts
src/app/api/client/waiting-list/[id]/route.ts
```
Stwórz:
```typescript
export const clientCancelSchema = z.object({
  reason: z.string().max(500).optional(),
});
```

**Grupa D — Push/Notifications (3 pliki):**
```
src/app/api/push/test/route.ts
src/app/api/reminders/appointment/route.ts
src/app/api/register-subscription/route.ts
```
Stwórz:
```typescript
export const pushTestSchema = z.object({
  userId: z.string(),
  title: z.string().max(100),
  body: z.string().max(500),
});

export const registerSubscriptionSchema = z.object({
  planId: z.string().uuid(),
  paymentMethod: z.enum(["stripe", "blik"]).default("stripe"),
});
```

**Grupa E — Salon settings (2 pliki):**
```
src/app/api/salons/[id]/fiscal-settings/test-connection/route.ts
src/app/api/salons/[id]/fiscal-settings/test-print/route.ts
```
Stwórz:
```typescript
export const fiscalTestSchema = z.object({
  apiKey: z.string().min(1),
  endpoint: z.string().url(),
});
```

**Grupa F — Gallery upload (1 plik):**
```
src/app/api/gallery/upload/route.ts
```
Walidacja FormData — sprawdź typ pliku i rozmiar:
```typescript
// W handlerze POST:
const formData = await req.formData();
const file = formData.get("file") as File | null;
if (!file) return NextResponse.json({ error: "Brak pliku" }, { status: 400 });
if (file.size > 10 * 1024 * 1024) return NextResponse.json({ error: "Plik > 10MB" }, { status: 400 });
if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
  return NextResponse.json({ error: "Niedozwolony typ pliku" }, { status: 400 });
```

**Grupa G — Scheduled posts, invoices (2 pliki):**
```
src/app/api/scheduled-posts/[id]/publish/route.ts
src/app/api/invoices/[id]/send-email/route.ts
```
Stwórz:
```typescript
export const sendInvoiceEmailSchema = z.object({
  recipientEmail: z.string().email(),
  subject: z.string().max(200).optional(),
});
```

**Grupa H — Cron jobs (5 plików) — POMIŃ:**
```
src/app/api/cron/cleanup-temporary-access/route.ts
src/app/api/cron/publish-scheduled-posts/route.ts
src/app/api/cron/push-reminders-24h/route.ts
src/app/api/cron/push-reminders/route.ts
src/app/api/cron/sms-reminders/route.ts
```
Te nie przyjmują body od usera — walidują `requireCronSecret()`. Zod niepotrzebny.

**Grupa I — Dev/test (3 pliki) — POMIŃ:**
```
src/app/api/diagnostics/route.ts
src/app/api/seed/route.ts
src/app/api/test/error/route.ts
```
Wewnętrzne, chronione NODE_ENV. Zod niepotrzebny.

**Podsumowanie:** 33 - 5 cron - 3 dev = **25 route'ów do dodania Zod validation.**

**Komenda dla Claude Code:**
```
Przeczytaj docs/REMAINING_FIXES.md Zadanie 1.
Dodaj Zod validation do 25 mutation routes (pomijając cron jobs i dev endpoints).
Stwórz brakujące schematy w src/lib/api-validation.ts.
Rób grupami A→G. Po każdej grupie: pnpm typecheck && pnpm test
```

---

## Zadanie 2: Rozbicie 8 monolitów > 800 linii (3-4h)

### Commity: `refactor: split [nazwa] into components`

| Plik | Linie | Cel |
|------|-------|-----|
| `components/ai-assistant/voice/voice-call-panel.tsx` | 1444 | < 400 |
| `dashboard/settings/notifications/page.tsx` | 971 | < 300 |
| `dashboard/ai-assistant/trends/page.tsx` | 924 | < 300 |
| `dashboard/reports/materials-profitloss/page.tsx` | 910 | < 300 |
| `dashboard/clients/page.tsx` | 910 | < 300 |
| `(client)/salons/[id]/book/page.tsx` | 888 | < 300 |
| `dashboard/content-generator/social-posts/page.tsx` | 828 | < 300 |
| `dashboard/reports/revenue/page.tsx` | 801 | < 300 |

**Pattern (identyczny jak w poprzednim refaktorze):**
```
[page.tsx 1000 linii] →
  page.tsx              (150-300 linii — layout + imports)
  _components/
    [Feature]Form.tsx   (dialog/forma)
    [Feature]List.tsx   (tabela/lista/widok)
    [Feature]Filters.tsx (filtry, search, datepicker)
    [Feature]Stats.tsx  (summary cards)
  _hooks/
    use-[feature]-data.ts (fetch, state, mutations)
  _types/
    index.ts            (interfejsy)
```

**Przykład dla `voice-call-panel.tsx` (1444 linii):**
```
voice-call-panel.tsx (200 linii — orkestracja)
_components/
  VoiceControls.tsx     (przyciski start/stop/mute)
  VoiceTranscript.tsx   (historia rozmowy)
  VoiceStatus.tsx       (status połączenia, timer)
  VoiceSettings.tsx     (config dialog)
_hooks/
  use-voice-call.ts     (WebSocket, audio stream, state)
```

**Komenda dla Claude Code:**
```
Przeczytaj docs/REMAINING_FIXES.md Zadanie 2.
Rozbij 8 monolitycznych "use client" stron > 800 linii.
Zacznij od voice-call-panel.tsx (1444 linii) — to najcięższy.
Pattern: page.tsx < 300 linii, logika w _hooks/, UI w _components/.
Po każdym pliku: pnpm typecheck && pnpm test
```

---

## Zadanie 3: db.transaction() na multi-step operacjach (1h)

### Commit: `fix(data): wrap multi-step DB operations in transactions`

Masz 3 transakcje (complete, confirm, newsletter send). Brakuje w:

**stripe/webhook/route.ts — 12 DB operacji, ZERO transakcji:**
```typescript
// Obecny kod (uproszczony):
await db.update(salonSubscriptions).set({ status: "active" });
await db.insert(subscriptionPayments).values({ ... });
await db.update(salonSubscriptions).set({ stripeSubscriptionId: ... });
// ... 9 więcej operacji

// Poprawka — opakowuj w transakcję per event type:
await db.transaction(async (tx) => {
  await tx.update(salonSubscriptions).set({ status: "active" }).where(...);
  await tx.insert(subscriptionPayments).values({ ... });
});
```

**subscriptions/checkout/route.ts — 5 DB operacji:**
```typescript
await db.transaction(async (tx) => {
  const [subscription] = await tx.insert(salonSubscriptions).values({...}).returning();
  await tx.insert(subscriptionPayments).values({...});
  // ...
});
```

**subscriptions/cancel/route.ts — 2 DB operacji:**
**subscriptions/renew/route.ts — 2 DB operacji:**
**subscriptions/downgrade/route.ts — 2 DB operacji:**
**deposits/confirm/route.ts — 2 DB operacji:**

Wszystkie z 2+ DB ops opakowuj w `db.transaction()`.

**Komenda dla Claude Code:**
```
Przeczytaj docs/REMAINING_FIXES.md Zadanie 3.
Opakowuj multi-step DB operacje w db.transaction().
Priorytet: stripe/webhook (12 ops), subscriptions/checkout (5 ops).
Następnie: cancel, renew, downgrade, deposits/confirm.
Po każdym pliku: pnpm typecheck && pnpm test
```

---

## Zadanie 4: Rate limiting na CRUD endpointach (30 min)

### Commit: `feat(security): add rate limiting to CRUD endpoints`

Masz 5 route'ów z rate limit. Dodaj do pozostałych write endpointów:

```typescript
import { apiRateLimit } from "@/lib/rate-limit";

// Na początku POST/PUT/PATCH/DELETE handlera:
const rateLimitResult = apiRateLimit(request);
if (rateLimitResult) return rateLimitResult;
```

**Dodaj `apiRateLimit` (60 req/min) do:**
```
src/app/api/appointments/route.ts      — POST
src/app/api/clients/route.ts           — POST
src/app/api/employees/route.ts         — POST (?)
src/app/api/services/route.ts          — POST
src/app/api/products/route.ts          — POST
src/app/api/salons/route.ts            — POST
src/app/api/reviews/route.ts           — POST
src/app/api/push/subscribe/route.ts    — POST
src/app/api/promo-codes/route.ts       — POST
src/app/api/promotions/route.ts        — POST
src/app/api/work-schedules/route.ts    — POST/PUT
src/app/api/time-blocks/route.ts       — POST
```

**Dodaj `strictRateLimit` (5 req/min) do:**
```
src/app/api/gallery/upload/route.ts    — POST (upload plików)
src/app/api/push/subscribe/route.ts    — POST (może być nadużywany)
```

**Uwaga:** In-memory rate limiter nie działa w serverless (Vercel — osobna instancja per request). Na produkcję zamień na Upstash Redis:
```bash
pnpm add @upstash/ratelimit @upstash/redis
```
```typescript
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(60, "1 m"),
});
```
To wymaga konta Upstash (darmowy tier: 10k req/dzień). Na teraz in-memory jest OK dla dev/staging.

**Komenda dla Claude Code:**
```
Przeczytaj docs/REMAINING_FIXES.md Zadanie 4.
Dodaj apiRateLimit do 12 CRUD route'ów i strictRateLimit do gallery/upload i push/subscribe.
Po implementacji: pnpm typecheck && pnpm test
```

---

## Zadanie 5: Seed route protection (5 min)

### Commit: `fix(security): add requireAuth to seed route`

```typescript
// src/app/api/seed/route.ts — dodaj na początek POST:
import { requireAuth, isAuthError } from "@/lib/auth-middleware";

export async function POST(req: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Disabled in production" }, { status: 403 });
  }

  const authResult = await requireAuth("owner");
  if (isAuthError(authResult)) return authResult;

  // ... reszta kodu seed
}
```

**Komenda dla Claude Code:**
```
Dodaj requireAuth("owner") do src/app/api/seed/route.ts.
```

---

## Zadanie 6: style-src unsafe-inline → nonce (30 min, OPCJONALNE)

### Commit: `fix(security): add nonce to style-src CSP`

**Uwaga:** To jest najtrudniejsze zadanie. Tailwind CSS 4 i next-themes wstrzykują inline `<style>`. Usunięcie `unsafe-inline` z `style-src` może zepsuć style.

**Podejście bezpieczne:**

1. W `src/proxy.ts` linia 101:
```typescript
// Zmień:
"style-src 'self' 'unsafe-inline' fonts.googleapis.com",
// Na:
`style-src 'self' 'nonce-${nonce}' fonts.googleapis.com`,
```

2. W `src/app/layout.tsx` — przekaż nonce do ThemeProvider:
```typescript
const headersList = await headers();
const nonce = headersList.get("x-nonce") ?? undefined;

// W body:
<ThemeProvider attribute="class" defaultTheme="system" enableSystem nonce={nonce}>
```

3. **TEST:** `pnpm dev` → otwórz stronę → sprawdź czy style działają. Jeśli dark mode lub Tailwind się psuje → cofnij do `unsafe-inline` i zostaw jako akceptowalny kompromis. Style-src unsafe-inline jest mniej groźne niż script-src unsafe-inline.

**Komenda dla Claude Code:**
```
Przeczytaj docs/REMAINING_FIXES.md Zadanie 6.
Spróbuj zamienić style-src unsafe-inline na nonce w proxy.ts.
Przekaż nonce do ThemeProvider w layout.tsx.
Sprawdź: pnpm dev → czy style i dark mode działają.
Jeśli psuje się → cofnij i zostaw unsafe-inline.
```

---

## Kolejność wykonania

```
Dzień 1 (3h):
  Zadanie 5 — seed auth (5 min) → commit
  Zadanie 1 grupy A-C — Zod AI voice + subskrypcje + client (1.5h) → commit
  Zadanie 1 grupy D-G — Zod push + salon + gallery + invoices (1h) → commit
  Zadanie 4 — rate limiting na CRUD (30 min) → commit

Dzień 2 (3-4h):
  Zadanie 3 — transakcje w stripe/webhook i subskrypcjach (1h) → commit
  Zadanie 2 — rozbicie 4 monolitów (voice, notifications, trends, clients) (2h) → 4 commity

Dzień 3 (2-3h):
  Zadanie 2 — rozbicie 4 monolitów (materials, book, social, revenue) (2h) → 4 commity
  Zadanie 6 — style-src nonce (30 min, opcjonalne) → commit
  Final: pnpm typecheck && pnpm test && pnpm build:ci
```

**Oczekiwany wynik po naprawach:**
- Bezpieczeństwo: 8 → 9/10
- Performance: 8 → 8.5/10
- Code Quality: 9 → 9.5/10
- Średnia: 8.2 → 8.8/10
