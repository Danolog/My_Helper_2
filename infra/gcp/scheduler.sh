#!/usr/bin/env bash
# Harmonogram Cloud Scheduler dla MyHelper (brief C §4, zadanie 0.7).
#
# NIE URUCHAMIAĆ w kroku C. Włączenie harmonogramu = prawdziwe SMS-y i push do
# klientów salonów (krok D, decyzja Darka).
#
# Użycie (kolejność obowiązkowa, runbook kroku D, D-8):
#   PROJECT_ID=… REGION=europe-central2 BASE_URL=https://… infra/gcp/scheduler.sh           # 1. create/update — WSZYSTKO WSTRZYMANE
#   PROJECT_ID=… REGION=europe-central2 BASE_URL=https://… infra/gcp/scheduler.sh --check   # 2. porównanie (dryf stanu ENABLED → PAUSED jest tu oczekiwany)
#   PROJECT_ID=… REGION=europe-central2 BASE_URL=https://… infra/gcp/scheduler.sh --resume  # 3. włączenie zadań ENABLED (decyzja Darka)
#   PROJECT_ID=… REGION=europe-central2 BASE_URL=https://… infra/gcp/scheduler.sh --check   # 4. pełna zgodność z tabelą (kod 0)
#
# Wstrzymanie przy tworzeniu (#121 j): `gcloud scheduler jobs create http` nie
# ma opcji tworzenia wstrzymanego zadania. Nowe zadanie powstaje więc z
# harmonogramem „zaparkowanym” (29 lutego, najbliżej 2028 — nie wystrzeli),
# od razu jest wstrzymywane, stan jest odczytywany (`describe` = PAUSED,
# inaczej stop z kodem 1), a dopiero potem dostaje właściwy harmonogram.
# Tryb domyślny nigdy nie wznawia zadań; robi to tylko --resume.
#
# Zasady:
# - każde wywołanie gcloud z jawnym --project (nigdy domyślny projekt gcloud);
# - brak PROJECT_ID / REGION / BASE_URL → błąd przed pierwszym wywołaniem gcloud;
# - nagłówek z CRON_SECRET idzie przez --flags-file ze strumienia, nie jako
#   argument polecenia (nie trafia do tablicy procesów ani historii powłoki);
# - idempotentnie: istnieje → update, nie istnieje → create.
# Strażnik: __tests__/lib/scheduler-config.test.ts (G-C5).
set -euo pipefail

