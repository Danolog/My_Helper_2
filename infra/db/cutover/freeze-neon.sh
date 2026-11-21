#!/usr/bin/env bash
# Zamrożenie bazy źródłowej przed przeniesieniem danych (przełączenie Vercel → GCP).
# Lustro: unfreeze-neon.sh. Procedura: docs/runbook-krok-d.md (sekcja przełączenia,
# dopisywana w kolejnym kroku).
#
# KTO URUCHAMIA: wyłącznie właściciel we własnym terminalu. Na ekranie są tylko
# wiersze `klucz=wartość` z funkcji emit: liczby, yes/no albo stała klasa błędu.
# Wszystko inne (stdout i stderr psql) idzie do pliku
# $HOME/secure/cutover-freeze-<UTC>-<pid>.log. Ostatni wiersz na ekranie to
# zawsze `exit=<kod>`.
#
# Dwa adresy, oba wyłącznie ze zmiennych środowiska tego procesu (nigdy argument,
# nigdy URL):
#   PG*         adres BEZ poolera, rola właściciela bazy (PGHOST, PGPORT,
#               PGDATABASE, PGUSER, PGPASSWORD, PGSSLMODE): ALTER DATABASE i zrywanie;
#   VERIFY_PG*  adres aplikacji — ta sama rola logowania i ten sam pooler co
#               produkcja (VERIFY_PGHOST, VERIFY_PGPORT, VERIFY_PGDATABASE,
#               VERIFY_PGUSER, VERIFY_PGPASSWORD, VERIFY_PGSSLMODE): test zapisu
#               na NOWYM połączeniu. VERIFY_PGDATABASE musi być równe PGDATABASE.
# Dla obu: jeden host, bez PGHOSTADDR/PGSERVICE, bez .pgpass (PGPASSFILE=/dev/null),
# bez PGOPTIONS; host spoza 127.0.0.1/localhost wymaga verify-full. Zdalny PGHOST
# nie może być poolerem (`<endpoint>-pooler.`), zdalny VERIFY_PGHOST musi nim być.
# Ten sam endpoint: gdy którykolwiek host jest spoza 127.0.0.1/localhost,
# VERIFY_PGHOST bez `-pooler.` musi być równe PGHOST
# (`ep-x-1-pooler.<region>…` ↔ `ep-x-1.<region>…`), inaczej kod 2 bez połączenia.
# Zmienne VERIFY_* trafiają tylko do wywołań testu zapisu (jako PG*), a do
# wywołań administracyjnych nie trafiają wcale.
#
# Kroki (każdy osobnym wywołaniem psql, czyli osobnym połączeniem):
#   1. role_override = liczba ustawień default_transaction_read_only na poziomie
#      roli (ALTER ROLE … SET, także … IN DATABASE tej bazy) — mają pierwszeństwo
#      przed ustawieniem bazy. ≠ 0 → stop (kod 7), baza bez zmian.
#   2. Widoczność: rola administracyjna bez pg_read_all_stats albo jakakolwiek
#      niewidoczna sesja tej bazy (backend_type NULL) = błąd 42501
#      (error_class=other, kod 1), baza bez zmian — nigdy ciche backends_before=0.
#      Widoczność pełna → stats_visible=1.
#   3. ALTER DATABASE … SET default_transaction_read_only = on i zerwanie
#      PO BAZIE, nie po roli: każdy client backend tej bazy poza własnym, z
#      wyjątkiem backendów superużytkownika (rola właściciela nie może ich zerwać;
#      u dostawcy to jego procesy). pg_terminate_backend czeka do 5 s na koniec
#      procesu. backends_before, terminated, login_roles (liczba różnych ról
#      wśród zerwanych, bez nazw), skipped_superuser. Brak uprawnienia do
#      zerwania = błąd 42501 (error_class=other, kod 1);
#      terminated < backends_before → stop (kod 8).
#   4. nowe połączenie VERIFY_PG*: ta sama baza i default_transaction_read_only
#      = on, inaczej frozen=no (kod 9);
#   5. nowe połączenie VERIFY_PG*: BEGIN; CREATE TEMP TABLE …; ROLLBACK; musi
#      skończyć się błędem 25006 (read_only). Zapis udany → frozen=no (kod 9).
#   Na końcu pooler=yes/no (czy VERIFY_PGHOST to pooler) i frozen=yes.
# --dry-run: bez połączenia; dry_run=yes i steps=5.
#
# Kody wyjścia: 0 OK; 1 błąd bazy (przed nim error_class=…); 2 argumenty albo
# środowisko; 3 wiersz niezgodny ze wzorcem emit (rejected_line=1);
# 7 role_override ≠ 0; 8 terminated < backends_before; 9 test zapisu niezgodny.
#
# Stan bazy po kodzie ≠ 0:
#   - kod 1, 2, 3 albo 7 BEZ wiersza stats_visible=1: baza bez zmian;
#   - kod 1 albo 3 PO wierszu stats_visible=1, bez backends_before: ALTER DATABASE
#     mógł przejść — baza może być JUŻ zamrożona, a sesje sprzed niej mogą żyć
#     (np. 42501 przy zrywaniu); sprawdzić ustawienie bazy przed decyzją;
#   - kod 8: baza JUŻ zamrożona (ALTER przeszedł), część sesji sprzed zamrożenia
#     żyje (terminated < backends_before);
#   - kod 1 albo 9 po backends_before: baza zamrożona, test na adresie aplikacji
#     nie potwierdził zamrożenia.
#
# Strażnik: __tests__/lib/cutover-freeze-config.test.ts.
# Test na prawdziwym Postgresie (CI): __tests__/pg/cutover-freeze.pg.test.ts.
set +x
set -euo pipefail
umask 077

