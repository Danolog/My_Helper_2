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
# Zakres (§2 P8, w tej kolejności). Najpierw odczyt ujścia `_Default`
# (błąd odczytu = stop przed jakąkolwiek zmianą), potem:
#   (0) zasobnik logów `myhelper-logs` w europe-central2, retencja 30 dni
#       (musi istnieć przed zmianą celu ujścia: cel bez zasobnika = błędy zapisu);
#   (1) ujście `_Default`: cel = `myhelper-logs` (logi żądań z IP i user-agent
#       zostają w europe-central2, nie w lokalizacji global) i wykluczenie
#       wpisów GET, których ADRES ŻĄDANIA (od początku ścieżki, z kotwicą) jest
#       adresem z tokenem jednorazowym Better Auth (Cloud Run i LB — filtr nie
#       zawęża typu zasobu). Ścieżki (better-auth 1.7.25):
#         /api/auth/verify-email?token=…        (link weryfikacji e-mail)
#         /api/auth/reset-password/<token>?…    (link resetu hasła; token to
#                                                JEDEN segment [A-Za-z0-9],
#                                                generateId: a-z, A-Z, 0-9)
#         /reset-password?token=…               (strona aplikacji po
#                                                przekierowaniu z linku resetu)
#       Segment tokenu bez `.`, `%` i `/`: adresy z `..` albo `%2e%2e` po
#       prefiksie resetu (inna ścieżka po normalizacji) zostają w logach.
#       Tylko GET i HEAD (linki z e-maili); inne metody zostają w logach.
#       Bez nagłówka Referer i bez dopasowania w parametrach zapytania: obie
#       wartości ustala klient, więc pozwalałyby ukryć dowolne żądanie.
#       Token w Referer usuwa aplikacja (next.config.ts, no-referrer na trzech
#       adresach). --apply sprawdza te wpisy w next.config.ts i bez nich
#       odmawia (kod 2) (docs/runbook-krok-d.md, §10b). Dry-run wypisuje
#       wynik sprawdzenia.
#       Wykluczenie zawsze z disabled=false: ponowne --apply przywraca
#       wykluczenie wyłączone w konsoli.
#   (2) retencja zasobnika `_Default` = 30 dni, jawnie (wpisy sprzed zmiany celu);
#   (3) Data Access DATA_READ dla secretmanager.googleapis.com (auditConfigs
#       w polityce IAM projektu; wiązania i etag bez zmian);
#   (4) zasobnik logów `myhelper-audit` w europe-central2 z retencją 365 dni
#       i ujście `myhelper-audit-sink`: Admin Activity + Data Access Secret
#       Manager.
# Oba ujścia piszą do zasobników w tym samym projekcie: writerIdentity bez roli.
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
# Katalog tymczasowy z polityką IAM (adresy kont). Globalny, bo pułapka EXIT
# działa poza funkcją i nie widzi zmiennych `local`.
P8_TMP=""

# Jedyny dopuszczony region (lokalizacja zasobników logów i audytu).
ALLOWED_REGION="europe-central2"

# Stałe nazwy i wartości.
EXCLUSION="myhelper-auth-token-urls"
LOGS_BUCKET="myhelper-logs"
AUDIT_BUCKET="myhelper-audit"
AUDIT_SINK="myhelper-audit-sink"
DEFAULT_RETENTION_DAYS=30
AUDIT_RETENTION_DAYS=365
AUDIT_SERVICE="secretmanager.googleapis.com"

# Wyrażenie RE2 adresu z tokenem: kotwica na schemacie i hoście, ścieżka zaraz
# po hoście. Token resetu: jeden segment alfabetu generateId, potem `?` albo
# koniec adresu. `[?]` zamiast `\?` (bez ucieczek w języku zapytań Logging).
# Bez przecinka (rozdziela pola --add-exclusion) i bez `\`.
TOKEN_RE='^https?://[^/?#]+/(api/auth/verify-email[?]|api/auth/reset-password/[A-Za-z0-9]+([?]|$)|reset-password/?[?])'
EXCLUSION_FILTER="(httpRequest.requestMethod=\"GET\" OR httpRequest.requestMethod=\"HEAD\") AND httpRequest.requestUrl=~\"${TOKEN_RE}\""

