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
  W blokach są wyłącznie symbole zastępcze w `<…>`; prawdziwych nazw hostów i
  haseł nie zapisuje się w repo, w notatce okna ani w zgłoszeniach.

## 1. Warunki przed oknem

Okno nie startuje, dopóki każdy punkt nie ma wyniku zapisanego w notatce okna.

### 1.0 Warunki wstępne — przed próbą generalną i przed oknem

1. **Osobna procedura zatrzymania zapisów i przełączenia ruchu** (osobny
   dokument, nie ten runbook): zatrzymanie zapisów — Vercel Production i
   Preview, crony Vercela, ingress Cloud Run, zadania Cloud Scheduler;
   przełączenie ruchu — DNS `app` i LB (`docs/runbook-krok-d.md` sekcja 10a),
   `BETTER_AUTH_URL` / `NEXT_PUBLIC_APP_URL`, adresy przekierowań OAuth.
   Każdy krok z poleceniem i oczekiwanym wynikiem. **Bez tej procedury nie
   startuje ani próba generalna, ani okno.** Ten runbook (2.1, 2.9, 3.3) tylko
   się do niej odwołuje.
2. **Role Cloud SQL w stanie docelowym** — osobny krok wykonywany za zgodą
   właściciela, z recenzją bezpieczeństwa, **przed** próbą generalną (żeby próba
   sprawdziła stan docelowy):
   - login aplikacji zostaje jeden: `myhelper_owner` (aplikacja i migracje,
     `docs/runbook-krok-d.md:167-170`); pula połączeń musi być właścicielem
     tabel (kontrola roli puli), więc osobnego loginu puli nie tworzymy;
   - jako `postgres`: odebranie loginowi aplikacji członkostwa w
     `cloudsqlsuperuser` i nadanie praw tworzenia, bez których po odebraniu
     członkostwa padłyby przyszłe migracje (schemat `public` należy do
     `pg_database_owner`):

     ```sql
     REVOKE cloudsqlsuperuser FROM myhelper_owner;
     GRANT CREATE ON DATABASE myhelper TO myhelper_owner;
     GRANT CREATE ON SCHEMA public TO myhelper_owner;
     ```

   - kontrola po zmianie: 1.3 pkt 4 = `f | f | f`; `pg_tables.tableowner`
     wszystkich tabel `public` = `myhelper_owner`; `rls-check.sh` przechodzi
     (`SET ROLE myhelper_app`, `rls-check.sh:18-31`); przebieg z migracjami
     (`run_migrations=true`) na kopii próbnej zielony;
   - jeśli `REVOKE` jest na Cloud SQL niedozwolony: stop, decyzja architektury
     i bezpieczeństwa przed próbą. Wariantu zapasowego (nowy login + `REASSIGN
     OWNED` + ponowne uprawnienia) nie wykonuje się w trybie awaryjnym;
   - zamrożenie i odmrożenie Cloud SQL (2.6, 2.10, 3.3) wykonuje `postgres`
     (członek właściciela bazy, więc ma `ALTER DATABASE`; usługa go nie
     używa). `myhelper_owner` nie dostaje `pg_read_all_stats` ani
     `pg_signal_backend`.

### 1.1 Próba generalna

Na **gałęzi Neona** (ten sam projekt Neona, ta sama rola właściciela co
produkcja) i na **kopii Cloud SQL** (baza próbna po migracjach, pusta), tymi
samymi skryptami z `main` i w tej samej kolejności co sekcje 2 i 3. Wynik w
`docs/drills/restore-<data>.md`: czas każdego kroku (`copy_seconds`,
`compare_seconds` z ekranu, czas zamrożenia i odmrożenia), wszystkie kody
wyjścia, wyniki kontroli z 1.0 pkt 2 i 1.3–1.6. Bez danych wierszy, bez nazw
hostów. Próba startuje dopiero po spełnieniu obu warunków wstępnych z 1.0.

W próbie generalnej muszą wyjść:

1. Kopia w przód do końca: `copied=yes` (`copy-neon-to-cloudsql.sh:288`),
   porównanie obu baz zgodne jak w kroku 2.7, `rls_fail_closed=yes`.
