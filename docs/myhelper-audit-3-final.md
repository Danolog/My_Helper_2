# My_Helper_2 — Audyt #3 (po naprawach P0-P3)

**Data:** 15 marca 2026
**Commit:** `20e6778` (fix: override vulnerable transitive deps)
**Poprzednie audyty:** #1 (3/10 security), #2 (4.5/10 security)

---

## Porównanie trzech audytów

| Metryka | Audyt #1 | Audyt #2 | Audyt #3 | Trend |
|---------|----------|----------|----------|-------|
| **Endpointy bez auth** | 91 | 22 | 10 (celowo publiczne) | ✅ Naprawione |
| **Rate limiting** | 0 | 0 | 5 endpointów | ✅ Nowe |
| **CSP unsafe-eval** | TAK | TAK | NIE | ✅ Usunięte |
| **CSP unsafe-inline** | TAK | TAK | TAK (script+style) | ⚠️ Zostaje |
| **db.transaction()** | 0 | 0 | 3 (produkcyjne) | ✅ Nowe |
| **Structured logger** | 0 | 0 | 11 plików | ✅ Nowe |
| **console.log** | 810 | 810 | 208 | ✅ -74% |
| **Zod validation (routes)** | 3 | 3 | 8 | ⚠️ Minimalnie |
| **ignoreBuildErrors** | true | true | false | ✅ Naprawione |
| **N+1 queries (cron)** | 5 plików | 5 plików | 0 | ✅ Naprawione |
| **Loading states** | 0 | 0 | 32 plików | ✅ Nowe |
| **Code splitting** | 0 | 0 | 14 dynamic imports | ✅ Nowe |
| **next/image** | 0 | 0 | 35 (+ 17 raw img) | ✅ Częściowo |
| **Dashboard page.tsx** | 1682 linii | 1682 linii | 180 linii | ✅ Refaktor |
| **useEffect z cleanup** | 7 (3%) | 7 (3%) | 80 (31.6%) | ✅ Poprawa |
| **AbortController** | 0 | 0 | 14 | ✅ Nowe |
| **E2E testy** | Niestabilne | Poprawione | Poprawione | ✅ |
| **CSRF** | 0 | 0 | 0 | ❌ Bez zmian |
| **SQL injection vectors** | 7 | 4 | 5 | ❌ Bez poprawy |

---

## Oceny — ewolucja

| Obszar | Audyt #1 | Audyt #2 | Audyt #3 |
|--------|----------|----------|----------|
| Architektura | 8/10 | 8/10 | 8/10 |
| **Bezpieczeństwo** | **3/10** | **4.5/10** | **6/10** |
| **Performance** | **6/10** | **6/10** | **7.5/10** |
| **Code Quality** | **7/10** | **7/10** | **7.5/10** |
| Testy | 7/10 | 7.5/10 | 7.5/10 |
| **ŚREDNIA** | **6.2/10** | **6.6/10** | **7.3/10** |

---

## Co naprawiono dobrze

### 1. Auth — praktycznie zamknięte (91 → 10 otwartych)
Pozostałe 10 niezabezpieczonych endpointów to celowo publiczne route'y portalu klienta (available-slots, promo-codes/validate, promotions/check*, salon gallery/services/employees). To poprawna decyzja biznesowa — klient musi widzieć usługi i dostępne terminy bez logowania.

### 2. ignoreBuildErrors: false
TypeScript teraz blokuje build przy błędach. To fundamentalna zmiana — żadne type error nie przejdzie do produkcji.

### 3. Transakcje bazodanowe (0 → 3)
Dodane w trzech krytycznych miejscach:
- `appointments/[id]/complete` — status + materiały + produkty w jednej transakcji
- `subscriptions/confirm` — potwierdzenie płatności + aktywacja subskrypcji
- `newsletters/[id]/send` — batch insert notyfikacji + update statusu

### 4. N+1 queries — rozwiązane
Cron jobs (push-reminders, sms-reminders) używają teraz `inArray()` do batch queries. Newsletter send robi batch `INSERT INTO notifications VALUES (...)`. To zmiana z ~1000 queries na ~3.

### 5. Dashboard refaktor (1682 → 180 linii)
Rozbity na osobne komponenty: UserProfile, StatsRow, TodayAppointments, QuickActions, TrialBanner + 4 dynamic imports dla AI/settings.

### 6. Loading states (0 → 32)
Każda sekcja dashboardu ma dedykowany `loading.tsx` z skeleton screens. Użytkownik widzi strukturę strony natychmiast.

### 7. Code splitting (0 → 14)
Dynamic imports dla ciężkich komponentów: dialogi kalendarza (5), dashboard AI components (4), appointment details (2).

### 8. console.log (810 → 208, -74%)
Znacząca redukcja. Logger (pino-like) dostępny w `src/lib/logger.ts` z JSON output w production, human-readable w dev.

### 9. Rate limiting — nowe
In-memory fixed-window limiter z 3 tierami (60/10/5 req/min). Użyty na 5 krytycznych endpointach (checkout, deposits, newsletter send, push test, invoice email).

### 10. useEffect cleanup (3% → 31.6%)
80 z 253 useEffect ma teraz cleanup function. 14 fetchów używa AbortController.

---

## Co nadal wymaga pracy

### KRYTYCZNE

#### 1. Zod validation — 8 z 102 mutation routes (7.8%)
Schematy istnieją w `api-validation.ts` (11 create + 7 update), ale są użyte tylko w 8 endpointach. **94 POST/PUT/PATCH route'ów przyjmuje niezwalidowany input.** To największa pozostała dziura.

