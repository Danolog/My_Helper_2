#!/usr/bin/env bash
# Przeniesienie danych bazy źródłowej do Cloud SQL (przełączenie Vercel → GCP).
# Procedura: docs/runbook-krok-d.md (sekcja przełączenia, dopisywana w kolejnym kroku).
#
# KTO URUCHAMIA: wyłącznie właściciel we własnym terminalu. Na ekranie są tylko
# wiersze `klucz=wartość` z funkcji emit: liczby, yes/no albo stała klasa błędu.
# Wszystko inne (stdout i stderr psql, pg_dump, pg_restore, komunikaty serwera
# z wartościami) idzie do pliku $HOME/secure/cutover-copy-<UTC>-<pid>.log.
# Ostatni wiersz na ekranie to zawsze `exit=<kod>`.
#
# Jeden strumień, BEZ PLIKU POŚREDNIEGO:
#   pg_dump --data-only --schema=public -Fc (bez danych auth_rate_limit, session,
#   verification) | pg_restore --data-only --single-transaction --exit-on-error
# Zrzut nie trafia na dysk: stdout pg_dump idzie wyłącznie do potoku (bez -f,
# bez przekierowania do pliku, bez tee, bez mktemp). Do plików trafia tylko
# stderr narzędzi (dołączany do logu i usuwany przy wyjściu). Cel bez
# --enable-row-security: rola objęta polityką dostaje błąd, nie mniej wierszy.
# Zawężenie do public omija drizzle.__drizzle_migrations (cel ma własne).
#
# Dwa adresy, oba wyłącznie ze zmiennych środowiska tego procesu (nigdy argument,
# nigdy URL):
#   PG*         źródło (PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD,
#               PGSSLMODE): tylko odczyt (psql READ ONLY, pg_dump);
#   TARGET_PG*  cel = Cloud SQL przez lokalne proxy (TARGET_PGHOST=127.0.0.1,
#               TARGET_PGPORT, TARGET_PGDATABASE, TARGET_PGUSER,
#               TARGET_PGPASSWORD, TARGET_PGSSLMODE): rola właściciela bazy celu.
# Dla obu: jeden host małymi literami, bez PGHOSTADDR/PGSERVICE, bez .pgpass
# (PGPASSFILE=/dev/null), bez PGOPTIONS. Źródło spoza 127.0.0.1/localhost wymaga
# PGSSLMODE=verify-full i nie może być poolerem (`<endpoint>-pooler.`: pg_dump
# potrzebuje sesji, nie transakcji poolera). Cel tylko 127.0.0.1. Ten sam host,
# port i baza po obu stronach = odmowa. Inaczej kod 2 bez połączenia.
# Zmienne TARGET_* trafiają tylko do wywołań celu (jako PG*), a do wywołań
# źródła nie trafiają wcale.
#
# Kroki:
#   1. cel (psql, READ ONLY, row_security = off): serwer bez ustawień neon.*
#      (inaczej kod 4) i target_nonempty_tables = liczba niepustych tabel
#      public; ≠ 0 → stop (kod 5), bez zrzutu.
#   2. źródło (psql, READ ONLY): fk_cycle_tables = liczba tabel public na cyklu
#      kluczy obcych (także odwołanie do samej siebie), bez trzech tabel
#      wykluczonych z danych. ≠ 0 → error_class=circular_fk, kod 1, bez zrzutu
#      (pg_restore bez --disable-triggers nie gwarantuje kolejności).
#   3. strumień; dump_exit i restore_exit (kody obu stron potoku). Którykolwiek
#      ≠ 0 → error_class=…, kod 1. Ostrzeżenie pg_dump o cyklu kluczy obcych
#      mimo kroku 2 → error_class=circular_fk, kod 1.
#   Na końcu copied=yes i copy_seconds.
# --dry-run: bez połączenia; dry_run=yes i steps=3.
#
# Kody wyjścia: 0 OK; 1 błąd bazy albo strumienia (przed nim error_class=…);
# 2 argumenty albo środowisko; 3 wiersz niezgodny ze wzorcem emit
# (rejected_line=1); 4 cel na serwerze z ustawieniami neon.*; 5 cel niepusty.
#
# Stan celu po kodzie ≠ 0:
#   - kod 1, 2, 3, 4 albo 5 bez wiersza dump_exit: cel bez zmian;
#   - kod 1 z restore_exit ≠ 0: transakcja pg_restore wycofana, cel bez danych
#     (pojedyncza transakcja; potwierdzenie: compare.sh --expect-empty);
#   - kod 1 z restore_exit=0 (padł tylko pg_dump po wysłaniu kompletnego
#     archiwum albo ostrzeżenie o cyklu): pg_restore zatwierdził dane — cel NIE
#     jest pusty; wycofanie = przywrócenie kopii sprzed importu.
#
# Strażnik: __tests__/lib/cutover-copy-config.test.ts.
# Test na prawdziwym Postgresie (CI): __tests__/pg/cutover-copy.pg.test.ts.
set +x
set -euo pipefail
umask 077

