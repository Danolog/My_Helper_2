# MyHelper — Performance Report

**Data:** 2026-03-04
**Faza:** 4 (Wydajność)
**Status:** Analiza zakończona

---

## Podsumowanie

| Kategoria | Znalezione problemy | Krytyczne | Wysokie | Średnie | Niskie |
|-----------|:-------------------:|:---------:|:-------:|:-------:|:------:|
| N+1 Queries | 14 | 2 | 2 | 7 | 3 |
| Brakujące indeksy | 16 (7 FK + 9 composite) | 4 | 5 | 5 | 2 |
| Re-render issues | 10 | 3 | 4 | — | 3 |
| Memory leaks | 7 | — | 4 | — | 3 |
| **Łącznie** | **47** | **9** | **15** | **12** | **11** |

---

## 1. N+1 Queries

### KRYTYCZNE

#### N+1-01: Employee Occupancy Report — Triple N+1 (3 pętle × N pracowników)
- **Plik:** `src/app/api/reports/employee-occupancy/route.ts:98-170`
- **Wzorzec:** 3 sekwencyjne pętle `for...of`, każda wykonuje zapytanie per pracownik (work schedules, time blocks, appointments)
- **Wpływ:** Salon z 10 pracownikami = **30 zapytań** zamiast 3
- **Fix:** Użyć `inArray(employeeId, ids)` + `Promise.all` do pobrania danych w 3 zapytaniach, potem `groupBy` w JS

#### N+1-02: Employee Popularity Report — Double N+1 (2 pętle × N pracowników)
- **Plik:** `src/app/api/reports/employee-popularity/route.ts:89-186`
- **Wzorzec:** Per-pracownik zapytania o wizyty i recenzje
- **Wpływ:** 10 pracowników = **20 zapytań** zamiast 2
- **Fix:** Batch-fetch z `inArray` + partition w JS

### WYSOKIE

#### N+1-03: Push Reminders (1h) — Per-appointment subscription check
- **Plik:** `src/app/api/cron/push-reminders/route.ts:95-193`
- **Wzorzec:** Per-wizyta sprawdzanie pushSubscriptions + per-wizyta UPDATE
- **Wpływ:** 50 wizyt = 100+ zapytań
- **Fix:** Pre-fetch subscriptions z `inArray`, batch UPDATE na koniec

#### N+1-04: Push Reminders (24h) — Identyczny wzorzec
- **Plik:** `src/app/api/cron/push-reminders-24h/route.ts:99-197`
- **Fix:** Identyczny jak N+1-03

### ŚREDNIE

| # | Plik | Problem | Fix |
|---|------|---------|-----|
| N+1-05 | `api/cron/sms-reminders/route.ts:88-141` | Per-appointment UPDATE | Batch UPDATE z `inArray` |
| N+1-06 | `api/reminders/appointment/route.ts:82-144` | Per-appointment UPDATE | Batch UPDATE z `inArray` |
| N+1-07 | `api/notifications/birthday/route.ts:175-247` | Per-client check + insert | Batch SELECT + multi-row INSERT |
| N+1-08 | `api/notifications/we-miss-you/route.ts:227-295` | Per-client check + insert | Batch SELECT + multi-row INSERT |
| N+1-09 | `api/client/waiting-list/route.ts:46-91` | Double N+1 (entries + employees) | `inArray(clientId)` + `inArray(employeeId)` |
| N+1-10 | `api/newsletters/[id]/send/route.ts:140-202` | Per-recipient INSERT | Multi-row INSERT |
| N+1-11 | `api/appointments/[id]/complete/route.ts:276-325` | Per-product stock update | Batch insert + `Promise.all` |

### NISKIE

| # | Plik | Problem |
|---|------|---------|
| N+1-12 | `api/promotions/check-first-visit/route.ts:78-90` | Per-client count (zwykle 1 iteracja) |
| N+1-13 | `api/appointments/book-package/route.ts:191-214` | Per-service INSERT (2-5 usług) |
| N+1-14 | `api/subscription-plans/route.ts:65-73` | 2 sekwencyjne INSERT (jednorazowe) |

