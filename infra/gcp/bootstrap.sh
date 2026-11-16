#!/usr/bin/env bash
# Krok D, zadanie 0.3: jednorazowe przygotowanie projektu GCP pod MyHelper.
# Procedura i kolejność etapów: docs/runbook-krok-d.md.
#
# KTO URUCHAMIA: wyłącznie sesja główna, etap po etapie, po recenzji Ethana
# (architektura) i Ryana (uprawnienia, WIF). Agenci nie wykonują tego skryptu
# na projekcie.
#
# DOMYŚLNIE --dry-run: skrypt NICZEGO nie wykonuje, ani odczytu, ani zmiany.
# Wypisuje tylko polecenia: `? …` dla odczytu stanu, `+ …` dla zmiany.
# Dopiero `--apply` wykonuje odczyty stanu i zmiany dla wskazanego etapu.
#
# Idempotentny: zasób, który istnieje (odczyt `describe`), nie jest tworzony
# drugi raz. Wiązania IAM (`add-iam-policy-binding`), włączanie API i polityka
# czyszczenia są idempotentne same z siebie.
#
# ZERO WARTOŚCI SEKRETÓW W WYJŚCIU, ARGUMENTACH I REPO. Etap `secrets` tworzy
# PUSTE kontenery Secret Manager (bez wersji) dla sekretów z
# infra/gcp/env-manifest.json; wartości dodaje sesja główna (runbook D-5).
# Jedyny wyjątek to etap `sql` (decyzja Ethana, #121): losowe hasła bazy
# ([A-Za-z0-9]{32}) powstają w pamięci procesu i idą wyłącznie do gcloud przez
# --flags-file ze strumienia oraz do Secret Manager przez --data-file=-.
# Nie są wypisywane ani podawane jako argument (nie trafiają do `ps`/historii).
#
# Etapy (kolejność): apis → ar → bucket → secrets → sa → sql → run → wif
#   apis     włączenie API (run, sqladmin, artifactregistry, secretmanager,
#            cloudscheduler, iamcredentials, sts, iam)
#   ar       Artifact Registry (docker) + polityka: zostaje 5 ostatnich wersji
#   bucket   zasobnik GCS: uniform access, publiczny ODCZYT obiektu przez
#            allUsers: roles/storage.legacyObjectReader (bez listowania, #118 pkt 5)
#   secrets  puste kontenery Secret Manager (replikacja tylko w regionie)
#   sa       konta: runtime (secretAccessor osobno na każdy sekret, zapis do
#            zasobnika) i deploy (AR writer na jednym repo, actAs tylko na runtime)
#   sql      Cloud SQL wg decyzji Ethana (#121, 0.4): JAWNIE edycja enterprise
#            (dla PG16–18 domyślna jest Enterprise Plus — bez shared-core,
#            wielokrotność budżetu), POSTGRES_18, db-f1-micro, zonal, 10 GB SSD
#            z auto-increase do 30 GB, 7 kopii, PITR 7 dni, ochrona przed
#            usunięciem, okno serwisowe SUN 03:00 UTC, tylko szyfrowane
#            połączenia, publiczne IP bez autoryzowanych sieci (połączenie przez
#            wbudowany Cloud SQL Auth Proxy). Baza myhelper, login myhelper_owner,
#            wersja sekretu postgres-url, losowe hasło wbudowanego `postgres`
#            w osobnym sekrecie (niepodpiętym do usługi). cloudsql.client
#            wyłącznie dla runtime (usługa i job migracji działają jako runtime)
#            oraz kopia na żądanie dla deploy — z warunkiem na tę instancję.
#            Rolę myhelper_app NOLOGIN tworzy migracja 0005.
#   run      powłoka usługi i joba migracji (próbka Google `hello`, usługa
#            min 0 / max 1 instancja, bez sekretów i zmiennych), publiczny invoker
#            na usłudze (ustawiany RAZ tutaj — konto deploy nie dostaje
#            setIamPolicy), run.developer dla deploy NA ZASOBACH (nie projekt)
#   wif      pula + provider OIDC GitHuba z warunkiem z pliku (--wif-condition-file)
#            + workloadIdentityUser na koncie deploy. Bramka wykonania: runbook
#            3.8 (hook Ryana podpisany i zainstalowany ALBO agenci na koncie
#            maszynowym).
#
# Region: wyłącznie europe-central2 (szacunek kosztu i lokalizacja danych —
# Ethan, recenzja #134). Inna wartość = błąd przed pierwszym gcloud.
#
# Użycie:
#   infra/gcp/bootstrap.sh --project=ID --region=europe-central2 --stage=ETAP [opcje] [--apply]
# Opcje wspólne:
#   --project-number=N   (wymagane w etapie wif)
#   --ar-repo=myhelper --bucket=NAZWA (bucket, sa) --service=myhelper
#   --migrate-job=myhelper-migrate --runtime-sa=myhelper-runtime --deploy-sa=myhelper-deploy
#   --manifest=infra/gcp/env-manifest.json
# Etap sql: --sql-instance=myhelper-pg (parametry instancji są stałymi niżej)
# Etap wif:
#   --wif-condition-file=PLIK --wif-pool=github --wif-provider=github-actions
#
# Strażnik: __tests__/lib/bootstrap-config.test.ts (G-D1).
set -euo pipefail

