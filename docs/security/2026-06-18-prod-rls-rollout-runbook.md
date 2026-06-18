# Runbook wdrożenia produkcyjnego RLS — izolacja najemców (tenant isolation)

**Status:** Przygotowany — **NIE wykonany.** Czeka na sign-off Darka (Plan Mode) + przegląd domenowy Ryana (CRCO, domena 8 standardu).
**Data:** 2026-06-18
**Autor:** Ethan (CTO)
**Wersja:** v1.0
**Dotyczy:** `Danolog/My_Helper_2` @ `feat/repo-layer-rls`. Baza produkcyjna: Neon (managed PostgreSQL).
**Podstawa:** ADR-001 (`docs/adr/ADR-001-repo-layer-rls.md`), migracja `drizzle/0005_rls_tenant_isolation.sql`, wrapper `src/lib/server/repository.ts`, test `__tests__/integration/rls-tenant.test.ts`.

> **Słowniczek** (żargon tłumaczony, CLAUDE.md sekcja 3):
> **RLS** (Row-Level Security — bezpieczeństwo na poziomie wiersza: baza sama odrzuca odczyt/zapis cudzych wierszy, niezależnie od kodu aplikacji);
> **najemca / tenant** (jedna firma korzystająca ze wspólnej instancji — tu: pojedynczy salon);
> **rola DB** (konto w bazie z określonymi uprawnieniami — nie to samo co rola użytkownika aplikacji);
> **owner** (rola będąca właścicielem tabel — migracje, seed, ścieżki systemowe; pod `ENABLE`-not-`FORCE` omija RLS);
> **`SET LOCAL ROLE`** (przełączenie roli DB obowiązujące tylko do końca bieżącej transakcji);
> **ENABLE vs FORCE** (`ENABLE` — polityki obowiązują zwykłe role, ale właściciel tabeli je omija; `FORCE` — obowiązują nawet właściciela);
> **BYPASSRLS** (atrybut roli, który całkowicie wyłącza RLS dla niej — dla roli aplikacyjnej **nie chcemy go**);
> **DSN / connection string** (adres połączenia do bazy z `DATABASE_URL`/`POSTGRES_URL`);
> **pool połączeń** (zbiór współdzielonych, wielokrotnie używanych połączeń DB);
> **DDL** (Data Definition Language — instrukcje zmieniające schemat: `CREATE`/`ALTER`/`DROP`);
> **DML** (Data Manipulation Language — `SELECT`/`INSERT`/`UPDATE`/`DELETE`);
> **zero-downtime** (wdrożenie bez przerwy w działaniu usługi);
> **staging** (środowisko bliźniacze do produkcji, do prób przed prod).

---

## 0. Po co ten runbook — i dlaczego to czerwona linia

Gałąź `feat/repo-layer-rls` wprowadza dwie tamy izolacji salonów: warstwę repozytorium (`forSalon`) i RLS w bazie. **Problem deploymentowy:** kod produkcyjny w `withSalonContext` (`src/lib/server/repository.ts:76`) wykonuje przy **każdej** operacji ścieżki żądania:

```
SET LOCAL ROLE myhelper_app
```

Jeśli na produkcji Neon **nie istnieje rola `myhelper_app`**, to polecenie rzuca błąd `role "myhelper_app" does not exist` — i **każda** trasa API przepuszczona przez `forSalon` zwróci błąd. To znaczy: **sam deploy tej gałęzi na prod bez wcześniejszego założenia roli kładzie produkcję.** Stąd sekwencja w sekcji 2 jest krytyczna i nie podlega skróceniu.

Migracja `0005` tworzy rolę + zakłada RLS **wyłącznie na bazie lokalnej/testowej** (komentarz w pliku, linie 1–7; guard host=localhost w `__tests__/integration/setup-real-db.ts`). Produkcja jest jawnie poza zakresem PR. Wdrożenie na prod dotyka **dwóch czerwonych linii** CLAUDE.md sekcja 4:
1. **Nowy element infrastruktury / rola DB** (`myhelper_app`).
2. **Migracja schemy produkcyjnej** (`ENABLE RLS` + `CREATE POLICY` na ~39 tabelach).

Oba wymagają **sign-offu Darka w Plan Mode** przed wykonaniem. Ten dokument doprowadza pakiet do stanu **wykonalnego-po-sign-offie** — nie wykonuje niczego na prod-bazie.

