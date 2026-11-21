#!/usr/bin/env bash
# Wycofanie przełączenia: przeniesienie danych z Cloud SQL z powrotem do bazy
# źródłowej (Neon). Lustro: copy-neon-to-cloudsql.sh (kopia w przód, bez zmian).
# Procedura: docs/runbook-krok-d.md (sekcja wycofania, dopisywana w kolejnym kroku).
#
# KTO URUCHAMIA: wyłącznie właściciel we własnym terminalu. Na ekranie są tylko
# wiersze `klucz=wartość` z funkcji emit: liczby, yes/no albo stała klasa błędu.
# Wszystko inne (stdout i stderr psql i pg_dump, komunikaty serwera z wartościami)
# idzie do pliku $HOME/secure/cutover-copy-reverse-<UTC>-<pid>.log.
# Ostatni wiersz na ekranie to zawsze `exit=<kod>`.
#
# Osobny skrypt, nie flaga kopii w przód: reguły hostów są tu odwrotne (źródło
# tylko 127.0.0.1, cel nigdy 127.0.0.1), więc zamiana zmiennych w którymkolwiek
# skrypcie kończy się kodem 2 bez połączenia. Cel jest zamrożony i pełny, więc
# zapis to jedna transakcja: czyszczenie tabel celu + import + bramka kompletności.
#
# Jeden strumień, BEZ PLIKU POŚREDNIEGO:
#   pg_dump --data-only --schema=public -Fp (bez danych auth_rate_limit, session,
#   verification) | psql -f sql/reverse-pre.sql -f - -f sql/reverse-post.sql
# Transakcję otwiera i zamyka SQL z repo (bez -1 / --single-transaction):
#   reverse-pre.sql   BEGIN READ WRITE (nadpisuje default_transaction_read_only
#                     zamrożonej bazy tylko dla tej jednej transakcji; inne sesje
#                     zostają tylko do odczytu), lock_timeout 10 s, row_security
#                     off, oczekiwane liczby źródła w ustawieniu transakcji, jedno
#                     czyszczenie WSZYSTKICH tabel public celu (RESTRICT);
#   strumień          dane źródła (zrzut ustawia pusty search_path);
#   reverse-post.sql  bramka kompletności: count(*) każdej tabeli i last_value
#                     każdej sekwencji public równe liczbom źródła, inaczej RAISE
#                     (ON_ERROR_STOP przerywa, połączenie zamyka się bez
#                     zatwierdzenia); COMMIT to ostatnia instrukcja pliku.
# Strumień ucięty na granicy wiersza albo tabeli nie przechodzi bramki.
# Wiersze stdout psql ze strumienia idą wyłącznie do logu i nie są parsowane.
#
# Dwa adresy, oba wyłącznie ze zmiennych środowiska tego procesu (nigdy argument,
# nigdy URL):
#   PG*         źródło = Cloud SQL przez lokalne proxy (PGHOST=127.0.0.1, PGPORT,
#               PGDATABASE, PGUSER, PGPASSWORD): tylko odczyt (psql READ ONLY,
#               pg_dump);
#   TARGET_PG*  cel = Neon (TARGET_PGHOST, TARGET_PGPORT, TARGET_PGDATABASE,
#               TARGET_PGUSER, TARGET_PGPASSWORD, TARGET_PGSSLMODE): rola
#               właściciela tabel (ta sama co adres administracyjny zamrożenia).
#               Inna rola dostaje błąd przy czyszczeniu — bezpieczny wynik.
# Dla obu: jeden host małymi literami, bez PGHOSTADDR/PGSERVICE, bez .pgpass
# (PGPASSFILE=/dev/null), bez PGOPTIONS. Źródło tylko 127.0.0.1. Cel: nie
# 127.0.0.1, nie pooler (`<endpoint>-pooler.`), spoza localhost tylko z
# TARGET_PGSSLMODE=verify-full (localhost wyłącznie dla testu CI; przed bazą
# lokalną chroni kontrola neon.* niżej). Ta sama baza po obu stronach
# (127.0.0.1 ≡ localhost, ten sam port i nazwa) = odmowa. Inaczej kod 2 bez
# połączenia. Zmienne TARGET_* trafiają tylko do wywołań celu (jako PG*).
#
# Kroki (każdy osobnym połączeniem; przed strumieniem żadnego zapisu):
#   1. źródło i cel (psql, READ ONLY): niepuste neon.timeline_id (źródło 0,
#      cel 1, inaczej kod 4), zamrożenie (ustawienie bazy default_transaction_read_only
#      =on i to samo w sesji), role_override (jak w freeze-neon.sh);
#      source_frozen=no → kod 6; source_/target_role_override ≠ 0 → kod 7;
#      target_frozen=no → kod 8.
#   2. źródło (psql, REPEATABLE READ READ ONLY): fk_cycle_tables ≠ 0 →
#      error_class=circular_fk, kod 1; source_nonempty_tables = 0 → kod 5
#      (puste źródło nie może wyzerować celu); oczekiwane liczby (nazwy tabel
#      i sekwencji z liczbami, bez danych; trzy tabele wykluczone = 0, sekwencje
#      należące do nich pominięte). Wynik spoza wzorca → rejected_line=1, kod 3.
#   3. cel (psql, READ ONLY): truncated_tables = liczba tabel public.
#   4. strumień; dump_exit i restore_exit (kody obu stron potoku). Którykolwiek
#      ≠ 0 → error_class=…, kod 1.
#   5. cel, nowe połączenie (READ ONLY): target_frozen_after=yes, inaczej kod 8.
#   Na końcu loaded=yes i copy_seconds.
# --dry-run: bez połączenia; dry_run=yes i steps=7.
#
# Kody wyjścia: 0 OK; 1 błąd bazy albo strumienia (przed nim error_class=…);
# 2 argumenty albo środowisko; 3 wiersz niezgodny ze wzorcem; 4 zły serwer
# (neon.* po złej stronie); 5 puste źródło; 6 źródło niezamrożone;
# 7 role_override ≠ 0; 8 cel niezamrożony (przed strumieniem albo po nim).
#
# Stan celu po kodzie ≠ 0:
#   - każdy kod bez wiersza restore_exit=0: cel bez zmian (przed strumieniem nie
#     ma zapisu, a w strumieniu jest jedna transakcja bez zatwierdzenia);
#   - kod 1 z restore_exit=0 (padł tylko pg_dump po przejściu bramki) albo kod 8
#     po restore_exit=0: transakcja ZATWIERDZONA, bramka potwierdziła liczby
#     źródła; stop przed odmrożeniem, decyzja po compare.sh obu baz.
# Ponowne uruchomienie po sukcesie jest idempotentne (czyszczenie + ten sam import).
#
# Strażnik: __tests__/lib/cutover-copy-reverse-config.test.ts.
# Test na prawdziwym Postgresie (CI): __tests__/pg/cutover-copy-reverse.pg.test.ts.
set +x
set -euo pipefail
umask 077

