# Raport Audytu MyHelper

**Data:** 2026-03-03
**Wersja:** 1.1.2
**Zakres:** Pełny audyt kodu (TypeScript, ESLint, bezpieczeństwo API, komponenty React, schemat bazy danych, podatności zależności)

---

## Podsumowanie

| Kategoria | Krytyczne | Wysokie | Średnie | Niskie | SUMA |
|-----------|-----------|---------|---------|--------|------|
| Bezpieczeństwo API | 5 | 3 | 2 | 0 | 10 |
| Baza danych (schema) | 4 | 7 | 5 | 2 | 18 |
| Komponenty React | 2 | 3 | 4 | 2 | 11 |
| TypeScript | 1 | 1 | 1 | 0 | 3 |
| ESLint | 1 | 0 | 1 | 1 | 3 |
| Podatności zależności | 0 | 3 | 0 | 0 | 3 |
| **SUMA** | **13** | **17** | **13** | **5** | **48** |

---

## KRYTYCZNE (blokują testowanie)

### K1. ~91 endpointów API BEZ JAKIEJKOLWIEK autentykacji
**Wpływ:** Każdy może odczytać/zmodyfikować dane dowolnego salonu znając UUID.
**Pliki:** Praktycznie wszystkie CRUD endpointy w `src/app/api/`
**Szczegóły:** Brak wywołania `auth.api.getSession()` lub `getUserSalonId()`. Dotyczy:
- `/api/employees` — lista/tworzenie pracowników dowolnego salonu
- `/api/clients` — lista/tworzenie klientów (PII: imiona, telefony, email, alergie)
- `/api/appointments` (GET) — lista wizyt dowolnego salonu
- `/api/appointments/[id]` (GET, PUT, DELETE) — odczyt/modyfikacja/anulowanie dowolnej wizyty
- `/api/appointments/[id]/complete` — oznaczenie wizyty jako zakończonej (prowizje, magazyn, lojalnościówki)
- `/api/appointments/[id]/materials` — dodawanie/usuwanie materiałów
- `/api/appointments/[id]/treatment` — tworzenie historii zabiegów
- `/api/services`, `/api/products`, `/api/product-categories` — pełny CRUD
- `/api/promotions`, `/api/promo-codes` — pełny CRUD
- `/api/albums`, `/api/gallery`, `/api/gallery/upload` — pełny CRUD + upload plików
- `/api/notifications/*` — odczyt logów powiadomień
- `/api/payments`, `/api/finance/commissions` — dane finansowe
- Wszystkie 12 endpointów `/api/reports/*` — raporty finansowe
- `/api/invoices`, `/api/newsletters`, `/api/reviews`, `/api/scheduled-posts`
- `/api/work-schedules`, `/api/time-blocks`, `/api/waiting-list`

### K2. `/api/deposits/confirm` bez autentykacji
**Wpływ:** Atakujący może potwierdzić fałszywą płatność depozytu i zmienić status wizyty + wysłać SMS.
**Plik:** `src/app/api/deposits/confirm/route.ts`

### K3. Tylko 2 z 162 endpointów sprawdzają rolę użytkownika
**Wpływ:** Uwierzytelniony klient może wywołać endpointy przeznaczone dla właściciela (zarządzanie pracownikami, raporty finansowe, ustawienia salonu).
**Pliki z role-check:** Tylko `gallery/[id]` i `temporary-access`

### K4. Endpointy CRON z opcjonalnym CRON_SECRET
**Wpływ:** Jeśli zmienna środowiskowa nie jest ustawiona, cron endpointy działają bez autoryzacji. GET handlery pomijają sprawdzenie sekretu.
**Pliki:** `src/app/api/cron/sms-reminders/`, `push-reminders/`, `push-reminders-24h/`, `publish-scheduled-posts/`, `cleanup-temporary-access/`

