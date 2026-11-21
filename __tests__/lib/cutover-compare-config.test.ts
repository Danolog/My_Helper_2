// @vitest-environment node
/**
 * Strażnik skryptu porównania baz: infra/db/cutover/compare.sh.
 * Skrypt jest uruchamiany z podstawionymi `psql` i `pg_dump` (zapisują
 * argumenty, środowisko PG* i treść SQL ze stdin), więc testy sprawdzają
 * ZACHOWANIE, a nie tylko tekst:
 *  - głowica: `set +x`, `set -euo pipefail`, `umask 077`, potem przekierowanie
 *    `exec 3>&1 1>>"$LOG" 2>&1` przed pierwszym psql/pg_dump, `trap … EXIT`
 *    przed pierwszym połączeniem;
 *  - ekran (fd 3) = wyłącznie wiersze z emit, ostatni `exit=<kod>`; wzorzec emit
 *    dokładnie z projektu; wiersz niezgodny → `rejected_line=1` i kod 3; stderr
 *    narzędzi (komunikaty z wartościami) tylko w pliku logu;
 *  - czyszczenie auth_rate_limit: dokładnie jedno wystąpienie w skrypcie, tylko
 *    w gałęzi --expect-empty, tylko `public.auth_rate_limit`, osobna transakcja;
 *  - --expect-empty odmawia kodem 4 dla hosta ≠ 127.0.0.1 (bez połączenia)
 *    i dla serwera z ustawieniami neon.* (bez czyszczenia);
 *  - tryb domyślny: jedno wywołanie psql, jedna transakcja REPEATABLE READ
 *    READ ONLY z sześcioma SET LOCAL (w tym row_security = off) przed pierwszym
 *    count/rows_hash; row_security = off także w bloku --expect-empty;
 *    sekwencje przez pg_sequence_last_value; locale_sha256 z kodowaniem bazy;
 *  - kontrola seeda drugi raz zaraz po `pnpm test:pg`, przed Playwrightem;
 *  - klasy błędów: connection, unique_violation, read_only, other;
 *  - połączenie tylko ze zmiennych libpq, bez .pgpass, bez PGOPTIONS;
 *  - test na prawdziwym Postgresie biegnie w e2e-smoke (krok `pnpm test:pg`) po
 *    seedzie, z klientem PG z kontenera usługi bazy; bez apt i bez nowego joba.
 */
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SCRIPT = join(ROOT, "infra/db/cutover/compare.sh");
const SOURCE = readFileSync(SCRIPT, "utf8");
const LINES = SOURCE.split("\n");
const CODE_LINES = LINES.filter((l) => !l.trim().startsWith("#"));
const CODE = CODE_LINES.join("\n");

/** Wzorzec emit dosłownie z projektu (§0.1 pkt 2). */
const EMIT_RE =
  "^[a-z0-9_]+=([0-9]+|[0-9a-f]{32}|[0-9a-f]{64}|yes|no|unique_violation|fk_violation|exclusion_violation|read_only|circular_fk|connection|other)$";
const EMIT = new RegExp(EMIT_RE);
const PII = "jan.kowalski@example.invalid";

const DIR = mkdtempSync(join(tmpdir(), "cutover-compare-"));
afterAll(() => rmSync(DIR, { recursive: true, force: true }));
const FAKE = join(DIR, "bin");
mkdirSync(FAKE, { recursive: true });

// psql: numer wywołania, argumenty, środowisko PG*, SQL ze stdin; odpowiedź
// z plików out-<n>/err-<n>/rc-<n>.
writeFileSync(
  join(FAKE, "psql"),
  `#!/bin/sh
d="$FAKE_DIR"
n=$(( $(cat "$d/n") + 1 ))
printf '%s' "$n" > "$d/n"
printf '%s\\n' "$@" > "$d/psql-$n.args"
env | grep -E '^PG' | sort > "$d/psql-$n.env"
cat > "$d/psql-$n.sql"
[ -f "$d/err-$n" ] && cat "$d/err-$n" >&2
[ -f "$d/out-$n" ] && cat "$d/out-$n"
[ -f "$d/rc-$n" ] && exit "$(cat "$d/rc-$n")"
exit 0
`,
);
writeFileSync(
  join(FAKE, "pg_dump"),
  `#!/bin/sh
d="$FAKE_DIR"
printf '%s\\n' "$@" > "$d/pg_dump.args"
env | grep -E '^PG' | sort > "$d/pg_dump.env"
[ -f "$d/pg_dump.err" ] && cat "$d/pg_dump.err" >&2
[ -f "$d/pg_dump.rc" ] && exit "$(cat "$d/pg_dump.rc")"
cat "$d/pg_dump.out"
`,
);
chmodSync(join(FAKE, "psql"), 0o755);
chmodSync(join(FAKE, "pg_dump"), 0o755);