mkdir -p -m 700 "$HOME/secure"
BASE="$HOME/secure/cutover-copy-reverse-$(date -u +%Y%m%dT%H%M%SZ)-$$"
LOG="$BASE.log"
ERRF="$BASE.stderr"
DUMP_ERR="$BASE.stderr-pg-dump"
RESTORE_ERR="$BASE.stderr-psql"
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

# SQL transakcji zapisu: pliki w repo obok skryptu.
SQL_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)/sql" || exit 2
PRE_SQL="$SQL_DIR/reverse-pre.sql"
POST_SQL="$SQL_DIR/reverse-post.sql"
[[ -f "$PRE_SQL" && -f "$POST_SQL" ]] || exit 2

# --- połączenia: tylko zmienne libpq, jeden host na adres --------------------
unset PGOPTIONS
export PGPASSFILE=/dev/null
[[ -z "${PGHOSTADDR:-}" && -z "${PGSERVICE:-}" ]] || exit 2
[[ -z "${TARGET_PGHOSTADDR:-}" && -z "${TARGET_PGSERVICE:-}" ]] || exit 2

check_addr() {
  local host="$1" db="$2" user="$3" port="$4"
  [[ -n "$host" && -n "$db" && -n "$user" ]] || exit 2
  # Tylko małe litery: wielkie omijałyby wykrywanie `-pooler.` (DNS ich nie rozróżnia).
  [[ "$host" =~ ^[a-z0-9.-]+$ ]] || exit 2
  [[ "$db" =~ ^[A-Za-z0-9_.-]+$ ]] || exit 2
  [[ -z "$port" || "$port" =~ ^[0-9]+$ ]] || exit 2
}

check_addr "${PGHOST:-}" "${PGDATABASE:-}" "${PGUSER:-}" "${PGPORT:-}"
check_addr "${TARGET_PGHOST:-}" "${TARGET_PGDATABASE:-}" "${TARGET_PGUSER:-}" "${TARGET_PGPORT:-}"
# Źródło wyłącznie przez lokalne proxy Cloud SQL.
[[ "$PGHOST" == "127.0.0.1" ]] || exit 2
# Cel nigdy przez proxy Cloud SQL i nigdy przez pooler.
[[ "$TARGET_PGHOST" != "127.0.0.1" ]] || exit 2
[[ ! "$TARGET_PGHOST" =~ -pooler\. ]] || exit 2
if [[ "$TARGET_PGHOST" != "localhost" ]]; then
  [[ "${TARGET_PGSSLMODE:-}" == "verify-full" ]] || exit 2
