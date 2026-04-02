# MyHelper — Instrukcje napraw po Audycie #4

Skopiuj ten plik do `docs/REPAIR_PLAN.md` w repozytorium.
Każde zadanie to osobny commit. Po każdym: `pnpm typecheck && pnpm test`.

---

## P0 — SQL Injection (30 min)

### Commit: `fix(security): replace unsafe LIKE string concatenation with parameterized queries`

6 instancji w 5 plikach. W każdym zamień:

```typescript
// ❌ PODATNE:
sql`${notifications.message} LIKE ${"%" + product.id + "%"}`

// ✅ BEZPIECZNE — użyj Drizzle helper `like()`:
import { like } from "drizzle-orm";
// ...
like(notifications.message, `%${product.id}%`)
```

**Pliki do naprawy:**

1. `src/app/api/products/route.ts` linia 32
2. `src/app/api/products/[id]/route.ts` linia 34
3. `src/app/api/appointments/[id]/complete/route.ts` linia 61
4. `src/app/api/notifications/birthday/route.ts` linia 68 i 160
5. `src/app/api/notifications/low-stock/route.ts` linia 99

**Komenda dla Claude Code:**
```
Przeczytaj docs/REPAIR_PLAN.md sekcję P0.
Napraw SQL injection w 5 plikach — zamień sql`...LIKE ${"%" + var + "%"}` na like() z drizzle-orm.
Po naprawie: pnpm typecheck && pnpm test
```

---

## P1a — Zod Validation na 74 mutation routes (2-3h)

### Commit: `feat(security): add Zod validation to remaining 74 POST/PUT/PATCH routes`

Masz 20 gotowych schematów w `src/lib/api-validation.ts`:
```
createServiceSchema, createClientSchema, createEmployeeSchema,
createProductSchema, createAppointmentSchema, createPromotionSchema,
updateAppointmentSchema, completeAppointmentSchema, addAppointmentMaterialSchema,
updateClientSchema, updateEmployeeSchema, updateServiceSchema,
updateProductSchema, updateSalonSchema, updatePromotionSchema,
createPromoCodeSchema, createWaitingListSchema, updateWaitingListSchema,
reviewRespondSchema, reviewModerateSchema
```

**74 route'y BEZ walidacji (pogrupowane):**

**CRUD — salony i ustawienia (7 plików):**
- `src/app/api/salons/route.ts` → użyj nowego `createSalonSchema`
- `src/app/api/salons/[id]/birthday-settings/route.ts`
- `src/app/api/salons/[id]/fiscal-settings/route.ts`
- `src/app/api/salons/[id]/fiscal-settings/test-connection/route.ts`
- `src/app/api/salons/[id]/fiscal-settings/test-print/route.ts`
- `src/app/api/salons/[id]/loyalty-settings/route.ts`
- `src/app/api/salons/[id]/notification-type-settings/route.ts`
- `src/app/api/salons/[id]/we-miss-you-settings/route.ts`

**CRUD — usługi (6 plików):**
- `src/app/api/service-categories/route.ts`
- `src/app/api/service-categories/[id]/route.ts`
- `src/app/api/services/[id]/employee-assignments/route.ts`
- `src/app/api/services/[id]/employee-prices/route.ts`
- `src/app/api/services/[id]/products/route.ts`
- `src/app/api/services/[id]/variants/route.ts`
- `src/app/api/services/[id]/variants/[variantId]/route.ts`

**CRUD — produkty i galeria (7 plików):**
- `src/app/api/product-categories/route.ts`
- `src/app/api/product-categories/[id]/route.ts`
- `src/app/api/gallery/route.ts`
- `src/app/api/gallery/[id]/route.ts`
- `src/app/api/gallery/upload/route.ts`
- `src/app/api/albums/route.ts`
- `src/app/api/albums/[id]/route.ts`
- `src/app/api/albums/[id]/photos/route.ts`

**Wizyty i klienci (8 plików):**
- `src/app/api/appointments/[id]/fiscal-receipt/route.ts`
- `src/app/api/appointments/[id]/invoice/route.ts`
- `src/app/api/appointments/[id]/treatment/route.ts`
- `src/app/api/appointments/book-package/route.ts`
- `src/app/api/clients/[id]/consents/route.ts`
- `src/app/api/clients/[id]/loyalty/redeem/route.ts`
- `src/app/api/client/appointments/[id]/cancel/route.ts`
- `src/app/api/client/appointments/[id]/review/route.ts`