#### 2. SQL injection — 5 instancji
Konkatenacja stringów w SQL template literals:
```typescript
// NADAL PODATNE:
sql`${col} LIKE ${"%" + product.id + "%"}`
```
Pliki: products/route.ts, products/[id]/route.ts, notifications/birthday, notifications/low-stock, appointments/[id]/complete.

#### 3. CSRF — brak implementacji
Żadnego CSRF tokena. Better Auth cookies (HttpOnly) dają częściową ochronę, ale formy nie mają double-submit cookie pattern.

#### 4. Rate limiting — 5 z 162 route'ów (3%)
In-memory limiter nie działa w serverless (Vercel) — każda instancja ma osobny counter. Potrzeba distributed rate limiter (Upstash Redis) i pokrycie co najmniej auth endpoints.

### WYSOKIE

#### 5. Monolityczne "use client" strony
52 plików > 500 linii z "use client". Top 5:
- gallery/page.tsx: 2396 linii
- clients/[id]/page.tsx: 2347 linii
- ai-assistant/voice/page.tsx: 2150 linii
- salons/[id]/book/page.tsx: 1991 linii
- appointments/[id]/page.tsx: 1991 linii

Każdy z tych plików wysyła cały JavaScript do klienta.

#### 6. SELECT * — 80 endpointów (50%)
Połowa API route'ów pobiera wszystkie kolumny. W tabeli clients to znaczy pobieranie email, telefon, notatki nawet gdy potrzebne jest tylko imię i ID.

#### 7. Auth middleware — brak weryfikacji właściciela salonu
`requireAuth()` sprawdza rolę, ale NIE sprawdza czy user jest właścicielem danego salonu. Każdy owner może czytać/modyfikować dane dowolnego salonu.

#### 8. console.log — 208 pozostaje
Logger istnieje, ale jest użyty tylko w 11 plikach (13%). 82 pliki nadal używają raw console.log.

### ŚREDNIE

#### 9. useEffect cleanup — 68% bez cleanup
173 z 253 useEffect nie ma cleanup function. Potencjalne memory leaks przy szybkim przełączaniu stron.

#### 10. Caching — prawie zero
Tylko 1 endpoint ma `revalidate` (subscription-plans, 1h). Zero `unstable_cache()`. Każdy request = pełne query do bazy.

#### 11. raw `<img>` — 17 tagów
Powinny być zamienione na next/image dla lazy loading i format optimization.

#### 12. CSP unsafe-inline
`script-src 'unsafe-inline'` i `style-src 'unsafe-inline'` nadal obecne. unsafe-eval usunięte (dobrze).

---

## Plan dalszych napraw

### P0: Blokery (2-3 dni)
1. **Zod validation** — dodaj `validateBody()` do pozostałych 94 mutation routes. Schematy już istnieją w api-validation.ts, trzeba je podłączyć.
2. **SQL injection fix** — zamień 5 instancji `${"%" + var + "%"}` na `like(col, \`%${var}%\`)` (Drizzle helper)
3. **Salon ownership** — dodaj check `salon.ownerId === user.id` w auth-middleware.ts

### P1: Stabilność (1 tydzień)
4. **Distributed rate limiter** — Upstash Redis zamiast in-memory
5. **CSRF tokens** — double-submit cookie pattern na formy
6. **Logger migration** — zamień 208 console.log → logger.*
7. **Monolity** — rozbij top 5 stron > 2000 linii na komponenty

### P2: Optymalizacja (2 tygodnie)
8. **SELECT specificity** — dodaj `.select({...})` do 80 endpointów
9. **useEffect cleanup** — dodaj return + AbortController do 173 hooków
10. **Caching** — `unstable_cache()` na read-heavy endpointach (services, products, salon info)
11. **next/image** — zamień 17 raw `<img>`
12. **CSP nonces** — usuń unsafe-inline, dodaj nonce-based CSP

---

## Odpowiedź na zarzuty deweloperów — aktualizacja

| Zarzut | Audyt #1 | Audyt #3 | Status |
|--------|----------|----------|--------|
| „Mało bezpieczny" | 91 endpointów otwartych, zero rate limit | 10 celowo publicznych, rate limit na 5, auth middleware | **Znacząca poprawa, ale Zod validation i SQL injection nadal otwarte** |
| „Niedopracowany" | 0 transakcji, 810 console.log, ignoreBuildErrors | 3 transakcje, 208 console.log, TS strict | **Wyraźna poprawa, ale 94 routes bez walidacji** |
| „Niezoptymalizowany" | N+1, 0 loading, 0 code split, 1682-liniowy dashboard | Batch queries, 32 loading, 14 dynamic, 180 linii dashboard | **Duża poprawa, ale monolity i brak cache zostają** |
| „Bity" | Nie dotyczy web SaaS | Nie dotyczy web SaaS | **Nadal irrelewantne** |

**Podsumowanie:** Z 6.2/10 do 7.3/10 w trzech iteracjach. To solidny postęp — główne fundamenty (auth, transakcje, loading, code splitting, TS strict) są na miejscu. Pozostałe problemy (Zod validation, SQL injection, monolity, caching) to typowy tech debt, który rozwiązuje się iteracyjnie.

Kod jest teraz na poziomie **mid developera po code review** — nie seniora z 20-letnim doświadczeniem, ale zdecydowanie powyżej juniora.