### K5. Brakujące FK constraints — brak integralności referencyjnej
**Wpływ:** Usunięcie appointment/salon/product może zostawić osierocone rekordy w powiązanych tabelach.
**Pliki:** `src/lib/schema.ts`
- `fiscalReceipts.appointmentId` — brak `.references()` do `appointments.id`
- `fiscalReceipts.salonId` — brak `.references()` do `salons.id`
- `appointmentMaterials.productId` — brak `.references()` do `products.id` (komentarz: "will reference products table")
- `appointments.variantId` — brak `.references()` do `serviceVariants.id` (komentarz: "References service_variants.id")

### K6. Brak indeksu na `appointments.serviceId` — 30+ JOIN-ów
**Wpływ:** Sekwencyjne skanowanie tabeli przy każdym zapytaniu z JOIN na usługi. Dotyczy listy wizyt, raportów, dashboardu, cron-ów.
**Plik:** `src/lib/schema.ts:230`

### K7. Brak composite index `appointments(employeeId, startTime)`
**Wpływ:** Endpoint `/api/available-slots` to najczęściej wywoływany endpoint w systemie rezerwacji — bez composite index każde sprawdzenie dostępności wymaga full scan.
**Plik:** `src/lib/schema.ts`

### K8. `waiting-list.ts` — błędy typów blokujące kompilację
**Wpływ:** `Type 'string | null'` nie pasuje do wymaganego `string` w insercie appointments. Kod nie skompiluje się w strict mode.
**Plik:** `src/lib/waiting-list.ts:370,387,420`

### K9. `subscriptions/cancel` — nieprawidłowy dostęp do Stripe API
**Wpływ:** `current_period_end` nie istnieje na `Response<Subscription>` — endpoint cancel subskrypcji jest zepsuty.
**Plik:** `src/app/api/subscriptions/cancel/route.ts:81-82`

---

## WYSOKIE (mogą powodować false failures w testach)

### W1. Brak walidacji Zod na ~62 endpointach przyjmujących body
**Wpływ:** Tylko 18 z ~80 endpointów POST/PUT/PATCH używa Zod. Reszta polega na ręcznych `if (!field)` checkach lub nie waliduje wcale.
**Najważniejsze bez Zod:** appointments/[id] (PUT), employees/[id] (PUT), clients/[id] (PUT), services/[id] (PUT), products/[id] (PUT), wszystkie sub-routes promotions, promo-codes, albums, gallery

### W2. Brak indeksu na `appointments.bookedByUserId`
**Wpływ:** 7 endpointów client-portal używa `WHERE bookedByUserId = userId` — bez indeksu to full scan przy każdym zapytaniu klienta.
**Plik:** `src/lib/schema.ts:232`

### W3. Brak indeksu na `appointments.endTime`
**Wpływ:** Overlap detection (kolizje wizyt) wymaga skanowania obu kolumn `startTime` i `endTime`. Tylko `startTime` ma indeks.
**Plik:** `src/lib/schema.ts:234`

### W4. Brak indeksu na `salonSubscriptions.stripeSubscriptionId`
**Wpływ:** 4 Stripe webhook handlery robią full table scan przy każdym evencie płatności.
**Plik:** `src/lib/schema.ts:894`

### W5. Brak unique constraints — race conditions
**Wpływ:** Check-then-insert pattern bez unique constraint pozwala na duplikaty.
- `favoriteSalons(clientUserId, salonId)` — duplikaty ulubionych
- `employeeServices(employeeId, serviceId)` — duplikaty przypisań usług
- `loyaltyPoints(clientId, salonId)` — duplikaty rekordów lojalnościowych
**Plik:** `src/lib/schema.ts`

### W6. `products.category` — string-based JOIN zamiast FK
**Wpływ:** Zmiana nazwy kategorii wymaga aktualizacji WSZYSTKICH produktów. JOIN `products.category = productCategories.name` jest wolny i kruchy.
**Plik:** `src/lib/schema.ts:588`

