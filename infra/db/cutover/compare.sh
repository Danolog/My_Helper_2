#!/usr/bin/env bash
# Porównanie bazy przed i po przeniesieniu danych (przełączenie Vercel → GCP).
# Procedura: docs/runbook-krok-d.md (sekcja przełączenia, dopisywana w kolejnym kroku).
#
# KTO URUCHAMIA: wyłącznie właściciel we własnym terminalu. Na ekranie są tylko
# wiersze `klucz=wartość` z funkcji emit: liczby, hashe md5/sha256, yes/no albo
# stała klasa błędu. Wszystko inne (stdout i stderr psql/pg_dump, komunikaty
# serwera z wartościami) idzie do pliku $HOME/secure/cutover-compare-<UTC>-<pid>.log.
# Ostatni wiersz na ekranie to zawsze `exit=<kod>`.
#
# Połączenie: wyłącznie zmienne libpq w środowisku tego jednego procesu
# (PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD, PGSSLMODE), nigdy argument.
# Jeden host, bez PGHOSTADDR i PGSERVICE, bez .pgpass (PGPASSFILE=/dev/null),
# bez PGOPTIONS. Host spoza 127.0.0.1/localhost wymaga PGSSLMODE=verify-full.
#
# Tryb domyślny (tylko odczyt), jedna transakcja REPEATABLE READ READ ONLY
# w jednym wywołaniu psql (jedna migawka, ustawienia SET LOCAL nie giną):
#   count_<tabela>       dokładne count(*) każdej tabeli public
#   rows_hash_<tabela>   md5 treści wierszy (posortowane po tekście wiersza,
#                        COLLATE "C"); bez session, verification, auth_rate_limit,
#                        chyba że --all-tables
#   last_value_<sekw.>   SELECT wprost z sekwencji public (0 = nieużyta;
#                        brak uprawnienia = błąd 42501, nie 0 — PG 18
#                        pg_sequence_last_value i pg_sequences dają wtedy NULL)
#   writes_<tabela>      n_tup_ins + n_tup_upd + n_tup_del (pomocnicze)
#   rls_<t>, force_rls_<t>, policies_<t>
#   grants_count, grants_sha256       role_table_grants dla myhelper_app
#   extensions_count, extensions_sha256
#   locale_sha256        datcollate, datctype i kodowanie bazy
# Oba bloki READ ONLY mają SET LOCAL row_security = off: rola, której dotyczą
# polityki RLS (nie-właściciel bez BYPASSRLS albo FORCE ROW LEVEL SECURITY),
# dostaje błąd 42501 (error_class=other, kod 1) zamiast przefiltrowanych,
# po obu stronach równych liczb i hashy.
#   migrations_count, migrations_sha256   drizzle.__drizzle_migrations
# Potem schemat: pg_dump --schema-only --schema=public --no-owner --no-privileges,
# normalizacja (bez komentarzy, SET, \restrict) do pliku .schema.sql obok logu:
#   schema_sha256, a z --schema-baseline=<plik .schema.sql z innej bazy>
#   także schema_equal=yes/no (diff obok logu). Na końcu compare_seconds.
#
# --expect-empty (tylko Cloud SQL przez proxy, PGHOST=127.0.0.1, inaczej kod 4):
#   jedyny zapis w skrypcie, czyszczenie public.auth_rate_limit (osobna
#   transakcja), potem w transakcji READ ONLY liczba niepustych tabel public
#   (migracje nie wstawiają wierszy, lista słownikowa jest pusta):
#   nonempty_tables=<n>, expect_empty=yes/no.
# --dry-run: bez połączenia; dry_run=yes i steps=<n>.
#
# Kody wyjścia: 0 OK; 1 błąd bazy (przed nim error_class=…); 2 argumenty albo
# środowisko; 3 wiersz niezgodny ze wzorcem emit (rejected_line=1);
# 4 --expect-empty na hoście innym niż 127.0.0.1 albo na serwerze Neon;
# 5 expect_empty=no; 6 schema_equal=no.
#
# Strażnik: __tests__/lib/cutover-compare-config.test.ts.
# Test na prawdziwym Postgresie (CI): __tests__/pg/cutover-compare.pg.test.ts.
set +x
set -euo pipefail
umask 077

mkdir -p -m 700 "$HOME/secure"
BASE="$HOME/secure/cutover-compare-$(date -u +%Y%m%dT%H%M%SZ)-$$"
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