### Pozytywne przykłady (brak N+1)
- `api/dashboard/stats/route.ts` — poprawne `Promise.all` + `inArray`
- `api/salons/[id]/route.ts` — poprawne `inArray` do batch-fetch
- `api/reports/monthly-comparison/route.ts` — `Promise.all` dla 2 okresów

---

## 2. Brakujące indeksy

### 2.1 Istniejące indeksy — podsumowanie

Schemat posiada **90 istniejących indeksów**. Wszystkie kolumny `salonId`, `clientId`, `employeeId`, `startTime`, `status` mają indeksy single-column. Kolumna `createdAt` **nie jest indeksowana** w żadnej tabeli.

### 2.2 Brakujące indeksy FK (single-column)

#### KRYTYCZNE

| # | Tabela | Kolumna | Użycie | SQL |
|---|--------|---------|--------|-----|
| IDX-01 | `appointments` | `bookedByUserId` | 7 WHERE w client portal | `CREATE INDEX "appointments_booked_by_user_id_idx" ON "appointments" ("booked_by_user_id");` |
| IDX-02 | `appointments` | `serviceId` | ~50+ JOINów | `CREATE INDEX "appointments_service_id_idx" ON "appointments" ("service_id");` |

#### WYSOKIE

| # | Tabela | Kolumna | Użycie | SQL |
|---|--------|---------|--------|-----|
| IDX-03 | `salonSubscriptions` | `stripeSubscriptionId` | 4 WHERE w webhook (time-sensitive) | `CREATE INDEX "salon_subscriptions_stripe_subscription_id_idx" ON "salon_subscriptions" ("stripe_subscription_id");` |
| IDX-04 | `reviews` | `appointmentId` | LEFT JOIN + WHERE w 4 routes | `CREATE INDEX "reviews_appointment_id_idx" ON "reviews" ("appointment_id");` |
| IDX-05 | `appointmentMaterials` | `createdAt` | WHERE w materials reports | `CREATE INDEX "appointment_materials_created_at_idx" ON "appointment_materials" ("created_at");` |

#### ŚREDNIE

| # | Tabela | Kolumna | SQL |
|---|--------|---------|-----|
| IDX-06 | `waitingList` | `preferredEmployeeId` | `CREATE INDEX "waiting_list_preferred_employee_id_idx" ON "waiting_list" ("preferred_employee_id");` |
| IDX-07 | `employeeServicePrices` | `variantId` | `CREATE INDEX "employee_service_prices_variant_id_idx" ON "employee_service_prices" ("variant_id");` |

### 2.3 Brakujące indeksy composite

#### KRYTYCZNE

| # | Tabela | Kolumny | Wzorzec zapytań | SQL |
|---|--------|---------|-----------------|-----|
| CIDX-01 | `appointments` | `(salonId, status, startTime)` | Wszystkie raporty revenue, dashboard stats | `CREATE INDEX "appointments_salon_status_start_idx" ON "appointments" ("salon_id", "status", "start_time");` |
| CIDX-02 | `appointments` | `(employeeId, status, startTime)` | Overlap check przy tworzeniu wizyt | `CREATE INDEX "appointments_employee_status_start_idx" ON "appointments" ("employee_id", "status", "start_time");` |

#### WYSOKIE

| # | Tabela | Kolumny | SQL |
|---|--------|---------|-----|
| CIDX-03 | `appointments` | `(salonId, employeeId, startTime)` | `CREATE INDEX "appointments_salon_employee_start_idx" ON "appointments" ("salon_id", "employee_id", "start_time");` |
| CIDX-04 | `appointments` | `(clientId, startTime)` | `CREATE INDEX "appointments_client_start_time_idx" ON "appointments" ("client_id", "start_time");` |
| CIDX-05 | `timeBlocks` | `(employeeId, startTime, endTime)` | `CREATE INDEX "time_blocks_employee_time_range_idx" ON "time_blocks" ("employee_id", "start_time", "end_time");` |

#### ŚREDNIE