**Portal klienta i waiting list (3 pliki):**
- `src/app/api/client/waiting-list/route.ts`
- `src/app/api/client/waiting-list/[id]/route.ts`
- `src/app/api/favorites/salons/route.ts`

**Promo i marketing (4 pliki):**
- `src/app/api/promo-codes/[id]/route.ts`
- `src/app/api/promo-codes/validate/route.ts`
- `src/app/api/scheduled-posts/[id]/publish/route.ts`
- `src/app/api/invoices/[id]/send-email/route.ts`

**Pracownicy i grafik (3 pliki):**
- `src/app/api/employees/commission-rate/route.ts`
- `src/app/api/time-blocks/route.ts`
- `src/app/api/work-schedules/route.ts`

**Subskrypcje i płatności (7 plików):**
- `src/app/api/subscriptions/checkout/route.ts`
- `src/app/api/subscriptions/confirm/route.ts`
- `src/app/api/subscriptions/cancel/route.ts`
- `src/app/api/subscriptions/downgrade/route.ts`
- `src/app/api/subscriptions/renew/route.ts`
- `src/app/api/subscriptions/expiration-warning/route.ts`
- `src/app/api/subscriptions/payments/[id]/receipt/route.ts`
- `src/app/api/deposits/confirm/route.ts`
- `src/app/api/deposits/create-session/route.ts`
- `src/app/api/register-subscription/route.ts`

**Push i powiadomienia (6 plików):**
- `src/app/api/push/subscribe/route.ts`
- `src/app/api/push/test/route.ts`
- `src/app/api/push/unsubscribe/route.ts`
- `src/app/api/reminders/appointment/route.ts`
- `src/app/api/notifications/birthday/route.ts`
- `src/app/api/notifications/low-stock/route.ts`
- `src/app/api/notifications/we-miss-you/route.ts`

**AI voice (6 plików):**
- `src/app/api/ai/voice/book/route.ts`
- `src/app/api/ai/voice/cancel/route.ts`
- `src/app/api/ai/voice/config/route.ts`
- `src/app/api/ai/voice/incoming/route.ts`
- `src/app/api/ai/voice/message/route.ts`
- `src/app/api/ai/voice/reschedule/route.ts`

**Cron jobs (5 plików):**
- `src/app/api/cron/cleanup-temporary-access/route.ts`
- `src/app/api/cron/publish-scheduled-posts/route.ts`
- `src/app/api/cron/push-reminders-24h/route.ts`
- `src/app/api/cron/push-reminders/route.ts`
- `src/app/api/cron/sms-reminders/route.ts`

**Inne (4 pliki):**
- `src/app/api/temporary-access/route.ts`
- `src/app/api/seed/route.ts`
- `src/app/api/diagnostics/route.ts`
- `src/app/api/test/error/route.ts`

**Podejście:**
1. Dla endpointów z istniejącym schematem — dodaj `validateBody(schema, body)` na początku handlera
2. Dla endpointów BEZ schematu — stwórz nowy schemat w `api-validation.ts`, potem podłącz
3. Dla cron jobs — nie potrzebują Zod (brak body od usera), ale dodaj walidację query params jeśli są
4. Dla GET z query params — dodaj `z.object()` na `searchParams`

**Komenda dla Claude Code:**
```
Przeczytaj docs/REPAIR_PLAN.md sekcję P1a.
Dodaj Zod validation do 74 mutation routes.
Istniejące schematy są w src/lib/api-validation.ts — użyj ich.
Brakujące schematy stwórz w tym samym pliku.
Rób to grupami — najpierw salony, potem usługi, itd.
Po każdej grupie: pnpm typecheck && pnpm test
```

---

## P1b — CSRF Protection (1h)

### Commit: `feat(security): add CSRF protection with double-submit cookie pattern`

**Implementacja:**

1. Zainstaluj: `pnpm add csrf-csrf`

2. Stwórz `src/lib/csrf.ts`:
```typescript
import { doubleCsrf } from "csrf-csrf";

export const { generateToken, doubleCsrfProtection } = doubleCsrf({
  getSecret: () => process.env.BETTER_AUTH_SECRET!,
  cookieName: "__csrf",
  cookieOptions: {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  },
  getTokenFromRequest: (req) => req.headers.get("x-csrf-token"),
});
```

