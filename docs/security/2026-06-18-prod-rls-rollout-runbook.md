# Runbook wdrożenia produkcyjnego RLS — izolacja najemców (tenant isolation)

**Status:** Przygotowany — **NIE wykonany.** Czeka na sign-off Darka (Plan Mode) + przegląd domenowy Ryana (CRCO, domena 8 standardu).
**Data:** 2026-06-18
**Autor:** Ethan (CTO)
**Wersja:** v1.2 · 2026-06-18 — **status `ai_generated_media` ROZSTRZYGNIĘTY (ADR-002, Wariant 3 backfill)** — sekcja 3.1 odsyła do decyzji zamiast „Wariant 1 vs 2 do sign-offu"; migracja `0006` przygotowana (idempotentna, nie zaaplikowana na prod); D-RLS-3 i sekcja 9 zaktualizowane. Decyzja Ethana (CTO, mandat techniczny CLAUDE.md sekcja 8). Changelog sekcja 11.
**Wersja:** v1.1 · 2026-06-18 — domknięcie bramek przeglądu Ryana (CRCO, werdykt NEEDS-WORK): F1 twarda asercja zakresu RLS + status `ai_generated_media`; F2 odstępstwo od modelu 2 ról z ADR; F3 wykonalny dowód cross-tenant na staging; F4 granica ochrony RODO + status lintu; F5/F6 dług i poprawka nazwy gałęzi. Changelog na końcu (sekcja 11).
**Dotyczy:** `Danolog/My_Helper_2` @ `main` (warstwa repo + RLS lokalny + migracja `0005` są na `main`; gałąź `feat/repo-layer-rls` była wmergowana — historyczna nazwa robocza). Baza produkcyjna: Neon (managed PostgreSQL).
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

Kod na `main` (historycznie gałąź robocza `feat/repo-layer-rls`, już wmergowana) wprowadza dwie tamy izolacji salonów: warstwę repozytorium (`forSalon`) i RLS w bazie. **Problem deploymentowy:** kod produkcyjny w `withSalonContext` (`src/lib/server/repository.ts:76`) wykonuje przy **każdej** operacji ścieżki żądania:

```
SET LOCAL ROLE myhelper_app
```

Jeśli na produkcji Neon **nie istnieje rola `myhelper_app`**, to polecenie rzuca błąd `role "myhelper_app" does not exist` — i **każda** trasa API przepuszczona przez `forSalon` zwróci błąd. To znaczy: **sam deploy tej gałęzi na prod bez wcześniejszego założenia roli kładzie produkcję.** Stąd sekwencja w sekcji 2 jest krytyczna i nie podlega skróceniu.

Migracja `0005` tworzy rolę + zakłada RLS **wyłącznie na bazie lokalnej/testowej** (komentarz w pliku, linie 1–7; guard host=localhost w `__tests__/integration/setup-real-db.ts`). Produkcja jest jawnie poza zakresem PR. Wdrożenie na prod dotyka **dwóch czerwonych linii** CLAUDE.md sekcja 4:
1. **Nowy element infrastruktury / rola DB** (`myhelper_app`).
2. **Migracja schemy produkcyjnej** (`ENABLE RLS` + `CREATE POLICY` na ~39 tabelach).

Oba wymagają **sign-offu Darka w Plan Mode** przed wykonaniem. Ten dokument doprowadza pakiet do stanu **wykonalnego-po-sign-offie** — nie wykonuje niczego na prod-bazie.

> **GRANICA OCHRONY RLS — czytaj zanim uznasz izolację za „domkniętą bazą" (F4, RODO).** RLS odcina cross-tenant na poziomie bazy **TYLKO na trasach idących przez `forSalon`** — czyli tam, gdzie `withSalonContext` robi `SET LOCAL ROLE myhelper_app` i ustawia kontekst salonu (rola app egzekwuje politykę). Refaktor R2 jest **częściowy**: na 2026-06-18 **68 tras** używa `forSalon`, a **99 tras** wciąż importuje surowy `db` i jedzie **rolą owner** — owner **omija RLS** przez `ENABLE`-not-`FORCE`. **Na tych ~99 trasach izolacja najemcy opiera się WYŁĄCZNIE na filtrze aplikacyjnym** (`eq(salonId)` wpisanym ręcznie w kodzie trasy) — czyli na tej samej „pamięci programisty", którą RLS miał zastąpić. Konsekwencja RODO: dopóki R2/R3 nie domkną migracji wszystkich tras na `forSalon`, RLS jest **drugą tamą tylko dla zmigrowanej części**; reszta ma jedną tamę (aplikacyjną). Wdrożenie RLS na prod **nie zamyka** ryzyka IDOR/cross-tenant na trasach na surowym `db` — to robi dopiero ukończenie R2 + flip lintu na `error` w R3 (sekcja 9). Ten runbook wdraża **bazę**; nie udaje, że pokrywa wszystkie trasy.

---

## 1. Model ról — kto się łączy, kto egzekwuje (KLUCZOWE do zrozumienia przed SQL)

To jest najczęstsze nieporozumienie przy RLS, więc wprost:

- **Aplikacja łączy się z bazą jako rola OWNER** (ta z `DATABASE_URL`/`POSTGRES_URL`). Na Neon to domyślnie rola właściciela bazy (np. `neondb_owner`). **Rola łączeniowa NIE jest `myhelper_app`.**
- `myhelper_app` to rola `NOLOGIN` — **nikt się nią nie loguje.** Wchodzi się w nią z połączenia ownera przez `SET LOCAL ROLE myhelper_app` (wrapper `forSalon`).
- Żeby owner mógł zrobić `SET ROLE myhelper_app`, owner musi być **członkiem** roli `myhelper_app` — to robi `GRANT myhelper_app TO <owner>` (migracja `0005`, linia 38: `GRANT myhelper_app TO current_user`).
- Dlaczego nie osobny login dla `myhelper_app`? Bo `ENABLE`-not-`FORCE` wymaga, by ścieżki systemowe (migracje, seed, webhooki Stripe/Twilio, 5 cronów) działały pod ownerem i **omijały** RLS. Gdyby aplikacja logowała się bezpośrednio jako `myhelper_app`, ścieżki systemowe straciłyby owner-bypass. Jedna rola łączeniowa (owner) + przełączanie per transakcja = jedna konfiguracja połączenia, dwa zachowania.

