# Runbook — okno przełączenia bazy Neon → Cloud SQL i powrót

Jedna procedura okna, wykonywana od góry do dołu. Przy każdym kroku: kod wyjścia
→ co dalej. Skrypty: `infra/db/cutover/`. Każde twierdzenie o skrypcie ma
odsyłacz `plik:linia` (ścieżki względem `infra/db/cutover/`).

Powiązane: `docs/runbook-krok-d.md` sekcja 9 (tunel do Cloud SQL), sekcja 3.6a
(kopie na żądanie i ich czas życia), sekcja 7 (atrybuty ról).

## 0. Zasady wspólne dla wszystkich skryptów

- **Kto uruchamia.** Wyłącznie właściciel, we własnym terminalu
  (`freeze-neon.sh:6`, `unfreeze-neon.sh:6`, `copy-neon-to-cloudsql.sh:5`,
  `rls-check.sh:6`, `compare.sh:5`, `copy-cloudsql-to-neon.sh:6`).
- **Ekran.** Tylko wiersze `klucz=wartość`: liczby, hashe, `yes`/`no` albo stała
  klasa błędu (`connection`, `read_only`, `unique_violation`, `fk_violation`,
  `exclusion_violation`, `circular_fk`, `other`). Wzorzec: `freeze-neon.sh:78`
  (ten sam w każdym skrypcie). Ostatni wiersz to zawsze `exit=<kod>`
  (`freeze-neon.sh:9-10`, `:90`).
- **Kod 3 nie ma `error_class`.** Skrypt wypisuje wtedy tylko `rejected_line=1`
  i kończy się (`compare.sh:71-72`, `copy-neon-to-cloudsql.sh:82-83`,
  `copy-cloudsql-to-neon.sh:103-104`). Kod 3 = stop, przyczyna z logu, który
  właściciel czyta lokalnie (sekcja 4).
- **Tylko flaga `--dry-run`.** Każdy inny argument (np. `--target`) = kod 2 bez
  połączenia (`freeze-neon.sh:93-100`, `copy-neon-to-cloudsql.sh:90-97`,
  `copy-cloudsql-to-neon.sh:111-118`). `compare.sh` przyjmuje dodatkowo
  `--expect-empty`, `--all-tables`, `--schema-baseline=<plik>` (`compare.sh:84-93`).
- **Najpierw `--dry-run` z tym samym środowiskiem.** Bez połączenia sprawdza
  zmienne: oczekiwane `dry_run=yes`, `steps=<n>`, `exit=0`; kod 2 = złe
  zmienne, poprawić przed prawdziwym uruchomieniem (`freeze-neon.sh:146-150`,
  `unfreeze-neon.sh:144-148`, `copy-neon-to-cloudsql.sh:131-135`,
  `rls-check.sh:83-87`, `compare.sh:117-127`, `copy-cloudsql-to-neon.sh:156-160`).
- **Adresy tylko ze zmiennych `PG*` / `VERIFY_PG*` / `TARGET_PG*`**, nigdy URL ani
  argument; bez `PGHOSTADDR`, `PGSERVICE`, `.pgpass` (`PGPASSFILE=/dev/null`) i
  `PGOPTIONS` (`freeze-neon.sh:12-27`, `:103-106`; `copy-neon-to-cloudsql.sh:20-33`,
  `:100-103`; `copy-cloudsql-to-neon.sh:34-49`, `:127-130`; `rls-check.sh:12-16`;
  `compare.sh:11-14`). Hosty małymi literami (`freeze-neon.sh:119-120`).
- **Kod 130 (Ctrl-C, TERM, HUP)** — każdy skrypt kończy się wtedy `exit=130`
  (`freeze-neon.sh:91`, `unfreeze-neon.sh:89`, `copy-neon-to-cloudsql.sh:88`,
  `rls-check.sh:63`, `compare.sh:77`, `copy-cloudsql-to-neon.sh:109`). Stan bazy
  = stan jak przy kodzie 1 w tym samym miejscu: o stanie decyduje **ostatni
  wiersz wypisany przed `exit=130`**, a przy kopiach rozstrzyga kontrola opisana
  w danym kroku. Nie uruchamiać następnego kroku, dopóki stan nie jest ustalony.
- **Bloki do wklejenia nie mają linii komentarza** (interaktywny zsh bez
  `interactivecomments` wykonałby je — `docs/runbook-krok-d.md` sekcja 5).
  W blokach są wyłącznie symbole zastępcze w `<…>`; prawdziwych nazw hostów,
  instancji, projektów i haseł nie zapisuje się w repo, w notatce okna ani w
  zgłoszeniach. Wyjątek — tylko w notatce okna (nigdy w repo ani
  w zgłoszeniach): host `<domena Vercel Production>` i pozostałe domeny projektu z F1,
  adresy `*.vercel.app` wybrane według F1 i 0.3 procedury zatrzymania zapisów oraz `<LB_IP>`.
  Identyfikator projektu GCP i nazwy instancji nie mają wyjątku.
- **Strażnik zmiennej w tym samym wierszu.** Polecenia gcloud zaczynają się od
  `: "${CSQL_INSTANCE:?}" &&`: przy pustej zmiennej zsh przerywa cały wiersz,
  ale wykonałby następny wklejony wiersz — dlatego strażnik i polecenie są
  w jednym wierszu.
- **Polecenia gcloud, neonctl i `cloud-sql-proxy`** (1.0 pkt 2, 1.1 „Instancja
  próbna” i „Gałąź próbna Neona”, 1.5, 2.4, 3.3 krok 4, przywrócenia) mają
  składnię do potwierdzenia w próbie generalnej: każde polecenie i jego
  oczekiwany wynik są zapisane w `docs/drills/` przed oknem. Polecenie, które
  w próbie dało inny wynik, poprawia się w tym runbooku przed oknem. Takie
  bloki mają dopisek „(do potwierdzenia w próbie, sekcja 0)”.

## 1. Warunki przed oknem

Okno nie startuje, dopóki każdy punkt nie ma wyniku zapisanego w notatce okna.
Przygotowanie terminala w dniu próby i w dniu okna, w tej kolejności: 1.7
(stanowisko) → 1.5 (tunel) → 1.6 (hasła i polecenia kontrolne) → kontrole 1.3.

### 1.0 Warunki wstępne — przed próbą generalną i przed oknem

1. **Osobna procedura zatrzymania zapisów i przełączenia ruchu** (osobny
   dokument, nie ten runbook): zatrzymanie zapisów — Vercel Production i
   Preview, crony Vercela, ingress Cloud Run, zadania Cloud Scheduler;
   przełączenie ruchu — DNS `app` i LB (`docs/runbook-krok-d.md` sekcja 10a),
   `BETTER_AUTH_URL` / `NEXT_PUBLIC_APP_URL`, adresy przekierowań OAuth;
   **cofnięcie** przełączenia ruchu (wycofanie, droga B w sekcji 2, i powrót,
   3.3 krok 10). Każdy krok z poleceniem i oczekiwanym wynikiem. **Bez tej
   procedury nie startuje ani próba generalna, ani okno.** Ten runbook (2.1,
   2.9, wycofanie, 3.3) tylko się do niej odwołuje. Procedura:
   `docs/runbook-zatrzymanie-zapisow.md`.
2. **Role Cloud SQL w stanie docelowym** — stan sprawdzany **przed** próbą
   generalną (żeby próba sprawdziła stan docelowy; instancja próbna z 1.1 jest
   klonem z tym stanem):
   - login aplikacji jest jeden: `myhelper_svc` (aplikacja i migracje,
     `docs/runbook-krok-d.md:169-181`); pula połączeń musi być właścicielem
     tabel (kontrola roli puli), więc osobnego loginu puli nie tworzymy;
   - **zmiana loginu jest wykonana przed próbą** (osobny krok za zgodą
     właściciela, z recenzją bezpieczeństwa, najpierw na klonie): odebranie
     członkostwa w `cloudsqlsuperuser` loginowi utworzonemu przez
     `gcloud sql users create` okazało się na Cloud SQL niewykonalne, więc
     `postgres` utworzył SQL-em nowy login `myhelper_svc` (taki login nie
     dostaje `cloudsqlsuperuser`), własność obiektów przeszła na niego przez
     `REASSIGN OWNED`, a poprzedni login usunięto. Stan `myhelper_svc`: bez
     superużytkownika, `BYPASSRLS`, `CREATEROLE`, `CREATEDB` i członkostwa
     w `cloudsqlsuperuser`; właściciel wszystkich obiektów w schematach
     `public` i `drizzle`; członek `myhelper_app`; `CONNECT`, `TEMPORARY`,
     `CREATE` na bazie oraz `USAGE`, `CREATE` na `public` (schemat `public`
     należy do `pg_database_owner`, bez tych praw padłyby przyszłe migracje);
     domyślne uprawnienia dla `myhelper_app` na tabelach i sekwencjach
     w `public`. Sekret `postgres-url` ma jedną włączoną wersję, z loginem
     `myhelper_svc`;
   - **etapu `sql` w `infra/gcp/bootstrap.sh` nie uruchamia się ponownie** do
     czasu jego poprawki: tworzy login przez `gcloud sql users create`, a taki
     login dostaje `cloudsqlsuperuser`, więc ponowny przebieg odtworzyłby stan
     sprzed zmiany;
   - stan inny niż docelowy (kontrole w kroku 2 niżej): stop, decyzja
     architektury i bezpieczeństwa przed próbą. Naprawy ról nie wykonuje się
     w trybie awaryjnym;
   - **przebieg migracji idzie na instancji produkcyjnej**, nie na klonie: job
     `myhelper-migrate` działa jako `myhelper-runtime`
     (`docs/runbook-krok-d.md:197-199`), a jego `roles/cloudsql.client` ma
     warunek IAM ograniczony do instancji produkcyjnej
     (`docs/runbook-krok-d.md:185-186`). Instancja produkcyjna przed oknem nie
     ma danych, a kopia jest `--data-only` (`copy-neon-to-cloudsql.sh:12-13`),
     więc cel i tak potrzebuje schematu z migracji;
   - terminal jak w oknie: 1.7 → 1.5 (blok „Tylko w oknie” + tunel, port
     produkcyjny) → 1.6. Kolejność, każdy wynik w zapisie próby:
     1. login z sekretu: 1.6 `owner_pw_format=yes` (wzorzec wycina hasło
        tylko z URL-a loginu `myhelper_svc`) i `psql_csql_app`:

        ```bash
        set +x
        psql_csql_app <<'SQL'
        SELECT current_user;
        SQL
        ```

        Oczekiwane: `myhelper_svc`. Inny wynik = stop, decyzja architektury
        i bezpieczeństwa;
     2. kontrole stanu docelowego: 1.3 pkt 4 = `f | f | f`, właściciel obiektów,
        uprawnienia i domyślne uprawnienia loginu aplikacji (`psql_csql_admin`;
        `has_*_privilege` z listą praw zwraca `t` przy którymkolwiek z nich,
        dlatego każde prawo osobno):

        ```bash
        set +x
        psql_csql_admin <<'SQL'
        SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname IN ('public', 'drizzle') AND c.relowner <> 'myhelper_svc'::regrole;
        SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname IN ('public', 'drizzle') AND p.proowner <> 'myhelper_svc'::regrole;
        SELECT count(*) FROM pg_namespace WHERE nspname = 'drizzle' AND nspowner <> 'myhelper_svc'::regrole;
        SELECT rolcreaterole, rolcreatedb FROM pg_roles WHERE rolname = 'myhelper_svc';
        SELECT pg_has_role('myhelper_svc', 'myhelper_app', 'MEMBER');
        SELECT count(*) FROM pg_roles WHERE rolname = 'myhelper_owner';
        SELECT has_database_privilege('myhelper_svc', current_database(), 'CONNECT'), has_database_privilege('myhelper_svc', current_database(), 'TEMPORARY'), has_database_privilege('myhelper_svc', current_database(), 'CREATE'), has_schema_privilege('myhelper_svc', 'public', 'USAGE'), has_schema_privilege('myhelper_svc', 'public', 'CREATE');
        SELECT d.defaclobjtype::text || ':' || d.defaclacl::text FROM pg_default_acl d JOIN pg_namespace n ON n.oid = d.defaclnamespace WHERE d.defaclrole = 'myhelper_svc'::regrole AND n.nspname = 'public' ORDER BY d.defaclobjtype;
        SQL
        gcloud --project='<projekt GCP>' secrets versions list postgres-url --filter='state=ENABLED' --format='value(name)' | wc -l | tr -d ' '
        ```

        Oczekiwane, po kolei: `0`; `0`; `0`; `f|f`; `t`; `0`; `t|t|t|t|t`;
        dwa wiersze `S:{myhelper_app=rU/myhelper_svc}` i
        `r:{myhelper_app=arwd/myhelper_svc}`; `1`. Do 1.1 trafia wynik każdego
        wiersza z osobna. Inny wynik = stop, decyzja architektury
        i bezpieczeństwa;
     3. pustość: blok 2.3 (`compare.sh --expect-empty`) = `expect_empty=yes`,
        `exit=0`. Kod 5 = stop: jobu nie uruchamiamy, decyzja architektury
        i bezpieczeństwa;
     4. kopia na żądanie `pre-migrate-<RRRRMMDD>` (wzorzec 2.4;
        do potwierdzenia w próbie, sekcja 0):

        ```bash
        set +x
        : "${CSQL_INSTANCE:?}" && gcloud --project='<projekt GCP>' sql backups create --instance="$CSQL_INSTANCE" --description='pre-migrate-<RRRRMMDD>'
        : "${CSQL_INSTANCE:?}" && gcloud --project='<projekt GCP>' sql backups list --instance="$CSQL_INSTANCE" --filter="description='pre-migrate-<RRRRMMDD>'" --format='value(id,status,description)'
        ```

        Oczekiwane: jeden wiersz `<ID> SUCCESSFUL pre-migrate-<RRRRMMDD>`; ID
        do zapisu próby. Kopia, którą workflow robi sam przed migracją (rola
        `myhelperSqlBackup`, `docs/runbook-krok-d.md:187-190`), jej nie
        zastępuje. Inny wynik = stop, jobu nie uruchamiamy;
     5. przebieg workflow z migracjami (`run_migrations=true`) z `main` o tym
        samym sha co 1.7 i zapis próby; sha przebiegu do zapisu. Przebieg może
        wdrożyć rewizję usługi — dopuszczalne (ruch jest na Vercelu, usługa
        nie ma użytkowników); nazwa rewizji do zapisu. Ingress Cloud Run
        i stan zadań Scheduler zostają bez zmian (wynik przed i po w zapisie);
     6. kontrola po jobie: job zielony; kontrole z kroku 2 jeszcze raz (także
        nowe tabele z tego przebiegu); `rls-check.sh` (blok 2.8) przechodzi
        (`SET ROLE myhelper_app`, `rls-check.sh:18-31`); drugie
        `--expect-empty` (blok 2.3) = `exit=0`. Wiersze `auth_rate_limit`
        z działającej rewizji czyści sam `--expect-empty` (`compare.sh:40-44`);
        kod 5 (inna niepusta tabela = inny zapis aplikacji) = stop i decyzja
        architektury i bezpieczeństwa przed próbą;
     7. w terminalu z krokami 1–6: koniec tunelu i haseł (1.5, 1.6), potem
        zamknięcie terminala. Żaden blok próby nie idzie w terminalu
        z tunelem produkcyjnym i funkcjami 1.6 wskazującymi produkcję;
     8. dopiero teraz, w **nowym** terminalu (od 1.7, potem 1.1), klon
        instancji próbnej (1.1) — dziedziczy stan docelowy ról i schematu.
        Próba idzie dalej w tym terminalu.
   - **job czerwony** = stop przed próbą, bez ponawiania; decyzja architektury
     i bezpieczeństwa. Przywrócenie z kopii `pre-migrate` (blok „Przywrócenie”
     z 2.4 z jej ID) tylko za osobną zgodą właściciela;
   - kopię `pre-migrate` usuwa się po zielonej próbie generalnej, w terminalu
     z blokiem „Tylko w oknie” (1.5), nie w terminalu próby (wynik w zapisie
     próby; do potwierdzenia w próbie, sekcja 0):

     ```bash
     set +x
     : "${CSQL_INSTANCE:?}" && gcloud --project='<projekt GCP>' sql backups delete '<ID kopii pre-migrate>' --instance="$CSQL_INSTANCE"
     ```

   - zamrożenie i odmrożenie Cloud SQL (2.6, 2.10, 3.3) wykonuje `postgres`
     (członek właściciela bazy, więc ma `ALTER DATABASE`; usługa go nie
     używa). `myhelper_svc` nie dostaje `pg_read_all_stats` ani
     `pg_signal_backend`.

