# ADR-001 — Przegląd bezpieczeństwa RLS (Ryan, CRCO) — sign-off domeny 8

**Recenzent:** Ryan (Chief Risk & Compliance Officer nordsignal) — domena 8 (Security & RLS), sign-off G6.
**Data:** 2026-06-17
**Branch:** `feat/repo-layer-rls` (tip `1d4c62e`)
**Zakres:** Faza R1 ADR-001 — warstwa repozytorium + RLS na bazie LOKALNEJ. Produkcja Neon = osobna czerwona linia.
**Tryb:** read-only. Nie zmieniam kodu, nie merge, nie push. Werdykt + warunki.

> **Żargon (CLAUDE.md sekcja 3):**
> **RLS** (Row-Level Security — baza sama odrzuca cudze wiersze, niezależnie od kodu);
> **rola owner** (właściciel tabel — pod `ENABLE` RLS jej NIE obowiązuje, omija polityki);
> **rola app** (`myhelper_app` — zwykła rola, RLS ją obowiązuje);
> **ścieżka żądania** (kod obsługujący request użytkownika z przeglądarki);
> **ścieżka systemowa** (webhook/cron/seed/migracja — bez zalogowanego właściciela);
> **`SET LOCAL ROLE`** (przełączenie roli na czas jednej transakcji);
> **`_journal.json`** (rejestr migracji Drizzle — `db:migrate` wykonuje TYLKO to, co tu wpisane);
> **defense in depth** (kilka niezależnych tam izolacji).

---

## WERDYKT

### R1 (baza lokalna): **GO-z-warunkami**

Warstwa repozytorium `forSalon` jest dobrze zaprojektowana (fail-fast na pustym `salonId`, automatyczny `eq(salonId)`, kontrakt null→404, lint zakazujący surowego `db`). Filtr aplikacyjny — pierwsza tama — działa i jest dowiedziony testem izolacji 12/12 na żywej bazie. To realna poprawa względem stanu sprzed PR.

**ALE druga tama (RLS) w obecnym kształcie NIE jest egzekwowana na ścieżce żądania ani niezawodnie aplikowana.** Trzy ustalenia blokują uznanie RLS za działającą warstwę. R1 może wejść lokalnie po naprawie W1 i W2 (poniżej). Bez nich PR dostarcza JEDNĄ tamę (filtr aplikacyjny), nie deklarowane „defense in depth" — i nie wolno tego tak opisywać w ADR ani w commit message.

### Produkcja Neon (RLS): **NO-GO** do czasu spełnienia warunków prod (sekcja „Przed prod"). Pozostaje czerwoną linią — sign-off Darka, osobny krok.

---

## Ustalenia z dowodami

### W1 — KRYTYCZNE: ścieżka żądania jedzie rolą owner, omija RLS

`withSalonContext` ustawia tylko kontekst salonu, **nie przełącza roli na `myhelper_app`**:

- `src/lib/server/repository.ts:38-43` — w transakcji wykonywane jest wyłącznie
  `select set_config('app.current_salon_id', ${salonId}, true)`. Brak `SET LOCAL ROLE myhelper_app`.
- `src/lib/db.ts:5,12-18` — jedno połączenie z `POSTGRES_URL`, jedna rola (owner/dev_user). Brak rozdziału `db` (app) / `dbAdmin` (owner) zapowiadanego w ADR sekcja 3.2.

Skutek: każde żądanie użytkownika biegnie pod rolą **owner**, a owner pod `ENABLE`-not-`FORCE` **omija polityki RLS**. Na ścieżce żądania izolację daje WYŁĄCZNIE filtr aplikacyjny `eq(salonId)`. RLS jest martwą literą tam, gdzie miał być „głębszą tamą".

Dowód, że test izolacji tego nie łapie: `__tests__/integration/salon-isolation.test.ts:43,180-182` — handlery napędzane są przez `forSalon` (owner), więc 12/12 dowodzi tamy aplikacyjnej, nie RLS. Jedyny test pod rolą app (`rls-tenant.test.ts:92`) robi `set local role` **ręcznie w teście**, a nie przez kod produkcyjny — czyli testuje politykę, ale NIE testuje ścieżki, którą faktycznie chodzi aplikacja.