---

## 1. Model ról — kto się łączy, kto egzekwuje (KLUCZOWE do zrozumienia przed SQL)

To jest najczęstsze nieporozumienie przy RLS, więc wprost:

- **Aplikacja łączy się z bazą jako rola OWNER** (ta z `DATABASE_URL`/`POSTGRES_URL`). Na Neon to domyślnie rola właściciela bazy (np. `neondb_owner`). **Rola łączeniowa NIE jest `myhelper_app`.**
- `myhelper_app` to rola `NOLOGIN` — **nikt się nią nie loguje.** Wchodzi się w nią z połączenia ownera przez `SET LOCAL ROLE myhelper_app` (wrapper `forSalon`).
- Żeby owner mógł zrobić `SET ROLE myhelper_app`, owner musi być **członkiem** roli `myhelper_app` — to robi `GRANT myhelper_app TO <owner>` (migracja `0005`, linia 38: `GRANT myhelper_app TO current_user`).
- Dlaczego nie osobny login dla `myhelper_app`? Bo `ENABLE`-not-`FORCE` wymaga, by ścieżki systemowe (migracje, seed, webhooki Stripe/Twilio, 5 cronów) działały pod ownerem i **omijały** RLS. Gdyby aplikacja logowała się bezpośrednio jako `myhelper_app`, ścieżki systemowe straciłyby owner-bypass. Jedna rola łączeniowa (owner) + przełączanie per transakcja = jedna konfiguracja połączenia, dwa zachowania.

**Konsekwencja dla DSN:** `DATABASE_URL`/`POSTGRES_URL` na prod **zostaje bez zmian** (rola owner). Nie tworzymy nowego loginu, nie rotujemy connection stringa. Jedyna zmiana w aplikacji to obecność wrappera (już w kodzie gałęzi). To upraszcza wdrożenie i rollback.

> **Uwaga Neon — pooler:** Neon ma dwa endpointy: bezpośredni i pooled (PgBouncer, `-pooler` w hoście). `SET LOCAL ROLE` i `set_config(..., true)` są **transaction-scoped**, więc działają na PgBouncer w trybie `transaction pooling` (cała transakcja na jednym połączeniu — patrz komentarz `repository.ts:24-28`). **Migracje `0005` (DDL) puszczać przez endpoint BEZPOŚREDNI**, nie pooled — DDL i `ALTER DEFAULT PRIVILEGES` na poolerze bywa zawodne. Runtime aplikacji może zostać na poolerze.

---

## 2. Sekwencja zero-downtime — KOLEJNOŚĆ JEST KRYTYCZNA

Reguła nadrzędna: **rola + RLS muszą istnieć na prod-DB ZANIM wejdzie kod, który woła `SET LOCAL ROLE myhelper_app`.** Odwrotna kolejność = outage (sekcja 0). Krok DB jest w pełni kompatybilny wstecz ze **starym** kodem (stary kod łączy się ownerem i nie woła `SET LOCAL ROLE` — owner omija RLS przez `ENABLE`-not-`FORCE`, więc nic nie zauważa). To właśnie umożliwia zero-downtime: krok 4 nie wymaga, by kod był już wdrożony.

Kolejność:

