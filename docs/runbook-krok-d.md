# Runbook — krok D: przygotowanie GCP i pierwsze wdrożenie na Cloud Run

Właściciel dokumentu: Eva (Platform). Recenzja: Ethan (architektura), Ryan (uprawnienia, WIF).
Skrypt: `infra/gcp/bootstrap.sh`, strażnik `__tests__/lib/bootstrap-config.test.ts` (G-D1).
Powiązane: #110, #118, #121, #131, #133; plan 0.5 (dane z Neona).

## 0. Zasady wykonania

- **Kto wykonuje.** Każde polecenie na projekcie `my-helper-2-488419` uruchamia
  wyłącznie **sesja główna**, etap po etapie, zrecenzowaną wersją skryptu z `main`.
  Agenci (w tym Eva) nie uruchamiają gcloud na projekcie, nie dotykają sekretów,
  nie uruchamiają `deploy-cloud-run.yml`.
- **Najpierw dry-run.** Każdy etap: najpierw bez `--apply` (skrypt niczego nie
  wykonuje, także odczytów — wypisuje `? …` dla odczytu stanu i `+ …` dla zmiany),
  porównanie z tym runbookiem, dopiero potem ten sam wiersz z `--apply`.
- **Jeden etap naraz.** Po każdym etapie: odczyt stanu (sekcja 2) i zapis wyniku
  w komentarzu do #121 (bez wartości, bez adresów e-mail).
- **Repo jest publiczne.** W runbooku, komentarzach i opisach PR: żadnych wartości
  sekretów, adresów e-mail, identyfikatorów kont poza już jawnymi (id projektu,
  numer projektu, id repo i właściciela).
- **Sekrety.** Wartość nigdy nie jest argumentem polecenia (nie trafia do `ps`,
  historii powłoki ani logu). Wyłącznie strumień do `--data-file=-` (sekcja 5,
  D-5), nigdy `--data-file=ŚCIEŻKA` (K-1e). Bez `set -x`: każdy blok, który
  dotyka sekretu, zaczyna się od `set +x`; bloki do wklejenia nie mają linii
  komentarza (interaktywny zsh bez `interactivecomments` wykonałby je).
- Polecenie wspólne (dalej `$B`):

```bash
B='infra/gcp/bootstrap.sh --project=my-helper-2-488419 --region=europe-central2'
```