**Konsekwencja dla DSN:** `DATABASE_URL`/`POSTGRES_URL` na prod **zostaje bez zmian** (rola owner). Nie tworzymy nowego loginu, nie rotujemy connection stringa. Jedyna zmiana w aplikacji to obecność wrappera (już w kodzie na `main`). To upraszcza wdrożenie i rollback.

### 1.1 Odstępstwo od ADR-001 — model JEDNEJ roli łączeniowej (świadome, F2)

**Ślad audytowy — rozjazd ADR↔runbook nazwany wprost.** ADR-001 (sekcja 3.2 „Wzorzec połączenia — dwie role" i sekcja 5.1 / O2) projektuje **dwie role DB**: `myhelper_app` (runtime, bez BYPASSRLS) **i** `myhelper_migrator` (owner — migracje/seed/ścieżki systemowe), jako dwa osobne loginy z dwoma DSN (`db` vs `dbMigrator`). **Ten runbook świadomie wdraża MODEL JEDNEJ ROLI ŁĄCZENIOWEJ** (owner) + przełączanie na `myhelper_app` przez `SET LOCAL ROLE` per transakcja. To **odstępstwo od litery ADR** — zapisane tu, by ślad był spójny.

**Dlaczego jedna rola łączeniowa, a nie dwie z ADR:**
- Implementacja w kodzie (`repository.ts:71-81`, `withSalonContext`) poszła ścieżką **`SET LOCAL ROLE` z połączenia ownera** — nie ścieżką dwóch osobnych puli/DSN. To była naprawa W1 z review Ryana ADR (`repository.ts:16-22`): pula loguje się ownerem, a izolację na ścieżce żądania daje przełączenie roli w transakcji. `myhelper_migrator` jako **osobny login** nie powstał — jego funkcję (owner omijający RLS dla migracji/seed/webhooków/cronów) pełni ta sama rola łączeniowa owner.
- `myhelper_app` istnieje (rola `NOLOGIN`, cel `SET ROLE`), ale **nie jako login** — różnica wobec ADR 3.2, gdzie `db` miało łączyć się bezpośrednio jako `myhelper_app`.
- Korzyść: jedna konfiguracja połączenia, jeden DSN, brak rotacji connection stringa na prod, prostszy rollback (sekcja 5). Koszt: izolacja na ścieżce żądania zależy od tego, że `withSalonContext` **zawsze** robi `SET LOCAL ROLE` — gdyby ktoś dodał zapytanie ścieżki żądania poza wrapperem na surowym `db`, jechałoby ownerem (RLS przezroczysty). To pilnuje lint `no-restricted-imports` (sekcja 9) + filtr aplikacyjny jako trzecia tama.

**Decyzja do domknięcia śladu (do sign-offu Darka łącznie z wdrożeniem):** model jednej roli jest stanem faktycznym kodu i ZOSTAJE. **Akcja:** zaktualizować ADR-001 sekcję 3.2/5.1, by opisywała model jednej roli + `SET LOCAL ROLE` (a nie dwóch loginów), albo zostawić ADR jako zapis pierwotnego projektu z adnotacją „zrealizowano wariantem jednej roli — patrz runbook 1.1". Rekomendacja Ethana: **adnotacja w ADR** (ADR to zapis decyzji w czasie; runbook 1.1 jest źródłem prawdy o wdrożeniu). Edycja ADR poza tym PR — `agents/*.md`/governance bez zmian; ADR to nie czerwona linia, ale wymaga osobnego, czystego commitu dokumentacyjnego.

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

-- =========================================================================
-- 7. TWARDA BRAMKA ZAKRESU (F1) — ZATRZYMUJE WDROŻENIE, nie ostrzega.
--    Asercja: każda istniejąca tabela z kolumną salon_id MUSI mieć politykę
--    tenant_isolation, a salons MUSI mieć tenant_self. Inaczej RAISE EXCEPTION
--    => cała transakcja ROLLBACK => prod nietknięty. To zamienia „cichą dziurę
--    cross-tenant na nowej tabeli" (R4) z ostrzeżenia w twardy STOP wdrożenia.
--    Wykonuje się PO założeniu wszystkich polityk, PRZED COMMIT.
-- =========================================================================
DO $$
DECLARE
  -- Tabele z bezpośrednim salon_id, które ŚWIADOMIE są poza tenant-RLS (ADR 3.3).
  -- salon_id mają, ale izolacja idzie inną drogą albo nie dotyczy najemcy.
  -- (Na dziś: PUSTA — wszystkie tabele z salon_id dostają politykę. Jeśli
  --  kiedyś świadomie wyłączysz którąś, DOPISZ ją tu z uzasadnieniem, inaczej
  --  asercja ją wychwyci jako brakującą i zatrzyma wdrożenie.)
  intentionally_excluded text[] := ARRAY[]::text[];
  missing text[];
BEGIN
  -- (a) Tabele z kolumną salon_id BEZ polityki tenant_isolation, pomijając
  --     świadomie wyłączone i samą tabelę salons (ma tenant_self, nie tenant_isolation).
  SELECT array_agg(c.table_name ORDER BY c.table_name) INTO missing
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.column_name = 'salon_id'
    AND c.table_name <> 'salons'
    AND c.table_name <> ALL (intentionally_excluded)
    AND NOT EXISTS (
      SELECT 1 FROM pg_policies p
      WHERE p.schemaname = 'public'
        AND p.tablename = c.table_name
        AND p.policyname = 'tenant_isolation'
    );

  IF missing IS NOT NULL AND array_length(missing, 1) > 0 THEN
    RAISE EXCEPTION
      'PROD RLS STOP (F1): tabele z salon_id BEZ polityki tenant_isolation: %. '
      'Cross-tenant byłby otwarty. Dopisz je do list w krokach 4/5 ALBO do '
      'intentionally_excluded z uzasadnieniem. Wdrożenie przerwane (ROLLBACK).',
      array_to_string(missing, ', ');
  END IF;

  -- (b) salons MUSI mieć tenant_self (korzeń najemcy).
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='salons' AND policyname='tenant_self'
  ) THEN
    RAISE EXCEPTION 'PROD RLS STOP (F1): salons bez polityki tenant_self. ROLLBACK.';
  END IF;

  RAISE NOTICE 'PROD RLS OK (F1): wszystkie tabele z salon_id mają tenant_isolation, salons ma tenant_self.';
