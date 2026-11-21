#!/usr/bin/env bash
# logi platformy GCP: filtr tokenów jednorazowych, retencja, audyt Secret Manager.
# Procedura: docs/runbook-krok-d.md, sekcja „Logi”.
#
# KTO URUCHAMIA: wyłącznie sesja główna (Z3), po recenzji, PRZED pierwszym
# odczytem wartości sekretów (4a.1) i przed rekordem `app` na LB (krok 3).
# Agenci nie wykonują tego skryptu na projekcie.
#
# DOMYŚLNIE --dry-run: skrypt NICZEGO nie wykonuje, ani odczytu, ani zmiany.
# Wypisuje tylko polecenia: `? …` dla odczytu stanu, `+ …` dla zmiany.
# Dopiero `--apply` wykonuje odczyty stanu i zmiany.
#
# Zakres (§2 P8, w tej kolejności):
#   (1) wykluczenie w ujściu `_Default`: wpisy, których adres żądania ALBO
#       Referer zawiera ścieżkę z tokenem jednorazowym Better Auth (Cloud Run
#       i LB — filtr nie zawęża typu zasobu). Ścieżki (better-auth 1.7.25):
#         /api/auth/verify-email?token=…        (link weryfikacji e-mail)
#         /api/auth/reset-password/<token>?…    (link resetu hasła)
#         /reset-password?token=…               (strona aplikacji po
#                                                przekierowaniu z linku resetu)
#       Referer: strona /reset-password?token=… ładuje zasoby i wysyła POST
#       z pełnym adresem w Referer (Referrer-Policy strict-origin-when-cross-origin
#       w obrębie originu), więc sam adres żądania nie wystarcza.
#   (2) retencja zasobnika `_Default` = 30 dni, jawnie;
#   (3) Data Access DATA_READ dla secretmanager.googleapis.com (auditConfigs
#       w polityce IAM projektu; wiązania i etag bez zmian);
#   (4) zasobnik logów `myhelper-audit` w europe-central2 z retencją 365 dni
#       i ujście `myhelper-audit-sink`: Admin Activity + Data Access Secret
#       Manager. Zasobnik w tym samym projekcie: ujście nie potrzebuje roli.
# Brak `add-iam-policy-binding`, brak usuwania, brak blokady retencji.
#
# Użycie:
#   infra/gcp/logging.sh --project ID [--region=europe-central2] [--apply]
# Nazwy, filtry i retencje są stałymi niżej (zmiana = nowa recenzja).
#
# Strażnik: __tests__/lib/logging-config.test.ts.
set -euo pipefail
umask 077

APPLY=0
PROJECT_ID="" REGION=""

# Jedyny dopuszczony region (lokalizacja zasobnika audytu).
ALLOWED_REGION="europe-central2"

# Stałe nazwy i wartości.
EXCLUSION="myhelper-auth-token-urls"
AUDIT_BUCKET="myhelper-audit"
AUDIT_SINK="myhelper-audit-sink"
DEFAULT_RETENTION_DAYS=30
AUDIT_RETENTION_DAYS=365
AUDIT_SERVICE="secretmanager.googleapis.com"

# Wyrażenie RE2 ścieżek z tokenem. Bez przecinka (rozdziela pola --add-exclusion).
TOKEN_RE='/(api/auth/)?(verify-email|reset-password)'
EXCLUSION_FILTER="httpRequest.requestUrl=~\"${TOKEN_RE}\" OR httpRequest.referer=~\"${TOKEN_RE}\""