3. Dodaj CSRF token do formularzy — stwórz hook `src/hooks/use-csrf.ts`:
```typescript
"use client";
import { useEffect, useState } from "react";

export function useCsrf() {
  const [token, setToken] = useState("");
  useEffect(() => {
    fetch("/api/csrf-token")
      .then(r => r.json())
      .then(d => setToken(d.token));
  }, []);
  return token;
}
```

4. Stwórz endpoint `src/app/api/csrf-token/route.ts`:
```typescript
import { generateToken } from "@/lib/csrf";
export async function GET(req: Request) {
  const token = generateToken(req);
  return Response.json({ token });
}
```

5. Dodaj header `x-csrf-token` do wszystkich fetch POST/PUT/PATCH/DELETE w komponentach

**Komenda dla Claude Code:**
```
Przeczytaj docs/REPAIR_PLAN.md sekcję P1b.
Zaimplementuj CSRF protection z csrf-csrf.
Dodaj x-csrf-token header do wszystkich mutation fetch w komponentach.
Po implementacji: pnpm typecheck && pnpm test
```

---

## P1c — CSP nonces, usunięcie unsafe-inline (1h)

### Commit: `fix(security): replace CSP unsafe-inline with nonce-based policy`

**Implementacja:**

1. Stwórz `src/lib/csp-nonce.ts`:
```typescript
import { headers } from "next/headers";
import crypto from "crypto";

export function generateNonce() {
  return crypto.randomBytes(16).toString("base64");
}
```

2. W `src/middleware.ts` (stwórz jeśli nie istnieje):
```typescript
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const response = NextResponse.next();

  response.headers.set(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      `script-src 'self' 'nonce-${nonce}' storage.googleapis.com`,
      `style-src 'self' 'nonce-${nonce}' fonts.googleapis.com`,
      "font-src 'self' fonts.gstatic.com",
      "img-src 'self' data: blob: lh3.googleusercontent.com avatars.githubusercontent.com *.public.blob.vercel-storage.com images.unsplash.com",
      "connect-src 'self' *.googleapis.com accounts.google.com",
      "form-action 'self' accounts.google.com",
      "worker-src 'self'",
      "frame-ancestors 'none'",
    ].join("; ")
  );

  // Pass nonce to components via header
  response.headers.set("x-nonce", nonce);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
```

3. Usuń CSP z `next.config.ts` headers (bo jest teraz w middleware)

4. W `layout.tsx` — dodaj nonce do `<script>`:
```typescript
import { headers } from "next/headers";
// ...
const nonce = (await headers()).get("x-nonce") ?? undefined;
// użyj nonce w <script nonce={nonce}> i <style nonce={nonce}>
```

**Uwaga:** Tailwind CSS 4 i next-themes mogą wymagać inline styles. Jeśli nonce łamie coś — zostaw `style-src 'unsafe-inline'` i napraw tylko `script-src`.

**Komenda dla Claude Code:**
```
Przeczytaj docs/REPAIR_PLAN.md sekcję P1c.
Przenieś CSP z next.config.ts do middleware.ts z nonce.
Usuń unsafe-inline z script-src (style-src może zostać jeśli Tailwind wymaga).
Po implementacji: pnpm typecheck && pnpm test && pnpm dev (sprawdź czy strona się ładuje)
```

---

## P2a — Rozbicie monolitycznych stron (3-4h)

### Commity: `refactor(dashboard): split [nazwa] page into components`

18 stron "use client" > 800 linii. Top 10 do rozbicia:

| Plik | Linie | Cel |
|------|-------|-----|
| `dashboard/services/[id]/page.tsx` | 1897 | < 300 |
| `dashboard/ai-assistant/business/page.tsx` | 1735 | < 300 |
| `dashboard/booking/page.tsx` | 1666 | < 300 |
| `dashboard/subscription/page.tsx` | 1480 | < 300 |
| `dashboard/reports/cancellations/page.tsx` | 1470 | < 300 |
| `components/ai-assistant/voice/voice-call-panel.tsx` | 1444 | < 400 |
| `dashboard/products/page.tsx` | 1292 | < 300 |
| `dashboard/promotions/page.tsx` | 1206 | < 300 |
| `(client)/appointments/[id]/page.tsx` | 1146 | < 300 |
| `dashboard/content-generator/newsletters/page.tsx` | 1137 | < 300 |

**Pattern rozbijania:**