const H32 = "0123456789abcdef0123456789abcdef";
const H64 = `${H32}${H32}`;
/** Wynik bloku odczytu (jedno wywołanie psql w trybie domyślnym). */
const READ_OUT = [
  "count_user=2",
  "count_session=1",
  `rows_hash_user=${H32}`,
  "last_value_invoice_number_seq=5",
  "writes_user=3",
  "rls_clients=yes",
  "force_rls_clients=no",
  "policies_clients=1",
  "grants_count=40",
  `grants_sha256=${H64}`,
  "extensions_count=2",
  `extensions_sha256=${H64}`,
  `locale_sha256=${H64}`,
  "migrations_count=15",
  `migrations_sha256=${H64}`,
].join("\n");
const SCHEMA_DUMP = [
  "--",
  "-- PostgreSQL database dump",
  "--",
  "\\restrict AbCdEfRandomKey123",
  "SET statement_timeout = 0;",
  "SELECT pg_catalog.set_config('search_path', '', false);",
  "",
  'CREATE TABLE public."user" (',
  "    id text NOT NULL",
  ");",
  "\\unrestrict AbCdEfRandomKey123",
  "",
].join("\n");
const SCHEMA_NORMALIZED = 'CREATE TABLE public."user" (\n    id text NOT NULL\n);\n';

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
  lines: string[];
  psql: { args: string[]; env: string; sql: string }[];
  pgDump: { args: string[]; env: string } | null;
  home: string;
  log: string;
}

type Env = Record<string, string | undefined>;
const PG_LOCAL: Env = {
  PGHOST: "127.0.0.1",
  PGPORT: "5432",
  PGDATABASE: "myhelper",
  PGUSER: "myhelper_owner",
  PGPASSWORD: "fake-secret-value",
};

let counter = 0;
function run(
  args: string[],
  opts: {
    env?: Env;
    psql?: { out?: string; err?: string; rc?: number }[];
    pgDump?: { out?: string; err?: string; rc?: number };
    script?: string;
  } = {},
): Run {
  const id = counter++;
  const d = join(DIR, `run-${id}`);
  const home = join(d, "home");
  mkdirSync(home, { recursive: true });
  writeFileSync(join(d, "n"), "0");
  (opts.psql ?? []).forEach((r, i) => {
    if (r.out !== undefined) writeFileSync(join(d, `out-${i + 1}`), r.out);
    if (r.err !== undefined) writeFileSync(join(d, `err-${i + 1}`), r.err);
    if (r.rc !== undefined) writeFileSync(join(d, `rc-${i + 1}`), String(r.rc));
  });
  const dump = opts.pgDump ?? {};
  writeFileSync(join(d, "pg_dump.out"), dump.out ?? SCHEMA_DUMP);
  if (dump.err !== undefined) writeFileSync(join(d, "pg_dump.err"), dump.err);
  if (dump.rc !== undefined) writeFileSync(join(d, "pg_dump.rc"), String(dump.rc));

  const env: Record<string, string> = {
    PATH: `${FAKE}:${process.env.PATH}`,
    HOME: home,
    FAKE_DIR: d,
    // Wartości, które skrypt ma usunąć albo nadpisać.
    PGOPTIONS: "-c default_transaction_read_only=off",
    PGPASSFILE: join(d, "pgpass"),
  };
  for (const [k, v] of Object.entries({ ...PG_LOCAL, ...(opts.env ?? {}) })) {
    if (v !== undefined) env[k] = v;
  }
  const r = spawnSync("bash", [opts.script ?? SCRIPT, ...args], { encoding: "utf8", env: env as NodeJS.ProcessEnv });
  const n = Number(readFileSync(join(d, "n"), "utf8"));
  const psql = Array.from({ length: n }, (_, i) => ({
    args: readFileSync(join(d, `psql-${i + 1}.args`), "utf8").split("\n").filter(Boolean),
    env: readFileSync(join(d, `psql-${i + 1}.env`), "utf8"),
    sql: readFileSync(join(d, `psql-${i + 1}.sql`), "utf8"),
  }));
  const pgDump = existsSync(join(d, "pg_dump.args"))
    ? {
        args: readFileSync(join(d, "pg_dump.args"), "utf8").split("\n").filter(Boolean),
        env: readFileSync(join(d, "pg_dump.env"), "utf8"),
      }
    : null;
  const secure = join(home, "secure");
  const logs = existsSync(secure) ? readdirSync(secure).filter((f) => f.endsWith(".log")) : [];
  const log = logs.map((f) => readFileSync(join(secure, f), "utf8")).join("\n");
  return {
    status: r.status,
    stdout: r.stdout,
    stderr: r.stderr,
    lines: r.stdout.split("\n").filter(Boolean),
    psql,
    pgDump,
    home,
    log,
  };
}

