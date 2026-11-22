#!/usr/bin/env bash
# monitoring usługi Cloud Run `myhelper`: alerty błędów aplikacji, odpowiedzi
# 5xx, nieudanych zadań Cloud Scheduler i uptime check adresu run.app.
# Procedura: docs/runbook-krok-d.md, sekcja „Monitoring”.
#
# KTO URUCHAMIA: wyłącznie operator z kontem właściciela projektu, po recenzji,
# wersją z `main`. Agenci nie wykonują tego skryptu na projekcie.
#
# DOMYŚLNIE --dry-run: skrypt NICZEGO nie wykonuje, ani odczytu, ani zmiany.
# Wypisuje tylko polecenia: `? …` dla odczytu stanu, `+ …` dla zmiany.
# Dopiero `--apply` wykonuje odczyty stanu i zmiany.
#
# Kanał powiadomień: skrypt NIE tworzy kanału. Używa kanału e-mail z lb.sh
# (displayName `myhelper-lb-owner-email`): jeden kanał, jeden adres właściciela,
# adresu nie ma w tym pliku ani w wyjściu. Brak kanału przy --apply = błąd
# (kod 2) przed jakąkolwiek zmianą — najpierw infra/gcp/lb.sh --apply.
#
# Zasoby (stałe nazwy niżej), w tej kolejności:
#   (1) alert na logach: wpisy severity>=ERROR usługi myhelper, bez logu
#       żądań (5xx pilnuje (2))
#   (2) alert na metryce: więcej niż 3 odpowiedzi 5xx w oknie 5 min (liczba,
#       nie procent — przy małym ruchu procent skacze od pojedynczych żądań)
#   (3) alert na logach: wpisy severity>=ERROR zadań Cloud Scheduler
#       (nieudane próby; ponowienia tej samej próby łączy limit powiadomień)
#   (4) uptime check https://<adres run.app>/api/health + alert na
#       uptime_check/check_passed (health pinguje bazę: alert odpala też przy
#       awarii bazy)
# Alerty na logach: limit powiadomień 10 min i autoClose 30 min. Bez
# labelExtractors: treść wpisu (message, stack_trace) może zawierać dane
# osobowe — nie wyciągamy jej do etykiet powiadomienia.
#
# Adres run.app: przy --apply odczyt `run services describe myhelper
# --format=value(status.url)`, sprawdzany wzorcem (host *.run.app usługi
# myhelper); bez adresu na sztywno. Uptime run.app obowiązuje do przełączenia
# ruchu na domenę; potem domenę pilnuje uptime z lb.sh, a ten usuwa
# `--undo --only-runapp`. Przy ingress ograniczonym do LB adres run.app przestaje
# odpowiadać (dziś ingress `all`).
#
# Istniejący zasób (po displayName) zostaje bez zmian: zmiana stałych =
# --undo, potem --apply.
#
# --undo: usuwa wyłącznie zasoby tego skryptu (nigdy kanału). Też dry-run
# domyślnie. --only-runapp (tylko z --undo): wyłącznie uptime run.app i jego alert.
#
# Użycie:
#   infra/gcp/monitoring.sh --project ID [--region=europe-central2] [--undo [--only-runapp]] [--apply]
# Nazwy, filtry i progi są stałymi niżej (zmiana = nowa recenzja).
#
# Strażnik: __tests__/lib/monitoring-config.test.ts.
set -euo pipefail
umask 077

APPLY=0 UNDO=0 ONLY_RUNAPP=0
PROJECT_ID="" REGION=""

# Jedyny dopuszczony region usługi Cloud Run.
ALLOWED_REGION="europe-central2"
SERVICE="myhelper"
HEALTH_PATH="/api/health"
# Fragment treści zdrowej odpowiedzi (src/app/api/health/route.ts,
# NextResponse.json bez spacji). Odpowiedź `"status":"unhealthy"` go nie zawiera.
HEALTH_MATCH='"status":"healthy"'
# Adres usługi z odczytu: wyłącznie https i host *.run.app zaczynający się od
# nazwy usługi (bez ścieżki i portu).
RUNAPP_URL_RE='^https://myhelper-[a-z0-9-]+(\.[a-z0-9-]+)*\.run\.app$'