MODE="compare"
ALL_TABLES="no"
DRY_RUN=0
SCHEMA_BASELINE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --expect-empty) MODE="expect_empty" ;;
    --all-tables) ALL_TABLES="yes" ;;
    --dry-run) DRY_RUN=1 ;;
    --schema-baseline=*) SCHEMA_BASELINE="${1#*=}" ;;
    *) exit 2 ;;
  esac
  shift
done

if [[ "$MODE" == "expect_empty" ]]; then
  [[ "$ALL_TABLES" == "no" && -z "$SCHEMA_BASELINE" ]] || exit 2
fi
if [[ -n "$SCHEMA_BASELINE" ]]; then
  [[ -f "$SCHEMA_BASELINE" ]] || exit 2
fi

# --- połączenie: tylko zmienne libpq, jeden host ------------------------------
unset PGOPTIONS
export PGPASSFILE=/dev/null
[[ -z "${PGHOSTADDR:-}" && -z "${PGSERVICE:-}" ]] || exit 2
[[ -n "${PGHOST:-}" && -n "${PGDATABASE:-}" && -n "${PGUSER:-}" ]] || exit 2
[[ "$PGHOST" =~ ^[A-Za-z0-9.-]+$ ]] || exit 2
[[ "$PGDATABASE" =~ ^[A-Za-z0-9_.-]+$ ]] || exit 2
[[ -z "${PGPORT:-}" || "$PGPORT" =~ ^[0-9]+$ ]] || exit 2
if [[ "$MODE" == "expect_empty" && "$PGHOST" != "127.0.0.1" ]]; then
  exit 4
fi
if [[ "$PGHOST" != "127.0.0.1" && "$PGHOST" != "localhost" ]]; then
  [[ "${PGSSLMODE:-}" == "verify-full" ]] || exit 2
fi

if [[ "$DRY_RUN" == 1 ]]; then
  emit dry_run yes
  if [[ "$MODE" == "expect_empty" ]]; then
    emit steps 3
  elif [[ -n "$SCHEMA_BASELINE" ]]; then
    emit steps 3
  else
    emit steps 2
  fi
  exit 0
fi

# --- klasa błędu z logu narzędzia (sam log zostaje w pliku) -------------------
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

# Jedyne wywołanie psql. SQL ze stdin, wynik do SQL_OUT (nigdy wprost na ekran).
SQL_OUT=""
run_sql() {
  local rc=0
  SQL_OUT="$(psql -X -q -A -t -w -v ON_ERROR_STOP=1 -v VERBOSITY=sqlstate "$@" -f - 2>"$ERRF")" || rc=$?
  cat "$ERRF"
  [[ "$rc" == 0 ]] || fail_db psql "$rc"
}

# Każdy wiersz wyniku przez emit (wzorzec odrzuca wszystko poza liczbą/hashem/yes/no).
emit_lines() {
  local line
  while IFS= read -r line; do
    emit "${line%%=*}" "${line#*=}"
  done <<<"$SQL_OUT"
}

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