END
$$;

COMMIT;
```

> **Bramka F1 — co dokładnie egzekwuje asercja:** liczba tabel z polityką `tenant_isolation` **musi pokrywać** zbiór wszystkich istniejących tabel z kolumną `salon_id` (minus `salons`, która ma `tenant_self`, minus świadomie wyłączone — dziś lista pusta). Jeśli prod-schemat ma tabelę z `salon_id`, której nie zna `0005` (dryf schematu, ryzyko R4), asercja **rzuca `RAISE EXCEPTION`** i cała transakcja robi `ROLLBACK` — prod zostaje nietknięty. To **twarda bramka**, nie `RAISE WARNING` z wcześniejszej wersji. `RAISE WARNING` w pętlach kroków 4/5 (tabela na liście, ale nie istnieje na prod) **zostaje** jako sygnał diagnostyczny — to inny przypadek (lista szersza niż schemat, nie odwrotnie), nieszkodliwy dla izolacji.

### 3.1 Status `ai_generated_media` — dryf schematu, decyzja do sign-offu (F1)

**Fakt stwierdzony:** tabela `ai_generated_media` jest zdefiniowana w `src/lib/schema.ts:816-841` (`salon_id NOT NULL`, ma indeks `ai_generated_media_salon_id_idx`) i figuruje na liście `direct_tables` migracji `0005` oraz w tym runbooku (krok 4, 26 tabel). **ALE żadna migracja `0000`–`0004` jej nie tworzy** — zweryfikowane: `grep -rn ai_generated_media drizzle/*.sql` zwraca tylko `0005` (lista RLS), zero `CREATE TABLE ai_generated_media`. To **ten sam typ dryfu** co niezaaplikowana `0005`: `schema.ts` (model docelowy) jest szerszy niż zastosowane migracje.

**DECYZJA PODJĘTA — ADR-002 (Ethan, CTO, mandat decyzji technicznej; nie „opcje do sign-offu", lecz rozstrzygnięcie).** Pełne dowody i uzasadnienie: `docs/adr/ADR-002-dryf-schematu-ai-generated-media.md`. W skrócie:

- **Stan faktyczny (dowody, nie założenie):** tabela jest **UŻYWANA przez żywą funkcję AI media** (4 trasy API: `ai/video/{generate,status,story}`, `ai/usage` + UI `video-generator`/`story-generator`) — więc **Wariant 1 (martwy kod) odpada**. Dryf powstał przez `db:push` z pominięciem migracji: `schema.ts` ma tabelę, `drizzle-kit generate` jej nie zna (0 w snapshotach), a CI quality-gate buduje bazę przez `db:push` (`.github/workflows/quality-gate.yml:92,:160`). Prod build (`build:ci` = `next build`) nie odpala migrate/push.
- **Decyzja: Wariant 3 (backfill / pojednanie historii), idempotentny.** Skoro funkcja jest zbudowana i wpięta, a jedyny mechanizm tworzący tę tabelę to `db:push`, na prod **najpewniej ISTNIEJE** (powstała push-em) — wtedy ślepy `CREATE TABLE` z Wariantu 2 wywróciłby się na „relation already exists". Migracja **`drizzle/0006_ai_generated_media_catchup.sql`** (`CREATE TABLE IF NOT EXISTS` + FK/indeksy idempotentnie + warunkowa polityka RLS, jeśli rola `myhelper_app` istnieje) jest **poprawna w OBU stanach prod**: jest = czysty backfill (no-op), nie ma = tworzy. Status pliku: **PRZYGOTOWANA, NIE ZAAPLIKOWANA NA PROD** — zastosowanie = czerwona linia, sign-off Darka.
- **Jedna niewiadoma (nie mam dostępu do prod) → jedno read-only pytanie, nie przerzucanie decyzji:** `SELECT to_regclass('public.ai_generated_media');` — nazwa = istnieje (czysty Wariant 3), `NULL` = `0006` ją utworzy. Wynik = artefakt do bramki/przeglądu Ryana.
- **Zachowanie SQL runbooka bez zmian i nadal bezpieczne:** jeśli tabeli nie ma w chwili kroku 4 — pętla `IF NOT EXISTS ... CONTINUE` ją pomija (`RAISE WARNING`); asercja F1 (krok 7) sprawdza tylko tabele **istniejące**, więc nie rzuci fałszywego `EXCEPTION`. Kolejność: `0006` **przed** RLS, jeśli tabeli na prod nie ma.

**Domknięcie śladu (dług D-RLS-3):** szerszy rozjazd `schema.ts` ↔ migracje (ten sam typ dryfu dotyczy też FK `appointment_materials`/`fiscal_receipts` i indeksu `clients_birthday` — `0006` pojednuje je idempotentnie) oraz reforma workflow „migracje vs `db:push`" (żeby CI i prod nie rozjeżdżały się znowu) — patrz ADR-002 sekcja 5.4. Asercja F1 chroni izolację niezależnie od tego, kiedy dług workflow zostanie spłacony.

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

-- F1 (read-only podgląd asercji): ile tabel z salon_id istnieje na prod i czy
-- któraś jest spoza listy 26 z kroku 4. Jeśli ten zbiór jest większy niż lista
-- runbooka — STOP zanim ruszysz krok 4: twarda asercja (krok 7) i tak przerwie
-- transakcję, ale lepiej wiedzieć z góry. Porównaj wynik z listą direct_tables.
SELECT table_name FROM information_schema.columns
WHERE table_schema='public' AND column_name='salon_id'
  AND table_name NOT IN (
    'salons','clients','employees','service_categories','services','appointments',
    'gallery_photos','albums','reviews','notifications','waiting_list',
    'product_categories','products','promotions','promo_codes','loyalty_points',
    'invoices','newsletters','marketing_consents','favorite_salons',
    'salon_subscriptions','subscription_payments','deposit_payments',
    'fiscal_receipts','scheduled_posts','ai_conversations','ai_generated_media'
  )
ORDER BY 1;
-- ^ Pusty wynik = zakres runbooka pokrywa prod. Niepusty = DRYF SCHEMATU (R4):
--   nowa tabela z salon_id, której 0005 nie zna. NIE uruchamiaj kroku 4 — najpierw
--   dopisz tabelę do list kroków 4/5 (albo do intentionally_excluded z uzasadnieniem).
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

-- (d) DOWÓD ODCIĘCIA CROSS-TENANT — dwa salony, oba kierunki (F3).
--     Wymaga DWÓCH istniejących salonów A i B z danymi (na staging: zaseeduj
--     dwa albo użyj dwóch realnych). Dowodzi nie tylko „widzę swoje", ale że
--     baza ODCINA cudze ORAZ ODRZUCA zapis do cudzego (WITH CHECK).
BEGIN;
  SET LOCAL ROLE myhelper_app;

  -- (d.1) Bez kontekstu: RLS odcina wszystko.
  SELECT count(*) AS bez_kontekstu FROM clients;                 -- MUSI = 0

  -- (d.2) Kontekst = salon A: widać TYLKO klientów A, ZERO klientów B.
  SELECT set_config('app.current_salon_id', '<UUID-SALONU-A>', true);
  SELECT count(*) AS a_widzi_swoich FROM clients;                -- = liczba klientów A (>0)
  SELECT count(*) AS a_widzi_obcych_B FROM clients                -- MUSI = 0
    WHERE salon_id = '<UUID-SALONU-B>'::uuid;
  -- Krzyżowo: jawny SELECT po id klienta B z kontekstem A -> 0 wierszy.
  SELECT count(*) AS a_siega_klienta_B FROM clients               -- MUSI = 0
    WHERE id = '<UUID-KLIENTA-SALONU-B>'::uuid;

  -- (d.3) Kontekst = salon B: lustrzane sprawdzenie w drugą stronę.
  SELECT set_config('app.current_salon_id', '<UUID-SALONU-B>', true);
  SELECT count(*) AS b_widzi_swoich FROM clients;                -- = liczba klientów B (>0)
  SELECT count(*) AS b_widzi_obcych_A FROM clients                -- MUSI = 0
    WHERE salon_id = '<UUID-SALONU-A>'::uuid;

  -- (d.4) WITH CHECK: próba wstawienia wiersza do CUDZEGO salonu (A) z kontekstem B
  --       MUSI zostać odrzucona ("new row violates row-level security policy").
  --       Owijamy w savepoint, by błąd nie zerwał całej transakcji odczytowej.
  SAVEPOINT cross_insert;
  INSERT INTO clients (salon_id, first_name, last_name)
    VALUES ('<UUID-SALONU-A>'::uuid, 'CROSS', 'TENANT');          -- MUSI rzucić błąd RLS
  -- Jeśli dotarło tu bez błędu = DZIURA. Cofnij i potraktuj jako STOP.
  ROLLBACK TO SAVEPOINT cross_insert;
ROLLBACK;  -- nic nie zmieniamy, to tylko dowód odczytu/odrzucenia zapisu
```

> **Kryterium zaliczenia dowodu (zrzut do bramki):** `bez_kontekstu=0`, `a_widzi_obcych_B=0`, `a_siega_klienta_B=0`, `b_widzi_obcych_A=0`, oraz INSERT z (d.4) **rzucił** `new row violates row-level security policy`. Każda inna wartość = STOP, eskalacja do Ryana + Darka. Zapisz pełny output (z wartościami count) jako artefakt staging-first.

### SMOKE (krok 7 — po deployu kodu, na żywym prod, minimalny ruch)

- Zalogowany właściciel salonu A: GET listy klientów → widzi swoich, kod 200.
- Próba `GET /api/clients/<uuid-klienta-salonu-B>` jako A → **404** (nie 403; ADR 2.4).
- Płatność testowa Stripe (lub replay zdarzenia `invoice.paid` na staging) → `subscription_payments` przyrasta (webhook pod ownerem omija RLS — dowód, że ścieżka systemowa nie padła).
- Jeden cron (`publish-scheduled-posts` na staging) → przetwarza wszystkie salony (cross-tenant pod ownerem działa).
- Logi: zero `role "myhelper_app" does not exist`, zero `permission denied`.

### DOWÓD CROSS-TENANT NA STAGING (F1/F3 — bramka wykonalna, nie „na papierze")

Staging-first (sekcja 6) jest obowiązkowy. Dowód odcięcia cross-tenant na staging idzie **jedną z dwóch dróg** — obie wykonalne:

**Droga A (preferowana) — automatyczny test `rls-tenant.test.ts` na staging.** Wcześniej guard `setup-real-db.ts` twardo blokował każdy host nie-localhost (i jawnie Neon), więc testu nie dało się puścić na staging bez hakowania. **Naprawione (F3):** guard ma teraz **kontrolowany, wąski opt-in** `RLS_STAGING_HOST`. Uruchomienie na staging:

```bash
# DSN wskazuje staging Neon (osobna baza, NIE prod). Host musi być DOKŁADNIE
# równy wartości RLS_STAGING_HOST — podwójny opt-in. Inny host => guard STOP.
export POSTGRES_URL='postgres://...@ep-staging-xxx.eu-central-1.aws.neon.tech/...'
export RLS_STAGING_HOST='ep-staging-xxx.eu-central-1.aws.neon.tech'
export MYHELPER_APP_DB_ROLE='myhelper_app'
npx vitest run --config vitest.integration.config.ts __tests__/integration/rls-tenant.test.ts
```

Test napędza **produkcyjny wrapper `forSalon`** (`SET LOCAL ROLE myhelper_app` + kontekst), pyta bazę BEZ filtra aplikacyjnego i dowodzi: kontekst A widzi tylko A, sięgnięcie po wiersz B → 0 wierszy, owner widzi oba (kontrola różnicująca), rola `myhelper_app` bez BYPASSRLS, webhook pod ownerem zapisuje a rola app bez kontekstu jest odrzucana przez `WITH CHECK`. **Zielony wynik na staging = dowód odcięcia cross-tenant.** Zachowaj log przebiegu jako artefakt bramki.

> **Granica bezpieczeństwa furtki:** `RLS_STAGING_HOST` przepuszcza **dokładnie jeden** nazwany host i tylko gdy zmienna jest ustawiona; domyślnie guard nadal jest localhost-only i blokuje Neon. **NIGDY nie wskazuj tu hosta produkcyjnego** — to okno na staging (bliźniacza, odrębna baza). Prod RLS = ręczny SQL po sign-offie Darka (sekcja 3), nigdy przez test.

**Droga B (fallback, gdy A niewykonalna) — ręczne zapytania z udokumentowanym zrzutem.** Jeśli staging nie da się podpiąć pod test (np. brak runnera), bramką są zapytania PO(d) + SMOKE wykonane ręcznie na staging, z **zapisanym zrzutem wyniku** dołączonym do bramki. Zapytania PO(d) poniżej są rozbudowane tak, by **realnie dowodziły odcięcia** (dwa salony, krzyżowe sprawdzenie w obu kierunkach), nie tylko „widzę swoje".

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
| **Przegląd domenowy bezpieczeństwa** | Ryan (CRCO, domena 8) | Zakres tabel RLS (czy lista 26+12+salons kompletna wobec prod-schematu), obsługa ścieżek systemowych (webhooki/crony omijają poprawnie), RODO (czy cross-tenant realnie odcięty + granica F4: ~99 tras na surowym `db` poza RLS). Ryan może **zablokować** wdrożenie. |
| **Twarda asercja zakresu (F1)** | automat SQL (krok 7) | `RAISE EXCEPTION` + `ROLLBACK`, gdy jakakolwiek istniejąca tabela z `salon_id` nie ma `tenant_isolation` (albo `salons` bez `tenant_self`). Nie da się wdrożyć RLS z luką w zakresie — bramka maszynowa, nie ludzka. |
| **Staging-first + dowód cross-tenant (F3)** | Ethan + Ryan | **Obowiązkowy.** Kroki 3–7 na staging Neon z zielonym wynikiem PRZED tknięciem prod. Dowód odcięcia: test `rls-tenant.test.ts` przez `RLS_STAGING_HOST` (droga A) albo ręczne zapytania PO(d) dwukierunkowe + WITH CHECK z zapisanym zrzutem (droga B) — sekcja 4. Brak zielonego dowodu = prod nie rusza. |
| **PoC `SET LOCAL` na poolerze Neon** | Leo | Potwierdzenie, że `SET LOCAL ROLE` + `set_config(...,true)` trzymają się transakcji na pooled endpoincie Neon (PgBouncer transaction mode). ADR sekcja 8 decyzja 4. |
| **Okno obserwacji** | Ethan | 24–48 h monitoringu po deployu; dopiero czyste okno domyka krok. P0 na prod → natychmiastowa eskalacja do Darka (Slack DM). |

---

## 7. Ryzyka — co może pójść nie tak

| # | Ryzyko | Skutek | Mitygacja |
|---|---|---|---|
| R1 | **Deploy kodu przed założeniem roli** (zła kolejność) | `SET LOCAL ROLE myhelper_app` → `role does not exist` → 500 na całym API. **Outage.** | Sekwencja sekcji 2: DB (krok 4) ZAWSZE przed kodem (krok 6). Krok 5 (weryfikacja) bramkuje deploy. |
| R2 | **Rola już istnieje** na prod (z wcześniejszej próby) z innymi uprawnieniami | GRANT-y mogą być niespójne; RLS może odcinać nie to, co trzeba | SQL idempotentny (`IF NOT EXISTS`); blok „PRZED" sekcji 4 wykrywa istniejącą rolę i jej `rolbypassrls` przed wykonaniem. |
| R3 | **Połączenia w puli z błędną/zalegającą rolą** | `SET LOCAL` znika po COMMIT/ROLLBACK, więc rola nie wycieka — ale gdyby transakcja nie domknęła się (długo żyjące połączenie), kolejne żądanie mogłoby dziedziczyć stan | `SET LOCAL` jest transaction-scoped (komentarz `repository.ts:24-28`); `db.transaction` gwarantuje COMMIT/ROLLBACK. Pooler Neon w trybie transaction pooling — PoC Leo (bramka). `idle_timeout: 20`, `max_lifetime` w `db.ts` ograniczają zaleganie. |
| R4 | **Tabela z `salon_id` poza listą 26** (np. nowa migracja od czasu ADR / dryf `schema.ts`↔migracje, jak `ai_generated_media` — sekcja 3.1) | RLS jej nie obejmie → cicha dziura cross-tenant na tej tabeli | **TWARDA BRAMKA F1 (sekcja 3, krok 7):** asercja `RAISE EXCEPTION` + `ROLLBACK`, gdy istnieje tabela z `salon_id` bez `tenant_isolation`. Cicha dziura zamieniona w STOP wdrożenia — nie da się wdrożyć RLS z luką w zakresie. Dodatkowo: read-only podgląd w bloku „PRZED" (różnica list przed krokiem 4) + przegląd zakresu Ryana (bramka sekcja 6). |
| R5 | **RLS na tabeli bez `salon_id`** (błąd w liście) | Polityka `salon_id = ...` nie skompiluje się lub odetnie wszystko | SQL używa `format` z nazwami z jawnych list (ADR 3.3); tabele pośrednie mają politykę EXISTS (nie odwołują się do nieistniejącego `salon_id`). Tabele Better Auth świadomie pominięte. |
| R6 | **Migrator/`db:migrate` celuje w prod** | Może zastosować niezamierzone różnice schematu poza RLS | **Zakaz** `db:migrate`/`db:push` na prod (sekcja 3). RLS na prod = ręczny SQL w jawnej transakcji, nic więcej. |
| R7 | **`ALTER DEFAULT PRIVILEGES` per-rola-twórca** | Nowa tabela utworzona przez INNĄ rolę niż ta z kroku 3 nie nada DML roli app → przyszła trasa rzuci `permission denied` | Migracje prod muszą jechać pod TĄ SAMĄ rolą owner co krok 3. Po każdej przyszłej migracji dodającej tabelę z `salon_id`: dołożyć `ENABLE RLS` + policy + `GRANT` (checklist w sekcji 3, komentarz). |
| R8 | **Transakcje long-running / wsadowe pod rolą app** | Polityka EXISTS na tabelach pośrednich dokłada subquery do każdego zapytania → koszt w planie | ADR 7: jeśli EXISTS kosztowny — zdenormalizowany `salon_id` (osobny ADR schematu). Monitorować plany zapytań na cronach/raportach w oknie obserwacji. |
| R9 | **Webhook/cron przypadkiem przez `forSalon`** | Pod rolą app bez kontekstu → 0 wierszy / WITH CHECK odrzuca → cicha awaria płatności/przypomnień | ADR sekcja 4: ścieżki systemowe używają surowego `db` (owner), nie `forSalon`. Lint `no-restricted-imports` (dziś `warn`, docelowo `error` w R3 — patrz sekcja 8) sygnalizuje. Smoke krok 7 testuje webhook + cron. |
| R10 | **`salons` (korzeń) — publiczny katalog** | Publiczny odczyt `salons/[id]` przez `unstable_cache` pod ownerem — RLS by go nie dotknął, ale gdyby trafił przez app bez kontekstu → 0 wierszy | Publiczny katalog czyta pod ownerem (omija RLS, ADR 3.3 / komentarz migracji linie 135-145). Smoke: sprawdzić publiczny profil salonu po deployu. |

---

## 8. Status lintu `no-restricted-imports` i dług strukturalny (F4/F5)

### 8.1 Lint `error` ŚWIADOMIE odłożony do R3 (F4)

Ryan (CRCO) chce regułę `no-restricted-imports` na imporcie `db` na poziomie **`error`** (łamie CI), nie `warn`. **Stan faktyczny blokuje flip TERAZ:** 99 tras w `src/app/api/**` wciąż importuje surowy `db` (refaktor R2 częściowy — 68 tras zmigrowanych na `forSalon`). Podniesienie na `error` natychmiast wywaliłoby `pnpm lint` → quality-gate CI na 99 plikach. To **nie domknięcie długu — to zablokowanie repo** (żaden PR nie przejdzie CI).

**Decyzja (Ethan, świadoma):** lint zostaje `warn` **do PR domykającego R3**. Rozważyłem ograniczenie `error` tylko do tras już zmigrowanych — **odrzucone**: wymagałoby utrzymywania w `eslint.config.mjs` jawnej listy 68 ścieżek (albo wzorca `ignores` na 99 pozostałych), która rozjeżdża się przy każdej migracji paczki R2 i daje fałszywe poczucie pokrycia; ESLint flat config nie ma czystego sposobu „error dla zbioru plików już niełamiących reguły" bez ręcznej, kruchej enumeracji. `warn` na całym `src/app/api/**` jest uczciwszym sygnałem: pokazuje **wszystkie** 99 naruszeń w review, nie psując CI.

**Plan przejścia na `error` (zapisany, mierzalny):**
1. **R2** — migracja pozostałych 99 tras na `forSalon` paczkami ~10, każda paczka z rozszerzeniem testu izolacji. Po każdej paczce liczba importów `db` w `src/app/api/**` spada (mierzalne: `grep -rln 'from "@/lib/db"' src/app/api --include='*.ts' | grep -v .test.ts | wc -l`).
2. **R3 (PR domykający)** — gdy licznik = 0 (poza zadeklarowanymi wyjątkami systemowymi: webhooki/cron/seed z jawnym `eslint-disable` + komentarzem), flip reguły z `warn` na `error` w `eslint.config.mjs`. Od tego momentu nowa trasa z `import { db }` nie wejdzie na `main`.

Komentarz w `eslint.config.mjs` (blok `files: ["src/app/api/**/*.ts"]`) zapisuje to samo przy kodzie — żeby ktoś czytający config widział, że `warn` jest świadome, nie zapomniane.