fi
if [[ "$TARGET_PGHOST" == "localhost" ]] &&
  [[ "${PGPORT:-5432}" == "${TARGET_PGPORT:-5432}" && "$PGDATABASE" == "$TARGET_PGDATABASE" ]]; then
  exit 2
fi

if [[ "$DRY_RUN" == 1 ]]; then
  emit dry_run yes
  emit steps 7
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
  # pg_dump nie podaje SQLSTATE: stała klasa z treści komunikatu.
  if grep -qE 'read-only transaction' "$@"; then
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

# Wywołanie psql odczytu. SQL ze stdin, wynik do SQL_OUT (nigdy wprost na ekran).
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

# Tożsamość serwera i zamrożenie jednej strony (osobne połączenie READ ONLY).
# neon_settings=1 tylko gdy sesja widzi niepuste neon.timeline_id. Podstawa
# (ZAŁOŻENIE do potwierdzenia przez CTO): na Neonie rozszerzenie neon
# (shared_preload_libraries) definiuje GUC neon.timeline_id, a compute ustawia
# je na id gałęzi przy starcie, czytelne dla zwykłej roli (SHOW neon.timeline_id);
# Cloud SQL nie ma rozszerzenia neon, więc current_setting(…, true) = NULL → 0.
# Gdyby GUC był tylko dla superużytkownika, current_setting rzuca 42501 →
# error_class=other, kod 1, bez zapisu (bezpieczny wynik). Na PG 15+ ustawienie
# bez załadowanego rozszerzenia (placeholder) nie jest widoczne w pg_settings,
# ale jest w current_setting — stąd ta kontrola zamiast pg_settings LIKE 'neon.%'
# (test CI udaje Neona ALTER DATABASE … SET neon.timeline_id, tą samą kontrolą).
# Brak zmiennej ani flagi, która tę kontrolę wyłącza.
# frozen=1 tylko gdy ustawienie bazy to default_transaction_read_only=on i nowa
# sesja tej roli faktycznie startuje tylko do odczytu.
read_state() {
  run_sql "$1" <<'SQL'
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT 'neon_settings=' || (coalesce(current_setting('neon.timeline_id', true), '') <> '')::int;
SELECT 'frozen=' || CASE WHEN current_setting('default_transaction_read_only') = 'on'
    AND EXISTS (SELECT 1 FROM pg_db_role_setting s JOIN pg_database d ON d.oid = s.setdatabase
                  WHERE d.datname = current_database() AND s.setrole = 0
                    AND 'default_transaction_read_only=on' = ANY (s.setconfig))
  THEN 1 ELSE 0 END;
SELECT 'role_override=' || count(*)
  FROM pg_db_role_setting
  WHERE setrole <> 0
    AND setdatabase IN (0, (SELECT oid FROM pg_database WHERE datname = current_database()))
    AND array_to_string(setconfig, ',') LIKE '%default_transaction_read_only%';
COMMIT;
SQL
  read_nums neon_settings frozen role_override
}

# --- 1. tożsamość serwerów i zamrożenie obu stron ------------------------------
read_state source
SRC_STATE=("${NUMS[@]}")
read_state target
TGT_STATE=("${NUMS[@]}")
# Źródło = Cloud SQL (bez neon.timeline_id), cel = Neon (z neon.timeline_id).
[[ "${SRC_STATE[0]}" == 0 ]] || exit 4
[[ "${TGT_STATE[0]}" != 0 ]] || exit 4
if [[ "${SRC_STATE[1]}" != 1 ]]; then
  emit source_frozen no
  exit 6
fi
emit source_frozen yes
emit source_role_override "${SRC_STATE[2]}"
emit target_role_override "${TGT_STATE[2]}"
[[ "${SRC_STATE[2]}" == 0 && "${TGT_STATE[2]}" == 0 ]] || exit 7
if [[ "${TGT_STATE[1]}" != 1 ]]; then
  emit target_frozen no
  exit 8
fi
emit target_frozen yes