APPLY=0
PROJECT_ID="" PROJECT_NUMBER="" REGION="" STAGE=""
AR_REPO="myhelper" BUCKET="" SERVICE="myhelper" MIGRATE_JOB="myhelper-migrate"
RUNTIME_SA_NAME="myhelper-runtime" DEPLOY_SA_NAME="myhelper-deploy"
MANIFEST="$(dirname "$0")/env-manifest.json"
SQL_INSTANCE="myhelper-pg"
WIF_CONDITION_FILE="" WIF_POOL="github" WIF_PROVIDER="github-actions"

# Cloud SQL — decyzja Ethana (#121, komentarz 6899299212). Zmiana = nowa decyzja.
SQL_EDITION="enterprise"
SQL_TIER="db-f1-micro"
PG_VERSION="POSTGRES_18"
DB_NAME="myhelper"
# Jedyny login bazy (aplikacja i migracje; Ethan 6899299212, Oliver 19:44).
# Role NOLOGIN (myhelper_app) tworzą WYŁĄCZNIE migracje (0005), nigdy bootstrap.
DB_USER="myhelper_owner"
DB_URL_SECRET="postgres-url"
# Hasło wbudowanego `postgres` — tylko do użytku awaryjnego, poza manifestem
# (nie trafia do usługi ani joba).
DB_ADMIN_SECRET="postgres-admin-password"

# Jedyny dopuszczony region. Zmiana = nowa decyzja (koszt, lokalizacja danych).
ALLOWED_REGION="europe-central2"

# Stałe repozytorium GitHub (liczbowe id — odporne na zmianę nazwy repo/właściciela).
GITHUB_REPOSITORY_ID="1152153440"
GITHUB_REPOSITORY_OWNER_ID="171363250"
# Jedyny dopuszczony wywołujący wdrożenie (Ryan 6899923012: zmiana konta
# wywołującego = świadoma zmiana warunku z recenzją).
GITHUB_ACTOR_ID="171363250"
DEPLOY_WORKFLOW_REF="Danolog/My_Helper_2/.github/workflows/deploy-cloud-run.yml@refs/heads/main"
# Obraz zastępczy (etap run): oficjalna próbka Google, dla usługi i joba.
# Job z tym obrazem nigdy nie jest wykonywany — zastępuje go pierwszy przebieg workflow.
PLACEHOLDER_IMAGE="us-docker.pkg.dev/cloudrun/container/hello"

die() { echo "error: $*" >&2; exit 2; }