### 8.2 Jawny dług strukturalny — tabele poza modelem tenant-RLS (F5)

Zapisane wprost jako dług do spłaty, nie ukryte założenie (ADR-001 sekcja 3.3 sygnalizował; tu domknięte jako lista):

| Dług | Co | Ryzyko | Status / plan |
|---|---|---|---|
| **D-RLS-1** | `temporary_access`, `push_subscriptions` — **bez kolumny `salon_id`**, FK do `user.id`, świadomie **poza tenant-RLS** | Jeśli kiedyś trafią na ścieżkę żądania przez `forSalon` — `SalonScoped` (TypeScript) je odrzuci (brak `.salonId`), ale przez surowy `db` nie ma ochrony bazy; izolacja zależy od logiki auth po `user_id` | Świadomie poza RLS w tym wdrożeniu. Jeśli wymagają izolacji — RLS po `user_id` (inny model niż tenant) w osobnym ADR. |
| **D-RLS-2** | **Założenie „1 user = 1 salon" NIE jest zapisane** w schemacie ani egzekwowane | `temporary_access`/`push_subscriptions` izolowane po `user_id` są tożsame z izolacją po salonie **tylko jeśli** user należy do jednego salonu. Gdyby model się zmienił (user w wielu salonach) — założenie pęka cicho | Dług do formalizacji: albo constraint w schemacie, albo jawny ADR przyjmujący „1 user = 1 salon" jako kontrakt. Ryan: wskazać przy przeglądzie zakresu. |
| **D-RLS-3** | Dryf `schema.ts` ↔ migracje (`ai_generated_media` + FK `appointment_materials`/`fiscal_receipts` + indeks `clients_birthday` w `schema.ts`, brak `CREATE`/`ADD` w `0000`–`0004`; powstały przez `db:push`) | Model docelowy szerszy niż zastosowany schemat — sekcja 3.1 | **ROZSTRZYGNIĘTE — ADR-002 (Wariant 3, backfill).** Migracja `0006` (idempotentna) pojednuje historię; status `ai_generated_media` rozstrzygnięty (sekcja 3.1). Asercja F1 chroni izolację niezależnie. Reforma workflow `db:push`↔migracje (CI quality-gate) = dług resztkowy, ADR-002 sekcja 5.4. |

