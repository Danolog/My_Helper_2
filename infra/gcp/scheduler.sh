#!/usr/bin/env bash
# Harmonogram Cloud Scheduler dla MyHelper (brief C §4, zadanie 0.7).
#
# NIE URUCHAMIAĆ w kroku C. Włączenie harmonogramu = prawdziwe SMS-y i push do
# klientów salonów (krok D, decyzja Darka).
#
# Użycie:
#   PROJECT_ID=… REGION=europe-central2 BASE_URL=https://… infra/gcp/scheduler.sh          # create/update
#   PROJECT_ID=… REGION=europe-central2 BASE_URL=https://… infra/gcp/scheduler.sh --check  # tylko porównanie (kod ≠ 0 przy dryfie)
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
if [[ "${1:-}" == "--check" ]]; then
  MODE="check"
elif [[ $# -gt 0 ]]; then
  echo "usage: $0 [--check]" >&2
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

  common=(
    --location="$REGION"
    --schedule="$schedule"
    --time-zone="$TIME_ZONE"
    --uri="$uri"
    --http-method=GET
    --attempt-deadline=320s
    --max-retry-attempts=2
    --min-backoff=30s
    --max-backoff=120s
  )
  if job_exists "$name"; then
    "${GC[@]}" scheduler jobs update http "$name" "${common[@]}" \
      --flags-file=<(auth_flags --update-headers)
  else
    "${GC[@]}" scheduler jobs create http "$name" "${common[@]}" \
      --flags-file=<(auth_flags --headers)
  fi

  if [[ "$state" == "PAUSED" ]]; then
    "${GC[@]}" scheduler jobs pause "$name" --location="$REGION"
  else
    "${GC[@]}" scheduler jobs resume "$name" --location="$REGION"
  fi
  echo "applied $name ($state)"
done

exit "$drift"