### 1.1 Próba generalna

Na **gałęzi próbnej Neona** (ten sam projekt Neona, ta sama rola właściciela co
produkcja; niżej) i na **instancji próbnej Cloud SQL** (niżej), tymi samymi skryptami
z `main` i w tej samej kolejności co sekcje 2 i 3. Wynik w
`docs/drills/restore-<data>.md`: czas każdego kroku (`copy_seconds`,
`compare_seconds` z ekranu, czas zamrożenia i odmrożenia, czas kopii i
przywrócenia z 2.4), wszystkie kody wyjścia, wyniki kontroli z 1.0 pkt 2
i 1.3–1.7, wynik każdego polecenia gcloud i neonctl. Bez danych wierszy, bez
nazw hostów, instancji i projektów. Próba startuje dopiero po spełnieniu obu
warunków wstępnych z 1.0.

**Instancja próbna.** Osobna instancja Cloud SQL — nigdy druga baza na
instancji produkcyjnej: przywrócenie kopii (1.1 pkt 4) nadpisuje **całą**
instancję. Powstaje po 1.0 pkt 2 jako klon instancji produkcyjnej (ta sama
wersja, role i hasła; danych produkcyjnych jeszcze nie ma). Przed próbą:
koszt instancji próbnej (godziny tieru i dysk na czas próby) policzony
i mieszczący się w budżecie miesięcznym (`docs/runbook-krok-d.md:784-785`).
W terminalu próby zmienna `CSQL_INSTANCE` ma wyłącznie nazwę instancji próbnej;
nazwy instancji produkcyjnej nie przypisuje się do niej w tym terminalu (blok
„Tylko w oknie” z 1.5 w próbie się nie wkleja). Do potwierdzenia w próbie,
sekcja 0:

```bash
set +x
CSQL_INSTANCE='<instancja próbna>'
[[ -n "$CSQL_INSTANCE" && "$CSQL_INSTANCE" != '<instancja produkcyjna>' ]] && echo drill_instance_ok=yes || echo drill_instance_ok=no
: "${CSQL_INSTANCE:?}" && [[ "$CSQL_INSTANCE" != '<instancja produkcyjna>' ]] && gcloud --project='<projekt GCP>' sql instances clone '<instancja produkcyjna>' "$CSQL_INSTANCE"
: "${CSQL_INSTANCE:?}" && gcloud --project='<projekt GCP>' sql instances describe "$CSQL_INSTANCE" --format='value(state,databaseVersion,settings.tier)'
```

Oczekiwane: `drill_instance_ok=yes`, klon kończy się bez błędu, opis
`RUNNABLE POSTGRES_18 <tier instancji produkcyjnej>`
(`docs/runbook-krok-d.md:162`). `drill_instance_ok=no` = stop. Tunel w próbie
(1.5) prowadzi do instancji próbnej, na `<port tunelu>` **innym** niż port
z `docs/runbook-krok-d.md` sekcja 9, żeby żaden blok próby nie trafił w tunel
produkcyjny.

**Gałąź próbna Neona.** Osobna gałąź w projekcie Neona z własnym endpointem;
nigdy gałąź produkcyjna. Zmienna `NEON_BRANCH` ma w terminalu próby wyłącznie
nazwę gałęzi próbnej (blok „Tylko w oknie” z 1.5 w próbie się nie wkleja).
Dowód, że `<neon-admin>` z 1.6 jest endpointem gałęzi próbnej, a nie
produkcyjnej — przed 2.2 (do potwierdzenia w próbie, sekcja 0: flagi
`endpoints list --branch --output json` i obecność hosta w wyniku):

```bash
set +x
NEON_BRANCH='<gałąź próbna Neona>'
[[ -n "$NEON_BRANCH" && "$NEON_BRANCH" != '<gałąź produkcyjna Neona>' ]] && echo drill_branch_ok=yes || echo drill_branch_ok=no
: "${NEON_BRANCH:?}" && [[ "$NEON_BRANCH" != '<gałąź produkcyjna Neona>' ]] && neonctl endpoints list --project-id '<projekt Neona>' --branch "$NEON_BRANCH" --output json | grep -qF -- '<neon-admin>' && NEON_PROD_EP="$(neonctl endpoints list --project-id '<projekt Neona>' --branch '<gałąź produkcyjna Neona>' --output json)" && [[ -n "$NEON_PROD_EP" ]] && ! printf '%s' "$NEON_PROD_EP" | grep -qF -- '<neon-admin>' && DRILL_NEON_OK=yes || DRILL_NEON_OK=no
unset NEON_PROD_EP
echo "drill_neon_ok=$DRILL_NEON_OK"
drill_neon_guard() { [[ -n "$NEON_BRANCH" && "$NEON_BRANCH" != '<gałąź produkcyjna Neona>' && "$DRILL_NEON_OK" == yes ]]; }
```

Oczekiwane: `drill_branch_ok=yes`, `drill_neon_ok=yes`. `no` = stop próby.
Wynik `endpoints list` nie trafia na ekran (`grep -q`, zmienna bez `echo`).
Część negatywna (host nie jest endpointem produkcji) rozróżnia „brak hosta
w wyniku” od „błędu polecenia”: wynik dla gałęzi produkcyjnej trafia najpierw
do zmiennej, więc błąd `neonctl` (kod ≠ 0) albo pusty wynik daje
`drill_neon_ok=no`, a nie fałszywe `yes`. Głównym dowodem jest część
pozytywna (host na liście gałęzi próbnej); negatywna jest pomocnicza.
`<neon-pooler>` musi
wskazywać ten sam endpoint co `<neon-admin>`, inaczej skrypty dają kod 2
(`freeze-neon.sh:22-25`, `:131-144`).

**Strażnik Neona w próbie.** W próbie każdy wiersz, który zmienia Neona —
zamrożenie (2.2, 3.3 krok 6), odmrożenie (droga A pkt 1, 3.3 krok 9), kopia
wsteczna (3.4), `neonctl branches create` (3.3 krok 4) i `neonctl branches
restore` („Stop w kroku 7 albo 8”) — zaczyna się w tym samym wierszu od
`drill_neon_guard &&`. Funkcja istnieje tylko w terminalu próby; w oknie
prefiksu się nie wkleja.

**Podmiany w próbie**, we wszystkich blokach sekcji 1–3:

| Symbol | W próbie |
|---|---|
| `<port tunelu>` | port tunelu próby |
| `CSQL_INSTANCE` | instancja próbna (blok wyżej) |
| `<neon-admin>`, `<neon-pooler>` | endpoint gałęzi próbnej (bez i z `-pooler.`) |
| `NEON_BRANCH` | gałąź próbna (blok wyżej) |
| `<gałąź produkcyjna Neona>` | **bez podmiany** — prawdziwa nazwa produkcji, tylko w strażnikach |

Na końcu próby, przed zamknięciem terminala (po usunięciu instancji próbnej
i po końcu tunelu i haseł z 1.5 i 1.6 — kolejność w 3.3 krok 11):

```bash
set +x
unset NEON_BRANCH DRILL_NEON_OK
unset -f drill_neon_guard
```

Usunięcie po próbie (wynik w zapisie próby), najpierw kopie na żądanie
instancji próbnej, potem instancja:

```bash
set +x
: "${CSQL_INSTANCE:?}" && [[ "$CSQL_INSTANCE" != '<instancja produkcyjna>' ]] && gcloud --project='<projekt GCP>' sql backups list --instance="$CSQL_INSTANCE" --format='value(id,type,status)'
```

Każda kopia `ON_DEMAND` z listy:

```bash
set +x
: "${CSQL_INSTANCE:?}" && [[ "$CSQL_INSTANCE" != '<instancja produkcyjna>' ]] && gcloud --project='<projekt GCP>' sql backups delete '<ID kopii próby>' --instance="$CSQL_INSTANCE"
```

Potem instancja (jeśli klon odziedziczył ochronę przed usunięciem — najpierw
jej zdjęcie, tylko na instancji próbnej):

```bash
set +x
: "${CSQL_INSTANCE:?}" && [[ "$CSQL_INSTANCE" != '<instancja produkcyjna>' ]] && gcloud --project='<projekt GCP>' sql instances patch "$CSQL_INSTANCE" --no-deletion-protection
: "${CSQL_INSTANCE:?}" && [[ "$CSQL_INSTANCE" != '<instancja produkcyjna>' ]] && gcloud --project='<projekt GCP>' sql instances delete "$CSQL_INSTANCE"
: "${CSQL_INSTANCE:?}" && gcloud --project='<projekt GCP>' sql instances list --format='value(name)' | grep -cxF -- "$CSQL_INSTANCE"
unset CSQL_INSTANCE
```

Oczekiwane: ostatnia liczba `0`. gcloud pyta o potwierdzenie usunięcia —
przed `Y` właściciel czyta nazwę instancji w pytaniu.

W próbie generalnej muszą wyjść:

1. Kopia w przód do końca: `copied=yes` (`copy-neon-to-cloudsql.sh:288`),
   porównanie obu baz zgodne jak w kroku 2.7, `rls_fail_closed=yes`.
2. Kopia wsteczna (sekcja 3) z instancji próbnej na ponownie zamrożoną gałąź
   Neona — **co najmniej do `target_frozen=yes`** (`copy-cloudsql-to-neon.sh:291`).
   Dowodzi to, że prawdziwy Neon pokazuje niepuste `neon.timeline_id`
   (`copy-cloudsql-to-neon.sh:238-249`). Kod 4 albo 1 w kroku 1 skryptu na
   prawdziwym Neonie = stop, powrót do decyzji architektury; sondy nie luzujemy
   i zmiennej obejścia nie ma (`copy-cloudsql-to-neon.sh:249`). **Bez tego
   zapisu okno powrotu (sekcja 3) nie startuje.**
3. `freeze-neon.sh` na instancji próbnej przez tunel ze zmiennymi z 2.6
   (`PG*` = `postgres`, `VERIFY_PG*` = `myhelper_svc`) daje `frozen=yes`.
   Warunek: 1.3 pkt 3 dla `postgres` na Cloud SQL = `t | t` (inaczej błąd
   42501 — `freeze-neon.sh:33-36`). Inny wynik = stop i decyzja przed oknem.
4. Kopia „przed importem” i przywrócenie z niej (bloki 2.4) na instancji
   próbnej: kopia `SUCCESSFUL`, przywrócenie bez błędu, po nim kontrole z 2.4.
   Przywrócenie **zdejmuje zamrożenie Cloud SQL**: ustawienie z
   `ALTER DATABASE … SET` siedzi w `pg_db_role_setting`, czyli w kopii
   instancji (`freeze-neon.sh:37-38`). Próba przywraca kopię **na końcu
   próby, po 3.3 kroku 11** (wcześniej przywrócenie opróżniłoby instancję
   przed pkt 1 i 2); instancja jest wtedy nadal zamrożona (3.3 krok 11). Po
   przywróceniu (`psql_csql_app`, 1.6 — każde
   wywołanie to nowe połączenie jako `myhelper_svc`):

   ```bash
   set +x
   psql_csql_app <<'SQL'
   SELECT current_setting('default_transaction_read_only');
   SQL
   ```

   Oczekiwane: `off`. Wynik w zapisie próby — od niego zależy wycofanie
   z sekcji 2. Do zapisu też czas przywrócenia i to, czy tunel po nim działa
   bez restartu (1.5).