for arg in "$@"; do
  case "$arg" in
    --apply) APPLY=1 ;;
    --dry-run) APPLY=0 ;;
    --project=*) PROJECT_ID="${arg#*=}" ;;
    --project-number=*) PROJECT_NUMBER="${arg#*=}" ;;
    --region=*) REGION="${arg#*=}" ;;
    --stage=*) STAGE="${arg#*=}" ;;
    --ar-repo=*) AR_REPO="${arg#*=}" ;;
    --bucket=*) BUCKET="${arg#*=}" ;;
    --service=*) SERVICE="${arg#*=}" ;;
    --migrate-job=*) MIGRATE_JOB="${arg#*=}" ;;
    --runtime-sa=*) RUNTIME_SA_NAME="${arg#*=}" ;;
    --deploy-sa=*) DEPLOY_SA_NAME="${arg#*=}" ;;
    --manifest=*) MANIFEST="${arg#*=}" ;;
    --sql-instance=*) SQL_INSTANCE="${arg#*=}" ;;
    --wif-condition-file=*) WIF_CONDITION_FILE="${arg#*=}" ;;
    --wif-pool=*) WIF_POOL="${arg#*=}" ;;
    --wif-provider=*) WIF_PROVIDER="${arg#*=}" ;;
    *) die "unknown argument: $arg" ;;
  esac
done

# --- walidacja przed pierwszym wywołaniem gcloud -----------------------------
[[ -n "$PROJECT_ID" ]] || die "missing required --project"
[[ -n "$REGION" ]] || die "missing required --region"
[[ -n "$STAGE" ]] || die "missing required --stage"
[[ "$PROJECT_ID" =~ ^[a-z][a-z0-9-]{4,28}[a-z0-9]$ ]] || die "invalid --project"
[[ "$REGION" == "$ALLOWED_REGION" ]] || die "--region must be $ALLOWED_REGION"
case "$STAGE" in
  apis|ar|bucket|secrets|sa|sql|run|wif) ;;
  *) die "--stage must be one of: apis ar bucket secrets sa sql run wif" ;;
esac
for name in AR_REPO SERVICE MIGRATE_JOB RUNTIME_SA_NAME DEPLOY_SA_NAME SQL_INSTANCE WIF_POOL WIF_PROVIDER; do
  [[ "${!name}" =~ ^[a-z][a-z0-9-]{2,61}$ ]] || die "invalid $name: ${!name}"
done
if [[ "$STAGE" == "bucket" || "$STAGE" == "sa" ]]; then
  [[ "$BUCKET" =~ ^[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]$ ]] || die "missing or invalid --bucket"
fi
if [[ "$STAGE" == "wif" ]]; then
  [[ "$PROJECT_NUMBER" =~ ^[0-9]+$ ]] || die "missing or invalid --project-number"
  [[ -n "$WIF_CONDITION_FILE" && -f "$WIF_CONDITION_FILE" ]] || die "missing --wif-condition-file"
fi

RUNTIME_SA="${RUNTIME_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
DEPLOY_SA="${DEPLOY_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
SQL_RESOURCE="projects/${PROJECT_ID}/instances/${SQL_INSTANCE}"

GC=(gcloud --project="$PROJECT_ID" --quiet)

# Zmiana: wypisz; wykonaj tylko przy --apply.
run() {
  echo "+ gcloud --project=$PROJECT_ID --quiet $*"
  if [[ "$APPLY" == 1 ]]; then "${GC[@]}" "$@"; fi
}

# Odczyt stanu: przy --dry-run tylko wypisany (wynik: „nie sprawdzono” →
# pokazujemy polecenia tworzenia); przy --apply wykonany, bez wypisywania treści.
exists() {
  echo "? gcloud --project=$PROJECT_ID --quiet $*"
  if [[ "$APPLY" != 1 ]]; then
    echo "  state: not checked (dry-run)"
    return 1
  fi
  if "${GC[@]}" "$@" >/dev/null 2>&1; then
    echo "  state: exists"
    return 0
  fi
  echo "  state: missing"
  return 1
}

