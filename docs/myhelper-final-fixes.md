# MyHelper — Final Remaining Issues: Instrukcje napraw

Skopiuj do `docs/FINAL_FIXES.md`. Każde zadanie = osobny commit.
Po każdym: `pnpm typecheck && pnpm test`.

---

## Zadanie 1: Zod validation na ostatnich 12 route'ach (1h)

### Commit: `feat(security): add Zod validation to final 12 mutation routes`

**12 route'ów bez walidacji:**

**Grupa A — Notifications (3 pliki, cron-triggered ale mają POST body):**
```
src/app/api/notifications/birthday/route.ts
src/app/api/notifications/low-stock/route.ts
src/app/api/notifications/we-miss-you/route.ts
```
Te endpointy są wywoływane przez cron, ale mogą mieć query params. Dodaj walidację na `salonId` z searchParams:
```typescript
const salonId = searchParams.get("salonId");
if (salonId && !z.string().uuid().safeParse(salonId).success) {
  return NextResponse.json({ error: "Nieprawidłowy salonId" }, { status: 400 });
}
```

**Grupa B — Subscriptions (3 pliki):**
```
src/app/api/subscriptions/cancel/route.ts
src/app/api/subscriptions/renew/route.ts
src/app/api/subscriptions/payments/[id]/receipt/route.ts
```
Stwórz w `api-validation.ts`:
```typescript
export const cancelSubscriptionSchema = z.object({
  reason: z.string().max(500).optional(),
  immediate: z.boolean().default(false),
});

export const renewSubscriptionSchema = z.object({
  planId: z.string().uuid(),
});
```
Dla `receipt` — to GET, dodaj walidację na `[id]` param:
```typescript
const { id } = await params;
if (!z.string().uuid().safeParse(id).success) {
  return NextResponse.json({ error: "Nieprawidłowy ID" }, { status: 400 });
}
```

**Grupa C — Client/salon actions (3 pliki):**
```
src/app/api/client/appointments/[id]/cancel/route.ts
src/app/api/scheduled-posts/[id]/publish/route.ts
src/app/api/reminders/appointment/route.ts
```
Stwórz:
```typescript
export const clientCancelSchema = z.object({
  reason: z.string().max(500).optional(),
});

export const sendReminderSchema = z.object({
  appointmentId: z.string().uuid(),
  type: z.enum(["sms", "push", "email"]).default("push"),
});
```
Dla `publish` — to POST bez body, waliduj `[id]` param jak wyżej.

**Grupa D — Fiscal + gallery (3 pliki):**
```
src/app/api/salons/[id]/fiscal-settings/test-connection/route.ts
src/app/api/salons/[id]/fiscal-settings/test-print/route.ts
src/app/api/gallery/upload/route.ts
```
Fiscal — stwórz:
```typescript
export const fiscalTestSchema = z.object({
  apiKey: z.string().min(1),
  endpoint: z.string().url(),
});
```
Gallery upload — walidacja FormData:
```typescript
const formData = await req.formData();
const file = formData.get("file") as File | null;
if (!file) return NextResponse.json({ error: "Brak pliku" }, { status: 400 });
if (file.size > 10 * 1024 * 1024)
  return NextResponse.json({ error: "Plik > 10MB" }, { status: 400 });
const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
if (!allowedTypes.includes(file.type))
  return NextResponse.json({ error: "Niedozwolony typ" }, { status: 400 });
```

**Komenda dla Claude Code:**
```
Przeczytaj docs/FINAL_FIXES.md Zadanie 1.
Dodaj Zod validation do 12 mutation routes — grupy A-D.
Stwórz brakujące schematy w src/lib/api-validation.ts.
Po każdej grupie: pnpm typecheck && pnpm test
```

---

## Zadanie 2: Rozbicie 15 najcięższych monolitów 500-800 linii (4-5h)

### Commity: `refactor: split [nazwa] into components`

33 pliki > 500 linii. Rozbij top 15 (wszystkie > 650 linii):