2. Kopia wsteczna (sekcja 3) z kopii Cloud SQL na ponownie zamrożoną gałąź
   Neona — **co najmniej do `target_frozen=yes`** (`copy-cloudsql-to-neon.sh:291`).
   Dowodzi to, że prawdziwy Neon pokazuje niepuste `neon.timeline_id`
   (`copy-cloudsql-to-neon.sh:238-249`). Kod 4 albo 1 w kroku 1 skryptu na
   prawdziwym Neonie = stop, powrót do decyzji architektury; sondy nie luzujemy
   i zmiennej obejścia nie ma (`copy-cloudsql-to-neon.sh:249`). **Bez tego
   zapisu okno powrotu (sekcja 3) nie startuje.**
3. `freeze-neon.sh` na Cloud SQL przez tunel ze zmiennymi z 2.6 (`PG*` =
   `postgres`, `VERIFY_PG*` = `myhelper_owner`) daje `frozen=yes`. Warunek:
   1.3 pkt 3 dla `postgres` na Cloud SQL = `t | t` (inaczej błąd 42501 —
   `freeze-neon.sh:33-36`). Inny wynik = stop i decyzja przed oknem.
4. Przywrócenie kopii Cloud SQL „przed importem” (2.3) **zdejmuje zamrożenie
   Cloud SQL**: ustawienie z `ALTER DATABASE … SET` siedzi w
   `pg_db_role_setting`, czyli w kopii instancji (`freeze-neon.sh:37-38`).
   Po przywróceniu kopii na kopii próbnej:

   ```sql
   SELECT current_setting('default_transaction_read_only');
   ```

   w nowym połączeniu jako `myhelper_owner`. Oczekiwane: `off`. Wynik w zapisie
   próby — od niego zależy wycofanie z początku sekcji 2.
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
   baz:

   ```sql
   SELECT extname, extversion FROM pg_extension ORDER BY extname;
   SELECT datcollate, datctype, pg_encoding_to_char(encoding) FROM pg_database WHERE datname = current_database();
   ```

   Decyzja architektury przed oknem, jeśli różni się wersja rozszerzenia
   używanego przez schemat `public` (pgvector) albo kodowanie jest inne niż
   `UTF8`. Różnica samego collation jest dopuszczalna: `rows_hash_*` liczy się
   w `COLLATE "C"` (`compare.sh:195`), a indeksy powstają od nowa przy imporcie.

### 1.2 Zgody właściciela potrzebne do okna

Każda zgoda osobno, zapisana w notatce okna przed wykonaniem kroku:

| Zgoda | Krok |
|---|---|
| start okna: zatrzymanie zapisów aplikacji i cronów, ingress Cloud Run `internal`, zamrożenie produkcyjnego Neona | 2.1–2.2 |
| kopia na żądanie Cloud SQL „przed importem” i — w razie potrzeby — przywrócenie z niej | 2.3, 2.4 |
| przełączenie ruchu aplikacji na GCP, ingress Cloud Run z powrotem `all` | 2.9 |
| odmrożenie Cloud SQL (początek zapisów na GCP) | 2.10 |
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
     (`docs/runbook-krok-d.md:747-751`): adres `run.app` przyjmowałby zapisy do
     Cloud SQL w trakcie 2.4–2.6, a wtedy `count_auth_rate_limit` > 0 na
     Cloud SQL i 2.7 stoi. To **główna kontrola** braku zapisów na Cloud SQL;
     zamrożenie w 2.6 jest obroną w głąb;
   - zadania Cloud Scheduler wstrzymane (`docs/runbook-krok-d.md` sekcja 8:
     stan `PAUSED`).
2. Rola logowania aplikacji (adres `VERIFY_PG*`) **nie** jest
   superużytkownikiem — na Neonie i na Cloud SQL (na Cloud SQL to
   `myhelper_owner`, jedyny login aplikacji, `docs/runbook-krok-d.md:167`):

   ```sql
   SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user;
   ```

   Uruchomione jako rola logowania aplikacji. Oczekiwane: `f | f`. Inaczej stop.