# Czy sekret ma wersję ENABLED. Rozróżnia „brak wersji” od błędu odczytu
# (Ethan, recenzja #134): `versions list` kończy się kodem 0 także przy braku
# wersji (puste wyjście), więc kod ≠ 0 to błąd odczytu (sieć, uprawnienia) —
# wtedy etap się przerywa, zamiast wygenerować nowe hasło dla istniejącego loginu.
# Wynik: 0 = ma wersję, 1 = brak wersji (lub dry-run); błąd odczytu = exit 2.
secret_has_version() {
  local secret="$1"
  local args=(secrets versions list "$secret" --filter=state:ENABLED --limit=1 "--format=value(name)")
  echo "? gcloud --project=$PROJECT_ID --quiet ${args[*]}"
  if [[ "$APPLY" != 1 ]]; then
    echo "  state: not checked (dry-run)"
    return 1
  fi
  local out
  if ! out="$("${GC[@]}" "${args[@]}" 2>/dev/null)"; then
    die "cannot read versions of secret $secret (not 'no version') — stage stopped, nothing changed"
  fi
  if [[ -n "$out" ]]; then
    echo "  state: has an enabled version"
    return 0
  fi
  echo "  state: no enabled version"
  return 1
}

# Nazwy sekretów (Secret Manager) z manifestu — tylko nazwy, nigdy wartości.
# Wczytane raz, przed pierwszym gcloud; pusta lista = błąd.
[[ -f "$MANIFEST" ]] || die "manifest not found: $MANIFEST"
SECRET_NAMES=()
while read -r _name; do
  [[ "$_name" =~ ^[a-z][a-z0-9-]{0,254}$ ]] || die "invalid secretName in manifest: $_name"
  SECRET_NAMES+=("$_name")