/** Udany przebieg trybu --expect-empty: neon=0, czyszczenie, liczenie. */
const EXPECT_OK = [{ out: "0\n" }, { out: "" }, { out: "nonempty_tables=0\n" }];

describe("compare.sh: głowica trybu D", () => {
  it("pierwsze polecenia: set +x, set -euo pipefail, umask 077", () => {
    // CODE_LINES nie ma komentarzy (także shebangu).
    const exec = CODE_LINES.filter((l) => l.trim() !== "");
    expect(LINES[0]).toBe("#!/usr/bin/env bash");
    expect(exec.slice(0, 3)).toEqual(["set +x", "set -euo pipefail", "umask 077"]);
  });

  it("exec 3>&1 1>>\"$LOG\" 2>&1 przed pierwszym psql/pg_dump/pg_restore/cloud-sql-proxy", () => {
    const execAt = CODE.indexOf('exec 3>&1 1>>"$LOG" 2>&1\n');
    expect(execAt).toBeGreaterThan(0);
    for (const tool of [/\bpsql /, /\bpg_dump /, /\bpg_restore\b/, /\bcloud-sql-proxy\b/]) {
      const m = tool.exec(CODE);
      if (m) expect(m.index, String(tool)).toBeGreaterThan(execAt);
    }
    expect(SOURCE).toContain('LOG="$BASE.log"\n');
    expect(SOURCE).toMatch(/\nBASE="\$HOME\/secure\/cutover-compare-\$\(date -u \+%Y%m%dT%H%M%SZ\)-\$\$"\n/);
  });

  it("wzorzec emit dokładnie z projektu (bez .*, bez dodatkowych klas)", () => {
    expect(SOURCE).toContain(`EMIT_RE='${EMIT_RE}'\n`);
    expect(EMIT_RE).not.toContain(".*");
  });

  it("echo, printf i >&3 wyłącznie w ciele emit", () => {
    const start = CODE.indexOf("emit() {\n");
    const end = CODE.indexOf("\n}\n", start);
    expect(start).toBeGreaterThan(0);
    const outside = CODE.slice(0, start) + CODE.slice(end);
    expect(outside).not.toMatch(/\becho\b|\bprintf\b|>&3/);
    expect(CODE.slice(start, end)).toContain('printf \'%s\\n\' "rejected_line=1" >&3\n    exit 3');
  });

  it("trap … EXIT ustawiony po exec i przed definicją run_sql (pierwsze połączenie)", () => {
    const trapAt = CODE.indexOf("trap 'rc=$?; rm -f \"$ERRF\"; emit exit \"$rc\"' EXIT\n");
    expect(trapAt).toBeGreaterThan(CODE.indexOf('exec 3>&1 1>>"$LOG" 2>&1'));
    expect(trapAt).toBeLessThan(CODE.indexOf("run_sql() {"));
  });

  it("jedyne wywołanie psql z -X -q -A -t -w -v ON_ERROR_STOP=1 -v VERBOSITY=sqlstate", () => {
    const calls = CODE_LINES.filter((l) => /\bpsql\s+-/.test(l));
    expect(calls).toEqual([
      '  SQL_OUT="$(psql -X -q -A -t -w -v ON_ERROR_STOP=1 -v VERBOSITY=sqlstate "$@" -f - 2>"$ERRF")" || rc=$?',
    ]);
  });

  it("brak --enable-row-security, .pgpass, export PGPASSWORD, gcloud, pg_restore i adresów e-mail", () => {
    expect(CODE).not.toMatch(/--enable-row-security|\.pgpass|export PGPASSWORD|\bgcloud\b|\bpg_restore\b/);
    expect(SOURCE).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/);
  });

  it("w SQL brak zapisów poza jednym czyszczeniem auth_rate_limit", () => {
    expect(CODE).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|GRANT|REVOKE|COPY|VACUUM)\b/);
  });
});

