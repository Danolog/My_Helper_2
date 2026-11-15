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
skryptu (Oliver 19:44). Etap **`wif` wykonuje się osobno, później** — dopiero po
ostatecznej wersji warunku od Ryana (sekcja 3.8). Etapy `run` i `wif` są od
siebie niezależne; workflow wdrożenia potrzebuje obu.

| # | Etap | Polecenie | Odczyt stanu po etapie (oczekiwany wynik) |
|---|---|---|---|
| D-1 | `apis` | `$B --stage=apis [--apply]` | `gcloud --project=my-helper-2-488419 services list --enabled --format='value(config.name)'` zawiera 8 API z sekcji 3.1 |
| D-1b | test `--flags-file` | sekcja 4 | nagłówek ustawiony, job usunięty |
| D-2 | `ar` | `$B --stage=ar [--apply]` | `gcloud --project=… artifacts repositories describe myhelper --location=europe-central2 --format='yaml(format,cleanupPolicies)'` → `DOCKER`, `keep-5-most-recent` + `delete-older`, bez `cleanupPolicyDryRun: true` |
| D-3 | `bucket` | `$B --stage=bucket --bucket=NAZWA [--apply]` | `gcloud --project=… storage buckets describe gs://NAZWA --format='yaml(uniform_bucket_level_access,public_access_prevention)'` → uniform `true`, PAP `inherited`; `… storage buckets get-iam-policy gs://NAZWA` → `allUsers` tylko w `roles/storage.legacyObjectReader` |
| D-4 | `secrets` | `$B --stage=secrets [--apply]` | `gcloud --project=… secrets list --format='value(name)'` → 11 nazw z manifestu; `… secrets versions list NAZWA` → pusto dla każdej |
| D-4b | `sa` | `$B --stage=sa --bucket=NAZWA [--apply]` | `… iam service-accounts list` → `myhelper-runtime`, `myhelper-deploy`; `… secrets get-iam-policy NAZWA` → runtime jako `secretAccessor` na KAŻDYM z 11; `… projects get-iam-policy my-helper-2-488419` → brak nowych ról na projekcie |
| D-4c | `sql` | po sekcji 1 pkt 3: `$B --stage=sql [--apply]` | sekcja 3.6 |
| D-4d | `run` | `$B --stage=run [--apply]` | `… run services describe myhelper --region=europe-central2 --format='value(spec.template.spec.serviceAccountName)'` → runtime; `… run services get-iam-policy myhelper --region=…` → `allUsers` invoker, deploy `run.developer`; to samo dla `run jobs … myhelper-migrate` (bez invokera) |
| D-4e | `wif` | **później**, sekcja 3.8 | `… iam workload-identity-pools providers describe github-actions --workload-identity-pool=github --location=global --format='value(attributeCondition)'` = plik warunku |
| D-5 | wartości sekretów | sekcja 5 | `… secrets versions list NAZWA --format='value(name,state)'` → `1 ENABLED` dla ustawionych |
| D-6 | zmienne GitHub | sekcja 6 | `gh variable list --env production-gcp` |
| D-7 | pierwszy przebieg | sekcja 7 | sekcja 7 |
| D-8 | harmonogram | sekcja 8 | sekcja 8 |