5. Próg czasu porównania: `compare_seconds` każdej bazy zapisane. Hash treści
   tabeli liczony jest jednym `string_agg` po wszystkich wierszach
   (`compare.sh:195`); bardzo duża tabela może przekroczyć limit wartości
   Postgresa (1 GB) — przy błędzie `compare.sh` w próbie generalnej stop i
   decyzja przed oknem.
6. `PGSSLROOTCERT` = **plik** (nie `system`, 1.4): oba połączenia jednego
   procesu (Neon z `verify-full` i tunel z `disable`) przechodzą w kopii w
   przód i w kopii wstecznej. Zapis „przechodzi / nie przechodzi” dla obu
   kopii w `docs/drills/`.
7. Lista **dozwolonych różnic** w porównaniu Neon ↔ Cloud SQL (sekcja 2.7):
   ustalona na podstawie próby, zapisana w notatce okna przed oknem.
   `extensions_count`, `extensions_sha256` i `locale_sha256`
   (`compare.sh:222-226`) **nie są wyłączane z porównania po cichu**: każda z
   nich, jeśli się różni, trafia na listę jako **dokładna para wartości**
   (Neon, Cloud SQL) z próby. W oknie para musi być identyczna jak w próbie,
   inaczej stop. Do `docs/drills/` dodatkowo (bez danych osobowych), dla obu
   baz — `psql_neon_owner` i `psql_csql_app` (1.6), ten sam tekst:

   ```bash
   set +x
   psql_neon_owner <<'SQL'
   SELECT extname, extversion FROM pg_extension ORDER BY extname;
   SELECT datcollate, datctype, pg_encoding_to_char(encoding) FROM pg_database WHERE datname = current_database();
   SQL
   ```

   Decyzja architektury przed oknem, jeśli różni się wersja rozszerzenia
   używanego przez schemat `public` (pgvector) albo kodowanie jest inne niż
   `UTF8`. Różnica samego collation jest dopuszczalna: `rows_hash_*` liczy się
   w `COLLATE "C"` (`compare.sh:195`), a indeksy powstają od nowa przy imporcie.
8. Gałąź Neona „przed powrotem” i przywrócenie z niej (bloki 3.3 krok 4 i
   „Stop w kroku 7 albo 8”, z prefiksem `drill_neon_guard &&`) na gałęzi
   próbnej. Miejsce w próbie: po 3.4 z kodem 0 — przywrócenie gałęzi
   z kontrolami po nim, potem 3.4 jeszcze raz (Neon nadal zamrożony) i dalej
   3.3 krok 8. Po przywróceniu: host endpointu bez zmian (`<neon-admin>` z 1.6
   łączy się bez zmiany zmiennych), hasła ról bez zmian, baza nadal
   zamrożona. Do sprawdzenia w próbie: czy Neon pozwala przywrócić gałąź
   z gałęzi, która jest jej własnym dzieckiem (`pre-return` jest dzieckiem
   `NEON_BRANCH`); odmowa = sekcja 3 nie ma cofnięcia, okno powrotu nie
   startuje, decyzja architektury. Kopia Cloud SQL „przed powrotem” — jak
   pkt 4, przywrócenie na końcu próby, po 3.3 kroku 11 i **przed**
   przywróceniem z pkt 4; po nim kontrola z pkt 4 (`psql_csql_app`,
   `default_transaction_read_only`), oczekiwane **`on`** — kopia „przed
   powrotem” powstaje po zamrożeniu z 3.3 kroku 2 (`freeze-neon.sh:37-38`),
   inaczej niż kopia z pkt 4 (tam `off`). Inny wynik = stop; wynik w zapisie
   próby. **Bez tego zapisu okno powrotu nie startuje** (3.1).

### 1.2 Zgody właściciela potrzebne do okna

Każda zgoda osobno, zapisana w notatce okna przed wykonaniem kroku:

| Zgoda | Krok |
|---|---|
| przed próbą generalną, na instancji produkcyjnej Cloud SQL: kopia na żądanie `pre-migrate`, przebieg workflow z migracjami (`run_migrations=true`, może wdrożyć rewizję usługi), czyszczenie `auth_rate_limit` przez `--expect-empty` (kroki 3 i 6, `compare.sh:40-44` — to też zapis) | 1.0 pkt 2 |
| przywrócenie z kopii `pre-migrate` po czerwonym jobie | 1.0 pkt 2 |
| próba generalna na produkcji (procedura zatrzymania zapisów, L8): ingress Cloud Run `internal` i z powrotem `all`, pauza i wznowienie zadań Scheduler, przełącznik cronów Vercela wyłącz/włącz, reguła zapory Vercela na adresie jednego starszego wdrożenia (utworzenie, sprawdzenie, usunięcie) | 1.1; procedura zatrzymania zapisów L8 |
| w próbie generalnej, zmiana konfiguracji konta Stripe w **trybie testowym**: zmiana adresu endpointu webhooka i ponowienie zdarzeń (bez trybu live) | procedura zatrzymania zapisów 0.3 |
| przed oknem, poza repo, bez wpływu na ruch: ochrona wdrożeń Vercela „Standard Protection”, usunięcie `POSTGRES_URL` z zakresu Preview, utworzenie **wyłączonej** reguły zapory Vercela (`Deny`, cały projekt), dopisanie adresu przekierowania i originu `app.nordsignal.cc` do klienta Google OAuth, wersja `stripe-webhook-secret` = sekret endpointu Stripe. Każda pozycja potwierdzana osobno | procedura zatrzymania zapisów L1, L3, L5, L6 |
| przed oknem: zmienne środowiska `production-gcp` (`BETTER_AUTH_URL`, `NEXT_PUBLIC_APP_URL` = `https://app.nordsignal.cc`, `GOOGLE_CLIENT_ID` według L5), wersja `google-client-secret` według L5 i przebieg `deploy-cloud-run.yml` z `main` o `<sha okna>` (nowa rewizja usługi, ruch nadal na Vercelu) | procedura zatrzymania zapisów, sekcja 1 (P4, P5) |
| start okna: zatrzymanie zapisów Vercel Production (włączenie reguły zapory Vercela, L1), wyłączenie cronów Vercela (L2), ingress Cloud Run `internal`, wstrzymanie zadań Cloud Scheduler (W6), zamrożenie produkcyjnego Neona; przy wycofaniu (droga A pkt 3, także po drodze B) wznowienie stanu sprzed okna: wyłączenie reguły zapory Vercela (R1), włączenie cronów Vercela (R3), ingress Cloud Run `all` (R4) | 2.1–2.2; wycofanie, droga A pkt 3; procedura zatrzymania zapisów, sekcja 5 (R1–R4) |
| kopia na żądanie Cloud SQL „przed importem” i — w razie potrzeby — przywrócenie z niej | 2.4; wycofanie (sekcja 2) |
| przełączenie ruchu aplikacji na GCP: ingress Cloud Run z powrotem `all`, utworzenie rekordu `A app` → LB (DNS only), włączenie polityki alertu `myhelper-app-health-alert`, zmiana adresu endpointu webhooka Stripe; przy wycofaniu (droga B): usunięcie rekordu `app`, przywrócenie adresu endpointu, wyłączenie polityki alertu, ingress Cloud Run `internal` (zapora i dalsze wznowienie: wiersz „start okna”, droga A pkt 3) | 2.9; wycofanie (sekcja 2), droga B |
| odmrożenie Cloud SQL (początek zapisów na GCP) | 2.10 |
| po 2.10 z kodem 0 albo po drodze C, przy warunkach przed K1.1 (W4 = `<sha okna>`; T5 z serwera autorytatywnego, a resolvery publiczne z `<LB_IP>` albo upłynęło minimum SOA od T4; T6 o oczekiwanym wyniku): scalenie K1 (przekierowanie `<domena Vercel Production>` → `app.nordsignal.cc`, wdrożenie Vercel Production) i zawężenie reguły zapory Vercela do metod innych niż `GET`/`HEAD` | procedura zatrzymania zapisów L4 (K1, warunki przed K1.1); wycofanie, droga C |
| po oknie albo przy wycofaniu (droga A pkt 3): wznowienie zadań Cloud Scheduler, wyłącznie tych, które w W0 miały `ENABLED` (lista z notatki okna) | 2.10; wycofanie, droga A pkt 3; procedura zatrzymania zapisów, sekcja 5 (R5) |
| okno powrotu (osobne okno, osobna zgoda) z gałęzią Neona „przed powrotem” i kopią Cloud SQL | sekcja 3 |

### 1.3 Zatrzymanie zapisów PRZED zamrożeniem

Zamrożenie to **ustawienie domyślne bazy** (`ALTER DATABASE … SET
default_transaction_read_only = on`, `freeze-neon.sh:37-38`, `:269`), nie
blokada. Sesja może je wyłączyć u siebie (`SET default_transaction_read_only =
off` albo `BEGIN READ WRITE`) — tak robi sam skrypt administracyjny
(`freeze-neon.sh:264-268`) i kopia wsteczna (`sql/reverse-pre.sql:7-8`, `:15`).
Sesje superużytkownika nie są zrywane (`freeze-neon.sh:38-40`, `:272`, `:278`).
Dlatego przed `freeze-neon.sh`:

1. Zapisy aplikacji zatrzymane według osobnej procedury z 1.0 pkt 1. Każdy
   punkt z wynikiem w notatce okna:
   - aplikacja na Vercelu (Production) bez ruchu zapisującego, crony Vercela
     wyłączone;
   - **Preview Vercela**: wdrożenia Preview mają dziś produkcyjny
     `POSTGRES_URL`, więc każde Preview pisze do produkcyjnego Neona. Wynik:
     Preview bez produkcyjnego `POSTGRES_URL` albo bez działających wdrożeń
     na czas okna;
   - **ingress Cloud Run = `internal`** od 2.1 do 2.9. Dziś ingress to `all`
     (`docs/runbook-krok-d.md:765-769`): adres `run.app` przyjmowałby zapisy do
     Cloud SQL w trakcie 2.3–2.6, a wtedy `count_auth_rate_limit` > 0 na
     Cloud SQL i 2.7 stoi. To **główna kontrola** braku zapisów na Cloud SQL;
     zamrożenie w 2.6 jest obroną w głąb;
   - zadania Cloud Scheduler wstrzymane (`docs/runbook-krok-d.md` sekcja 8:
     stan `PAUSED`).

   Kontrole SQL w pkt 2–5 idą poleceniami kontrolnymi z 1.6; przy każdej
   podane jest, którym (adres i hasło).
2. Rola logowania aplikacji (adres `VERIFY_PG*`) **nie** jest
   superużytkownikiem — na Neonie (`psql_neon_app`) i na Cloud SQL
   (`psql_csql_app`; na Cloud SQL to `myhelper_svc`, jedyny login aplikacji,
   `docs/runbook-krok-d.md:169`):

   ```bash
   set +x
   psql_neon_app <<'SQL'
   SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user;
   SQL
   psql_csql_app <<'SQL'
   SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user;
   SQL
   ```

   Oczekiwane: `f|f` dwa razy. Inaczej stop.
3. Rola zamrażająca (adres `PG*` zamrożenia) ma oba uprawnienia potrzebne do
   zamrożenia (widoczność sesji i zrywanie, `freeze-neon.sh:33-44`) — na
   Neonie rola właściciela Neona (`psql_neon_owner`), na Cloud SQL `postgres`
   (`psql_csql_admin`, 1.0 pkt 2):

   ```bash
   set +x
   psql_neon_owner <<'SQL'
   SELECT pg_has_role(current_user, 'pg_read_all_stats', 'USAGE'), pg_has_role(current_user, 'pg_signal_backend', 'USAGE');
   SQL
   psql_csql_admin <<'SQL'
   SELECT pg_has_role(current_user, 'pg_read_all_stats', 'USAGE'), pg_has_role(current_user, 'pg_signal_backend', 'USAGE');
   SQL
   ```

   Oczekiwane: `t|t` dwa razy. Inaczej stop (skrypt i tak odmówi: kod 1, baza
   bez zmian); na Cloud SQL — decyzja przed oknem.
4. Atrybuty loginu aplikacji na Cloud SQL (`myhelper_svc`, pula połączeń
   usługi): bez superużytkownika, bez `BYPASSRLS`, poza `cloudsqlsuperuser`
   (`MEMBER` sprawdza członkostwo przechodnio). Polecenie: `psql_csql_admin`:

   ```bash
   set +x
   psql_csql_admin <<'SQL'
   SELECT r.rolsuper, r.rolbypassrls, pg_has_role(r.rolname, 'cloudsqlsuperuser', 'MEMBER') FROM pg_roles r WHERE r.rolname = 'myhelper_svc';
   SQL
   ```

   Oczekiwane: `f|f|f` (stan po 1.0 pkt 2). Inny wynik = stop, decyzja
   przed oknem.
5. Na Cloud SQL żadna baza nie ma podrobionego ustawienia `neon.*` (sonda
   kopii wstecznej opiera się na `neon.timeline_id`,
   `copy-cloudsql-to-neon.sh:238-249`). Polecenie: `psql_csql_admin`:

   ```bash
   set +x
   psql_csql_admin <<'SQL'
   SELECT count(*) FROM pg_db_role_setting WHERE array_to_string(setconfig, ',') LIKE '%neon.%';
   SQL
   ```

   Oczekiwane: `0`; wynik liczbowy w zapisie próby generalnej i w notatce okna.

### 1.4 Certyfikat CA dla `verify-full`