describe("compare.sh: czyszczenie auth_rate_limit tylko w --expect-empty", () => {
  it("TRUNCATE występuje w skrypcie dokładnie raz, tylko dla public.auth_rate_limit", () => {
    expect(SOURCE.match(/TRUNCATE/gi)).toHaveLength(1);
    expect(LINES.filter((l) => /TRUNCATE/i.test(l))).toEqual(["TRUNCATE public.auth_rate_limit;"]);
  });

  it("…wyłącznie w ciele expect_empty(), w osobnej transakcji przed blokiem odczytu", () => {
    const start = SOURCE.indexOf("\nexpect_empty() {\n");
    const end = SOURCE.indexOf("\n}\n", start);
    const at = SOURCE.indexOf("TRUNCATE");
    expect(start).toBeGreaterThan(0);
    expect(at).toBeGreaterThan(start);
    expect(at).toBeLessThan(end);
    const body = SOURCE.slice(start, end);
    expect(body).toContain("BEGIN;\nSET LOCAL lock_timeout = '5s';\nTRUNCATE public.auth_rate_limit;\nCOMMIT;\nSQL\n");
    expect(body.indexOf("TRUNCATE")).toBeLessThan(body.indexOf("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;"));
    // Migracje nie wstawiają wierszy: liczone są wszystkie tabele public, bez wyjątków.
    // Sprawdzany SQL (bloki heredoc), nie powłoka — `!=` w `[[ … ]]` to kontrola wyniku.
    const sql = [...body.matchAll(/<<'SQL'\n([\s\S]*?)\nSQL\n/g)].map((m) => m[1]!);
    expect(sql).toHaveLength(3);
    for (const s of sql) expect(s).not.toMatch(/NOT IN|<>|!=|\bEXCEPT\b/i);
    expect(sql[2]).toContain("WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relispartition \\gexec");
  });

  it("tryb domyślny i --all-tables: żadne SQL nie czyści tabel", () => {
    for (const args of [[], ["--all-tables"]]) {
      const r = run(args, { psql: [{ out: READ_OUT }] });
      expect(r.status, r.stdout).toBe(0);
      for (const c of r.psql) expect(c.sql).not.toMatch(/TRUNCATE/i);
    }
  });

  it("--expect-empty: dokładnie jedno czyszczenie, po kontroli neon.*, przed liczeniem w READ ONLY", () => {
    const r = run(["--expect-empty"], { psql: EXPECT_OK });
    expect(r.status, r.stdout).toBe(0);
    expect(r.lines).toEqual(["nonempty_tables=0", "expect_empty=yes", "exit=0"]);
    expect(r.psql).toHaveLength(3);
    expect(r.psql[0]!.sql).toContain("FROM pg_settings WHERE name LIKE 'neon.%'");
    expect(r.psql[1]!.sql).toBe("BEGIN;\nSET LOCAL lock_timeout = '5s';\nTRUNCATE public.auth_rate_limit;\nCOMMIT;\n");
    // RLS bez kontekstu salonu nie może po cichu dać expect_empty=yes: z
    // row_security = off rola objęta polityką dostaje błąd 42501.
    expect(r.psql[2]!.sql).toMatch(/^BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\nSET LOCAL row_security = off;\n/);
    expect(r.psql[2]!.sql).not.toMatch(/TRUNCATE/i);
    expect(r.psql[2]!.sql).not.toMatch(/NOT IN|<>|!=/);
    expect(r.pgDump).toBeNull();
  });

  it("--expect-empty z niepustymi tabelami → expect_empty=no, kod 5", () => {
    const r = run(["--expect-empty"], { psql: [{ out: "0\n" }, { out: "" }, { out: "nonempty_tables=2\n" }] });
    expect(r.status).toBe(5);
    expect(r.lines).toEqual(["nonempty_tables=2", "expect_empty=no", "exit=5"]);
  });

  it("--expect-empty na serwerze z ustawieniami neon.* → kod 4, bez czyszczenia", () => {
    const r = run(["--expect-empty"], { psql: [{ out: "3\n" }] });
    expect(r.status).toBe(4);
    expect(r.lines).toEqual(["exit=4"]);
    expect(r.psql).toHaveLength(1);
  });

  it.each([
    ["localhost", { PGHOST: "localhost" }],
    ["adres prywatny", { PGHOST: "10.20.0.3" }],
    ["Neon z verify-full", { PGHOST: "ep-x-pooler.eu-central-1.aws.neon.tech", PGSSLMODE: "verify-full" }],
    ["127.0.0.1 z PGHOSTADDR", { PGHOSTADDR: "10.20.0.3" }],
    ["lista hostów", { PGHOST: "127.0.0.1,10.20.0.3" }],
  ])("--expect-empty, %s → odmowa (kod 4 albo 2) bez połączenia", (_l, env) => {
    const r = run(["--expect-empty"], { env, psql: EXPECT_OK });
    expect([2, 4]).toContain(r.status);
    expect(r.psql).toHaveLength(0);
    expect(r.lines).toEqual([`exit=${r.status}`]);
  });

  it("--expect-empty na hoście ≠ 127.0.0.1 (poprawne środowisko) → dokładnie kod 4", () => {
    for (const env of [{ PGHOST: "localhost" }, { PGHOST: "10.20.0.3", PGSSLMODE: "verify-full" }]) {
      const r = run(["--expect-empty"], { env, psql: EXPECT_OK });
      expect(r.status).toBe(4);
      expect(r.lines).toEqual(["exit=4"]);
    }
  });

  it("--expect-empty nie łączy się z --all-tables ani --schema-baseline (kod 2)", () => {
    expect(run(["--expect-empty", "--all-tables"], { psql: EXPECT_OK }).status).toBe(2);
    const base = join(DIR, "baseline.sql");
    writeFileSync(base, SCHEMA_NORMALIZED);
    expect(run(["--expect-empty", `--schema-baseline=${base}`], { psql: EXPECT_OK }).status).toBe(2);
  });
});