mkdir -p -m 700 "$HOME/secure"
BASE="$HOME/secure/cutover-freeze-$(date -u +%Y%m%dT%H%M%SZ)-$$"
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

# --- połączenia: tylko zmienne libpq, jeden host na adres --------------------
unset PGOPTIONS
export PGPASSFILE=/dev/null
[[ -z "${PGHOSTADDR:-}" && -z "${PGSERVICE:-}" ]] || exit 2
[[ -z "${VERIFY_PGHOSTADDR:-}" && -z "${VERIFY_PGSERVICE:-}" ]] || exit 2

is_local() {
  [[ "$1" == "127.0.0.1" || "$1" == "localhost" ]]
}

is_pooler() {
  [[ "$1" =~ ^[A-Za-z0-9-]+-pooler\. ]]
}

check_target() {
  local host="$1" db="$2" user="$3" port="$4" sslmode="$5"
  [[ -n "$host" && -n "$db" && -n "$user" ]] || exit 2
  [[ "$host" =~ ^[A-Za-z0-9.-]+$ ]] || exit 2
  [[ "$db" =~ ^[A-Za-z0-9_.-]+$ ]] || exit 2
  [[ -z "$port" || "$port" =~ ^[0-9]+$ ]] || exit 2
  if ! is_local "$host"; then
    [[ "$sslmode" == "verify-full" ]] || exit 2
  fi
}

check_target "${PGHOST:-}" "${PGDATABASE:-}" "${PGUSER:-}" "${PGPORT:-}" "${PGSSLMODE:-}"
check_target "${VERIFY_PGHOST:-}" "${VERIFY_PGDATABASE:-}" "${VERIFY_PGUSER:-}" "${VERIFY_PGPORT:-}" "${VERIFY_PGSSLMODE:-}"
[[ "$VERIFY_PGDATABASE" == "$PGDATABASE" ]] || exit 2
if is_pooler "$PGHOST"; then
  exit 2
fi
POOLER="no"
if is_pooler "$VERIFY_PGHOST"; then
  POOLER="yes"
elif ! is_local "$VERIFY_PGHOST"; then
  exit 2
fi
# Ten sam compute: adres aplikacji to adres administracyjny albo jego wariant
# `-pooler.` (inaczej freeze mógłby zamrozić inny endpoint niż sprawdzany).
if ! is_local "$PGHOST" || ! is_local "$VERIFY_PGHOST"; then
  [[ "${VERIFY_PGHOST/-pooler./.}" == "$PGHOST" ]] || exit 2
fi

if [[ "$DRY_RUN" == 1 ]]; then
  emit dry_run yes
  emit steps 5
  exit 0