# --- 2. źródło: cykle kluczy obcych, niepuste tabele, oczekiwane liczby --------
run_sql source <<'SQL'
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL row_security = off;
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
SELECT 'SELECT ''source_nonempty_tables='' || (0' || coalesce(string_agg(format(' + (EXISTS (SELECT 1 FROM public.%I))::int', c.relname), '' ORDER BY c.relname COLLATE "C"), '') || ')'
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relispartition \gexec
SELECT format('SELECT %L || %s || %L || %s || %L',
  'expected={"tables":{',
  coalesce((SELECT string_agg(
      CASE WHEN c.relname IN ('auth_rate_limit', 'session', 'verification')
        THEN format('%L', format('"%s":0', c.relname))
        ELSE format('(%L || (SELECT count(*) FROM public.%I))', format('"%s":', c.relname), c.relname) END,
      ' || '','' || ' ORDER BY c.relname COLLATE "C")
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relispartition), ''''''),
  '},"sequences":{',
  coalesce((SELECT string_agg(
      format('(%L || (SELECT CASE WHEN is_called THEN last_value ELSE 0 END FROM public.%I))', format('"%s":', s.relname), s.relname),
      ' || '','' || ' ORDER BY s.relname COLLATE "C")
    FROM pg_class s JOIN pg_namespace n ON n.oid = s.relnamespace
    WHERE n.nspname = 'public' AND s.relkind = 'S'
      AND NOT EXISTS (SELECT 1 FROM pg_depend dep JOIN pg_class t ON t.oid = dep.refobjid
                        WHERE dep.classid = 'pg_class'::regclass AND dep.objid = s.oid
                          AND dep.refclassid = 'pg_class'::regclass AND dep.deptype IN ('a', 'i')
                          AND t.relnamespace = n.oid
                          AND t.relname IN ('auth_rate_limit', 'session', 'verification'))), ''''''),
  '}}') \gexec
COMMIT;
SQL
# Ostatni wiersz = oczekiwane liczby (tylko nazwy [a-z0-9_] i liczby), wcześniejsze = liczby.
EXPECTED_LINE="${SQL_OUT##*$'\n'}"
SQL_OUT="${SQL_OUT%$'\n'*}"
read_nums fk_cycle_tables source_nonempty_tables
ENTRY='"[a-z0-9_]+":[0-9]+'
OBJ="\\{(${ENTRY}(,${ENTRY})*)?\\}"
EXPECTED_RE="^expected=\\{\"tables\":${OBJ},\"sequences\":${OBJ}\\}$"
if [[ ! "$EXPECTED_LINE" =~ $EXPECTED_RE ]]; then
  emit rejected_line 1
  exit 3
fi
EXPECTED="${EXPECTED_LINE#expected=}"
emit fk_cycle_tables "${NUMS[0]}"
if [[ "${NUMS[0]}" != 0 ]]; then
  emit error_class circular_fk
  exit 1
fi
emit source_nonempty_tables "${NUMS[1]}"
[[ "${NUMS[1]}" != 0 ]] || exit 5

# --- 3. cel: liczba tabel do wyczyszczenia --------------------------------------
run_sql target <<'SQL'
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT 'truncated_tables=' || count(*)
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relispartition;
COMMIT;
SQL
read_nums truncated_tables
emit truncated_tables "${NUMS[0]}"

# --- 4. strumień źródło → cel, bez pliku pośredniego ----------------------------
# pipefail (głowica) + PIPESTATUS: kod każdej strony potoku osobno. Błąd po
# którejkolwiek stronie przed bramką = psql kończy się bez zatwierdzenia.
set +e
(
  use_addr source
  pg_dump -w --data-only --schema=public -Fp --exclude-table-data=public.auth_rate_limit --exclude-table-data=public.session --exclude-table-data=public.verification 2>"$DUMP_ERR"
) | (
  use_addr target
  psql -X -q -A -t -w -v ON_ERROR_STOP=1 -v VERBOSITY=sqlstate -v expected="$EXPECTED" -f "$PRE_SQL" -f - -f "$POST_SQL" 2>"$RESTORE_ERR"
)
STREAM=("${PIPESTATUS[@]}")
set -e
cat "$DUMP_ERR" "$RESTORE_ERR"
emit dump_exit "${STREAM[0]}"
emit restore_exit "${STREAM[1]}"
if [[ "${STREAM[1]}" != 0 ]]; then
  fail_db psql "${STREAM[1]}" "$RESTORE_ERR"
fi
if [[ "${STREAM[0]}" != 0 ]]; then
  fail_db pg_dump "${STREAM[0]}" "$DUMP_ERR"
fi

# --- 5. cel po zatwierdzeniu: nadal zamrożony (nowe połączenie) ----------------
read_state target
if [[ "${NUMS[1]}" != 1 ]]; then
  emit target_frozen_after no
  exit 8
fi
emit target_frozen_after yes
emit loaded yes
emit copy_seconds "$SECONDS"
exit 0