describe("compare.sh: jedna transakcja READ ONLY z SET LOCAL", () => {
  const block = (() => {
    const start = SOURCE.indexOf("compare_db() {\n");
    return SOURCE.slice(SOURCE.indexOf("<<'SQL'\n", start) + 8, SOURCE.indexOf("\nSQL\n", start));
  })();

  it("blok SQL: BEGIN … READ ONLY, sześć SET LOCAL (w tym row_security = off), odczyty, COMMIT", () => {
    const l = block.split("\n");
    expect(l.slice(0, 7)).toEqual([
      "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;",
      "SET LOCAL TimeZone = 'UTC';",
      "SET LOCAL DateStyle = 'ISO, YMD';",
      "SET LOCAL IntervalStyle = 'postgres';",
      "SET LOCAL extra_float_digits = 1;",
      "SET LOCAL bytea_output = 'hex';",
      "SET LOCAL row_security = off;",
    ]);
    expect(block.match(/\bSET LOCAL\b/g)).toHaveLength(6);
    expect(l[l.length - 1]).toBe("COMMIT;");
    expect(block.indexOf("count_")).toBeGreaterThan(block.indexOf("SET LOCAL row_security = off;"));
    expect(block.indexOf("rows_hash_")).toBeGreaterThan(block.indexOf("SET LOCAL row_security = off;"));
    expect(block.match(/\bBEGIN\b/g)).toHaveLength(1);
    expect(block.match(/\bCOMMIT\b/g)).toHaveLength(1);
    for (const k of ["'count_'", "'rows_hash_'", "'last_value_'", "'writes_'", "'rls_'", "'force_rls_'", "'policies_'"]) {
      expect(block, k).toContain(k);
    }
  });

  it("hash treści: md5 string_agg(t::text) posortowany po tekście wiersza z COLLATE \"C\"", () => {
    expect(block).toContain(
      "md5(coalesce(string_agg(t::text, E''\\n'' ORDER BY (t::text) COLLATE \"C\"), ''''))",
    );
    expect(block).toContain("AND (:'all_tables' = 'yes' OR c.relname NOT IN ('auth_rate_limit', 'session', 'verification'))");
  });

  it("sekwencje przez pg_sequence_last_value (brak uprawnienia = błąd), nie last_value z pg_sequences (NULL → 0)", () => {
    expect(block).toContain(
      "coalesce(pg_sequence_last_value(format('public.%I', sequencename)::regclass), 0)",
    );
    expect(block).not.toMatch(/coalesce\(last_value\b/);
  });

  it("locale_sha256 obejmuje kodowanie bazy (pg_encoding_to_char)", () => {
    expect(block).toContain("datcollate || ' ' || datctype || ' ' || pg_encoding_to_char(encoding)");
  });

  it("przebieg: jedno wywołanie psql na wszystkie liczby i hashe, potem pg_dump schematu", () => {
    const r = run([], { psql: [{ out: READ_OUT }] });
    expect(r.status, r.stdout).toBe(0);
    expect(r.psql).toHaveLength(1);
    expect(r.psql[0]!.sql).toBe(`${block}\n`);
    expect(r.psql[0]!.args).toContain("all_tables=no");
    expect(r.pgDump!.args).toEqual(["-w", "--schema-only", "--schema=public", "--no-owner", "--no-privileges"]);
  });

  it("--all-tables przekazuje all_tables=yes", () => {
    const r = run(["--all-tables"], { psql: [{ out: READ_OUT }] });
    expect(r.status).toBe(0);
    expect(r.psql[0]!.args).toContain("all_tables=yes");
  });
});

describe("compare.sh: ekran = tylko emit", () => {
  it("udany przebieg: wiersze wyniku, schema_sha256, compare_seconds, exit=0; stderr pusty", () => {
    const r = run([], { psql: [{ out: READ_OUT, err: `NOTICE: ${PII}\n` }] });
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
    expect(r.lines.slice(0, 15)).toEqual(READ_OUT.split("\n"));
    expect(r.lines[15]).toMatch(/^schema_sha256=[0-9a-f]{64}$/);
    expect(r.lines[16]).toMatch(/^compare_seconds=\d+$/);
    expect(r.lines[17]).toBe("exit=0");
    expect(r.lines).toHaveLength(18);
    for (const l of r.lines) expect(EMIT.test(l), l).toBe(true);
    expect(r.stdout).not.toContain(PII);
    expect(r.log).toContain(PII);
  });

  it("wiersz z danymi zamiast liczby → rejected_line=1, kod 3, wartość nie trafia na ekran", () => {
    const r = run([], { psql: [{ out: `count_user=2\ncount_clients=${PII}\nrows_hash_user=${H32}\n` }] });
    expect(r.status).toBe(3);
    expect(r.lines).toEqual(["count_user=2", "rejected_line=1", "exit=3"]);
    expect(r.stdout).not.toContain(PII);
    expect(r.pgDump).toBeNull();
  });

  it.each([
    ["klucz z wielką literą", "count_User=1"],
    ["pusty wiersz", ""],
    ["hash 31 znaków", `rows_hash_user=${H32.slice(1)}`],
    ["hash z wielkimi literami", `rows_hash_user=${H32.toUpperCase()}`],
    ["dodatkowy tekst", "count_user=1 extra"],
    ["klasa spoza listy", "error_class=permission_denied"],
  ])("%s → rejected_line=1, kod 3", (_l, out) => {
    const r = run([], { psql: [{ out: `${out}\n` }] });
    expect(r.status).toBe(3);
    expect(r.lines).toEqual(["rejected_line=1", "exit=3"]);
  });

  it("schemat znormalizowany (bez komentarzy, SET, set_config, \\restrict) w pliku obok logu, tryb 600", () => {
    const r = run([], { psql: [{ out: READ_OUT }] });
    const secure = join(r.home, "secure");
    const files = readdirSync(secure);
    const schema = files.find((f) => f.endsWith(".schema.sql"))!;
    expect(readFileSync(join(secure, schema), "utf8")).toBe(SCHEMA_NORMALIZED);
    expect(files.some((f) => f.endsWith(".schema.raw") || f.endsWith(".stderr"))).toBe(false);
    for (const f of files) expect(statSync(join(secure, f)).mode & 0o077, f).toBe(0);
    expect(statSync(secure).mode & 0o077).toBe(0);
  });

  it("--schema-baseline: równy → schema_equal=yes; różny → schema_equal=no, kod 6, diff obok logu", () => {
    const same = join(DIR, "same.sql");
    const other = join(DIR, "other.sql");
    writeFileSync(same, SCHEMA_NORMALIZED);
    writeFileSync(other, `${SCHEMA_NORMALIZED}CREATE TABLE public.x ();\n`);
    const a = run([`--schema-baseline=${same}`], { psql: [{ out: READ_OUT }] });
    expect(a.status).toBe(0);
    expect(a.lines).toContain("schema_equal=yes");
    const b = run([`--schema-baseline=${other}`], { psql: [{ out: READ_OUT }] });
    expect(b.status).toBe(6);
    expect(b.lines).toContain("schema_equal=no");
    expect(b.lines[b.lines.length - 1]).toBe("exit=6");
    expect(readdirSync(join(b.home, "secure")).some((f) => f.endsWith(".schema.diff"))).toBe(true);
    expect(run(["--schema-baseline=/nonexistent/x.sql"]).lines).toEqual(["exit=2"]);
  });
});

describe("compare.sh: klasy błędów (fd 3 tylko error_class i exit)", () => {
  it("błędne hasło (psql kod 2) → error_class=connection, exit=1; komunikat tylko w logu", () => {
    const err = `psql: error: connection to server at "127.0.0.1", port 5432 failed: FATAL:  password authentication failed for user "myhelper_owner"\n`;
    const r = run([], { psql: [{ err, rc: 2 }] });
    expect(r.status).toBe(1);
    expect(r.lines).toEqual(["error_class=connection", "exit=1"]);
    expect(r.stderr).toBe("");
    expect(r.log).toContain("password authentication failed");
    expect(r.pgDump).toBeNull();
  });

  it.each([
    ["23505", "unique_violation"],
    ["23503", "fk_violation"],
    ["23P01", "exclusion_violation"],
    ["25006", "read_only"],
    ["42501", "other"],
  ])("błąd SQL %s (psql kod 3) → error_class=%s; DETAIL z wartością tylko w logu", (state, cls) => {
    const err = `psql:<stdin>:12: ERROR:  ${state}\nDETAIL:  Key (email)=(${PII}) already exists.\n`;
    const r = run([], { psql: [{ err, rc: 3 }] });
    expect(r.status).toBe(1);
    expect(r.lines).toEqual([`error_class=${cls}`, "exit=1"]);
    expect(r.stdout).not.toContain(PII);
    expect(r.log).toContain(PII);
  });

  it("pg_dump bez połączenia → error_class=connection po wierszach odczytu", () => {
    const r = run([], {
      psql: [{ out: READ_OUT }],
      pgDump: { err: 'pg_dump: error: connection to server at "127.0.0.1" failed\n', rc: 1 },
    });
    expect(r.status).toBe(1);
    expect(r.lines.slice(-2)).toEqual(["error_class=connection", "exit=1"]);
  });

  it("pg_dump z innym błędem → error_class=other", () => {
    const r = run([], { psql: [{ out: READ_OUT }], pgDump: { err: "pg_dump: error: aborting because of server version mismatch\n", rc: 1 } });
    expect(r.lines.slice(-2)).toEqual(["error_class=other", "exit=1"]);
  });
});

describe("compare.sh: argumenty, środowisko, dry-run", () => {
  it.each([
    ["tryb domyślny", [], "2"],
    ["--schema-baseline", [`--schema-baseline=${join(DIR, "dry.sql")}`], "3"],
    ["--expect-empty", ["--expect-empty"], "3"],
  ])("--dry-run (%s): bez połączenia, dry_run=yes i steps", (_l, args, steps) => {
    writeFileSync(join(DIR, "dry.sql"), SCHEMA_NORMALIZED);
    const r = run(["--dry-run", ...args]);
    expect(r.status).toBe(0);
    expect(r.lines).toEqual(["dry_run=yes", `steps=${steps}`, "exit=0"]);
    expect(r.psql).toHaveLength(0);
    expect(r.pgDump).toBeNull();
  });

  it.each([
    ["nieznany argument", ["--force"], {}],
    ["URL jako argument", ["postgresql://u:p@127.0.0.1/db"], {}],
    ["brak PGHOST", [], { PGHOST: undefined }],
    ["brak PGDATABASE", [], { PGDATABASE: undefined }],
    ["brak PGUSER", [], { PGUSER: undefined }],
    ["PGDATABASE jako connection string", [], { PGDATABASE: "host=10.0.0.1 dbname=x" }],
    ["PGSERVICE", [], { PGSERVICE: "prod" }],
    ["PGHOSTADDR", [], { PGHOSTADDR: "10.0.0.1" }],
    ["gniazdo unix", [], { PGHOST: "/tmp" }],
    ["host zdalny bez verify-full", [], { PGHOST: "ep-x.eu-central-1.aws.neon.tech", PGSSLMODE: "require" }],
    ["port nieliczbowy", [], { PGPORT: "5432x" }],
  ])("%s → kod 2, bez połączenia, na ekranie tylko exit=2", (_l, args, env) => {
    const r = run(args, { env, psql: [{ out: READ_OUT }] });
    expect(r.status).toBe(2);
    expect(r.lines).toEqual(["exit=2"]);
    expect(r.psql).toHaveLength(0);
  });

  it("host zdalny z verify-full przechodzi do połączenia", () => {
    const r = run([], { env: { PGHOST: "ep-x.eu-central-1.aws.neon.tech", PGSSLMODE: "verify-full" }, psql: [{ out: READ_OUT }] });
    expect(r.status, r.stdout).toBe(0);
    expect(r.psql).toHaveLength(1);
  });

  it("psql i pg_dump: bez PGOPTIONS, PGPASSFILE=/dev/null, hasło tylko w środowisku", () => {
    const r = run([], { psql: [{ out: READ_OUT }] });
    for (const env of [r.psql[0]!.env, r.pgDump!.env]) {
      expect(env).not.toMatch(/^PGOPTIONS=/m);
      expect(env).toMatch(/^PGPASSFILE=\/dev\/null$/m);
      expect(env).toMatch(/^PGPASSWORD=fake-secret-value$/m);
    }
    for (const a of [...r.psql[0]!.args, ...r.pgDump!.args]) expect(a).not.toContain("fake-secret-value");
    expect(r.stdout + r.log).not.toContain("fake-secret-value");
  });
});

describe("CI: test compare.sh na prawdziwym Postgresie", () => {
  const WF = readFileSync(join(ROOT, ".github/workflows/quality-gate.yml"), "utf8");
  const job = WF.slice(WF.indexOf("\n  e2e-smoke:\n"), WF.indexOf("\n  e2e-full:\n"));
  const PG_STEP = "      - name: Integration test — subscription locks (real Postgres)\n";
  const SEED_AFTER_PG = "      - name: Seed check (after test:pg)\n";

  it("bez osobnego joba: test w e2e-smoke, krok `pnpm test:pg` po migracjach i seedzie, przed Playwrightem", () => {
    expect(job.length).toBeGreaterThan(100);
    expect(WF).not.toContain("\n  cutover-compare:\n");
    const order = [
      "run: pnpm db:migrate",
      "run: pnpm db:seed:test",
      "run: pnpm exec tsx scripts/verify-seed.ts",
      PG_STEP,
      "        run: pnpm test:pg\n",
      SEED_AFTER_PG,
      "run: pnpm exec playwright install chromium",
    ].map((s) => job.indexOf(s));
    for (const i of order) expect(i).toBeGreaterThan(0);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(job.split("run: pnpm test:pg").length - 1).toBe(1);
  });

  it("kontrola seeda zaraz po `pnpm test:pg`: następny krok po teście pg, przed instalacją Chromium", () => {
    const pgRun = job.indexOf("        run: pnpm test:pg\n");
    const next = job.indexOf("\n      - name: ", pgRun);
    expect(pgRun).toBeGreaterThan(0);
    expect(job.indexOf(SEED_AFTER_PG)).toBe(next + 1);
    expect(job.slice(next + 1)).toMatch(/^ {6}- name: Seed check \(after test:pg\)\n {8}run: pnpm exec tsx scripts\/verify-seed\.ts\n/);
    expect(job.indexOf(SEED_AFTER_PG)).toBeLessThan(job.indexOf("run: pnpm exec playwright install chromium"));
    // Kontrola przed test:pg zostaje; po test:pg dochodzi druga.
    expect(job.split("run: pnpm exec tsx scripts/verify-seed.ts").length - 1).toBe(2);
  });

  it("krok testu: ten sam adres bazy joba, CUTOVER_COMPARE_PG=1 i id kontenera usługi postgres", () => {
    const step = job.slice(job.indexOf(PG_STEP), job.indexOf("\n\n", job.indexOf(PG_STEP)));
    expect(step).toMatch(/\n {10}INTEGRATION_POSTGRES_URL: postgresql:\/\/[^@\s]+@localhost:5432\/pos_dev\n/);
    expect(step).toContain('\n          CUTOVER_COMPARE_PG: "1"\n');
    expect(step).toContain("\n          CUTOVER_PG_CONTAINER: ${{ job.services.postgres.id }}");
    expect(step).toMatch(/\n {8}timeout-minutes: [1-5]\n/);
  });

  it("CUTOVER_COMPARE_PG i CUTOVER_PG_CONTAINER ustawione wyłącznie w tym kroku", () => {
    expect(WF.match(/CUTOVER_COMPARE_PG/g)).toHaveLength(1);
    expect(WF.match(/CUTOVER_PG_CONTAINER/g)).toHaveLength(1);
  });

  it("klient PG bez apt i bez nowych obrazów (nakładki docker exec w teście)", () => {
    expect(WF).not.toMatch(/\bapt-get\b|\bapt\s+install\b|postgresql-client/);
    expect(WF.match(/^\s+image:/gm)).toHaveLength(2);
    const t = readFileSync(join(ROOT, "__tests__/pg/cutover-compare.pg.test.ts"), "utf8");
    expect(t).toContain("exec docker exec -i -e PGHOST=${ip} -e PGPORT=5432 ${pass} ${cid} ${tool} \"$@\"");
    // Hasło do docker exec tylko jako nazwa zmiennej (`-e PGPASSWORD`), nigdy `-e PGPASSWORD=…`.
    expect(t).not.toMatch(/PGPASSWORD=\$/);
  });

  it("plik testu istnieje i jest bramkowany CUTOVER_COMPARE_PG", () => {
    const t = readFileSync(join(ROOT, "__tests__/pg/cutover-compare.pg.test.ts"), "utf8");
    expect(t).toContain('process.env.CUTOVER_COMPARE_PG === "1"');
  });
});