3. Rola zamrażająca (adres `PG*` zamrożenia) ma oba uprawnienia potrzebne do
   zamrożenia (widoczność sesji i zrywanie, `freeze-neon.sh:33-44`) — na
   Neonie rola właściciela Neona, na Cloud SQL `postgres` (1.0 pkt 2):

   ```sql
   SELECT pg_has_role(current_user, 'pg_read_all_stats', 'USAGE'), pg_has_role(current_user, 'pg_signal_backend', 'USAGE');
   ```

   Uruchomione jako ta rola, osobno na każdej bazie. Oczekiwane: `t | t` na
   obu. Inaczej stop (skrypt i tak odmówi: kod 1, baza bez zmian); na Cloud
   SQL — decyzja przed oknem.
4. Atrybuty loginu aplikacji na Cloud SQL (`myhelper_owner`, pula połączeń
   usługi): bez superużytkownika, bez `BYPASSRLS`, poza `cloudsqlsuperuser`
   (`MEMBER` sprawdza członkostwo przechodnio):

   ```sql
   SELECT r.rolsuper, r.rolbypassrls, pg_has_role(r.rolname, 'cloudsqlsuperuser', 'MEMBER') FROM pg_roles r WHERE r.rolname = 'myhelper_owner';
   ```

   Oczekiwane: `f | f | f` (stan po 1.0 pkt 2). Inny wynik = stop, decyzja
   przed oknem.