mkdir -p -m 700 "$HOME/secure"
BASE="$HOME/secure/cutover-copy-$(date -u +%Y%m%dT%H%M%SZ)-$$"
LOG="$BASE.log"
ERRF="$BASE.stderr"
DUMP_ERR="$BASE.stderr-pg-dump"
RESTORE_ERR="$BASE.stderr-pg-restore"
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

trap 'rc=$?; rm -f "$ERRF" "$DUMP_ERR" "$RESTORE_ERR"; emit exit "$rc"' EXIT
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
[[ -z "${TARGET_PGHOSTADDR:-}" && -z "${TARGET_PGSERVICE:-}" ]] || exit 2

is_local() {
  [[ "$1" == "127.0.0.1" || "$1" == "localhost" ]]
}

check_target() {
  local host="$1" db="$2" user="$3" port="$4"
  [[ -n "$host" && -n "$db" && -n "$user" ]] || exit 2
  # Tylko małe litery: wielkie omijałyby wykrywanie `-pooler.` (DNS ich nie rozróżnia).
  [[ "$host" =~ ^[a-z0-9.-]+$ ]] || exit 2
  [[ "$db" =~ ^[A-Za-z0-9_.-]+$ ]] || exit 2
  [[ -z "$port" || "$port" =~ ^[0-9]+$ ]] || exit 2
}

check_target "${PGHOST:-}" "${PGDATABASE:-}" "${PGUSER:-}" "${PGPORT:-}"
check_target "${TARGET_PGHOST:-}" "${TARGET_PGDATABASE:-}" "${TARGET_PGUSER:-}" "${TARGET_PGPORT:-}"
if ! is_local "$PGHOST"; then
  [[ "${PGSSLMODE:-}" == "verify-full" ]] || exit 2
  [[ ! "$PGHOST" =~ -pooler\. ]] || exit 2
fi
# Cel wyłącznie przez lokalne proxy.
[[ "$TARGET_PGHOST" == "127.0.0.1" ]] || exit 2
if [[ "$PGHOST" == "127.0.0.1" || "$PGHOST" == "localhost" ]] &&
  [[ "${PGPORT:-5432}" == "${TARGET_PGPORT:-5432}" && "$PGDATABASE" == "$TARGET_PGDATABASE" ]]; then
  exit 2
fi

if [[ "$DRY_RUN" == 1 ]]; then
  emit dry_run yes
  emit steps 3
  exit 0
fi

# --- klasa błędu z logu narzędzia (sam log zostaje w pliku) -------------------
ERROR_CLASS="other"
classify() {
  local tool="$1" rc="$2" state
  shift 2
  ERROR_CLASS="other"
  if [[ "$tool" == "psql" && "$rc" == 2 ]] ||
    grep -qE 'connection to server|could not connect|password authentication failed|no password supplied|could not translate host name' "$@"; then
    ERROR_CLASS="connection"
    return 0
  fi
  if [[ "$tool" == "psql" ]]; then
    state="$(grep -ohE '(ERROR|FATAL): +[0-9A-Z]{5}' "$@" | awk 'NR == 1 {print $NF}')" || state=""
    case "$state" in
      23505) ERROR_CLASS="unique_violation" ;;
      23503) ERROR_CLASS="fk_violation" ;;
      23P01) ERROR_CLASS="exclusion_violation" ;;
      25006) ERROR_CLASS="read_only" ;;
      08* | 28* | 57P0[1-3]) ERROR_CLASS="connection" ;;
      *) ERROR_CLASS="other" ;;
    esac
    return 0
  fi
  # pg_dump/pg_restore nie podają SQLSTATE: stała klasa z treści komunikatu.
  if grep -qE 'duplicate key value violates unique constraint' "$@"; then
    ERROR_CLASS="unique_violation"
  elif grep -qE 'violates foreign key constraint' "$@"; then
    ERROR_CLASS="fk_violation"
  elif grep -qE 'violates exclusion constraint' "$@"; then
    ERROR_CLASS="exclusion_violation"
  elif grep -qE 'read-only transaction' "$@"; then
    ERROR_CLASS="read_only"
  fi
}

fail_db() {
  classify "$@"
  emit error_class "$ERROR_CLASS"
  exit 1
}