Każdy host Neona (spoza 127.0.0.1/localhost) wymaga `PGSSLMODE=verify-full`
(`freeze-neon.sh:21`, `:123-125`; `copy-neon-to-cloudsql.sh:28-29`, `:120-121`;
`compare.sh:14`, `:113-115`; `copy-cloudsql-to-neon.sh:45-46`, `:148-150`).
`verify-full` wymaga zaufanego CA: plik `~/.postgresql/root.crt` albo
`PGSSLROOTCERT=<ścieżka do pliku z certyfikatami CA>`. Na macOS proponowany
plik to `/etc/ssl/cert.pem` — potwierdzony w próbie generalnej (1.1 pkt 6).

**Pułapka: `PGSSLROOTCERT=system`.** Kopie w przód i wstecz łączą się w jednym
procesie z Neonem (TLS) i z tunelem Cloud SQL na 127.0.0.1, a zmienna
`PGSSLROOTCERT` nie jest przepisywana między adresami (`use_addr` przepisuje
tylko host, port, bazę, użytkownika, hasło i `PGSSLMODE` —
`copy-neon-to-cloudsql.sh:180-188`, `copy-cloudsql-to-neon.sh:199-207`).
libpq z `sslrootcert=system` odrzuca połączenie ze słabszym `sslmode` niż
`verify-full` („weak sslmode”), więc połączenie z tunelem (`PGSSLMODE=disable`)
pada: `psql` rc=2 → `error_class=connection`, przed jakimkolwiek zapisem
(`copy-neon-to-cloudsql.sh:220-232`). Wynik bezpieczny, ale okno stoi. Dlatego:

- `PGSSLROOTCERT` wskazuje **plik**, nigdy `system`, i nie jest ustawiane
  globalnie w profilu powłoki — tylko w środowisku jednego polecenia;
- adres tunelu ma `PGSSLMODE=disable` (szyfruje tunel; `docs/runbook-krok-d.md`
  sekcja 9);
- próba generalna potwierdza, że oba połączenia jednego procesu przechodzą.

### 1.5 Tunel do Cloud SQL

`cloud-sql-proxy` na **127.0.0.1** (`docs/runbook-krok-d.md` sekcja 9). Skrypty
przyjmują Cloud SQL wyłącznie pod `127.0.0.1` — nie `localhost`, nie gniazdo:
`copy-neon-to-cloudsql.sh:124-125` (cel), `rls-check.sh:79`,
`compare.sh:110-112` (`--expect-empty`), `copy-cloudsql-to-neon.sh:143-144`
(źródło). W oknie `<port tunelu>` = port z sekcji 9 i `CSQL_INSTANCE` =
instancja produkcyjna; w próbie — 1.1 „Instancja próbna” i „Gałąź próbna
Neona”.

**Tylko w oknie** (i w 1.0 pkt 2) — w terminalu próby tego bloku się nie
wkleja:

```bash
set +x
CSQL_INSTANCE='<instancja produkcyjna>'
NEON_BRANCH='<gałąź produkcyjna Neona>'
```

Blok z sekcji 9 kończy proxy zaraz po `psql`, więc na czas okna proxy startuje
osobno, w tle, z wyjściem do pliku (jego wiersze zawierają nazwę połączenia
instancji, czyli identyfikator projektu — nie mogą mieszać się z ekranem).
Do potwierdzenia w próbie, sekcja 0 (flagi `--address`, `--port`):

```bash
set +x
mkdir -p -m 700 "$HOME/secure"
: "${CSQL_INSTANCE:?}" && cloud-sql-proxy --address 127.0.0.1 --port '<port tunelu>' "<projekt GCP>:europe-central2:$CSQL_INSTANCE" > "$HOME/secure/cutover-proxy.log" 2>&1 &
CSQL_PROXY_PID=$!
sleep 5
kill -0 "$CSQL_PROXY_PID" 2>/dev/null && echo proxy_running=yes || echo proxy_running=no
```

Oczekiwane: `proxy_running=yes`; potem kontrola połączenia z 1.6
(`psql_csql_app` z `SELECT 1` = `1`). `no` = log proxy czyta właściciel
lokalnie, stop. Plik `cutover-proxy.log` obejmuje wzorzec usuwania z sekcji 4.
Przywrócenie kopii instancji (2.4) restartuje instancję: proxy zostaje,
otwarte połączenia padają, każdy następny skrypt łączy się od nowa.

Koniec tunelu (koniec okna albo stop okna):

```bash
set +x
kill "$CSQL_PROXY_PID"
unset CSQL_PROXY_PID CSQL_INSTANCE NEON_BRANCH
```

### 1.6 Hasła tylko w środowisku procesu

Hasło trafia do zmiennej powłoki (bez `export`), jest przekazywane jako
przypisanie przed jednym poleceniem i usuwane na końcu okna. Nie trafia na
ekran, do argumentów, historii ani pliku.

Hasła Neona wpisuje właściciel bez echa (zsh: tekst po `?` to zachęta):

```bash
set +x
read -rs 'NEON_OWNER_PW?Hasło roli właściciela Neona: '
echo
read -rs 'NEON_APP_PW?Hasło roli aplikacji Neona: '
echo
[[ -n "$NEON_OWNER_PW" ]] && echo neon_owner_pw_set=yes || echo neon_owner_pw_set=no
[[ -n "$NEON_APP_PW" ]] && echo neon_app_pw_set=yes || echo neon_app_pw_set=no
```

Hasła Cloud SQL są wyłącznie w Secret Managerze
(`docs/runbook-krok-d.md:169-184`): `postgres-admin-password` (rola `postgres`)
i `postgres-url` (URL loginu `myhelper_svc`, z którego wycinamy samo hasło).
Odczyt do zmiennej, bez ekranu i bez lokalnego logu gcloud — ten sam wzorzec
co `docs/runbook-krok-d.md:744`. `<projekt GCP>` = identyfikator projektu z
`docs/runbook-krok-d.md` sekcja 9 (nie zapisuje się go w notatce okna):

```bash
set +x
CSQL_ADMIN_PW="$(CLOUDSDK_CORE_DISABLE_FILE_LOGGING=1 gcloud --project='<projekt GCP>' secrets versions access latest --secret=postgres-admin-password)"
CSQL_OWNER_PW="$(CLOUDSDK_CORE_DISABLE_FILE_LOGGING=1 gcloud --project='<projekt GCP>' secrets versions access latest --secret=postgres-url | sed -E 's|^postgresql://myhelper_svc:([^@]+)@.*$|\1|')"
[[ -n "$CSQL_ADMIN_PW" ]] && echo admin_pw_set=yes || echo admin_pw_set=no
[[ "$CSQL_OWNER_PW" =~ ^[A-Za-z0-9]{32}$ ]] && echo owner_pw_format=yes || echo owner_pw_format=no
```

Oczekiwane: `neon_owner_pw_set=yes`, `neon_app_pw_set=yes`, `admin_pw_set=yes`,
`owner_pw_format=yes` (hasło loginu ma postać `[A-Za-z0-9]{32}`,
`docs/runbook-krok-d.md:169-170`; inna wartość = `sed` nie wyciął hasła z URL,
np. URL ma inny login niż `myhelper_svc`).
Kontrola wypisuje tylko `yes`/`no`, nigdy wartości. Wynik `no` = stop,
`unset` (niżej) i wyjaśnienie przed oknem. W próbie instancja próbna jest
klonem, więc ma te same hasła — potwierdzone kontrolą połączenia niżej.

**Polecenia kontrolne SQL** (1.0 pkt 2, 1.1 pkt 4 i 7, 1.3 pkt 2–5, 1.7,
kontrole wycofania). Cztery funkcje powłoki: każde wywołanie to nowe połączenie
z hasłem tylko w środowisku `psql`; zapytanie idzie ze strumienia
(`<<'SQL'`), nie z argumentu:

```bash
set +x
psql_neon_owner() { PGHOST='<neon-admin>' PGPORT=5432 PGDATABASE='<baza>' PGUSER='<rola właściciela Neona>' PGPASSWORD="$NEON_OWNER_PW" PGSSLMODE=verify-full PGSSLROOTCERT='<plik CA>' PGPASSFILE=/dev/null psql -X -A -t -w -v ON_ERROR_STOP=1; }
psql_neon_app() { PGHOST='<neon-pooler>' PGPORT=5432 PGDATABASE='<baza>' PGUSER='<rola aplikacji Neona>' PGPASSWORD="$NEON_APP_PW" PGSSLMODE=verify-full PGSSLROOTCERT='<plik CA>' PGPASSFILE=/dev/null psql -X -A -t -w -v ON_ERROR_STOP=1; }
psql_csql_admin() { PGHOST=127.0.0.1 PGPORT='<port tunelu>' PGDATABASE='<baza Cloud SQL>' PGUSER=postgres PGPASSWORD="$CSQL_ADMIN_PW" PGSSLMODE=disable PGPASSFILE=/dev/null psql -X -A -t -w -v ON_ERROR_STOP=1; }
psql_csql_app() { PGHOST=127.0.0.1 PGPORT='<port tunelu>' PGDATABASE='<baza Cloud SQL>' PGUSER=myhelper_svc PGPASSWORD="$CSQL_OWNER_PW" PGSSLMODE=disable PGPASSFILE=/dev/null psql -X -A -t -w -v ON_ERROR_STOP=1; }
psql_neon_owner <<'SQL'
SELECT 1;
SQL
psql_neon_app <<'SQL'
SELECT 1;
SQL
psql_csql_admin <<'SQL'
SELECT 1;
SQL
psql_csql_app <<'SQL'
SELECT 1;
SQL
```

Oczekiwane: `1` cztery razy. Błąd połączenia = stop przed oknem (tunel 1.5,
CA 1.4, hasła wyżej).

| Funkcja | Adres | Rola i hasło |
|---|---|---|
| `psql_neon_owner` | `<neon-admin>`, `verify-full` | rola właściciela Neona, `$NEON_OWNER_PW` |
| `psql_neon_app` | `<neon-pooler>`, `verify-full` | rola aplikacji Neona, `$NEON_APP_PW` |
| `psql_csql_admin` | tunel 127.0.0.1, `disable` | `postgres`, `$CSQL_ADMIN_PW` |
| `psql_csql_app` | tunel 127.0.0.1, `disable` | `myhelper_svc`, `$CSQL_OWNER_PW` |

**Na końcu okna — także po stopie albo przerwaniu okna, przed zamknięciem
terminala:**

```bash
set +x
unset NEON_OWNER_PW NEON_APP_PW CSQL_ADMIN_PW CSQL_OWNER_PW
unset -f psql_neon_owner psql_neon_app psql_csql_admin psql_csql_app
```

Dalej w blokach (symbole zastępcze):

- `<neon-admin>` — pełna nazwa endpointu Neona **bez** `-pooler.` (rola
  właściciela); `<neon-pooler>` — ta sama nazwa z `-pooler.` (rola logowania
  aplikacji). Oba muszą wskazywać ten sam endpoint, inaczej kod 2
  (`freeze-neon.sh:22-25`, `:131-144`).
- `<baza>`, `<rola właściciela Neona>`, `<rola aplikacji Neona>`,
  `<baza Cloud SQL>`, `<rola właściciela Cloud SQL>` = `myhelper_svc`
  z hasłem `$CSQL_OWNER_PW` (dla kopii w przód rola właściciela bazy celu —
  `copy-neon-to-cloudsql.sh:24-26`). Zamrożenie i odmrożenie Cloud SQL:
  `PG*` = `postgres` z `$CSQL_ADMIN_PW`, `VERIFY_PG*` = `myhelper_svc`
  z `$CSQL_OWNER_PW` (1.0 pkt 2).
- `<plik CA>` — plik z 1.4.
- `<projekt Neona>` — dla `neonctl` (1.1, 3.3 krok 4); gałąź w poleceniach
  `neonctl` to zmienna `NEON_BRANCH` (w oknie blok „Tylko w oknie” z 1.5,
  w próbie 1.1 „Gałąź próbna Neona”); `<gałąź produkcyjna Neona>` występuje
  tylko w tym przypisaniu i w strażnikach próby.
- `<RRRRMMDD>` — data okna (UTC) w opisie kopii i nazwie gałęzi.

### 1.7 Stanowisko wykonawcy

Wszystkie bloki zakładają, że katalog roboczy to korzeń repozytorium (ścieżki
`infra/db/cutover/…`). Skrypty startują przez `#!/usr/bin/env bash`
(`freeze-neon.sh:1`, `compare.sh:1`, `copy-neon-to-cloudsql.sh:1`,
`unfreeze-neon.sh:1`), czyli pierwszym `bash` ze ścieżki — na macOS domyślnie
3.2, a test na prawdziwym Postgresie idzie w CI, nie na tym stanowisku
(`compare.sh:53`). Dowodem, że wersje na stanowisku działają, jest tylko
próba generalna.

```bash
set +x
cd '<katalog repozytorium>'
git switch main
git pull --ff-only
git status --porcelain | wc -l
git rev-parse HEAD
command -v bash
bash --version | head -n 1
psql --version
pg_dump --version
pg_restore --version
cloud-sql-proxy --version
gcloud --version | head -n 1
neonctl --version
```

Oczekiwane: `0` zmienionych plików; `git rev-parse HEAD` w oknie = ten sam
sha co w zapisie próby; wersja główna `psql`, `pg_dump`, `pg_restore` ≥
wersji serwerów (Cloud SQL `POSTGRES_18`, `docs/runbook-krok-d.md:162`; Neon
niżej). Wszystkie wersje trafiają do zapisu próby; w oknie muszą być
identyczne. Inny sha albo inna wersja = stop, nowa próba albo decyzja przed
oknem.

Wersja serwera Neona (po 1.6):

```bash
set +x
psql_neon_owner <<'SQL'
SHOW server_version_num;
SQL
```

Oczekiwane: liczba; jej pierwsze dwie cyfry ≤ wersji głównej `pg_dump`.

## 2. Okno w przód

