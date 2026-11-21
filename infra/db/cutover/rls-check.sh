#!/usr/bin/env bash
# Kontrola izolacji salonów (RLS) na Cloud SQL po przeniesieniu danych
# (przełączenie Vercel → GCP). Procedura: docs/runbook-krok-d.md (sekcja
# przełączenia, dopisywana w kolejnym kroku).
#
# KTO URUCHAMIA: wyłącznie właściciel we własnym terminalu. Na ekranie są tylko
# wiersze `klucz=wartość` z funkcji emit: liczby, yes/no albo stała klasa błędu.
# Wszystko inne (stdout i stderr psql) idzie do pliku
# $HOME/secure/cutover-rls-check-<UTC>-<pid>.log. Ostatni wiersz na ekranie to
# zawsze `exit=<kod>`.
#
# Połączenie: wyłącznie zmienne libpq w środowisku tego jednego procesu
# (PGHOST=127.0.0.1 przez lokalne proxy, PGPORT, PGDATABASE, PGUSER, PGPASSWORD,
# PGSSLMODE), rola właściciela bazy. Bez PGHOSTADDR i PGSERVICE, bez .pgpass
# (PGPASSFILE=/dev/null), bez PGOPTIONS. Host inny niż 127.0.0.1 → kod 2 bez
# połączenia.
#
# Jedno wywołanie psql, jedna transakcja READ ONLY (nic nie zapisuje):
#   salon_context_empty      kontekst salonu (app.current_salon_id) pusty
#   SET ROLE myhelper_app, row_security = on, bez kontekstu salonu:
#   app_role_active          current_user = myhelper_app
#   app_visible_clients      count(*) z clients      (oczekiwane 0: fail-closed)
#   app_visible_appointments count(*) z appointments (oczekiwane 0)
#   app_visible_salons       count(*) z salons       (oczekiwane 0)
#   RESET ROLE:
#   app_role_reset           current_user = session_user
#   app_rolcanlogin, app_rolbypassrls, app_rolsuper   atrybuty myhelper_app
#                            w pg_roles (oczekiwane no, no, no)
#   Na końcu rls_fail_closed=yes/no.
# Brak roli, brak uprawnienia SET ROLE albo SELECT = błąd (error_class=other,
# kod 1), nigdy ciche 0.
# --dry-run: bez połączenia; dry_run=yes i steps=1.
#
# Kody wyjścia: 0 OK; 1 błąd bazy (przed nim error_class=…); 2 argumenty albo
# środowisko; 3 wiersz niezgodny ze wzorcem emit (rejected_line=1);
# 7 rls_fail_closed=no (którakolwiek wartość inna niż oczekiwana).
#
# Strażnik: __tests__/lib/cutover-copy-config.test.ts.
# Test na prawdziwym Postgresie (CI): __tests__/pg/cutover-copy.pg.test.ts.
set +x
set -euo pipefail
umask 077

mkdir -p -m 700 "$HOME/secure"
BASE="$HOME/secure/cutover-rls-check-$(date -u +%Y%m%dT%H%M%SZ)-$$"
LOG="$BASE.log"
ERRF="$BASE.stderr"
exec 3>&1 1>>"$LOG" 2>&1

EMIT_RE='^[a-z0-9_]+=([0-9]+|[0-9a-f]{32}|[0-9a-f]{64}|yes|no|unique_violation|fk_violation|exclusion_violation|read_only|circular_fk|connection|other)$'

emit() {
  local line="$1=$2"
  if [[ "$line" =~ $EMIT_RE ]]; then
    printf '%s\n' "$line" >&3
  else
    printf '%s\n' "rejected_line=1" >&3
    exit 3
  fi
}

trap 'rc=$?; rm -f "$ERRF"; emit exit "$rc"' EXIT
trap 'exit 130' INT TERM HUP

DRY_RUN=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    *) exit 2 ;;
  esac
  shift
done