Te długi **nie blokują** wdrożenia RLS (dotyczą tabel świadomie poza modelem tenant), ale są **policzalne i przypisane** — nie „odkryjemy je po incydencie".

---

## 9. Co WCIĄŻ wymaga sign-offu Darka (niezmienione po v1.1)

Domknięcie bramek F1–F6 **nie zdejmuje żadnej czerwonej linii** — runbook nadal jest „wykonalny-po-sign-offie", nie wykonany:
- **Utworzenie roli `myhelper_app` na prod** + **migracja schemy prod** (ENABLE RLS + policies) — dwie czerwone linie (CLAUDE.md sekcja 4), sign-off Darka w Plan Mode (sekcja 6).
- **Migracja `0006` (`ai_generated_media` catch-up) na prod** — decyzja podjęta (Wariant 3, ADR-002, sekcja 3.1); plik przygotowany i idempotentny, ale **zastosowanie na prod = osobna migracja schemy prod = osobny sign-off Darka**. Poprzedzone jednym read-only `to_regclass` na prod.
- **Aktualizacja ADR-001** o model jednej roli (sekcja 1.1) — osobny commit dokumentacyjny (nie czerwona linia, ale poza tym PR).

---

## 10. Self-critique (rola: principal engineer po incydencie cross-tenant na produkcji)