# Kanał z lb.sh (wyszukiwany po displayName, nigdy tworzony tutaj).
CHANNEL="myhelper-lb-owner-email"

# Stałe nazwy zasobów.
ERRORS_ALERT="myhelper-run-errors-alert"
HTTP5XX_ALERT="myhelper-run-5xx-alert"
SCHEDULER_ALERT="myhelper-scheduler-errors-alert"
RUNAPP_UPTIME="myhelper-runapp-health"
RUNAPP_ALERT="myhelper-runapp-health-alert"

# Progi i okna.
NOTIFY_RATE_LIMIT="600s"
AUTO_CLOSE="1800s"
HTTP5XX_THRESHOLD=3
HTTP5XX_WINDOW="300s"
UPTIME_PERIOD_MIN=1
UPTIME_TIMEOUT_S=10
UPTIME_REGIONS="europe,usa-oregon,asia-pacific"

# Filtry (język zapytań Logging / Monitoring).
# Log żądań Cloud Run ma severity=ERROR przy każdej odpowiedzi 5xx — bez
# wykluczenia (1) odpalałby od pojedynczej 5xx i dublował (2).
ERRORS_FILTER='resource.type="cloud_run_revision" AND resource.labels.service_name="myhelper" AND severity>=ERROR AND NOT log_id("run.googleapis.com/requests")'
SCHEDULER_FILTER='resource.type="cloud_scheduler_job" AND severity>=ERROR'
HTTP5XX_FILTER='metric.type="run.googleapis.com/request_count" AND resource.type="cloud_run_revision" AND resource.label.service_name="myhelper" AND metric.label.response_code_class="5xx"'

die() { echo "error: $*" >&2; exit 2; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply) APPLY=1 ;;
    --dry-run) APPLY=0 ;;
    --undo) UNDO=1 ;;
    --only-runapp) ONLY_RUNAPP=1 ;;
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
[[ "$ONLY_RUNAPP" == 0 || "$UNDO" == 1 ]] || die "--only-runapp requires --undo"

GC=(gcloud --project="$PROJECT_ID" --quiet)

# Zmiana: wypisz; wykonaj tylko przy --apply.
run() {
  echo "+ gcloud --project=$PROJECT_ID --quiet $*"
  if [[ "$APPLY" == 1 ]]; then "${GC[@]}" "$@"; fi
}

# Odczyt z treścią (list/describe --format) do zmiennej LOOKUP. Kod ≠ 0 to błąd
# odczytu (nie „brak”) — przebieg się przerywa, zamiast tworzyć duplikat.
# Dry-run: LOOKUP pusty przy tworzeniu, zastępczy przy --undo (dry-run pokazuje
# wtedy pełną listę poleceń).
LOOKUP=""
lookup() {
  echo "? gcloud --project=$PROJECT_ID --quiet $*"
  LOOKUP=""
  if [[ "$APPLY" != 1 ]]; then
    echo "  state: not checked (dry-run)"
    [[ "$UNDO" == 1 ]] && LOOKUP="<name-from-list>"
    return 0
  fi
  LOOKUP="$("${GC[@]}" "$@" 2>/dev/null)" || die "cannot read: $* — stopped"
  LOOKUP="$(printf '%s' "$LOOKUP" | head -n 1)"
  if [[ -n "$LOOKUP" ]]; then echo "  state: exists"; else echo "  state: missing"; fi
}

# Wartość jako treść łańcucha JSON (filtry zawierają cudzysłowy).
json_str() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  printf '%s' "$s"
}

# Nazwa kanału z lb.sh (projects/…/notificationChannels/…); ustawiana w create_all.
CHANNEL_NAME=""

# Polityka alertu na logach: dopasowanie wpisu, limit powiadomień, autoClose.
log_alert_json() {
  local name="$1" filter="$2" doc="$3"
  cat <<JSON
{
  "displayName": "${name}",
  "enabled": true,
  "combiner": "OR",
  "documentation": {"content": "$(json_str "$doc")", "mimeType": "text/markdown"},
  "conditions": [{
    "displayName": "${name} log match",
    "conditionMatchedLog": {"filter": "$(json_str "$filter")"}
  }],
  "alertStrategy": {"notificationRateLimit": {"period": "${NOTIFY_RATE_LIMIT}"}, "autoClose": "${AUTO_CLOSE}"},
  "notificationChannels": ["${CHANNEL_NAME}"]
}
JSON
}