5. Na Cloud SQL żadna baza nie ma podrobionego ustawienia `neon.*` (sonda
   kopii wstecznej opiera się na `neon.timeline_id`,
   `copy-cloudsql-to-neon.sh:238-249`):

   ```sql
   SELECT count(*) FROM pg_db_role_setting WHERE array_to_string(setconfig, ',') LIKE '%neon.%';
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

`docs/runbook-krok-d.md` sekcja 9: `cloud-sql-proxy` na **127.0.0.1**, port
z tamtej sekcji (dalej `<port tunelu>`). Skrypty przyjmują Cloud SQL wyłącznie
pod `127.0.0.1` — nie `localhost`, nie gniazdo:
`copy-neon-to-cloudsql.sh:124-125` (cel), `rls-check.sh:79`,
`compare.sh:110-112` (`--expect-empty`), `copy-cloudsql-to-neon.sh:143-144`
(źródło). Tunel kończy się po oknie (`kill %1`, sekcja 9).

### 1.6 Hasła tylko w środowisku procesu

Hasło trafia do zmiennej powłoki (bez `export`), jest przekazywane jako
przypisanie przed jednym poleceniem i usuwane po oknie. Nie trafia na ekran,
do argumentów, historii ani pliku.

Hasła Neona wpisuje właściciel bez echa:

```bash
set +x
read -rs NEON_OWNER_PW
read -rs NEON_APP_PW
```

Hasła Cloud SQL są wyłącznie w Secret Managerze
(`docs/runbook-krok-d.md:167-174`): `postgres-admin-password` (rola `postgres`)
i `postgres-url` (URL loginu `myhelper_owner`, z którego wycinamy samo hasło).
Odczyt do zmiennej, bez ekranu i bez lokalnego logu gcloud — ten sam wzorzec
co `docs/runbook-krok-d.md:726`. `<projekt GCP>` = identyfikator projektu z
`docs/runbook-krok-d.md` sekcja 9 (nie zapisuje się go w notatce okna):

```bash
set +x
CSQL_ADMIN_PW="$(CLOUDSDK_CORE_DISABLE_FILE_LOGGING=1 gcloud --project='<projekt GCP>' secrets versions access latest --secret=postgres-admin-password)"
CSQL_OWNER_PW="$(CLOUDSDK_CORE_DISABLE_FILE_LOGGING=1 gcloud --project='<projekt GCP>' secrets versions access latest --secret=postgres-url | sed -E 's|^postgresql://[^:/@]+:([^@]+)@.*$|\1|')"
[[ -n "$CSQL_ADMIN_PW" ]] && echo admin_pw_set=yes || echo admin_pw_set=no
[[ "$CSQL_OWNER_PW" =~ ^[A-Za-z0-9]{32}$ ]] && echo owner_pw_format=yes || echo owner_pw_format=no
```

Oczekiwane: `admin_pw_set=yes`, `owner_pw_format=yes` (hasło loginu ma postać
`[A-Za-z0-9]{32}`, `docs/runbook-krok-d.md:167-168`; inna wartość = `sed` nie
wyciął hasła z URL). Kontrola wypisuje tylko `yes`/`no`, nigdy wartości.
Wynik `no` = stop, `unset` i wyjaśnienie przed oknem.

Na końcu okna: `unset NEON_OWNER_PW NEON_APP_PW CSQL_ADMIN_PW CSQL_OWNER_PW`.

Dalej w blokach (symbole zastępcze):

- `<neon-admin>` — pełna nazwa endpointu Neona **bez** `-pooler.` (rola
  właściciela); `<neon-pooler>` — ta sama nazwa z `-pooler.` (rola logowania
  aplikacji). Oba muszą wskazywać ten sam endpoint, inaczej kod 2
  (`freeze-neon.sh:22-25`, `:131-144`).
- `<baza>`, `<rola właściciela Neona>`, `<rola aplikacji Neona>`,
  `<baza Cloud SQL>`, `<rola właściciela Cloud SQL>` = `myhelper_owner`
  z hasłem `$CSQL_OWNER_PW` (dla kopii w przód rola właściciela bazy celu —
  `copy-neon-to-cloudsql.sh:24-26`). Zamrożenie i odmrożenie Cloud SQL:
  `PG*` = `postgres` z `$CSQL_ADMIN_PW`, `VERIFY_PG*` = `myhelper_owner`
  z `$CSQL_OWNER_PW` (1.0 pkt 2).
- `<plik CA>` — plik z 1.4.

## 2. Okno w przód

Kolejność: zatrzymanie zapisów → zamrożenie Neona → kopia na żądanie Cloud SQL
→ kontrola pustości celu → kopia → zamrożenie Cloud SQL → porównanie obu baz →
kontrola izolacji salonów → przełączenie ruchu → odmrożenie Cloud SQL.
**Neon zostaje zamrożony** do decyzji o zakończeniu okresu powrotu.

**Wycofanie przed krokiem 2.10** (na Cloud SQL nie było zapisów aplikacji):
`unfreeze-neon.sh` na Neonie (2.2 — te same zmienne), wznowienie zapisów na
Vercelu według osobnej procedury z 1.0 pkt 1, ruch zostaje na Vercelu; Cloud
SQL przywrócić z kopii „przed importem” (2.3), zanim powstanie następna próba
okna. Przywrócenie zdejmuje też zamrożenie Cloud SQL z 2.6 (potwierdzone w
próbie generalnej, 1.1 pkt 4), więc `unfreeze-neon.sh` na Cloud SQL nie jest
wtedy potrzebny.

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
| 1 lub 3 bez wiersza `stats_visible=1` | baza bez zmian | `error_class=connection` → sprawdzić tunel/CA i powtórzyć; `other` → stop, wznowić zapisy |
| 1 lub 3 po `stats_visible=1`, bez `backends_before` | baza **może być już zamrożona** (`:58-60`) | powtórzyć raz (ponowne uruchomienie na zamrożonej bazie jest dozwolone, `:264-266`); drugi raz ≠ 0 → stop, `unfreeze-neon.sh`, wznowić zapisy |
| 8 | **zamrożona**, część sesji sprzed zamrożenia żyje (`:61-62`, `:291`) | jedno ponowne uruchomienie; drugi raz 8 → stop, `unfreeze-neon.sh`, wznowić zapisy |
| 9 lub 1 po `backends_before` | zamrożona, test na adresie aplikacji nie potwierdził (`:63-64`, `:299-315`) | stop; nie kopiować; `unfreeze-neon.sh`, wznowić zapisy |
| 130 | jak kod 1 w miejscu ostatniego wiersza | według wierszy wyżej |

### 2.3 Kopia na żądanie Cloud SQL „przed importem”

Za zgodą właściciela: kopia na żądanie instancji Cloud SQL **przed** kopią
danych. To jedyna droga cofnięcia importu, który się zatwierdził
(`copy-neon-to-cloudsql.sh:57-59`). Czas życia: `docs/runbook-krok-d.md`
sekcja 3.6a (zostaje do końca okresu powrotu).

### 2.4 Pustość celu — `compare.sh --expect-empty` (Cloud SQL)

Jedyny zapis w `compare.sh`: czyści `public.auth_rate_limit` (wiersze zostawione
przez działającą usługę), potem liczy niepuste tabele (`compare.sh:40-44`,
`:264-293`).

```bash
set +x
PGHOST=127.0.0.1 PGPORT='<port tunelu>' PGDATABASE='<baza Cloud SQL>' PGUSER='<rola właściciela Cloud SQL>' PGPASSWORD="$CSQL_OWNER_PW" PGSSLMODE=disable infra/db/cutover/compare.sh --expect-empty
```

| Kod | Co dalej |
|---|---|
| 0 (`expect_empty=yes`) | 2.5 |
| 4 | host ≠ 127.0.0.1 albo serwer Neona (`compare.sh:49`, `:110-112`, `:259-262`) — poprawić zmienne |
| 5 (`expect_empty=no`, `nonempty_tables=<n>`) | Cloud SQL ma dane — stop; przywrócić z kopii „przed importem” albo decyzja; bez kopii danych |
| 2 | złe zmienne albo argumenty, bez połączenia — poprawić zmienne, powtórzyć |
| 1, 3, 130 | `error_class` decyduje: `connection` → tunel, powtórzyć; inne → stop |

### 2.5 Kopia — `copy-neon-to-cloudsql.sh`

Strumień `pg_dump | pg_restore --single-transaction`, bez pliku pośredniego, bez
danych `auth_rate_limit`, `session`, `verification` (`copy-neon-to-cloudsql.sh:11-18`,
`:271`). Źródło (Neon) tylko do odczytu, adres **bez** poolera
(`:28-30`, `:120-123`); cel tylko `127.0.0.1` (`:124-125`).

```bash
set +x
PGHOST='<neon-admin>' PGDATABASE='<baza>' PGUSER='<rola właściciela Neona>' PGPASSWORD="$NEON_OWNER_PW" PGSSLMODE=verify-full PGSSLROOTCERT='<plik CA>' TARGET_PGHOST=127.0.0.1 TARGET_PGPORT='<port tunelu>' TARGET_PGDATABASE='<baza Cloud SQL>' TARGET_PGUSER=myhelper_owner TARGET_PGPASSWORD="$CSQL_OWNER_PW" TARGET_PGSSLMODE=disable infra/db/cutover/copy-neon-to-cloudsql.sh --dry-run
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
| 5 | cel niepusty (`:232`) | wrócić do 2.4 |
| 1 z `error_class=circular_fk` przed `dump_exit` | bez zmian (`:39-42`, `:259-262`) | stop okna, `unfreeze-neon.sh`, wznowić zapisy |
| 1 lub 3 bez wiersza `dump_exit` | bez zmian | `connection` → powtórzyć; inne → stop |
| 1 z `restore_exit` ≠ 0 | transakcja wycofana, cel bez danych | potwierdzić `compare.sh --expect-empty` (2.4) = 0; przyczyna z `error_class`; powtórzyć albo stop |
| 1 z `restore_exit=0` | **dane zatwierdzone**, cel niepusty (`:57-59`, `:281-286`) | jedyna droga: przywrócenie Cloud SQL z kopii „przed importem” (2.3); potem stop albo nowa próba od 2.4 |
| 130 | nieustalony, jeśli przerwano w strumieniu | `compare.sh --expect-empty`: 0 → cel pusty, można powtórzyć; 5 → jak „1 z `restore_exit=0`” |