Kolejność: zatrzymanie zapisów → zamrożenie Neona → kontrola pustości celu →
kopia na żądanie Cloud SQL „przed importem” → kopia → zamrożenie Cloud SQL →
porównanie obu baz → kontrola izolacji salonów → przełączenie ruchu →
odmrożenie Cloud SQL. Kontrola pustości idzie **przed** kopią na żądanie, żeby
kopia była kopią potwierdzonego pustego celu; pustość sprawdza ponownie sama
kopia danych (`copy-neon-to-cloudsql.sh:229-232`).
**Neon zostaje zamrożony** do decyzji o zakończeniu okresu powrotu.

### Wycofanie okna w przód

Każde „stop okna” w sekcji 2 wskazuje jedną z trzech dróg. O drodze decyduje
to, czy ruch jest już na GCP (2.9) i czy Cloud SQL może być odmrożony (2.10).

**Droga A — przed 2.9** (ruch na Vercelu; Cloud SQL bez zapisów aplikacji,
bo ingress Cloud Run `internal` od 2.1):

1. Odmrożenie Neona — `unfreeze-neon.sh` z tymi samymi zmiennymi co 2.2:

   ```bash
   set +x
   PGHOST='<neon-admin>' PGDATABASE='<baza>' PGUSER='<rola właściciela Neona>' PGPASSWORD="$NEON_OWNER_PW" PGSSLMODE=verify-full PGSSLROOTCERT='<plik CA>' VERIFY_PGHOST='<neon-pooler>' VERIFY_PGDATABASE='<baza>' VERIFY_PGUSER='<rola aplikacji Neona>' VERIFY_PGPASSWORD="$NEON_APP_PW" VERIFY_PGSSLMODE=verify-full infra/db/cutover/unfreeze-neon.sh --dry-run
   ```

   Potem ten sam wiersz bez `--dry-run` (w próbie z prefiksem
   `drill_neon_guard &&`, 1.1). Oczekiwane `pooler=yes`,
   `unfrozen=yes`, `exit=0` (`unfreeze-neon.sh:29-45`). Kod 2 → poprawić
   zmienne; kod 8 → jedno ponowne uruchomienie. Każdy inny wynik: stan
   rozstrzyga odczyt na adresie aplikacji —

   ```bash
   set +x
   psql_neon_app <<'SQL'
   SELECT current_setting('default_transaction_read_only');
   SQL
   ```

   `off` → Neon przyjmuje zapisy, dalej pkt 2; `on` → Neon nadal zamrożony,
   aplikacja na Vercelu tylko do odczytu: jedno ponowne uruchomienie, potem
   stop i decyzja właściciela na miejscu (log czyta lokalnie).
2. Cloud SQL, **zanim** ingress wróci na `all`: jeśli 2.4 się wykonał —
   przywrócenie z kopii „przed importem” (blok „Przywrócenie” w 2.4) i obie
   kontrole po nim (`--expect-empty` = 0, `off`). Przywrócenie zdejmuje też
   zamrożenie Cloud SQL z 2.6 (1.1 pkt 4), więc `unfreeze-neon.sh` na Cloud
   SQL nie jest wtedy potrzebny. Jeśli stop był przed 2.4: Cloud SQL nie był
   zmieniany poza czyszczeniem `auth_rate_limit` (`compare.sh:40-44`) — bez
   przywracania. Ingress zostaje `internal` do końca kontroli, bo żywa usługa
   pod `run.app` zapisałaby przed `--expect-empty`.
3. Wznowienie zapisów na Vercelu, ingress Cloud Run i zadania Scheduler do
   stanu sprzed okna — według osobnej procedury z 1.0 pkt 1.
4. Tunel i hasła: koniec z 1.5 i 1.6.

**Droga B — po 2.9, Cloud SQL nadal zamrożony, potwierdzone odczytem stanu
= `on`** (blok „Odczyt stanu” w 2.10). **Kod sam nie wystarcza:** kod 7
w 2.10 znaczy, że ktoś po 2.6 dopisał ustawienie na poziomie roli
(`unfreeze-neon.sh:30`); `off` na roli loginu aplikacji pozwala jej zapisywać
od 2.9, a droga B by te zapisy skasowała. Odczyt to nowe połączenie loginem
aplikacji, więc widzi ustawienie bazy razem z ustawieniem roli. `off` →
droga C; odczyt bez wyniku → stop, ruch bez zmian, decyzja właściciela na
miejscu. Przy `on` aplikacja na GCP nie zapisała, bo każde nowe
połączenie jest tylko do odczytu, a sesje sprzed zamrożenia zerwał 2.6
(`freeze-neon.sh:37-48`). Najpierw cofnięcie przełączenia ruchu z 2.9 (ruch
na Vercel, ingress Cloud Run `internal`) według osobnej procedury z 1.0 pkt 1,
potem droga A od pkt 1.

**Droga C — po 2.10, Cloud SQL odmrożony albo stan „może być odmrożony”
potwierdzony odczytem `off`**: aplikacja na GCP mogła już zapisać, więc
przesłanka drogi A nie obowiązuje. **Okno uznaje się za zakończone**, ruch
zostaje na GCP. Problem sesji tylko do odczytu usuwa ponowne
`unfreeze-neon.sh` (blok 2.10). Domknięcie jak wiersz 0 w 2.10: zadania
Scheduler według decyzji właściciela, koniec tunelu i haseł (1.5, 1.6); przekierowanie starej domeny według procedury zatrzymania zapisów, sekcja 3 (K1, warunek po drodze C).
Powrót na Neon — wyłącznie sekcją 3 (osobne okno, osobna zgoda).

### 2.1 Zatrzymanie zapisów

**Procedura: osobna procedura zatrzymania zapisów i przełączenia ruchu
(1.0 pkt 1); bez niej okno nie startuje.** Wykonane i zapisane w notatce okna
wszystkie punkty 1.3 pkt 1, w tym ingress Cloud Run przełączony na `internal`
(zostaje do 2.9) i Preview Vercela bez zapisu do produkcyjnego Neona. Bez tego
nie zamrażać.

### 2.2 Zamrożenie Neona — `freeze-neon.sh`

```bash
set +x
PGHOST='<neon-admin>' PGDATABASE='<baza>' PGUSER='<rola właściciela Neona>' PGPASSWORD="$NEON_OWNER_PW" PGSSLMODE=verify-full PGSSLROOTCERT='<plik CA>' VERIFY_PGHOST='<neon-pooler>' VERIFY_PGDATABASE='<baza>' VERIFY_PGUSER='<rola aplikacji Neona>' VERIFY_PGPASSWORD="$NEON_APP_PW" VERIFY_PGSSLMODE=verify-full infra/db/cutover/freeze-neon.sh --dry-run
```

W próbie: przed tym blokiem `drill_neon_ok=yes` (1.1), a wiersz bez
`--dry-run` z prefiksem `drill_neon_guard &&`.

Potem ten sam wiersz bez `--dry-run`. Oczekiwane: `role_override=0`,
`stats_visible=1`, `backends_before`, `terminated` ≥ `backends_before`,
`login_roles`, `skipped_superuser` (oba tylko do zapisu, bez progu —
`freeze-neon.sh:286-290`), `pooler=yes`, `frozen=yes`, `exit=0`
(`freeze-neon.sh:29-49`).

| Kod | Stan (`freeze-neon.sh:56-64`) | Co dalej |
|---|---|---|
| 0 | zamrożona, zapis na adresie aplikacji odrzucony | 2.3 |
| 2 | bez połączenia | poprawić zmienne, powtórzyć |
| 7 | baza bez zmian; rola ma własne `default_transaction_read_only` (`:30-32`, `:234`) | stop okna, wznowić zapisy; decyzja przed nowym oknem |
| 1 lub 3 bez wiersza `stats_visible=1` | baza bez zmian | `error_class=connection` → sprawdzić CA i powtórzyć; `other` albo kod 3 → stop, wznowić zapisy |
| 1 lub 3 po `stats_visible=1`, bez `backends_before` | baza **może być już zamrożona** (`:58-60`) | powtórzyć raz (ponowne uruchomienie na zamrożonej bazie jest dozwolone, `:264-266`); drugi raz ≠ 0 → stop, droga A |
| 8 | **zamrożona**, część sesji sprzed zamrożenia żyje (`:61-62`, `:291`) | jedno ponowne uruchomienie; drugi raz 8 → stop, droga A |
| 9 lub 1 po `backends_before` | zamrożona, test na adresie aplikacji nie potwierdził (`:63-64`, `:299-315`) | stop; nie kopiować; droga A |
| 130 | jak kod 1 w miejscu ostatniego wiersza | według wierszy wyżej |

### 2.3 Pustość celu — `compare.sh --expect-empty` (Cloud SQL)

Jedyny zapis w `compare.sh`: czyści `public.auth_rate_limit` (wiersze zostawione
przez działającą usługę), potem liczy niepuste tabele (`compare.sh:40-44`,
`:264-293`).

```bash
set +x
PGHOST=127.0.0.1 PGPORT='<port tunelu>' PGDATABASE='<baza Cloud SQL>' PGUSER='<rola właściciela Cloud SQL>' PGPASSWORD="$CSQL_OWNER_PW" PGSSLMODE=disable infra/db/cutover/compare.sh --expect-empty
```

| Kod | Co dalej |
|---|---|
| 0 (`expect_empty=yes`) | 2.4 |
| 4 | host ≠ 127.0.0.1 albo serwer Neona (`compare.sh:49`, `:110-112`, `:259-262`) — poprawić zmienne |
| 5 (`expect_empty=no`, `nonempty_tables=<n>`) | Cloud SQL ma dane, a kopii „przed importem” jeszcze nie ma — stop okna, droga A (bez przywracania, pkt 2); skąd dane — decyzja przed nowym oknem; bez kopii danych |
| 2 | złe zmienne albo argumenty, bez połączenia — poprawić zmienne, powtórzyć |
| 1, 130 | `error_class` decyduje: `connection` → tunel (1.5), powtórzyć; inne → stop, droga A |
| 3 | stop, log lokalnie (sekcja 0); droga A |

### 2.4 Kopia na żądanie Cloud SQL „przed importem”

Za zgodą właściciela: kopia na żądanie instancji Cloud SQL po potwierdzeniu
pustości (2.3), **przed** kopią danych. To jedyna droga cofnięcia importu,
który się zatwierdził (`copy-neon-to-cloudsql.sh:57-59`). Czas życia:
`docs/runbook-krok-d.md` sekcja 3.6a (zostaje do końca okresu powrotu; opis
zaczyna się od `pre-import`, jak tam). Bloki 2.4 — do potwierdzenia w próbie,
sekcja 0.

```bash
set +x
: "${CSQL_INSTANCE:?}" && gcloud --project='<projekt GCP>' sql backups create --instance="$CSQL_INSTANCE" --description='pre-import-<RRRRMMDD>'
: "${CSQL_INSTANCE:?}" && gcloud --project='<projekt GCP>' sql backups list --instance="$CSQL_INSTANCE" --filter="description='pre-import-<RRRRMMDD>'" --format='value(id,status,description)'
```

Oczekiwane: tworzenie kończy się bez błędu; lista daje **jeden** wiersz
`<ID> SUCCESSFUL pre-import-<RRRRMMDD>`. ID trafia do notatki okna i do
zmiennej:

```bash
set +x
PRE_IMPORT_ID='<ID z listy>'
```

Inny stan niż `SUCCESSFUL`, błąd gcloud albo więcej niż jeden wiersz = stop
okna, droga A (import się nie zaczął, przywracać nie trzeba).

**Przywrócenie z kopii „przed importem”** (droga A pkt 2 i wiersze 2.5).
Nadpisuje całą instancję `CSQL_INSTANCE` i ją restartuje: tunel (1.5) zostaje,
otwarte połączenia padają.

```bash
set +x
: "${CSQL_INSTANCE:?}" && : "${PRE_IMPORT_ID:?}" && gcloud --project='<projekt GCP>' sql backups restore "$PRE_IMPORT_ID" --restore-instance="$CSQL_INSTANCE"
: "${CSQL_INSTANCE:?}" && gcloud --project='<projekt GCP>' sql operations list --instance="$CSQL_INSTANCE" --limit=1 --format='value(operationType,status)'
: "${CSQL_INSTANCE:?}" && gcloud --project='<projekt GCP>' sql instances describe "$CSQL_INSTANCE" --format='value(state)'
```

gcloud pyta o potwierdzenie — przed `Y` właściciel czyta nazwę instancji
w pytaniu. Oczekiwane: przywrócenie bez błędu, ostatnia operacja
`RESTORE_VOLUME DONE`, stan `RUNNABLE`. Kontrola po przywróceniu, oba wyniki
w notatce okna:

1. `compare.sh --expect-empty` (blok 2.3) = `exit=0`;
2. stan zamrożenia (zdjęte przez przywrócenie, 1.1 pkt 4):

   ```bash
   set +x
   psql_csql_app <<'SQL'
   SELECT current_setting('default_transaction_read_only');
   SQL
   ```

   Oczekiwane: `off`.

Inny wynik którejkolwiek kontroli = stop, Cloud SQL bez dalszych kroków,
decyzja przed nowym oknem.

### 2.5 Kopia — `copy-neon-to-cloudsql.sh`

Strumień `pg_dump | pg_restore --single-transaction`, bez pliku pośredniego, bez
danych `auth_rate_limit`, `session`, `verification` (`copy-neon-to-cloudsql.sh:11-18`,
`:271`). Źródło (Neon) tylko do odczytu, adres **bez** poolera
(`:28-30`, `:120-123`); cel tylko `127.0.0.1` (`:124-125`). Krok 1 skryptu
ponownie sprawdza pustość celu (`:229-232`).

```bash
set +x
PGHOST='<neon-admin>' PGDATABASE='<baza>' PGUSER='<rola właściciela Neona>' PGPASSWORD="$NEON_OWNER_PW" PGSSLMODE=verify-full PGSSLROOTCERT='<plik CA>' TARGET_PGHOST=127.0.0.1 TARGET_PGPORT='<port tunelu>' TARGET_PGDATABASE='<baza Cloud SQL>' TARGET_PGUSER=myhelper_svc TARGET_PGPASSWORD="$CSQL_OWNER_PW" TARGET_PGSSLMODE=disable infra/db/cutover/copy-neon-to-cloudsql.sh --dry-run
```

