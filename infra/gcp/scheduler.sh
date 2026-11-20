#!/usr/bin/env bash
# Harmonogram Cloud Scheduler dla MyHelper (brief C §4, zadanie 0.7).
#
# NIE URUCHAMIAĆ w kroku C. Włączenie harmonogramu = prawdziwe SMS-y i push do
# klientów salonów (krok D, decyzja właściciela).
#
# Użycie (kolejność obowiązkowa, runbook kroku D, D-8):
#   PROJECT_ID=… REGION=europe-central2 BASE_URL=https://… infra/gcp/scheduler.sh           # 1. create/update — WSZYSTKO WSTRZYMANE
#   PROJECT_ID=… REGION=europe-central2 BASE_URL=https://… infra/gcp/scheduler.sh --check   # 2. porównanie (dryf stanu ENABLED → PAUSED jest tu oczekiwany)
#   PROJECT_ID=… REGION=europe-central2 BASE_URL=https://… infra/gcp/scheduler.sh --resume NAZWA…  # 3. włączenie WYMIENIONYCH zadań (decyzja właściciela)
#   PROJECT_ID=… REGION=europe-central2 BASE_URL=https://… infra/gcp/scheduler.sh --check   # 4. pełna zgodność z tabelą (kod 0)
#
# --resume wymaga jawnych nazw zadań (W-3): włączenie = prawdziwe SMS-y
# i push, więc decyzja jest widoczna w poleceniu. Bez nazw, nazwa nieznana albo
# zadanie, które w tabeli jest PAUSED → błąd (kod 2) przed pierwszym gcloud.
#
# BASE_URL: wyłącznie główny adres naszej usługi Cloud Run (#143 pkt 1) —
# nagłówek z CRON_SECRET idzie na ten host co 5 minut. Inny host (także adres
# taga) = błąd przed pierwszym gcloud. Własna domena = świadoma zmiana tej listy.
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
#   WSZYSTKIE wywołania gcloud idą z CLOUDSDK_CORE_DISABLE_FILE_LOGGING=1
#   (export niżej; gcloud zapisuje do ~/.config/gcloud/logs rozwinięte flagi
#   i wyjście poleceń — B-1, komentarz 6900239072);
# - create/update http zawsze z --format=none: wyjście gcloud z zasobem
#   zadania nie trafia na stdout ani do logu (#137);
# - token jest czytany RAZ przed pierwszą zmianą; błąd odczytu albo pusty
#   token → stop (W-1), nigdy zadanie z pustym nagłówkiem;
# - pause tylko dla stanu ENABLED, resume tylko dla PAUSED (API odrzuca inne
#   przejścia: FAILED_PRECONDITION);
# - istniejące zadanie ENABLED z harmonogramem zaparkowanym (przerwany przebieg
#   między create a pause) jest traktowane jak nowe: najpierw pauza;
# - idempotentnie: istnieje → update (z nagłówkiem — rotacja cron-secret),
#   nie istnieje → create.
# Strażnicy: __tests__/lib/scheduler-config.test.ts (G-C5), scheduler-paused.test.ts (G-C5b).
set -euo pipefail
# Bez logu plikowego gcloud dla całego skryptu (także wywołań bez nagłówka).
export CLOUDSDK_CORE_DISABLE_FILE_LOGGING=1

usage() {
  echo "usage: $0 [--check | --resume JOB_NAME...]" >&2
  exit 2
}