# --- tryb domyślny -------------------------------------------------------------
compare_db() {
  run_sql -v all_tables="$ALL_TABLES" <<'SQL'
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL TimeZone = 'UTC';
SET LOCAL DateStyle = 'ISO, YMD';
SET LOCAL IntervalStyle = 'postgres';
SET LOCAL extra_float_digits = 1;
SET LOCAL bytea_output = 'hex';
SET LOCAL row_security = off;
SELECT format('SELECT %L || count(*) FROM public.%I', 'count_' || c.relname || '=', c.relname)
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relispartition
  ORDER BY c.relname COLLATE "C" \gexec
SELECT format('SELECT %L || md5(coalesce(string_agg(t::text, E''\n'' ORDER BY (t::text) COLLATE "C"), '''')) FROM public.%I t', 'rows_hash_' || c.relname || '=', c.relname)
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relispartition
    AND (:'all_tables' = 'yes' OR c.relname NOT IN ('auth_rate_limit', 'session', 'verification'))
  ORDER BY c.relname COLLATE "C" \gexec
SELECT format('SELECT %L || CASE WHEN is_called THEN last_value ELSE 0 END FROM public.%I',
              'last_value_' || sequencename || '=', sequencename)
  FROM pg_sequences WHERE schemaname = 'public' ORDER BY sequencename COLLATE "C" \gexec
SELECT 'writes_' || relname || '=' || (n_tup_ins + n_tup_upd + n_tup_del)
  FROM pg_stat_user_tables WHERE schemaname = 'public' ORDER BY relname COLLATE "C";
SELECT 'rls_' || c.relname || '=' || CASE WHEN c.relrowsecurity THEN 'yes' ELSE 'no' END
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relispartition
  ORDER BY c.relname COLLATE "C";
SELECT 'force_rls_' || c.relname || '=' || CASE WHEN c.relforcerowsecurity THEN 'yes' ELSE 'no' END
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relispartition
  ORDER BY c.relname COLLATE "C";
SELECT 'policies_' || c.relname || '=' || count(p.policyname)
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN pg_policies p ON p.schemaname = 'public' AND p.tablename = c.relname
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relispartition
  GROUP BY c.relname ORDER BY c.relname COLLATE "C";
SELECT 'grants_count=' || count(*)
  FROM information_schema.role_table_grants WHERE grantee = 'myhelper_app';
SELECT 'grants_sha256=' || encode(sha256(convert_to(coalesce(string_agg(table_name || ' ' || privilege_type, E'\n' ORDER BY table_name COLLATE "C", privilege_type COLLATE "C"), ''), 'UTF8')), 'hex')
  FROM information_schema.role_table_grants WHERE grantee = 'myhelper_app';
SELECT 'extensions_count=' || count(*) FROM pg_extension;
SELECT 'extensions_sha256=' || encode(sha256(convert_to(coalesce(string_agg(extname || ' ' || extversion, E'\n' ORDER BY extname COLLATE "C"), ''), 'UTF8')), 'hex')
  FROM pg_extension;
SELECT 'locale_sha256=' || encode(sha256(convert_to(datcollate || ' ' || datctype || ' ' || pg_encoding_to_char(encoding), 'UTF8')), 'hex')
  FROM pg_database WHERE datname = current_database();
SELECT 'migrations_count=' || count(*) FROM drizzle.__drizzle_migrations;
SELECT 'migrations_sha256=' || encode(sha256(convert_to(coalesce(string_agg(hash, E'\n' ORDER BY created_at, hash COLLATE "C"), ''), 'UTF8')), 'hex')
  FROM drizzle.__drizzle_migrations;
COMMIT;
SQL
  emit_lines

  local rc=0 schema_sha
  pg_dump -w --schema-only --schema=public --no-owner --no-privileges >"$BASE.schema.raw" 2>"$ERRF" || rc=$?
  cat "$ERRF"
  [[ "$rc" == 0 ]] || fail_db pg_dump "$rc"
  awk '/^--/ || /^SET / || /^SELECT pg_catalog\.set_config\(/ || /^\\(un)?restrict / || NF == 0 { next } { print }' \
    "$BASE.schema.raw" >"$BASE.schema.sql"
  rm -f "$BASE.schema.raw"
  schema_sha="$(sha256_of "$BASE.schema.sql")"
  emit schema_sha256 "$schema_sha"

  local schema_equal="yes"
  if [[ -n "$SCHEMA_BASELINE" ]]; then
    if diff -u "$SCHEMA_BASELINE" "$BASE.schema.sql" >"$BASE.schema.diff"; then
      emit schema_equal yes
    else
      schema_equal="no"
      emit schema_equal no
    fi
  fi
  emit compare_seconds "$SECONDS"
  [[ "$schema_equal" == "yes" ]] || exit 6
}

# --- --expect-empty (Cloud SQL przez proxy) -------------------------------------
expect_empty() {
  run_sql <<'SQL'
SELECT count(*) FROM pg_settings WHERE name LIKE 'neon.%';
SQL
  [[ "$SQL_OUT" == "0" ]] || exit 4

  run_sql <<'SQL'
BEGIN;
SET LOCAL lock_timeout = '5s';
TRUNCATE public.auth_rate_limit;
COMMIT;
SQL

  # Migracje (drizzle/*.sql) nie wstawiają wierszy, więc lista słownikowa jest
  # pusta: liczone są wszystkie tabele public. Test pg sprawdza, że świeża baza
  # po migracjach nie ma niepustych tabel.
  run_sql <<'SQL'
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL row_security = off;
SELECT 'SELECT ''nonempty_tables='' || (0' || coalesce(string_agg(format(' + (EXISTS (SELECT 1 FROM public.%I))::int', c.relname), '' ORDER BY c.relname COLLATE "C"), '') || ')'
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relispartition \gexec
COMMIT;
SQL
  local n="${SQL_OUT#nonempty_tables=}"
  if [[ "$SQL_OUT" != "nonempty_tables=$n" || ! "$n" =~ ^[0-9]+$ ]]; then
    emit rejected_line 1
    exit 3
  fi
  emit nonempty_tables "$n"
  if [[ "$n" == 0 ]]; then
    emit expect_empty yes
  else
    emit expect_empty no
    exit 5
  fi
}

if [[ "$MODE" == "expect_empty" ]]; then
  expect_empty
else
  compare_db
fi
exit 0