Potem bez `--dry-run`. Oczekiwane: `target_nonempty_tables=0`,
`fk_cycle_tables=0`, `dump_exit=0`, `restore_exit=0`, `copied=yes`,
`copy_seconds`, `exit=0` (`:35-46`).

**Po `exit=1` najpierw patrzeć na `restore_exit`.**

| Kod | Stan celu (`copy-neon-to-cloudsql.sh:53-59`) | Co dalej |
|---|---|---|
| 0 | dane w Cloud SQL | 2.6 |
| 2 | bez połączenia | poprawić zmienne, powtórzyć |
| 4 | cel na serwerze z `neon.*` — zły serwer (`:230`) | stop; sprawdzić tunel i zmienne `TARGET_*` |
| 5 | cel niepusty (`:232`) — coś zapisało po 2.3 | stop okna; przyczyna (ingress, 1.3 pkt 1); droga A z przywróceniem kopii 2.4 i kontrolą `--expect-empty` po nim |
| 1 z `error_class=circular_fk` przed `dump_exit` | bez zmian (`:39-42`, `:259-262`) | stop okna, droga A |
| 1 bez wiersza `dump_exit` | bez zmian | `connection` → powtórzyć; inne → stop, droga A |
| 3 bez wiersza `dump_exit` | bez zmian (`:54`) | stop, log lokalnie (sekcja 0); droga A |
| 1 z `restore_exit` ≠ 0 | transakcja wycofana, cel bez danych | potwierdzić `compare.sh --expect-empty` (2.3) = 0; przyczyna z `error_class`; powtórzyć 2.5 albo stop, droga A |
| 1 z `restore_exit=0` | **dane zatwierdzone**, cel niepusty (`:57-59`, `:281-286`) | jedyna droga: przywrócenie z kopii „przed importem” (2.4) z kontrolami; potem stop (droga A) albo nowa próba od 2.3 — istniejąca kopia jest kopią pustego celu, nowej nie trzeba |
| 130 | nieustalony, jeśli przerwano w strumieniu | najpierw `pgrep -x pg_restore` (niżej) = pusto; potem `compare.sh --expect-empty` (2.3): 0 → cel pusty, można powtórzyć 2.5; 5 → jak „1 z `restore_exit=0`” |

Przy kodzie 130 sygnał wysłany do samego skryptu (TERM, HUP — nie Ctrl-C do
całej grupy procesów) może zostawić działający `pg_restore`, który zatwierdzi
dane po kontroli pustości. Przed `--expect-empty`:

```bash
set +x
pgrep -x pg_restore || echo pg_restore_running=no
```

Oczekiwane: `pg_restore_running=no`. Wypisany numer procesu = czekać i
powtarzać co 30 s, aż wyjdzie `no`; dopiero wtedy `--expect-empty`.

### 2.6 Zamrożenie Cloud SQL — `freeze-neon.sh` przez tunel

**Obrona w głąb, nie główna kontrola.** Główną kontrolą braku zapisów na
Cloud SQL jest ingress Cloud Run `internal` od 2.1 do 2.9 (1.3 pkt 1).
Zamrożenia nie da się zrobić przed 2.5, bo kopia zapisuje do celu. Krok
zostaje, bo bez niego `compare.sh` czytałby sekwencje poza migawką transakcji
(`compare.sh:22-24`). Skrypt dopuszcza oba adresy na 127.0.0.1 bez poolera
(`freeze-neon.sh:108-110`, `:135-139`, `:142-144`).

Zamraża `postgres` (`PG*`, hasło `$CSQL_ADMIN_PW`); test zapisu idzie adresem
loginu aplikacji (`VERIFY_PG*` = `myhelper_svc`, hasło `$CSQL_OWNER_PW`) —
1.0 pkt 2, 1.3 pkt 3. Najpierw `--dry-run` (sekcja 0):

```bash
set +x
PGHOST=127.0.0.1 PGPORT='<port tunelu>' PGDATABASE='<baza Cloud SQL>' PGUSER=postgres PGPASSWORD="$CSQL_ADMIN_PW" PGSSLMODE=disable VERIFY_PGHOST=127.0.0.1 VERIFY_PGPORT='<port tunelu>' VERIFY_PGDATABASE='<baza Cloud SQL>' VERIFY_PGUSER=myhelper_svc VERIFY_PGPASSWORD="$CSQL_OWNER_PW" VERIFY_PGSSLMODE=disable infra/db/cutover/freeze-neon.sh --dry-run
```

Oczekiwane `dry_run=yes`, `steps=5`, `exit=0` (`freeze-neon.sh:50`,
`:146-150`). Potem ten sam wiersz bez `--dry-run`. Oczekiwane: `pooler=no`,
`frozen=yes`, `exit=0`.

Kody jak w tabeli 2.2, z jedną zmianą: **każde „stop” w 2.6 = droga A
z przywróceniem Cloud SQL z kopii „przed importem”** (pkt 2), a nie samo
„wznowić zapisy”. Powtórzenia dozwolone w tabeli 2.2 obowiązują bez zmian.

### 2.7 Porównanie obu baz — `compare.sh`

Porównanie **tylko na zamrożonym źródle**: sekwencje są czytane wprost
(`compare.sh:22-24`, `:200-202`) i nie podlegają migawce transakcji, więc przy
zapisach w tle liczby różniłyby się bez błędu. Obie bazy są zamrożone (2.2,
2.6). Wiersze ekranu (same liczby i hashe) zapisujemy do pliku obok logów:

```bash
set +x
PGHOST='<neon-admin>' PGDATABASE='<baza>' PGUSER='<rola właściciela Neona>' PGPASSWORD="$NEON_OWNER_PW" PGSSLMODE=verify-full PGSSLROOTCERT='<plik CA>' infra/db/cutover/compare.sh > "$HOME/secure/cutover-cmp-neon.txt"
NEON_SCHEMA="$(ls -t "$HOME"/secure/cutover-compare-*.schema.sql | head -n 1)"
PGHOST=127.0.0.1 PGPORT='<port tunelu>' PGDATABASE='<baza Cloud SQL>' PGUSER='<rola właściciela Cloud SQL>' PGPASSWORD="$CSQL_OWNER_PW" PGSSLMODE=disable infra/db/cutover/compare.sh --schema-baseline="$NEON_SCHEMA" > "$HOME/secure/cutover-cmp-csql.txt"
tail -n 1 "$HOME/secure/cutover-cmp-neon.txt" "$HOME/secure/cutover-cmp-csql.txt"
diff "$HOME/secure/cutover-cmp-neon.txt" "$HOME/secure/cutover-cmp-csql.txt"
```

`NEON_SCHEMA` = najnowszy plik `.schema.sql`, czyli ten z przebiegu Neona
uruchomionego wiersz wyżej: nazwa zawiera czas UTC i pid
(`compare.sh:58-59`), plik powstaje obok logu w trybie porównania
(`compare.sh:238-239`), a `--expect-empty` z 2.3 go nie tworzy
(`compare.sh:258-294`). Wiersz `NEON_SCHEMA=` musi iść **zaraz po** przebiegu
Neona, przed jakimkolwiek innym uruchomieniem `compare.sh`.

Ekran idzie do plików, więc `tail -n 1` sprawdza zakończenie: oczekiwane
`exit=0` w **obu** plikach. Inny ostatni wiersz = kody poniżej; bez `exit=0`
obu plików `diff` nie rozstrzyga niczego.

Warunki przejścia dalej:

- `exit=0` obu przebiegów i `schema_equal=yes` (kod 6 = `schema_equal=no`,
  diff schematu obok logu — `compare.sh:246-254`); stop przy 6;
- równe: `count_*` (poza trzema tabelami bez danych: na Cloud SQL `count_session`,
  `count_verification`, `count_auth_rate_limit` = 0), `rows_hash_*` (liczone bez
  tych trzech tabel — `compare.sh:198`), `last_value_*`, `rls_*`, `force_rls_*`,
  `policies_*`, `grants_count`, `grants_sha256`, `migrations_count`,
  `migrations_sha256`;
- `grants_count` > 0 (uprawnienia roli aplikacji istnieją, `compare.sh:218-219`);
- `count_salons` > 0 (warunek następnego kroku);
- różnią się wyłącznie: `writes_*` (pomocnicze, `compare.sh:25`), `compare_seconds`
  i pozycje z listy dozwolonych różnic z próby generalnej (1.1 pkt 7).
  `extensions_*` i `locale_sha256` różnią się tylko wtedy, gdy są na tej liście
  i para wartości jest **identyczna** jak w próbie. Każda inna różnica = stop
  okna, droga A z przywróceniem kopii 2.4.

Kody `compare.sh` (`:47-50`): 1 → `error_class` (np. 42501 przy roli objętej
RLS daje `other`, nie przefiltrowane liczby — `:30-33`); 2 → zmienne; 3 →
wiersz spoza wzorca, stop, log lokalnie (`:71-72`); 6 → schemat różny;
130 → powtórzyć (tryb domyślny tylko czyta, `:16-17`).

### 2.8 Izolacja salonów — `rls-check.sh` (Cloud SQL)

**Dopiero po 2.7 z `count_salons` > 0.** Na pustej bazie wynik 0/0/0 nic nie
dowodzi. Jedna transakcja tylko do odczytu (`rls-check.sh:18-31`, `:111`).

```bash
set +x
PGHOST=127.0.0.1 PGPORT='<port tunelu>' PGDATABASE='<baza Cloud SQL>' PGUSER='<rola właściciela Cloud SQL>' PGPASSWORD="$CSQL_OWNER_PW" PGSSLMODE=disable infra/db/cutover/rls-check.sh
```

Oczekiwane (`rls-check.sh:136-138`): `salon_context_empty=yes`,
`app_role_active=yes`, `app_visible_clients=0`, `app_visible_appointments=0`,
`app_visible_salons=0`, `app_role_reset=yes`, `app_rolcanlogin=no`,
`app_rolbypassrls=no`, `app_rolsuper=no`, `rls_fail_closed=yes`, `exit=0`.

| Kod (`rls-check.sh:34-36`) | Co dalej |
|---|---|
| 0 | 2.9 |
| 7 (`rls_fail_closed=no`) | stop okna; nie przełączać ruchu; droga A z przywróceniem kopii 2.4 |
| 1 | brak roli / uprawnienia = błąd, nigdy ciche 0 (`:30-31`); `connection` → powtórzyć, inne → stop, droga A z przywróceniem kopii 2.4 |
| 2 | host ≠ 127.0.0.1 (`:79`) — poprawić zmienne |
| 3, 130 | powtórzyć (skrypt nic nie zapisuje); drugi raz 3 → stop, log lokalnie, droga A z przywróceniem kopii 2.4 |

### 2.9 Przełączenie ruchu aplikacji

**Procedura: osobna procedura zatrzymania zapisów i przełączenia ruchu
(1.0 pkt 1); bez niej okno nie startuje.** Za zgodą właściciela (1.2): ruch
na usługę GCP (DNS `app` i LB, `BETTER_AUTH_URL` / `NEXT_PUBLIC_APP_URL`,
przekierowania OAuth, adresy webhooków) i ingress Cloud Run z powrotem na
`all` (koniec głównej kontroli z 2.1). `BETTER_AUTH_URL` /
`NEXT_PUBLIC_APP_URL` i przekierowania OAuth są ustawiane przed oknem (procedura
zatrzymania zapisów, sekcja 1: P4, P5, P8), w oknie tylko odczyt. Neon zostaje zamrożony, więc aplikacja
na Vercelu nie zapisze. Do 2.10 zapisy na GCP kończą się błędem tylko do
odczytu — ten odcinek ma być krótki. Stop od tej chwili do 2.10: najpierw
odczyt stanu (blok w 2.10); `on` → droga B (cofnięcie przełączenia, potem
droga A), `off` → droga C.

### 2.10 Odmrożenie Cloud SQL — `unfreeze-neon.sh` przez tunel

Te same zmienne co w 2.6 (`PG*` = `postgres` z `$CSQL_ADMIN_PW`,
`VERIFY_PG*` = `myhelper_svc` z `$CSQL_OWNER_PW`), skrypt
`unfreeze-neon.sh`:

```bash
set +x
PGHOST=127.0.0.1 PGPORT='<port tunelu>' PGDATABASE='<baza Cloud SQL>' PGUSER=postgres PGPASSWORD="$CSQL_ADMIN_PW" PGSSLMODE=disable VERIFY_PGHOST=127.0.0.1 VERIFY_PGPORT='<port tunelu>' VERIFY_PGDATABASE='<baza Cloud SQL>' VERIFY_PGUSER=myhelper_svc VERIFY_PGPASSWORD="$CSQL_OWNER_PW" VERIFY_PGSSLMODE=disable infra/db/cutover/unfreeze-neon.sh --dry-run
```

Oczekiwane `dry_run=yes`, `steps=5`, `exit=0` (`unfreeze-neon.sh:46`,
`:144-148`). Potem ten sam wiersz bez `--dry-run`. Oczekiwane `pooler=no`,
`unfrozen=yes`, `exit=0` (`unfreeze-neon.sh:29-45`). Zrywanie po bazie kończy
połączenia z czasu zamrożenia, które inaczej zostałyby tylko do odczytu
(`unfreeze-neon.sh:34-37`).

**Odczyt stanu** (gdy tabela niżej go wymaga) — nowe połączenie loginem
aplikacji:

```bash
set +x
psql_csql_app <<'SQL'
SELECT current_setting('default_transaction_read_only');
SQL
```