- **Region.** Skrypt przyjmuje wyłącznie `--region=europe-central2` (inna wartość
  = błąd przed pierwszym gcloud; Ethan, #134). Na tym regionie opiera się
  szacunek kosztu i lokalizacja danych.

## 1. Przed startem

1. `gcloud config list` — zalogowane konto sesji głównej z rolą owner; projekt
   NIE jest brany z konfiguracji (skrypt podaje `--project` w każdym wywołaniu).
2. Budżet 300 PLN/mies. z progami 50/90/100% istnieje (stan dzisiejszy).
3. **Koszt przed etapem `sql` (warunek Ethana) — SPEŁNIONY** (Oliver, 2026-11-15).
   Źródło: publiczny katalog cen Google (Cloud Billing Catalog API, usługa
   `9662-B51E-5089`, PLN, netto), `europe-central2`, PostgreSQL Enterprise, zonal:

   | SKU | Pozycja | Stawka | Miesięcznie |
   |---|---|---|---|
   | `E52B-F700-310D` | Micro instance (db-f1-micro) | 0,049823 PLN/h × 730 h | 36,37 PLN |
   | `0743-3BA4-1E28` | Standard storage (SSD) | 0,806657 PLN/GiB | 8,07 PLN (10 GiB); 24,20 PLN (30 GiB) |
   | `D1A5-025C-19C9` | Backups | 0,379603 PLN/GiB | < 1–2 PLN przy małej bazie |
   | `437B-C3AE-F62F` | IP address reservation | 0,047450 PLN/h | 0 przy działającej instancji; najgorzej 34,64 PLN — do potwierdzenia odczytem kosztów po 24 h |

   Oczekiwane ok. 45–47 PLN/mies. netto; najgorszy przypadek (30 GiB, IP
   naliczany stale, kopie 5 PLN) ok. 100 PLN/mies. netto. Próg **200 PLN/mies.
   = stop** — nieprzekroczony. Zmiana tieru lub edycji = nowe wyliczenie
   (strażnik w `bootstrap.sh`).

## 2. Kolejność etapów i odczyt stanu po każdym

Etapy `apis → ar → bucket → secrets → sa → sql → run` mogą ruszyć po recenzji
skryptu (Oliver 19:44) i nie czekają na hook. Etap **`wif` wykonuje się osobno,
później**, z bramką z sekcji 3.8. Etapy `run` i `wif` są od siebie niezależne;
workflow wdrożenia potrzebuje obu.

**Etap `sql` nie rusza bez B-1** (Ryan 6899923012): wersja skryptu musi
wywoływać `sql users set-password` z `CLOUDSDK_CORE_DISABLE_FILE_LOGGING=1`
(inaczej hasła bazy lądują jawnym tekstem w `~/.config/gcloud/logs/`).
Sprawdzenie przed etapem (oczekiwany wynik: `1`):

```bash
grep -c 'CLOUDSDK_CORE_DISABLE_FILE_LOGGING=1 "${GC\[@\]}" sql users' infra/gcp/bootstrap.sh
```

| # | Etap | Polecenie | Odczyt stanu po etapie (oczekiwany wynik) |
|---|---|---|---|
| D-1 | `apis` | `$B --stage=apis [--apply]` | `gcloud --project=my-helper-2-488419 services list --enabled --format='value(config.name)'` zawiera 8 API z sekcji 3.1 |
| D-1b | test `--flags-file` | sekcja 4 | nagłówek ustawiony, job usunięty |
| D-2 | `ar` | `$B --stage=ar [--apply]` | `gcloud --project=… artifacts repositories describe myhelper --location=europe-central2 --format='yaml(format,cleanupPolicies)'` → `DOCKER`, `keep-5-most-recent` + `delete-older`, bez `cleanupPolicyDryRun: true` |
| D-3 | `bucket` | `$B --stage=bucket --bucket=NAZWA [--apply]` | `gcloud --project=… storage buckets describe gs://NAZWA --format='yaml(uniform_bucket_level_access,public_access_prevention)'` → uniform `true`, PAP `inherited`; `… storage buckets get-iam-policy gs://NAZWA` → `allUsers` tylko w `roles/storage.legacyObjectReader` |
| D-4 | `secrets` | `$B --stage=secrets [--apply]` | `gcloud --project=… secrets list --format='value(name)'` → nazwy wszystkich sekretów z manifestu (od K-1: 10, bez `openrouter-api-key`); `… secrets versions list NAZWA` → pusto dla każdej |
| D-4b | `sa` | `$B --stage=sa --bucket=NAZWA [--apply]` | `… iam service-accounts list` → `myhelper-runtime`, `myhelper-deploy`; `… secrets get-iam-policy NAZWA` → runtime jako `secretAccessor`, deploy jako `secretmanager.viewer` na KAŻDYM sekrecie z manifestu; `… projects get-iam-policy my-helper-2-488419` → brak nowych ról na projekcie |
| D-4c | `sql` | po sekcji 1 pkt 3 i sprawdzeniu B-1: `$B --stage=sql [--apply]` | sekcja 3.6 (w tym Policy Troubleshooter) |
| D-4d | `run` | `$B --stage=run [--apply]` | `… run services describe myhelper --region=europe-central2 --format='value(spec.template.spec.serviceAccountName)'` → runtime; `… run services get-iam-policy myhelper --region=…` → `allUsers` invoker, deploy `run.developer`; to samo dla `run jobs … myhelper-migrate` (bez invokera) |
| D-4e | `wif` | **później**, bramka w sekcji 3.8 | `… iam workload-identity-pools providers describe github-actions --workload-identity-pool=github --location=global --format='value(attributeCondition)'` = plik warunku |
| D-5 | wartości sekretów | sekcja 5 | `… secrets versions list NAZWA --format='value(name,state)'` → `1 ENABLED` dla ustawionych |
| D-6 | zmienne GitHub | sekcja 6 | `gh variable list --env production-gcp` |
| D-7 | pierwszy przebieg | sekcja 7 | sekcja 7 |
| D-8 | harmonogram | sekcja 8 | sekcja 8 |

Przebieg z `--apply` jest idempotentny: ponowne uruchomienie etapu nie tworzy
zasobów drugi raz (`state: exists`) i nie zmienia haseł bazy (sekcja 3.6).
Etap `sql` też można powtórzyć: **nie tworzy loginu aplikacji**, a przy jego
braku z `--apply` zatrzymuje się; dry-run pokazuje pełny plan z notą o stopie.

## 2a. Cofanie etapu (sesja główna)

Zasada: najpierw poprawić i **powtórzyć** etap (idempotentny); cofać tylko, gdy
zasób powstał z błędną konfiguracją, której nie da się zmienić w miejscu.
`P=my-helper-2-488419; R=europe-central2`.

| Etap | Cofnięcie | Pułapka |
|---|---|---|
| `run` | `gcloud --project=$P run services delete myhelper --region=$R` i `… run jobs delete myhelper-migrate --region=$R` | wiązania na zasobie znikają razem z nim — powtórzyć cały etap `run` |
| `sql` | padło po utworzeniu instancji → **nie usuwać**; powtórzyć etap (nie tworzy loginu aplikacji — przy jego braku zatrzymuje się; nowa instancja: login i rola `myhelper_app` SQL-em, sekcja 3.6) (skrypt czeka na `RUNNABLE`, a przed bazą i loginami sprawdza stan). Usunięcie tylko po `… sql instances patch myhelper-pg --no-deletion-protection`, potem `… sql instances delete myhelper-pg` | nazwy usuniętej instancji nie da się użyć ponownie przez ok. **tydzień** → nowa nazwa: `--sql-instance=<nowa>`, zmiana `SQL_INSTANCE` w D-6 i nowa wersja `postgres-url` (skrypt ją utworzy, jeśli sekret nie ma wersji, a login `myhelper_svc` na nowej instancji już utworzył SQL-em `postgres` — sekcja 3.6; starą wyłączyć `secrets versions disable`). Wiązania z warunkiem na starą nazwę usunąć (`projects remove-iam-policy-binding … --condition=…`) |
| `sa` | `… remove-iam-policy-binding` dla każdego wiązania z sekcji 3.5 (sekrety, zasobnik, repo, actAs); konta (`iam service-accounts delete`) **dopiero na końcu** | usunięte konto zostawia w politykach wpisy `deleted:serviceAccount:…` — dlatego najpierw wiązania |
| `secrets` | `… secrets delete NAZWA` | usuwa wszystkie wersje — tylko przed D-5 albo z kopią wartości u źródła |
| `bucket` | najpierw `… storage buckets remove-iam-policy-binding gs://NAZWA --member=allUsers --role=roles/storage.legacyObjectReader`; zasobnik usuwać (`storage buckets delete`) tylko pusty | nazwy zasobników są globalne — usunięta może zostać zajęta przez kogoś innego |
| `ar` | `… artifacts repositories delete myhelper --location=$R` | usuwa wszystkie obrazy |
| `wif` | `… iam workload-identity-pools delete github --location=global` | pula usunięta jest miękko przez **30 dni** i nazwa jest zajęta — przywrócenie: `… iam workload-identity-pools undelete github --location=global` |
| `apis` | nie cofać (wyłączenie API niszczy zależne zasoby) | — |

## 3. Etapy — co tworzą i zmieniają

### 3.1 `apis`
Włącza: run, sqladmin, artifactregistry, secretmanager, cloudscheduler,
iamcredentials, sts oraz **iam** (odstępstwo od listy w zleceniu: potrzebne do kont
usługowych, roli własnej i puli WIF). Nic nie wyłącza.

### 3.2 `ar`
Repozytorium Docker `myhelper` w regionie + polityka czyszczenia: z każdego pakietu
(`myhelper`, `myhelper-migrator`) zostaje 5 ostatnich wersji. Polityka bez trybu
`--dry-run` (ten tryb wyłącza usuwanie).

### 3.3 `bucket`
Zasobnik z uniform access, bez blokady dostępu publicznego, `allUsers:
roles/storage.legacyObjectReader` — odczyt obiektu po znanej nazwie, **bez
listowania** (#118 pkt 5; nie `objectViewer`).

#118 pkt 4 (zawężenie `remotePatterns`) — **spełniony** na `main`:
`next.config.ts` dodaje wpis `storage.googleapis.com` tylko gdy przy budowie
ustawiono `GCS_BUCKET`, z `pathname: /<GCS_BUCKET>/**` — pokrywa to test
`__tests__/lib/next-config-gcs.test.ts` (#132).
Na start `vars.GCS_PUBLIC_BASE_URL` zostaje **pusta**: obrazy idą z
`storage.googleapis.com/<bucket>` (Oliver 19:47, #133 pkt 1).

### 3.4 `secrets`
Puste kontenery dla każdego sekretu z manifestu (nazwy z `secretName` w
`infra/gcp/env-manifest.json`; od K-1 10 — `OPENROUTER_API_KEY` jest poza
Secret Manager, klucz skasowany u dostawcy 14.11, AI wraca przez Vertex w kroku F),
replikacja tylko w `europe-central2`. Żadnych wartości.

### 3.5 `sa`
- `myhelper-runtime` (usługa i job migracji): `secretAccessor` osobno na każdym
  sekretów z manifestu, `roles/storage.objectUser` na zasobniku (aplikacja zapisuje,
  czyta metadane i usuwa).
- `myhelper-deploy` (GitHub Actions przez WIF): `artifactregistry.writer` na jednym
  repo, `iam.serviceAccountUser` wyłącznie na koncie runtime,
  `secretmanager.viewer` osobno na każdym sekrecie z manifestu — tylko metadane wersji,
  bez dostępu do wartości (`run-deploy.sh` mapuje wyłącznie sekrety z wersją, K-1).
- Zero ról na poziomie projektu w tym etapie.
- **Zasięg deploy (Ryan, #141):** deploy nie ma `secretAccessor`, ale
  `iam.serviceAccountUser` (actAs) na runtime razem z `run.developer` na usłudze
  i jobie pozwala mu wdrożyć i uruchomić kod jako runtime, czyli pośrednio
  sięgnąć po sekrety i bazę — tak ma każdy wdrażający. Barierą jest warunek WIF
  (sekcja 3.8) i recenzent środowiska `production-gcp` (sekcja 7).

### 3.6 `sql` (decyzja Ethana, #121 komentarz 6899299212)
Strażnik w skrypcie przerywa etap, jeśli edycja ≠ `enterprise` albo tier ≠
`db-f1-micro` (dla PG16–18 domyślna jest Enterprise Plus — bez shared-core,
wielokrotność budżetu).

Tworzy:
- instancję `myhelper-pg`: `--edition=enterprise`, `POSTGRES_18`, `db-f1-micro`,
  zonal, SSD 10 GB z auto-increase do 30 GB, kopie o 01:00 UTC ×7, PITR 7 dni,
  lokalizacja kopii `--backup-location=europe-central2` (sekcja 3.6a),
  `--deletion-protection`, okno serwisowe SUN 03:00 UTC, `--ssl-mode=ENCRYPTED_ONLY`,
  publiczne IP **bez** autoryzowanych sieci (połączenia wyłącznie przez Cloud SQL
  Auth Proxy / wbudowany konektor Cloud Run);
- bazę `myhelper`;
- **jeden login** `myhelper_svc` (aplikacja i migracje; Oliver 19:44) z losowym
  hasłem `[A-Za-z0-9]{32}` i wersję sekretu `postgres-url`:
  `postgresql://myhelper_svc:<HASŁO>@localhost/myhelper?host=/cloudsql/my-helper-2-488419:europe-central2:myhelper-pg`
  (bez `sslmode` — szyfruje konektor). **Stan docelowy, wykonany poza
  bootstrapem:** login utworzyła ręcznie SQL-em rola `postgres` (`CREATE ROLE …
  LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`), bo login
  z `gcloud sql users create` dostaje członkostwo w `cloudsqlsuperuser` (m.in.
  `CREATE ROLE`, `CREATE EXTENSION`, `pg_signal_backend`), którego na Cloud SQL
  nie da się odebrać. Etap `sql` loginu nie tworzy: ustawia tylko hasło (gdy
  `postgres-url` nie ma wersji), a gdy loginu brak — zatrzymuje się. Prawa
  potrzebne migracjom nadano jawnie: `CONNECT`, `TEMPORARY`, `CREATE` na bazie
  i `USAGE`, `CREATE` na schemacie `public`. Drugi login (osobny dla migracji)
  to #131 (P3, przed pierwszym płacącym salonem) — bootstrap go nie przewiduje;
- losowe hasło wbudowanego `postgres` w osobnym sekrecie
  `postgres-admin-password` — spoza manifestu, bez dostępu runtime, niepodpięty
  do usługi ani joba; tylko do dostępu administracyjnego (sekcja 9);
- `roles/cloudsql.client` wyłącznie dla runtime, z warunkiem
  `resource.type == "sqladmin.googleapis.com/Instance" && resource.name == "projects/P/instances/myhelper-pg"`;
- własną rolę `myhelperSqlBackup` dla deploy (kopia na żądanie przed migracją,
  Admin API) z **dokładnie** trzema uprawnieniami: `cloudsql.backupRuns.create`,
  `cloudsql.backupRuns.get`, `cloudsql.instances.get` (śledzenie operacji; bez
  `list` — W-1, Ryan). Istniejąca rola dostaje tę samą listę (`iam roles update`).
  Warunek obejmuje oba typy zasobu, bo operacje na kopiach mają typ `BackupRun`:
  `(resource.type == "sqladmin.googleapis.com/Instance" || resource.type == "sqladmin.googleapis.com/BackupRun") && (resource.name == "projects/P/instances/myhelper-pg" || resource.name.startsWith("projects/P/instances/myhelper-pg/"))`.
  `cloudsql.backupRuns.create` jest oceniane z nazwą samej instancji (bez ukośnika
  na końcu — log audytu), więc BackupRun musi przechodzić także przy równości
  nazwy; prefiks z ukośnikiem nie wpuszcza `myhelper-pg2`.
  Cloud SQL nie ma polityk IAM na instancji, więc wiązanie projektowe z warunkiem
  (Oliver). Z bazą łączy się
  tylko konto runtime: usługa i job migracji `myhelper-migrate` działają jako
  `myhelper-runtime` (`run-migrate.sh`: `--service-account="$RUNTIME_SA"`).
  Po stronie deploy nic nie łączy się z bazą, więc deploy nie ma `cloudsql.client`.

Hasła: generowane w pamięci procesu, do gcloud tylko przez `--flags-file`
ze strumienia (`sql users set-password`) i `--data-file=-`
(`secrets versions add`); nie są wypisywane. Wywołania `sql users …` (B-1)
i `secrets versions add` (N2, K-1b) idą z `CLOUDSDK_CORE_DISABLE_FILE_LOGGING=1`. Gdy sekret ma już wersję
ENABLED, etap pomija dany login (hasło bez zmian). Gdy wersji brak, a login
istnieje (przerwany przebieg), hasło jest ustawiane od nowa (`set-password`) —
stan sam się naprawia. **Błąd odczytu** wersji (sieć, uprawnienia — kod ≠ 0
z `secrets versions list`) przerywa etap przed jakąkolwiek zmianą hasła; to nie
jest traktowane jak „brak wersji” (Ethan, #134). Po utworzeniu instancji skrypt
sprawdza `state`; baza, loginy i wiązania powstają tylko przy `RUNNABLE`, inaczej
stop — powtórzyć etap później.

Bootstrap **nie tworzy ról NOLOGIN**. `myhelper_app` tworzy migracja 0005 (na nowej instancji `postgres`, niżej);
`myhelper_svc` jest jej członkiem (`GRANT myhelper_app TO myhelper_svc`,
wykonuje `postgres`), bo `forSalon` przełącza się na nią `SET LOCAL ROLE`.

**Etap `sql` można powtórzyć.** Nie tworzy loginu aplikacji: gdy z `--apply`
`myhelper_svc` nie istnieje, stop przed jego hasłem (dry-run: pełny plan + nota);
hasło `postgres` idzie wcześniej, więc na nowej instancji `postgres` tworzy login
SQL-em jak wyżej, a potem etap powtarza się. Na **nowej instancji** `postgres`
przed pierwszą migracją wykonuje też (login aplikacji jest `NOCREATEROLE`, więc
`CREATE ROLE` z migracji 0005 by padł; **do potwierdzenia na klonie przed
użyciem** — nie sprawdzono, czy `GRANT myhelper_app TO current_user` z 0005
przechodzi przy samym ADMIN):

```sql
CREATE ROLE myhelper_app NOLOGIN;
GRANT myhelper_app TO myhelper_svc WITH ADMIN OPTION;
```

Odczyt stanu po etapie:

```bash
set +x
P=my-helper-2-488419
gcloud --project=$P sql instances describe myhelper-pg --format='yaml(databaseVersion,settings.edition,settings.tier,settings.availabilityType,settings.dataDiskSizeGb,settings.storageAutoResizeLimit,settings.backupConfiguration,settings.maintenanceWindow,settings.ipConfiguration.sslMode,settings.ipConfiguration.authorizedNetworks,settings.deletionProtectionEnabled)'
gcloud --project=$P sql databases list --instance=myhelper-pg --format='value(name)'
gcloud --project=$P sql users list --instance=myhelper-pg --format='value(name)'
gcloud --project=$P secrets versions list postgres-url --format='value(name,state)'
gcloud --project=$P secrets versions list postgres-admin-password --format='value(name,state)'
```

Oczekiwane: `POSTGRES_18`, `ENTERPRISE`, `db-f1-micro`, `ZONAL`, `10`, `30`,
kopie włączone z PITR i `retainedBackups: 7`, `location: europe-central2`, okno `day: 7 hour: 3`,
`ENCRYPTED_ONLY`, brak `authorizedNetworks`, `deletionProtectionEnabled: true`;
bazy zawierają `myhelper`; loginy: `myhelper_svc`, `postgres`; oba sekrety:
`1 ENABLED`.

**Policy Troubleshooter po etapie `sql`** (W-1, Ryan): deploy ma
`cloudsql.backupRuns.create` na `myhelper-pg`, a na innej instancji nie.

```bash
P=my-helper-2-488419; D="myhelper-deploy@$P.iam.gserviceaccount.com"
for I in myhelper-pg inna-instancja; do
  gcloud --project=$P policy-intelligence troubleshoot-policy iam \
    "//sqladmin.googleapis.com/projects/$P/instances/$I" \
    --principal-email="$D" --permission=cloudsql.backupRuns.create \
    --resource-service=sqladmin.googleapis.com \
    --resource-type=sqladmin.googleapis.com/Instance \
    --resource-name="projects/$P/instances/$I" \
    --format='value(overallAccessState)'
done
```

Oczekiwane: `CAN_ACCESS` dla `myhelper-pg`, `CANNOT_ACCESS` dla drugiej. Inny
wynik dla `myhelper-pg` → pierwszy przebieg z `run_migrations=true` padnie na
kopii (fail-closed) — zgłoszenie do Evy i Ryana przed D-7.

### 3.6a Kopie zapasowe: lokalizacja i kopie na żądanie

**Lokalizacja.** Bez `--backup-location` Cloud SQL zapisuje kopie w domyślnej
lokalizacji wielu regionów (dla `europe-central2` to UE, nie Warszawa). Umowa
powierzenia podaje `europe-central2`, więc `bootstrap.sh` tworzy instancję z
`--backup-location=europe-central2` (strażnik G-D1). Instancja `myhelper-pg`
powstała przed tą zmianą — jednorazowo, **przed pierwszą kopią z danymi
produkcyjnymi** (przed próbą generalną przełączenia), sesja główna za zgodą
właściciela wykonuje (zmiana konfiguracji, bez dostępu do danych):

```bash
set +x
P=my-helper-2-488419
gcloud --project=$P sql instances patch myhelper-pg --backup-location=europe-central2
gcloud --project=$P sql instances describe myhelper-pg --format='value(settings.backupConfiguration.location)'
```

Oczekiwane: `europe-central2`. Kopie sprzed zmiany (pusta baza) zostają w
dotychczasowej lokalizacji i podlegają zasadzie 30 dni niżej.

**Kopie na żądanie.** `retained-backups-count=7` i PITR 7 dni dotyczą tylko kopii
automatycznych. Kopie na żądanie (`pre-migrate` z `run-migrate.sh`, kopie przed
importem i przed próbą generalną) nie rotują same. Zasada: **kopia na żądanie
żyje najwyżej 30 dni.** Usuwa ją sesja główna (`sql backups delete`, wyjście bez
danych), wpis w #121. Konto deploy nie ma uprawnienia do usuwania kopii i nie
dostaje go. Wyjątek: kopia sprzed importu danych (`pre-import`) jest celem
wycofania. Nie usuwamy jej przed końcem okresu wycofania przełączenia (D+14).
Usuwamy ją w dniu jego zakończenia, a najpóźniej 30 dni po utworzeniu, jak każdą
inną kopię na żądanie. Jeśli wycofanie ma trwać dłużej niż 30 dni, decyzję
podejmuje właściciel, a umowa powierzenia dostaje odpowiedni wpis.

**Cotygodniowy przegląd** (przy cotygodniowym odczycie kosztów):

```bash
set +x
P=my-helper-2-488419
gcloud --project=$P sql backups list --instance=myhelper-pg --format='value(id,type,windowStartTime)'
```

Każda kopia typu `ON_DEMAND` starsza niż 30 dni (`windowStartTime`) idzie do
usunięcia: `gcloud --project=$P sql backups delete ID --instance=myhelper-pg`.
Wynik przeglądu (liczba kopii, liczba usuniętych) w #121.

### 3.7 `run` (odstępstwo od listy etapów w zleceniu — uzasadnienie)
Powłoki usługi `myhelper` i joba `myhelper-migrate`, żeby konto deploy dostało
`roles/run.developer` **na tych dwóch zasobach**, a nie na projekcie. Warunki
(Oliver, przyjęte wstępnie; oceniają Ethan i Ryan):
- obraz zastępczy: oficjalna próbka Google `us-docker.pkg.dev/cloudrun/container/hello`
  (usługa i job; job zastępczy nigdy nie jest wykonywany);
- zastępcza rewizja: `--min-instances=0 --max-instances=1`, konto runtime,
  **bez sekretów i bez zmiennych środowiska**;
- `allUsers` → `roles/run.invoker` na usłudze ustawia **raz** ten etap (sesja
  główna, konto Darka). Konto deploy **nie** dostaje `setIamPolicy` ani ról
  projektowych do zarządzania IAM; od K-1 `run-deploy.sh` nie podaje
  `--allow-unauthenticated` (wdrożenie zachowuje istniejącą politykę).

Zastępcze rewizje zastępuje pierwszy przebieg workflow. Do sprawdzenia przy
pierwszym przebiegu: czy odczyt operacji/wykonań joba wymaga dodatkowego uprawnienia.

### 3.8 `wif` — bramka wykonania
**Sesja główna wykonuje `wif` dopiero, gdy spełnione jest jedno z dwóch:**
- hook `guard-deploy-subagent` (blokuje w subagentach scalanie, uruchamianie
  workflow i zatwierdzanie wdrożeń; nie obejmuje gcloud) podpisany przez Darka
  i zainstalowany, z próbą kontrolną (Ryan, 6900431761), **albo**
- agenci pracują na koncie maszynowym (nie na koncie Darka).

Pozostałe etapy na hook nie czekają.

Pula `github`, provider OIDC `github-actions`, `workloadIdentityUser` na koncie
deploy dla `principalSet://…/attribute.repository_id/1152153440`. Warunek
atrybutów skrypt czyta z pliku (`--wif-condition-file=`). Ostateczna treść
(Ryan, 6899923012):

```
assertion.repository_id == '1152153440' &&
assertion.repository_owner_id == '171363250' &&
assertion.ref == 'refs/heads/main' &&
assertion.workflow_ref == 'Danolog/My_Helper_2/.github/workflows/deploy-cloud-run.yml@refs/heads/main' &&
assertion.job_workflow_ref == 'Danolog/My_Helper_2/.github/workflows/deploy-cloud-run.yml@refs/heads/main' &&
assertion.environment == 'production-gcp' &&
assertion.event_name == 'workflow_dispatch' &&
assertion.run_attempt == '1' &&
assertion.actor_id == '171363250'
```

- `job_workflow_ref` jako równość **obok** `workflow_ref`: oba wskazują ten sam
  plik na `main`, więc wywołanie z innego workflow nie przejdzie żadną drogą.
- `environment`: token dostaje tylko job ze środowiskiem `production-gcp`, czyli
  za ochroną środowiska (sekcja 7).
- `actor_id` od razu: zmiana konta wywołującego (współpracownik, konto
  maszynowe) = świadoma zmiana pliku warunku z recenzją.

Skrypt wymaga wszystkich dziewięciu członów w dokładnie tej postaci i przyjmuje
wyłącznie **czystą koniunkcję** równości `assertion.<pole> == '<wartość>'`
połączonych ` && ` (#140): `||`, negacja, operator warunkowy, nawiasy i funkcje
są odrzucane przed pierwszym wywołaniem gcloud. Dodatkowe równości wolno
dopisać (tylko zawężają).
Wynik etapu: trzy wartości do D-6 (`GCP_WIF_PROVIDER`, `GCP_DEPLOY_SA`,
`GCP_RUNTIME_SA`) — wypisywane przez skrypt.

## 4. Sprawdzenie `--flags-file` na prawdziwym gcloud (#121 b) — wykonuje Oliver po D-1

Cel: potwierdzić, że nagłówek z `--flags-file=<(…)` trafia do joba Scheduler,
zanim prawdziwy `CRON_SECRET` trafi do `infra/gcp/scheduler.sh`. Token jest fikcyjny.

```bash
set +x
P=my-helper-2-488419; R=europe-central2; J=mh-flagsfile-probe
gcloud --project=$P scheduler jobs create http $J --location=$R \
  --schedule='0 0 29 2 *' --time-zone=Europe/Warsaw \
  --uri=https://example.com/flags-file-probe --http-method=POST \
  --flags-file=<(printf -- '--headers:\n  Authorization: "Bearer probe-not-a-secret-1"\n')
gcloud --project=$P scheduler jobs pause $J --location=$R
gcloud --project=$P scheduler jobs describe $J --location=$R \
  --format='value(state,httpTarget.headers.Authorization)'
gcloud --project=$P scheduler jobs update http $J --location=$R \
  --flags-file=<(printf -- '--update-headers:\n  Authorization: "Bearer probe-not-a-secret-2"\n')
gcloud --project=$P scheduler jobs describe $J --location=$R \
  --format='value(state,httpTarget.headers.Authorization)'
gcloud --project=$P scheduler jobs delete $J --location=$R --quiet
gcloud --project=$P scheduler jobs list --location=$R --format='value(name)'
```

Oczekiwany wynik: pierwszy `describe` → `PAUSED	Bearer probe-not-a-secret-1`,
drugi → `PAUSED	Bearer probe-not-a-secret-2`, po `delete` lista pusta.
Harmonogram 29 lutego (najbliższy 2028) + natychmiastowa pauza = job nigdy nie
wystrzeli. Jeśli `describe` nie pokazuje nagłówka albo pokazuje dosłownie ścieżkę
`/dev/fd/…` — stop, `scheduler.sh` nie może być użyty (zgłoszenie do Evy).

**Tylko dla tej próby z fikcyjnym tokenem.** Dla prawdziwych zadań `mh-*`
(nagłówek z prawdziwym `CRON_SECRET`) nie używać `describe` ani `list` z
`--format` obejmującym `httpTarget.headers`, ani bez zawężonego `--format`:
wartość nagłówka trafia na ekran i do logu plikowego gcloud
(`~/.config/gcloud/logs`) — #143 pkt 2. Stan prawdziwych zadań sprawdza
`scheduler.sh --check` albo `--format='value(name,state)'` jak w sekcji 8.

## 5. D-5 — wartości sekretów (sesja główna)

Zasada (N2, Ryan, K-1b; K-1c, K-1d): wartość sekretu trafia do gcloud
**wyłącznie przez stdin** (`--data-file=-`), zawsze bez lokalnego logu gcloud
(`CLOUDSDK_CORE_DISABLE_FILE_LOGGING=1`), nigdy wartość w wierszu polecenia,
nigdy `echo WARTOŚĆ`, nigdy `--data-file=ŚCIEŻKA`. Funkcje niżej nie tworzą
żadnej kopii wartości na dysku (bez plików tymczasowych). Dwie drogi, innych nie używać:
- **sekret jednowierszowy** (klucze API, tokeny, hasła — wszystkie sekrety
  z dzisiejszego manifestu): funkcja `add`, przez `tr -d '\r\n'` (końce
  wierszy z pliku albo panelu dostawcy nie stają się częścią sekretu);
- **sekret wielowierszowy** (PEM, JSON — końce wierszy są częścią wartości,
  `tr` by je zepsuł): funkcja `add_multiline`, **bez** `tr`, wartość
  bajt w bajt ze stdin.

Plik od dostawcy (oryginał, zapisany z panelu poza repo) usuwa człowiek, po
wpisaniu wartości i sprawdzeniu, że wersja sekretu powstała. `rm -P` na APFS
(macOS) nie gwarantuje nadpisania danych na dysku — usunięcie pliku nie jest
bezpiecznym wymazaniem; ochroną jest szyfrowanie dysku (FileVault) i jak
najkrótszy czas życia pliku, nie flaga `rm`.

Blok uruchamiać **z katalogu repo** (VAPID bierze `web-push` z `node_modules`),
w **bash albo zsh** — w `sh` nie zadziała (`local`, `pipefail`, `>(…)`) — i **bez
`set -x`**: wartości są w zmiennych lokalnych funkcji, więc śledzenie poleceń
wypisałoby je na ekran; dlatego blok zaczyna się od `set +x`.
**Blok nie ma ani jednej linii komentarza** (K-1d, Ethan Z1, Ryan): w
interaktywnym zsh z wyłączonym `interactivecomments` (domyślnie, tak jak u
Darka) `#` nie zaczyna komentarza nawet na początku linii — komentarz wykonuje
się jako polecenie (`command not found: #`, po `;` uruchamia kolejne polecenie,
`parse error`, wykonane przekierowania i backticki). Wszystkie objaśnienia stoją
w prozie nad blokiem i pod nim. `setopt interactivecomments` w pierwszej linii
bloku nie pomaga (przy wklejeniu bufor jest parsowany w całości przed
wykonaniem).

**Pusta wartość (K-1d, Ethan B1):** `add` i `add_multiline` czytają stdin do
zmiennej lokalnej i przy pustej wartości kończą się kodem 1 **bez wywołania
gcloud** (żadnej pustej wersji sekretu). `printf` jest wbudowany w powłokę, więc
wartość nie trafia do argumentów procesu. `set -o pipefail` na początku bloku:
błąd generatora w potoku (np. `node` poza katalogiem repo) daje kod ≠ 0 potoku.

**Para VAPID (K-1d, Ethan B2):** `gh variable set` działa asynchronicznie
(podstawienie procesu), więc po bloku VAPID zawsze `vapid_check`: do 10 prób co
1 s porównuje klucz publiczny wyliczony (ECDH P-256) z klucza prywatnego
z Secret Managera ze zmienną w GitHub. Klucz prywatny płynie wyłącznie potokiem
`gcloud secrets versions access` → stdin `node` (bez ekranu, pliku, argumentów
i zmiennej powłoki); w zmiennej `sm` jest wyłącznie wyliczony klucz publiczny (jawny).
Wynik „VAPID: para OK” albo „VAPID: ROZJAZD”. **Przy ROZJAZD albo jakimkolwiek
błędzie w bloku VAPID powtarza się CAŁY blok VAPID** (nowa para nadpisuje obie
strony), nigdy jedną linię. D-6 (wdrożenie) dopiero po „VAPID: para OK”.

Kolejność w bloku:
1. ustawienia i funkcje: `set +x; set -o pipefail`, `P`, `add`, `add_multiline`, `vapid_check`;
2. generowane lokalnie: `better-auth-secret`, `cron-secret` (`openssl rand`);
3. **blok VAPID** — od `node -e …` do `vapid_check` włącznie, przy błędzie
   powtarzany w całości: jedna para z jednego wywołania node, bez pliku i bez
   klucza prywatnego na ekranie ani w argumentach; prywatny: stdout node → `add`
   (stdin gcloud); publiczny (jawny): deskryptor 3 → `gh variable set` (stdin)
   dla D-6; potem metadane najnowszej wersji `vapid-private-key` (bez wartości);
4. od dostawców (plik zapisany z panelu dostawcy, poza repo): `stripe-secret-key`
   i `stripe-webhook-secret` — para Stripe: oba albo żaden (K-1b); `&& rm`
   (Ryan, K-1d): nieudane `add` (kod ≠ 0) nie kasuje oryginału — wartość do
   ponowienia zostaje.

```bash
set +x; set -o pipefail
P=my-helper-2-488419
add() { local v; v="$(tr -d '\r\n')"; [ -n "$v" ] || { echo "error: empty value for $1 — gcloud not called" >&2; return 1; }; printf '%s' "$v" | CLOUDSDK_CORE_DISABLE_FILE_LOGGING=1 gcloud --project=$P secrets versions add "$1" --data-file=-; }
add_multiline() { local v; v="$(cat; printf x)"; v="${v%x}"; [ -n "$v" ] || { echo "error: empty value for $1 — gcloud not called" >&2; return 1; }; printf '%s' "$v" | CLOUDSDK_CORE_DISABLE_FILE_LOGGING=1 gcloud --project=$P secrets versions add "$1" --data-file=-; }
vapid_check() {
  local i sm gh
  for i in 1 2 3 4 5 6 7 8 9 10; do
    sm="$(CLOUDSDK_CORE_DISABLE_FILE_LOGGING=1 gcloud --project=$P secrets versions access latest --secret=vapid-private-key | node -e 'let s="";process.stdin.on("data",function(d){s+=d}).on("end",function(){try{const e=require("crypto").createECDH("prime256v1");e.setPrivateKey(Buffer.from(s,"base64url"));process.stdout.write(e.getPublicKey().toString("base64url"))}catch(x){process.exit(1)}})')" || sm=""
    gh="$(gh variable get NEXT_PUBLIC_VAPID_PUBLIC_KEY --env production-gcp)" || gh=""
    if [ -n "$sm" ] && [ "$sm" = "$gh" ]; then echo "VAPID: para OK"; return 0; fi
    sleep 1
  done
  echo "VAPID: ROZJAZD — powtórz CAŁY blok VAPID; D-6 dopiero po 'VAPID: para OK'" >&2
  return 1
}

openssl rand -base64 48 | add better-auth-secret
openssl rand -hex 32 | add cron-secret

node -e 'const k=require("web-push").generateVAPIDKeys(); require("fs").writeSync(3, k.publicKey); process.stdout.write(k.privateKey)' \
  3> >(gh variable set NEXT_PUBLIC_VAPID_PUBLIC_KEY --env production-gcp) \
  | add vapid-private-key
vapid_check
gcloud --project=$P secrets versions list vapid-private-key --sort-by='~createTime' --limit=1 --format='value(name,state,createTime)'

add stripe-secret-key < "$HOME/secure/stripe-secret-key" && rm "$HOME/secure/stripe-secret-key"
add stripe-webhook-secret < "$HOME/secure/stripe-webhook-secret" && rm "$HOME/secure/stripe-webhook-secret"
```

Pozostałe sekrety od dostawców — analogicznie jak Stripe (`add NAZWA < "PLIK" && rm "PLIK"`):
`resend-api-key`, `smsapi-token`, `upstash-redis-rest-token`, `google-client-secret`
(`openrouter-api-key`: od K-1 poza Secret Manager). Sekret wielowierszowy (dziś
żaden z manifestu tego nie wymaga): `add_multiline NAZWA < "$HOME/secure/NAZWA.pem"`,
potem człowiek usuwa oryginał.

**Para Stripe (K-1b):** `stripe-secret-key` i `stripe-webhook-secret` dodawać
razem albo wcale. Tylko jeden z wersją → `run-deploy.sh` przerywa wdrożenie
(kod 2, nazwy obu zmiennych), a strażnik startu (`infra/runtime/secret-guard.mjs`)
odmawia startu z nazwą brakującej zmiennej.

`postgres-url` i `postgres-admin-password` ustawia etap `sql` — w D-5 ich nie ruszać.

**Brakujące sekrety zostają puste.** Zachowanie aplikacji bez danego sekretu
(stan kodu na dziś; od K-1 pole `required` w manifeście):

| Sekret | Bez wartości |
|---|---|
| postgres-url, better-auth-secret | aplikacja nie startuje (`env.ts`: „is required”) — **obowiązkowe** |
| cron-secret | endpointy cron → 500 „CRON_SECRET not configured” (harmonogram i tak dopiero w D-8) |
| smsapi-token | na hostingu SMS nie wychodzi: błąd w logu, brak wpisu w historii powiadomień, wołający dostaje błąd (symulacja działa tylko poza hostingiem); cron przypomnień odpowiada 503 przed wyborem wizyt i ich nie oznacza — przypomnień dla wizyt, które w tym czasie zejdą poniżej 30 min do startu, nie nadrabia |
| resend-api-key | e-mail tylko logowany, nie wysyłany |
| stripe-secret-key, stripe-webhook-secret | webhook 503 „Webhook not configured”; płatności nie działają |
| upstash-redis-rest-token | limitowanie zapytań w pamięci instancji |
| vapid-private-key | push wyłączony |
| openrouter-api-key | od K-1 poza Secret Manager i Cloud Run (klucz skasowany 14.11, AI przez Vertex w kroku F); bez klucza aplikacja startuje, czat AI nie działa (ostrzeżenie) |
| google-client-secret | logowanie Google wyłączone: przycisk Google ukryty, a dostawca niezarejestrowany, gdy brakuje `GOOGLE_CLIENT_ID` albo sekretu (`src/lib/google-auth.ts`) |

**Bloker pierwszego wdrożenia:** `run-deploy.sh` mapuje wszystkie sekrety z manifestu
(`NAZWA=sekret:latest`). Cloud Run odrzuca rewizję, której sekret nie ma żadnej
wersji. Od K-1: `required` w manifeście (wymagane: `postgres-url`,
`better-auth-secret`); `run-deploy.sh` mapuje wyłącznie sekrety, których
najnowsza wersja ma stan `ENABLED` (od K-1b odczyt `secrets versions list
NAZWA --sort-by=~createTime --limit=1`: pusty wynik = brak wersji, bez
rozpoznawania błędu po tekście); sekret wymagany bez wersji przerywa
wdrożenie **przed** `gcloud run deploy` z nazwą sekretu; każdy błąd odczytu
(np. uprawnienia, brak samego kontenera sekretu) też przerywa. Żadnych wersji-zaślepek. Webhook Stripe bez
`stripe-webhook-secret` odrzuca każde żądanie (503) —
`__tests__/api/stripe-webhook-no-secret.test.ts`.
Sprawdzenie, że moduł bez sekretu wyłącza się sam: po K-1, przebieg z pustym
sekretem opcjonalnym → smoke zielony, w logach tylko ostrzeżenie modułu.

## 6. D-6 — zmienne GitHub (sesja główna, na końcu — warunek Ryana)

Zmienne środowiska `production-gcp` (wartości jawne, ale bez adresów e-mail w
historii: wartości z plikiem przez stdin):

```bash
E=production-gcp
gh variable set GCP_PROJECT_ID --env $E --body my-helper-2-488419
gh variable set GCP_REGION --env $E --body europe-central2
gh variable set AR_REPO --env $E --body myhelper
gh variable set CLOUD_RUN_SERVICE --env $E --body myhelper
gh variable set SQL_INSTANCE --env $E --body myhelper-pg
gh variable set DB_POOL_MAX --env $E --body 4
gh variable set GCP_RUNTIME_SA --env $E --body myhelper-runtime@my-helper-2-488419.iam.gserviceaccount.com
gh variable set GCP_DEPLOY_SA --env $E --body myhelper-deploy@my-helper-2-488419.iam.gserviceaccount.com
gh variable set GCP_WIF_PROVIDER --env $E --body "$(…wartość wypisana przez etap wif…)"
gh variable set ADMIN_EMAILS --env $E < "$HOME/secure/admin-emails"
```

`DB_POOL_MAX=4`: `max_connections` 25 na `db-f1-micro` (Ethan). Pozostałe zmienne
klasy `var` z `infra/gcp/env-manifest.json` — analogicznie.

- `GCS_PUBLIC_BASE_URL` — **pusta** na start. Od K-1 jedno źródło
  (`vars.GCS_PUBLIC_BASE_URL`) dla build-argu obrazu i zmiennej usługi.
- `SQL_INSTANCE=myhelper-pg` — z niej `run-deploy.sh` i `run-migrate.sh` składają
  `--set-cloudsql-instances=my-helper-2-488419:europe-central2:myhelper-pg` (K-1).
- `STORAGE_DRIVER=gcs` i `GCS_BUCKET=<zasobnik z D-3>` — na Cloud Run **od
  pierwszego wdrożenia** (`required: true` w manifeście; Oliver). Warunki:
  #118 pkt 4 (spełniony), #118 pkt 5 (`legacyObjectReader` w etapie `bucket`),
  #132 na `main`. Na Vercelu obie zmienne nadal **nieustawione**.
- `GOOGLE_CLIENT_ID` — **nie ustawiać** na Cloud Run, dopóki
  `google-client-secret` nie ma wersji. Przycisk logowania Google pokazuje
  się tylko przy obu wartościach (`src/lib/google-auth.ts`); bez którejkolwiek
  jest ukryty, a dostawca niezarejestrowany.
- `MYHELPER_APP_DB_ROLE` — puste = domyślnie `myhelper_app`.

## 7. D-7 — pierwszy przebieg (sesja główna)

Workflow `deploy-cloud-run.yml` uruchamia wyłącznie sesja główna, po zgodzie
Darka.

Ochrona środowiska `production-gcp` (ustawia sesja główna, Oliver 19:5x):
- `can_admins_bypass=false` — administrator nie omija zatwierdzenia;
- własna polityka gałęzi: tylko `main`;
- wymagany recenzent: Darek, `prevent_self_review=false`.

Zatwierdzenie oczekującego wdrożenia (`pending_deployments`) wykonuje
**wyłącznie sesja główna**, po sygnale Olivera „Gotowe do wdrożenia: <sha>”,
i tylko gdy sha przebiegu = sha z sygnału (pierwsze polecenie bloku wypisuje sha
przebiegu — ma być równe `<sha>` z sygnału):

```bash
RUN=<id przebiegu>
gh api repos/Danolog/My_Helper_2/actions/runs/$RUN --jq .head_sha
ENV_ID=$(gh api repos/Danolog/My_Helper_2/actions/runs/$RUN/pending_deployments --jq '.[0].environment.id')
gh api -X POST repos/Danolog/My_Helper_2/actions/runs/$RUN/pending_deployments \
  -F "environment_ids[]=$ENV_ID" -f state=approved -f comment="Gotowe do wdrożenia: <sha>"
```

Sha inne niż w sygnale → `state=rejected`. Lista dozwolonych akcji GitHub
w repo — P3 po becie.

**Dwa przebiegi** (decyzja: pierwszy z migracjami na pustej bazie; warunek 4
Ryana). Bez migracji pierwsza rewizja wstałaby na bazie bez tabel.

Kolejność w bloku: 1. pierwszy przebieg — migracje od zera na pustej bazie;
2. drugi przebieg — bez migracji, musi być zielony (warunek 4).

```bash
gh workflow run deploy-cloud-run.yml --ref main -f run_migrations=true
gh run watch "$(gh run list --workflow=deploy-cloud-run.yml --limit=1 --json databaseId -q '.[0].databaseId')"
gh workflow run deploy-cloud-run.yml --ref main -f run_migrations=false
gh run watch "$(gh run list --workflow=deploy-cloud-run.yml --limit=1 --json databaseId -q '.[0].databaseId')"
```

Każdy przebieg osobno przechodzi zatwierdzenie `pending_deployments` (wyżej).
Warunek WIF `run_attempt == '1'`: ponowienie nieudanego przebiegu („Re-run”) nie
dostanie tokenu — zawsze nowy `gh workflow run`.

Warunki Ryana przed pierwszym przebiegiem z `run_migrations=true` (#121, 6899276171):

1. migracje od zera na pustej bazie lokalnej przechodzą, a `drizzle-kit generate`
   zwraca „No schema changes” (sesja główna, lokalnie);
2. rola aplikacji `myhelper_app` bez BYPASSRLS (sprawdzenie poniżej);
3. baza `myhelper` pusta w chwili przebiegu;
4. drugi przebieg z `run_migrations=false` zielony.

**Kolejność ról i polityk RLS.** Rola musi istnieć, zanim powstanie polityka,
która jej używa. Sprawdzenie w repo przed przebiegiem:

```bash
grep -n "CREATE ROLE myhelper_app\|TO myhelper_app\|CREATE POLICY" drizzle/*.sql | head
```

Pierwsze wystąpienie `myhelper_app` to `CREATE ROLE` w `0005_rls_tenant_isolation.sql`
— przed każdą polityką i GRANT w 0005 i w późniejszych migracjach. Każda nowa
migracja z polityką dla nowej roli: rola w tej samej lub wcześniejszej migracji.

Po przebiegu z migracjami (przez Cloud SQL Auth Proxy, sekcja 9):

```sql
SELECT rolname, rolcanlogin, rolbypassrls, rolsuper,
       pg_has_role(rolname, 'cloudsqlsuperuser', 'MEMBER') FROM pg_roles
 WHERE rolname IN ('myhelper_app', 'myhelper_svc') ORDER BY rolname;
```

Oczekiwane: `myhelper_app | f | f | f | f`, `myhelper_svc | t | f | f | f`.

**Migracje produkcyjne** idą wyłącznie przez workflow z `run_migrations=true`
(kopia na żądanie przed migracją w `run-migrate.sh`) albo przez sesję główną.
Nigdy ręcznie z shella agenta.

**Reguła migracji wstecznie zgodnych (expand → contract, #121 d).** Migracja
idzie przed deployem, a gdy deploy albo smoke padnie, stara rewizja zostaje na
nowym schemacie. Dlatego każda migracja produkcyjna musi działać ze **starą**
i nową wersją kodu:
- *expand* (w tym samym PR co kod): tylko dodanie — nowa tabela, nowa kolumna
  nullable albo z wartością domyślną, nowy indeks (`CONCURRENTLY` gdzie się da);
- *contract* (osobny PR, dopiero gdy żadna działająca rewizja nie używa starego):
  usunięcie kolumny/tabeli, `NOT NULL` bez wartości domyślnej, zmiana typu,
  zmiana nazwy;
- zmiana nazwy = dodaj nową → zapis do obu → przenieś dane → contract.
Recenzent PR z migracją sprawdza tę regułę; kopia na żądanie jest siatką, nie planem.

## 7a. Pilna poprawka a czerwony „Security Audit”

`main` jest chroniony (tylko PR + zielone TypeScript Check / Unit Tests /
E2E Smoke Tests / Security Audit, enforce_admins). Gdy nowa zewnętrzna
podatność w zależności czerwieni „Security Audit” i blokuje niezwiązaną pilną
poprawkę — **ochrony `main` nie wyłączamy**. Jedna z dwóch dróg:

1. **Dwa PR-y:** osobny PR z podbiciem zależności (lockfile, `pnpm.overrides`
   gdy brak wydania nadrzędnego) idzie pierwszy; PR z pilną poprawką robi
   merge `main` i przechodzi audyt;
2. **Jawny wyjątek w audycie** (gdy łatki jeszcze nie ma): wpis wyjątku dla
   jednego identyfikatora podatności w konfiguracji audytu, z datą wygaśnięcia
   i uzasadnieniem (czy podatny kod jest osiągalny), w PR z recenzją Ryana;
   zdjęcie wyjątku = osobny PR, gdy łatka wyjdzie.

W obu przypadkach: treść niezałatanej, wykorzystywalnej podatności w naszym
kodzie nie trafia do publicznych opisów ani komentarzy — prywatny szkic
Security Advisory przez Olivera.

## 7b. Pierwsze wdrożenie z migracjami 0015–0017

**Zasada.** Pierwsze wdrożenie kodu, który zawiera migracje 0015–0017,
uruchamiamy wyłącznie z `run_migrations=true`. Domyślne `false` uruchomi kod na
schemacie bez tych tabel i kolumn. `/api/health` sprawdza tylko połączenie
z bazą, więc tego nie wykryje: rewizja dostanie cały ruch, a zapytania do
`clients` będą padać.

**Przed wdrożeniem** (baza produkcyjna, tylko odczyt):

Kontrole przed migracją i po niej idą w sesji `psql` ustawionej na tylko
odczyt: `PGOPTIONS='-c default_transaction_read_only=on'` w środowisku
procesu `psql` (blok w sekcji 9) albo, gdy sesja jest już otwarta,
`SET default_transaction_read_only = on;` jako pierwsze polecenie. To
zabezpieczenie przed pomyłką (zapis kończy się błędem 25006), nie
uprawnienie: login aplikacji mógłby je wyłączyć, więc w tej sesji żadnych
poleceń poza zapytaniami z tej sekcji.

a) liczba wpisów w `drizzle.__drizzle_migrations` równa 15; inna wartość = stop:

```sql
SELECT count(*) FROM drizzle.__drizzle_migrations;
```

b) zapytanie kontrolne na duplikaty opinii musi dać pusty wynik; inaczej
migracja 0016 zatrzyma się z błędem:

```sql
SELECT appointment_id, count(*) FROM reviews WHERE appointment_id IS NOT NULL GROUP BY appointment_id HAVING count(*) > 1;
```

c) zapytanie kontrolne 0017 musi dać `alergie_niepuste=0`; inna wartość =
stop, bo 0017 zeruje wypełnione `allergies` bez możliwości odtworzenia.
Zapytanie i wynik trafiają do dziennika migracji (oczekiwana wartość: 0):

```sql
SELECT 'alergie_niepuste=' || count(*) FROM clients WHERE allergies IS NOT NULL;
```

Po kontroli (a, b, c) wychodzimy z `psql`: przed startem joba żadna sesja nie
zostaje otwarta (otwarta transakcja na `reviews` zablokuje indeks z 0016,
błąd 55P03).

**Warunki:**

- Kopię Cloud SQL na żądanie robi `infra/gcp/run-migrate.sh`, a błąd kopii
  zatrzymuje job. Id i czas kopii trafiają do dziennika migracji tego samego
  dnia.
- Przed uruchomieniem wdrożenia z `run_migrations=true` w dzienniku migracji
  zapisane są: commit `main`, sha256 każdego z plików 0015–0017, oczekiwana liczba
  migracji = 18, suma kontrolna `migrations_sha256` z próby oraz zapytanie
  kontrolne 0017 (punkt c wyżej) z oczekiwaną wartością 0. Po migracji
  porównanie; rozbieżność = stop.
- **Rozbieżność po wdrożeniu.** Porównanie robimy, gdy nowa rewizja ma już
  100% ruchu, więc „stop” nie zatrzymuje niczego samo. Znaczy: żadnych
  kolejnych wdrożeń (także ponownego `workflow_dispatch`), zgłoszenie
  rozbieżności z wynikiem zapytania w dzienniku migracji i decyzja
  o cofnięciu według punktu „Cofnięcie migracji” niżej. Automatycznego
  cofnięcia migracji nie ma: ani workflow, ani job nie odwracają zmian
  w schemacie.
- Osobna, wcześniejsza kopia na żądanie → odtworzenie do tymczasowej instancji
  Cloud SQL → porównanie skryptem → na niej próba 0015–0017 z commitu `main`
  (źródło liczb z punktu wyżej) → instancja tymczasowa usunięta tego samego
  dnia. Porównanie skryptem obejmuje co najmniej odczyty kontrolne: liczbę
  migracji, `migrations_sha256` sprzed migracji i zapytanie na duplikaty
  opinii (punkt b). `infra/db/cutover/compare.sh` daje dwa pierwsze
  (`migrations_count`, `migrations_sha256`) w jednej transakcji tylko do
  odczytu; duplikaty opinii sprawdza zapytanie z punktu b. Wymóg uruchomienia
  `compare.sh` bez zmian.
- W trakcie joba migracji żadnych innych sesji na tej bazie (porównań,
  zrzutów, `psql`). Przy błędzie 55P03 ustalić, kto blokuje, i ponowić job,
  bez `psql -f` i bez podnoszenia limitu. „Ponowić job” = ponowny
  `workflow_dispatch` z `run_migrations=true`, nie ręczne uruchomienie joba
  (`gcloud run jobs execute`): tylko przebieg przez workflow robi kopię na
  żądanie i ustawia job na obraz migratora z tego samego commitu
  (`infra/gcp/run-migrate.sh`).
- Obie kopie trzymane maksymalnie 30 dni od migracji; usunięcie z wpisem
  w dzienniku. Starej bazy (Neon) nie usuwać przed zamknięciem okna powrotu
  przełączenia.
- Cofnięcie migracji = odtworzenie Cloud SQL z kopii sprzed joba, tylko przed
  pierwszym prawdziwym salonem; potem wyłącznie migracja w przód. Powrót na
  starą bazę (Neon) tylko przed pierwszym prawdziwym salonem i z plikami
  0015–0017 z tego samego commitu `main`. Po pierwszym prawdziwym salonie
  powrót na starą bazę jest zamknięty; ta droga wymaga osobnego planu
  z pełnym przeniesieniem danych i zgody właściciela. Od przełączenia
  wszystkie dane, w tym dowody akceptacji regulaminu i umowy powierzenia,
  są tylko w Cloud SQL, więc eksport jednej tabeli nie wystarcza.
- Czerwony job migracji = wdrożenie wstrzymane.

**Po wdrożeniu** (ten sam blok kontroli 7b z sekcji 9 — login aplikacji,
tylko odczyt):

- liczba migracji = 18 (`SELECT count(*) FROM drizzle.__drizzle_migrations;`);
- suma kontrolna zgodna ze wzorcem z dziennika migracji, liczona dokładnie
  tym zapytaniem (to samo, co w `infra/db/cutover/compare.sh`; inna kolejność
  albo collation da inny hash):

  ```sql
  SELECT 'migrations_sha256=' || encode(sha256(convert_to(coalesce(string_agg(hash, E'\n' ORDER BY created_at, hash COLLATE "C"), ''), 'UTF8')), 'hex')
    FROM drizzle.__drizzle_migrations;
  ```

- tabele i kolumny z 0015–0017 istnieją (w tym indeks
  `reviews_appointment_id_uq`).

## 8. D-8 — harmonogram (sesja główna, po K-3 #137)

Warunek (#121 j): zadanie Scheduler powstaje wstrzymane, a jego stan jest
odczytywany (`describe` = `PAUSED`, inaczej stop). Od K-3 `infra/gcp/scheduler.sh`
tworzy zadanie z harmonogramem zaparkowanym (29 lutego), od razu je wstrzymuje,
odczytuje stan i dopiero wtedy ustawia właściwy harmonogram. Tryb domyślny
nigdy nie wznawia. Kolejność obowiązkowa:

`BASE_URL` = główny adres usługi `https://myhelper-843777043748.europe-central2.run.app`
(bez ścieżki i bez taga rewizji). Inny host skrypt odrzuca przed pierwszym
wywołaniem gcloud (#143 pkt 1).

Kolejność w bloku: 1. utworzenie/aktualizacja — wszystkie 6 zadań `PAUSED`;
2. `--check`: dryf ENABLED→PAUSED oczekiwany, innego dryfu brak; 3. `--resume`
dopiero po decyzji właściciela — jawne nazwy (W-3), tu wyłącznie zadania
porządkowe; 4. `--check`: dryf zostaje tylko dla `mh-sms-reminders` (w tabeli
`ENABLED`, w Scheduler `PAUSED` do bramki bety), innego dryfu brak; 5. lista
zadań ze stanem.

```bash
set +x
S='PROJECT_ID=my-helper-2-488419 REGION=europe-central2 BASE_URL=https://myhelper-843777043748.europe-central2.run.app'
env $S infra/gcp/scheduler.sh
env $S infra/gcp/scheduler.sh --check
env $S infra/gcp/scheduler.sh --resume mh-cleanup-pending-deposits \
  mh-cleanup-temporary-access mh-cleanup-expired-auth
env $S infra/gcp/scheduler.sh --check
gcloud --project=my-helper-2-488419 scheduler jobs list --location=europe-central2 --format='value(name,state)'
```

**Osobny krok: `mh-sms-reminders` przy bramce bety, decyzja właściciela.**
Nie razem z zadaniami porządkowymi. Najpierw warunek niżej („Warunek przed
`--resume mh-sms-reminders`”), potem:

```bash
set +x
S='PROJECT_ID=my-helper-2-488419 REGION=europe-central2 BASE_URL=https://myhelper-843777043748.europe-central2.run.app'
env $S infra/gcp/scheduler.sh --resume mh-sms-reminders
env $S infra/gcp/scheduler.sh --check
gcloud --project=my-helper-2-488419 scheduler jobs list --location=europe-central2 --format='value(name,state)'
```

Po tym kroku `--check` kończy się kodem 0 (wznowione zgodne z tabelą).

Zadań jest 6 (tabela `JOBS` w `scheduler.sh`). `--resume` bez nazw, z nazwą
spoza tabeli albo z zadaniem oznaczonym w tabeli jako `PAUSED` → błąd przed
pierwszym wywołaniem gcloud.

`mh-push-reminders` i `mh-push-reminders-24h` są w tabeli `PAUSED`, dopóki
moduł `pushNotifications` ma `hardOff` w `src/lib/features.ts`: przebieg
domyślny je wstrzymuje (także wcześniej wznowione), a `--resume` z ich nazwą
kończy się błędem przed gcloud.

Włączenie harmonogramu = prawdziwe SMS-y i push do klientów salonów — decyzja Darka.

**Warunek przed `--resume mh-sms-reminders`.** Cron oznacza wizyty jako
przypomniane przed wysyłką, więc przebieg z nieprawidłowym albo wygasłym
tokenem dostawcy SMS nie jest powtarzany dla tych samych wizyt. Dlatego:
1. przed wznowieniem — jedna rezerwacja testowa bez zadatku, w panelu salonu,
   dla klienta z własnym numerem telefonu (nie z listy numerów testowych — na
   nie SMS nie wychodzi): SMS z potwierdzeniem rezerwacji ma dojść na ten
   numer, a w historii powiadomień ma się pojawić wpis wysłanej wiadomości;
   komunikat panelu o utworzeniu wizyty tego nie potwierdza. Brak SMS-a = nie
   wznawiać. Rezerwację testową odwołać przed wznowieniem;
2. po pierwszym przebiegu harmonogramu z polem `total` większym od `0` —
   odczyt wpisu logu „SMS reminders cron completed”: pole `failed` ma mieć
   wartość `0`; inna wartość = wstrzymać zadanie i sprawdzić token. Przebiegi
   z `total` równym `0` niczego nie potwierdzają.

Zadania `mh-notify-*` (urodziny, niski stan magazynu, „tęsknimy”) nie są
tworzone — wracają z R3-C.

## 8a. Znane zachowanie przyjęte świadomie

- Płacący klient może chwilowo dostać 403 na funkcjach AI w oknie między końcem
  okresu próbnego a webhookiem potwierdzającym płatność — przyjęte świadomie,
  bez okresu łaski (Oliver).

## 9. Dostęp administracyjny do bazy

Wyłącznie przez `cloud-sql-proxy` z poświadczeniami gcloud osoby uruchamiającej
dany blok (bez autoryzowanych sieci, bez publicznego dostępu hasłem).

**Uruchamia wyłącznie właściciel.** Blok niżej łączy się jako `postgres`
hasłem z `postgres-admin-password`. Sesja główna i agenci go nie uruchamiają;
do kontroli 7b służy wyłącznie drugi blok tej sekcji (login aplikacji, sesja
tylko do odczytu). Blok zostaje w runbooku, bo to awaryjna droga właściciela
do bazy.

```bash
set +x
cloud-sql-proxy --gcloud-auth --port 6543 my-helper-2-488419:europe-central2:myhelper-pg &
PGPASSWORD="$(CLOUDSDK_CORE_DISABLE_FILE_LOGGING=1 gcloud --project=my-helper-2-488419 secrets versions access latest --secret=postgres-admin-password)" \
  psql "host=127.0.0.1 port=6543 user=postgres dbname=myhelper sslmode=disable"
kill %1
```

Hasło trafia tylko do środowiska procesu `psql` (nie do argumentów, historii
ani lokalnego logu gcloud — `CLOUDSDK_CORE_DISABLE_FILE_LOGGING=1`, B-1).
Ostatnia linia bloku (`kill %1`, K-1e) kończy proxy po wyjściu z `psql` —
proxy do bazy nie zostaje w tle.

`cloud-sql-proxy` zawsze z `--gcloud-auth` (poświadczenia z `gcloud auth
login`). Bez tej flagi proxy szuka danych ADC, a gdy ich nie ma, kończy się
kodem 1 i `psql` nie ma z czym się połączyć.

**Rola `postgres` nie wystarcza do kontroli 7b.** Wbudowana rola `postgres`
nie ma praw do schematu `drizzle` ani do tabel aplikacji, bo ich właścicielem
jest login aplikacji (`myhelper_svc`). Kontrole 7b uruchamia się jako login
aplikacji, w sesji tylko do odczytu. Hasło jest wycinane z sekretu
`postgres-url` prosto do zmiennej środowiskowej procesu `psql` — nie trafia na
ekran, do argumentów, historii ani pliku:

```bash
set +x
P=my-helper-2-488419
cloud-sql-proxy --gcloud-auth --port 6543 "${P}:europe-central2:myhelper-pg" &
PGPASSWORD="$(CLOUDSDK_CORE_DISABLE_FILE_LOGGING=1 gcloud --project="${P}" secrets versions access latest --secret=postgres-url | sed -n 's#^postgresql://myhelper_svc:\([A-Za-z0-9]*\)@.*#\1#p')" \
  PGOPTIONS='-c default_transaction_read_only=on' \
  psql "host=localhost port=6543 user=myhelper_svc dbname=myhelper sslmode=disable"
kill %1
```

`sed -n … p` wypisuje tylko dopasowane hasło i tylko do podstawienia; gdy
sekret ma inny format, zmienna jest pusta i `psql` odmawia logowania (bez
wartości sekretu na ekranie). Pierwsze zapytanie w sesji:
`SHOW default_transaction_read_only;` → `on`; inna wartość = wyjść.

**Bez `psql` na stacji** — ten sam blok, w miejsce linii z `psql` klient
z obrazu Postgresa. Zmienne idą do kontenera przez `-e NAZWA` (sama nazwa,
wartość z otoczenia procesu `docker`), nigdy `-e NAZWA=wartość`; hasło
wyłącznie przez zmienną środowiskową:

```bash
set +x
PGPASSWORD="$(CLOUDSDK_CORE_DISABLE_FILE_LOGGING=1 gcloud --project="${P}" secrets versions access latest --secret=postgres-url | sed -n 's#^postgresql://myhelper_svc:\([A-Za-z0-9]*\)@.*#\1#p')" \
  PGOPTIONS='-c default_transaction_read_only=on' \
  docker run --rm -it -e PGPASSWORD -e PGOPTIONS pgvector/pgvector:pg18 \
  psql "host=host.docker.internal port=6543 user=myhelper_svc dbname=myhelper sslmode=disable"
```

**zsh:** w zapisie `$P:europe-central2` zsh czyta `:e` jako modyfikator
(rozszerzenie pliku) i psuje nazwę instancji. Zawsze `${P}:europe-central2`.

## 9a. Przedłużenie okresu próbnego salonu pilotażowego

**Kiedy.** Przy przyjęciu salonu pilotażowego, gdy data końca pilotażu jest
już ustalona e-mailem (regulamin pkt 12.2). Domyślnie wynosi +90 dni od
przyjęcia. Zmianę robimy od razu przy przyjęciu, a nie 14. dnia, żeby salon
nigdy nie zobaczył blokady. Każde kolejne przedłużenie idzie tą samą drogą.

**Kto.** To zmiana danych produkcyjnych. Decyzję o wykonaniu podejmuje CTO.
Każdy dostęp do bazy w tej procedurze wykonuje **wyłącznie właściciel**:
blok połączenia z zapisem oraz kroki 2–4 (odczyt przed zmianą, zmiana,
odczyt po zmianie) w jednej sesji `psql` i w jednej transakcji. Sesja główna
robi tylko trzy rzeczy: kopię na żądanie (krok 1, operacja gcloud bez
połączenia z bazą), przygotowanie parametrów dla właściciela (krok 1) oraz
wpis w dzienniku audytu (krok 5). W ramach tej procedury sesja główna nie
łączy się z bazą. Agenci nie wykonują żadnego z kroków.

**Połączenie z zapisem — uruchamia wyłącznie właściciel.** Kontrola 7b
(drugi blok sekcji 9) działa w sesji tylko do odczytu, więc do zapisu się nie
nadaje. Właściciel używa tego samego bloku z loginem aplikacji, ale **bez**
`default_transaction_read_only`, tylko na czas kroków 2–4. Sesja główna
i agenci tego bloku nie uruchamiają. `P` ustaw jak w drugim bloku sekcji 9; brak `P`
= stop, nie kontynuować. Hasło administratora (`postgres`) nie jest tu
potrzebne.

```bash
set +x
: "${P:?}"
cloud-sql-proxy --gcloud-auth --port 6543 "${P}:europe-central2:myhelper-pg" &
PGPASSWORD="$(CLOUDSDK_CORE_DISABLE_FILE_LOGGING=1 gcloud --project="${P}" secrets versions access latest --secret=postgres-url | sed -n 's#^postgresql://myhelper_svc:\([A-Za-z0-9]*\)@.*#\1#p')" \
  PGOPTIONS='-c lock_timeout=5s -c idle_in_transaction_session_timeout=5min -c statement_timeout=30s' \
  psql "host=localhost port=6543 user=myhelper_svc dbname=myhelper sslmode=disable"
kill %1
```

Limity czasu idą w środowisku procesu `psql`, tak jak hasło. Pierwsze zapytanie
w sesji: `SHOW idle_in_transaction_session_timeout;` → `5min`; inna wartość =
wyjść. Kroki 2–4 wykonuj jednym ciągiem, bez przerw; nie zostawiaj otwartej
transakcji. Jeśli `psql` wypisze komunikat o utracie połączenia albo
o przekroczeniu limitu bezczynności w transakcji, nie wpisuj kolejnych
poleceń. Wyjdź z `psql`, zamknij proxy i zacznij od kroku 2 w nowej sesji.
Zmiany nie ma, więc kopia z kroku 1 zostaje ważna. Jeśli `COMMIT;` wypisze
`ROLLBACK`, zmiany też nie ma.

**Data w UTC.** Kolumna `salon_subscriptions.trial_ends_at` nie ma strefy
czasowej, a aplikacja zapisuje i porównuje w niej czas UTC. Datę podajemy
więc jawnie w UTC. Koniec dnia D w Polsce to `D 22:59:59` w czasie zimowym
albo `D 21:59:59` w czasie letnim. Salon ma pełny dostęp do tej chwili,
wyłącznie.

**Kroki.**

1. **Kopia na żądanie przed zmianą i parametry** (sesja główna; zasada
   30 dni z 3.6a obowiązuje). Brak `P` = stop, nie kontynuować:

   ```bash
   set +x
   : "${P:?}"
   gcloud --project="${P}" sql backups create --instance=myhelper-pg --description=pre-trial-extension
   gcloud --project="${P}" sql backups list --instance=myhelper-pg --sort-by='~windowStartTime' --limit=1 --format='value(id,type,status,windowStartTime)'
   ```

   Oczekiwane: `ON_DEMAND`, `SUCCESSFUL`. Inny wynik = stop, bez zmiany.
   Id kopii trafia do wpisu z kroku 5. Potem sesja główna przekazuje
   właścicielowi parametry: id salonu i nową datę w UTC (patrz „Data w UTC”).

2. **Otwarcie transakcji i odczyt przed zmianą** (właściciel, w sesji `psql`
   z bloku połączenia z zapisem wyżej):

   ```sql
   BEGIN;
   SELECT id, status, trial_ends_at, stripe_subscription_id IS NULL AS bez_stripe
   FROM salon_subscriptions
   WHERE salon_id = '<id salonu>' AND status IN ('trialing', 'active')
   FOR UPDATE;
   ```

   Oczekiwane: dokładnie jeden wiersz, `status = trialing`, `bez_stripe = t`.
   Zapisz starą wartość `trial_ends_at`. Inny wynik = `ROLLBACK;`, stop
   i pytanie do CTO. Przy `active` salon już płaci i nie ma czego przedłużać.
   Przy wierszu z subskrypcją Stripe (`bez_stripe = f`) synchronizacja ze
   Stripe nadpisałaby datę, więc też `ROLLBACK;` i stop. `FOR UPDATE`
   blokuje wiersz do końca transakcji, więc między sprawdzeniem warunków
   a zmianą nikt go nie zmieni.

3. **Zmiana** (właściciel, ta sama sesja i ta sama transakcja):

   ```sql
   UPDATE salon_subscriptions SET trial_ends_at = '<data UTC, np. 2027-03-01 22:59:59>'
   WHERE salon_id = '<id salonu>' AND status = 'trialing';
   ```

   `psql` ma wypisać `UPDATE 1`. Każdy inny wynik = `ROLLBACK;` i stop.
   Jeśli wyszło `UPDATE 0`, choć odczyt z kroku 2 pokazał ten wiersz,
   właściciel robi `ROLLBACK;` i sprawa wraca do CTO, bo zapis zablokowało
   coś innego niż warunek, np. polityka RLS. W migracjach RLS jest włączone
   bez `FORCE`, więc właściciel tabel (login aplikacji) powinien ją omijać.

4. **Odczyt po zmianie i zatwierdzenie** (właściciel, ta sama sesja i ta
   sama transakcja):

   ```sql
   SELECT status, trial_ends_at FROM salon_subscriptions
   WHERE salon_id = '<id salonu>' AND status = 'trialing';
   ```

   Oczekiwane: jeden wiersz z nową datą. Wtedy `COMMIT;`. Każda rozbieżność
   = `ROLLBACK;` i stop. Po `COMMIT;` wyjście z `psql`, a proxy zamyka
   `kill %1`. Właściciel przekazuje sesji głównej tylko starą datę, nową datę
   i wynik („1 wiersz”, `COMMIT`). Pełny dostęp przy `trialing` z przyszłą
   datą potwierdza test „przedłużenie: przesunięcie trialEndsAt
   z przeszłości na przyszłość…” w `__tests__/lib/subscription-trial-end.test.ts`.

5. **Wpis w dzienniku audytu i powiązanie z salonem** (sesja główna). Wpis
   jak przy kopiach na żądanie (komentarz w #121) zawiera numer porządkowy
   („przedłużenie pilotażu nr N”), starą i nową wartość `trial_ends_at`,
   wynik „1 wiersz”, id kopii z kroku 1 oraz informację „decyzja CTO, zapis
   wykonał właściciel”. Wpis nie zawiera id salonu ani jego skrótu, nazwy
   salonu, adresów e-mail ani danych osobowych. Powiązanie numeru
   porządkowego z salonem jest prywatne i trzymamy je poza repozytorium:
   sesja główna zakłada i prowadzi zgłoszenie w prywatnym systemie zadań
   z dostępem tylko dla zespołu.

**Cotygodniowy przegląd** (sesja główna, przy cotygodniowym odczycie
kosztów). Sesja główna czyta wpisy z kroku 5 w dzienniku audytu, bez
łączenia się z bazą, i wypisuje przedłużenia, którym do końca zostało mniej
niż 7 dni albo termin już minął. Każdy wpis
zawiera nową datę końca pilotażu, więc najnowszy wpis dla danego numeru
porządkowego wyznacza obowiązujący termin. Każdy salon pilotażowy z tej
listy dostaje pytanie o przedłużenie. Po zgodzie salonu przedłużenie idzie
krokami 1–5. Gdy potrzebne jest zapytanie do bazy (np. przy podejrzeniu
rozbieżności z dziennikiem), uruchamia je wyłącznie właściciel:

```sql
SELECT salon_id, trial_ends_at FROM salon_subscriptions
WHERE status = 'trialing' AND trial_ends_at < (now() AT TIME ZONE 'UTC') + interval '7 days'
ORDER BY trial_ends_at;
```

**Próg na przycisk w kodzie.** Ręczna procedura obowiązuje, dopóki nie
nastąpi pierwsze z dwóch zdarzeń: salonów pilotażowych jest więcej niż 3 albo
startuje płatny plan. Wtedy przedłużenie przechodzi do funkcji w panelu
(pełny proces z CTO, bo dotyczy subskrypcji).

## 10. Dane Neon → Cloud SQL: bez kopii

Obowiązujący wariant (decyzja COO z 22.11): baza na starcie **pusta**, schemat tylko z migracji, bez kopii danych z Neona.
Na produkcji były tylko konta testowe. Neona nie kasujemy, nie kopiujemy i nie zmieniamy do 0.13. Bramka bazy (j'): plan, wiersz 0.5 (`docs/PLAN_WEJSCIA_NA_RYNEK_2026-11.md`, etap 0).
Z `docs/runbook-przelaczenie-bazy.md` obowiązują tylko kontrola ról (1.0 pkt 2) i próba odtworzenia; kopia w przód i wstecz (sekcje 2–3) nie obowiązuje, odchudzenie w osobnym PR.
Kontrola ról 1.0 pkt 2 idzie przez `psql_csql_admin` (hasło administratora), więc uruchamia ją właściciel, dopóki nie powstanie osobna rola tylko do odczytu.

## 10a. LB — load balancer HTTPS dla app.nordsignal.cc (krok 1, P1)

Skrypt: `infra/gcp/lb.sh`, strażnik `__tests__/lib/lb-config.test.ts`. Uruchamia
wyłącznie sesja główna (Z1). Zasady jak w sekcji 0: domyślnie dry-run (zero
wywołań gcloud, także odczytów), `--project` w każdym wywołaniu, region tylko
`europe-central2`, stałe nazwy zasobów `myhelper-lb-*`. Decyzje architektury: LB **regionalny**, ingress usługi Cloud Run zostaje `all` na betę
(skrypt nie zmienia usługi), certyfikat przez **autoryzację DNS**. Skrypt nie
ustawia żadnych wiązań IAM.

**Dług: ingress `all`.** Adres `run.app` omija LB (bez `ssl-policy` LB, bez logów
LB i bez przyszłych reguł na LB). Próg zamknięcia: przed pierwszym płacącym
salonem, przy wyniku (c)/(d) pomiaru XFF (4a.2) gorszym niż oczekiwany albo
przed pierwszą regułą bezpieczeństwa na LB (Cloud Armor, limit na LB), bo
`run.app` by ją omijał. Zamknięcie = ingress `internal-and-cloud-load-balancing`
+ Cloud Scheduler przez OIDC.

**Logi LB.** Backend loguje 100% żądań z pełnym `requestUrl` i IP klienta.
Rekord `app` nie może wskazywać LB (krok 3) przed zastosowaniem filtra ścieżek
tokenów (`verify-email|reset-password`) dla Cloud Run **i** LB z retencją 30 dni
(P8). Sprawdzenia kroku 1 (`curl --resolve`) nie wywołują ścieżek `/api/auth/*`
z tokenami.

### Warunki przed `--apply`

1. **Budżet.** Budżet 300 PLN/mies. z progami 50/90/100% istnieje (sekcja 1
   pkt 2). **Koszt LB z Billing Catalog** (jak sekcja 1 pkt 3) liczy sesja główna
   przed Z1: godziny instancji proxy regionalnego LB + dwie forwarding rules
   (443 i 80) + statyczny IP. Suma > **150 PLN/mies.** = stop, architekt wraca
   z decyzją (globalny LB albo bez reguły 80). Wynik (SKU, stawki, suma) w tej
   sekcji, bez danych kont.

   **Wynik (2026-11-22, PLN netto, `europe-central2`, Billing Catalog):**

   | SKU | Pozycja | Stawka | Miesięcznie (730 h) |
   |---|---|---|---|
   | `2876-7A32-9C9D` | Regional External Application LB Forwarding Rule Minimum (obejmuje obie reguły, 443 i 80) | 0,118626 PLN/h | 86,60 PLN |
   | `8C72-8818-9026` | Static Ip Charge (adres regionalny) | 0,047450 PLN/h | 34,64 PLN |
   | `F051-558E-CBE7`, `0805-38B4-A6AA` | przetwarzanie danych, wejście i wyjście | 0,039542 PLN/GiB | < 1 PLN przy ruchu bety |

   Opłaty za instancje proxy katalog dla zewnętrznego regionalnego LB
   w `europe-central2` nie zawiera (jest tylko dla LB wewnętrznych). Suma ok.
   **122 PLN/mies.** — poniżej progu 150 PLN. Stawkę IP potwierdzić odczytem
   kosztów po 24 h (jak IP instancji w sekcji 1 pkt 3). Razem z Cloud SQL
   (45–100 PLN, sekcja 1 pkt 3) to ok. 170–220 PLN/mies. przed Cloud Run, czyli
   blisko progu 90% budżetu (270 PLN) w najgorszym przypadku.
2. **CAA.** CA szuka CAA od nazwy certyfikatu w górę drzewa, a gdy `app` jest
   CNAME-em, idzie za aliasem (RFC 8659) i obowiązuje CAA domeny docelowej.
   Dlatego najpierw `app.nordsignal.cc` (dig idzie za CNAME), potem
   `nordsignal.cc`. Oczekiwane w obu: pusto albo wpis z `pki.goog`. Rozstrzyga
   najbliższy niepusty wynik. Inny CA bez `pki.goog` = certyfikat nie zostanie
   wydany; właściciel dopisuje `0 issue "pki.goog"` w Cloudflare przed `--apply`.
3. **Brak TXT pod `_acme-challenge.app`.** Pod `_acme-challenge.app.nordsignal.cc`
   nie ma rekordu TXT (pozostałość po innym wystawcy blokuje autoryzację DNS).
   Jest = właściciel usuwa go przed `--apply`.
4. **Komponenty `alpha` i `beta` gcloud.** Skrypt używa `gcloud beta` i
   `gcloud alpha` (kanał i alert). Bez nich `--quiet` doinstaluje je w trakcie
   `--apply` albo (SDK z Homebrew, menedżer komponentów wyłączony) przerwie
   przebieg po utworzeniu LB, a przed monitoringiem. Oczekiwane: oba `Installed`.

Odczyt warunków 2–4 (CAA: pusto albo wpis z `pki.goog`; TXT: pusto; komponenty:
`alpha` i `beta` w stanie `Installed`):

```bash
dig +short CAA app.nordsignal.cc
dig +short CAA nordsignal.cc
dig +short app.nordsignal.cc
dig +short TXT _acme-challenge.app.nordsignal.cc
gcloud components list --filter='id:(alpha beta)' --format='value(id,state.name)'
```

Trzecie polecenie odpowiada na pytanie, czy rekord `app` istnieje i dokąd
wskazuje. Wynik w #121 bez wartości IP i nazw hostów, tylko: „brak / CNAME na
zewnętrzny host / A”.

### Wykonanie

Dry-run, porównanie listy `+ …` z §2 P1 projektu (kroki 1–12 w tej kolejności),
potem `--apply`. Adres e-mail powiadomień uptime checka właściciel zapisuje
wcześniej w pliku `$HOME/secure/lb-notify-email` (FileVault, jak klucze
w 4a.1). Sesja główna czyta go z pliku w samym poleceniu: narzędzie Bash nie ma
TTY, więc `read` dostałby EOF, a `--notify-email=` w poleceniu wkłada adres do
transkryptu i historii. Zmienna obowiązuje tylko dla tego jednego polecenia
(bez `export`/`unset`). **Adresu nie ma w repo, w runbooku ani w komentarzach**
(repo publiczne); skrypt go nie wypisuje, nie zapisuje w lokalnym logu gcloud
i nie przepuszcza stderr gcloud z tego wywołania.

```bash
infra/gcp/lb.sh --project=my-helper-2-488419
LB_NOTIFY_EMAIL="$(cat "$HOME/secure/lb-notify-email")" infra/gcp/lb.sh --project=my-helper-2-488419 --apply
```

Wyjście `--apply` zawiera `LB_IP=…` (adres LB do sprawdzeń kroku 1) i
`dns: …` — rekord CNAME autoryzacji (`_acme-challenge_….app.nordsignal.cc`).
Właściciel dodaje go w Cloudflare jako **DNS only** (bez proxy). Rekord `app` jeszcze
nie wskazuje LB. Sesja główna czeka na stan `ACTIVE` certyfikatu (15–60 min):

```bash
gcloud --project=my-helper-2-488419 certificate-manager certificates describe myhelper-lb-cert --location=europe-central2 --format='value(managed.state)'
```

Alert uptime checka powstaje **wyłączony** (usługa za domeną odpowiada dopiero
po kroku 3); włączenie w kroku 3 w konsoli Cloud Monitoring (polityka
`myhelper-app-health-alert`).

### Wycofanie

`--teardown` usuwa zasoby w odwrotnej kolejności (bez wyłączania API), też
najpierw jako dry-run. Właściciel usuwa CNAME autoryzacji. Bez wpływu na
użytkowników, dopóki rekord `app` nie wskazuje LB.

**Najpierw monitoring (10c).** `--teardown` usuwa kanał
`myhelper-lb-owner-email`, którego używają polityki z `monitoring.sh`; póki one
istnieją, API odmówi usunięcia kanału i teardown stanie w połowie. Dlatego
przed każdym `lb.sh --teardown` (także z `--release-ip`):

```bash
infra/gcp/monitoring.sh --project=my-helper-2-488419 --undo
infra/gcp/monitoring.sh --project=my-helper-2-488419 --undo --apply
```

Statyczny IP `myhelper-lb-ip` **zostaje** (wyjście: `skip: myhelper-lb-ip kept`).
Zwolniony adres wraca do puli Google i może trafić do innego projektu GCP; jeśli
rekord DNS nadal na niego wskazuje, przejmujący dostaje ruch salonów i może
uzyskać certyfikat dla `app`.

```bash
infra/gcp/lb.sh --project=my-helper-2-488419 --teardown
infra/gcp/lb.sh --project=my-helper-2-488419 --teardown --apply
```

Zwolnienie adresu (`--release-ip`, tylko razem z `--teardown`). Skrypt przed
`delete` sprawdza rekord A `app.nordsignal.cc` przez `dig` (1.1.1.1 i 8.8.8.8)
i przerywa, gdy wskazuje adres LB albo gdy `dig` zawiedzie. `dig` nie widzi
rekordu proxowanego przez Cloudflare (zwraca IP Cloudflare), dlatego **warunek
przed `--release-ip`**: właściciel potwierdza w panelu Cloudflare, że **żaden**
rekord strefy (A/AAAA, proxowany czy nie) nie ma wartości `LB_IP`, i usuwa
CNAME `_acme-challenge_….app`. Odpowiedź tylko „tak/nie”; „nie” = stop.

```bash
infra/gcp/lb.sh --project=my-helper-2-488419 --teardown --release-ip
infra/gcp/lb.sh --project=my-helper-2-488419 --teardown --release-ip --apply
```

## 10b. Logi — filtr tokenów, retencja, audyt Secret Manager (P8)

Skrypt: `infra/gcp/logging.sh`, strażnik `__tests__/lib/logging-config.test.ts`.
Uruchamia wyłącznie sesja główna (Z3). Zasady jak w sekcji 0: domyślnie dry-run
(zero wywołań gcloud, także odczytów), `--project` w każdym wywołaniu, region
tylko `europe-central2`, stałe nazwy i wartości. Skrypt nie ustawia wiązań IAM,
niczego nie usuwa i nie blokuje retencji.

**Kiedy.** Po kroku 1 (LB z logowaniem), **przed** pierwszym odczytem wartości
sekretu w 4a.1 (inaczej odczyt nie ma śladu) i **przed** rekordem `app` na LB
(krok 3). Zmiana aplikacji z podsekcji „Warunek przed krokiem 2 okna” niżej
jest na `main`, więc sprawdzenie `next.config.ts` przechodzi; jej cofnięcie
zatrzymuje CI i `--apply`. Wykluczenie działa tylko na nowe wpisy.

### Co robi

Najpierw odczyt ujścia `_Default` (błąd odczytu = stop przed jakąkolwiek zmianą).

0. **Zasobnik `myhelper-logs` w `europe-central2`, retencja 30 dni** — nowy cel
   ujścia `_Default`. Powstaje przed zmianą celu (cel bez zasobnika = ujście
   z błędami zapisu); istniejący dostaje te same wartości.
1. **Ujście `_Default`: cel `myhelper-logs` i wykluczenie `myhelper-auth-token-urls`**
   w jednym wywołaniu `sinks update`. Logi żądań Cloud Run i LB (IP, user-agent,
   adresy salonów i ich klientów), stdout/stderr i Data Access Secret Managera
   trafiają od tej chwili do zasobnika w `europe-central2`, zgodnie z DPA, a nie do
   zasobnika `_Default` w lokalizacji `global`. Filtr `_Default` i wykluczenia są
   atrybutami ujścia, więc zostają. Wykluczenie jest zawsze włączone: ponowne
   `--apply` przywraca wykluczenie wyłączone w konsoli. gcloud zamienia wartość
   klucza `disabled` funkcją `bool()` Pythona, więc `disabled=false` (każdy
   niepusty napis) wykluczenie **wyłącza**. Skrypt podaje `disabled=` z pustą
   wartością w `--update-exclusion`, a w `--add-exclusion` pomija klucz. Zaraz
   po zapisie czyta `json(exclusions)` ujścia `_Default`; brak wykluczenia,
   `disabled: true` albo inny filtr kończy przebieg kodem 2 przed punktem 2.
   Wpis nie trafia do logów
   wyłącznie wtedy, gdy metoda to **GET** albo **HEAD** i **adres żądania** (od schematu
   i hosta, ścieżka zaraz po hoście) pasuje do wyrażenia RE2:

   ```
   (httpRequest.requestMethod="GET" OR httpRequest.requestMethod="HEAD") AND httpRequest.requestUrl=~"^https?://[^/?#]+/(api/auth/verify-email[?]|api/auth/reset-password/[A-Za-z0-9]+([?]|$)|reset-password/?[?])"
   ```

   Token resetu to **jeden segment** z alfabetu `generateId` biblioteki
   (`a-z`, `A-Z`, `0-9`, 24 znaki: `password.mjs:74`,
   `@better-auth/core` `dist/utils/id.mjs:4`), po nim `?` albo koniec
   adresu. Adresy z `..`, `%2e%2e`, `/` albo innym znakiem po prefiksie resetu
   (np. `/api/auth/reset-password/../sign-in/email` — po normalizacji inna
   ścieżka) **zostają w logach**; nie da się nimi ukryć żądania do innego
   endpointu. Wykluczane są wyłącznie GET i HEAD (linki z e-maili; skanery linków w poczcie
   wysyłają HEAD z prawdziwym tokenem, a HEAD obsługuje ten sam handler co GET);
   `POST`, `OPTIONS`, `PUT`
   i inne metody na tych adresach zostają w logach. Strażnik ma te przypadki
   wprost i sprawdza alfabet w zainstalowanej bibliotece.

   Kotwica i brak nagłówka Referer są celowe: parametry zapytania, fragment
   i Referer ustala klient. Wyrażenie bez kotwicy albo z Referer pozwalałoby
   ukryć dowolne żądanie (np. zgadywanie haseł na `/api/auth/sign-in/email`
   z dopisanym `?x=/reset-password`). Zostają w logach m.in.
   `/api/auth/sign-in/email?x=/reset-password`, `/login?callbackURL=/reset-password`,
   `/x/reset-password?token=…` oraz `POST /api/auth/reset-password` (ustawienie
   nowego hasła, token w treści) — strażnik ma te przypadki wprost. `[?]` zamiast
   `\?`: bez ucieczek w języku zapytań Logging; wyrażenie nie ma przecinka (rozdziela
   pola `--add-exclusion`). `requestUrl` w Cloud Run i na LB to pełny adres ze
   schematem i hostem (przekierowanie 80→443 loguje `http://…`); potwierdza to
   próba filtra niżej. Wykluczana jest też strona `/reset-password?error=…`
   (przyjęte) i `/reset-password/?token=…` (przed przekierowaniem 308).

   Filtr nie zawęża typu zasobu, więc obejmuje logi żądań Cloud Run i LB.
   Adresy z tokenem jednorazowym (better-auth 1.7.25):

   | Adres | Token | Źródło |
   |---|---|---|
   | `/api/auth/verify-email?token=…&callbackURL=…` | JWT weryfikacji e-mail w parametrze | `node_modules/better-auth/dist/api/routes/email-verification.mjs:31` |
   | `/api/auth/reset-password/<token>?callbackURL=…` | token resetu w ścieżce | `node_modules/better-auth/dist/api/routes/password.mjs:81` |
   | `/reset-password?token=…` | ten sam token po przekierowaniu na stronę aplikacji | `password.mjs:127`, `src/components/auth/forgot-password-form.tsx:44`, `src/components/auth/reset-password-form.tsx:35` |

   Referer: przy domyślnej polityce (`strict-origin-when-cross-origin` w obrębie
   originu, `next.config.ts:94-95`) strona `/reset-password?token=…` wysyłałaby
   pełny adres w Referer zasobów, RSC i formularza, a filtr bez klauzuli Referer
   nie usunąłby tokenu z `httpRequest.referer`. Usuwa go aplikacja, nie filtr
   logów (podsekcja „Warunek przed krokiem 2 okna” niżej): `Referrer-Policy:
   no-referrer` na trzech adresach z tokenem i usunięcie tokenu z paska adresu.
   Sam token idzie w treści POST (`reset-password-form.tsx:97-100`), treści
   żądań platforma nie loguje.
   Poza filtrem: `/api/auth/callback/google?code=…&state=…` — kod jest
   jednorazowy i zużywany w tym samym żądaniu (wymiana wymaga sekretu klienta
   i stanu z bazy), więc wpis w logu nie daje przejęcia konta. Magic link i
   zmiana adresu e-mail nie są włączone (`src/lib/auth.ts:55-121`).
   Koszt: tracimy ślad żądań na tych ścieżkach (przyjęty).
   Strażnik sprawdza te szablony adresów w zainstalowanej bibliotece: zmiana
   po aktualizacji Better Auth zatrzymuje test, zanim filtr przestanie działać.
2. **Retencja zasobnika `_Default` = 30 dni** ustawiona jawnie. Obejmuje wpisy
   sprzed zmiany celu (zostają w `_Default`, `global`, do wygaśnięcia) i wpisy
   z kilku minut propagacji zmiany ujścia. Luki w ciągłości nie ma. Do polityki
   prywatności: IP i user-agent jako dane administratora, cel bezpieczeństwo, 30 dni.
3. **Data Access `DATA_READ` dla `secretmanager.googleapis.com`** — każdy
   odczyt wartości sekretu ma wpis audytu. Skrypt czyta politykę IAM projektu do
   pliku tymczasowego (polityka zawiera adresy kont: nie jest wypisywana, bez
   lokalnego logu gcloud), dopisuje wyłącznie `auditConfigs` i zapisuje ją z tym
   samym `etag` (równoległa zmiana polityki = błąd, nie nadpisanie). Przed
   zapisem sprawdza, że polityka bez `auditConfigs` jest identyczna z odczytaną
   (inna różnica = stop bez zapisu). Katalog tymczasowy usuwa pułapka `EXIT`
   (także po błędzie i po Ctrl-C); błędy `node` i gcloud nie są wypisywane, bo
   mogą cytować adresy kont. Wymaga `node` w `PATH`. Już włączone = `skip`.
   **Zgoda właściciela na Z3 wymienia wprost** „`set-iam-policy` na projekcie
   (tylko `auditConfigs`)” — to zapis polityki IAM projektu. Konto deploy nie
   dostaje `setIamPolicy`.
4. **Zasobnik `myhelper-audit` w `europe-central2`, retencja 365 dni**, i ujście
   `myhelper-audit-sink`: Admin Activity całego projektu + Data Access Secret
   Managera. Wpisy dalej trafiają też do `_Required` (Admin Activity, 400 dni)
   i przez `_Default` do `myhelper-logs` (Data Access, 30 dni). Koszt przy tym
   ruchu pomijalny.

Oba ujścia (`_Default`, `myhelper-audit-sink`) piszą do zasobników w tym samym
projekcie, więc writerIdentity nie dostaje roli (brak `add-iam-policy-binding`
jest celowy). Po zmianie celu nowe wpisy są **wyłącznie** w `myhelper-logs`:
każdy odczyt po `--apply` podaje `--bucket=myhelper-logs --location=europe-central2
--view=_AllLogs` (odczyt bez `--bucket` nie gwarantuje objęcia tego zasobnika).

### Przed `--apply`

Czy w logach są już wpisy z tymi ścieżkami (wynik: same znaczniki czasu, bez
adresów):

```bash
set +x
gcloud --project=my-helper-2-488419 logging read 'httpRequest.requestUrl=~"/(api/auth/)?(verify-email|reset-password)" OR httpRequest.referer=~"/(api/auth/)?(verify-email|reset-password)"' --freshness=30d --limit=5 --format='value(timestamp)'
```

Pusto = dalej. Niepusto = stop, decyzja właściciela (wpisy wygasają z
retencją; usunąć można tylko cały log). Surowych wpisów sesja główna nie czyta.
Rozbieżność z filtrem wykluczenia jest celowa: ten odczyt jest szeroki (dawne
wyrażenie bez kotwicy, razem z Referer), bo tylko wykrywa i zwraca same znaczniki
czasu. Odczyt bez `--bucket`, bo dotyczy historii w `_Default` (`global`).

**Odmowa `--apply` bez `no-referrer`.** Przed pierwszym wywołaniem gcloud
skrypt czyta `next.config.ts` z repo, z którego jest uruchomiony, i sprawdza, że
`headers()` ma dla każdej ze ścieżek `/reset-password`,
`/api/auth/reset-password/:token` i `/api/auth/verify-email` wpis
`{ key: "Referrer-Policy", value: "no-referrer" }` **po** ostatnim wpisie
`"/(.*)"`. Brak któregokolwiek = `--apply` kończy się kodem 2 (`error: --apply
refused: …` z listą brakujących ścieżek), bez żadnego wywołania gcloud. Dry-run
działa zawsze i wypisuje wynik (`referrer-policy: ok …` albo `referrer-policy:
missing …`). Sprawdzenie jest tekstowe: wpis w postaci `source: "…"` i
`key`/`value` w tej samej albo kolejnych liniach; linie `//` są pomijane.
Flagi ani zmiennej omijającej nie ma. Na `main` wpisy są (podsekcja „Warunek
przed krokiem 2 okna”), więc wynik to `referrer-policy: ok`. Strażnik
`__tests__/lib/logging-config.test.ts` uruchamia skrypt z repo i oczekuje
wyniku `ok`: usunięcie albo zmiana któregoś wpisu zatrzymuje CI, zanim
zatrzyma `--apply`. Skrypt `--apply` uruchamia się z `main`.

### Wykonanie

```bash
infra/gcp/logging.sh --project=my-helper-2-488419
infra/gcp/logging.sh --project=my-helper-2-488419 --apply
```

Nie uruchamiaj `--apply` z rewizji sprzed poprawki kontroli wykluczenia (PR #466); uruchamiaj tylko z aktualnego `main`.

Dry-run: najpierw `referrer-policy: ok …` (inaczej `--apply` odmówi — stop:
wpisy z `next.config.ts` zniknęły albo skrypt nie jest uruchomiony z `main`), potem `? … sinks describe _Default`, potem lista `+ …` z punktami
0–4 (w tej kolejności: `buckets create|update myhelper-logs`, `sinks update
_Default <cel myhelper-logs> --add-exclusion=…|--update-exclusion=…,disabled=`,
`? … sinks describe _Default --format=json(exclusions)` (kontrola po zapisie),
`buckets update _Default`, `set-iam-policy`, zasobnik i ujście audytu), potem
`--apply`.

### Sprawdzenie (bez adresów kont)

```bash
gcloud --project=my-helper-2-488419 logging buckets describe myhelper-logs --location=europe-central2 --format='value(retentionDays)'
gcloud --project=my-helper-2-488419 logging sinks describe _Default --format='value(destination)'
gcloud --project=my-helper-2-488419 logging sinks describe _Default --format='json(exclusions)'
gcloud --project=my-helper-2-488419 logging buckets describe _Default --location=global --format='value(retentionDays)'
gcloud --project=my-helper-2-488419 logging buckets describe myhelper-audit --location=europe-central2 --format='value(retentionDays)'
gcloud --project=my-helper-2-488419 logging sinks describe myhelper-audit-sink --format='value(destination)'
gcloud --project=my-helper-2-488419 projects get-iam-policy my-helper-2-488419 --format='json(auditConfigs)'
```

Oczekiwane: `30`; cel `_Default` =
`logging.googleapis.com/projects/my-helper-2-488419/locations/europe-central2/buckets/myhelper-logs`;
wykluczenie `myhelper-auth-token-urls` z filtrem jak w punkcie 1 i bez
`disabled: true`; `30`; `365`; cel z `locations/europe-central2/buckets/myhelper-audit`;
wpis `secretmanager.googleapis.com` z `DATA_READ`. Ostatnie polecenie wypisuje
wyłącznie `auditConfigs` (bez wiązań i adresów kont).

**Przekierowanie `_Default`.** Co najmniej 10 min po `--apply` (propagacja zmiany
ujścia) jedno żądanie kontrolne, po 2 min odczyt samych znaczników czasu z obu
zasobników:

```bash
curl -s -o /dev/null -w '%{http_code}\n' "https://myhelper-<hash>.europe-central2.run.app/api/health"
gcloud --project=my-helper-2-488419 logging read 'httpRequest.requestUrl=~"/api/health"' --bucket=myhelper-logs --location=europe-central2 --view=_AllLogs --freshness=5m --limit=1 --format='value(timestamp)'
gcloud --project=my-helper-2-488419 logging read 'httpRequest.requestUrl=~"/api/health"' --bucket=_Default --location=global --view=_AllLogs --freshness=5m --limit=1 --format='value(timestamp)'
```

Oczekiwane: pierwszy odczyt ze znacznikiem czasu, drugi pusty. Inaczej = stop.

**Próba filtra (cztery próby).** Znacznik `probe-ev-…` jest w parametrze adresu.
Dwa żądania z nieważnym tokenem (run.app i LB — krok 1 poprzedza Z3) mają być
**wykluczone**; dwa żądania kontrolne, które tylko wspominają ścieżkę resetu
w parametrze albo w nagłówku Referer, **muszą** się zalogować. `<LB_IP>` to
`LB_IP=…` z wyjścia `lb.sh --apply` (sekcja 10a); `--resolve` kieruje żądanie
na LB, zanim rekord `app` go wskazuje. Po 2 min odczyt samych znaczników czasu
z `myhelper-logs`:

```bash
set +x
curl -s -o /dev/null -w '%{http_code}\n' "https://myhelper-<hash>.europe-central2.run.app/api/auth/verify-email?token=probe-ev-run"
curl -s -o /dev/null -w '%{http_code}\n' --resolve "app.nordsignal.cc:443:<LB_IP>" "https://app.nordsignal.cc/api/auth/verify-email?token=probe-ev-lb"
curl -s -o /dev/null -w '%{http_code}\n' --resolve "app.nordsignal.cc:443:<LB_IP>" "https://app.nordsignal.cc/api/health?x=/reset-password&m=probe-ev-query"
curl -s -o /dev/null -w '%{http_code}\n' --resolve "app.nordsignal.cc:443:<LB_IP>" -H "Referer: https://app.nordsignal.cc/reset-password?token=probe-ref" "https://app.nordsignal.cc/api/health?m=probe-ev-referer"
gcloud --project=my-helper-2-488419 logging read 'httpRequest.requestUrl=~"probe-ev-run"' --bucket=myhelper-logs --location=europe-central2 --view=_AllLogs --freshness=10m --format='value(timestamp)'
gcloud --project=my-helper-2-488419 logging read 'httpRequest.requestUrl=~"probe-ev-lb"' --bucket=myhelper-logs --location=europe-central2 --view=_AllLogs --freshness=10m --format='value(timestamp)'
gcloud --project=my-helper-2-488419 logging read 'httpRequest.requestUrl=~"probe-ev-query"' --bucket=myhelper-logs --location=europe-central2 --view=_AllLogs --freshness=10m --format='value(timestamp)'
gcloud --project=my-helper-2-488419 logging read 'httpRequest.requestUrl=~"probe-ev-referer"' --bucket=myhelper-logs --location=europe-central2 --view=_AllLogs --freshness=10m --format='value(timestamp)'
```

Oczekiwane: `probe-ev-run` pusto, `probe-ev-lb` pusto, `probe-ev-query` jest,
`probe-ev-referer` jest (wpis LB i wpis Cloud Run). Pusto przy którejkolwiek
próbie kontrolnej = stop (filtr ukrywa żądania albo odczyt nie widzi zasobnika).
Niepusto przy próbie z tokenem = stop (filtr nie działa na tej platformie).
Wynik w #121: wyłącznie „pusto / jest” dla każdej z czterech prób.

Ryzyko szczątkowe (sprawdzić przy próbie, nie blokuje): zakładka „Logs”
w konsoli Cloud Run po przekierowaniu. Alarmuje uptime check z kroku 1.

**Ślad odczytu sekretu.** Po pierwszym `secrets versions access` w 4a.1:

```bash
gcloud --project=my-helper-2-488419 logging read 'protoPayload.serviceName="secretmanager.googleapis.com" AND protoPayload.methodName:"AccessSecretVersion"' --bucket=myhelper-audit --location=europe-central2 --view=_AllLogs --freshness=1h --limit=1 --format='value(timestamp)'
```

Oczekiwany znacznik czasu. Pusto = stop przed kolejnymi odczytami sekretów.

### Wycofanie

Brak `--teardown` z założenia: wykluczenie i ślad audytu zmniejszają ryzyko,
a usunięty zasobnik logów blokuje nazwę na 7 dni. Zmiana wartości = zmiana stałych
w skrypcie, recenzja i ponowne `--apply` (istniejące zasoby dostają `update`).

Cofnięcie celu ujścia `_Default` do zasobnika `_Default` (ręcznie, sesja główna,
wyłącznie z decyzji właściciela; logi żądań wracają wtedy do lokalizacji `global`,
co jest niezgodne z DPA). Nie zastępuje `--teardown`; wykluczenie zostaje.

```bash
gcloud --project=my-helper-2-488419 logging sinks update _Default logging.googleapis.com/projects/my-helper-2-488419/locations/global/buckets/_Default
```

### Warunek przed krokiem 2 okna (zmiana aplikacji)

Filtr nie obejmuje nagłówka Referer, więc strona `/reset-password?token=…` nie
może wysyłać adresu z tokenem. Zmiana aplikacji (osobny PR, pełny proces:
ścieżka resetu hasła) ma być **wdrożona na rewizji GCP przed krokiem 2 okna**
(najprościej przed 4a.1, wtedy 4a.1 wdraża sha z poprawką; scalenie bez
migracji jest dozwolone w zamrożeniu). Zawartość:

- `next.config.ts` `headers()`: osobne wpisy `source: "/reset-password"`,
  `source: "/api/auth/reset-password/:token"` i `source: "/api/auth/verify-email"`
  z `Referrer-Policy: no-referrer`, **po** wpisie `"/(.*)"` (przy tym samym
  kluczu wygrywa ostatni), bezwarunkowe (bez `has`/`missing`) i poza komentarzem
  blokowym — w kształcie, który sprawdza `logging.sh` (wyżej, „Odmowa `--apply`
  bez `no-referrer`”). Nagłówek, nie tylko `<meta>`: zasoby z `<head>` startują
  przed parsowaniem meta.
- `src/components/auth/reset-password-form.tsx`: token wczytany do stanu
  (`useState`) przy pierwszym renderze, potem `history.replaceState(null, …)`
  bez `token` (pozostałe parametry i fragment zostają). Formularz czyta token
  ze stanu, nie z `useSearchParams` (w Next 16 `replaceState` odświeża
  `useSearchParams`, więc formularz pokazałby „Brak tokenu”). Stan `null`, żeby
  Next.js zsynchronizował adres routera; bez `router.replace` (fetch RSC).
  Usunięcie tokenu z adresu chroni też historię przeglądarki na współdzielonym
  komputerze w salonie.
- Weryfikacja e-mail nie ma strony aplikacji z tokenem w adresie: link z e-maila
  prowadzi wprost na `/api/auth/verify-email?token=…`, a ten przekierowuje na
  `callbackURL` bez tokenu (`email-verification.mjs:166-288`).
- Testy: `__tests__/lib/referrer-policy-headers.test.ts` (nagłówki z
  `next.config.ts`: `no-referrer` na trzech adresach, `strict-origin-when-cross-origin`
  na innych, kształt wpisów), `__tests__/components/ResetPasswordForm.test.tsx`
  (token znika z adresu, formularz po `replaceState` nadal wysyła token,
  `error=INVALID_TOKEN` z przekierowania Better Auth daje komunikat o wygasłym
  linku), `tests/auth/authentication.spec.ts` „Reset password token handling”
  (E2E na bazie CI). `@smoke`: nagłówki odpowiedzi, brak tokenu w adresie,
  wpis historii nadal z `__NA` i drzewem routera, „wstecz”/„naprzód” bez
  tokenu, POST z tokenem bez Referer, wygasły link z e-maila; także `@smoke` (dowód przed scaleniem): pełny
  reset z prawdziwym tokenem: własny użytkownik testu, prośba o link, token
  odczytany z tabeli `verification` (ten sam `POSTGRES_URL` i strażnik hosta
  co `globalTeardown`), link `GET /api/auth/reset-password/<token>` → 302 →
  strona resetu, `no-referrer` na obu odpowiedziach, POST bez Referer,
  przekierowanie na `/login?reset=success`, logowanie nowym hasłem (stare
  odrzucone).

Kolejność wymuszona skryptem: bez tych wpisów w `next.config.ts`
`logging.sh --apply` odmawia (kod 2), a strażnik skryptu na prawdziwym repo
czerwieni CI. **Brak tej zmiany na rewizji GCP przed krokiem 2 okna = stop okna.**

### Znane ograniczenie

Zasobnik `_Required` (Admin Activity, 400 dni) ma lokalizację `global` i nie da
się tego zmienić. Zawiera tożsamości operatorów (konto właściciela, konta usług),
a nie dane salonów ani ich klientów; ograniczenie przyjęte i wpisane do rejestru
przy T1.

## 10c. Monitoring — błędy, 5xx, Scheduler, uptime run.app

Skrypt: `infra/gcp/monitoring.sh`, strażnik `__tests__/lib/monitoring-config.test.ts`.
Zasady jak w sekcji 0: domyślnie dry-run (zero wywołań gcloud, także odczytów),
`--project` w każdym wywołaniu, region tylko `europe-central2`, stałe nazwy,
filtry i progi. Skrypt nie tworzy kanału i nie ustawia wiązań IAM.

**Kiedy.** Po `lb.sh --apply` (10a — skrypt używa jego kanału e-mail
`myhelper-lb-owner-email`; bez kanału `--apply` kończy się kodem 2 przed
jakąkolwiek zmianą) i po `logging.sh --apply` (10b), **przed oknem**.

**Co tworzy** (alerty włączone, wszystkie na kanał z 10a):

| Zasób | Warunek |
|---|---|
| `myhelper-run-errors-alert` | log: `resource.type="cloud_run_revision" AND resource.labels.service_name="myhelper" AND severity>=ERROR AND NOT log_id("run.googleapis.com/requests")` (log żądań ma `ERROR` przy każdej 5xx — te liczy alert 5xx) |
| `myhelper-run-5xx-alert` | metryka `run.googleapis.com/request_count`, `response_code_class="5xx"`: suma > 3 w 5 min (liczba, nie procent) |
| `myhelper-scheduler-errors-alert` | log: `resource.type="cloud_scheduler_job" AND severity>=ERROR` (nieudane próby) |
| `myhelper-runapp-health` + `myhelper-runapp-health-alert` | uptime `https://<run.app>/api/health` co 1 min, timeout 10 s, 3 regiony, treść zawiera `"status":"healthy"`; alert: co najmniej 2 regiony z błędem przez 1 min |

Alerty z logów: limit powiadomień 10 min (seria błędów i ponowienia zadania
Schedulera = jeden e-mail na 10 min), autoClose 30 min, **bez** `labelExtractors`.
`/api/health` pinguje bazę, więc alert uptime odpala także przy awarii bazy
(503), nie tylko usługi. Nieobsłużony wyjątek wypisany przez Node zwykłym
tekstem na stderr ma zwykle ważność `DEFAULT`, więc alert błędów go nie złapie;
pokrywają go tylko alert 5xx i uptime (Error Reporting wyłączony, niżej).
Wyjątek `DEFAULT` bez 5xx (np. błąd zadania w tle) nie alarmuje — luka
przyjęta razem z wyłączeniem Error Reporting. Adres run.app skrypt czyta z usługi
(`run services describe myhelper --format=value(status.url)`) i przyjmuje tylko
host `myhelper-….run.app`. Istniejący zasób zostaje bez zmian (`skip: … exists`);
zmiana stałych = `--undo`, potem `--apply`.

### Wykonanie

```bash
infra/gcp/monitoring.sh --project=my-helper-2-488419
infra/gcp/monitoring.sh --project=my-helper-2-488419 --apply
```

Dry-run: najpierw `? … channels list` i `? … run services describe`, potem
`+ …` w kolejności: trzy `policies create` (błędy, 5xx, Scheduler),
`uptime create myhelper-runapp-health`, `policies create` (alert uptime).
`--apply`: `state: exists` przy kanale, `run.app host: myhelper-….run.app`,
pięć zasobów utworzonych; ponowne `--apply` = same `skip: … exists`.

Sprawdzenie (bez adresów e-mail):

```bash
gcloud --project=my-helper-2-488419 alpha monitoring policies list --filter='displayName~"^myhelper-(run|scheduler|runapp)"' --format='value(displayName,enabled)'
gcloud --project=my-helper-2-488419 monitoring uptime list-configs --filter='displayName="myhelper-runapp-health"' --format='value(displayName,timeout,selectedRegions)'
```

Oczekiwane: cztery polityki z `True`; uptime z `10s` i trzema regionami.

### Krok ręczny: powiadomienia Error Reporting — POMINIĘTY

Error Reporting wyłączony (decyzja 2026-11-22, niżej); krok wraca razem z nim.
Powiadomień o **nowych grupach błędów** w Error Reporting gcloud nie obsługuje.
W konsoli: Error Reporting → „Configure notifications” → kanał
`myhelper-lb-owner-email`. Przed testem niżej.

### Test po wdrożeniu (jeden błąd testowy)

Jeden wpis `ERROR` w kształcie loggera aplikacji (`severity`, `message`,
`stack_trace`), z zasobem usługi `myhelper`, bez żadnych danych. Token dostępu
idzie nagłówkiem z `-H @<(…)` (nie trafia do argumentów `curl`); blok w bash
albo zsh:

```bash
set +x
P=my-helper-2-488419
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://logging.googleapis.com/v2/entries:write \
  -H @<(printf 'Authorization: Bearer %s\n' "$(gcloud auth print-access-token)") -H 'Content-Type: application/json' \
  -d '{"entries":[{"logName":"projects/'"$P"'/logs/monitoring-probe","resource":{"type":"cloud_run_revision","labels":{"project_id":"'"$P"'","service_name":"myhelper","revision_name":"monitoring-probe","configuration_name":"myhelper","location":"europe-central2"}},"severity":"ERROR","jsonPayload":{"message":"Error: monitoring-probe test error","stack_trace":"Error: monitoring-probe test error\n    at probe (/app/monitoring-probe.js:1:1)"}}]}'
```

Oczekiwane: `200`; w ciągu ok. 10 min e-mail alertu `myhelper-run-errors-alert`.
Brak e-maila = stop. Treść: e-mail **nie** zawiera tekstu
`monitoring-probe test error` (polityka bez treści wpisu). Tekst w e-mailu = stop.
Incydent zamknąć w konsoli (albo poczekać na autoClose 30 min). Wykonane
2026-11-22: e-mail w ciągu minuty, bez tekstu wpisu.

**Dane.** E-maile polityk z `monitoring.sh`, wyłącznie na adres właściciela
(kanał z 10a); żadnych dodatkowych odbiorców, list ani integracji. Treść: nazwa
polityki, opis, etykiety zasobu i link, **bez** treści wpisu (brak
`labelExtractors`; sprawdza test wyżej). Przepływ dopisać do rejestru czynności
przetwarzania (ten sam co przy T1) przed oknem. Po powrocie Error Reporting
dochodzą jego e-maile (komunikat i fragment stosu, mogą zawierać dane osobowe
klientów salonów): reguła usuwania po 30 dniach w skrzynce i drugi wpis
w rejestrze.

**Lokalizacja Error Reporting — decyzja przed krokiem 1 okna, wpis w #121.**
Error Reporting jest usługą globalną; może przechowywać grupy błędów (komunikat,
stos) poza `europe-central2`. Testem tego nie da się ustalić — źródło to
dokumentacja Google (Error Reporting, Data Location w Service Specific Terms).
Wynik: przyjąć (wymaga podstawy w Google Cloud DPA i zgodności z tym, co
obiecujemy salonom: umowa powierzenia, polityka prywatności — obietnica
przechowywania w EOG wyklucza „global”) albo wyłączyć. **Bez decyzji:
wyłączyć** — `services disable clouderrorreporting.googleapis.com` i pominąć
krok ręczny powiadomień; alerty z `monitoring.sh` działają bez Error Reporting.

**Decyzja 2026-11-22: wyłączony** (wpis w #121). API nie było włączone, krok
ręczny powiadomień pominięty, opisy alertów nie odsyłają do Error Reporting.
Powrót po zamknięciu umowy powierzenia i polityki prywatności.

### Uptime run.app: do kiedy

Uptime `myhelper-runapp-health` obowiązuje **do T7**. Po K1 domenę pilnuje
uptime z `lb.sh` (`myhelper-app-health`, alert włączany w kroku 3) — wtedy
uptime run.app usunąć:

```bash
infra/gcp/monitoring.sh --project=my-helper-2-488419 --undo --only-runapp
infra/gcp/monitoring.sh --project=my-helper-2-488419 --undo --only-runapp --apply
```

i w osobnym PR usunąć część run.app ze skryptu (inaczej kolejne `--apply`
utworzy ją ponownie). Dziś ingress usługi to `all`; przy zamknięciu długu
ingress (10a, `internal-and-cloud-load-balancing`) adres run.app przestaje
odpowiadać, a alert uptime run.app odpalałby stale — usunięcie najpóźniej razem
ze zmianą ingress.

### Wycofanie

`--undo` (najpierw dry-run, potem `--apply`) usuwa wyłącznie pięć zasobów tego
skryptu; kanał `myhelper-lb-owner-email` zostaje (należy do `lb.sh`).

Przy wycofaniu LB (10a) `monitoring.sh --undo --apply` idzie **przed**
`lb.sh --teardown`: teardown usuwa kanał, a API nie usunie kanału, którego
używają polityki tego skryptu.

## 11. Punkty otwarte

- `wif`: warunek ostateczny (sekcja 3.8); wykonanie czeka na bramkę (hook
  `guard-deploy-subagent` podpisany i zainstalowany z próbą kontrolną albo konto
  maszynowe). Stan: logowanie przez WIF działa (przebiegi 44817913061
  i 44821507855 opisane w `__tests__/lib/workflows.test.ts`; workflow nie ma
  kluczy JSON). Otwarte: czym spełniono bramkę 3.8 i odczyt D-4e
  (`attributeCondition` równy plikowi warunku) — w repo nie ma zapisu.
- ~~K-1 (#144): musi być na `main` przed D-7 — łączność Cloud SQL przez gniazdo,
  sekrety tylko z wersją, bez `--allow-unauthenticated`, `GCS_PUBLIC_BASE_URL`
  z jednego źródła.~~ Zamknięte: wszystkie cztery punkty na `main`
  (`infra/gcp/run-deploy.sh`, `run-migrate.sh`, `Dockerfile`; strażniki K-1
  w `__tests__/lib/workflows.test.ts`).
- ~~K-2 (#135): zawężenie allowlisty e2e do naszej usługi.~~ Zamknięte:
  allowlista przyjmuje tylko adres taga usługi `myhelper` w naszym projekcie
  i regionie (`.github/workflows/e2e-production.yml`, krok „Cloud Run mode must
  target our tagged Cloud Run URL”; testy allowlisty w
  `__tests__/lib/workflows.test.ts`).
- ~~K-3 (#137): harmonogram wstrzymany.~~ Zamknięte: `infra/gcp/scheduler.sh`
  tworzy zadania wstrzymane i odczytuje stan (sekcja 8; strażnik
  `__tests__/lib/scheduler-paused.test.ts`).
- Logowanie Google: na betę wyłączone (plan 1.4, `production-gcp` bez
  `GOOGLE_CLIENT_ID`). Przycisk Google wyświetla się mimo to, a po kliknięciu
  logowanie nie działa (`src/components/auth/sign-in-button.tsx:168-206`). Ukrycie
  przycisku bez `GOOGLE_CLIENT_ID` to osobna zmiana przed przełączeniem
  (warunek P10 w `docs/runbook-zatrzymanie-zapisow.md`).
- Koszt IP instancji: potwierdzić odczytem kosztów po 24 h (sekcja 1 pkt 3).
- Pomiar TTFB (plan 0.6): otwarty do pomiaru na domenie po K1 (sekcja 12).

## 12. Pomiar TTFB (plan 0.6)

Odniesienie z Vercela: strony panelu 2,5–3,5 s, pojedyncze API 1,4–3 s,
strony publiczne 250 ms (`docs/PLAN_WEJSCIA_NA_RYNEK_2026-11.md`, B3 i 0.6).

Zasady:

- przed oknem mierzymy `/api/health` i stronę publiczną;
- strony panelu mierzymy po pierwszym salonie na GCP (na pustej bazie nic nie
  pokażą);
- pomiar na domenie po K1 zamyka 0.6.

Polecenie: trzy próby, wynik to mediana (środkowa z trzech wartości).
`<adres>` to pełny adres miejsca z kolumny „Adres” razem ze ścieżką. Hostów
spoza tego runbooka nie wpisujemy do repo. Drugie pole wyniku to kod odpowiedzi:
próba z kodem innym niż 200 (albo `000`, brak połączenia) nie liczy się —
powtórzyć pomiar.

```bash
for i in 1 2 3; do curl -s -o /dev/null -w '%{time_starttransfer} %{http_code}\n' "<adres>"; done | LC_ALL=C sort -n | sed -n 2p
```

| Data | Adres | Ścieżka | Mediana z 3 | Uwagi |
|---|---|---|---|---|
| 2026-11-22 | Vercel produkcja | `/api/health` | 0,91 s | pomiar z Polski |
| 2026-11-22 | Cloud Run `run.app` (główny adres usługi) | `/api/health` | 0,12 s | pomiar z Polski; bez ruchu użytkowników, instancja ciepła |