# --- połączenie: tylko zmienne libpq, wyłącznie lokalne proxy -----------------
unset PGOPTIONS
export PGPASSFILE=/dev/null
[[ -z "${PGHOSTADDR:-}" && -z "${PGSERVICE:-}" ]] || exit 2
[[ -n "${PGHOST:-}" && -n "${PGDATABASE:-}" && -n "${PGUSER:-}" ]] || exit 2
[[ "$PGHOST" == "127.0.0.1" ]] || exit 2
[[ "$PGDATABASE" =~ ^[A-Za-z0-9_.-]+$ ]] || exit 2
[[ -z "${PGPORT:-}" || "$PGPORT" =~ ^[0-9]+$ ]] || exit 2

if [[ "$DRY_RUN" == 1 ]]; then
  emit dry_run yes
  emit steps 1
  exit 0
fi

# --- klasa błędu z logu psql (sam log zostaje w pliku) -------------------------
ERROR_CLASS="other"
classify() {
  local rc="$1" state
  ERROR_CLASS="other"
  if [[ "$rc" == 2 ]] ||
    grep -qE 'connection to server|could not connect|password authentication failed|no password supplied|could not translate host name' "$ERRF"; then
    ERROR_CLASS="connection"
    return 0
  fi
  state="$(grep -oE '(ERROR|FATAL): +[0-9A-Z]{5}' "$ERRF" | awk 'NR == 1 {print $NF}')" || state=""
  case "$state" in
    25006) ERROR_CLASS="read_only" ;;
    08* | 28* | 57P0[1-3]) ERROR_CLASS="connection" ;;
    *) ERROR_CLASS="other" ;;
  esac
}

# Jedyne wywołanie psql. SQL ze stdin, wynik do SQL_OUT (nigdy wprost na ekran).
SQL_OUT=""
rc=0
SQL_OUT="$(psql -X -q -A -t -w -v ON_ERROR_STOP=1 -v VERBOSITY=sqlstate -f - 2>"$ERRF" <<'SQL'
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT 'salon_context_empty=' || CASE WHEN coalesce(current_setting('app.current_salon_id', true), '') = '' THEN 'yes' ELSE 'no' END;
SET ROLE myhelper_app;
SET LOCAL row_security = on;
SELECT 'app_role_active=' || CASE WHEN current_user = 'myhelper_app' THEN 'yes' ELSE 'no' END;
SELECT 'app_visible_clients=' || count(*) FROM public.clients;
SELECT 'app_visible_appointments=' || count(*) FROM public.appointments;
SELECT 'app_visible_salons=' || count(*) FROM public.salons;
RESET ROLE;
SELECT 'app_role_reset=' || CASE WHEN current_user = session_user THEN 'yes' ELSE 'no' END;
SELECT 'app_rolcanlogin=' || CASE WHEN rolcanlogin THEN 'yes' ELSE 'no' END
  || E'\n' || 'app_rolbypassrls=' || CASE WHEN rolbypassrls THEN 'yes' ELSE 'no' END
  || E'\n' || 'app_rolsuper=' || CASE WHEN rolsuper THEN 'yes' ELSE 'no' END
  FROM pg_roles WHERE rolname = 'myhelper_app';
COMMIT;
SQL
)" || rc=$?
cat "$ERRF"
if [[ "$rc" != 0 ]]; then
  classify "$rc"
  emit error_class "$ERROR_CLASS"
  exit 1
fi

# Wynik = dokładnie te klucze w tej kolejności; wartość liczba albo yes/no.
KEYS=(salon_context_empty app_role_active app_visible_clients app_visible_appointments
  app_visible_salons app_role_reset app_rolcanlogin app_rolbypassrls app_rolsuper)
EXPECTED=(yes yes 0 0 0 yes no no no)
VALUES=()
i=0
while IFS= read -r line; do
  if ((i >= ${#KEYS[@]})) || [[ ! "$line" =~ ^${KEYS[$i]}=([0-9]+|yes|no)$ ]]; then
    emit rejected_line 1
    exit 3
  fi
  VALUES+=("${line#*=}")
  i=$((i + 1))
done <<<"$SQL_OUT"
if ((i != ${#KEYS[@]})); then
  emit rejected_line 1
  exit 3
fi

OK="yes"
for i in "${!KEYS[@]}"; do
  emit "${KEYS[$i]}" "${VALUES[$i]}"
  [[ "${VALUES[$i]}" == "${EXPECTED[$i]}" ]] || OK="no"
done
emit rls_fail_closed "$OK"
[[ "$OK" == "yes" ]] || exit 7
exit 0