done < <(MANIFEST="$MANIFEST" node --input-type=module -e '
import { readFileSync } from "node:fs";
const { variables } = JSON.parse(readFileSync(process.env.MANIFEST, "utf8"));
for (const e of Object.values(variables)) if (e.class === "secret") console.log(e.secretName);
')
[[ ${#SECRET_NAMES[@]} -gt 0 ]] || die "no secrets in manifest"

stage_apis() {
  run services enable \
    run.googleapis.com sqladmin.googleapis.com artifactregistry.googleapis.com \
    secretmanager.googleapis.com cloudscheduler.googleapis.com \
    iamcredentials.googleapis.com sts.googleapis.com iam.googleapis.com
}

stage_ar() {
  if ! exists artifacts repositories describe "$AR_REPO" --location="$REGION"; then
    run artifacts repositories create "$AR_REPO" --repository-format=docker \
      --location="$REGION" --description="MyHelper images (runner, migrator)"
  fi
  # Keep ma pierwszeństwo przed Delete: z każdego pakietu (myhelper,
  # myhelper-migrator) zostaje 5 ostatnich wersji, reszta jest usuwana.
  local policy
  policy="$(mktemp)"
  cat >"$policy" <<'JSON'
[
  {"name": "keep-5-most-recent", "action": {"type": "Keep"}, "mostRecentVersions": {"keepCount": 5}},
  {"name": "delete-older", "action": {"type": "Delete"}, "condition": {"tagState": "any"}}
]
JSON
  echo "  policy: $(tr -d '\n' <"$policy" | tr -s ' ')"
  run artifacts repositories set-cleanup-policies "$AR_REPO" --location="$REGION" --policy="$policy"
  rm -f "$policy"
}

stage_bucket() {
  if ! exists storage buckets describe "gs://$BUCKET"; then
    run storage buckets create "gs://$BUCKET" --location="$REGION" \
      --uniform-bucket-level-access --no-public-access-prevention \
      --default-storage-class=STANDARD
  fi
  # Publiczny odczyt pojedynczego obiektu po znanej nazwie, BEZ listowania.
  run storage buckets add-iam-policy-binding "gs://$BUCKET" \
    --member=allUsers --role=roles/storage.legacyObjectReader
}

stage_secrets() {
  local name
  for name in "${SECRET_NAMES[@]}"; do
    if ! exists secrets describe "$name"; then
      # Pusty kontener: bez --data-file, bez wersji.
      run secrets create "$name" --replication-policy=user-managed --locations="$REGION"
    fi
  done
}

stage_sa() {
  if ! exists iam service-accounts describe "$RUNTIME_SA"; then
    run iam service-accounts create "$RUNTIME_SA_NAME" --display-name="MyHelper runtime (Cloud Run)"
  fi
  if ! exists iam service-accounts describe "$DEPLOY_SA"; then
    run iam service-accounts create "$DEPLOY_SA_NAME" --display-name="MyHelper deploy (GitHub Actions WIF)"
  fi
  # Runtime: dostęp do KAŻDEGO sekretu osobno (nie rola na projekcie).
  local name
  for name in "${SECRET_NAMES[@]}"; do
    run secrets add-iam-policy-binding "$name" \
      --member="serviceAccount:$RUNTIME_SA" --role=roles/secretmanager.secretAccessor
  done
  # Deploy: odczyt METADANYCH wersji każdego sekretu (bez wartości) —
  # run-deploy.sh mapuje tylko sekrety z wersją ENABLED (K-1).
  for name in "${SECRET_NAMES[@]}"; do
    run secrets add-iam-policy-binding "$name" \
      --member="serviceAccount:$DEPLOY_SA" --role=roles/secretmanager.viewer
  done
  # Runtime: zapis/odczyt/usuwanie obiektów w jednym zasobniku (bez zmiany IAM).
  run storage buckets add-iam-policy-binding "gs://$BUCKET" \
    --member="serviceAccount:$RUNTIME_SA" --role=roles/storage.objectUser
  # Deploy: wypychanie obrazów do jednego repozytorium.
  run artifacts repositories add-iam-policy-binding "$AR_REPO" --location="$REGION" \
    --member="serviceAccount:$DEPLOY_SA" --role=roles/artifactregistry.writer
  # Deploy: actAs wyłącznie na koncie runtime (usługa i job działają jako runtime).
  run iam service-accounts add-iam-policy-binding "$RUNTIME_SA" \
    --member="serviceAccount:$DEPLOY_SA" --role=roles/iam.serviceAccountUser
}

# Losowe hasło [A-Za-z0-9]{32} (losowanie z odrzuceniem — bez skrzywienia).
# Wynik tylko na stdout do zmiennej; nigdy nie wypisywany.
gen_password() {
  node -e '
const { randomBytes } = require("node:crypto");
const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
let s = "";
while (s.length < 32) for (const b of randomBytes(64)) if (b < 248 && s.length < 32) s += A[b % 62];
process.stdout.write(s);
'
}

# Plik flag gcloud (YAML) z hasłem — czytany ze strumienia, nie z argumentu.
password_flags() { printf -- '--password: "%s"\n' "$1"; }

# Hasło dla użytkownika bazy + wersja sekretu. Pomijane, gdy sekret ma już
# wersję (hasło nie jest zmieniane przy ponownym przebiegu). Gdy wersji brak,
# a użytkownik istnieje (przerwany poprzedni przebieg) — hasło jest ustawiane
# od nowa, więc stan sam się naprawia.
# $1 = użytkownik, $2 = sekret, $3 = „url” (sekret = POSTGRES_URL) albo „raw”
db_password() {
  local user="$1" secret="$2" kind="$3"
  if secret_has_version "$secret"; then
    echo "  skip: $secret has a version (password of $user unchanged)"
    return 0
  fi
  local user_exists=0
  if [[ "$user" == "postgres" ]] || exists sql users describe "$user" --instance="$SQL_INSTANCE"; then
    user_exists=1
  fi
  local verb="create"
  [[ "$user_exists" == 1 ]] && verb="set-password"
  local shown="<generated>"
  local value_shown="$shown"
  [[ "$kind" == "url" ]] && value_shown="postgresql://${user}:${shown}@localhost/${DB_NAME}?host=/cloudsql/${PROJECT_ID}:${REGION}:${SQL_INSTANCE}"
  echo "+ CLOUDSDK_CORE_DISABLE_FILE_LOGGING=1 gcloud --project=$PROJECT_ID --quiet sql users $verb $user --instance=$SQL_INSTANCE --flags-file=<(--password: $shown)"
  echo "+ CLOUDSDK_CORE_DISABLE_FILE_LOGGING=1 gcloud --project=$PROJECT_ID --quiet secrets versions add $secret --data-file=- <<< $value_shown"
  [[ "$APPLY" == 1 ]] || return 0
  local pw
  pw="$(gen_password)"
  [[ "$pw" =~ ^[A-Za-z0-9]{32}$ ]] || die "password generator failed"
  # Bez lokalnego logu gcloud (~/.config/gcloud/logs zapisuje wartości flag,
  # także rozwinięte z --flags-file) — B-1, Ryan 6899923012.
  CLOUDSDK_CORE_DISABLE_FILE_LOGGING=1 "${GC[@]}" sql users "$verb" "$user" --instance="$SQL_INSTANCE" --flags-file=<(password_flags "$pw")
  # N2 (Ryan, K-1b): także dodanie wersji sekretu bez lokalnego logu gcloud.
  if [[ "$kind" == "url" ]]; then
    printf 'postgresql://%s:%s@localhost/%s?host=/cloudsql/%s:%s:%s' \
      "$user" "$pw" "$DB_NAME" "$PROJECT_ID" "$REGION" "$SQL_INSTANCE" |
      CLOUDSDK_CORE_DISABLE_FILE_LOGGING=1 "${GC[@]}" secrets versions add "$secret" --data-file=-
  else
    printf '%s' "$pw" | CLOUDSDK_CORE_DISABLE_FILE_LOGGING=1 "${GC[@]}" secrets versions add "$secret" --data-file=-
  fi
  pw=""
}

stage_sql() {
  # Strażnik kosztowy: bez jawnej edycji enterprise Cloud SQL utworzy dla
  # PG16–18 Enterprise Plus (bez shared-core). Nie ruszamy dalej.
  [[ "$SQL_EDITION" == "enterprise" ]] || die "SQL_EDITION must be enterprise (koszt)"
  [[ "$SQL_TIER" == "db-f1-micro" ]] || die "SQL_TIER must be db-f1-micro (koszt)"
  if ! exists sql instances describe "$SQL_INSTANCE"; then
    run sql instances create "$SQL_INSTANCE" \
      --edition="$SQL_EDITION" \
      --database-version="$PG_VERSION" \
      --tier="$SQL_TIER" \
      --region="$REGION" \
      --availability-type=zonal \
      --storage-type=SSD \
      --storage-size=10GB \
      --storage-auto-increase \
      --storage-auto-increase-limit=30 \
      --backup-start-time=01:00 \
      --retained-backups-count=7 \
      --enable-point-in-time-recovery \
      --retained-transaction-log-days=7 \
      --deletion-protection \
      --maintenance-window-day=SUN \
      --maintenance-window-hour=3 \
      --ssl-mode=ENCRYPTED_ONLY
  fi
  # Baza, loginy i wiązania dopiero na instancji w stanie RUNNABLE.
  echo "? gcloud --project=$PROJECT_ID --quiet sql instances describe $SQL_INSTANCE --format=value(state)"
  if [[ "$APPLY" == 1 ]]; then
    local state
    state="$("${GC[@]}" sql instances describe "$SQL_INSTANCE" "--format=value(state)" 2>/dev/null)" ||
      die "cannot read state of instance $SQL_INSTANCE"
    [[ "$state" == "RUNNABLE" ]] || die "instance $SQL_INSTANCE is $state, not RUNNABLE — repeat stage sql later"
    echo "  state: RUNNABLE"
  else
    echo "  state: not checked (dry-run)"
  fi
  if ! exists sql databases describe "$DB_NAME" --instance="$SQL_INSTANCE"; then
    run sql databases create "$DB_NAME" --instance="$SQL_INSTANCE"
  fi
  # Kontener na hasło `postgres` (poza manifestem; postgres-url tworzy etap secrets).
  if ! exists secrets describe "$DB_ADMIN_SECRET"; then
    run secrets create "$DB_ADMIN_SECRET" --replication-policy=user-managed --locations="$REGION"
  fi
  db_password "$DB_USER" "$DB_URL_SECRET" url
  db_password postgres "$DB_ADMIN_SECRET" raw
  local cond="expression=resource.type == \"sqladmin.googleapis.com/Instance\" && resource.name == \"${SQL_RESOURCE}\",title=only-${SQL_INSTANCE}"
  # Kopia na żądanie: operacje na kopiach mają typ zasobu BackupRun (W-1, Ryan).
  local backup_cond="expression=(resource.type == \"sqladmin.googleapis.com/Instance\" && resource.name == \"${SQL_RESOURCE}\") || (resource.type == \"sqladmin.googleapis.com/BackupRun\" && resource.name.startsWith(\"${SQL_RESOURCE}/\")),title=only-${SQL_INSTANCE}-backups"
  # Usługa i job migracji działają jako konto runtime — tylko ono łączy się
  # z bazą: Cloud SQL Client wyłącznie na tej instancji. Konto deploy NIE
  # dostaje cloudsql.client (Oliver, recenzja #134): po jego stronie nic nie
  # łączy się z bazą (kopia na żądanie to Admin API — rola niżej).
  run projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:$RUNTIME_SA" --role=roles/cloudsql.client --condition="$cond"
  # Deploy: kopia na żądanie przed migracją (run-migrate.sh: `sql backups
  # create` czeka na operację). Dokładnie trzy uprawnienia (W-1): utworzenie
  # i odczyt kopii oraz odczyt instancji (śledzenie operacji). Bez list.
  # Istniejąca rola dostaje tę samą listę (update) — bez dryfu.
  local role="projects/${PROJECT_ID}/roles/myhelperSqlBackup"
  local perms="cloudsql.backupRuns.create,cloudsql.backupRuns.get,cloudsql.instances.get"
  if exists iam roles describe myhelperSqlBackup; then
    run iam roles update myhelperSqlBackup --permissions="$perms"
  else
    run iam roles create myhelperSqlBackup \
      --title="MyHelper on-demand SQL backup" --stage=GA --permissions="$perms"
  fi
  run projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:$DEPLOY_SA" --role="$role" --condition="$backup_cond"
}

stage_run() {
  # Powłoka usługi i joba, żeby deploy dostał run.developer NA ZASOBIE,
  # a nie na projekcie. Zaślepki zastępuje pierwszy przebieg workflow.
  # Zastępcza rewizja: bez sekretów i bez zmiennych środowiska; tylko konto runtime.
  if ! exists run services describe "$SERVICE" --region="$REGION"; then
    run run deploy "$SERVICE" --region="$REGION" --image="$PLACEHOLDER_IMAGE" \
      --service-account="$RUNTIME_SA" --no-allow-unauthenticated \
      --min-instances=0 --max-instances=1
  fi
  # Publiczny invoker ustawia wyłącznie ten etap (konto sesji głównej).
  run run services add-iam-policy-binding "$SERVICE" --region="$REGION" \
    --member=allUsers --role=roles/run.invoker
  run run services add-iam-policy-binding "$SERVICE" --region="$REGION" \
    --member="serviceAccount:$DEPLOY_SA" --role=roles/run.developer
  if ! exists run jobs describe "$MIGRATE_JOB" --region="$REGION"; then
    run run jobs create "$MIGRATE_JOB" --region="$REGION" --image="$PLACEHOLDER_IMAGE" \
      --service-account="$RUNTIME_SA" --tasks=1 --max-retries=0
  fi
  run run jobs add-iam-policy-binding "$MIGRATE_JOB" --region="$REGION" \
    --member="serviceAccount:$DEPLOY_SA" --role=roles/run.developer
}

# Warunek atrybutów WIF z pliku (CEL, jedna lub wiele linii). Warunek musi być
# CZYSTĄ KONIUNKCJĄ równości `assertion.<pole> == '<wartość>'` połączonych `&&`
# (#140): bez `||`, negacji, operatora warunkowego, nawiasów i funkcji — każdy
# człon jest sprawdzany osobno, nie podciągiem. Obowiązkowe człony (Ryan,
# 6899923012) muszą wystąpić dokładnie w tej postaci; dodatkowe równości wolno
# dopisać (tylko zawężają).
wif_condition() {
  local raw
  raw="$(grep -v '^[[:space:]]*#' "$WIF_CONDITION_FILE" | tr '\n' ' ' | tr -s ' ' | sed 's/^ //; s/ $//')"
  [[ -n "$raw" ]] || die "WIF condition file is empty"
  local terms=() term rest="$raw"
  while [[ "$rest" == *" && "* ]]; do
    terms+=("${rest%% && *}")
    rest="${rest#* && }"
  done
  terms+=("$rest")
  for term in "${terms[@]}"; do
    [[ "$term" =~ ^assertion\.[a-z_]+\ ==\ \'[A-Za-z0-9_./@-]+\'$ ]] ||
      die "WIF condition must be a pure conjunction of assertion.<field> == '<value>'; bad term: $term"
  done
  local required=(
    "assertion.repository_id == '${GITHUB_REPOSITORY_ID}'"
    "assertion.repository_owner_id == '${GITHUB_REPOSITORY_OWNER_ID}'"
    "assertion.ref == 'refs/heads/main'"
    "assertion.workflow_ref == '${DEPLOY_WORKFLOW_REF}'"
    "assertion.job_workflow_ref == '${DEPLOY_WORKFLOW_REF}'"
    "assertion.environment == 'production-gcp'"
    "assertion.event_name == 'workflow_dispatch'"
    "assertion.run_attempt == '1'"
    "assertion.actor_id == '${GITHUB_ACTOR_ID}'"
  )
  local r found
  for r in "${required[@]}"; do
    found=0
    for term in "${terms[@]}"; do [[ "$term" == "$r" ]] && found=1; done
    [[ "$found" == 1 ]] || die "WIF condition missing clause: $r"
  done
  printf '%s' "$raw"
}

stage_wif() {
  local condition
  condition="$(wif_condition)"
  echo "  condition: $condition"
  local mapping="google.subject=assertion.sub,attribute.repository_id=assertion.repository_id,attribute.repository_owner_id=assertion.repository_owner_id,attribute.ref=assertion.ref,attribute.workflow_ref=assertion.workflow_ref,attribute.job_workflow_ref=assertion.job_workflow_ref,attribute.environment=assertion.environment"
  if ! exists iam workload-identity-pools describe "$WIF_POOL" --location=global; then
    run iam workload-identity-pools create "$WIF_POOL" --location=global --display-name="GitHub Actions"
  fi
  local verb=create-oidc
  if exists iam workload-identity-pools providers describe "$WIF_PROVIDER" \
    --workload-identity-pool="$WIF_POOL" --location=global; then
    verb=update-oidc
  fi
  run iam workload-identity-pools providers "$verb" "$WIF_PROVIDER" \
    --workload-identity-pool="$WIF_POOL" --location=global \
    --issuer-uri="https://token.actions.githubusercontent.com" \
    --attribute-mapping="$mapping" \
    --attribute-condition="$condition"
  local pool="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${WIF_POOL}"
  run iam service-accounts add-iam-policy-binding "$DEPLOY_SA" \
    --role=roles/iam.workloadIdentityUser \
    --member="principalSet://iam.googleapis.com/${pool}/attribute.repository_id/${GITHUB_REPOSITORY_ID}"
  echo "  GCP_WIF_PROVIDER=${pool}/providers/${WIF_PROVIDER}"
  echo "  GCP_DEPLOY_SA=${DEPLOY_SA}"
  echo "  GCP_RUNTIME_SA=${RUNTIME_SA}"
}

if [[ "$APPLY" == 1 ]]; then
  echo "mode: APPLY (project=$PROJECT_ID region=$REGION stage=$STAGE)"
else
  echo "mode: DRY-RUN — nothing is executed (project=$PROJECT_ID region=$REGION stage=$STAGE)"
fi
"stage_$STAGE"
echo "stage $STAGE: done"