### W7. Ref.current odczytywany podczas renderowania
**Wpływ:** ESLint error `react-hooks/refs`. Wartość ref nie jest dostępna przy pierwszym renderowaniu — width będzie zawsze `100%`.
**Pliki:**
- `src/app/(client)/salons/[id]/gallery/page.tsx:136-137`
- `src/app/dashboard/gallery/page.tsx:146`

### W8. setState synchronicznie w useEffect (verify-email)
**Wpływ:** ESLint error `react-hooks/set-state-in-effect`. Kaskadowe re-rendery.
**Plik:** `src/app/(client)/portal/verify-email/page.tsx:25`

### W9. 7 podatności HIGH w zależnościach
**Pakiety:**
- `xlsx` (<0.19.3) — Prototype Pollution + ReDoS (patched: <0.0.0 = BRAK PATCHA)
- `jspdf` (<4.2.0) — PDF Injection + DoS (patched: >=4.2.0)
- `minimatch` — ReDoS (2 instancje: eslint, typescript-estree)

### W10. Brak composite index `appointments(salonId, startTime)`
**Wpływ:** Wszystkie endpointy raportów filtrują po salonId + zakres dat.
**Plik:** `src/lib/schema.ts`

---

## ŚREDNIE (do naprawienia w Fix Loop)

### S1. ~20 unused variable errors (TS6133)
**Wpływ:** `pnpm typecheck` zwraca exit code 1. Testy wymagające kompilacji mogą false-fail.
**Pliki:** Rozproszone po `src/app/api/`, `src/app/dashboard/`, `src/components/`, `src/hooks/`
**Najczęstsze:** `salonLoading`, `request`, `count`, `and`, `session`, `salon`

### S2. ~15 "possibly undefined" errors (TS18048, TS2532)
**Wpływ:** Potencjalne runtime errors przy dostępie do undefined.
**Pliki:** `daily-recommendations`, `newsletter`, `product-categories`, `register-subscription`, `salons/[id]`

### S3. useEffect bez cleanup — setTimeout/fetch bez anulowania
**Wpływ:** "setState on unmounted component" warnings, potencjalne memory leaks.
**Pliki:**
- `src/app/(client)/salons/[id]/book/page.tsx:532-566` — 4x setTimeout bez clearTimeout
- `src/hooks/use-network-status.ts:58` — setTimeout(10s) bez cleanup
- `src/components/pwa/install-prompt.tsx:66-74` — martwy kod cleanup (return w event handler, nie w useEffect)
- `src/app/dashboard/settings/notifications/page.tsx:173,216,243` — 3x setTimeout(3s) bez cleanup
- `src/app/dashboard/settings/loyalty/page.tsx:152` — setTimeout(3s) bez cleanup

### S4. useEffect bez AbortController — 11 komponentów
**Wpływ:** Stan aktualizowany po odmontowaniu komponentu.
**Pliki:**
- `src/app/dashboard/calendar/page.tsx:40-58`
- `src/app/dashboard/employees/page.tsx:62-95`
- `src/app/employees/add/page.tsx:44-59`
- `src/app/dashboard/settings/notifications/page.tsx:90-115`
- `src/components/ui/github-stars.tsx:15-31`
- `src/hooks/use-diagnostics.ts:50-52`
- `src/hooks/use-subscription.ts:35-65`
- `src/components/setup-checklist.tsx:68-70`
- `src/components/auth/registration-flow.tsx:103-119`
- `src/app/dashboard/subscription/success/page.tsx:34-59`
- `src/app/(client)/salons/[id]/book/page.tsx:504-524`

### S5. Brak error state w komponentach z data-fetching
**Wpływ:** Użytkownik widzi nieskończone ładowanie zamiast komunikatu o błędzie.
**Pliki:**
- `src/app/dashboard/calendar/page.tsx` — fetchSalon catch → console.log, brak UI error
- `src/app/dashboard/employees/page.tsx` — fetchSalon + fetchEmployees catch → console.log
- `src/app/employees/add/page.tsx` — fetchSalon fail = null salonId, błąd dopiero przy submit

