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
  historii powłoki ani logu). Tylko strumień do `--data-file=-` albo plik spoza
  repo w `--data-file=ŚCIEŻKA`. Bez `set -x`.
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
wywoływać `sql users create|set-password` z `CLOUDSDK_CORE_DISABLE_FILE_LOGGING=1`
(inaczej hasła bazy lądują jawnym tekstem w `~/.config/gcloud/logs/`).
Sprawdzenie przed etapem:

```bash
grep -c 'CLOUDSDK_CORE_DISABLE_FILE_LOGGING=1 "${GC\[@\]}" sql users' infra/gcp/bootstrap.sh   # = 1
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

## 2a. Cofanie etapu (sesja główna)

Zasada: najpierw poprawić i **powtórzyć** etap (idempotentny); cofać tylko, gdy
zasób powstał z błędną konfiguracją, której nie da się zmienić w miejscu.
`P=my-helper-2-488419; R=europe-central2`.

| Etap | Cofnięcie | Pułapka |
|---|---|---|
| `run` | `gcloud --project=$P run services delete myhelper --region=$R` i `… run jobs delete myhelper-migrate --region=$R` | wiązania na zasobie znikają razem z nim — powtórzyć cały etap `run` |
| `sql` | padło po utworzeniu instancji → **nie usuwać**, poprawić i powtórzyć etap (skrypt czeka na `RUNNABLE`, a przed bazą i loginami sprawdza stan). Usunięcie tylko po `… sql instances patch myhelper-pg --no-deletion-protection`, potem `… sql instances delete myhelper-pg` | nazwy usuniętej instancji nie da się użyć ponownie przez ok. **tydzień** → nowa nazwa: `--sql-instance=<nowa>`, zmiana `SQL_INSTANCE` w D-6 i nowa wersja `postgres-url` (skrypt ją utworzy, jeśli sekret nie ma wersji — starą wyłączyć `secrets versions disable`). Wiązania z warunkiem na starą nazwę usunąć (`projects remove-iam-policy-binding … --condition=…`) |
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
  `--deletion-protection`, okno serwisowe SUN 03:00 UTC, `--ssl-mode=ENCRYPTED_ONLY`,
  publiczne IP **bez** autoryzowanych sieci (połączenia wyłącznie przez Cloud SQL
  Auth Proxy / wbudowany konektor Cloud Run);
- bazę `myhelper`;
- **jeden login** `myhelper_owner` (aplikacja i migracje; Oliver 19:44) z losowym
  hasłem `[A-Za-z0-9]{32}` i wersję sekretu `postgres-url`:
  `postgresql://myhelper_owner:<HASŁO>@localhost/myhelper?host=/cloudsql/my-helper-2-488419:europe-central2:myhelper-pg`
  (bez `sslmode` — szyfruje konektor). Drugi login (osobny dla migracji) to #131
  (P3, przed pierwszym płacącym salonem) — bootstrap go nie przewiduje;
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
  `(resource.type == "sqladmin.googleapis.com/Instance" && resource.name == "projects/P/instances/myhelper-pg") || (resource.type == "sqladmin.googleapis.com/BackupRun" && resource.name.startsWith("projects/P/instances/myhelper-pg/"))`.
  Cloud SQL nie ma polityk IAM na instancji, więc wiązanie projektowe z warunkiem
  (Oliver). Z bazą łączy się
  tylko konto runtime: usługa i job migracji `myhelper-migrate` działają jako
  `myhelper-runtime` (`run-migrate.sh`: `--service-account="$RUNTIME_SA"`).
  Po stronie deploy nic nie łączy się z bazą, więc deploy nie ma `cloudsql.client`.