### 2.6 Zamrożenie Cloud SQL — `freeze-neon.sh` przez tunel

**Obrona w głąb, nie główna kontrola.** Główną kontrolą braku zapisów na
Cloud SQL jest ingress Cloud Run `internal` od 2.1 do 2.9 (1.3 pkt 1).
Zamrożenia nie da się zrobić przed 2.5, bo kopia zapisuje do celu. Krok
zostaje, bo bez niego `compare.sh` czytałby sekwencje poza migawką transakcji
(`compare.sh:22-24`). Skrypt dopuszcza oba adresy na 127.0.0.1 bez poolera
(`freeze-neon.sh:108-110`, `:135-139`, `:142-144`).

Zamraża `postgres` (`PG*`, hasło `$CSQL_ADMIN_PW`); test zapisu idzie adresem
loginu aplikacji (`VERIFY_PG*` = `myhelper_owner`, hasło `$CSQL_OWNER_PW`) —
1.0 pkt 2, 1.3 pkt 3. Najpierw `--dry-run` (sekcja 0):

```bash
set +x
PGHOST=127.0.0.1 PGPORT='<port tunelu>' PGDATABASE='<baza Cloud SQL>' PGUSER=postgres PGPASSWORD="$CSQL_ADMIN_PW" PGSSLMODE=disable VERIFY_PGHOST=127.0.0.1 VERIFY_PGPORT='<port tunelu>' VERIFY_PGDATABASE='<baza Cloud SQL>' VERIFY_PGUSER=myhelper_owner VERIFY_PGPASSWORD="$CSQL_OWNER_PW" VERIFY_PGSSLMODE=disable infra/db/cutover/freeze-neon.sh --dry-run
```

