# ADR-001 — Warstwa repozytorium + RLS jako strukturalne domknięcie izolacji salonów

**Status:** Zaproponowany — czeka na sign-off Darka dla części dotykających czerwonych linii (dedykowana rola DB na produkcji = zmiana infrastruktury; migracja schemy produkcyjnej). Część lokalna/testowa (warstwa repo, lint, RLS na bazie lokalnej) jest w pełni odwracalna i może wejść w tym PR.
**Data:** 2026-06-17
**Autor:** Ethan (CTO)
**Wersja:** v1.0
**Dotyczy:** Danolog/My_Helper_2 @ `feat/repo-layer-rls` (baza `test/izolacja-realna-baza` = `2da3d62`, naprawy P0 wmergowane). Follow-up **P1** po zamknięciu P0 (IDOR cross-tenant).
**Lens:** standard production-readiness nordsignal, domena 2 (API & logika backend — „lint boundaries") + domena 8 (Security & RLS). Wynik długu strukturalnego D2/D3 z audytu architektury (`01-ethan-architektura.md`, sekcja 5).

> **Słowniczek** (żargon tłumaczony, CLAUDE.md sekcja 3):
> **RLS** (Row-Level Security — bezpieczeństwo na poziomie wiersza: baza sama odrzuca odczyt/zapis cudzych wierszy, niezależnie od kodu aplikacji);
> **IDOR** (Insecure Direct Object Reference — odwołanie do cudzego obiektu po samym identyfikatorze, bez sprawdzenia właściciela);
> **multi-tenant / najemca / tenant** (jedna instancja aplikacji obsługuje wiele rozłącznych firm — tu: salonów; najemca = pojedynczy salon);
> **route / trasa `[id]`** (endpoint API, którego adres zawiera identyfikator zasobu, np. `/api/clients/<uuid>`);
> **repozytorium** (warstwa kodu będąca jedynym punktem dostępu do bazy — „brama danych", przez którą przechodzi każde zapytanie);
> **lint** (statyczna kontrola kodu — narzędzie, które odrzuca build, gdy kod łamie regułę, zanim cokolwiek się uruchomi);
> **ENABLE vs FORCE** (dwa tryby RLS w PostgreSQL: `ENABLE` — polityki obowiązują zwykłe role, ale **właściciel tabeli i migracje je omijają**; `FORCE` — polityki obowiązują **nawet właściciela**);
> **BYPASSRLS** (atrybut roli DB, który całkowicie wyłącza RLS dla tej roli — czego dla roli aplikacyjnej **nie chcemy**);
> **SET LOCAL** (ustawienie zmiennej sesji obowiązujące tylko do końca bieżącej transakcji — znika po `COMMIT`/`ROLLBACK`);
> **defense in depth** (obrona warstwowa — kilka niezależnych tam; jedna może zawieść, kilka naraz nie).

---

## 1. Kontekst i ograniczenia

### Problem — dług izolacji nakładanej ręcznie

MyHelper to multi-tenant SaaS dla salonów. Izolacja danych między salonami opiera się dziś **wyłącznie** na tym, czy programista pamiętał dopisać `and(eq(table.id, id), eq(table.salonId, salonId))` w każdej z **56 tras `[id]`** (zweryfikowane: `find src/app/api -path "*[id]*" -name route.ts`). Z 182 wszystkich tras API **161 importuje surowy `db`**, a tylko **65 woła `getUserSalonId`** — reszta to trasy globalne/publiczne, ale brak warstwy strukturalnej oznacza, że **nic nie odróżnia trasy, która ZAPOMNIAŁA o scope, od tej, która go nie potrzebuje**.

Naprawy P0 zamknęły konkretne dziury (m.in. `gallery/[id]` PATCH/DELETE — pominięty wcześniej IDOR, dowód: commit `213072e`) i są **dowiedzione testem na żywej bazie** (`__tests__/integration/salon-isolation.test.ts` — owner A nie sięga zasobów salonu B, 404). **Ale izolacja nadal zależy od ludzkiej pamięci.** Każda nowa trasa `[id]` to nowy potencjalny IDOR. Jedno pominięcie `eq(salonId)` = nowy wyciek danych osobowych objętych RODO (imię, telefon, alergie, notatki).

To jest dług **D2 (autoryzacja zasobu nakładana ręcznie) + D3 (brak warstwy repo)** z audytu architektury — finding strukturalny, nie pojedynczy bug.

### Cel

Zamienić izolację „miękką i opartą na pamięci" na izolację **wymuszoną strukturalnie** — dwiema niezależnymi warstwami:

1. **Warstwa repozytorium (aplikacja)** — jeden wymuszony punkt dostępu do danych, który **nie da się wywołać bez `salonId`**, plus lint zakazujący surowego `db` poza tą warstwą. Pominięcie scope staje się **niemożliwe do napisania**, nie „łatwe do zapomnienia".
2. **RLS (baza)** — **głębsza, druga tama**: nawet gdyby aplikacja miała błąd, baza sama odrzuci cudzy wiersz. „Aplikację da się ominąć, bazę nie".

To jest **defense in depth** — nie zastępujemy filtra aplikacyjnego RLS-em ani odwrotnie. Obie warstwy współistnieją (sekcja 6).

### Ograniczenia

| # | Ograniczenie | Konsekwencja dla decyzji |
|---|---|---|
| O1 | 56 tras `[id]` + 161 tras z `import { db }` — duża powierzchnia | Migracja musi być fazowa i mechanicznie weryfikowalna lintem, nie „przepiszemy wszystko naraz". |
| O2 | Stack: Next.js 16, Drizzle ORM, PostgreSQL, Better Auth. Połączenie: jeden `POSTGRES_URL` (`src/lib/db.ts`), jedna rola o pełnym dostępie. | RLS wymaga **dwóch ról DB** (migracje/owner vs aplikacja) — to zmiana infrastruktury połączenia, nie tylko kodu. |
| O3 | Test izolacji (`salon-isolation.test.ts`) **seeduje i sprząta surowym `db`** (insert salonów/userów), a jednocześnie **napędza realne handlery tras**. | RLS musi pozwolić ścieżce seed (rola owner) **ominąć** politykę, a ścieżce handlera (rola app) — **egzekwować** ją. To wymusza `ENABLE` (nie `FORCE`) + dwie role. Test musi przejść też z włączonym RLS. |
| O4 | Ścieżki bez kontekstu sesji salonu: webhooki Stripe/Twilio, 5 cronów, seed, migracje, admin. | To **największe ryzyko wdrożenia RLS**: jeśli RLS obejmie te ścieżki bez ustawionego kontekstu, **zepsują się ciche** (puste wyniki, nie błędy). Wymagają osobnej, kontrolowanej obsługi (sekcja 4). |
| O5 | Produkcja na Neon (managed PostgreSQL). Pamięć repo: „RLS na Neon: ENABLE nie FORCE; owner bez BYPASSRLS; izolacja przez rolę app + SET LOCAL ROLE". | Wzorzec referencyjny już zwalidowany w innym repo firmy — stosujemy go, nie wymyślamy od nowa. |
| O6 | Dedykowana rola DB na produkcji + migracja schemy prod = **czerwone linie** (CLAUDE.md sekcja 4: nowy element infry + migracja schemy produkcyjnej). | Ten ADR stosuje RLS **TYLKO na bazę lokalną/testową**. Produkcja = osobny sign-off Darka, osobny krok (sekcja 5). |
| O7 | `clients/[id]` DELETE zwraca dziś **403** dla cudzego zasobu po nietrafionym haśle (mikro-wyciek istnienia: „ten zasób istnieje, ale nie masz hasła"). | Ujednolicenie odpowiedzi „nie znaleziono / nie twoje" na **404** — istnienie cudzego zasobu nie może przeciekać przez kod statusu (sekcja 2.4). |

### Czego świadomie NIE robimy w tym PR (poza zakresem)

- **Nie ruszamy produkcji.** Żadna migracja RLS nie idzie na Neon w tym PR (O6).
- **Nie przepisujemy wszystkich 161 tras naraz.** Migracja fazowa (sekcja 2.5).
- **Nie dotykamy modelu danych** (kolumny, FK, indeksy są zdrowe — audyt sekcja 2). RLS i repo to warstwy *nad* schematem, nie zmiana schematu danych biznesowych.
- **Nie rozwiązujemy pozostałych P1** (`maxDuration`, rate-limit, audit_log) — osobne ADR.

---

## 2. Warstwa repozytorium (aplikacja)

### 2.1 Rozważane kształty

**Opcja A — repozytoria per encja (`src/lib/repositories/<encja>.ts`).** Klasa/moduł na każdą tabelę salon-scoped, każda metoda przyjmuje `salonId` jako pierwszy, obowiązkowy argument typu.
- Zaleta: czytelne, łatwe do testowania, jawny kontrakt per encja.
- Wada: 26 plików repo do napisania; dużo powtarzalnego kodu CRUD; migracja 56 tras to 56 zmian podpisów.

**Opcja B — jeden wymuszony helper dostępu zasobu (`getOwnedResourceOr404` / `scopedDb(salonId)`).** Cienka warstwa: builder, który przyjmuje `salonId` raz i zwraca zestaw operacji już zawężonych (`findOneOr404`, `updateOwned`, `deleteOwned`), domykając `eq(salonId)` automatycznie.
- Zaleta: minimalna powierzchnia, jeden punkt prawdy o tym „co znaczy mój zasób", migracja trasy to podmiana `db.select()...where(and(eq(id),eq(salonId)))` na `scoped.findOneOr404(table, id)`. Mniej kodu = mniej miejsc na błąd.
- Wada: mniej jawny kontrakt per encja niż A.

**Opcja C — Drizzle RLS-aware client (`db.$withAuth`/transakcja z `SET LOCAL`) bez warstwy repo.** Polegamy wyłącznie na RLS, aplikacja przestaje filtrować.
- Wada: **odrzucona** — to usuwa warstwę aplikacyjną zamiast dodawać drugą; sprzeczne z defense in depth (sekcja 6). Jedna tama zamiast dwóch.

### 2.2 Decyzja — Opcja B (wymuszony scoped accessor) jako rdzeń, z miejscem na Opcję A tam, gdzie się opłaca

**Wybieramy Opcję B:** jeden moduł `src/lib/server/repository.ts` eksportujący funkcję `forSalon(salonId: string)`, która zwraca obiekt z operacjami zawężonymi do najemcy. Kształt (sygnatura referencyjna — implementuje Leo):

```ts
// src/lib/server/repository.ts  — JEDYNY plik poza tym modułem, który importuje { db }.
import { db } from "@/lib/db";
import { and, eq, type SQL } from "drizzle-orm";

/** Tabela salon-scoped musi mieć kolumny .id i .salonId. */
type SalonScoped = { id: AnyColumn; salonId: AnyColumn };

export function forSalon(salonId: string) {
  if (!salonId) throw new Error("repository.forSalon: salonId wymagany"); // fail-fast
  return {
    /** Zwraca wiersz w MOIM salonie albo null — nigdy cudzy. */
    findOne<T extends SalonScoped>(table: T, id: string) {
      return db.select().from(table)
        .where(and(eq(table.id, id), eq(table.salonId, salonId))).limit(1)
        .then((r) => r[0] ?? null);
    },
    /** Update zawężony do salonu; .returning() puste => brak wiersza => 404 w trasie. */
    updateOwned<T extends SalonScoped>(table: T, id: string, data: Partial<...>) { /* and(eq(id),eq(salonId)) */ },
    deleteOwned<T extends SalonScoped>(table: T, id: string) { /* and(eq(id),eq(salonId)) */ },
    listOwned<T extends SalonScoped>(table: T, extra?: SQL) { /* eq(salonId) [+ extra] */ },
    // złożone zapytania (joiny, agregacje) -> .raw(salonId) z jawnym dopiskiem eq(salonId)
  };
}
```

**Kontrakt twardy:**
- `forSalon` rzuca, jeśli `salonId` puste — **niemożliwe** zbudowanie zapytania bez najemcy (fail-fast, nie ciche `WHERE salonId = undefined`).
- Typ `SalonScoped` wymusza na poziomie TypeScript, że tabela ma `.salonId` — tabel bez tej kolumny (sekcja 3.4) nie da się tu przekazać.
- **`repository.ts` jest JEDYNYM miejscem w `src/app/api/**` z importem `{ db }`** (egzekwuje lint, 2.3). Złożone zapytania (joiny w `salons/[id]`, agregacje w cronie) używają `forSalon(salonId).raw()` z jawnym, widocznym `eq(salonId)` — nie znikają z radaru.

### 2.3 Lint — reguła zakazu surowego `db` poza warstwą repo

Repo używa **flat config** (`eslint.config.mjs`). Dodajemy blok `no-restricted-imports` zawężony ścieżką:

```js
// eslint.config.mjs — nowy blok PO ...nextConfig
{
  files: ["src/app/api/**/*.ts"],
  ignores: ["src/app/api/**/*.test.ts"],
  rules: {
    "no-restricted-imports": ["error", {
      paths: [{
        name: "@/lib/db",
        importNames: ["db"],
        message:
          "Trasy API nie importują surowego `db`. Użyj forSalon(salonId) z @/lib/server/repository — to wymusza izolację salonu. Wyjątki (webhooki/cron/seed) deklarują kontekst jawnie (patrz ADR-001 sekcja 4).",
      }],
    }],
  },
},
```

- **DoD (maszynowo sprawdzalny):** `pnpm lint` przechodzi tylko, gdy żadna trasa w `src/app/api/**` (poza zadeklarowanymi wyjątkami) nie importuje `db`. Reguła `error`, nie `warn` — łamie build CI (`quality-gate.yml`).
- **Wyjątki kontrolowane** (webhooki Stripe/Twilio, crony, seed — sekcja 4): jawny, *widoczny w diffie* `// eslint-disable-next-line no-restricted-imports` z komentarzem-uzasadnieniem przy imporcie. To czyni wyjątek **policzalnym w review**, nie ukrytym. Docelowo te ścieżki dostają własny accessor systemowy (sekcja 4.3).

### 2.4 Ujednolicenie odpowiedzi „nie znaleziono / nie twoje" na 404

**Problem (O7):** dziś `clients/[id]` DELETE zwraca **403** po nietrafionym haśle dla cudzego zasobu — to mikro-wyciek istnienia (atakujący odróżnia „nie istnieje" 404 od „istnieje, złe hasło" 403). Test izolacji to dziś toleruje (`expect([403, 404]).toContain(res.status)` — linia 205).

**Decyzja:** zasób spoza mojego salonu = **404 zawsze**, *zanim* dojdzie do jakiejkolwiek dalszej weryfikacji (hasło, rola). Kolejność w każdej trasie `[id]`:
1. `requireAuth()` → 401 jeśli niezalogowany.
2. `getUserSalonId()` → 404 jeśli brak salonu.
3. **`forSalon(salonId).findOne(table, id)` → 404 jeśli null** (cudzy lub nieistniejący — nierozróżnialne dla klienta).
4. *Dopiero teraz* weryfikacja hasła/roli wewnątrz własnego salonu (np. DELETE klienta wymaga hasła → 403 dozwolone, ale tylko dla WŁASNEGO zasobu).

Tak `403` zostaje zarezerwowane dla „twój zasób, ale brak uprawnienia/hasła", a istnienie cudzego zasobu nigdy nie przecieka. Po tej zmianie test izolacji zaostrzamy z `[403,404]` na `404` dla cross-tenant DELETE (sekcja 5).

### 2.5 Jak migrować 56 tras `[id]` — fazowo

**Fazowo, nie naraz** (O1). Naraz = wielki nieaudytowalny diff + ryzyko regresji na 56 trasach jednocześnie.

- **Faza R1 (ten PR):** warstwa repo + lint jako **`warn`** (nie błędu) + migracja **3 tras pokrytych testem izolacji** (`clients/[id]`, `appointments/[id]`, `gallery/[id]`) na `forSalon`. Test izolacji jest siatką bezpieczeństwa — migrujemy najpierw to, co test pilnuje. Dowód: test przechodzi po podmianie na repo.
- **Faza R2 (kolejne PR-y, paczki ~10 tras):** migracja pozostałych ~53 tras, każda paczka z rozszerzeniem testu izolacji o nowe encje. Po każdej paczce lint nadal `warn`.
- **Faza R3 (PR domykający):** gdy 0 tras importuje surowy `db` poza wyjątkami — **przełączenie lintu na `error`**. Od tego momentu nowa trasa z `import { db }` nie wejdzie do main. To brama, która zamyka dług na stałe.

Fazowanie chroni przed regresją (siatka testu rośnie z migracją) i daje audytowalne, małe PR-y.

---

## 3. RLS — druga tama w bazie

### 3.1 Podejście (wzorzec referencyjny Neon, O5)

- **`ENABLE ROW LEVEL SECURITY`, NIE `FORCE`** na każdej tabeli salon-scoped. `ENABLE` oznacza: polityki obowiązują rolę aplikacyjną, ale **właściciel tabeli i migracje je omijają** — dzięki temu migracje, seed i ścieżki administracyjne działające pod rolą owner nie wymagają ustawiania kontekstu (kluczowe dla O3 — test seeduje surowym `db`).
- **Polityka oparta na zmiennej sesji:** `current_setting('app.current_salon_id', true)` — `true` = „nie rzucaj, gdy zmienna nieustawiona" (zwróci NULL). Polityka:
  ```sql
  CREATE POLICY tenant_isolation ON clients
    USING (salon_id = current_setting('app.current_salon_id', true)::uuid)
    WITH CHECK (salon_id = current_setting('app.current_salon_id', true)::uuid);
  ```
  `USING` chroni odczyt/update/delete (widać tylko swoje wiersze); `WITH CHECK` chroni insert/update (nie wstawisz wiersza do cudzego salonu).
- **Dedykowana rola aplikacyjna `myhelper_app` BEZ `BYPASSRLS`** — to ona łączy się w runtime aplikacji. Owner/rola migracji (`myhelper_migrator`) zachowuje pełny dostęp dla `drizzle-kit migrate` i seed.
- **Ustawianie kontekstu per żądanie/transakcję:** wrapper, który dla każdego żądania aplikacji otwiera transakcję i robi `SET LOCAL app.current_salon_id = '<uuid>'` **przed** zapytaniami. `SET LOCAL` znika po `COMMIT`/`ROLLBACK` — kontekst nie wycieka między żądaniami (krytyczne na współdzielonym poolu połączeń). To wchodzi do `forSalon` (warstwa repo otwiera transakcję ze scope).

### 3.2 Wzorzec połączenia — dwie role

`src/lib/db.ts` dostaje rozdział:
- `db` (rola `myhelper_app`, bez BYPASSRLS) — runtime aplikacji, RLS egzekwowane.
- `dbAdmin` / `dbMigrator` (rola owner) — migracje, seed, ścieżki systemowe sekcji 4. RLS omijane przez `ENABLE`-not-`FORCE`.

W tym PR (baza lokalna) to dwie różne role na lokalnym Postgresie (port 5440 wg `setup-real-db.ts`). Na produkcji = dwie role na Neon = **czerwona linia O6**.

### 3.3 Które tabele dostają RLS

**Z RLS (26 tabel z bezpośrednim `salonId`):** `clients`, `employees`, `service_categories`, `services`, `appointments`, `gallery_photos`, `albums`, `reviews`, `notifications`, `waiting_list`, `product_categories`, `products`, `promotions`, `promo_codes`, `loyalty_points`, `invoices`, `ai_conversations`, `ai_generated_media`, `newsletters`, `marketing_consents`, `favorite_salons`, `salon_subscriptions`, `subscription_payments`, `deposit_payments`, `fiscal_receipts`, `scheduled_posts`.

**Tabele salon-scoped POŚREDNIO (przez FK do encji nadrzędnej, bez własnego `salon_id`)** — RLS przez `EXISTS` na rodzicu albo (preferowane) **dodanie zdenormalizowanego `salon_id` w osobnym ADR schematu**; w tym PR obejmujemy je polityką `EXISTS`:
- `time_blocks`, `employee_services`, `employee_service_prices`, `work_schedules`, `employee_commissions` → przez `employees.salon_id`.
- `service_variants`, `service_products` → przez `services.salon_id`.
- `appointment_materials`, `treatment_history` → przez `appointments.salon_id`.
- `photo_albums` → przez `gallery_photos.salon_id`.
- `product_usage` → przez `products.salon_id`.
- `loyalty_transactions` → przez `loyalty_points.salon_id`.

**POZA modelem RLS (świadomie bez polityki tenant):**
- **Auth Better Auth:** `user`, `session`, `account`, `verification` — zarządzane przez Better Auth, dostęp przez własną logikę auth; RLS tu zepsułby logowanie. Bez polityki tenant.
- **Korzeń najemcy:** `salons` — to *jest* tabela najemcy; izolacja przez `ownerId` w `getUserSalon`, nie przez `salon_id` na sobie samej. Polityka osobna: właściciel widzi swój salon (`owner_id = current_user_id`), publiczny katalog czyta przez rolę/widok publiczny (uwaga: `salons/[id]` jest publiczny przez `unstable_cache` — patrz ryzyko 4.4).
- **Globalne/słownikowe:** `subscription_plans` (cennik wspólny dla wszystkich) — bez tenant, odczyt publiczny.
- **Związane z userem nie z salonem:** `temporary_access`, `push_subscriptions` (FK do `user.id`, nie `salon_id`) — RLS po `user_id` jeśli w ogóle; w tym PR poza zakresem tenant-RLS (audyt sekcja 2 sygnalizował, że założenie 1 user = 1 salon nie jest zapisane — to osobny dług).

### 3.4 Dlaczego repo + RLS, a nie samo RLS

RLS broni *wiersza*, ale nie zwraca ładnego 404 ani nie waliduje wejścia — to robi aplikacja. RLS bez warstwy repo daje ciche puste wyniki (trasa zwróci 500/pustkę zamiast 404). Warstwa repo bez RLS to wciąż jedna tama. **Razem:** repo daje poprawny kontrakt HTTP + fail-fast, RLS daje gwarancję bazy, że nawet błąd w repo nie przepuści cudzego wiersza.

---

## 4. Ryzyka RLS — ścieżki bez kontekstu sesji (NAJWIĘKSZE ryzyko wdrożenia)

To jest centralne ryzyko: ścieżki, które **nie mają** zalogowanego właściciela i nie ustawią `app.current_salon_id`. Jeśli RLS obejmie je pod rolą app bez kontekstu, polityka `salon_id = NULL` zwróci **zero wierszy** — i te ścieżki **zepsują się cicho** (webhook „przetworzony", ale nic nie zapisał; cron „wykonany", ale nikogo nie powiadomił). Inwentarz i obsługa:

| Ścieżka | Pliki | Jak działa dziś | Obsługa pod RLS |
|---|---|---|---|
| **Webhook Stripe** | `api/stripe/webhook` | `db` po `salonSubscriptions/subscriptionPayments`, klucz = subskrypcja Stripe, **nie sesja** | Rola `myhelper_migrator`/`dbAdmin` (omija RLS przez ENABLE-not-FORCE) **albo** `SET LOCAL` po wyznaczeniu salonu z subskrypcji. Preferencja: dbAdmin — webhook jest systemowy, zaufany (weryfikowany podpisem Stripe). Jawny wyjątek lintu (2.3). |
| **Webhook Twilio (voice)** | `api/ai/voice/twilio/webhook` | jw., systemowy callback | Jak Stripe — rola systemowa, kontekst wyznaczony z payloadu połączenia. |
| **5 cronów** | `api/cron/*` (sms-reminders, push-reminders, push-reminders-24h, publish-scheduled-posts, cleanup-temporary-access) | chronione `requireCronSecret`, **iterują PO WIELU salonach** (`innerJoin salons`) | **Rola systemowa `dbAdmin`** — cron z definicji działa cross-tenant (przetwarza wszystkie salony). RLS by go zablokował. Jawny wyjątek lintu + komentarz. **Alternatywa rozważona i odrzucona:** pętla `SET LOCAL` per salon — niepotrzebnie komplikuje cron, który MA widzieć wszystkich. |
| **Seed** | `api/seed` (chroniony `NODE_ENV!=production` + `requireAuth("owner")`) oraz seed testu izolacji (`db` w `beforeAll`) | tworzy dane wielu salonów | Rola owner/migrator — omija RLS (ENABLE-not-FORCE). **To jest powód, dla którego ENABLE, nie FORCE** (O3): test seeduje surowym `db` i musi działać. |
| **Migracje** | `drizzle-kit migrate` | DDL pod rolą owner | Owner omija RLS z definicji. Bez zmian. |
| **Admin / panel właściciela cross-salon** | (przyszłe) | — | Rola systemowa z jawnym, logowanym kontekstem; nie w tym PR. |

**Reguła domykająca ryzyko:** żadna ścieżka systemowa nie używa roli `myhelper_app`. Albo (a) działa pod rolą owner/admin (omija RLS — dla zaufanych, systemowych, cross-tenant), albo (b) jawnie ustawia `SET LOCAL app.current_salon_id` po wyznaczeniu salonu z payloadu (dla ścieżek dotyczących jednego salonu). Każdy wyjątek jest **widoczny w diffie** (eslint-disable + komentarz) i **policzalny w review** — to przekształca „cichą awarię" w „jawną decyzję".

**Test regresyjny ryzyka (DoD):** test integracyjny webhooka Stripe z włączonym RLS — asercja, że płatność subskrypcji zapisuje się poprawnie (czyli rola systemowa faktycznie omija RLS, a nie zwraca zero wierszy). Bez tego testu RLS nie idzie nawet na lokalną bazę.

---

## 5. Plan migracji i fazowanie

### 5.1 Migracje Drizzle (RLS) — TYLKO baza lokalna/test w tym PR

> Pamięć repo (twarda): ręcznie pisana migracja spoza `_journal.json` cicho nie wykona się na `db:migrate`. Polityki RLS to czysty SQL (Drizzle nie generuje `CREATE POLICY` z definicji tabel) — więc dodajemy je jako **migracja SQL wygenerowana pustym `drizzle-kit generate --custom`** i ręcznie wypełniona, **wpisana do `_journal.json` w kolejności landowania**. Numer = kolejny po `0004` (czyli `0005_rls_tenant_isolation`).

Zawartość migracji `0005`:
1. `CREATE ROLE myhelper_app NOLOGIN; GRANT ... ON ALL TABLES ...` (rola bez BYPASSRLS) — **na lokalnej bazie**.
2. `ALTER TABLE <26 tabel> ENABLE ROW LEVEL SECURITY;`
3. `CREATE POLICY tenant_isolation ON <tabela> USING (...) WITH CHECK (...);` dla 26 tabel bezpośrednich + polityki `EXISTS` dla tabel pośrednich (3.3).
4. Polityki specjalne dla `salons` (po `owner_id`).

**Czerwona linia (O6):** kroki 1 (rola DB) i całość na **produkcji Neon** = osobny sign-off Darka, osobny ręczny krok PO tym PR. W tym PR migracja stosowana **wyłącznie** na lokalny Postgres (guard `setup-real-db.ts` blokuje host inny niż localhost — ta sama tama chroni przed przypadkowym RLS na prod).

### 5.2 Kolejność

1. **Repo + lint (`warn`) + migracja 3 tras testowych** — Faza R1 (sekcja 2.5). Bez RLS jeszcze.
2. **Migracja RLS `0005` na lokalną bazę** + dwie role lokalnie + wrapper `SET LOCAL` w `forSalon`.
3. **Test izolacji przechodzi z włączonym RLS** (siatka bezpieczeństwa — patrz 5.4).
4. **Test webhooka pod RLS** (ryzyko sekcji 4) przechodzi.
5. Dalej (kolejne PR-y): R2/R3 migracji tras, potem czerwona linia RLS na prod.

### 5.3 Rollback

- **Repo + lint:** rewert commitu; trasy wracają do surowego `db` (lint `warn` nie blokuje). Bezpieczne, bo filtr aplikacyjny w trasach zostaje (nie usuwamy `eq(salonId)` — patrz sekcja 6).
- **RLS lokalnie:** migracja `down` = `DROP POLICY` + `ALTER TABLE ... DISABLE ROW LEVEL SECURITY` + `DROP ROLE`. Ponieważ `ENABLE` (nie `FORCE`) i rola owner omija — rollback nie wymaga przestoju.
- **Kluczowe:** filtr aplikacyjny (`eq(salonId)`) **nigdy nie jest usuwany** przy włączaniu RLS — więc rollback RLS nie odsłania danych (aplikacja nadal filtruje). To wprost defense in depth (sekcja 6).

### 5.4 Weryfikacja (DoD maszynowy)

- **`__tests__/integration/salon-isolation.test.ts` przechodzi z WŁĄCZONYM RLS** — to twarda brama. Test napędza realne handlery pod rolą app (RLS aktywne) i seeduje pod rolą owner (RLS omijane). Po RLS cross-tenant DELETE zaostrzamy z `[403,404]` na **`404`** (sekcja 2.4).
- **Test negatywny RLS bez warstwy aplikacji:** nowy przypadek — zapytanie surowym `db` pod rolą `myhelper_app` BEZ `SET LOCAL` zwraca **zero wierszy** (dowód, że baza sama chroni, niezależnie od kodu trasy). To jest dowód „głębszej tamy".
- **Test webhooka pod RLS** (sekcja 4) — płatność zapisuje się poprawnie (rola systemowa omija).
- **`pnpm lint`** — przy R3 reguła `error` przechodzi tylko, gdy 0 tras (poza wyjątkami) importuje `db`.

---

## 6. Defense in depth — warstwa repo (app) + RLS (baza) współistnieją

Egzekwowanie izolacji **trzema niezależnymi warstwami**, z których żadnej nie usuwamy:

1. **Filtr aplikacyjny w trasie** (`eq(salonId)`) — istnieje dziś, **zostaje**. Nawet po wprowadzeniu repo i RLS nie wycinamy `eq(salonId)` z zapytań; warstwa repo go *generuje*, więc jest obecny z definicji.
2. **Warstwa repo + lint** — czyni pominięcie scope **niemożliwym do napisania** (fail-fast na braku `salonId`, lint blokuje surowy `db`).
3. **RLS w bazie** — gwarancja, że nawet błąd w warstwie 1/2 nie przepuści cudzego wiersza („aplikację da się ominąć, bazę nie").

Jedna warstwa może zawieść (bug w repo, błąd w polityce, pominięcie `SET LOCAL`) — trzy naraz nie. To wprost wymóg standardu (domena 8) potraktowany jako właściwość architektury, nie jako jednorazowa łatka. **Nie zastępujemy filtra aplikacyjnego RLS-em** — to byłby downgrade z trzech tam do jednej.

---

## 7. Alternatywy odrzucone, koszt i rekomendacja fazowania

### Alternatywy odrzucone

| Alternatywa | Dlaczego odrzucona |
|---|---|
| **Tylko RLS, bez warstwy repo** (Opcja C, 2.1) | RLS zwraca puste wyniki, nie 404; brak walidacji wejścia; jedna tama zamiast trzech. Sprzeczne z defense in depth. |
| **Tylko warstwa repo, bez RLS** | Zostawia bazę bezbronną — „aplikację da się ominąć". Nie domyka findingu D1 audytu (brak twardej tamy w bazie). |
| **`FORCE` RLS zamiast `ENABLE`** | Zablokowałby migracje, seed i test (który seeduje surowym `db`) — O3. Wymuszałby `SET LOCAL` w każdej ścieżce systemowej, mnożąc ryzyko cichej awarii z sekcji 4. ENABLE + dedykowana rola daje tę samą ochronę dla roli app bez tych kosztów. |
| **Middleware Next ustawiające kontekst globalnie** | Middleware Next 16 nie ma niezawodnego dostępu do połączenia DB per żądanie i nie obejmuje wywołań spoza cyklu żądania (cron). Kontekst per transakcja w repo jest pewniejszy. |
| **Repozytoria per encja (Opcja A) dla wszystkich 26 tabel od razu** | 26 plików + 56 zmian podpisów w jednym PR = wielki nieaudytowalny diff. Opcja B daje tę samą ochronę mniejszą powierzchnią; A wprowadzamy selektywnie, gdzie kontrakt per encja się opłaca. |
| **Rebuild izolacji od zera** | Audyt (sekcja 6) rekomenduje refactor inkrementalny — model danych jest zdrowy, wada w jednej warstwie. |

### Koszt / złożoność

- **Warstwa repo + lint:** niski–średni. Jeden moduł `repository.ts` (~150 linii) + blok eslint. Migracja tras to mechaniczna podmiana, fazowana. Ryzyko: niskie (filtr aplikacyjny zostaje jako siatka).
- **RLS lokalnie:** średni. Migracja SQL (custom, w journalu), dwie role lokalne, wrapper `SET LOCAL` w repo. Ryzyko: średnie — ścieżki systemowe (sekcja 4) to miejsce, gdzie błąd boli; mitygacja: test webhooka pod RLS jako DoD.
- **RLS na prod:** **wysoki / czerwona linia.** Dwie role na Neon, migracja schemy prod, ryzyko cichej awarii ścieżek systemowych na żywym ruchu. Dlatego osobny PR + sign-off + okno obserwacji.

### Rekomendacja fazowania — co w TYM PR, co później

**W tym PR (`feat/repo-layer-rls`):**
1. Warstwa repo `src/lib/server/repository.ts` (Opcja B).
2. Lint `no-restricted-imports` jako **`warn`** (jeszcze nie `error` — bo 53 trasy go złamią).
3. Migracja 3 tras pokrytych testem (`clients`, `appointments`, `gallery`) na `forSalon` + ujednolicenie 404 (sekcja 2.4).
4. Migracja RLS `0005` + dwie role + wrapper `SET LOCAL` — **TYLKO lokalna baza**.
5. Test izolacji przechodzi z RLS; nowy test negatywny RLS; test webhooka pod RLS.

**Później (osobne PR-y):**
- **R2:** migracja pozostałych ~53 tras na repo (paczki ~10, każda z rozszerzeniem testu).
- **R3:** przełączenie lintu na **`error`** gdy 0 tras łamie regułę.
- **Czerwona linia:** RLS na produkcji Neon — dwie role + migracja schemy prod, **sign-off Darka**, okno obserwacji.
- Zdenormalizowany `salon_id` na tabelach pośrednich (zamiast polityk `EXISTS`) — osobny ADR schematu, jeśli `EXISTS` okaże się kosztowny w planie zapytań.

**Czy to 1 PR czy kilka?** **Kilka.** Ten PR to fundament (repo + lint warn + RLS lokalnie + 3 trasy + testy). Pełne domknięcie długu to seria 4–6 PR-ów (R2 paczkami + R3 + prod). Próba zrobienia wszystkiego w jednym PR złamałaby O1 (nieaudytowalny diff) i O6 (prod = czerwona linia).

---

## 8. Wymagane decyzje przed implementacją

1. **Sign-off Darka na dedykowaną rolę DB na produkcji** (`myhelper_app` bez BYPASSRLS + `myhelper_migrator`) — czerwona linia (nowy element infry, CLAUDE.md sekcja 4). **Nie blokuje tego PR** (lokalnie), blokuje krok prod.
2. **Sign-off Darka na migrację schemy produkcyjnej RLS** — osobny ręczny krok, osobne okno (O6). **Nie w tym PR.**
3. **Potwierdzenie Ryana (CRCO)** zakresu tabel RLS (sekcja 3.3) i obsługi ścieżek systemowych (sekcja 4) — przegląd domenowy bezpieczeństwa/RODO przed implementacją.
4. **Potwierdzenie Leo** wykonalności wrappera `SET LOCAL` w `forSalon` na poolu `postgres-js` (czy `SET LOCAL` trzyma się transakcji na tym sterowniku) — PoC przed migracją R2.

---

## Self-critique (rola: principal engineer po incydencie IDOR cross-tenant)

Pięć słabości pierwszej wersji i co poprawiłem:

1. **Ryzyko, że ADR brzmi jak „dodaj RLS i repo" — życzenie, nie projekt.** → Każda rekomendacja ma konkret wykonalny: sygnatura `forSalon`, dokładny blok `no-restricted-imports` z `files`/`ignores`, `ENABLE`-not-`FORCE` z uzasadnieniem przez test seedujący, numer migracji `0005` w `_journal.json` (pamięć repo o cichym pominięciu migracji spoza journala), nazwy ról. Nie aspiracja — instrukcja dla Leo.

2. **Najgroźniejsze ryzyko (ścieżki bez kontekstu) mogło zostać wzmiankowane, nie rozwiązane.** → Sekcja 4 to inwentarz każdej ścieżki systemowej (2 webhooki, 5 cronów po nazwach, seed, migracje) z konkretną obsługą (rola systemowa omijająca RLS vs `SET LOCAL`) i regułą domykającą + DoD (test webhooka pod RLS). Nazwałem to wprost największym ryzykiem, bo cicha awaria cronu/webhooka jest gorsza niż głośny błąd.

3. **Mogłem złamać własną zasadę i kazać usunąć filtr aplikacyjny po wprowadzeniu RLS.** → Sekcja 6 explicite: trzy warstwy współistnieją, `eq(salonId)` nigdy nie znika, rollback RLS nie odsłania danych. Defense in depth jako właściwość, nie hasło.

4. **Test izolacji mógł zostać potraktowany jako „już jest, więc OK".** → Pokazałem, że test seeduje surowym `db` — co *wymusza* `ENABLE` nie `FORCE` (O3) — i zaostrzyłem go (cross-tenant DELETE z `[403,404]` na `404`, sekcja 2.4) plus dodałem test negatywny RLS (dowód, że baza chroni bez aplikacji) i test webhooka. DoD maszynowy, nie „przejrzymy ręcznie".

5. **Granica czerwonej linii mogła się rozmyć (RLS „po prostu wdrożone").** → Rozdzieliłem twardo: lokalna baza w tym PR (odwracalne, guard host=localhost), produkcja = dwie czerwone linie (rola DB + migracja schemy prod) z osobnym sign-offem Darka i osobnym PR. Fazowanie (sekcja 7) mówi wprost „kilka PR-ów, nie jeden" z powodem (O1 + O6).

Pozostała szczera niepewność: nie uruchamiałem migracji ani RLS (ADR = projekt, nie implementacja). Twierdzenie, że `SET LOCAL` trzyma się transakcji na sterowniku `postgres-js` z poolem, wymaga PoC Leo (decyzja 4 w sekcji 8) — oznaczyłem to jako warunek przed R2, nie jako pewnik.

---

**Następny krok:** po przeglądzie Ryana (zakres RLS + ścieżki systemowe) i PoC Leo (`SET LOCAL` na `postgres-js`) — implementacja Fazy R1 zgodnie z DoD sekcji 2/5. RLS na produkcji pozostaje w statusie „czeka na sign-off Darka" (czerwone linie, sekcja 8).