fi

# --- klasa błędu z logu psql (sam log zostaje w pliku) -------------------------
ERROR_CLASS="other"
classify() {
  local tool="$1" rc="$2" state
  ERROR_CLASS="other"
  if [[ "$tool" == "psql" && "$rc" == 2 ]] ||
    grep -qE 'connection to server|could not connect|password authentication failed|no password supplied|could not translate host name' "$ERRF"; then
    ERROR_CLASS="connection"
    return 0
  fi
  state="$(grep -oE '(ERROR|FATAL): +[0-9A-Z]{5}' "$ERRF" | head -n 1 | awk '{print $NF}')" || state=""
  case "$state" in
    23505) ERROR_CLASS="unique_violation" ;;
    23503) ERROR_CLASS="fk_violation" ;;
    23P01) ERROR_CLASS="exclusion_violation" ;;
    25006) ERROR_CLASS="read_only" ;;
    08* | 28* | 57P0[1-3]) ERROR_CLASS="connection" ;;
    *) ERROR_CLASS="other" ;;
  esac
}

fail_db() {
  classify "$1" "$2"
  emit error_class "$ERROR_CLASS"
  exit 1
}

# Adres dla jednego wywołania psql. Działa w podpowłoce podstawienia polecenia,
# więc nic nie zostaje w środowisku skryptu; zmienne VERIFY_* nigdy nie trafiają
# do procesu psql.
use_target() {
  if [[ "$1" == "verify" ]]; then
    export PGHOST="$VERIFY_PGHOST" PGDATABASE="$VERIFY_PGDATABASE" PGUSER="$VERIFY_PGUSER"
    if [[ -n "${VERIFY_PGPASSWORD:-}" ]]; then export PGPASSWORD="$VERIFY_PGPASSWORD"; else unset PGPASSWORD; fi
    if [[ -n "${VERIFY_PGPORT:-}" ]]; then export PGPORT="$VERIFY_PGPORT"; else unset PGPORT; fi
    if [[ -n "${VERIFY_PGSSLMODE:-}" ]]; then export PGSSLMODE="$VERIFY_PGSSLMODE"; else unset PGSSLMODE; fi
  fi
  unset VERIFY_PGHOST VERIFY_PGPORT VERIFY_PGDATABASE VERIFY_PGUSER VERIFY_PGPASSWORD VERIFY_PGSSLMODE
}

# Jedyne wywołanie psql. SQL ze stdin, wynik do SQL_OUT (nigdy wprost na ekran),
# kod do SQL_RC (oceniany przez wywołującego).
SQL_OUT=""
SQL_RC=0
run_sql() {
  local target="$1"
  shift
  SQL_RC=0
  SQL_OUT="$(use_target "$target"; psql -X -q -A -t -w -v ON_ERROR_STOP=1 -v VERBOSITY=sqlstate "$@" -f - 2>"$ERRF")" || SQL_RC=$?
  cat "$ERRF"
}