Oczekiwane `dry_run=yes`, `steps=5`, `exit=0` (`freeze-neon.sh:50`,
`:146-150`). Potem ten sam wiersz bez `--dry-run`. Oczekiwane: `pooler=no`,
`frozen=yes`, `exit=0`.

Kody jak w tabeli 2.2, z jedną zmianą: **każde „stop” w 2.6 = wycofanie z
początku sekcji 2** (odmrożenie Neona, wznowienie zapisów według osobnej
procedury, przywrócenie Cloud SQL z kopii „przed importem”), a nie samo
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
(`compare.sh:238-239`), a `--expect-empty` z 2.4 go nie tworzy
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
  okna (wycofanie jak na początku sekcji 2).

Kody `compare.sh` (`:47-50`): 1 → `error_class` (np. 42501 przy roli objętej
RLS daje `other`, nie przefiltrowane liczby — `:30-33`); 2 → zmienne; 3 →
wiersz spoza wzorca; 6 → schemat różny; 130 → powtórzyć (tryb domyślny tylko
czyta, `:16-17`).

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
| 7 (`rls_fail_closed=no`) | stop okna; nie przełączać ruchu |
| 1 | brak roli / uprawnienia = błąd, nigdy ciche 0 (`:30-31`); `connection` → powtórzyć, inne → stop |
| 2 | host ≠ 127.0.0.1 (`:79`) — poprawić zmienne |
| 3, 130 | powtórzyć (skrypt nic nie zapisuje) |

### 2.9 Przełączenie ruchu aplikacji

**Procedura: osobna procedura zatrzymania zapisów i przełączenia ruchu
(1.0 pkt 1); bez niej okno nie startuje.** Za zgodą właściciela (1.2): ruch
na usługę GCP (DNS `app` i LB, `BETTER_AUTH_URL` / `NEXT_PUBLIC_APP_URL`,
przekierowania OAuth, adresy webhooków) i ingress Cloud Run z powrotem na
`all` (koniec głównej kontroli z 2.1). Neon zostaje zamrożony, więc aplikacja
na Vercelu nie zapisze. Do 2.10 zapisy na GCP kończą się błędem tylko do
odczytu — ten odcinek ma być krótki.

### 2.10 Odmrożenie Cloud SQL — `unfreeze-neon.sh` przez tunel