# Warunek --apply: next.config.ts w repo ustawia Referrer-Policy: no-referrer
# dla każdej ścieżki niżej, we wpisie headers() PO wpisie "/(.*)" (przy tym
# samym kluczu wygrywa ostatni). Bez tego token ze strony resetu trafia do
# logów w nagłówku żądań kolejnych zasobów (filtr go nie obejmuje).
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
NEXT_CONFIG="${REPO_ROOT}/next.config.ts"
NO_REFERRER_SOURCES=("/reset-password" "/api/auth/reset-password/:token" "/api/auth/verify-email")

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

LOGS_DEST="logging.googleapis.com/projects/${PROJECT_ID}/locations/${REGION}/buckets/${LOGS_BUCKET}"
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

# Czy next.config.ts ustawia no-referrer dla ścieżki $1. Odczyt pliku w repo
# (nie gcloud), więc działa też w dry-run. Kształt wpisu headers():
#   { source: "<ścieżka>", headers: [{ key: "Referrer-Policy", value: "no-referrer" }] }
# (key i value w jednej linii albo w kolejnych). Linie `//` są pomijane.
# Wpis musi stać PO ostatnim wpisie "/(.*)". Wartość dokładnie "no-referrer"
# (nie "no-referrer-when-downgrade").
has_no_referrer() {
  awk -v want="$1" '
    /^[[:space:]]*\/\// { next }
    /source:[[:space:]]*"/ {
      s = $0; sub(/.*source:[[:space:]]*"/, "", s); sub(/".*/, "", s)
      cur = s; rp = 0
      if (s == "/(.*)") all = NR
    }
    cur == want && /key:[[:space:]]*"Referrer-Policy"/ { rp = 1 }
    cur == want && rp && /value:[[:space:]]*"/ {
      if ($0 ~ /value:[[:space:]]*"no-referrer"/) hit = NR
      rp = 0
    }
    END { exit ((hit > 0 && hit > all + 0) ? 0 : 1) }
  ' "$NEXT_CONFIG"
}

# Odmowa --apply bez no-referrer w next.config.ts (przed pierwszym gcloud).
referrer_guard() {
  local s missing=""
  if [[ ! -f "$NEXT_CONFIG" ]]; then
    missing="${NO_REFERRER_SOURCES[*]}"
  else
    command -v awk >/dev/null 2>&1 || die "awk not found — cannot check next.config.ts"
    for s in "${NO_REFERRER_SOURCES[@]}"; do
      has_no_referrer "$s" || missing="${missing:+$missing }$s"
    done
  fi
  if [[ -z "$missing" ]]; then
    echo "referrer-policy: ok (next.config.ts sets no-referrer for ${NO_REFERRER_SOURCES[*]})"
    return 0
  fi
  echo "referrer-policy: missing no-referrer in next.config.ts for: $missing"
  [[ "$APPLY" == 1 ]] && die "--apply refused: next.config.ts must set Referrer-Policy: no-referrer for: $missing (after \"/(.*)\") — see docs/runbook-krok-d.md §10b"
  return 0
}

# Odczyt ujścia _Default przed jakąkolwiek zmianą (błąd odczytu = stop).
DEFAULT_EXCLUSIONS=""
read_default_sink() {
  lookup logging sinks describe _Default "--format=value(exclusions[].name)"
  DEFAULT_EXCLUSIONS="$LOOKUP"
}

# (0) Zasobnik myhelper-logs (cel _Default). Istniejący dostaje te same wartości.
logs_bucket() {
  if exists logging buckets describe "$LOGS_BUCKET" "--location=${REGION}"; then
    run logging buckets update "$LOGS_BUCKET" "--location=${REGION}" "--retention-days=${DEFAULT_RETENTION_DAYS}"
  else
    run logging buckets create "$LOGS_BUCKET" "--location=${REGION}" "--retention-days=${DEFAULT_RETENTION_DAYS}"
  fi
}

# (1) Ujście _Default: cel myhelper-logs i wykluczenie w jednym wywołaniu.
# Cel przekazywany zawsze; istniejące wykluczenie dostaje ten sam filtr i
# disabled=false (bez dryfu, także po wyłączeniu w konsoli).
exclusion() {
  if [[ ";${DEFAULT_EXCLUSIONS};" == *";${EXCLUSION};"* ]]; then
    run logging sinks update _Default "$LOGS_DEST" "--update-exclusion=name=${EXCLUSION},filter=${EXCLUSION_FILTER},disabled=false"
  else
    run logging sinks update _Default "$LOGS_DEST" "--add-exclusion=name=${EXCLUSION},filter=${EXCLUSION_FILTER},disabled=false"
  fi
}