# Polityka alertu na liczbie odpowiedzi 5xx w oknie HTTP5XX_WINDOW (suma ze
# wszystkich rewizji usługi).
http5xx_alert_json() {
  cat <<JSON
{
  "displayName": "${HTTP5XX_ALERT}",
  "enabled": true,
  "combiner": "OR",
  "documentation": {"content": "$(json_str "Usługa ${SERVICE}: więcej niż ${HTTP5XX_THRESHOLD} odpowiedzi 5xx w ${HTTP5XX_WINDOW}. Szczegóły: logi myhelper-logs (europe-central2).")", "mimeType": "text/markdown"},
  "conditions": [{
    "displayName": "${SERVICE} 5xx > ${HTTP5XX_THRESHOLD} / ${HTTP5XX_WINDOW}",
    "conditionThreshold": {
      "filter": "$(json_str "$HTTP5XX_FILTER")",
      "aggregations": [{"alignmentPeriod": "${HTTP5XX_WINDOW}", "perSeriesAligner": "ALIGN_SUM", "crossSeriesReducer": "REDUCE_SUM"}],
      "comparison": "COMPARISON_GT",
      "thresholdValue": ${HTTP5XX_THRESHOLD},
      "duration": "0s",
      "trigger": {"count": 1}
    }
  }],
  "alertStrategy": {"autoClose": "${AUTO_CLOSE}"},
  "notificationChannels": ["${CHANNEL_NAME}"]
}
JSON
}

# Polityka alertu uptime run.app (jak w lb.sh: co najmniej dwa regiony
# sprawdzające zgłaszają błąd przez 1 min).
uptime_alert_json() {
  local host="$1"
  local filter="metric.type=\"monitoring.googleapis.com/uptime_check/check_passed\" AND resource.type=\"uptime_url\" AND resource.label.host=\"${host}\""
  cat <<JSON
{
  "displayName": "${RUNAPP_ALERT}",
  "enabled": true,
  "combiner": "OR",
  "documentation": {"content": "$(json_str "Uptime check ${HEALTH_PATH} na adresie run.app usługi ${SERVICE} nie przechodzi. ${HEALTH_PATH} pinguje bazę: alert odpala także przy awarii bazy (503), nie tylko usługi.")", "mimeType": "text/markdown"},
  "conditions": [{
    "displayName": "run.app${HEALTH_PATH} failing",
    "conditionThreshold": {
      "filter": "$(json_str "$filter")",
      "aggregations": [{"alignmentPeriod": "60s", "perSeriesAligner": "ALIGN_NEXT_OLDER", "crossSeriesReducer": "REDUCE_COUNT_FALSE", "groupByFields": ["resource.label.*"]}],
      "comparison": "COMPARISON_GT",
      "thresholdValue": 1,
      "duration": "60s",
      "trigger": {"count": 1}
    }
  }],
  "alertStrategy": {"autoClose": "${AUTO_CLOSE}"},
  "notificationChannels": ["${CHANNEL_NAME}"]
}
JSON
}

# Utworzenie polityki $1 z treści $2, o ile polityki o tej nazwie nie ma.
create_policy() {
  local name="$1" body="$2" file
  lookup alpha monitoring policies list "--filter=displayName=\"${name}\"" "--format=value(name)"
  if [[ -n "$LOOKUP" ]]; then
    echo "  skip: $name exists"
    return 0
  fi
  file="$(mktemp)"
  printf '%s\n' "$body" >"$file"
  echo "  policy: $(tr -d '\n' <"$file" | tr -s ' ')"
  # Plik usuwany także przy błędzie gcloud; kod błędu przechodzi dalej
  # (set -e przerywa przebieg jak wcześniej).
  local rc=0
  run alpha monitoring policies create --policy-from-file="$file" || rc=$?
  rm -f "$file"
  return "$rc"
}