MODE="apply"
RESUME_NAMES=()
if [[ $# -eq 0 ]]; then
  :
elif [[ "$1" == "--check" ]]; then
  [[ $# -eq 1 ]] || usage
  MODE="check"
elif [[ "$1" == "--resume" ]]; then
  shift
  [[ $# -gt 0 ]] || { echo "error: --resume requires explicit job names" >&2; usage; }
  MODE="resume"
  RESUME_NAMES=("$@")
else
  usage
fi

missing=()
for v in PROJECT_ID REGION BASE_URL; do
  if [[ -z "${!v:-}" ]]; then missing+=("$v"); fi
done
if [[ ${#missing[@]} -gt 0 ]]; then
  echo "error: missing required env: ${missing[*]}" >&2
  exit 2
fi
# Jedyny dopuszczony adres: główny URL usługi myhelper (projekt 843777043748,
# europe-central2). Bez ścieżki, bez portu, bez adresu taga.
ALLOWED_BASE_URL="https://myhelper-843777043748.europe-central2.run.app"
BASE_URL="${BASE_URL%/}"
if [[ "$BASE_URL" != "$ALLOWED_BASE_URL" ]]; then
  echo "error: BASE_URL must be $ALLOWED_BASE_URL" >&2
  exit 2
fi

TIME_ZONE="Europe/Warsaw"
# Harmonogram zaparkowany dla świeżo tworzonego zadania (29 lutego).
PARKED_SCHEDULE="0 0 29 2 *"
SECRET_NAME="cron-secret"

# nazwa|ścieżka|harmonogram (Europe/Warsaw)|stan (ENABLED|PAUSED)
JOBS=(
  "mh-sms-reminders|/api/cron/sms-reminders|*/5 * * * *|ENABLED"
  "mh-push-reminders|/api/cron/push-reminders|*/5 * * * *|PAUSED"
  "mh-push-reminders-24h|/api/cron/push-reminders-24h|13,43 * * * *|PAUSED"
  "mh-cleanup-pending-deposits|/api/cron/cleanup-pending-deposits|*/15 * * * *|ENABLED"
  "mh-cleanup-temporary-access|/api/cron/cleanup-temporary-access|7 * * * *|ENABLED"
)
# mh-push-reminders i mh-push-reminders-24h: PAUSED, dopóki moduł
# pushNotifications ma `hardOff` w src/lib/features.ts (crony i tak nic nie
# wysyłają). Tryb domyślny wymusza PAUSED, --resume odrzuca je przed gcloud.
# Po odmrożeniu modułu: zmiana stanu w tabeli na ENABLED (strażnik:
# __tests__/lib/scheduler-config.test.ts, zadania tras zamrożonych modułów).
# Zadań mh-notify-* (birthday, low-stock, we-miss-you) NIE tworzymy:
# trasy /api/notifications/* działają na jeden salon (wymagają salonId) i nic
# nie zrobią z harmonogramu. Wracają z R3-C razem z systemową trasą po
# wszystkich salonach. Tabela może zawierać stan PAUSED dla przyszłych zadań.

# Walidacja --resume przed pierwszym gcloud: każda nazwa w tabeli i ENABLED.
if [[ "$MODE" == "resume" ]]; then
  for want in "${RESUME_NAMES[@]}"; do
    found=""
    for entry in "${JOBS[@]}"; do
      IFS='|' read -r name _ _ state <<<"$entry"
      [[ "$name" == "$want" ]] && found="$state"
    done
    if [[ -z "$found" ]]; then
      echo "error: --resume: unknown job [$want]" >&2
      exit 2
    fi
    if [[ "$found" != "ENABLED" ]]; then
      echo "error: --resume: job [$want] is PAUSED in the table — not resumable" >&2
      exit 2
    fi
  done
fi

GC=(gcloud --project="$PROJECT_ID" --quiet)

# Token CRON_SECRET: odczyt RAZ, przed pierwszą zmianą w Scheduler (tylko tryb
# domyślny). Domyślny format `secrets versions access` nie trafia do logu
# gcloud — bez własnego --format. Błąd odczytu, pusty token albo znaki spoza
# bezpiecznego zbioru (nagłówek w YAML) → stop bez wypisywania wartości.
TOKEN=""
if [[ "$MODE" == "apply" ]]; then
  if ! TOKEN="$("${GC[@]}" secrets versions access latest --secret="$SECRET_NAME")"; then
    echo "error: cannot read secret $SECRET_NAME — stop, nothing changed" >&2
    exit 1
  fi
  if [[ -z "$TOKEN" ]]; then
    echo "error: secret $SECRET_NAME is empty — stop, nothing changed" >&2
    exit 1
  fi
  if ! [[ "$TOKEN" =~ ^[A-Za-z0-9._~+/=-]+$ ]]; then
    TOKEN=""
    echo "error: secret $SECRET_NAME has characters outside [A-Za-z0-9._~+/=-] — stop, nothing changed" >&2
    exit 1
  fi
fi

# Plik flag z nagłówkiem autoryzacji, czytany przez gcloud ze strumienia.
# Wartość sekretu nie pojawia się w argumentach procesu ani na wyjściu.
# $1 = create | update: nazwa flagi nagłówka powstaje tylko tutaj, w pliku flag.
auth_flags() {
  local flag="headers"
  [[ "$1" == "update" ]] && flag="update-headers"
  printf '%s:\n  Authorization: "Bearer %s"\n' "--$flag" "$TOKEN"
}

# Zmiany zadania (create/update/pause/resume) przez gc_mutate: Scheduler
# odrzuca szybkie serie zmian tego samego zadania kodem ABORTED („sync mutate
# calls cannot be queued”, potwierdzone pomiarem). Tylko ten kod jest ponawiany,
# z rosnącym odstępem (RETRY_DELAYS, łącznie ok. 3 min); po wyczerpaniu prób
# i przy każdym innym błędzie → kod 1 z nazwą zadania. Plik flag z nagłówkiem
# ($2 = create | update; "-" = bez nagłówka) jest tworzony od nowa przy każdej próbie (strumień czyta się
# raz). stdout polecenia odrzucany (i tak --format=none / format none); ze
# stderr na wyjście trafiają tylko linie bez nagłówka autoryzacji.
RETRY_DELAYS=(10 20 40 60 60)
gc_mutate() {
  local name="$1" flags="$2" err attempt=0
  shift 2
  while :; do
    if [[ "$flags" == "-" ]]; then
      err="$("${GC[@]}" "$@" 2>&1 >/dev/null)" && return 0
    else
      err="$("${GC[@]}" "$@" --flags-file=<(auth_flags "$flags") 2>&1 >/dev/null)" && return 0
    fi
    if [[ "$err" != *ABORTED* ]]; then
      # Bez linii z nagłówkiem i bez linii z samą wartością tokenu (D-8: gcloud
      # może zacytować wartość bez słów nagłówka). Pusty TOKEN (tryb bez
      # odczytu sekretu) → grep -vF "" odrzuciłby wszystko, więc wtedy bez filtra.
      printf '%s\n' "$err" | grep -viE 'authorization|bearer' \
        | { if [[ -n "$TOKEN" ]]; then grep -vF -- "$TOKEN"; else cat; fi; } >&2 || true
      echo "error: $1 $2 $3 failed for $name — stop" >&2
      exit 1
    fi
    if (( attempt >= ${#RETRY_DELAYS[@]} )); then
      echo "error: $name: Scheduler still rejects changes (ABORTED) after ${#RETRY_DELAYS[@]} retries — stop; rerun later" >&2
      exit 1
    fi
    echo "retry: $name: ABORTED (concurrent change), waiting ${RETRY_DELAYS[$attempt]}s" >&2
    sleep "${RETRY_DELAYS[$attempt]}"
    attempt=$((attempt + 1))
  done
}

job_exists() {
  "${GC[@]}" scheduler jobs describe "$1" --location="$REGION" --format='value(name)' >/dev/null 2>&1
}

# Stan zawsze wielkimi literami. gcloud dla `secrets versions list` wypisuje w
# `value(state)` stan małymi literami (`enabled`, przebieg 44817913061), mimo że
# API zwraca enum `ENABLED`. Czy Scheduler w value() też zmienia wielkość
# liter — nie sprawdzone; porównanie bez względu na wielkość liter jest
# bezpieczne w obu wariantach. Kod wyjścia gcloud zostaje (pipefail), wywołujący go nie zmieniają.
job_state() {
  "${GC[@]}" scheduler jobs describe "$1" --location="$REGION" --format='value(state)' |
    tr '[:lower:]' '[:upper:]'
}

job_schedule() {
  "${GC[@]}" scheduler jobs describe "$1" --location="$REGION" --format='value(schedule)'
}

# Pauza tylko ze stanu ENABLED (API: pause na PAUSED = FAILED_PRECONDITION).
pause_if_enabled() {
  local name="$1" got
  got="$(job_state "$name" || true)"
  if [[ "$got" == "ENABLED" ]]; then
    gc_mutate "$name" - scheduler jobs pause "$name" --location="$REGION"
  fi
  require_state "$name" PAUSED
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
    # Metoda i stan to enumy — wielkie litery jak w job_state; harmonogram,
    # strefa i adres zostają bez zmian (w nich wielkość liter ma znaczenie).
    actual="$("${GC[@]}" scheduler jobs describe "$name" --location="$REGION" \
      --format='value(schedule,timeZone,httpTarget.uri,httpTarget.httpMethod,state)' |
      awk -F'\t' 'BEGIN { OFS = "\t" } NF >= 5 { $4 = toupper($4); $5 = toupper($5) } { print }')"
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
    selected=0
    for want in "${RESUME_NAMES[@]}"; do [[ "$want" == "$name" ]] && selected=1; done
    if [[ "$selected" == 0 ]]; then
      continue
    fi
    if ! job_exists "$name"; then
      echo "error: $name missing — run without flags first" >&2
      exit 1
    fi
    # Wznowienie tylko ze stanu PAUSED (API: resume na ENABLED = FAILED_PRECONDITION).
    got="$(job_state "$name" || true)"
    if [[ "$got" == "PAUSED" ]]; then
      gc_mutate "$name" - scheduler jobs resume "$name" --location="$REGION"
      require_state "$name" ENABLED
      echo "resumed $name"
    elif [[ "$got" == "ENABLED" ]]; then
      echo "already $name (ENABLED)"
    else
      echo "error: $name state is [$got], cannot resume — stop" >&2
      exit 1
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
    # Istniejące zadanie: stan bez zmian, poza wymuszeniem PAUSED z tabeli
    # i zadaniem z harmonogramem zaparkowanym (przerwany przebieg między create
    # a pause) — to traktujemy jak nowe: najpierw pauza (#137).
    # Odczyt harmonogramu obowiązkowy: błąd albo pusty wynik → stop (kod 1)
    # BEZ aktualizacji — inaczej zaparkowane zadanie ENABLED dostałoby
    # prawdziwy harmonogram bez pauzy (#137 @ b4bf4d0).
    if ! current_schedule="$(job_schedule "$name")" || [[ -z "$current_schedule" ]]; then
      echo "error: cannot read schedule of $name — stop, job not updated" >&2
      exit 1
    fi
    if [[ "$state" == "PAUSED" || "$current_schedule" == "$PARKED_SCHEDULE" ]]; then
      pause_if_enabled "$name"
    fi
    gc_mutate "$name" update scheduler jobs update http "$name" "${common[@]}" \
      --schedule="$schedule" --format=none
    echo "updated $name"
  else
    gc_mutate "$name" create scheduler jobs create http "$name" "${common[@]}" \
      --schedule="$PARKED_SCHEDULE" --format=none
    pause_if_enabled "$name"
    gc_mutate "$name" - scheduler jobs update http "$name" --location="$REGION" --schedule="$schedule" --format=none
    require_state "$name" PAUSED
    echo "created $name (PAUSED)"
  fi
done

exit "$drift"