Pięć słabości i co z nimi:

1. **Czy sekwencja naprawdę jest zero-downtime?** Tak, pod jednym warunkiem, który teraz nazwałem wprost: krok 4 (DB) jest wstecznie kompatybilny ze starym kodem **tylko dlatego, że stary kod nie woła `SET LOCAL ROLE`** i jedzie ownerem omijającym RLS (`ENABLE`-not-`FORCE`). Gdyby jakakolwiek istniejąca ścieżka prod już dziś robiła `SET LOCAL ROLE myhelper_app` zanim rola istnieje — założenie pada. Zweryfikowałem: w gałęzi `SET LOCAL ROLE` jest **wyłącznie** w `withSalonContext` (`repository.ts:76`), którego nie ma w kodzie obecnie na prod. Słabość rezydualna: jeśli między napisaniem runbooka a wdrożeniem ktoś doda drugie miejsce z `SET ROLE`, założenie trzeba przeliczyć. Dodałem to do bramki przeglądu.

2. **Czy nie pominąłem tabeli/roli?** Największe realne ryzyko (R4). Lista 26+12+`salons` pochodzi z migracji `0005`, która powstała wobec lokalnego modelu — **prod-schemat może mieć tabele z `salon_id`, których migracja nie zna**. W v1.0 polegałem na `RAISE WARNING` + ręcznym porównaniu list — to było za słabe (warning nie zatrzymuje wdrożenia, a porównanie zależało od czujności człowieka). **v1.1 (F1):** dołożyłem **twardą asercję** (krok 7) — `RAISE EXCEPTION` + `ROLLBACK`, gdy jakakolwiek istniejąca tabela z `salon_id` nie ma `tenant_isolation`. Ryzyko przesunięte z „cicha dziura / zależne od człowieka" na „maszynowy STOP wdrożenia". Asercja sprawdza tabele **istniejące** w `information_schema`, więc dryf w drugą stronę (`ai_generated_media` na liście, ale nieobecna na prod — sekcja 3.1) nie wywoła fałszywego `EXCEPTION`. Rezydualnie: asercja chroni izolację, ale nie zastępuje przeglądu Ryana co do *celowości* zakresu (czy któraś tabela powinna być świadomie wyłączona).