### S6. DateRangeFilter — setState w useEffect zamiast useMemo
**Wpływ:** Niepotrzebny re-render przy każdej zmianie daty.
**Plik:** `src/components/reports/date-range-filter.tsx:129-131`

### S7. Brak composite index `workSchedules(employeeId, dayOfWeek)`
**Wpływ:** Available-slots zawsze filtruje po obu kolumnach jednocześnie.
**Plik:** `src/lib/schema.ts`

### S8. Brak indeksu na `timeBlocks.endTime`
**Wpływ:** Overlap query w available-slots.
**Plik:** `src/lib/schema.ts:267-276`

---

## NISKIE (nice to have)

### N1. 986 ESLint warnings
**Główne kategorie:**
- ~200 `import/order` — niewłaściwa kolejność importów (auto-fixable)
- ~50 `no-console` — console.log w produkcyjnym kodzie
- ~30 `@next/next/no-img-element` — `<img>` zamiast `<Image>` z next/image

### N2. Formularze bez walidacji długości
**Pliki:**
- `src/app/chat/page.tsx:336-343` — brak maxLength na input czatu AI
- `src/app/dashboard/ai-assistant/trends/page.tsx:882` — j.w.
- `src/app/dashboard/ai-assistant/business/page.tsx:1659` — j.w.
- `src/app/profile/page.tsx:59-64` — profil edycja bez walidacji (stub)

### N3. useTabSync — ref.current odczytywany/zapisywany podczas renderowania
**Plik:** `src/hooks/use-tab-sync.ts:56-58`
**Wpływ:** Lazy init pattern, działa w praktyce, ale technicznie łamie regułę czystego renderowania.

### N4. Brak Drizzle ORM `relations()` definitions
**Wpływ:** Brak type-safe nested queries. Wszystkie relacje zarządzane manualnie.

### N5. Brak indeksów na tabeli `verification`
**Wpływ:** Better Auth zarządza tabelą, ale lookup na `identifier`/`value` to sekwencyjne skanowanie.

---

## Rekomendacje priorytetowe

### Priorytet 0 — Przed testami (blokery)

1. **Stwórz middleware/utility auth** — centralna funkcja `requireAuth(role?)` wywoływana na początku każdego endpointu. Rozwiązuje K1, K2, K3.
2. **Napraw błędy TypeScript w waiting-list.ts i subscriptions/cancel** — K8, K9 blokują kompilację.
3. **Dodaj brakujące FK constraints** — K5, wymagana migracja bazy.

### Priorytet 1 — Wysokie (tydzień 1)

4. **Dodaj brakujące indeksy** — K6, K7, W2, W3, W4, W10. Jedna migracja.
5. **Dodaj unique constraints** — W5. Zapobiega race conditions.
6. **Dodaj Zod validation** do endpointów PUT/PATCH — W1.
7. **Zaktualizuj jspdf do >=4.2.0** — W9.
8. **Napraw ref reads during render** — W7, W8.

### Priorytet 2 — Średnie (Fix Loop, Faza 5)

9. **Usuń unused variables** — S1. Auto-fix lub ręcznie.
10. **Dodaj null-checks** — S2.
11. **Dodaj cleanup do useEffect** — S3, S4.
12. **Dodaj error states** — S5.

### Priorytet 3 — Niskie (opcjonalne)

13. **ESLint auto-fix** — `pnpm lint --fix` naprawi ~715 warnings.
14. **Walidacja długości inputów** — N2.
15. **Drizzle relations** — N4.

---

## Statystyki narzędzi

| Narzędzie | Wynik |
|-----------|-------|
| `pnpm typecheck` | 55 błędów TS (exit code 1) |
| `pnpm lint` | 19 errors + 986 warnings (exit code 1) |
| `pnpm audit` | 7 podatności HIGH |
| API audit (ręczny) | 91 endpointów bez auth, 2 z role-check |
| Schema audit (ręczny) | 6 brakujących indeksów, 4 brakujące FK, 4 brakujące unique constraints |
| Component audit (ręczny) | 31 problemów jakościowych |