die() { echo "error: $*" >&2; exit 2; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply) APPLY=1 ;;
    --dry-run) APPLY=0 ;;
    --project=*) PROJECT_ID="${1#*=}" ;;
    --project) [[ $# -ge 2 ]] || die "--project needs a value"; PROJECT_ID="$2"; shift ;;
    --region=*) REGION="${1#*=}" ;;
    --region) [[ $# -ge 2 ]] || die "--region needs a value"; REGION="$2"; shift ;;
    *) die "unknown argument: $1" ;;
  esac
  shift
done

# --- walidacja przed pierwszym wywołaniem gcloud -----------------------------
[[ -n "$PROJECT_ID" ]] || die "missing required --project"
[[ "$PROJECT_ID" =~ ^[a-z][a-z0-9-]{4,28}[a-z0-9]$ ]] || die "invalid --project"
REGION="${REGION:-$ALLOWED_REGION}"
[[ "$REGION" == "$ALLOWED_REGION" ]] || die "--region must be $ALLOWED_REGION"

AUDIT_DEST="logging.googleapis.com/projects/${PROJECT_ID}/locations/${REGION}/buckets/${AUDIT_BUCKET}"
AUDIT_FILTER="logName=\"projects/${PROJECT_ID}/logs/cloudaudit.googleapis.com%2Factivity\" OR (logName=\"projects/${PROJECT_ID}/logs/cloudaudit.googleapis.com%2Fdata_access\" AND protoPayload.serviceName=\"${AUDIT_SERVICE}\")"

GC=(gcloud --project="$PROJECT_ID" --quiet)

# Zmiana: wypisz; wykonaj tylko przy --apply.
run() {
  echo "+ gcloud --project=$PROJECT_ID --quiet $*"
  if [[ "$APPLY" == 1 ]]; then "${GC[@]}" "$@"; fi
}

# Odczyt stanu (kod wyjścia describe). Dry-run: „nie sprawdzono” = brak.
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

# Odczyt z treścią do LOOKUP. Kod ≠ 0 to błąd odczytu (nie „brak”) — stop.
LOOKUP=""
lookup() {
  echo "? gcloud --project=$PROJECT_ID --quiet $*"
  LOOKUP=""
  if [[ "$APPLY" != 1 ]]; then
    echo "  state: not checked (dry-run)"
    return 0
  fi
  LOOKUP="$("${GC[@]}" "$@" 2>/dev/null)" || die "cannot read: $* — stopped"
  LOOKUP="$(printf '%s' "$LOOKUP" | head -n 1)"
  if [[ -n "$LOOKUP" ]]; then echo "  state: exists"; else echo "  state: missing"; fi
}

# (1) Wykluczenie w ujściu _Default: istniejące dostaje ten sam filtr (bez dryfu).
exclusion() {
  lookup logging sinks describe _Default "--format=value(exclusions[].name)"
  if [[ ";${LOOKUP};" == *";${EXCLUSION};"* ]]; then
    run logging sinks update _Default "--update-exclusion=name=${EXCLUSION},filter=${EXCLUSION_FILTER}"
  else
    run logging sinks update _Default "--add-exclusion=name=${EXCLUSION},filter=${EXCLUSION_FILTER}"
  fi
}

# (2) Retencja _Default jawnie (zasobnik _Default ma lokalizację global z natury).
default_retention() {
  run logging buckets update _Default --location=global "--retention-days=${DEFAULT_RETENTION_DAYS}"
}

# (3) DATA_READ dla Secret Manager. Polityka IAM zawiera adresy kont: tylko do
# pliku w katalogu tymczasowym (umask 077), nigdy na wyjście, bez lokalnego logu
# gcloud. Zmienia się wyłącznie auditConfigs; etag z odczytu chroni przed
# nadpisaniem równoległej zmiany (konflikt = błąd, nie nadpisanie).
data_access() {
  echo "? gcloud --project=$PROJECT_ID --quiet projects get-iam-policy $PROJECT_ID --format=json"
  if [[ "$APPLY" != 1 ]]; then
    echo "  state: not checked (dry-run)"
    echo "+ gcloud --project=$PROJECT_ID --quiet projects set-iam-policy $PROJECT_ID <policy-file>"
    echo "  audit: ${AUDIT_SERVICE} DATA_READ (bindings and etag unchanged)"
    return 0
  fi
  command -v node >/dev/null 2>&1 || die "node not found — audit config not changed"
  local tmp before after result
  tmp="$(mktemp -d)"
  before="$tmp/before.json"
  after="$tmp/after.json"
  CLOUDSDK_CORE_DISABLE_FILE_LOGGING=1 "${GC[@]}" projects get-iam-policy "$PROJECT_ID" --format=json >"$before" 2>/dev/null ||
    { rm -rf "$tmp"; die "cannot read IAM policy — stopped"; }
  result="$(node - "$before" "$after" "$AUDIT_SERVICE" <<'JS'
const fs = require("fs");
const [, , src, dst, service] = process.argv;
const p = JSON.parse(fs.readFileSync(src, "utf8"));
if (!p || typeof p !== "object" || !p.etag) { process.stdout.write("invalid"); process.exit(0); }
const cfgs = Array.isArray(p.auditConfigs) ? p.auditConfigs : [];
let c = cfgs.find((x) => x && x.service === service);
const has = (x) => Array.isArray(x.auditLogConfigs) && x.auditLogConfigs.some((l) => l && l.logType === "DATA_READ");
if (c && has(c)) { process.stdout.write("present"); process.exit(0); }
if (!c) { c = { service, auditLogConfigs: [] }; cfgs.push(c); }
if (!Array.isArray(c.auditLogConfigs)) c.auditLogConfigs = [];
c.auditLogConfigs.push({ logType: "DATA_READ" });
p.auditConfigs = cfgs;
fs.writeFileSync(dst, JSON.stringify(p, null, 2), { mode: 0o600 });
process.stdout.write("changed");
JS
)" || { rm -rf "$tmp"; die "cannot prepare audit config — stopped"; }
  case "$result" in
    present)
      echo "  state: exists"
      echo "  skip: ${AUDIT_SERVICE} DATA_READ already enabled"
      ;;
    changed)
      echo "  state: missing"
      echo "+ gcloud --project=$PROJECT_ID --quiet projects set-iam-policy $PROJECT_ID <policy-file>"
      echo "  audit: ${AUDIT_SERVICE} DATA_READ (bindings and etag unchanged)"
      CLOUDSDK_CORE_DISABLE_FILE_LOGGING=1 "${GC[@]}" projects set-iam-policy "$PROJECT_ID" "$after" >/dev/null 2>&1 ||
        { rm -rf "$tmp"; die "cannot set audit config (etag conflict or permission) — stopped"; }
      ;;
    *)
      rm -rf "$tmp"
      die "unexpected IAM policy shape — stopped"
      ;;
  esac
  rm -rf "$tmp"
}

# (4) Zasobnik audytu 365 dni + ujście. Istniejące dostają te same wartości.
audit_sink() {
  if exists logging buckets describe "$AUDIT_BUCKET" "--location=${REGION}"; then
    run logging buckets update "$AUDIT_BUCKET" "--location=${REGION}" "--retention-days=${AUDIT_RETENTION_DAYS}"
  else
    run logging buckets create "$AUDIT_BUCKET" "--location=${REGION}" "--retention-days=${AUDIT_RETENTION_DAYS}"
  fi
  if exists logging sinks describe "$AUDIT_SINK"; then
    run logging sinks update "$AUDIT_SINK" "$AUDIT_DEST" "--log-filter=${AUDIT_FILTER}"
  else
    run logging sinks create "$AUDIT_SINK" "$AUDIT_DEST" "--log-filter=${AUDIT_FILTER}"
  fi
}

if [[ "$APPLY" == 1 ]]; then
  echo "mode: APPLY (project=$PROJECT_ID region=$REGION)"
else
  echo "mode: DRY-RUN — nothing is executed (project=$PROJECT_ID region=$REGION)"
fi
exclusion
default_retention
data_access
audit_sink
echo "logging: done"
