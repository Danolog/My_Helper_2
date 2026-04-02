# My_Helper_2 — Re-Audit po zmianach (15.03.2026)

## Co się zmieniło od ostatniego audytu

Najważniejszy commit: `security: add requireAuth() middleware to 103 API routes`
Plus seria napraw E2E testów (hydration waits, button clicks, global-setup via API).

---

## Porównanie PRZED vs PO

| Obszar | PRZED | PO | Zmiana |
|--------|-------|-----|--------|
| **Endpointy bez auth** | 91 | 22 | +69 zabezpieczonych |
| **Rate limiting** | 0 | 0 | Bez zmian |
| **CSRF protection** | 0 | 0 | Bez zmian |
| **db.transaction()** | 0 | 0 | Bez zmian |
| **SQL injection vectors** | 7 | 2-4 | Częściowo poprawione |
| **Zod validation (POST/PUT)** | 3 endpointy | 3 endpointy | Bez zmian |
| **console.log** | 807 | 810 | +3 (pogorszyło się) |
| **ignoreBuildErrors** | true | true | Bez zmian |
| **N+1 queries** | 5 plików | 5 plików | Bez zmian |
| **useEffect bez cleanup** | ~217 | ~220 | Bez zmian |
| **Code splitting (next/dynamic)** | 0 | 0 | Bez zmian |
| **Caching (revalidate)** | 0 | 0 | Bez zmian |
| **next/image** | 0 | 0 | Bez zmian |
| **E2E testy** | Niestabilne | Poprawione | Lepsza stabilność |

---

## Oceny po zmianach

| Obszar | PRZED | PO | Komentarz |
|--------|-------|-----|-----------|
| Architektura | 8/10 | 8/10 | Bez zmian — była dobra |
| **Bezpieczeństwo** | **3/10** | **4.5/10** | requireAuth dodany, ale 22 route nadal otwarte |
| Performance | 6/10 | 6/10 | N+1, brak cache, brak code splitting |
| Code Quality | 7/10 | 7/10 | 810 console.log, brak transakcji |
| Testy | 7/10 | 7.5/10 | E2E poprawione (hydration, button clicks) |
| **Średnia** | **6.2/10** | **6.6/10** | Minimalny postęp |

---

## Szczegóły — co naprawiono dobrze

### requireAuth() middleware (src/lib/auth-middleware.ts)
- Sprawdza sesję via `auth.api.getSession()`
- Obsługuje opcjonalną weryfikację roli (owner/employee/receptionist/client)
- Zwraca 401 (brak sesji) lub 403 (zła rola)
- Dodano `requireCronSecret()` dla cron jobs

### E2E testy — seria 15+ commitów
- Zamieniono `keyboard.press('Enter')` na `button.click()` (zgodnie z best practice)
- Dodano waity na hydration przed interakcją z formularzami
- Global setup zmieniony na API call zamiast UI login
- `waitUntil: 'networkidle'` zamienione na `'domcontentloaded'`/`'load'`

---

## Szczegóły — co nadal jest KRYTYCZNE

### 1. 22 endpointy bez auth (w tym niebezpieczne)

**Najgorsze otwarte endpointy:**

| Endpoint | Metoda | Ryzyko |
|----------|--------|--------|
| `/api/appointments/[id]/complete` | PUT | Zmiana statusu wizyt bez logowania |
| `/api/appointments/[id]/materials` | POST/PUT/DELETE | Manipulacja magazynem |
| `/api/newsletters/[id]/send` | POST | Masowe wysyłki emaili |
| `/api/invoices/[id]/send-email` | POST | Wysyłanie faktur |
| `/api/subscriptions/confirm` | POST | Potwierdzenie płatności |
| `/api/salons/[id]` | PUT/DELETE | Edycja/usunięcie salonu |
| `/api/reviews/[id]/moderate` | PUT | Moderowanie opinii |
| `/api/clients/[id]` | GET/PUT/DELETE | Pełny dostęp do danych klienta |
| `/api/employees/[id]` | GET/PUT/DELETE | Pełny dostęp do pracownika |

To jest ~13% endpointów, ale obejmują krytyczne operacje biznesowe.

### 2. Zero transakcji bazodanowych