3. **Czy rollback jest realny?** Tak, i jest bezpieczniejszy niż wdrożenie, bo nie dotyka danych. Dwie rzeczy, które mogłem przeoczyć i poprawiłem: (a) **kolejność rollbacku jest odwrotna** — najpierw rewert kodu, potem zdjęcie roli/RLS, inaczej usunięcie roli pod żywym nowym kodem samo robi outage (scenariusz C). (b) `DROP ROLE` nie zadziała wprost — wymaga `REVOKE` + `DROP OWNED BY`; dlatego rekomenduję **zostawić rolę** (nieszkodliwa) i tylko zdjąć policies. Filtr aplikacyjny `eq(salonId)` zostaje jako siatka w każdym scenariuszu.

4. **Słabość: weryfikacja „PO" na prod modyfikuje rolę bieżącej sesji.** Blok 4(d) robi `SET LOCAL ROLE` w transakcji zakończonej `ROLLBACK` — bezpieczne (nic nie zmienia, `SET LOCAL` znika). Ale wykonujący musi pamiętać o `ROLLBACK`; gdyby zrobił `COMMIT`, nadal nic się nie zmienia (to były same `SELECT`). Ryzyko nieistotne, ale oznaczyłem `ROLLBACK` jawnie. Nie da się tu uszkodzić danych odczytami.