create_all() {
  # Kanał z lb.sh — przed jakąkolwiek zmianą.
  lookup beta monitoring channels list "--filter=displayName=\"${CHANNEL}\"" "--format=value(name)"
  if [[ "$APPLY" == 1 && -z "$LOOKUP" ]]; then
    die "notification channel $CHANNEL missing — run infra/gcp/lb.sh --apply first (this script does not create channels)"
  fi
  CHANNEL_NAME="${LOOKUP:-<channel-name>}"

  # Adres run.app z odczytu usługi — przed jakąkolwiek zmianą.
  lookup run services describe "$SERVICE" "--region=${REGION}" "--format=value(status.url)"
  local url="$LOOKUP" host="<run.app-host>"
  if [[ "$APPLY" == 1 ]]; then
    [[ -n "$url" ]] || die "service $SERVICE has no URL — stopped"
    [[ "$url" =~ $RUNAPP_URL_RE ]] || die "unexpected URL of service $SERVICE (expected https://myhelper-….run.app) — stopped"
    host="${url#https://}"
  fi
  echo "  run.app host: $host"

  # (1)
  create_policy "$ERRORS_ALERT" "$(log_alert_json "$ERRORS_ALERT" "$ERRORS_FILTER" \
    "Błąd (severity>=ERROR) w usłudze ${SERVICE}. Szczegóły: logi myhelper-logs (europe-central2).")"
  # (2)
  create_policy "$HTTP5XX_ALERT" "$(http5xx_alert_json)"
  # (3)
  create_policy "$SCHEDULER_ALERT" "$(log_alert_json "$SCHEDULER_ALERT" "$SCHEDULER_FILTER" \
    "Nieudana próba zadania Cloud Scheduler (severity>=ERROR). Szczegóły: logi cloud_scheduler_job.")"

  # (4) Uptime check run.app, potem jego alert.
  lookup monitoring uptime list-configs "--filter=displayName=\"${RUNAPP_UPTIME}\"" "--format=value(name)"
  if [[ -z "$LOOKUP" ]]; then
    run monitoring uptime create "$RUNAPP_UPTIME" --resource-type=uptime-url \
      --resource-labels="host=${host},project_id=${PROJECT_ID}" \
      --protocol=https --port=443 --path="$HEALTH_PATH" --period="$UPTIME_PERIOD_MIN" \
      --timeout="$UPTIME_TIMEOUT_S" --regions="$UPTIME_REGIONS" --validate-ssl=true \
      --matcher-type=contains-string --matcher-content="$HEALTH_MATCH"
  else
    echo "  skip: $RUNAPP_UPTIME exists"
  fi
  create_policy "$RUNAPP_ALERT" "$(uptime_alert_json "$host")"
}

# Usunięcie polityki $1, jeśli istnieje.
delete_policy() {
  lookup alpha monitoring policies list "--filter=displayName=\"${1}\"" "--format=value(name)"
  if [[ -n "$LOOKUP" ]]; then run alpha monitoring policies delete "$LOOKUP"; fi
  return 0
}

undo_all() {
  # Najpierw alert uptime, potem sam uptime check.
  delete_policy "$RUNAPP_ALERT"
  lookup monitoring uptime list-configs "--filter=displayName=\"${RUNAPP_UPTIME}\"" "--format=value(name)"
  if [[ -n "$LOOKUP" ]]; then run monitoring uptime delete "$LOOKUP"; fi
  if [[ "$ONLY_RUNAPP" == 0 ]]; then
    delete_policy "$SCHEDULER_ALERT"
    delete_policy "$HTTP5XX_ALERT"
    delete_policy "$ERRORS_ALERT"
  fi
  echo "  skip: channel $CHANNEL kept (owned by lb.sh)"
}

MODE_LABEL="create"
[[ "$UNDO" == 1 ]] && MODE_LABEL="undo"
SCOPE="all"
[[ "$ONLY_RUNAPP" == 1 ]] && SCOPE="runapp"
if [[ "$APPLY" == 1 ]]; then
  echo "mode: APPLY (project=$PROJECT_ID region=$REGION monitoring=$MODE_LABEL scope=$SCOPE)"
else
  echo "mode: DRY-RUN — nothing is executed (project=$PROJECT_ID region=$REGION monitoring=$MODE_LABEL scope=$SCOPE)"
fi
"${MODE_LABEL}_all"
echo "monitoring $MODE_LABEL: done"