# Wynik = dokładnie podane klucze w podanej kolejności, każdy z liczbą.
NUMS=()
read_nums() {
  local expected=("$@") i=0 line
  NUMS=()
  while IFS= read -r line; do
    if ((i >= ${#expected[@]})) || [[ ! "$line" =~ ^${expected[$i]}=[0-9]+$ ]]; then
      emit rejected_line 1
      exit 3
    fi
    NUMS+=("${line#*=}")
    i=$((i + 1))
  done <<<"$SQL_OUT"
  if ((i != ${#expected[@]})); then
    emit rejected_line 1
    exit 3
  fi
}

# --- 1. nadpisania na poziomie roli ----------------------------------------------
run_sql admin <<'SQL'
SELECT 'role_override=' || count(*)
  FROM pg_db_role_setting
  WHERE setrole <> 0
    AND setdatabase IN (0, (SELECT oid FROM pg_database WHERE datname = current_database()))
    AND array_to_string(setconfig, ',') LIKE '%default_transaction_read_only%';
SQL
[[ "$SQL_RC" == 0 ]] || fail_db psql "$SQL_RC"
read_nums role_override
emit role_override "${NUMS[0]}"
[[ "${NUMS[0]}" == 0 ]] || exit 7

# --- 2. widoczność pg_stat_activity (przed jakąkolwiek zmianą) -------------------
# Bez pg_read_all_stats pg_stat_activity pokazuje cudze sesje z backend_type
# NULL — filtr zrywania nie widziałby ich wcale i zgłosiłby backends_before=0.
# Brak uprawnienia albo choć jedna niewidoczna sesja tej bazy = błąd 42501
# (kod 1, baza bez zmian). Osobne wywołanie: każdy błąd PO wierszu
# stats_visible=1 oznacza, że ALTER DATABASE mógł już przejść.
run_sql admin <<'SQL'
DO $$
BEGIN
  IF NOT pg_has_role(current_user, 'pg_read_all_stats', 'USAGE')
     OR EXISTS (SELECT 1 FROM pg_stat_activity
                  WHERE backend_type IS NULL AND datname = current_database()) THEN
    RAISE EXCEPTION 'pg_stat_activity not fully visible (pg_read_all_stats required)'
      USING ERRCODE = '42501';
  END IF;
END
$$;
SELECT 'stats_visible=1';
SQL
[[ "$SQL_RC" == 0 ]] || fail_db psql "$SQL_RC"
read_nums stats_visible
if [[ "${NUMS[0]}" != 1 ]]; then
  emit rejected_line 1
  exit 3
fi
emit stats_visible "${NUMS[0]}"

# --- 3. ustawienie bazy i zerwanie po bazie --------------------------------------
# Ponowne uruchomienie na zamrożonej bazie: nowa sesja startuje tylko do odczytu,
# a ALTER DATABASE jest w takiej transakcji zabronione (25006) — sesja
# administracyjna wyłącza to u siebie (nie wpływa na inne sesje).
run_sql admin -v db="$PGDATABASE" <<'SQL'
SET default_transaction_read_only = off;
ALTER DATABASE :"db" SET default_transaction_read_only = on;
WITH target AS (
  SELECT pid, usesysid,
         EXISTS (SELECT 1 FROM pg_roles r WHERE r.oid = usesysid AND r.rolsuper) AS superuser
    FROM pg_stat_activity
    WHERE datname = current_database() AND pid <> pg_backend_pid()
      AND backend_type = 'client backend'
), terminated_backends AS (
  SELECT usesysid, pg_terminate_backend(pid, 5000) AS ok
    FROM target WHERE NOT superuser
)
SELECT 'backends_before=' || (SELECT count(*) FROM target WHERE NOT superuser)
  || E'\n' || 'terminated=' || (SELECT count(*) FROM terminated_backends WHERE ok)
  || E'\n' || 'login_roles=' || (SELECT count(DISTINCT usesysid) FROM terminated_backends WHERE ok)
  || E'\n' || 'skipped_superuser=' || (SELECT count(*) FROM target WHERE superuser);
SQL
[[ "$SQL_RC" == 0 ]] || fail_db psql "$SQL_RC"
read_nums backends_before terminated login_roles skipped_superuser
emit backends_before "${NUMS[0]}"
emit terminated "${NUMS[1]}"
emit login_roles "${NUMS[2]}"
emit skipped_superuser "${NUMS[3]}"
((NUMS[1] >= NUMS[0])) || exit 8
emit pooler "$POOLER"

# --- 4. nowe połączenie adresem aplikacji: ustawienie widoczne -------------------
run_sql verify -v db="$PGDATABASE" <<'SQL'
SELECT (current_database() = :'db')::text || ' ' || current_setting('default_transaction_read_only');
SQL
[[ "$SQL_RC" == 0 ]] || fail_db psql "$SQL_RC"
if [[ "$SQL_OUT" != "true on" ]]; then
  emit frozen no
  exit 9
fi

# --- 5. nowe połączenie adresem aplikacji: zapis odrzucony -----------------------
run_sql verify <<'SQL'
BEGIN;
CREATE TEMP TABLE cutover_write_probe (x int);
ROLLBACK;
SQL
if [[ "$SQL_RC" == 0 ]]; then
  emit frozen no
  exit 9
fi
classify psql "$SQL_RC"
[[ "$ERROR_CLASS" == "read_only" ]] || fail_db psql "$SQL_RC"
emit frozen yes
exit 0