**Naprawa (warunek R1):** `withSalonContext` musi wykonać `SET LOCAL ROLE myhelper_app` przed `set_config`, albo `db.ts` musi udostępnić osobne połączenie roli app dla runtime. Inaczej RLS nie istnieje na żadnej realnej ścieżce użytkownika i twierdzenie „defense in depth" jest nieprawdziwe.

### W2 — KRYTYCZNE: migracja `0005` nie jest w `_journal.json` — `db:migrate` jej nie wykona

- Plik `drizzle/0005_rls_tenant_isolation.sql` istnieje.
- `drizzle/meta/_journal.json` kończy się na wpisie `0004_add_composite_indexes` — **brak wpisu `0005`**.
- README testów (`__tests__/integration/README.md:36`) instruuje `drizzle-kit migrate` jako sposób założenia RLS.

To jest dokładnie pułapka znana firmie (pamięć repo „Migracja drizzle musi być w `_journal.json`"): ręcznie pisana migracja spoza journala **cicho się nie wykona**. Efekt: zespół myśli, że RLS jest na bazie, a polityki nigdy nie powstały. Test negatywny (`rls-tenant.test.ts:87-96` — „zero wierszy bez kontekstu") wtedy albo zawiedzie, albo (gdy rola `myhelper_app` też nie istnieje) rzuci na `set local role`. Stan stosowania RLS jest niezweryfikowany i kruchy.

**Naprawa (warunek R1):** wpisać `0005` jako custom migration przez `drizzle-kit generate --custom` (wpis w journalu) i potwierdzić, że `db:migrate` faktycznie wykonuje politykę na czystej bazie — z dowodem (`pg_policies`).

### W3 — DZIURA POKRYCIA: `ai_generated_media` salon-scoped BEZ RLS

ADR draft twierdził „`ai_generated_media` nie istnieje w schemacie" — **to nieprawda**:

- `src/lib/schema.ts:816-843` — tabela istnieje, `salon_id uuid NOT NULL REFERENCES salons` (linia 820-822), własny indeks `salon_id`.
- `drizzle/0005_...sql:41-48` — lista `direct_tables` ma **25** pozycji i `ai_generated_media` w niej NIE MA.

To jedyna tabela z bezpośrednim `salon_id`, która została bez polityki. Schemat ma **26** tabel z `salon_id` (zweryfikowane: `grep -c 'salonId: uuid("salon_id")' = 26`), migracja chroni 25. Dane wrażliwe (prompty, URL-e wygenerowanych mediów salonu) nie dostają drugiej tamy. Realna luka, nie kosmetyka — choć przy W1 cała druga tama i tak nie działa, więc to brak do domknięcia razem z W1/W2.