1. **Staging-first (OBOWIĄZKOWE).** Wykonaj kroki 3–7 na środowisku staging Neon (osobna baza, bliźniacza do prod). Bez zielonego stagingu prod nie rusza. Bramka: przegląd Ryana + sign-off Darka dotyczą prod, ale staging wykonujesz, by mieć dowód.
2. **Backup / punkt przywracania prod.** Potwierdź, że Neon ma świeży point-in-time recovery (PITR) i zanotuj timestamp tuż przed zmianą. RLS nie zmienia danych, ale to siatka bezpieczeństwa dla całego okna.
3. **Sprawdzenie wstępne na prod** (read-only, bezpieczne — patrz sekcja 4, blok „PRZED"): czy rola `myhelper_app` już istnieje, kto jest ownerem tabel, ile tabel ma `salon_id`.
4. **DB: utworzenie roli + GRANT-y + ENABLE RLS + policies na prod** (sekcja 3, SQL). To migracja schemy — **czerwona linia, sign-off Darka.** Wykonuje się **pod rolą owner** przez endpoint bezpośredni. **Po tym kroku stary kod nadal działa** (owner omija RLS), a nowy kod będzie miał na czym stanąć.
5. **Weryfikacja DB** (sekcja 4, blok „PO"): rola bez BYPASSRLS, policies założone, owner widzi wszystko, rola app z kontekstem widzi tylko swoje. Jeszcze **bez** ruchu produkcyjnego na nowym kodzie.
6. **Deploy kodu** gałęzi `feat/repo-layer-rls` na prod (Vercel). Dopiero teraz `SET LOCAL ROLE myhelper_app` ma istniejącą rolę. Env `MYHELPER_APP_DB_ROLE` zostaw niezdefiniowane (domyślnie `myhelper_app`) lub ustaw jawnie na `myhelper_app`.
7. **Weryfikacja po deployu** (sekcja 4, blok „SMOKE"): kilka tras API przez `forSalon` działa, cross-tenant odcięty, webhook Stripe nadal zapisuje.
8. **Okno obserwacji 24–48 h.** Sentry/logi pod kątem `role ... does not exist`, `permission denied`, pustych wyników na cronach/webhookach. Dopiero po czystym oknie krok DB uznajemy za domknięty.

**Dlaczego dokładnie ta kolejność (rola przed kodem):**
- Krok 4 przed 6: gdyby kod wszedł pierwszy, pierwsze żądanie wywoła `SET LOCAL ROLE myhelper_app` → rola nie istnieje → 500 na całym API. Outage.
- Krok 4 jest bezpieczny dla starego kodu: owner-bypass (`ENABLE`-not-`FORCE`) znaczy, że dopóki nikt nie robi `SET LOCAL ROLE`, RLS jest „przezroczysty". Stary kod jedzie ownerem → widzi wszystko jak dotąd. Zero regresji między krokiem 4 a 6.
- Krok 5 przed 6: potwierdzasz, że DB jest gotowa, zanim skierujesz na nią nowy kod. Jeśli krok 5 czerwony — przerywasz przed deployem, prod nadal na starym kodzie, zero wpływu.

---

## 3. Dokładny SQL do wykonania na PROD (po sign-offie Darka)

> Wykonać **pod rolą owner prod** (rola z `DATABASE_URL`), przez **endpoint bezpośredni** Neon (nie pooled). Najpierw na staging (krok 1), potem na prod (krok 4). SQL jest celowo **idempotentny** — można puścić powtórnie bez błędu (`IF NOT EXISTS`, `DROP POLICY IF EXISTS`). Jest to ta sama treść co `drizzle/0005_rls_tenant_isolation.sql`, ale **świadomie wykonywana ręcznie na prod**, nie przez `db:migrate` (patrz sekcja 7, ryzyko „migrator na prod").

> **NIE uruchamiać `pnpm db:migrate` / `db:push` celując w prod.** `0005` jest już w `_journal.json` jako wykonana lokalnie; odpalenie migratora na prod mogłoby ponadto próbować zastosować inne różnice schematu. Ten krok to **wyłącznie** poniższy SQL, ręcznie, w jawnej transakcji.

```sql
-- =========================================================================
-- PROD RLS ROLLOUT — wykonać pod rolą OWNER, endpoint bezpośredni Neon.
-- Owinąć w transakcję: można przerwać (ROLLBACK) bez śladu, jeśli coś nie gra.
-- =========================================================================
BEGIN;

-- 1. Rola aplikacyjna BEZ BYPASSRLS, NOLOGIN (wchodzi się przez SET LOCAL ROLE).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'myhelper_app') THEN
    CREATE ROLE myhelper_app NOLOGIN;
  END IF;
END
$$;

-- 2. Minimalne uprawnienia: DML + sekwencje. ZERO DDL, ZERO BYPASSRLS.
GRANT USAGE ON SCHEMA public TO myhelper_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO myhelper_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO myhelper_app;
-- Przyszłe tabele/sekwencje tworzone PRZEZ OWNERA też dostają DML dla roli app.
-- (Uwaga: ALTER DEFAULT PRIVILEGES działa per-rola-twórcę. Migracje mają jechać
--  pod tą samą rolą owner co poniższy GRANT — patrz sekcja 7, ryzyko „nowa tabela".)
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO myhelper_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO myhelper_app;

-- 3. Owner musi móc SET ROLE myhelper_app (inaczej "permission denied to set role").
--    current_user = owner prod wykonujący ten skrypt (np. neondb_owner).
GRANT myhelper_app TO current_user;

-- 4. ENABLE RLS + policy tenant_isolation na 26 tabelach z bezpośrednim salon_id.
--    ENABLE (NIE FORCE): owner/migracje/webhooki/crony omijają; rola app egzekwuje.
DO $$
DECLARE
  t text;
  direct_tables text[] := ARRAY[
    'clients','employees','service_categories','services','appointments',
    'gallery_photos','albums','reviews','notifications','waiting_list',
    'product_categories','products','promotions','promo_codes','loyalty_points',
    'invoices','newsletters','marketing_consents','favorite_salons',
    'salon_subscriptions','subscription_payments','deposit_payments',
    'fiscal_receipts','scheduled_posts','ai_conversations','ai_generated_media'
  ];
BEGIN
  FOREACH t IN ARRAY direct_tables LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                   WHERE table_schema='public' AND table_name=t) THEN
      RAISE WARNING 'PROD RLS: tabela % nie istnieje — POMINIĘTA. Zweryfikuj!', t;
      CONTINUE;
    END IF;
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I;', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I '
      || 'USING (salon_id = current_setting(''app.current_salon_id'', true)::uuid) '
      || 'WITH CHECK (salon_id = current_setting(''app.current_salon_id'', true)::uuid);',
      t
    );
  END LOOP;
END
$$;

-- 5. Tabele salon-scoped POŚREDNIO (FK do rodzica, bez własnego salon_id).
--    Polityka EXISTS na rodzicu.
DO $$
DECLARE
  indirect_map text[][] := ARRAY[
    ['time_blocks','employees','employee_id','id'],
    ['work_schedules','employees','employee_id','id'],
    ['employee_services','employees','employee_id','id'],
    ['employee_service_prices','employees','employee_id','id'],
    ['employee_commissions','employees','employee_id','id'],
    ['service_variants','services','service_id','id'],
    ['service_products','services','service_id','id'],
    ['appointment_materials','appointments','appointment_id','id'],
    ['treatment_history','appointments','appointment_id','id'],
    ['product_usage','products','product_id','id'],
    ['photo_albums','gallery_photos','photo_id','id'],
    ['loyalty_transactions','loyalty_points','loyalty_id','id']
  ];
  i int; child text; parent text; fk text; pk text;
BEGIN
  FOR i IN 1 .. array_length(indirect_map, 1) LOOP
    child  := indirect_map[i][1]; parent := indirect_map[i][2];
    fk     := indirect_map[i][3]; pk     := indirect_map[i][4];
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                   WHERE table_schema='public' AND table_name=child) THEN
      RAISE WARNING 'PROD RLS: tabela pośrednia % nie istnieje — POMINIĘTA. Zweryfikuj!', child;
      CONTINUE;
    END IF;
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', child);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I;', child);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (EXISTS ('
      || 'SELECT 1 FROM %I p WHERE p.%I = %I.%I '
      || 'AND p.salon_id = current_setting(''app.current_salon_id'', true)::uuid)) '
      || 'WITH CHECK (EXISTS ('
      || 'SELECT 1 FROM %I p WHERE p.%I = %I.%I '
      || 'AND p.salon_id = current_setting(''app.current_salon_id'', true)::uuid));',
      child, parent, pk, child, fk, parent, pk, child, fk
    );
  END LOOP;
END
$$;

-- 6. Korzeń najemcy: salons (izolacja po własnym id przez app.current_salon_id).
ALTER TABLE salons ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_self ON salons;
CREATE POLICY tenant_self ON salons
  USING (id = current_setting('app.current_salon_id', true)::uuid)
  WITH CHECK (id = current_setting('app.current_salon_id', true)::uuid);

-- Świadomie BEZ polityki tenant (ADR 3.3): user/session/account/verification
-- (Better Auth), subscription_plans (cennik globalny), temporary_access,
-- push_subscriptions (FK do user, nie salon). NIE włączamy na nich RLS.

COMMIT;
```

**Świadoma decyzja o rolach łączeniowych:** rola łączeniowa aplikacji **pozostaje rolą owner** (z `DATABASE_URL`). `myhelper_app` jest rolą docelową `SET ROLE`, nie loginem (sekcja 1). `GRANT myhelper_app TO current_user` (krok 3) jest tym, co pozwala `SET LOCAL ROLE myhelper_app` w `repository.ts:76` zadziałać. Gdyby kiedyś przejść na osobny login aplikacji — owner-bypass ścieżek systemowych trzeba by rozwiązać inaczej (poza zakresem tego wdrożenia).

---

## 4. Weryfikacja

### PRZED (read-only, bezpieczne — krok 3 sekwencji, można na prod bez sign-offu jako diagnostyka)

```sql
-- Czy rola już istnieje (idempotencja)?
SELECT rolname, rolbypassrls, rolcanlogin FROM pg_roles WHERE rolname='myhelper_app';
-- Kto jest ownerem tabel (rola łączeniowa = ta)?
SELECT tableowner, count(*) FROM pg_tables WHERE schemaname='public' GROUP BY 1;
-- Wszystkie tabele z kolumną salon_id — porównaj z listą 26 z sekcji 3 (czy nic nie brakuje).
SELECT table_name FROM information_schema.columns
WHERE table_schema='public' AND column_name='salon_id' ORDER BY 1;
```

### PO migracji DB (krok 5 — przed deployem kodu)

```sql
-- (a) Rola istnieje i NIE ma BYPASSRLS (twarda asercja jak w rls-tenant.test.ts).
SELECT rolbypassrls FROM pg_roles WHERE rolname='myhelper_app';  -- musi być false

-- (b) Ile tabel ma RLS włączony i policy tenant_isolation/tenant_self.
SELECT relname FROM pg_class WHERE relrowsecurity=true ORDER BY 1;     -- ~39 tabel
SELECT tablename, policyname FROM pg_policies WHERE schemaname='public' ORDER BY 1;

-- (c) Owner widzi wszystko (ENABLE-not-FORCE) — kontrola różnicująca.
SELECT count(*) FROM clients;   -- > 0, owner omija RLS

-- (d) Rola app Z kontextem widzi tylko jeden salon; BEZ kontekstu — 0 wierszy.
BEGIN;
  SET LOCAL ROLE myhelper_app;
  -- bez set_config: kontekst pusty -> RLS odcina wszystko
  SELECT count(*) AS bez_kontekstu FROM clients;        -- = 0
  SELECT set_config('app.current_salon_id', '<UUID-ISTNIEJĄCEGO-SALONU>', true);
  SELECT count(*) AS z_kontekstem  FROM clients;        -- = liczba klientów TEGO salonu
  -- próba sięgnięcia cudzego salonu = 0
  SELECT set_config('app.current_salon_id', '<UUID-INNEGO-SALONU>', true);
  SELECT count(*) AS cudzy_salon   FROM clients;        -- powinno odzwierciedlać TYLKO tamten salon
ROLLBACK;  -- nic nie zmieniamy, to tylko odczyt
```

### SMOKE (krok 7 — po deployu kodu, na żywym prod, minimalny ruch)

- Zalogowany właściciel salonu A: GET listy klientów → widzi swoich, kod 200.
- Próba `GET /api/clients/<uuid-klienta-salonu-B>` jako A → **404** (nie 403; ADR 2.4).
- Płatność testowa Stripe (lub replay zdarzenia `invoice.paid` na staging) → `subscription_payments` przyrasta (webhook pod ownerem omija RLS — dowód, że ścieżka systemowa nie padła).
- Jeden cron (`publish-scheduled-posts` na staging) → przetwarza wszystkie salony (cross-tenant pod ownerem działa).
- Logi: zero `role "myhelper_app" does not exist`, zero `permission denied`.

Idealnie: odtworzyć `__tests__/integration/rls-tenant.test.ts` wskazując `POSTGRES_URL` na **staging** (nie prod — guard `setup-real-db.ts` blokuje nie-localhost, więc na staging trzeba świadomie obejść guard w osobnym, jawnym przebiegu lub uruchomić równoważne zapytania ręcznie z bloku „PO (d)").

---

## 5. Rollback (bez utraty danych)

RLS i role **nie zmieniają danych** — rollback jest czysto strukturalny i bezpieczny.

**Scenariusz A — problem WYKRYTY przed/podczas kroku 4 (transakcja jeszcze otwarta):** `ROLLBACK;` całego bloku z sekcji 3. Stan bazy bez śladu. To dlatego SQL jest w jednej transakcji.

**Scenariusz B — problem po kroku 4, przed deployem kodu (krok 6):** stary kod nadal działa (jedzie ownerem, omija RLS). Można zostawić RLS założony (jest przezroczysty dla ownera) albo zdjąć:

```sql
BEGIN;
-- Zdejmij policies + wyłącz RLS na wszystkich tabelach, które dostały RLS.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT tablename FROM pg_policies
           WHERE schemaname='public' AND policyname IN ('tenant_isolation','tenant_self')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I;', r.tablename);
    EXECUTE format('DROP POLICY IF EXISTS tenant_self ON %I;', r.tablename);
    EXECUTE format('ALTER TABLE %I DISABLE ROW LEVEL SECURITY;', r.tablename);
  END LOOP;
END $$;
COMMIT;
-- Rolę można zostawić (nieszkodliwa) albo: REVOKE ... ; DROP ROLE myhelper_app;
-- DROP ROLE wymaga wcześniej REVOKE wszystkich GRANT-ów i DROP OWNED BY myhelper_app.
```

**Scenariusz C — problem po deployu kodu (krok 6+):** **najpierw rewert deployu** (Vercel: promote poprzedniego deploymentu — nowy kod, który woła `SET LOCAL ROLE`, znika). Stary kod jedzie ownerem, działa niezależnie od RLS. Dopiero potem, spokojnie, zdejmij RLS jak w scenariuszu B. **Kolejność rollbacku jest odwrotna do wdrożenia: najpierw kod, potem DB** — bo dopóki nowy kod żyje, potrzebuje roli `myhelper_app`; usunięcie roli przed rewertem kodu samo wywoła outage.

**Klucz bezpieczeństwa:** filtr aplikacyjny `eq(salonId)` w `forSalon` **nigdy nie jest usuwany** (ADR sekcja 6). Zdjęcie RLS nie odsłania danych — aplikacja nadal filtruje po `salonId`. To trzecia tama defense-in-depth, która chroni w trakcie każdego rollbacku.

---

## 6. Bramki — co wymaga czyjej zgody

| Bramka | Kto | Czego dotyczy |
|---|---|---|
| **Sign-off Darka (Plan Mode)** | Darek (CEO) | Utworzenie roli `myhelper_app` na prod (nowy element infry) + migracja schemy prod (ENABLE RLS + policies). **Dwie czerwone linie, CLAUDE.md sekcja 4.** Bez tego krok 4 nie rusza. |
| **Przegląd domenowy bezpieczeństwa** | Ryan (CRCO, domena 8) | Zakres tabel RLS (czy lista 26+12+salons kompletna wobec prod-schematu), obsługa ścieżek systemowych (webhooki/crony omijają poprawnie), RODO (czy cross-tenant realnie odcięty). Ryan może **zablokować** wdrożenie. |
| **Staging-first** | Ethan + Ryan | **Obowiązkowy.** Kroki 3–7 przechodzą na staging Neon z zielonym wynikiem PRZED tknięciem prod. Brak zielonego stagingu = prod nie rusza. |
| **PoC `SET LOCAL` na poolerze Neon** | Leo | Potwierdzenie, że `SET LOCAL ROLE` + `set_config(...,true)` trzymają się transakcji na pooled endpoincie Neon (PgBouncer transaction mode). ADR sekcja 8 decyzja 4. |
| **Okno obserwacji** | Ethan | 24–48 h monitoringu po deployu; dopiero czyste okno domyka krok. P0 na prod → natychmiastowa eskalacja do Darka (Slack DM). |

---

## 7. Ryzyka — co może pójść nie tak

| # | Ryzyko | Skutek | Mitygacja |
|---|---|---|---|
| R1 | **Deploy kodu przed założeniem roli** (zła kolejność) | `SET LOCAL ROLE myhelper_app` → `role does not exist` → 500 na całym API. **Outage.** | Sekwencja sekcji 2: DB (krok 4) ZAWSZE przed kodem (krok 6). Krok 5 (weryfikacja) bramkuje deploy. |
| R2 | **Rola już istnieje** na prod (z wcześniejszej próby) z innymi uprawnieniami | GRANT-y mogą być niespójne; RLS może odcinać nie to, co trzeba | SQL idempotentny (`IF NOT EXISTS`); blok „PRZED" sekcji 4 wykrywa istniejącą rolę i jej `rolbypassrls` przed wykonaniem. |
| R3 | **Połączenia w puli z błędną/zalegającą rolą** | `SET LOCAL` znika po COMMIT/ROLLBACK, więc rola nie wycieka — ale gdyby transakcja nie domknęła się (długo żyjące połączenie), kolejne żądanie mogłoby dziedziczyć stan | `SET LOCAL` jest transaction-scoped (komentarz `repository.ts:24-28`); `db.transaction` gwarantuje COMMIT/ROLLBACK. Pooler Neon w trybie transaction pooling — PoC Leo (bramka). `idle_timeout: 20`, `max_lifetime` w `db.ts` ograniczają zaleganie. |
| R4 | **Tabela z `salon_id` poza listą 26** (np. nowa migracja od czasu ADR) | RLS jej nie obejmie → cicha dziura cross-tenant na tej tabeli | Blok „PRZED" sekcji 4: `information_schema.columns` listuje WSZYSTKIE tabele z `salon_id` — porównać z listą 26. `RAISE WARNING` w SQL na brakującą tabelę. Ryan weryfikuje zakres (bramka). |
| R5 | **RLS na tabeli bez `salon_id`** (błąd w liście) | Polityka `salon_id = ...` nie skompiluje się lub odetnie wszystko | SQL używa `format` z nazwami z jawnych list (ADR 3.3); tabele pośrednie mają politykę EXISTS (nie odwołują się do nieistniejącego `salon_id`). Tabele Better Auth świadomie pominięte. |
| R6 | **Migrator/`db:migrate` celuje w prod** | Może zastosować niezamierzone różnice schematu poza RLS | **Zakaz** `db:migrate`/`db:push` na prod (sekcja 3). RLS na prod = ręczny SQL w jawnej transakcji, nic więcej. |
| R7 | **`ALTER DEFAULT PRIVILEGES` per-rola-twórca** | Nowa tabela utworzona przez INNĄ rolę niż ta z kroku 3 nie nada DML roli app → przyszła trasa rzuci `permission denied` | Migracje prod muszą jechać pod TĄ SAMĄ rolą owner co krok 3. Po każdej przyszłej migracji dodającej tabelę z `salon_id`: dołożyć `ENABLE RLS` + policy + `GRANT` (checklist w sekcji 3, komentarz). |
| R8 | **Transakcje long-running / wsadowe pod rolą app** | Polityka EXISTS na tabelach pośrednich dokłada subquery do każdego zapytania → koszt w planie | ADR 7: jeśli EXISTS kosztowny — zdenormalizowany `salon_id` (osobny ADR schematu). Monitorować plany zapytań na cronach/raportach w oknie obserwacji. |
| R9 | **Webhook/cron przypadkiem przez `forSalon`** | Pod rolą app bez kontekstu → 0 wierszy / WITH CHECK odrzuca → cicha awaria płatności/przypomnień | ADR sekcja 4: ścieżki systemowe używają surowego `db` (owner), nie `forSalon`. Lint `no-restricted-imports` (warn→error w R3) pilnuje. Smoke krok 7 testuje webhook + cron. |
| R10 | **`salons` (korzeń) — publiczny katalog** | Publiczny odczyt `salons/[id]` przez `unstable_cache` pod ownerem — RLS by go nie dotknął, ale gdyby trafił przez app bez kontekstu → 0 wierszy | Publiczny katalog czyta pod ownerem (omija RLS, ADR 3.3 / komentarz migracji linie 135-145). Smoke: sprawdzić publiczny profil salonu po deployu. |

---

## 8. Self-critique (rola: principal engineer po incydencie cross-tenant na produkcji)

Pięć słabości i co z nimi:

1. **Czy sekwencja naprawdę jest zero-downtime?** Tak, pod jednym warunkiem, który teraz nazwałem wprost: krok 4 (DB) jest wstecznie kompatybilny ze starym kodem **tylko dlatego, że stary kod nie woła `SET LOCAL ROLE`** i jedzie ownerem omijającym RLS (`ENABLE`-not-`FORCE`). Gdyby jakakolwiek istniejąca ścieżka prod już dziś robiła `SET LOCAL ROLE myhelper_app` zanim rola istnieje — założenie pada. Zweryfikowałem: w gałęzi `SET LOCAL ROLE` jest **wyłącznie** w `withSalonContext` (`repository.ts:76`), którego nie ma w kodzie obecnie na prod. Słabość rezydualna: jeśli między napisaniem runbooka a wdrożeniem ktoś doda drugie miejsce z `SET ROLE`, założenie trzeba przeliczyć. Dodałem to do bramki przeglądu.

2. **Czy nie pominąłem tabeli/roli?** Największe realne ryzyko (R4). Lista 26+12+`salons` pochodzi z migracji `0005`, która powstała wobec lokalnego modelu — **prod-schemat może mieć tabele z `salon_id`, których migracja nie zna** (komentarz w `0005` wprost mówi „model lokalny bywa węższy niż schema.ts"). Dlatego blok „PRZED" sekcji 4 listuje WSZYSTKIE kolumny `salon_id` z `information_schema` do porównania, a SQL `RAISE WARNING` na brakującą tabelę zamiast cichego pominięcia. To przesuwa ryzyko z „cicha dziura" na „jawne ostrzeżenie + bramka Ryana". Nie eliminuje całkowicie — wymaga, by ktoś faktycznie porównał listy. Nazwałem to jako działanie człowieka, nie automat.

3. **Czy rollback jest realny?** Tak, i jest bezpieczniejszy niż wdrożenie, bo nie dotyka danych. Dwie rzeczy, które mogłem przeoczyć i poprawiłem: (a) **kolejność rollbacku jest odwrotna** — najpierw rewert kodu, potem zdjęcie roli/RLS, inaczej usunięcie roli pod żywym nowym kodem samo robi outage (scenariusz C). (b) `DROP ROLE` nie zadziała wprost — wymaga `REVOKE` + `DROP OWNED BY`; dlatego rekomenduję **zostawić rolę** (nieszkodliwa) i tylko zdjąć policies. Filtr aplikacyjny `eq(salonId)` zostaje jako siatka w każdym scenariuszu.

4. **Słabość: weryfikacja „PO" na prod modyfikuje rolę bieżącej sesji.** Blok 4(d) robi `SET LOCAL ROLE` w transakcji zakończonej `ROLLBACK` — bezpieczne (nic nie zmienia, `SET LOCAL` znika). Ale wykonujący musi pamiętać o `ROLLBACK`; gdyby zrobił `COMMIT`, nadal nic się nie zmienia (to były same `SELECT`). Ryzyko nieistotne, ale oznaczyłem `ROLLBACK` jawnie. Nie da się tu uszkodzić danych odczytami.

5. **Słabość: nie wykonałem tego na żywym Neon — to projekt, nie dowód.** Runbook opiera się na zachowaniu zweryfikowanym **lokalnie** (test `rls-tenant.test.ts` zielony lokalnie) + wzorcu referencyjnym Neon z pamięci repo (ADR O5). Trzy rzeczy są nadal niepotwierdzone na Neon i dlatego są **bramkami, nie założeniami**: (a) `SET LOCAL` na pooled endpoincie (PoC Leo); (b) czy owner prod ma prawo `CREATE ROLE` i `GRANT ... TO current_user` na Neon (zależy od planu Neon — sprawdzić na staging); (c) czy `ALTER DEFAULT PRIVILEGES` zachowa się jak lokalnie. Staging-first (sekcja 6) istnieje właśnie po to, by te trzy zamienić z niepewności w dowód, zanim ruszy prod. Uczciwa niepewność: dopóki staging nie przejdzie, runbook jest wykonalny-na-papierze, nie dowiedziony.

---

**Następny krok:** przegląd Ryana (zakres + ścieżki systemowe) → staging-first (kroki 3–7 na staging Neon, zielony wynik) → dopiero wtedy sign-off Darka w Plan Mode na prod (rola DB + migracja schemy) → wykonanie kroków 4–8 na prod w oknie niskiego ruchu. RLS na prod pozostaje w statusie „czeka na sign-off Darka" do tego momentu.