`on` = Cloud SQL nadal zamrożony → droga B. `off` = odmrożony, aplikacja mogła
zapisać → droga C. Odczyt bez wyniku = stop, ruch bez zmian, decyzja
właściciela na miejscu. Do drogi B nie prowadzi żaden kod bez odczytu
(Wycofanie, droga B).

| Kod | Stan (`unfreeze-neon.sh:52-62`) | Co dalej |
|---|---|---|
| 0 | odmrożona | wznowić zadania Scheduler (decyzja właściciela); koniec okna: tunel i hasła (1.5, 1.6) |
| 2 | bez połączenia, nadal zamrożona | poprawić zmienne, powtórzyć; gdy powtórzenia nie pomagają → odczyt stanu: `on` → droga B, `off` → droga C |
| 7 | baza bez zmian; rola ma własne ustawienie (`:30`, `:53-54`) | odczyt stanu: `on` → droga B, `off` → droga C (login aplikacji zapisuje od 2.9) |
| 1 lub 3 bez `stats_visible=1` | bez zmian (`:53-54`) | `connection` → powtórzyć; inne albo kod 3 (log lokalnie) → odczyt stanu: `on` → droga B, `off` → droga C |
| 1 lub 3 po `stats_visible=1`, bez `backends_before` | może być już odmrożona (`:55-58`) | powtórzyć raz; drugi raz ≠ 0 → odczyt stanu: `on` → droga B, `off` → droga C |
| 8 | odmrożona, część sesji żyje tylko do odczytu (`:59-60`) | jedno ponowne uruchomienie; drugi raz 8 → droga C: ponowne `unfreeze-neon.sh` co 5 min, najwyżej 3 razy; potem okno zamknięte z zapisem w notatce, sesje do wyjaśnienia w dzień |
| 9 lub 1 po `backends_before` | odmrożona, test na adresie aplikacji nie potwierdził (`:61-62`) | odczyt stanu: `on` → droga B, `off` → droga C i jedno ponowne uruchomienie |
| 130 | jak kod 1 w miejscu ostatniego wiersza | według wierszy wyżej |

## 3. Powrót — kopia wsteczna Cloud SQL → Neon

### 3.1 Kiedy wolno

- Tylko po przełączeniu, gdy na Cloud SQL były albo mogły być zapisy aplikacji
  (droga C w sekcji 2; przed nią wycofanie opisują drogi A i B), w okresie
  powrotu (kopia „przed importem” istnieje — `docs/runbook-krok-d.md` sekcja
  3.6a).
- Próba generalna kopii wstecznej zapisana w `docs/drills/` z
  `target_frozen=yes` na prawdziwym Neonie (1.1 pkt 2).
- Polecenia kopii Cloud SQL „przed powrotem”, gałęzi Neona „przed powrotem”
  i przywrócenia z nich potwierdzone w próbie generalnej (1.1 pkt 8).
- Osobna zgoda właściciela (1.2), zadania Scheduler wstrzymane.

Osobny skrypt, nie flaga kopii w przód: reguły hostów są odwrotne, więc zamiana
zmiennych w którymkolwiek skrypcie kończy się kodem 2 bez połączenia
(`copy-cloudsql-to-neon.sh:12-15`). Kopii w przód nie zmieniamy ani nie
luzujemy na potrzeby powrotu.

### 3.2 Adresy

- Źródło `PG*` = Cloud SQL, **dokładnie** `PGHOST=127.0.0.1`
  (`copy-cloudsql-to-neon.sh:36-38`, `:143-144`).
- Cel `TARGET_PG*` = Neon: **`TARGET_PGHOST` = pełna nazwa endpointu Neona**
  (`<neon-admin>`, bez `-pooler.`), `TARGET_PGSSLMODE=verify-full`
  (`:145-150`). `localhost` jest dopuszczony wyłącznie dla testu CI (`:46-47`) —
  w oknie nigdy: `localhost` trafia w tunel Cloud SQL i omija wymóg
  `verify-full`.
- `TARGET_PGUSER` = rola właściciela tabel na Neonie (ta sama co adres
  administracyjny zamrożenia); inna rola dostaje błąd przy czyszczeniu —
  bezpieczny wynik (`:39-42`).

### 3.3 Kolejność

Przygotowanie terminala jak w sekcji 1 (1.7 → 1.5 → 1.6).

1. Zatrzymanie zapisów — według osobnej procedury z 1.0 pkt 1 (bez niej okno
   powrotu nie startuje), każdy punkt z wynikiem w notatce okna: **ingress
   Cloud Run = `internal`** (główna kontrola: usługa GCP jest w powrocie
   jedyną żywą aplikacją; zamrożenie w kroku 2 to obrona w głąb), zadania
   Scheduler wstrzymane, Preview Vercela bez zapisu do produkcyjnego Neona.
2. Zamrożenie Cloud SQL — `freeze-neon.sh`, zmienne jak w 2.6:

   ```bash
   set +x
   PGHOST=127.0.0.1 PGPORT='<port tunelu>' PGDATABASE='<baza Cloud SQL>' PGUSER=postgres PGPASSWORD="$CSQL_ADMIN_PW" PGSSLMODE=disable VERIFY_PGHOST=127.0.0.1 VERIFY_PGPORT='<port tunelu>' VERIFY_PGDATABASE='<baza Cloud SQL>' VERIFY_PGUSER=myhelper_svc VERIFY_PGPASSWORD="$CSQL_OWNER_PW" VERIFY_PGSSLMODE=disable infra/db/cutover/freeze-neon.sh --dry-run
   ```

   Potem ten sam wiersz bez `--dry-run`; kody jak w 2.2, przy czym „stop” =
   koniec okna powrotu: `unfreeze-neon.sh` na Cloud SQL (blok 2.10), ingress
   `all` i Scheduler według osobnej procedury; ruch zostaje na GCP.
3. `compare.sh --all-tables` na Cloud SQL dwa razy, w odstępie co najmniej
   2 min; oba wyniki (poza `compare_seconds`) równe — baza stoi. Pierwszy
   przebieg:

   ```bash
   set +x
   PGHOST=127.0.0.1 PGPORT='<port tunelu>' PGDATABASE='<baza Cloud SQL>' PGUSER='<rola właściciela Cloud SQL>' PGPASSWORD="$CSQL_OWNER_PW" PGSSLMODE=disable infra/db/cutover/compare.sh --all-tables > "$HOME/secure/cutover-cmp-csql-t0.txt"
   ```

   Co najmniej 2 min później drugi przebieg i zaraz po nim zapamiętanie jego
   pliku schematu:

   ```bash
   set +x
   PGHOST=127.0.0.1 PGPORT='<port tunelu>' PGDATABASE='<baza Cloud SQL>' PGUSER='<rola właściciela Cloud SQL>' PGPASSWORD="$CSQL_OWNER_PW" PGSSLMODE=disable infra/db/cutover/compare.sh --all-tables > "$HOME/secure/cutover-cmp-csql-t1.txt"
   CSQL_SCHEMA="$(ls -t "$HOME"/secure/cutover-compare-*.schema.sql | head -n 1)"
   tail -n 1 "$HOME/secure/cutover-cmp-csql-t0.txt" "$HOME/secure/cutover-cmp-csql-t1.txt"
   diff "$HOME/secure/cutover-cmp-csql-t0.txt" "$HOME/secure/cutover-cmp-csql-t1.txt"
   ```

   Oczekiwane: `exit=0` w obu plikach (`tail -n 1`), `diff` tylko w `compare_seconds`.
   `CSQL_SCHEMA` = plik `.schema.sql` drugiego przebiegu (najnowszy, nazwa z
   czasem UTC i pid — `compare.sh:58-59`, `:238-239`).
4. Za zgodą właściciela: kopia na żądanie Cloud SQL „przed powrotem” i gałąź
   Neona „przed powrotem” (cofnięcie samego powrotu). Kopia Cloud SQL — bloki
   z 2.4 z opisem `pre-return-<RRRRMMDD>` i zmienną `PRE_RETURN_ID`:

   ```bash
   set +x
   : "${CSQL_INSTANCE:?}" && gcloud --project='<projekt GCP>' sql backups create --instance="$CSQL_INSTANCE" --description='pre-return-<RRRRMMDD>'
   : "${CSQL_INSTANCE:?}" && gcloud --project='<projekt GCP>' sql backups list --instance="$CSQL_INSTANCE" --filter="description='pre-return-<RRRRMMDD>'" --format='value(id,status,description)'
   ```

   Oczekiwane: jeden wiersz `<ID> SUCCESSFUL pre-return-<RRRRMMDD>`; ID do
   notatki okna i do `PRE_RETURN_ID='<ID z listy>'`. Przywrócenie — blok
   „Przywrócenie” z 2.4 z `PRE_RETURN_ID` zamiast `PRE_IMPORT_ID`; po nim
   Cloud SQL jest **zamrożony** (kopia powstała po kroku 2, a zamrożenie
   siedzi w kopii instancji — `freeze-neon.sh:37-38`; inaczej niż po kopii
   „przed importem”, 1.1 pkt 4). Kontrola po przywróceniu `psql_csql_app`
   (1.6) z `SELECT current_setting('default_transaction_read_only');` =
   `on`; inny wynik = stop. Czas życia jak kopii „przed importem”
   (`docs/runbook-krok-d.md` sekcja 3.6a).

   Gałąź Neona „przed powrotem” — z gałęzi `NEON_BRANCH` (w oknie gałąź
   produkcyjna, 1.5), bez własnego endpointu (Neon jest zamrożony od 2.2,
   więc gałąź też). Do potwierdzenia w próbie, sekcja 0; w próbie wiersz
   `create` z prefiksem `drill_neon_guard &&` (1.1):

   ```bash
   set +x
   : "${NEON_BRANCH:?}" && neonctl branches create --project-id '<projekt Neona>' --parent "$NEON_BRANCH" --name 'pre-return-<RRRRMMDD>' --no-compute
   neonctl branches get 'pre-return-<RRRRMMDD>' --project-id '<projekt Neona>'
   ```

   Oczekiwane: utworzenie bez błędu; `get` pokazuje gałąź
   `pre-return-<RRRRMMDD>` z rodzicem = `NEON_BRANCH`. Błąd = stop okna
   powrotu (jak „stop” w kroku 2).
5. `compare.sh` na Neonie z `--schema-baseline="$CSQL_SCHEMA"` (plik z kroku
   3; między krokiem 3 a tym krokiem żadnego innego uruchomienia `compare.sh`):

   ```bash
   set +x
   PGHOST='<neon-admin>' PGDATABASE='<baza>' PGUSER='<rola właściciela Neona>' PGPASSWORD="$NEON_OWNER_PW" PGSSLMODE=verify-full PGSSLROOTCERT='<plik CA>' infra/db/cutover/compare.sh --schema-baseline="$CSQL_SCHEMA" > "$HOME/secure/cutover-cmp-neon-r.txt"
   tail -n 1 "$HOME/secure/cutover-cmp-neon-r.txt"
   ```

   Wymagane: ostatni wiersz `exit=0`, `schema_equal=yes` i `migrations_sha256`
   równe wynikowi Cloud SQL z kroku 3. Cloud SQL ma migracje, których nie ma
   Neon = stop; migracje na Neonie to osobny krok z osobną decyzją, nigdy w
   tym skrypcie.
6. Ponowne `freeze-neon.sh` na Neonie (zmienne jak 2.2): zrywa sesje z czasu
   zamrożenia (`freeze-neon.sh:264-266`).

   ```bash
   set +x
   PGHOST='<neon-admin>' PGDATABASE='<baza>' PGUSER='<rola właściciela Neona>' PGPASSWORD="$NEON_OWNER_PW" PGSSLMODE=verify-full PGSSLROOTCERT='<plik CA>' VERIFY_PGHOST='<neon-pooler>' VERIFY_PGDATABASE='<baza>' VERIFY_PGUSER='<rola aplikacji Neona>' VERIFY_PGPASSWORD="$NEON_APP_PW" VERIFY_PGSSLMODE=verify-full infra/db/cutover/freeze-neon.sh --dry-run
   ```

   Potem ten sam wiersz bez `--dry-run` (w próbie z prefiksem
   `drill_neon_guard &&`, 1.1); oczekiwane `frozen=yes`, `exit=0`.
7. `copy-cloudsql-to-neon.sh` (3.4). W próbie po kodzie 0 — przywrócenie
   gałęzi z „Stop w kroku 7 albo 8” z kontrolami, potem 3.4 jeszcze raz
   (1.1 pkt 8).
8. `compare.sh` na obu bazach, bez `--all-tables`, do osobnych plików `-r2`
   (pliki 2.7 zostają nienadpisane do usunięcia z sekcji 4). Bazą wzorcową
   schematu jest Cloud SQL (źródło kopii); jego przebieg idzie pierwszy:

   ```bash
   set +x
   PGHOST=127.0.0.1 PGPORT='<port tunelu>' PGDATABASE='<baza Cloud SQL>' PGUSER='<rola właściciela Cloud SQL>' PGPASSWORD="$CSQL_OWNER_PW" PGSSLMODE=disable infra/db/cutover/compare.sh > "$HOME/secure/cutover-cmp-csql-r2.txt"
   CSQL_SCHEMA_R2="$(ls -t "$HOME"/secure/cutover-compare-*.schema.sql | head -n 1)"
   PGHOST='<neon-admin>' PGDATABASE='<baza>' PGUSER='<rola właściciela Neona>' PGPASSWORD="$NEON_OWNER_PW" PGSSLMODE=verify-full PGSSLROOTCERT='<plik CA>' infra/db/cutover/compare.sh --schema-baseline="$CSQL_SCHEMA_R2" > "$HOME/secure/cutover-cmp-neon-r2.txt"
   tail -n 1 "$HOME/secure/cutover-cmp-csql-r2.txt" "$HOME/secure/cutover-cmp-neon-r2.txt"
   diff "$HOME/secure/cutover-cmp-csql-r2.txt" "$HOME/secure/cutover-cmp-neon-r2.txt"
   ```

   Oczekiwane: `exit=0` w obu plikach, `schema_equal=yes` w pliku Neona;
   wszystko równe poza `count_session`, `count_verification`,
   `count_auth_rate_limit` (Neon 0 — kopia czyści wszystkie tabele, a tych
   trzech nie przenosi: `sql/reverse-pre.sql:9-12`,
   `copy-cloudsql-to-neon.sh:378`), `writes_*`, `compare_seconds`, wierszem
   `schema_equal` (tylko w pliku z `--schema-baseline`) i dozwolonymi
   różnicami z próby generalnej. `rls_*`, `policies_*`, `grants_*` równe.
   `rls-check.sh` działa tylko na 127.0.0.1 (`rls-check.sh:79`) — na Neonie go
   nie uruchamiamy.