Te same zmienne co w 2.6 (`PG*` = `postgres` z `$CSQL_ADMIN_PW`,
`VERIFY_PG*` = `myhelper_owner` z `$CSQL_OWNER_PW`), skrypt
`unfreeze-neon.sh`. Najpierw `--dry-run` (sekcja 0): oczekiwane `dry_run=yes`,
`steps=5`, `exit=0` (`unfreeze-neon.sh:46`, `:144-148`). Potem bez
`--dry-run`. Oczekiwane `pooler=no`,
`unfrozen=yes`, `exit=0` (`unfreeze-neon.sh:29-45`). Zrywanie po bazie kończy
połączenia z czasu zamrożenia, które inaczej zostałyby tylko do odczytu
(`unfreeze-neon.sh:34-37`).

| Kod | Stan (`unfreeze-neon.sh:52-62`) | Co dalej |
|---|---|---|
| 0 | odmrożona | wznowić zadania Scheduler (decyzja właściciela); koniec okna |
| 2 | bez połączenia | poprawić zmienne, powtórzyć |
| 7 | bez zmian, nadal zamrożona | stop; decyzja |
| 1 lub 3 bez `stats_visible=1` | bez zmian, nadal zamrożona | `connection` → powtórzyć; inne → stop |
| 1 lub 3 po `stats_visible=1`, bez `backends_before` | może być już odmrożona | powtórzyć raz |
| 8 | odmrożona, część sesji żyje tylko do odczytu | jedno ponowne uruchomienie; drugi raz 8 → stop, decyzja |
| 9 lub 1 po `backends_before` | odmrożona, test na adresie aplikacji nie potwierdził | stop; decyzja |
| 130 | jak kod 1 w miejscu ostatniego wiersza | według wierszy wyżej |

## 3. Powrót — kopia wsteczna Cloud SQL → Neon

### 3.1 Kiedy wolno

- Tylko po przełączeniu, gdy na Cloud SQL były zapisy aplikacji (przed 2.10
  wycofanie opisuje początek sekcji 2), w okresie powrotu (kopia „przed
  importem” istnieje — `docs/runbook-krok-d.md` sekcja 3.6a).
- Próba generalna kopii wstecznej zapisana w `docs/drills/` z
  `target_frozen=yes` na prawdziwym Neonie (1.1 pkt 2).
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

1. Zadania Scheduler wstrzymane, zapisy aplikacji zatrzymane — według osobnej
   procedury z 1.0 pkt 1 (bez niej okno powrotu nie startuje).
2. Zamrożenie Cloud SQL — `freeze-neon.sh` jak w 2.6: te same zmienne
   (`PG*` = `postgres` z `$CSQL_ADMIN_PW`, `VERIFY_PG*` = `myhelper_owner`
   z `$CSQL_OWNER_PW`), najpierw `--dry-run`; kody jak w 2.2.
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
   Neona „przed powrotem” (cofnięcie samego powrotu).
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
6. Ponowne `freeze-neon.sh` na Neonie (jak 2.2): zrywa sesje z czasu
   zamrożenia (`freeze-neon.sh:264-266`).
7. `copy-cloudsql-to-neon.sh` (3.4).
8. `compare.sh` na obu bazach (jak 2.7, bez `--all-tables`): wszystko równe
   poza `count_session`, `count_verification`, `count_auth_rate_limit` (Neon 0
   — kopia czyści wszystkie tabele, a tych trzech nie przenosi:
   `sql/reverse-pre.sql:9-12`, `copy-cloudsql-to-neon.sh:378`), `writes_*`,
   `compare_seconds` i dozwolonych różnic z próby generalnej. `rls_*`,
   `policies_*`, `grants_*` równe. `rls-check.sh` działa tylko na 127.0.0.1
   (`rls-check.sh:79`) — na Neonie go nie uruchamiamy.
9. `unfreeze-neon.sh` na Neonie (zmienne jak 2.2). Krok 1 skryptu sprawdza też
   `role_override` (kod 7, `unfreeze-neon.sh:30`, `:222-232`) — tej kontroli
   kopia wsteczna po zatwierdzeniu nie robi (`copy-cloudsql-to-neon.sh:396-401`
   sprawdza tylko zamrożenie). Kody jak w 2.10.