**Przykład — ukończenie wizyty (`/api/appointments/[id]/complete`):**
```
Krok 1: UPDATE appointment → status = completed  ✓
Krok 2: INSERT appointment_materials              ← może failnąć
Krok 3: UPDATE product quantities                 ← może failnąć
Krok 4: INSERT notification                       ← może failnąć
```
Jeśli krok 2 zawiedzie — wizyta jest oznaczona jako ukończona, ale materiały nie są zapisane. Brak rollbacku.

### 3. N+1 queries w cron jobs

**Newsletter send — 1000 odbiorców:**
```
Obecny: 1000 × INSERT → 1000 queries → ~5-10 sekund
Poprawny: 1 × batch INSERT → 1 query → ~50ms
```

**Push reminders — 500 wizyt:**
```
Obecny: 500 × UPDATE → 500 queries
Poprawny: 1 × batch UPDATE z IN() → 1 query
```

### 4. 810 console.log

3 więcej niż przy poprzednim audycie. Brak structured logging (pino/winston). W produkcji to:
- Wyciek danych w logach (parametry requestów, ID użytkowników)
- Szum informacyjny — niemożliwe debugowanie
- Overhead I/O na każdym request

### 5. `ignoreBuildErrors: true` nadal aktywne

TypeScript strict mode jest włączony, ale build go ignoruje. To znaczy że mogą istnieć błędy typów, które przechodzą do produkcji.

### 6. 220 useEffect bez cleanup

```
useEffect total: 227
useEffect z cleanup (return): 7
useEffect BEZ cleanup: 220 (97%)
AbortController w fetch: 0
```

Każdy fetch w useEffect bez AbortController = potencjalny memory leak + race condition przy szybkim przełączaniu stron.

### 7. Monolityczne "use client" strony

9 plików > 1500 linii z `"use client"` na górze:
- `gallery/page.tsx` — 2354 linii
- `clients/[id]/page.tsx` — 2347 linii
- `ai-assistant/voice/page.tsx` — 2150 linii
- `dashboard/page.tsx` — 1682 linii

Cały JavaScript jest wysyłany do klienta zamiast SSR.

---

## Co deweloperzy powiedzieliby TERAZ

> „Krok w dobrym kierunku z auth middleware, ale to dopiero początek. Nadal brak transakcji, walidacji, rate limitingu, cleanup w hookach, structured logging. Kod jest na poziomie prototypu, nie produkcji."

**I mieliby rację.** Jeden commit z requireAuth nie rozwiązuje fundamentalnych problemów architektonicznych.

---

## Plan napraw — zaktualizowane priorytety

### P0: Blokery produkcji (1-2 dni)
1. ~~requireAuth na 91 endpointów~~ → **Dodaj auth na pozostałe 22 endpointy**
2. `db.transaction()` w appointment complete, subscription confirm, newsletter send
3. `ignoreBuildErrors: false` → napraw błędy TS
4. Batch INSERT/UPDATE w cron jobs (N+1 → batch)

### P1: Stabilność (3-5 dni)
5. Zod validation na ~60 POST/PUT endpointach
6. Rate limiting (Upstash lub middleware)
7. Usuń `unsafe-eval` z CSP
8. FK constraints w schema.ts (appointmentMaterials, fiscalReceipts)
9. Brakujące indeksy (clients.birthday)

### P2: Jakość (1-2 tygodnie)
10. Zamień 810 console.log → pino structured logging
11. useEffect cleanup + AbortController
12. Code splitting (next/dynamic) dla dużych stron
13. next/image zamiast raw `<img>`
14. Rozbij monolityczne "use client" strony na Server + Client Components

### P3: Optymalizacja (2-3 tygodnie)
15. Caching strategy (revalidate, unstable_cache)
16. SELECT z konkretnymi kolumnami zamiast SELECT *
17. Suspense boundaries + streaming
18. useMemo/useCallback audit

---

## Odpowiedź dla deweloperów — zaktualizowana

> „Od ostatniego audytu dodaliśmy auth middleware na 103 endpointy i naprawiliśmy stabilność E2E testów. Bezpieczeństwo wzrosło z 3/10 na 4.5/10.
>
> Pozostałe problemy (transakcje, walidacja, logging, performance) wymagają dalszej pracy. To jest świadomy tech debt z fazy MVP — wiemy co naprawić i mamy plan.
>
> Kod agentowy to prototyp — szybki w budowie, ale wymagający hardeningu przed produkcją. Dokładnie tak jak junior dev, który potrzebuje code review od seniora."