9. `unfreeze-neon.sh` na Neonie (zmienne jak 2.2). Krok 1 skryptu sprawdza też
   `role_override` (kod 7, `unfreeze-neon.sh:30`, `:222-232`) — tej kontroli
   kopia wsteczna po zatwierdzeniu nie robi (`copy-cloudsql-to-neon.sh:396-401`
   sprawdza tylko zamrożenie).

   ```bash
   set +x
   PGHOST='<neon-admin>' PGDATABASE='<baza>' PGUSER='<rola właściciela Neona>' PGPASSWORD="$NEON_OWNER_PW" PGSSLMODE=verify-full PGSSLROOTCERT='<plik CA>' VERIFY_PGHOST='<neon-pooler>' VERIFY_PGDATABASE='<baza>' VERIFY_PGUSER='<rola aplikacji Neona>' VERIFY_PGPASSWORD="$NEON_APP_PW" VERIFY_PGSSLMODE=verify-full infra/db/cutover/unfreeze-neon.sh --dry-run
   ```

   Potem ten sam wiersz bez `--dry-run` (w próbie z prefiksem
   `drill_neon_guard &&`, 1.1); oczekiwane `pooler=yes`,
   `unfrozen=yes`, `exit=0`. Kody jak w 2.10, z odczytem stanu przez
   `psql_neon_app`.
10. Ruch wraca na Vercel (cofnięcie przełączenia z 2.9) według osobnej
    procedury z 1.0 pkt 1; ingress Cloud Run zostaje `internal`.
11. Cloud SQL **zostaje zamrożony**, zadania Scheduler wstrzymane — do
    decyzji; bez dwóch źródeł prawdy. Tunel i hasła: koniec z 1.5 i 1.6.
    **W próbie bez końca tunelu i haseł w tym kroku** — przywrócenia
    potrzebują `CSQL_INSTANCE`, tunelu i `psql_csql_app`. Kolejność po kroku
    11 w próbie: 1.1 pkt 8 (przywrócenie Cloud SQL z `pre-return`), 1.1 pkt 4
    (przywrócenie z `pre-import`), usunięcie instancji próbnej (1.1), potem
    koniec tunelu i haseł z 1.5 i 1.6, na końcu `unset` z 1.1 („Na końcu
    próby”). Bloku klonu z 1.1 nie wkleja się ponownie (uruchomiłby drugi
    `instances clone`).

**Stop w kroku 7 albo 8 = Neona nie odmrażamy.** Wtedy jedno z dwóch:
ponowne uruchomienie kopii (po sukcesie jest idempotentne —
`copy-cloudsql-to-neon.sh:80`) albo przywrócenie gałęzi `NEON_BRANCH` (w oknie
produkcyjnej) z gałęzi „przed powrotem”. Do potwierdzenia w próbie, sekcja 0;
w próbie z prefiksem `drill_neon_guard &&` (1.1):

```bash
set +x
: "${NEON_BRANCH:?}" && neonctl branches restore "$NEON_BRANCH" 'pre-return-<RRRRMMDD>' --project-id '<projekt Neona>' --preserve-under-name 'pre-restore-<RRRRMMDD>'
```

Przywrócenie zostawia endpoint gałęzi `NEON_BRANCH` (ten sam `<neon-admin>`
i `<neon-pooler>`), zrywa otwarte połączenia, a role i hasła wracają do stanu
z chwili utworzenia gałęzi (te same, jeśli w międzyczasie ich nie zmieniano).
Stan sprzed przywrócenia zostaje pod nazwą `pre-restore-<RRRRMMDD>`. Kontrola
po przywróceniu:

1. zamrożenie (gałąź powstała z zamrożonego Neona):

   ```bash
   set +x
   psql_neon_owner <<'SQL'
   SELECT current_setting('default_transaction_read_only');
   SQL
   ```

   Oczekiwane: `on`;
2. `compare.sh` na Neonie (blok kroku 5, do pliku
   `cutover-cmp-neon-r3.txt`) równe `cutover-cmp-neon-r.txt` z kroku 5 poza
   `compare_seconds`.

Potem ruch zostaje na GCP: `unfreeze-neon.sh` na Cloud SQL (blok 2.10),
ingress Cloud Run `all` i wznowienie zadań według osobnej procedury z 1.0
pkt 1.

### 3.4 `copy-cloudsql-to-neon.sh`

Jedna transakcja zapisu na Neonie: `BEGIN READ WRITE`, czyszczenie wszystkich
tabel `public` (RESTRICT), import strumieniem, bramka kompletności (liczby
wierszy i `last_value` równe źródłu), `COMMIT` jako ostatnia instrukcja
(`copy-cloudsql-to-neon.sh:17-32`, `sql/reverse-pre.sql:15-21`,
`sql/reverse-post.sql:14-64`). Inne sesje Neona zostają tylko do odczytu
(`sql/reverse-pre.sql:7-8`).

```bash
set +x
PGHOST=127.0.0.1 PGPORT='<port tunelu>' PGDATABASE='<baza Cloud SQL>' PGUSER='<rola właściciela Cloud SQL>' PGPASSWORD="$CSQL_OWNER_PW" PGSSLMODE=disable TARGET_PGHOST='<neon-admin>' TARGET_PGDATABASE='<baza>' TARGET_PGUSER='<rola właściciela Neona>' TARGET_PGPASSWORD="$NEON_OWNER_PW" TARGET_PGSSLMODE=verify-full PGSSLROOTCERT='<plik CA>' infra/db/cutover/copy-cloudsql-to-neon.sh --dry-run
```

Potem bez `--dry-run` (w próbie z prefiksem `drill_neon_guard &&`, 1.1).
Oczekiwane (`:51-66`): `source_frozen=yes`,
`source_role_override=0`, `target_role_override=0`, `target_frozen=yes`,
`fk_cycle_tables=0`, `source_nonempty_tables` > 0, `truncated_tables`,
`dump_exit=0`, `restore_exit=0`, `target_frozen_after=yes`, `loaded=yes`,
`copy_seconds`, `exit=0`.

**Kod 1 albo 8 przy `restore_exit=0` = dane już zatwierdzone na Neonie →
stop przed odmrożeniem, decyzja po porównaniu baz** (`:77-79`).

| Kod (`:69-72`) | Stan Neona (`:74-79`) | Co dalej |
|---|---|---|
| 0 | dane z Cloud SQL, Neon zamrożony | krok 8 (3.3) |
| 2 | bez połączenia | poprawić zmienne, powtórzyć |
| 4 | bez zmian; `neon.*` po złej stronie (`:276-278`) | w oknie: stop, sprawdzić zmienne; w próbie generalnej na prawdziwym Neonie: stop, decyzja architektury, bez luzowania sondy |
| 5 | bez zmian; puste źródło (`:358-359`) | stop — puste źródło nie może wyzerować Neona |
| 6 | bez zmian; Cloud SQL niezamrożony po kroku 2 (`:279-282`) — anomalia, dane Cloud SQL mogły się zmienić | stop; ustalić, kto i czym odmroził Cloud SQL (ingress z kroku 1, Scheduler); potem kroki 2, 3 (T0/T1) i 5 (3.3) od nowa |
| 7 | bez zmian; `role_override` ≠ 0 (`:284-286`) | stop; decyzja |
| 8 przed strumieniem (`target_frozen=no`) | bez zmian (`:287-290`) | krok 6 (3.3), powtórzyć |
| 1 bez wiersza `restore_exit` | bez zmian (`:75-76`) | `circular_fk` → stop; `connection` → powtórzyć; inne → stop |
| 3 bez wiersza `restore_exit` | bez zmian (`:75-76`, `:103-104`) | stop, log lokalnie (sekcja 0) |
| 1 z `restore_exit` ≠ 0 | bez zmian — transakcja bez zatwierdzenia (`:75-76`, `:388-390`) | przyczyna z `error_class` (np. blokada po 10 s, `sql/reverse-pre.sql:16`); powtórzyć albo stop |
| 1 z `restore_exit=0` | **zatwierdzone** (padł tylko `pg_dump` po bramce, `:77-78`, `:391-393`) | stop przed odmrożeniem; `compare.sh` obu baz (blok kroku 8); decyzja: dalej (krok 9) albo gałąź „przed powrotem” |
| 8 po `restore_exit=0` (`target_frozen_after=no`) | **zatwierdzone**, Neon niezamrożony (`:396-400`) | stop przed odmrożeniem; zamrozić Neona (blok kroku 6); `compare.sh` obu baz (blok kroku 8); decyzja |
| 130 | bez wiersza `restore_exit`: nieustalony | nie odmrażać; `compare.sh` obu baz (blok kroku 8) rozstrzyga, czy import się zatwierdził |

## 4. Logi i dane osobowe

- Każdy skrypt pisze pełny wynik narzędzi do `$HOME/secure/cutover-<skrypt>-<UTC>-<pid>.log`
  (katalog 0700, `umask 077`: `freeze-neon.sh:70-74`, `copy-neon-to-cloudsql.sh:65-73`,
  `copy-cloudsql-to-neon.sh:86-94`). Log kopii i porównania **zawiera szczegóły
  błędów serwera z wartościami wierszy, czyli dane osobowe** klientów salonów
  (`copy-neon-to-cloudsql.sh:7-8`, `compare.sh:7-8`, `copy-cloudsql-to-neon.sh:8-9`).
  Obok logów `compare.sh` zostawia `.schema.sql` i `.schema.diff`
  (`compare.sh:238-246`). Log tunelu `cutover-proxy.log` (1.5) zawiera nazwę
  połączenia instancji.
- **Zakaz wklejania** logów i ich fragmentów do zgłoszeń, komentarzy PR, notatki
  okna i czatu. Na zewnątrz idą wyłącznie wiersze z ekranu: liczby, kody wyjścia,
  klasy błędów, hashe. Log czyta tylko właściciel, lokalnie.
- **Usunięcie po decyzji**, której dotyczą (po oknie w przód — po decyzji o
  zakończeniu okresu powrotu; po powrocie — po decyzji po porównaniu baz),
  najpóźniej 14 dni po oknie, którego dotyczą. Tylko pliki okna, nie inne
  pliki z `$HOME/secure`:

  ```bash
  rm -f "$HOME"/secure/cutover-*
  ls "$HOME"/secure | grep -c '^cutover-'
  ```

  Oczekiwane: `0`. Usunięcie pliku na APFS nie jest bezpiecznym wymazaniem —
  ochroną jest szyfrowanie dysku (`docs/runbook-krok-d.md` sekcja 5).

## 5. Kody wyjścia wszystkich skryptów (z nagłówków)

| Kod | `freeze-neon.sh` / `unfreeze-neon.sh` | `copy-neon-to-cloudsql.sh` | `rls-check.sh` | `compare.sh` | `copy-cloudsql-to-neon.sh` |
|---|---|---|---|---|---|
| 0 | OK | OK | OK | OK | OK |
| 1 | błąd bazy (`error_class`) | błąd bazy albo strumienia (`error_class`) | błąd bazy (`error_class`) | błąd bazy (`error_class`) | błąd bazy albo strumienia (`error_class`) |
| 2 | argumenty albo środowisko | argumenty albo środowisko | argumenty albo środowisko | argumenty albo środowisko | argumenty albo środowisko |
| 3 | wiersz spoza wzorca (`rejected_line=1`, bez `error_class`) | jak obok | jak obok | jak obok | wiersz niezgodny ze wzorcem |
| 4 | — | cel z ustawieniami `neon.*` | — | `--expect-empty` poza 127.0.0.1 albo na Neonie | zły serwer (`neon.*` po złej stronie) |
| 5 | — | cel niepusty | — | `expect_empty=no` | puste źródło |
| 6 | — | — | — | `schema_equal=no` | źródło niezamrożone |
| 7 | `role_override` ≠ 0 | — | `rls_fail_closed=no` | — | `role_override` ≠ 0 |
| 8 | `terminated` < `backends_before` | — | — | — | cel niezamrożony (przed strumieniem albo po nim) |
| 9 | test zapisu niezgodny | — | — | — | — |
| 130 | przerwanie (trap) | przerwanie (trap) | przerwanie (trap) | przerwanie (trap) | przerwanie (trap) |

Źródła: `freeze-neon.sh:52-54`, `unfreeze-neon.sh:48-50`,
`copy-neon-to-cloudsql.sh:49-51`, `rls-check.sh:34-36`, `compare.sh:47-50`,
`copy-cloudsql-to-neon.sh:69-72`; kod 130 z pułapki sygnałów:
`freeze-neon.sh:91`, `unfreeze-neon.sh:89`, `copy-neon-to-cloudsql.sh:88`,
`rls-check.sh:63`, `compare.sh:77`, `copy-cloudsql-to-neon.sh:109`.
Liczba kroków w `--dry-run`: zamrożenie i odmrożenie 5, kopia w przód 3,
`rls-check.sh` 1, `compare.sh` 2 (z `--schema-baseline` albo `--expect-empty` 3),
kopia wsteczna 7 (`freeze-neon.sh:50`, `unfreeze-neon.sh:46`,
`copy-neon-to-cloudsql.sh:47`, `rls-check.sh:32`, `compare.sh:117-127`,
`copy-cloudsql-to-neon.sh:67`).