# Adres dla jednego wywołania (podpowłoka): source = PG* bez zmian, target =
# TARGET_* jako PG*. Zmienne TARGET_* nigdy nie trafiają do procesu narzędzia.
use_addr() {
  if [[ "$1" == "target" ]]; then
    export PGHOST="$TARGET_PGHOST" PGDATABASE="$TARGET_PGDATABASE" PGUSER="$TARGET_PGUSER"
    if [[ -n "${TARGET_PGPASSWORD:-}" ]]; then export PGPASSWORD="$TARGET_PGPASSWORD"; else unset PGPASSWORD; fi
    if [[ -n "${TARGET_PGPORT:-}" ]]; then export PGPORT="$TARGET_PGPORT"; else unset PGPORT; fi
    if [[ -n "${TARGET_PGSSLMODE:-}" ]]; then export PGSSLMODE="$TARGET_PGSSLMODE"; else unset PGSSLMODE; fi
  fi
  unset TARGET_PGHOST TARGET_PGPORT TARGET_PGDATABASE TARGET_PGUSER TARGET_PGPASSWORD TARGET_PGSSLMODE
}

# Jedyne wywołanie psql. SQL ze stdin, wynik do SQL_OUT (nigdy wprost na ekran).
SQL_OUT=""
run_sql() {
  local addr="$1" rc=0
  shift
  SQL_OUT="$(use_addr "$addr"; psql -X -q -A -t -w -v ON_ERROR_STOP=1 -v VERBOSITY=sqlstate "$@" -f - 2>"$ERRF")" || rc=$?
  cat "$ERRF"
  [[ "$rc" == 0 ]] || fail_db psql "$rc" "$ERRF"
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

# --- 1. cel: tożsamość serwera i pustość ---------------------------------------
run_sql target <<'SQL'
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL row_security = off;
SELECT 'neon_settings=' || count(*) FROM pg_settings WHERE name LIKE 'neon.%';
SELECT 'SELECT ''target_nonempty_tables='' || (0' || coalesce(string_agg(format(' + (EXISTS (SELECT 1 FROM public.%I))::int', c.relname), '' ORDER BY c.relname COLLATE "C"), '') || ')'
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relispartition \gexec
COMMIT;
SQL
read_nums neon_settings target_nonempty_tables
[[ "${NUMS[0]}" == 0 ]] || exit 4
emit target_nonempty_tables "${NUMS[1]}"
[[ "${NUMS[1]}" == 0 ]] || exit 5

# --- 2. źródło: cykle kluczy obcych (pg_dump ostrzegłby dopiero w strumieniu) ---
run_sql source <<'SQL'
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
WITH RECURSIVE fk AS (
  SELECT DISTINCT c.conrelid AS src, c.confrelid AS dst
    FROM pg_constraint c
    JOIN pg_class s ON s.oid = c.conrelid
    JOIN pg_namespace sn ON sn.oid = s.relnamespace
    JOIN pg_class d ON d.oid = c.confrelid
    JOIN pg_namespace dn ON dn.oid = d.relnamespace
    WHERE c.contype = 'f' AND sn.nspname = 'public' AND dn.nspname = 'public'
      AND s.relname NOT IN ('auth_rate_limit', 'session', 'verification')
      AND d.relname NOT IN ('auth_rate_limit', 'session', 'verification')
), walk (start, cur, path) AS (
  SELECT src, dst, ARRAY[src] FROM fk
  UNION ALL
  SELECT w.start, f.dst, w.path || w.cur
    FROM walk w JOIN fk f ON f.src = w.cur
    WHERE w.cur <> w.start AND NOT w.cur = ANY (w.path)
)
SELECT 'fk_cycle_tables=' || count(DISTINCT start) FROM walk WHERE cur = start;
COMMIT;
SQL
read_nums fk_cycle_tables
emit fk_cycle_tables "${NUMS[0]}"
if [[ "${NUMS[0]}" != 0 ]]; then
  emit error_class circular_fk
  exit 1
fi

# --- 3. strumień źródło → cel, bez pliku pośredniego ----------------------------
# pipefail (głowica) + PIPESTATUS: kod każdej strony potoku osobno. Błąd po
# którejkolwiek stronie w trakcie = pg_restore kończy się błędem i wycofuje
# swoją jedyną transakcję.
set +e
(
  use_addr source
  pg_dump -w --data-only --schema=public -Fc --exclude-table-data=public.auth_rate_limit --exclude-table-data=public.session --exclude-table-data=public.verification 2>"$DUMP_ERR"
) | (
  use_addr target
  pg_restore -w --data-only --single-transaction --exit-on-error --dbname="$PGDATABASE" 2>"$RESTORE_ERR"
)
STREAM=("${PIPESTATUS[@]}")
set -e
cat "$DUMP_ERR" "$RESTORE_ERR"
emit dump_exit "${STREAM[0]}"
emit restore_exit "${STREAM[1]}"
if grep -qiE 'circular foreign-key' "$DUMP_ERR"; then
  emit error_class circular_fk
  exit 1
fi
if [[ "${STREAM[0]}" != 0 || "${STREAM[1]}" != 0 ]]; then
  fail_db stream 1 "$DUMP_ERR" "$RESTORE_ERR"
fi
emit copied yes
emit copy_seconds "$SECONDS"
exit 0