5. **Słabość: nie wykonałem tego na żywym Neon — to projekt, nie dowód.** Runbook opiera się na zachowaniu zweryfikowanym **lokalnie** (test `rls-tenant.test.ts` zielony lokalnie) + wzorcu referencyjnym Neon z pamięci repo (ADR O5). Trzy rzeczy są nadal niepotwierdzone na Neon i dlatego są **bramkami, nie założeniami**: (a) `SET LOCAL` na pooled endpoincie (PoC Leo); (b) czy owner prod ma prawo `CREATE ROLE` i `GRANT ... TO current_user` na Neon (zależy od planu Neon — sprawdzić na staging); (c) czy `ALTER DEFAULT PRIVILEGES` zachowa się jak lokalnie. **v1.1 (F3):** dowód cross-tenant na staging jest teraz **wykonalny** (opt-in `RLS_STAGING_HOST` w guardzie zamiast hakowania) — to zamyka „dowód na papierze". Staging-first (sekcja 6) istnieje po to, by zamienić niepewność w dowód, zanim ruszy prod. Uczciwa niepewność: dopóki staging nie przejdzie zielono, runbook jest wykonalny, ale niedowiedziony na Neon.

6. **Słabość v1.1: poszerzenie furtki guarda to nowa powierzchnia ataku.** Dodanie `RLS_STAGING_HOST` osłabia tamę „test nigdy nie dotknie zdalnej bazy". Zminimalizowałem to: podwójny opt-in (zmienna MUSI nazwać host I host DSN MUSI być mu równy), przepuszczany **dokładnie jeden** host (równość pełna, nie wzorzec), domyślnie wyłączone (localhost-only bez zmian), jawny log gdy aktywne, i wprost zakaz wskazywania prod w nagłówku pliku + runbooku. Rezydualnie: ktoś może wpisać tu host prod świadomie — ale to już jawna, widoczna w env decyzja, nie cicha furtka. Granica RODO (F4) jest osobno nazwana: RLS chroni tylko trasy `forSalon`; ~99 tras na surowym `db` ma jedną tamę (aplikacyjną) do czasu R2/R3 — runbook tego nie ukrywa.

---

## 11. Changelog

**v1.1 · 2026-06-18 — domknięcie bramek przeglądu Ryana (NEEDS-WORK → adres):**
- **F1** (wysokie): twarda bramka zakresu — sekcja 3 krok 7 `RAISE EXCEPTION`+`ROLLBACK` zamiast `RAISE WARNING`; asercja „każda istniejąca tabela z `salon_id` MUSI mieć `tenant_isolation`, `salons` MUSI mieć `tenant_self`". Read-only podgląd w bloku „PRZED" (różnica list). Status `ai_generated_media` rozstrzygnięty (sekcja 3.1): dryf `schema.ts`↔migracje, najpewniej nieobecna na prod, decyzja Wariant 1/2 do sign-offu Darka — migracji prod NIE tworzę (czerwona linia).
- **F2** (średnie): sekcja 1.1 — świadome odstępstwo od modelu 2 ról z ADR-001 (jedna rola łączeniowa owner + `SET LOCAL ROLE`, `myhelper_migrator` jako osobny login nie powstał). Rekomendacja: adnotacja w ADR (osobny commit).
- **F3** (średnie): kontrolowany opt-in `RLS_STAGING_HOST` w `setup-real-db.ts` (wąski, jednohostowy wyjątek guarda) — droga A; rozbudowane dwukierunkowe zapytania PO(d) + WITH CHECK z kryterium zaliczenia — droga B (sekcja 4).
- **F4** (RODO): granica ochrony w sekcji 0 (RLS tylko na trasach `forSalon`; ~99 tras na surowym `db` poza RLS) + sekcja 8.1 — lint `warn` świadomie do R3 (flip na `error` złamałby CI na 99 plikach), plan przejścia. `eslint.config.mjs` komentarz wzmocniony; reguła pozostaje `warn` (CI niezepsute).
- **F5** (niskie): sekcja 8.2 — jawny dług `temporary_access`/`push_subscriptions` poza RLS, niezapisane założenie „1 user=1 salon", dryf schematu.
- **F6** (info): nazwa gałęzi `feat/repo-layer-rls` → `main` (gałąź wmergowana).
- Nowa sekcja 9 (co wciąż wymaga sign-offu Darka), sekcja 10 self-critique +punkt 6.

**v1.2 · 2026-06-18 — status `ai_generated_media` rozstrzygnięty (ADR-002):**
- Sekcja 3.1 przepisana: z „Wariant 1 vs 2 do sign-offu Darka" na **decyzję podjętą — Wariant 3 (backfill)**, z dowodami (tabela żywa: 4 trasy + UI; dryf z `db:push`; CI buduje push-em; prod build bez migrate) i jednym read-only pytaniem `to_regclass`.
- Nowy plik **`drizzle/0006_ai_generated_media_catchup.sql`** — migracja catch-up idempotentna (`CREATE TABLE IF NOT EXISTS` + FK/indeksy + warunkowa polityka RLS). **PRZYGOTOWANA, NIE ZAAPLIKOWANA NA PROD** (czerwona linia, sign-off Darka).
- Nowy **ADR-002** (`docs/adr/ADR-002-dryf-schematu-ai-generated-media.md`) — pełna decyzja, dowody, alternatywy, self-critique.
- D-RLS-3 (sekcja 8.2) i sekcja 9 zaktualizowane do statusu „rozstrzygnięte / przygotowane". Snapshot+journal drizzle pojednane (`0006`).

**v1.0 · 2026-06-18** — pierwsza wersja: sekwencja zero-downtime, SQL prod, weryfikacja, rollback, bramki, 10 ryzyk.

---

**Następny krok:** ponowny przegląd Ryana (czy bramki F1–F6 domknięte) → staging-first (kroki 3–7 na staging Neon; dowód cross-tenant drogą A lub B z zapisanym zrzutem — sekcja 4) → dopiero wtedy sign-off Darka w Plan Mode na prod (rola DB + migracja schemy; + ewentualna migracja `ai_generated_media` jeśli Wariant 2) → wykonanie kroków 4–8 na prod w oknie niskiego ruchu. RLS na prod pozostaje w statusie „czeka na sign-off Darka" do tego momentu. Aktualizacja ADR-001 (sekcja 1.1) — osobny commit dokumentacyjny.