| # | Plik | Linie | Cel |
|---|------|-------|-----|
| 1 | `dashboard/calendar/page.tsx` | 799 | < 250 |
| 2 | `dashboard/finance/page.tsx` | 770 | < 250 |
| 3 | `dashboard/settings/fiscal/page.tsx` | 768 | < 250 |
| 4 | `(client)/salons/[id]/gallery/page.tsx` | 759 | < 250 |
| 5 | `dashboard/employees/[id]/schedule/page.tsx` | 744 | < 250 |
| 6 | `dashboard/invoices/page.tsx` | 719 | < 250 |
| 7 | `(client)/salons/[id]/page.tsx` | 691 | < 250 |
| 8 | `dashboard/reports/yearly-comparison/page.tsx` | 685 | < 250 |
| 9 | `dashboard/reports/service-profitability/page.tsx` | 685 | < 250 |
| 10 | `dashboard/promo-codes/page.tsx` | 673 | < 250 |
| 11 | `dashboard/reports/employee-popularity/page.tsx` | 664 | < 250 |
| 12 | `dashboard/notifications/page.tsx` | 663 | < 250 |
| 13 | `components/auth/registration-flow.tsx` | 662 | < 300 |
| 14 | `dashboard/reports/employee-payroll/page.tsx` | 658 | < 250 |
| 15 | `(site)/dla-salonow/page.tsx` | 656 | < 250 |

**Pattern (sprawdzony w poprzednich refaktorach):**
```
page.tsx (700 linii) →
  page.tsx              (100-250 linii — layout + Suspense)
  _components/
    [Feature]Header.tsx (tytuł, breadcrumbs, akcje)
    [Feature]Table.tsx  (tabela/lista/grid)
    [Feature]Filters.tsx (filtry, datepicker, search)
    [Feature]Dialog.tsx (modal tworzenia/edycji)
  _hooks/
    use-[feature].ts    (fetch, mutations, state)
```

**Dla calendar (799 linii) — specjalne podejście:**
```
calendar/page.tsx (150 linii — layout)
calendar/_components/
  CalendarToolbar.tsx    (nawigacja dat, widok tydzień/dzień)
  CalendarGrid.tsx       (time grid, eventy)
  CalendarSidebar.tsx    (lista pracowników, filtry)
  CalendarEventPopover.tsx (szczegóły po kliknięciu)
calendar/_hooks/
  use-calendar-data.ts   (fetch appointments, employees)
  use-calendar-navigation.ts (prev/next, widok, daty)
```

**Dla registration-flow.tsx (662 linii) — wizard pattern:**
```
registration-flow.tsx (150 linii — stepper)
_components/
  StepAccountInfo.tsx    (email, hasło)
  StepSalonSetup.tsx     (nazwa salonu, adres)
  StepPlanSelection.tsx  (Basic vs Pro)
  StepConfirmation.tsx   (podsumowanie)
_hooks/
  use-registration.ts    (form state, submit, validation)
```

**Komenda dla Claude Code:**
```
Przeczytaj docs/FINAL_FIXES.md Zadanie 2.
Rozbij 15 monolitycznych "use client" stron 650-800 linii.
Zacznij od calendar (799), finance (770), fiscal settings (768).
Pattern: page.tsx < 250 linii, logika w _hooks/, UI w _components/.
Rób po 3-5 plików, po każdej grupie: pnpm typecheck && pnpm test
```

---

## Zadanie 3: Zamiana 4 raw `<img>` na next/image (15 min)

### Commit: `perf: replace raw img tags with next/image in gallery components`

4 tagi `<img>` w 2 plikach:

**Plik 1: `src/components/gallery/photo-upload-dialog.tsx` linia 289 i 294:**
```typescript
// ❌ Obecne:
<img src={beforePreview} alt="Przed" className="w-full h-20 object-cover rounded border" />
<img src={uploadPreview} alt="Po" className="w-full h-20 object-cover rounded border" />

// ✅ Zamień na:
import Image from "next/image";
<Image src={beforePreview} alt="Przed" width={200} height={80} className="w-full h-20 object-cover rounded border" />
<Image src={uploadPreview} alt="Po" width={200} height={80} className="w-full h-20 object-cover rounded border" />
```

**Uwaga:** Jeśli `beforePreview` i `uploadPreview` to blob URL (createObjectURL), next/image wymaga `unoptimized` prop:
```typescript
<Image src={beforePreview} alt="Przed" width={200} height={80} unoptimized className="..." />
```

