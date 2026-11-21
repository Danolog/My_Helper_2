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
wywoływać `sql users create|set-password` z `CLOUDSDK_CORE_DISABLE_FILE_LOGGING=1`
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
set +x
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
gcloud --project=$P secrets versions list vapid-private-key --sort-by=~createTime --limit=1 --format='value(name,state,createTime)'

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

`BASE_URL` = główny adres usługi `https://myhelper-843777043748.europe-central2.run.app`
(bez ścieżki i bez taga rewizji). Inny host skrypt odrzuca przed pierwszym
wywołaniem gcloud (#143 pkt 1).

Kolejność w bloku: 1. utworzenie/aktualizacja — wszystkie 5 zadań `PAUSED`;
2. `--check`: dryf ENABLED→PAUSED oczekiwany, innego dryfu brak; 3. `--resume`
dopiero po decyzji Darka — jawne nazwy (W-3), można wznowić część zadań;
4. `--check`: kod 0 (wznowione zgodne z tabelą); 5. lista zadań ze stanem.

```bash
S='PROJECT_ID=my-helper-2-488419 REGION=europe-central2 BASE_URL=https://myhelper-843777043748.europe-central2.run.app'
env $S infra/gcp/scheduler.sh
env $S infra/gcp/scheduler.sh --check
env $S infra/gcp/scheduler.sh --resume mh-sms-reminders \
  mh-cleanup-pending-deposits mh-cleanup-temporary-access
env $S infra/gcp/scheduler.sh --check
gcloud --project=my-helper-2-488419 scheduler jobs list --location=europe-central2 --format='value(name,state)'
```

Zadań jest 5 (tabela `JOBS` w `scheduler.sh`). `--resume` bez nazw, z nazwą
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

Wyłącznie przez `cloud-sql-proxy` z kontem sesji głównej (bez autoryzowanych
sieci, bez publicznego dostępu hasłem):

```bash
set +x
cloud-sql-proxy --port 6543 my-helper-2-488419:europe-central2:myhelper-pg &
PGPASSWORD="$(CLOUDSDK_CORE_DISABLE_FILE_LOGGING=1 gcloud --project=my-helper-2-488419 secrets versions access latest --secret=postgres-admin-password)" \
  psql "host=127.0.0.1 port=6543 user=postgres dbname=myhelper sslmode=disable"
kill %1
```

Hasło trafia tylko do środowiska procesu `psql` (nie do argumentów, historii
ani lokalnego logu gcloud — `CLOUDSDK_CORE_DISABLE_FILE_LOGGING=1`, B-1).
Ostatnia linia bloku (`kill %1`, K-1e) kończy proxy po wyjściu z `psql` —
proxy do bazy nie zostaje w tle.

## 10. Opcjonalnie — przeniesienie danych Neon → Cloud SQL

Założenie kroku D: baza na starcie **pusta**. Jeśli Oliver to zmieni, procedurę
pisze Ethan w planie 0.5 — ten runbook jej nie zawiera.

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
(krok 3). Wykluczenie działa tylko na nowe wpisy.

### Co robi

1. **Wykluczenie `myhelper-auth-token-urls` w ujściu `_Default`** — wpis nie
   trafia do logów, gdy adres żądania **albo** nagłówek Referer pasuje do
   wyrażenia RE2 `/(api/auth/)?(verify-email|reset-password)`:

   ```
   httpRequest.requestUrl=~"/(api/auth/)?(verify-email|reset-password)" OR httpRequest.referer=~"/(api/auth/)?(verify-email|reset-password)"
   ```

   Filtr nie zawęża typu zasobu, więc obejmuje logi żądań Cloud Run i LB.
   Adresy z tokenem jednorazowym (better-auth 1.7.25):

   | Adres | Token | Źródło |
   |---|---|---|
   | `/api/auth/verify-email?token=…&callbackURL=…` | JWT weryfikacji e-mail w parametrze | `node_modules/better-auth/dist/api/routes/email-verification.mjs:31` |
   | `/api/auth/reset-password/<token>?callbackURL=…` | token resetu w ścieżce | `node_modules/better-auth/dist/api/routes/password.mjs:81` |
   | `/reset-password?token=…` | ten sam token po przekierowaniu na stronę aplikacji | `password.mjs:127`, `src/components/auth/forgot-password-form.tsx:44`, `src/components/auth/reset-password-form.tsx:15` |

   Referer: strona `/reset-password?token=…` ładuje zasoby i wysyła formularz
   z pełnym adresem w Referer (`Referrer-Policy: strict-origin-when-cross-origin`
   w obrębie originu, `next.config.ts:94-95`). Sam token idzie w treści POST
   (`reset-password-form.tsx:73-76`), treści żądań platforma nie loguje.
   Poza filtrem: `/api/auth/callback/google?code=…&state=…` — kod jest
   jednorazowy i zużywany w tym samym żądaniu (wymiana wymaga sekretu klienta
   i stanu z bazy), więc wpis w logu nie daje przejęcia konta. Magic link i
   zmiana adresu e-mail nie są włączone (`src/lib/auth.ts:55-121`).
   Koszt: tracimy ślad żądań na tych ścieżkach (przyjęty).
   Strażnik sprawdza te szablony adresów w zainstalowanej bibliotece: zmiana
   po aktualizacji Better Auth zatrzymuje test, zanim filtr przestanie działać.
2. **Retencja `_Default` = 30 dni** ustawiona jawnie. Do polityki prywatności:
   IP i user-agent jako dane administratora, cel bezpieczeństwo, 30 dni.
3. **Data Access `DATA_READ` dla `secretmanager.googleapis.com`** — każdy
   odczyt wartości sekretu ma wpis audytu. Skrypt czyta politykę IAM projektu do
   pliku tymczasowego (polityka zawiera adresy kont: nie jest wypisywana, bez
   lokalnego logu gcloud), dopisuje wyłącznie `auditConfigs` i zapisuje ją z tym
   samym `etag` (równoległa zmiana polityki = błąd, nie nadpisanie). Wymaga
   `node` w `PATH`. Już włączone = `skip`.
4. **Zasobnik `myhelper-audit` w `europe-central2`, retencja 365 dni**, i ujście
   `myhelper-audit-sink`: Admin Activity całego projektu + Data Access Secret
   Managera. Zasobnik w tym samym projekcie, więc ujście nie dostaje roli.
   Wpisy dalej trafiają też do `_Required` (Admin Activity, 400 dni) i
   `_Default` (Data Access, 30 dni). Koszt przy tym ruchu pomijalny.

### Przed `--apply`

Czy w logach są już wpisy z tymi ścieżkami (wynik: same znaczniki czasu, bez
adresów):

```bash
set +x
gcloud --project=my-helper-2-488419 logging read 'httpRequest.requestUrl=~"/(api/auth/)?(verify-email|reset-password)" OR httpRequest.referer=~"/(api/auth/)?(verify-email|reset-password)"' --freshness=30d --limit=5 --format='value(timestamp)'
```

Pusto = dalej. Niepusto = stop, decyzja właściciela (wpisy wygasają z
retencją; usunąć można tylko cały log). Surowych wpisów sesja główna nie czyta.

### Wykonanie

```bash
infra/gcp/logging.sh --project=my-helper-2-488419
infra/gcp/logging.sh --project=my-helper-2-488419 --apply
```

Dry-run, porównanie listy `+ …` z punktami 1–4 (w tej kolejności), potem
`--apply`.

### Sprawdzenie (bez adresów kont)

```bash
gcloud --project=my-helper-2-488419 logging sinks describe _Default --format='value(exclusions[].name)'
gcloud --project=my-helper-2-488419 logging buckets describe _Default --location=global --format='value(retentionDays)'
gcloud --project=my-helper-2-488419 logging buckets describe myhelper-audit --location=europe-central2 --format='value(retentionDays)'
gcloud --project=my-helper-2-488419 logging sinks describe myhelper-audit-sink --format='value(destination)'
gcloud --project=my-helper-2-488419 projects get-iam-policy my-helper-2-488419 --format='json(auditConfigs)'
```

Oczekiwane: `myhelper-auth-token-urls` na liście, `30`, `365`, cel z
`locations/europe-central2/buckets/myhelper-audit`, wpis
`secretmanager.googleapis.com` z `DATA_READ`. Ostatnie polecenie wypisuje
wyłącznie `auditConfigs` (bez wiązań i adresów kont).

**Próba filtra.** Jedno żądanie z nieważnym tokenem i jedno kontrolne, po
2 min odczyt samych znaczników czasu:

```bash
curl -s -o /dev/null -w '%{http_code}\n' "https://myhelper-<hash>.europe-central2.run.app/api/auth/verify-email?token=probe-invalid"
curl -s -o /dev/null -w '%{http_code}\n' "https://myhelper-<hash>.europe-central2.run.app/api/health"
gcloud --project=my-helper-2-488419 logging read 'httpRequest.requestUrl=~"probe-invalid"' --freshness=10m --format='value(timestamp)'
gcloud --project=my-helper-2-488419 logging read 'httpRequest.requestUrl=~"/api/health"' --freshness=10m --limit=1 --format='value(timestamp)'
```

Oczekiwane: pierwszy odczyt pusty, drugi ze znacznikiem czasu. Odwrotnie = stop.
Wynik w #121: tylko „pusto / jest”.

**Ślad odczytu sekretu.** Po pierwszym `secrets versions access` w 4a.1:

```bash
gcloud --project=my-helper-2-488419 logging read 'protoPayload.serviceName="secretmanager.googleapis.com" AND protoPayload.methodName:"AccessSecretVersion"' --bucket=myhelper-audit --location=europe-central2 --view=_AllLogs --freshness=1h --limit=1 --format='value(timestamp)'
```

Oczekiwany znacznik czasu. Pusto = stop przed kolejnymi odczytami sekretów.

### Wycofanie

Brak `--teardown` z założenia: wykluczenie i ślad audytu zmniejszają ryzyko,
a usunięty zasobnik logów blokuje nazwę na 7 dni. Zmiana wartości = zmiana stałych
w skrypcie, recenzja i ponowne `--apply` (istniejące zasoby dostają `update`).

### Znane ograniczenie

Zasobnik `_Default` ma lokalizację `global` i nie da się jej zmienić. Logi
żądań (IP, user-agent, adres) mogą być przechowywane poza `europe-central2`.
Do rozstrzygnięcia przy DPA: wpis „logi platformy: UE/global” albo nowy
zasobnik `_Default` w `europe-central2` z przekierowaniem ujścia (osobny krok).

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