# (2) Retencja _Default jawnie (zasobnik _Default ma lokalizację global z natury).
default_retention() {
  run logging buckets update _Default --location=global "--retention-days=${DEFAULT_RETENTION_DAYS}"
}

# (3) DATA_READ dla Secret Manager. Polityka IAM zawiera adresy kont: tylko do
# pliku w katalogu tymczasowym (umask 077), nigdy na wyjście, bez lokalnego logu
# gcloud. Zmienia się wyłącznie auditConfigs; etag z odczytu chroni przed
# nadpisaniem równoległej zmiany (konflikt = błąd, nie nadpisanie). Katalog
# tymczasowy usuwa pułapka EXIT (także po błędzie i po Ctrl-C). stderr node
# idzie do /dev/null: błąd JSON.parse cytuje fragment wejścia (adresy kont).
# Przed zapisem node sprawdza, że polityka bez auditConfigs jest identyczna
# z odczytaną (inna różnica = stop bez set-iam-policy).
data_access() {
  echo "? gcloud --project=$PROJECT_ID --quiet projects get-iam-policy $PROJECT_ID --format=json"
  if [[ "$APPLY" != 1 ]]; then
    echo "  state: not checked (dry-run)"
    echo "+ gcloud --project=$PROJECT_ID --quiet projects set-iam-policy $PROJECT_ID <policy-file>"
    echo "  audit: ${AUDIT_SERVICE} DATA_READ (bindings and etag unchanged)"
    return 0
  fi
  command -v node >/dev/null 2>&1 || die "node not found — audit config not changed"
  P8_TMP="$(mktemp -d)"
  trap 'rm -rf "${P8_TMP:-}"' EXIT
  trap 'exit 2' INT TERM HUP
  local before after result
  before="$P8_TMP/before.json"
  after="$P8_TMP/after.json"
  CLOUDSDK_CORE_DISABLE_FILE_LOGGING=1 "${GC[@]}" projects get-iam-policy "$PROJECT_ID" --format=json >"$before" 2>/dev/null ||
    die "cannot read IAM policy — stopped"
  result="$(node - "$before" "$after" "$AUDIT_SERVICE" 2>/dev/null <<'JS'
const fs = require("fs");
const [, , src, dst, service] = process.argv;
const raw = fs.readFileSync(src, "utf8");
const p = JSON.parse(raw);
if (!p || typeof p !== "object" || Array.isArray(p) || !p.etag) { process.stdout.write("invalid"); process.exit(0); }
const rest = ({ auditConfigs: _ignored, ...o }) => JSON.stringify(o);
const orig = rest(JSON.parse(raw));
const cfgs = Array.isArray(p.auditConfigs) ? p.auditConfigs : [];
let c = cfgs.find((x) => x && x.service === service);
const has = (x) => Array.isArray(x.auditLogConfigs) && x.auditLogConfigs.some((l) => l && l.logType === "DATA_READ");
if (c && has(c)) { process.stdout.write("present"); process.exit(0); }
if (!c) { c = { service, auditLogConfigs: [] }; cfgs.push(c); }
if (!Array.isArray(c.auditLogConfigs)) c.auditLogConfigs = [];
c.auditLogConfigs.push({ logType: "DATA_READ" });
p.auditConfigs = cfgs;
const out = JSON.stringify(p, null, 2);
if (rest(JSON.parse(out)) !== orig) { process.stdout.write("drift"); process.exit(0); }
fs.writeFileSync(dst, out, { mode: 0o600 });
process.stdout.write("changed");
JS
)" || die "cannot prepare audit config — stopped"
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
        die "cannot set audit config (etag conflict or permission) — stopped"
      ;;
    drift)
      die "IAM policy would change outside auditConfigs — stopped"
      ;;
    *)
      die "unexpected IAM policy shape — stopped"
      ;;
  esac
  rm -rf "$P8_TMP"
  P8_TMP=""
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
referrer_guard
read_default_sink
logs_bucket
exclusion
default_retention
data_access
audit_sink
echo "logging: done"