| # | Tabela | Kolumny | SQL |
|---|--------|---------|-----|
| CIDX-06 | `clients` | `(salonId, email)` | `CREATE INDEX "clients_salon_email_idx" ON "clients" ("salon_id", "email");` |
| CIDX-07 | `temporaryAccess` | `(userId, featureName)` | `CREATE INDEX "temporary_access_user_feature_idx" ON "temporary_access" ("user_id", "feature_name");` |
| CIDX-08 | `scheduledPosts` | `(status, scheduledAt)` | `CREATE INDEX "scheduled_posts_status_scheduled_at_idx" ON "scheduled_posts" ("status", "scheduled_at");` |
| CIDX-09 | `appointments` | `(salonId, startTime)` | `CREATE INDEX "appointments_salon_start_time_idx" ON "appointments" ("salon_id", "start_time");` |

### 2.4 Drizzle ORM — kod do dodania w schema.ts

```typescript
// appointments table — dodać w sekcji indexes
(table) => [
  // ... istniejące indeksy ...
  index("appointments_booked_by_user_id_idx").on(table.bookedByUserId),
  index("appointments_service_id_idx").on(table.serviceId),
  index("appointments_variant_id_idx").on(table.variantId),
  index("appointments_salon_status_start_idx").on(table.salonId, table.status, table.startTime),
  index("appointments_employee_status_start_idx").on(table.employeeId, table.status, table.startTime),
  index("appointments_salon_employee_start_idx").on(table.salonId, table.employeeId, table.startTime),
  index("appointments_client_start_time_idx").on(table.clientId, table.startTime),
]

// salonSubscriptions — dodać
index("salon_subscriptions_stripe_subscription_id_idx").on(table.stripeSubscriptionId)

// reviews — dodać
index("reviews_appointment_id_idx").on(table.appointmentId)

// appointmentMaterials — dodać
index("appointment_materials_created_at_idx").on(table.createdAt)

// timeBlocks — dodać
index("time_blocks_employee_time_range_idx").on(table.employeeId, table.startTime, table.endTime)

// clients — dodać
index("clients_salon_email_idx").on(table.salonId, table.email)

// temporaryAccess — dodać
index("temporary_access_user_feature_idx").on(table.userId, table.featureName)

// scheduledPosts — dodać
index("scheduled_posts_status_scheduled_at_idx").on(table.status, table.scheduledAt)
```

---

## 3. Re-render Issues

### KRYTYCZNE (3)

#### RR-01: CalendarEventComponent brakuje React.memo
- **Plik:** `src/components/calendar/calendar-event.tsx:55`
- **Problem:** Renderowany w `.map()` w TimeGrid/WeekTimeGrid. Każda zmiana stanu rodzica powoduje re-render WSZYSTKICH instancji.
- **Wpływ:** 20+ wizyt × każda interakcja = setki niepotrzebnych re-renderów
- **Fix:**
```tsx
export const CalendarEventComponent = React.memo(function CalendarEventComponent({...}: CalendarEventProps) {
  // ...existing
});
```

#### RR-02: Inline arrow functions jako props w kalendarzu
- **Plik:** `src/app/dashboard/calendar/page.tsx:645-648`
- **Problem:** `onEventCancel={(event) => handleCancelAppointment(event.id)}` — nowa referencja przy każdym renderze, niweluje React.memo
- **Fix:**
```tsx
const handleEventCancel = useCallback((event: CalendarEvent) => {
  handleCancelAppointment(event.id);
}, [handleCancelAppointment]);
```

#### RR-03: useDraggable tworzy niestabilne zależności
- **Plik:** `src/hooks/use-draggable.ts:14,39`
- **Problem:** `useCallback` zależy od `[options]`, a `options` jest tworzony inline przy każdym renderze CalendarEventComponent
- **Fix:** Użyć `useRef` do przechowywania options zamiast bezpośredniej zależności:
```tsx
const optionsRef = useRef(options);
optionsRef.current = options;
const handleDragStart = useCallback((e) => {
  // ... use optionsRef.current
}, []); // stabilna referencja
```

### WYSOKIE (4)