10. Ruch wraca na Vercel (cofnięcie przełączenia z 2.9) według osobnej
    procedury z 1.0 pkt 1.
11. Cloud SQL **zostaje zamrożony**, zadania Scheduler wstrzymane — do
    decyzji; bez dwóch źródeł prawdy.

Stop w kroku 7 albo 8 = Neona **nie odmrażamy**. Wtedy: przywrócenie gałęzi
Neona „przed powrotem” albo ponowne uruchomienie kopii (po sukcesie jest
idempotentne — `copy-cloudsql-to-neon.sh:80`); ruch zostaje na GCP po
`unfreeze-neon.sh` na Cloud SQL (zmienne jak 2.10) i wznowieniu zadań.

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

Potem bez `--dry-run`. Oczekiwane (`:51-66`): `source_frozen=yes`,
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
| 6 | bez zmian; Cloud SQL niezamrożony (`:279-282`) | krok 2 (3.3), powtórzyć |
| 7 | bez zmian; `role_override` ≠ 0 (`:284-286`) | stop; decyzja |
| 8 przed strumieniem (`target_frozen=no`) | bez zmian (`:287-290`) | krok 6 (3.3), powtórzyć |
| 1 lub 3 bez wiersza `restore_exit` | bez zmian (`:75-76`) | `circular_fk` → stop; `connection` → powtórzyć; inne → stop |
| 1 z `restore_exit` ≠ 0 | bez zmian — transakcja bez zatwierdzenia (`:75-76`, `:388-390`) | przyczyna z `error_class` (np. blokada po 10 s, `sql/reverse-pre.sql:16`); powtórzyć albo stop |
| 1 z `restore_exit=0` | **zatwierdzone** (padł tylko `pg_dump` po bramce, `:77-78`, `:391-393`) | stop przed odmrożeniem; `compare.sh` obu baz; decyzja: dalej (krok 9) albo gałąź „przed powrotem” |
| 8 po `restore_exit=0` (`target_frozen_after=no`) | **zatwierdzone**, Neon niezamrożony (`:396-400`) | stop przed odmrożeniem; zamrozić Neona (2.2); `compare.sh` obu baz; decyzja |
| 130 | bez wiersza `restore_exit`: nieustalony | nie odmrażać; `compare.sh` obu baz rozstrzyga, czy import się zatwierdził |

## 4. Logi i dane osobowe

- Każdy skrypt pisze pełny wynik narzędzi do `$HOME/secure/cutover-<skrypt>-<UTC>-<pid>.log`
  (katalog 0700, `umask 077`: `freeze-neon.sh:70-74`, `copy-neon-to-cloudsql.sh:65-73`,
  `copy-cloudsql-to-neon.sh:86-94`). Log kopii i porównania **zawiera szczegóły
  błędów serwera z wartościami wierszy, czyli dane osobowe** klientów salonów
  (`copy-neon-to-cloudsql.sh:7-8`, `compare.sh:7-8`, `copy-cloudsql-to-neon.sh:8-9`).
  Obok logów `compare.sh` zostawia `.schema.sql` i `.schema.diff`
  (`compare.sh:238-246`).
- **Zakaz wklejania** logów i ich fragmentów do zgłoszeń, komentarzy PR, notatki
  okna i czatu. Na zewnątrz idą wyłącznie wiersze z ekranu: liczby, kody wyjścia,
  klasy błędów, hashe. Log czyta tylko właściciel, lokalnie.
- **Usunięcie po decyzji**, której dotyczą (po oknie w przód — po decyzji o
  zakończeniu okresu powrotu; po powrocie — po decyzji po porównaniu baz),
  najpóźniej 14 dni po przełączeniu. Tylko pliki okna, nie inne pliki z
  `$HOME/secure`:

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
| 3 | wiersz spoza wzorca (`rejected_line=1`) | jak obok | jak obok | jak obok | wiersz niezgodny ze wzorcem |
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