**Naprawa (warunek R1):** dopisać `ai_generated_media` do `direct_tables`. Po naprawie liczba = 26 direct + 12 indirect + 1 `salons` = **39 polityk** (deklaracja Leo „38" pomijała tę tabelę).

### Co jest POPRAWNE (potwierdzone wobec żywego schematu)

- **Mapowania FK tabel pośrednich — wszystkie 12 poprawne.** Zweryfikowane kolumny: `time_blocks/work_schedules/employee_services/employee_service_prices/employee_commissions.employee_id` → `employees.id`; `service_variants/service_products.service_id` → `services.id`; `appointment_materials/treatment_history.appointment_id` → `appointments.id`; `product_usage.product_id` → `products.id`; `photo_albums.photo_id` → `gallery_photos.id` (`schema.ts:476`); `loyalty_transactions.loyalty_id` → `loyalty_points.id` (`schema.ts:724`). Rozbieżności zgłoszone przez Leo (`loyalty_id`, `photo_id`) są w migracji `0005:74,89` rozwiązane prawidłowo. Polityka `EXISTS` (`0005:105-114`) realnie odcina cudze wiersze (warunkuje istnieniem rodzica o pasującym `salon_id`).
- **Kształt polityk bezpośrednich** (`0005:53-58`): `USING` + `WITH CHECK` na `current_setting('app.current_salon_id', true)::uuid` — chroni odczyt i zapis, `true` zapobiega błędowi przy braku kontekstu (zwraca 0 wierszy). Poprawne.
- **`ENABLE` nie `FORCE`** — świadome i uzasadnione (seed/migracje/webhooki pod ownerem muszą omijać). Nie tworzy luki SAMO W SOBIE; luką jest dopiero W1 (ścieżka żądania też jedzie ownerem — to nie „seed", to runtime).
- **`myhelper_app` NOLOGIN bez BYPASSRLS** (`0005:9-17`) — poprawny zamysł roli app. Problem nie w roli, lecz w tym, że runtime jej nie używa (W1).
- **Kontrakt 404** (`clients/[id]/route.ts:43-50`) i jawny `eslint-disable` z uzasadnieniem dla `account` (`route.ts:8-10`) — wzorcowe; cudzy zasób = 404 zanim weryfikacja hasła (zamyka mikro-wyciek istnienia z O7).
- **Guard host=localhost** (`setup-real-db.ts:62-85`) — solidny, dwuwarstwowy (URL host + wzorzec Neon/AWS/Supabase). Chroni przed przypadkowym RLS na prod. Dobre.

### Punkt 5 zadania — czy testy dowodzą izolacji czy pozorują?

- **Test izolacji 12/12** (`salon-isolation.test.ts`): dowodzi RZETELNIE **filtra aplikacyjnego** (realne handlery, realny cookie sesji, realny SQL, asercje że dane B nietknięte). NIE dowodzi RLS (handlery jadą ownerem — W1).
- **`rls-tenant` 4 przypadki**: częściowo pozorują. Test „zero wierszy bez kontekstu" (`:87`) i „kontekst A widzi tylko A" (`:98`) ustawiają rolę app **ręcznie w teście** (`set local role`), a nie przez kod produkcyjny — dowodzą, że polityka SQL działa, gdy ktoś wejdzie w rolę app, ale aplikacja w nią nie wchodzi (W1). Test webhooka (`:118`) dowodzi tylko, że owner zapisuje płatność — ale owner zapisuje ZAWSZE (omija RLS), więc to słaby dowód: przeszedłby identycznie nawet gdyby RLS w ogóle nie istniało. Wszystkie 4 przejdą lub wywrócą się zależnie od W2 (czy polityki w ogóle założone).

**Wniosek:** testy nie pozorują filtra aplikacyjnego (ten jest solidny), ale **dają złudne poczucie, że RLS chroni ścieżkę żądania** — a nie chroni. To groźniejsze niż brak testu, bo usypia czujność.

---

## Warunki

### Przed mergem R1 (lokalnie) — wszystkie trzy twarde:

1. **W1** — `withSalonContext` przełącza rolę na `myhelper_app` na ścieżce żądania (albo osobne połączenie roli app w `db.ts`). Dowód: test izolacji przechodzi z handlerami jadącymi rolą app, oraz nowy przypadek — owner-bypass odcięty na ścieżce request.
2. **W2** — `0005` wpisana do `_journal.json` (custom generate), `db:migrate` realnie zakłada polityki. Dowód: `SELECT count(*) FROM pg_policies` = 39 po migracji na czystej bazie.
3. **W3** — `ai_generated_media` dopisana do `direct_tables`; suma polityk 39.

Jeśli zespół świadomie chce wmergować R1 jako „tylko warstwa repo, RLS w następnym PR" — dopuszczam, **pod warunkiem** że ADR, README i commit message przestają twierdzić, że RLS działa/„defense in depth" jest aktywne. Półprawda o dwóch tamach jest gorsza niż jawne „na razie jedna tama".

### Przed RLS na produkcji Neon (czerwona linia — NO-GO bez tego):

1. **Sign-off Darka w Plan Mode** — dwie role na Neon + migracja schemy prod (CLAUDE.md sekcja 4: nowy element infry + migracja schemy produkcyjnej). Niedelegowalne.
2. **W1/W2/W3 zamknięte i dowiedzione lokalnie** — prod nie dostaje RLS, którego ścieżka żądania nie używa.
3. **Inwentarz ścieżek systemowych na prod** (2 webhooki, 5 cronów, seed, admin) z dowodem, że żadna nie jedzie rolą app bez kontekstu — test webhooka pod realnym RLS (rola app aktywna), nie pod ownerem.
4. **Rola app na Neon bez BYPASSRLS** — zweryfikowane `rolbypassrls = false` w `pg_roles` na prod.
5. **`FORCE` rozważone dla tabel bez ścieżki systemowej** — owner-bypass na prod to powierzchnia ataku przy wycieku DSN ownera; gdzie nie ma seed/webhooka, `FORCE` domyka. Decyzja per tabela, udokumentowana.
6. **Okno obserwacji + rollback** — `DROP POLICY` + `DISABLE` gotowe; filtr aplikacyjny zostaje (nie odsłania danych przy rollbacku — to OK w ADR).
7. **RODO:** dane osobowe klientów (imię, telefon, alergie) + sekrety subskrypcji są tabelami salon-scoped — wyciek cross-tenant = naruszenie. Druga tama na prod to wymóg, nie nice-to-have. Bez działającego W1 prod-RLS jest teatrem.

---

## Self-critique (rola: head of GRC po audycie SOC 2 Type II) — 5 słabości tego przeglądu

1. **Nie uruchomiłem migracji ani testów** — werdykt oparty na czytaniu kodu. Możliwe, że istnieje krok aplikujący `0005` poza `drizzle-kit migrate`, którego nie znalazłem (`grep` po `__tests__/scripts/package.json` nic nie pokazał, ale to nie pełen dowód negatywny). Złagodzenie: W2 wymaga dowodu z `pg_policies` — jeśli polityki są, warunek odpada sam.
2. **Nie potwierdziłem empirycznie, że owner faktycznie omija RLS na tej bazie** — to standard PostgreSQL (`ENABLE`-not-`FORCE`), ale nie odpaliłem zapytania. Twierdzenie W1 opieram na dokumentacji PG i braku `SET LOCAL ROLE` w kodzie — wysoka pewność, nie 100%.
3. **Mogłem przeoczyć tabelę pośrednią bez polityki** — sprawdziłem 12 zadeklarowanych i 26 bezpośrednich, ale tabele bez `salon_id` i bez FK do salon-scoped rodzica (np. `temporary_access`, `push_subscriptions` — user-scoped) zostawiłem zgodnie z ADR; nie zweryfikowałem niezależnie, że założenie „1 user = 1 salon" nie tworzy bocznej ścieżki wycieku.
4. **Nie oceniłem wydajności polityk `EXISTS`** — przy dużym ruchu mogą obciążyć plan zapytań; to ryzyko operacyjne (nie bezpieczeństwa), ale head of GRC po audycie SLA by je odnotował. Poza zakresem sign-offu G6, sygnalizuję.
5. **Werdykt „GO-z-warunkami" mógł być twardym NO-GO** — skoro RLS realnie nie działa na ścieżce żądania, ktoś surowszy dałby NO-GO. Wybrałem GO-z-warunkami, bo (a) filtr aplikacyjny działa i jest dowiedziony, (b) zakres R1 jest lokalny i odwracalny, (c) trzy naprawy są mechaniczne i zamykają lukę. Gdyby PR szedł na prod — NO-GO bez wahania.

---

## REWERYFIKACJA 2026-06-17

**Recenzent:** Ryan (CRCO), domena 8. **Tryb:** read-only. **Branch:** `feat/repo-layer-rls`, tip po naprawach `eae6b83`.
**Zgłoszenie Leo:** zamknięcie W1/W2/W3, testy 17/17 przez produkcyjny wrapper.
**Sprawdzone commity:** `328cb82` (journal `0005` + `ai_generated_media` + guard istnienia tabeli), `c389611` (`SET LOCAL ROLE` na ścieżce żądania + `GRANT`), `eae6b83` (przepisane testy RLS).

> Uwaga porządkowa: etykiety commitów Leo (W1/W2/W3) nie pokrywają się z moją numeracją z review (W1 = brak `SET LOCAL ROLE`, W2 = `0005` poza journalem, W3 = `ai_generated_media`). Weryfikowałem **po treści diffów**, nie po etykietach. Wszystkie trzy moje ustalenia są domknięte — niezależnie od nazewnictwa.

### W1 (ścieżka żądania jechała ownerem, omijała RLS) — ZAMKNIĘTE

- `repository.ts:71-81` — `withSalonContext` wykonuje teraz `set local role myhelper_app` JAKO PIERWSZĄ instrukcję transakcji, przed `set_config`. Wszystkie metody bramy (`findOne/updateOwned/deleteOwned/listOwned/raw`) idą przez ten sam wrapper — więc każda realna ścieżka żądania wchodzi w rolę app bez BYPASSRLS. Nazwa roli walidowana regexem identyfikatora (`APP_DB_ROLE`, `repository.ts:48-56`) — `SET ROLE` nie przyjmuje parametru bindowanego, więc literał + walidacja to poprawne i bezpieczne rozwiązanie (źródło: stała/env, nie wejście użytkownika).
- **Granty pod kątem regresji dostępności:** `0005:22-31` nadaje roli app `USAGE` na schemacie + `SELECT/INSERT/UPDATE/DELETE` na wszystkich tabelach + `USAGE/SELECT` na sekwencjach + `ALTER DEFAULT PRIVILEGES` na przyszłe obiekty. Rola app ma pełen DML — **brak regresji dostępności** na ścieżce użytkownika. `0005:34-38` dodaje krytyczny `GRANT myhelper_app TO current_user` — bez tego `SET LOCAL ROLE` z połączenia ownera rzuciłby „permission denied to set role" i KAŻDE żądanie by padło. Grant jest, ścieżka domknięta.
- **Ścieżki systemowe NADAL jadą owner (bypass), nie przez wrapper** — zweryfikowane importami: `stripe/webhook`, `cron/sms-reminders`, `deposits/confirm` importują surowe `@/lib/db` (owner), `forSalon` używają WYŁĄCZNIE trzy trasy `[id]` żądania (`clients/[id]`, `appointments/[id]`, `gallery/[id]`). Webhook/cron/deposit nigdy nie wołają `forSalon`. Zgodne z ADR sekcja 4 (owner z kontekstem z danych, nie z sesji).

### W2 (migracja `0005` poza `_journal.json` — `db:migrate` jej nie wykona) — ZAMKNIĘTE

- `_journal.json` ma teraz wpis `idx:5, version:"7", tag:"0005_rls_tenant_isolation"` w kolejności po `0004` (`idx:4`). `version:"7"` spójny z wszystkimi wcześniejszymi wpisami — `drizzle-kit migrate` czyta journal po `idx` i zastosuje `0005`. Pułapka „migracja spoza journala cicho się nie wykona" (pamięć repo) zamknięta.

### W3 (`ai_generated_media` salon-scoped bez polityki) — ZAMKNIĘTE (z zastrzeżeniem prod, niżej)

- `ai_generated_media` dopisana do `direct_tables` (`0005:56`, 26. pozycja). Pętla ma teraz guard `IF NOT EXISTS (... information_schema.tables ...) THEN CONTINUE` (`0005:63-65`) — poprawny i bezpieczny: na bazie węższej niż `schema.ts` migracja nie pada twardo, tylko pomija nieistniejącą tabelę. Analogiczny guard dla tabel pośrednich (`0005:114-117`).

### Dowód różnicowy Leo i testy 17/17 — WIARYGODNE, nie pozorują

- Przepisany `rls-tenant.test.ts` pyta bazę przez **produkcyjny** `forSalon(salonId).raw(tx => tx.select()...)` — czyli przez ten sam `withSalonContext` z `SET LOCAL ROLE`, którym chodzi aplikacja. Kluczowe: zapytania izolacyjne NIE używają filtra aplikacyjnego `eq(salonId)` — gdyby transakcja jechała ownerem (stan sprzed W1), zwróciłyby wiersze obu salonów i test BY PADŁ. Przechodzą tylko dlatego, że RLS rolą app realnie odcina.
- **Kontrola różnicująca** obecna i prawidłowa: ta sama surowa lista pod rolą OWNER (`db.select()` bez wrappera) widzi OBA salony — co dowodzi, że izolacja pochodzi od RLS+roli app, nie z artefaktu danych. To jest wiarygodny dowód różnicowy (usunięcie `SET LOCAL ROLE` → przeciek), spełnia mój warunek z W1.
- Webhook: test pokazuje, że owner zapisuje, a ta sama wstawka rolą app BEZ kontekstu pada na `WITH CHECK` — różnicuje owner-bypass od roli app (poprzedni test tego nie robił). Plus asercja `rolbypassrls = false` dla `myhelper_app`. Liczba: 5 (rls-tenant) + 12 (salon-isolation) = **17**, zgodne ze zgłoszeniem.
- **Zastrzeżenie metodyczne (jak w poprzednim self-critique):** nie odpalałem suity ani migracji (read-only, brak lokalnego Postgresa w tej sesji). Werdykt oparty na czytaniu diffów + kodu produkcyjnego. Dowód empiryczny (`pg_policies`, zielone 17/17 na czystej bazie) to warunek operacyjny przed mergem — patrz niżej.

### `ai_generated_media` — brak migracji TWORZĄCEJ tabelę: czy blocker?

**NIE jest blockerem R1, ALE jest długiem do domknięcia przed prod.** Rozbiór:
- **Bezpieczeństwo na świeżej bazie:** tabela nie powstaje z migracji (zweryfikowane: żaden `*.sql` jej nie tworzy), więc guard `CONTINUE` ją pomija — **brak tabeli = brak danych do wycieku**. Zero ekspozycji teraz.
- **Skutek uboczny:** na czystej bazie zbudowanej tylko z migracji policy NIE powstanie, więc realna liczba polityk = **38, nie 39** (39 wymaga, by tabela istniała w chwili migrate). Moja deklaracja „39" z review zakładała obecność tabeli. Korekta: 39 dotyczy bazy, gdzie `ai_generated_media` istnieje; na czystej migracyjnej bazie poprawny wynik to 38. Żaden test nie asertuje twardo liczby, więc to nie wywraca suity.
- **Pułapka prod (do domknięcia):** jeśli migracja tworząca `ai_generated_media` wyląduje KIEDYŚ PO `0005`, to `0005` już się wykonało — policy na tej tabeli NIE założy się automatycznie. Wymaga osobnej migracji zakładającej politykę (albo idempotentnego re-run kroku 3 w nowej migracji). To dług architektoniczny, nie luka R1 lokalnego.

### Zaktualizowany werdykt

**R1 (baza lokalna): GO** — W1/W2/W3 zamknięte w kodzie, dowód różnicowy wiarygodny, testy nie pozorują (idą przez produkcyjny wrapper). Podniesienie z „GO-z-warunkami" do GO uzależnione od jednego dowodu operacyjnego przed mergem (niżej) — nie od kolejnej zmiany kodu.

**Warunek operacyjny przed mergem (jeden, twardy):** uruchomić `drizzle-kit migrate` + suitę na czystej lokalnej bazie i pokazać: (a) 17/17 zielone, (b) `SELECT count(*) FROM pg_policies WHERE policyname IN ('tenant_isolation','tenant_self')` = **38** na bazie bez `ai_generated_media` (lub 39, jeśli tabela obecna). Dopóki nie ma tego zrzutu — werdykt operacyjnie „GO po dowodzie migrate", choć kod jest GO.

**Produkcja Neon (RLS): NO-GO — warunki prod z review NIEZMIENIONE (czerwona linia).** Wszystkie 7 warunków z sekcji „Przed RLS na produkcji Neon" zostają w mocy: sign-off Darka w Plan Mode (dwie role + migracja schemy prod), W1/W2/W3 dowiedzione lokalnie, inwentarz ścieżek systemowych, rola app bez BYPASSRLS na Neon, rozważenie `FORCE` per tabela, okno obserwacji + rollback, wymóg RODO drugiej tamy. **Dodatkowy warunek prod (nowy, z tej reweryfikacji):** domknąć dług `ai_generated_media` — zagwarantować, że policy na tej tabeli powstanie na prod (osobna migracja zakładająca politykę po migracji tworzącej tabelę), zanim tabela trafi na prod z danymi.