| # | Plik | Problem | Fix |
|---|------|---------|-----|
| RR-04 | `components/calendar/time-grid.tsx:84-168` | Funkcje helper odtwarzane co render | `useMemo` dla `employeeEventsMap`/`employeeBlocksMap` |
| RR-05 | `components/calendar/week-time-grid.tsx:263` | `layoutEvents()` wywoływany w pętli render bez memoizacji | `useMemo` per-day layout |
| RR-06 | `components/appointments/new-appointment-dialog.tsx:264` | `filteredClients` obliczany co render | `useMemo([clients, clientSearch])` |
| RR-07 | `components/appointments/edit-appointment-dialog.tsx:277` | `filteredClients` — identyczny problem | `useMemo([clients, clientSearch])` |

### NISKIE (3)

| # | Plik | Problem |
|---|------|---------|
| RR-08 | `components/calendar/calendar-legend.tsx:10` | Brak React.memo |
| RR-09 | `components/appointments/new-appointment-dialog.tsx:375` | `getEffectivePriceAndDuration()` co render |
| RR-10 | `components/calendar/week-time-grid.tsx:43` | `today` memo z `[]` — stale po północy |

---

## 4. Memory Leaks

### WYSOKIE (4)

| # | Plik | Problem | Fix |
|---|------|---------|-----|
| ML-01 | `app/dashboard/calendar/page.tsx:102-212` | Brak AbortController w fetch (race condition przy szybkiej nawigacji dat) | Dodać `AbortController` + cleanup w useEffect |
| ML-02 | `components/appointments/new-appointment-dialog.tsx:116-242` | 3-4 równoległe fetch bez cancellation | AbortController per fetch |
| ML-03 | `components/appointments/edit-appointment-dialog.tsx:152-255` | Identyczny problem | AbortController per fetch |
| ML-04 | `hooks/use-subscription.ts:35-65` | fetch bez cleanup, setState po unmount | `let cancelled = false` + cleanup |

### NISKIE (3)

| # | Plik | Problem |
|---|------|---------|
| ML-05 | `hooks/use-network-status.ts:58` | `setTimeout` bez cleanup w `markOnline` |
| ML-06 | `components/pwa/install-prompt.tsx:66-74` | Return z event handlera ignorowany (setTimeout leak) |
| ML-07 | `components/starter-prompt-modal.tsx:129` | `setTimeout` bez cleanup |

---

## 5. Bundle Size

### Build Summary

| Metryka | Wartość |
|---------|--------|
| Całkowity rozmiar `.next/` | **509 MB** (w tym cache + server) |
| Static bundle (client JS) | **5.0 MB** (122 chunków) |
| Server bundle | **85 MB** |
| Największy client chunk | **440 KB** (af8420069f5af415.js) |
| Strony statyczne (○) | ~25 |
| Strony dynamiczne (ƒ) | ~155 |

### Top 10 największych chunków client-side

| Chunk | Rozmiar |
|-------|---------|
| af8420069f5af415.js | 440 KB |
| b26ebb6676589244.js | 284 KB |
| d5a3c4adc7092502.js | 220 KB |
| 98c3a4511edebb5f.js | 216 KB |
| 76b77f6501132066.js | 196 KB |
| 71168da9199b411c.js | 156 KB |
| 4198e7c6c5a05c30.js | 140 KB |
| a6dad97d9634a72d.js | 112 KB |
| 12cacb93cf4954fd.js | 112 KB |
| 0f9edf6b9303eef3.js | 112 KB |

### Największe server-side chunks

| Chunk | Rozmiar | Prawdopodobna zawartość |
|-------|---------|------------------------|
| `[root-of-the-server]__4b4a2e34._.js` | 880 KB | Framework core |
| `_cba88db7._.js` (SSR) | 528 KB | SSR rendering |
| `[root-of-the-server]__2588f7e4._.js` | 456 KB | Server components |
| `excel-export_ts_ee3dfaa1._.js` | 268 KB | **xlsx library** |
| `zod_v4_classic_schemas_404ada77.js` | 252 KB | Zod validation |

### Obserwacje

1. **Client bundle 5 MB jest akceptowalny** dla aplikacji tej wielkości (~180 stron)
2. **xlsx (268 KB server)** — duża biblioteka, ale jest server-side only co jest poprawne
3. **Zod (252 KB server)** — nowa wersja v4, większy rozmiar jest znany
4. **Brak ostrzeżeń o nadmiernym rozmiarze** — Next.js 16 nie raportuje per-page sizes w turbopack output

---