```
page.tsx (1500 linii) →
  page.tsx (150 linii — layout, Server Component jeśli możliwe)
  _components/
    ServiceForm.tsx (dialog/forma tworzenia)
    ServiceList.tsx (tabela/lista)
    ServiceFilters.tsx (filtry, search)
    ServiceActions.tsx (bulk actions, export)
  _hooks/
    use-service-data.ts (fetch, state, mutations)
```

Zasady:
- Główna page.tsx < 300 linii — importuje i komponuje
- Custom hook wyciąga logikę fetch + state
- Każdy dialog/modal to osobny komponent
- Filtry/search to osobny komponent
- Tabele/listy to osobny komponent

**Komenda dla Claude Code:**
```
Przeczytaj docs/REPAIR_PLAN.md sekcję P2a.
Rozbij dashboard/services/[id]/page.tsx (1897 linii) na mniejsze komponenty.
Pattern: page.tsx < 300 linii, reszta w _components/ i _hooks/.
Po rozbiciu: pnpm typecheck && pnpm test
Potem powtórz dla następnych 9 stron z listy.
```

---

## P2b — Caching (1h)

### Commit: `perf: add revalidate and unstable_cache to read-heavy endpoints`

**Endpointy do cachowania:**

```typescript
// src/app/api/salons/[id]/route.ts — GET
export const revalidate = 300; // 5 minut

// src/app/api/services/route.ts — GET
export const revalidate = 600; // 10 minut

// src/app/api/service-categories/route.ts — GET
export const revalidate = 3600; // 1 godzina

// src/app/api/product-categories/route.ts — GET
export const revalidate = 3600;

// src/app/api/health/route.ts — GET
export const revalidate = 60; // 1 minuta
```

Dla bardziej złożonych queries użyj `unstable_cache`:
```typescript
import { unstable_cache } from "next/cache";

const getCachedSalonServices = unstable_cache(
  async (salonId: string) => {
    return db.select().from(services).where(eq(services.salonId, salonId));
  },
  ["salon-services"],
  { revalidate: 600, tags: ["services"] }
);
```

**Komenda dla Claude Code:**
```
Przeczytaj docs/REPAIR_PLAN.md sekcję P2b.
Dodaj revalidate do 5 GET endpointów (salons, services, categories, health).
Dodaj unstable_cache do salon services query.
Po implementacji: pnpm typecheck && pnpm test
```

---

## P2c — Dynamic imports (30 min)

### Commit: `perf: restore dynamic imports for heavy components`

Dodaj `next/dynamic` do ciężkich komponentów:

```typescript
import dynamic from "next/dynamic";

// W dashboard/page.tsx lub dashboard/calendar/page.tsx:
const CalendarRescheduleDialog = dynamic(
  () => import("@/components/calendar/reschedule-dialog"),
  { ssr: false }
);
const CalendarBlockTimeDialog = dynamic(
  () => import("@/components/calendar/block-time-dialog"),
  { ssr: false }
);

// W dashboard/ai-assistant/*:
const VoiceCallPanel = dynamic(
  () => import("@/components/ai-assistant/voice/voice-call-panel"),
  { ssr: false }
);

// W stronach z dużymi dialogami:
const AppointmentDetailsDialog = dynamic(
  () => import("@/components/appointments/appointment-details-dialog"),
  { ssr: false }
);
```

**Komenda dla Claude Code:**
```
Przeczytaj docs/REPAIR_PLAN.md sekcję P2c.
Dodaj next/dynamic do: calendar dialogs, AI voice panel, appointment dialogs, report charts.
Cel: minimum 15 dynamic imports.
Po implementacji: pnpm typecheck && pnpm dev (sprawdź lazy loading w Network tab)
```

---

## Kolejność wykonania

```
Dzień 1:
  P0  — SQL injection fix (30 min) → commit
  P1b — CSRF protection (1h) → commit
  P1c — CSP nonces (1h) → commit

Dzień 2-3:
  P1a — Zod validation, grupa po grupie (3h) → commit per grupa

Dzień 4-5:
  P2a — Rozbicie top 5 monolitów (3h) → commit per plik
  P2b — Caching (1h) → commit
  P2c — Dynamic imports (30 min) → commit

Dzień 6:
  P2a — Rozbicie kolejnych 5 monolitów → commit per plik
  Final: pnpm typecheck && pnpm test && pnpm build:ci
```

**Oczekiwany wynik po naprawach:**
- Bezpieczeństwo: 6.5 → 8.5/10
- Performance: 7.5 → 8.5/10
- Code Quality: 8.5 → 9/10
- Średnia: 7.6 → 8.5/10