MODE="apply"
if [[ $# -gt 1 ]]; then
  echo "usage: $0 [--check|--resume]" >&2
  exit 2
elif [[ "${1:-}" == "--check" ]]; then
  MODE="check"
elif [[ "${1:-}" == "--resume" ]]; then
  MODE="resume"
elif [[ $# -gt 0 ]]; then
  echo "usage: $0 [--check|--resume]" >&2
  exit 2
fi

missing=()
for v in PROJECT_ID REGION BASE_URL; do
  if [[ -z "${!v:-}" ]]; then missing+=("$v"); fi
done
if [[ ${#missing[@]} -gt 0 ]]; then
  echo "error: missing required env: ${missing[*]}" >&2
  exit 2
fi
if [[ "$BASE_URL" != https://* ]]; then
  echo "error: BASE_URL must start with https://" >&2
  exit 2
fi
BASE_URL="${BASE_URL%/}"

TIME_ZONE="Europe/Warsaw"
# Harmonogram zaparkowany dla świeżo tworzonego zadania (29 lutego).
PARKED_SCHEDULE="0 0 29 2 *"
SECRET_NAME="cron-secret"

# nazwa|ścieżka|harmonogram (Europe/Warsaw)|stan (ENABLED|PAUSED)
JOBS=(
  "mh-sms-reminders|/api/cron/sms-reminders|*/5 * * * *|ENABLED"
  "mh-push-reminders|/api/cron/push-reminders|*/5 * * * *|ENABLED"
  "mh-push-reminders-24h|/api/cron/push-reminders-24h|13,43 * * * *|ENABLED"
  "mh-cleanup-pending-deposits|/api/cron/cleanup-pending-deposits|*/15 * * * *|ENABLED"
  "mh-cleanup-temporary-access|/api/cron/cleanup-temporary-access|7 * * * *|ENABLED"
  # Wiadomości do klientów salonów — wstrzymane do decyzji produktowej (brief C, „Do Darka" 8).
  "mh-notify-birthday|/api/notifications/birthday|0 6 * * *|PAUSED"
  "mh-notify-low-stock|/api/notifications/low-stock|0 6 * * *|PAUSED"
  "mh-notify-we-miss-you|/api/notifications/we-miss-you|0 6 * * *|PAUSED"
)

GC=(gcloud --project="$PROJECT_ID" --quiet)

# Plik flag z nagłówkiem autoryzacji, czytany przez gcloud ze strumienia.
# Wartość sekretu nie pojawia się w argumentach procesu ani na wyjściu.
auth_flags() {
  local flag="$1" token
  token="$("${GC[@]}" secrets versions access latest --secret="$SECRET_NAME")"
  printf '%s:\n  Authorization: "Bearer %s"\n' "$flag" "$token"
}

job_exists() {
  "${GC[@]}" scheduler jobs describe "$1" --location="$REGION" --format='value(name)' >/dev/null 2>&1
}

job_state() {
  "${GC[@]}" scheduler jobs describe "$1" --location="$REGION" --format='value(state)'
}

# Obowiązkowy odczyt stanu: inny niż oczekiwany → stop (kod 1), bez dalszych zadań.
require_state() {
  local name="$1" want="$2" got
  got="$(job_state "$name" || true)"
  if [[ "$got" != "$want" ]]; then
    echo "error: $name state is [$got], expected [$want] — stop" >&2
    exit 1
  fi
}

drift=0
for entry in "${JOBS[@]}"; do
  IFS='|' read -r name path schedule state <<<"$entry"
  uri="${BASE_URL}${path}"

  if [[ "$MODE" == "check" ]]; then
    if ! job_exists "$name"; then
      echo "DRIFT $name: missing"
      drift=1
      continue
    fi
    actual="$("${GC[@]}" scheduler jobs describe "$name" --location="$REGION" \
      --format='value(schedule,timeZone,httpTarget.uri,httpTarget.httpMethod,state)')"
    expected="$(printf '%s\t%s\t%s\t%s\t%s' "$schedule" "$TIME_ZONE" "$uri" "GET" "$state")"
    if [[ "$actual" != "$expected" ]]; then
      echo "DRIFT $name: expected [$expected] got [$actual]"
      drift=1
    else
      echo "OK    $name"
    fi
    continue
  fi

  if [[ "$MODE" == "resume" ]]; then
    if ! job_exists "$name"; then
      echo "error: $name missing — run without flags first" >&2
      exit 1
    fi
    if [[ "$state" == "ENABLED" ]]; then
      "${GC[@]}" scheduler jobs resume "$name" --location="$REGION"
      require_state "$name" ENABLED
      echo "resumed $name"
    else
      require_state "$name" PAUSED
      echo "kept    $name (PAUSED)"
    fi
    continue
  fi

  common=(
    --location="$REGION"
    --time-zone="$TIME_ZONE"
    --uri="$uri"
    --http-method=GET
    --attempt-deadline=320s
    --max-retry-attempts=2
    --min-backoff=30s
    --max-backoff=120s
  )
  if job_exists "$name"; then
    # Istniejące zadanie: stan bez zmian, poza wymuszeniem PAUSED z tabeli.
    if [[ "$state" == "PAUSED" ]]; then
      "${GC[@]}" scheduler jobs pause "$name" --location="$REGION"
      require_state "$name" PAUSED
    fi
    "${GC[@]}" scheduler jobs update http "$name" "${common[@]}" --schedule="$schedule" \
      --flags-file=<(auth_flags --update-headers)
    echo "updated $name"
  else
    "${GC[@]}" scheduler jobs create http "$name" "${common[@]}" --schedule="$PARKED_SCHEDULE" \
      --flags-file=<(auth_flags --headers)
    "${GC[@]}" scheduler jobs pause "$name" --location="$REGION"
    require_state "$name" PAUSED
    "${GC[@]}" scheduler jobs update http "$name" --location="$REGION" --schedule="$schedule"
    require_state "$name" PAUSED
    echo "created $name (PAUSED)"
  fi
done

exit "$drift"