Przebieg z `--apply` jest idempotentny: ponowne uruchomienie etapu nie tworzy
zasobów drugi raz (`state: exists`) i nie zmienia haseł bazy (sekcja 3.6).

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
ustawiono `GCS_BUCKET`, z `pathname: /<GCS_BUCKET>/**`. Asercji w testach na ten
wpis dziś nie ma — dopisuje ją K-1.
Na start `vars.GCS_PUBLIC_BASE_URL` zostaje **pusta**: obrazy idą z
`storage.googleapis.com/<bucket>` (Oliver 19:47, #133 pkt 1).

### 3.4 `secrets`
11 pustych kontenerów (nazwy z `secretName` w `infra/gcp/env-manifest.json`),
replikacja tylko w `europe-central2`. Żadnych wartości.

### 3.5 `sa`
- `myhelper-runtime` (usługa i job migracji): `secretAccessor` osobno na każdym
  z 11 sekretów, `roles/storage.objectUser` na zasobniku (aplikacja zapisuje,
  czyta metadane i usuwa).
- `myhelper-deploy` (GitHub Actions przez WIF): `artifactregistry.writer` na jednym
  repo, `iam.serviceAccountUser` wyłącznie na koncie runtime.
- Zero ról na poziomie projektu w tym etapie.

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
- `roles/cloudsql.client` dla runtime i deploy oraz własną rolę
  `myhelperSqlBackup` (kopia na żądanie przed migracją) dla deploy — wszystkie
  z warunkiem IAM na tę jedną instancję.

Hasła: generowane w pamięci procesu, do gcloud tylko przez `--flags-file`
ze strumienia (`sql users create|set-password`) i `--data-file=-`
(`secrets versions add`); nie są wypisywane. Gdy sekret ma już wersję, etap
pomija dany login (hasło bez zmian). Gdy wersji brak, a login istnieje (przerwany
przebieg), hasło jest ustawiane od nowa — stan sam się naprawia.

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

### 3.8 `wif` — NIE WYKONYWAĆ przed ostatecznym warunkiem Ryana
Pula `github`, provider OIDC `github-actions`, `workloadIdentityUser` na koncie
deploy dla `principalSet://…/attribute.repository_id/1152153440`. Warunek
atrybutów skrypt czyta z pliku (`--wif-condition-file=`) i odrzuca plik pusty,
z `||` albo bez któregoś z obowiązkowych zawężeń:

```
assertion.repository_id == '1152153440' &&
assertion.repository_owner_id == '171363250' &&
assertion.ref == 'refs/heads/main' &&
assertion.workflow_ref == 'Danolog/My_Helper_2/.github/workflows/deploy-cloud-run.yml@refs/heads/main' &&
assertion.event_name == 'workflow_dispatch' &&
assertion.run_attempt == '1'
```

Otwarte u Ryana (przeliczenie po upublicznieniu repo): `actor_id`, wariant
`sub=…:environment:production-gcp`, propozycja Evy: równość
`assertion.job_workflow_ref` (w workflow wielokrotnego użytku `workflow_ref` jest
wywołującego; Oliver popiera ją jako zamiennik prefiksu `workflow_ref`) —
rozstrzyga Ryan przy recenzji. Dodatkowe zawężenia dopisuje się do pliku — skrypt ich nie usuwa.
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

Zasada: generator albo plik spoza repo → strumień → `--data-file=-`. Nigdy wartość
w wierszu polecenia, nigdy `echo WARTOŚĆ`. Plik z wartością od dostawcy usuwać
po dodaniu wersji.

```bash
P=my-helper-2-488419
add() { gcloud --project=$P secrets versions add "$1" --data-file=-; }

# Generowane lokalnie:
openssl rand -base64 48 | tr -d '\n' | add better-auth-secret
openssl rand -hex 32 | tr -d '\n' | add cron-secret
# VAPID: prywatny do Secret Manager, publiczny do zmiennej NEXT_PUBLIC_VAPID_PUBLIC_KEY (D-6).
npx --yes web-push generate-vapid-keys --json > "$TMPDIR/vapid.json"
node -e 'process.stdout.write(require(process.argv[1]).privateKey)' "$TMPDIR/vapid.json" | add vapid-private-key
node -e 'process.stdout.write(require(process.argv[1]).publicKey)' "$TMPDIR/vapid.json" \
  | gh variable set NEXT_PUBLIC_VAPID_PUBLIC_KEY --env production-gcp
rm -P "$TMPDIR/vapid.json"

# Od dostawców (plik zapisany z panelu dostawcy, poza repo):
gcloud --project=$P secrets versions add stripe-secret-key --data-file="$HOME/secure/stripe-secret-key"
rm -P "$HOME/secure/stripe-secret-key"
# … analogicznie: stripe-webhook-secret, resend-api-key, smsapi-token,
#    openrouter-api-key, upstash-redis-rest-token, google-client-secret
```

`postgres-url` i `postgres-admin-password` ustawia etap `sql` — w D-5 ich nie ruszać.

**Brakujące sekrety zostają puste.** Zachowanie aplikacji bez danego sekretu
(stan kodu na dziś; pole `required` w manifeście jest dziś nieustawione dla
wszystkich 11):

| Sekret | Bez wartości |
|---|---|
| postgres-url, better-auth-secret | aplikacja nie startuje (`env.ts`: „is required”) — **obowiązkowe** |
| cron-secret | endpointy cron → 500 „CRON_SECRET not configured” (harmonogram i tak dopiero w D-8) |
| smsapi-token | tryb symulacji SMS (numer maskowany w logu) |
| resend-api-key | e-mail tylko logowany, nie wysyłany |
| stripe-secret-key, stripe-webhook-secret | webhook 503 „Webhook not configured”; płatności nie działają |
| upstash-redis-rest-token | limitowanie zapytań w pamięci instancji |
| vapid-private-key | push wyłączony |
| openrouter-api-key | czat AI nie działa (ostrzeżenie) |
| google-client-secret | **moduł NIE wyłącza się sam**: przycisk Google jest zawsze widoczny (także bez `GOOGLE_CLIENT_ID`), logowanie Google kończy się błędem — P3 po K-1 |

**Bloker pierwszego wdrożenia:** `run-deploy.sh` mapuje wszystkie 11 sekretów
(`NAZWA=sekret:latest`). Cloud Run odrzuca rewizję, której sekret nie ma żadnej
wersji. K-1 (przed D-7): `required` w manifeście; `run-deploy.sh` mapuje
wyłącznie sekrety z wersją, a sekret wymagany bez wersji przerywa wdrożenie
**przed** `gcloud run deploy`. Żadnych wersji-zaślepek.
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

- `GCS_PUBLIC_BASE_URL` — **pusta** na start.
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

```bash
gh workflow run deploy-cloud-run.yml --ref main -f run_migrations=false
gh run watch "$(gh run list --workflow=deploy-cloud-run.yml --limit=1 --json databaseId -q '.[0].databaseId')"
```

**Tryb migracji pierwszego przebiegu rozstrzyga Ryan** (komentarz w #121). Warunki
Ryana przed pierwszym przebiegiem z `run_migrations=true` (#121, 6899276171):

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
PGPASSWORD="$(gcloud --project=my-helper-2-488419 secrets versions access latest --secret=postgres-admin-password)" \
  psql "host=127.0.0.1 port=6543 user=postgres dbname=myhelper sslmode=disable"
```

Hasło trafia tylko do środowiska procesu `psql` (nie do argumentów ani historii).
Po pracy: zakończyć proxy (`kill %1`).

## 10. Opcjonalnie — przeniesienie danych Neon → Cloud SQL

Założenie kroku D: baza na starcie **pusta**. Jeśli Oliver to zmieni, procedurę
pisze Ethan w planie 0.5 — ten runbook jej nie zawiera.

## 11. Punkty otwarte

- `wif`: ostateczny warunek (Ryan) — `actor_id`, wariant `environment`, `job_workflow_ref`.
- Tryb migracji pierwszego przebiegu (Ryan, #121).
- K-1 (po #132): łączność Cloud SQL przez gniazdo, `required` dla sekretów i
  mapowanie tylko sekretów z wersją, bez `--allow-unauthenticated`, webhook
  Stripe bez sekretu odrzuca każde żądanie, `GCS_PUBLIC_BASE_URL` jako build-arg
  z jednego źródła (#133 pkt 1), asercja `remotePatterns` (#118 pkt 4).
- K-2 (#135): zawężenie allowlisty e2e do naszej usługi. K-3 (#137): harmonogram wstrzymany.
- Logowanie Google bez sekretu nie wyłącza się samo (P3 po K-1).
- Koszt IP instancji: potwierdzić odczytem kosztów po 24 h (sekcja 1 pkt 3).