**Plik 2: `src/components/gallery/album-manager.tsx` linia 480 i 485:**
```typescript
// ❌ Obecne:
<img src={photo.beforePhotoUrl!} alt="Przed" className="absolute inset-0 w-[200%] h-full object-cover" />
<img src={photo.afterPhotoUrl!} alt="Po" className="absolute inset-0 w-[200%] h-full object-cover object-right" />

// ✅ Zamień na:
<Image src={photo.beforePhotoUrl!} alt="Przed" fill className="w-[200%] h-full object-cover" />
<Image src={photo.afterPhotoUrl!} alt="Po" fill className="w-[200%] h-full object-cover object-right" />
```

**Uwaga:** `fill` wymaga `position: relative` na parent div. Sprawdź czy parent ma to ustawione.

**Komenda dla Claude Code:**
```
Zamień 4 raw <img> tagi na next/image w:
- src/components/gallery/photo-upload-dialog.tsx (linia 289, 294)
- src/components/gallery/album-manager.tsx (linia 480, 485)
Użyj unoptimized jeśli src to blob URL. Użyj fill jeśli absolute positioning.
Po zmianie: pnpm typecheck && pnpm test
```

---

## Zadanie 4: Deposits auth verification (15 min)

### Commit: `fix(security): add auth or token validation to deposit endpoints`

Oba endpointy deposits (`create-session`, `confirm`) nie mają `requireAuth`. Sprawdziłem — `create-session` jest celowo publiczny (klient rezerwuje i płaci bez konta), a `confirm` jest chroniony przez `depositPaymentId + sessionId` tokeny + rate limit.

**Ale dodaj przynajmniej `getOptionalSession`:**
```typescript
// deposits/create-session/route.ts — już ma getOptionalSession ✅
// deposits/confirm/route.ts — dodaj komentarz wyjaśniający:

/**
 * Auth: This endpoint uses token-based verification (depositPaymentId + sessionId)
 * instead of session auth, because it's called by Stripe redirect or webhook.
 * Rate limiting (strictRateLimit) prevents brute-force token guessing.
 */
```

To nie wymaga zmian w kodzie — tylko jawny komentarz wyjaśniający decyzję bezpieczeństwa.

---

## Zadanie 5: useEffect cleanup audit (1h, OPCJONALNE)

### Commit: `fix: add cleanup and AbortController to remaining useEffect hooks`

181 useEffect, 16 z AbortController (8.8%). Nie trzeba naprawiać WSZYSTKICH — tylko te z fetch:

**Komenda dla Claude Code:**
```
Znajdź wszystkie useEffect w src/ które zawierają fetch() ale NIE mają AbortController.
Dodaj AbortController + cleanup do każdego.
Pattern:
  useEffect(() => {
    const controller = new AbortController();
    fetch(url, { signal: controller.signal })
      .then(r => r.json())
      .then(data => { if (!controller.signal.aborted) setState(data); })
      .catch(err => { if (err.name !== 'AbortError') logger.error(err); });
    return () => controller.abort();
  }, [deps]);
Po zmianie: pnpm typecheck && pnpm test
```

---

## Kolejność wykonania

```
Dzień 1 (2-3h):
  Zadanie 1 — Zod validation na 12 routes (1h) → commit
  Zadanie 3 — raw img → next/image (15 min) → commit
  Zadanie 4 — deposits komentarz (15 min) → commit
  Zadanie 2 — rozbij 5 monolitów: calendar, finance, fiscal, gallery, schedule (2h) → 5 commitów

Dzień 2 (3h):
  Zadanie 2 — rozbij 5 monolitów: invoices, salon page, yearly, profitability, promo-codes (2h) → 5 commitów
  Zadanie 2 — rozbij 5 monolitów: popularity, notifications, registration, payroll, dla-salonow (2h) → 5 commitów

Dzień 3 (1h, opcjonalnie):
  Zadanie 5 — useEffect cleanup audit (1h) → commit
  Final: pnpm typecheck && pnpm test && pnpm build:ci
```

**Oczekiwany wynik po naprawach:**
- Bezpieczeństwo: 9 → 9.5/10 (Zod 96/105 = 91%)
- Performance: 8 → 8.5/10 (img optimization, mniejsze bundles)
- Code Quality: 9.5 → 9.5/10 (monolity < 500 linii)
- Średnia: 8.6 → 9/10

**Po tych naprawach remaining issues będą na poziomie, który jest normalny dla każdego projektu w produkcji.** Dalsze optymalizacje (CQRS, event sourcing, 100% test coverage) to decyzje architektoniczne, nie naprawy.