## 6. Rekomendacje optymalizacji

### Priorytet 1 — Natychmiast (Critical)

| # | Akcja | Wpływ | Trudność |
|---|-------|-------|----------|
| 1 | Dodać composite index `appointments(salonId, status, startTime)` | Przyspieszenie WSZYSTKICH raportów | Niska |
| 2 | Dodać composite index `appointments(employeeId, status, startTime)` | Przyspieszenie overlap checks (booking) | Niska |
| 3 | Dodać index `appointments.bookedByUserId` | Odblokowanie client portal performance | Niska |
| 4 | Dodać index `appointments.serviceId` | Przyspieszenie ~50 JOINów | Niska |
| 5 | Naprawić N+1 w employee-occupancy (3×N → 3 zapytania) | Raport 10× szybszy | Średnia |
| 6 | Naprawić N+1 w employee-popularity (2×N → 2 zapytania) | Raport 5× szybszy | Średnia |
| 7 | Dodać React.memo do CalendarEventComponent + stabilizacja useDraggable | Eliminacja 90% niepotrzebnych re-renderów | Średnia |

### Priorytet 2 — Wkrótce (High)

| # | Akcja | Wpływ | Trudność |
|---|-------|-------|----------|
| 8 | Dodać AbortController do fetch w kalendarzach | Eliminacja race conditions + memory leaks | Średnia |
| 9 | Memoizacja employeeEventsMap/employeeBlocksMap w TimeGrid | Mniej obliczeń per render | Niska |
| 10 | Batch UPDATE w cron reminders (push + SMS) | Skalowalność cronów | Średnia |
| 11 | Dodać composite index `timeBlocks(employeeId, startTime, endTime)` | Szybszy overlap check | Niska |
| 12 | Dodać index `salonSubscriptions.stripeSubscriptionId` | Webhook reliability | Niska |

### Priorytet 3 — Następny sprint (Medium)

| # | Akcja | Wpływ |
|---|-------|-------|
| 13 | Batch INSERT w birthday/we-miss-you notifications | Skalowalność |
| 14 | Multi-row INSERT w newsletter send | 200+ INSERT → 1 |
| 15 | useMemo dla filteredClients w appointment dialogs | UX przy dużej bazie klientów |
| 16 | Rozważyć SWR/TanStack Query dla data fetching | Automatyczne cache + dedup + cancellation |

### Priorytet 4 — Przyszłość

| # | Akcja |
|---|-------|
| 17 | React Compiler (auto-memoization w React 19) |
| 18 | Virtualizacja kalendarza (jeśli > 10 pracowników) |
| 19 | Partial indexes (`WHERE status != 'cancelled'`) na appointments |

---

## 7. Pliki testów wydajności

| Plik | Opis |
|------|------|
| `tests/performance/load-test.js` | Skrypt K6 — smoke/load/stress tests dla 5 kluczowych endpointów |
| `tests/performance/lighthouserc.js` | Konfiguracja Lighthouse CI |
| `tests/performance/lighthouse-auth.js` | Puppeteer auth script dla Lighthouse |

### K6 — progi

| Metryka | Próg |
|---------|------|
| `http_req_duration p(95)` | < 200ms |
| `http_req_duration p(99)` | < 500ms |
| `errors rate` | < 1% |

### Lighthouse CI — cele

| Strona | Performance |
|--------|:-----------:|
| `/login` | > 95 |
| `/dashboard` | > 85 |
| `/dashboard/calendar` | > 80 |
| `/dashboard/reports` | > 85 |
| `/` (portal) | > 90 |

---

## 8. Uruchomienie testów

### K6
```bash
# Instalacja
brew install k6

# Smoke test
k6 run tests/performance/load-test.js

# Z custom URL i auth
k6 run --env BASE_URL=https://myhelper.app --env AUTH_COOKIE="session=..." --env SALON_ID="actual-id" tests/performance/load-test.js
```

### Lighthouse CI
```bash
# Instalacja
npm install -g @lhci/cli

# Uruchomienie (wymaga działającego serwera)
lhci autorun --config=tests/performance/lighthouserc.js
```

---

*Raport wygenerowany automatycznie — Faza 4 analizy wydajności MyHelper*