Hasła: generowane w pamięci procesu, do gcloud tylko przez `--flags-file`
ze strumienia (`sql users create|set-password`) i `--data-file=-`
(`secrets versions add`); nie są wypisywane. Wywołania `sql users …` (B-1)
i `secrets versions add` (N2, K-1b) idą z `CLOUDSDK_CORE_DISABLE_FILE_LOGGING=1`. Gdy sekret ma już wersję
ENABLED, etap pomija dany login (hasło bez zmian). Gdy wersji brak, a login
istnieje (przerwany przebieg), hasło jest ustawiane od nowa (`set-password`) —
stan sam się naprawia. **Błąd odczytu** wersji (sieć, uprawnienia — kod ≠ 0
z `secrets versions list`) przerywa etap przed jakąkolwiek zmianą hasła; to nie
jest traktowane jak „brak wersji” (Ethan, #134). Po utworzeniu instancji skrypt
sprawdza `state`; baza, loginy i wiązania powstają tylko przy `RUNNABLE`, inaczej
stop — powtórzyć etap później.

Bootstrap **nie tworzy ról NOLOGIN**. `myhelper_app` tworzy migracja 0005.

Odczyt stanu po etapie:

```bash
P=my-helper-2-488419
gcloud --project=$P sql instances describe myhelper-pg --format='yaml(databaseVersion,settings.edition,settings.tier,settings.availabilityType,settings.dataDiskSizeGb,settings.storageAutoResizeLimit,settings.backupConfiguration,settings.maintenanceWindow,settings.ipConfiguration.sslMode,settings.ipConfiguration.authorizedNetworks,settings.deletionProtectionEnabled)'
gcloud --project=$P sql databases list --instance=myhelper-pg --format='value(name)'
gcloud --project=$P sql users list --instance=myhelper-pg --format='value(name)'
gcloud --project=$P secrets versions list postgres-url --format='value(name,state)'
gcloud --project=$P secrets versions list postgres-admin-password --format='value(name,state)'
```

Oczekiwane: `POSTGRES_18`, `ENTERPRISE`, `db-f1-micro`, `ZONAL`, `10`, `30`,
kopie włączone z PITR i `retainedBackups: 7`, okno `day: 7 hour: 3`,
`ENCRYPTED_ONLY`, brak `authorizedNetworks`, `deletionProtectionEnabled: true`;
bazy zawierają `myhelper`; loginy: `myhelper_owner`, `postgres`; oba sekrety:
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

## 5. D-5 — wartości sekretów (sesja główna)

Zasada (N2, Ryan, K-1b): wartość sekretu trafia do gcloud **wyłącznie przez
stdin** (`--data-file=-`), zawsze przez `tr -d '\r\n'` (końce wierszy z pliku
albo panelu dostawcy nie stają się częścią sekretu) i bez lokalnego logu gcloud
(`CLOUDSDK_CORE_DISABLE_FILE_LOGGING=1`) — wszystko to robi funkcja `add` niżej,
innej drogi nie używać. Nigdy wartość w wierszu polecenia, nigdy `echo WARTOŚĆ`,
nigdy `--data-file=ŚCIEŻKA`. Plik z wartością od dostawcy usuwać po dodaniu wersji.

```bash
P=my-helper-2-488419
add() { tr -d '\r\n' | CLOUDSDK_CORE_DISABLE_FILE_LOGGING=1 gcloud --project=$P secrets versions add "$1" --data-file=-; }

# Generowane lokalnie:
openssl rand -base64 48 | add better-auth-secret
openssl rand -hex 32 | add cron-secret
# VAPID: prywatny do Secret Manager, publiczny do zmiennej NEXT_PUBLIC_VAPID_PUBLIC_KEY (D-6).
npx --yes web-push generate-vapid-keys --json > "$TMPDIR/vapid.json"
node -e 'process.stdout.write(require(process.argv[1]).privateKey)' "$TMPDIR/vapid.json" | add vapid-private-key
node -e 'process.stdout.write(require(process.argv[1]).publicKey)' "$TMPDIR/vapid.json" \
  | gh variable set NEXT_PUBLIC_VAPID_PUBLIC_KEY --env production-gcp
rm -P "$TMPDIR/vapid.json"

# Od dostawców (plik zapisany z panelu dostawcy, poza repo):
add stripe-secret-key < "$HOME/secure/stripe-secret-key"
rm -P "$HOME/secure/stripe-secret-key"
add stripe-webhook-secret < "$HOME/secure/stripe-webhook-secret"   # para Stripe: oba albo żaden (K-1b)
rm -P "$HOME/secure/stripe-webhook-secret"
# … analogicznie: resend-api-key, smsapi-token,
#    upstash-redis-rest-token, google-client-secret (openrouter-api-key: od K-1 poza Secret Manager)
```

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
| smsapi-token | tryb symulacji SMS (numer maskowany w logu) |
| resend-api-key | e-mail tylko logowany, nie wysyłany |
| stripe-secret-key, stripe-webhook-secret | webhook 503 „Webhook not configured”; płatności nie działają |
| upstash-redis-rest-token | limitowanie zapytań w pamięci instancji |
| vapid-private-key | push wyłączony |
| openrouter-api-key | od K-1 poza Secret Manager i Cloud Run (klucz skasowany 14.11, AI przez Vertex w kroku F); bez klucza aplikacja startuje, czat AI nie działa (ostrzeżenie) |
| google-client-secret | **moduł NIE wyłącza się sam**: przycisk Google jest zawsze widoczny (także bez `GOOGLE_CLIENT_ID`), logowanie Google kończy się błędem — P3 po K-1 |

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
gh variable set DB_POOL_MAX --env $E --body 4          # max_connections 25 na db-f1-micro (Ethan)
gh variable set GCP_RUNTIME_SA --env $E --body myhelper-runtime@my-helper-2-488419.iam.gserviceaccount.com
gh variable set GCP_DEPLOY_SA --env $E --body myhelper-deploy@my-helper-2-488419.iam.gserviceaccount.com
gh variable set GCP_WIF_PROVIDER --env $E --body "$(…wartość wypisana przez etap wif…)"
gh variable set ADMIN_EMAILS --env $E < "$HOME/secure/admin-emails"
# … pozostałe zmienne klasy `var` z infra/gcp/env-manifest.json
```

- `GCS_PUBLIC_BASE_URL` — **pusta** na start. Od K-1 jedno źródło
  (`vars.GCS_PUBLIC_BASE_URL`) dla build-argu obrazu i zmiennej usługi.
- `SQL_INSTANCE=myhelper-pg` — z niej `run-deploy.sh` i `run-migrate.sh` składają
  `--set-cloudsql-instances=my-helper-2-488419:europe-central2:myhelper-pg` (K-1).
- `STORAGE_DRIVER=gcs` i `GCS_BUCKET=<zasobnik z D-3>` — na Cloud Run **od
  pierwszego wdrożenia** (`required: true` w manifeście; Oliver). Warunki:
  #118 pkt 4 (spełniony), #118 pkt 5 (`legacyObjectReader` w etapie `bucket`),
  #132 na `main`. Na Vercelu obie zmienne nadal **nieustawione**.
- `GOOGLE_CLIENT_ID` — **nie ustawiać** na Cloud Run, dopóki
  `google-client-secret` nie ma wersji. Uwaga: przycisk logowania Google
  (`src/components/auth/sign-in-button.tsx`) jest renderowany bezwarunkowo —
  bez `GOOGLE_CLIENT_ID` nie znika, kliknięcie kończy się komunikatem błędu
  (P3 po K-1).
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
i tylko gdy sha przebiegu = sha z sygnału:

```bash
RUN=<id przebiegu>
gh api repos/Danolog/My_Helper_2/actions/runs/$RUN --jq .head_sha     # = <sha> z sygnału
ENV_ID=$(gh api repos/Danolog/My_Helper_2/actions/runs/$RUN/pending_deployments --jq '.[0].environment.id')
gh api -X POST repos/Danolog/My_Helper_2/actions/runs/$RUN/pending_deployments \
  -F "environment_ids[]=$ENV_ID" -f state=approved -f comment="Gotowe do wdrożenia: <sha>"
```

Sha inne niż w sygnale → `state=rejected`. Lista dozwolonych akcji GitHub
w repo — P3 po becie.

**Dwa przebiegi** (decyzja: pierwszy z migracjami na pustej bazie; warunek 4
Ryana). Bez migracji pierwsza rewizja wstałaby na bazie bez tabel.

```bash
# 1. pierwszy przebieg — migracje od zera na pustej bazie
gh workflow run deploy-cloud-run.yml --ref main -f run_migrations=true
gh run watch "$(gh run list --workflow=deploy-cloud-run.yml --limit=1 --json databaseId -q '.[0].databaseId')"
# 2. drugi przebieg — bez migracji, musi być zielony (warunek 4)
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
SELECT rolname, rolcanlogin, rolbypassrls, rolsuper FROM pg_roles
 WHERE rolname IN ('myhelper_app', 'myhelper_owner');
```

Oczekiwane: `myhelper_app | f | f | f`, `myhelper_owner | t | f | f`.

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

## 8. D-8 — harmonogram (sesja główna, po K-3 #137)

Warunek (#121 j): zadanie Scheduler powstaje wstrzymane, a jego stan jest
odczytywany (`describe` = `PAUSED`, inaczej stop). Od K-3 `infra/gcp/scheduler.sh`
tworzy zadanie z harmonogramem zaparkowanym (29 lutego), od razu je wstrzymuje,
odczytuje stan i dopiero wtedy ustawia właściwy harmonogram. Tryb domyślny
nigdy nie wznawia. Kolejność obowiązkowa:

```bash
S='PROJECT_ID=my-helper-2-488419 REGION=europe-central2 BASE_URL=https://…'
env $S infra/gcp/scheduler.sh            # 1. utworzenie/aktualizacja — wszystko PAUSED
env $S infra/gcp/scheduler.sh --check    # 2. dryf ENABLED→PAUSED oczekiwany, innego dryfu brak
env $S infra/gcp/scheduler.sh --resume   # 3. dopiero po decyzji Darka
env $S infra/gcp/scheduler.sh --check    # 4. kod 0
gcloud --project=my-helper-2-488419 scheduler jobs list --location=europe-central2 --format='value(name,state)'
```

Włączenie harmonogramu = prawdziwe SMS-y i push do klientów salonów — decyzja Darka.
Zadania `mh-notify-*` zostają `PAUSED` także po `--resume`.

## 8a. Znane zachowanie przyjęte świadomie

- Płacący klient może chwilowo dostać 403 na funkcjach AI w oknie między końcem
  okresu próbnego a webhookiem potwierdzającym płatność — przyjęte świadomie,
  bez okresu łaski (Oliver).

## 9. Dostęp administracyjny do bazy

Wyłącznie przez `cloud-sql-proxy` z kontem sesji głównej (bez autoryzowanych
sieci, bez publicznego dostępu hasłem):

```bash
cloud-sql-proxy --port 6543 my-helper-2-488419:europe-central2:myhelper-pg &
PGPASSWORD="$(CLOUDSDK_CORE_DISABLE_FILE_LOGGING=1 gcloud --project=my-helper-2-488419 secrets versions access latest --secret=postgres-admin-password)" \
  psql "host=127.0.0.1 port=6543 user=postgres dbname=myhelper sslmode=disable"
```

Hasło trafia tylko do środowiska procesu `psql` (nie do argumentów, historii
ani lokalnego logu gcloud — `CLOUDSDK_CORE_DISABLE_FILE_LOGGING=1`, B-1).
Po pracy: zakończyć proxy (`kill %1`).

## 10. Opcjonalnie — przeniesienie danych Neon → Cloud SQL

Założenie kroku D: baza na starcie **pusta**. Jeśli Oliver to zmieni, procedurę
pisze Ethan w planie 0.5 — ten runbook jej nie zawiera.

## 11. Punkty otwarte

- `wif`: warunek ostateczny (sekcja 3.8); wykonanie czeka na bramkę (hook
  `guard-deploy-subagent` podpisany i zainstalowany z próbą kontrolną albo konto
  maszynowe).
- K-1 (#144): musi być na `main` przed D-7 — łączność Cloud SQL przez gniazdo,
  sekrety tylko z wersją, bez `--allow-unauthenticated`, `GCS_PUBLIC_BASE_URL`
  z jednego źródła.
- K-2 (#135): zawężenie allowlisty e2e do naszej usługi. K-3 (#137): harmonogram wstrzymany.
- Logowanie Google bez sekretu nie wyłącza się samo (P3 po K-1).
- Koszt IP instancji: potwierdzić odczytem kosztów po 24 h (sekcja 1 pkt 3).
