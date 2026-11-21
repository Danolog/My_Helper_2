// @vitest-environment node
/**
 * Strażnik wycofania przełączenia: infra/db/cutover/copy-cloudsql-to-neon.sh
 * oraz pliki SQL jego jedynej transakcji zapisu (infra/db/cutover/sql/
 * reverse-pre.sql, reverse-post.sql). Skrypt jest uruchamiany z podstawionymi
 * `psql` i `pg_dump` (zapisują argumenty, środowisko PG* i TARGET_*, stdin),
 * więc testy sprawdzają ZACHOWANIE:
 *  - głowica jak w pozostałych skryptach przełączenia (`set +x`, `exec 3>&1
 *    1>>"$LOG" 2>&1`, wzorzec emit, `trap … EXIT`, PGPASSFILE=/dev/null, bez
 *    PGOPTIONS); --dry-run: steps=7;
 *  - kod 2 bez połączenia: cel 127.0.0.1, cel przez pooler, cel zdalny bez
 *    verify-full, źródło ≠ 127.0.0.1, ta sama baza po obu stronach, pusty
 *    argument i puste zmienne;
 *  - bramki przed zapisem: neon.* po złej stronie = 4, puste źródło = 5,
 *    źródło niezamrożone = 6, role_override = 7, cel niezamrożony = 8 (także
 *    po zatwierdzeniu), cykl kluczy obcych = circular_fk; żadna nie dochodzi
 *    do pg_dump;
 *  - strumień: jeden potok pg_dump -Fp | psql -f pre -f - -f post bez pliku
 *    pośredniego; każdy kod ≠ 0 po którejkolwiek stronie = kod 1;
 *  - SQL: BEGIN READ WRITE i czyszczenie tylko w reverse-pre.sql (dokładnie
 *    raz, RESTRICT, bez CASCADE i bez RESTART IDENTITY), COMMIT jako ostatnia
 *    instrukcja reverse-post.sql po bloku DO; w skrypcie bez -1,
 *    --single-transaction, PGOPTIONS, ALTER DATABASE, zapisu
 *    default_transaction_read_only i --disable-triggers;
 *  - kopia w przód nadal ma cel tylko 127.0.0.1 i kod 4 dla celu z neon.*.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SCRIPT = join(ROOT, "infra/db/cutover/copy-cloudsql-to-neon.sh");
const FORWARD = join(ROOT, "infra/db/cutover/copy-neon-to-cloudsql.sh");
const SQL_DIR = realpathSync(join(ROOT, "infra/db/cutover/sql"));
const PRE = join(SQL_DIR, "reverse-pre.sql");
const POST = join(SQL_DIR, "reverse-post.sql");
const EMIT_RE =
  "^[a-z0-9_]+=([0-9]+|[0-9a-f]{32}|[0-9a-f]{64}|yes|no|unique_violation|fk_violation|exclusion_violation|read_only|circular_fk|connection|other)$";
const EMIT = new RegExp(EMIT_RE);
const PII = "jan.kowalski@example.invalid";
const PAYLOAD = `COPY public."user" (id, email) FROM stdin;\nu1\t${PII}\n\\.\n`;
const LIMIT = 120_000;

const SOURCE = readFileSync(SCRIPT, "utf8");
const LINES = SOURCE.split("\n");
const CODE_LINES = LINES.filter((l) => !l.trim().startsWith("#"));
const CODE = CODE_LINES.join("\n");
const sqlBlocks = [...SOURCE.matchAll(/<<'SQL'\n([\s\S]*?)\nSQL\n/g)].map((m) => m[1]!);
const sqlCode = (f: string) =>
  readFileSync(f, "utf8")
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");
const PRE_CODE = sqlCode(PRE);
const POST_CODE = sqlCode(POST);

const DIR = mkdtempSync(join(tmpdir(), "cutover-copy-reverse-"));
afterAll(() => rmSync(DIR, { recursive: true, force: true }));
const FAKE = join(DIR, "bin");
mkdirSync(FAKE, { recursive: true });
writeFileSync(
  join(FAKE, "psql"),
  `#!/bin/sh
d="$FAKE_DIR"
n=$(( $(cat "$d/n") + 1 ))
printf '%s' "$n" > "$d/n"
printf '%s\\n' "$@" > "$d/psql-$n.args"
env | grep -E '^(PG|TARGET_)' | sort > "$d/psql-$n.env"
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
env | grep -E '^(PG|TARGET_)' | sort > "$d/pg_dump.env"
[ -f "$d/dump.err" ] && cat "$d/dump.err" >&2
[ -f "$d/dump.out" ] && cat "$d/dump.out"
[ -f "$d/dump.rc" ] && exit "$(cat "$d/dump.rc")"
exit 0
`,
);
for (const t of ["psql", "pg_dump"]) chmodSync(join(FAKE, t), 0o755);

type Env = Record<string, string | undefined>;
type Reply = { out?: string; err?: string; rc?: number };
interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
  lines: string[];
  psql: { args: string[]; env: string; sql: string }[];
  dump: { args: string[]; env: string } | null;
  secureFiles: string[];
  secureText: string;
  log: string;
}

const BASE_ENV: Env = {
  PGHOST: "127.0.0.1",
  PGPORT: "5432",
  PGDATABASE: "myhelper",
  PGUSER: "src_owner",
  PGPASSWORD: "fake-source-secret",
  TARGET_PGHOST: "ep-x-1.eu-central-1.aws.neon.tech",
  TARGET_PGSSLMODE: "verify-full",
  TARGET_PGDATABASE: "neondb",
  TARGET_PGUSER: "tgt_owner",
  TARGET_PGPASSWORD: "fake-target-secret",
};

let counter = 0;
function run(args: string[], opts: { env?: Env; psql?: Reply[]; dump?: Reply } = {}): Run {
  const d = join(DIR, `run-${counter++}`);
  const home = join(d, "home");
  mkdirSync(home, { recursive: true });
  writeFileSync(join(d, "n"), "0");
  (opts.psql ?? []).forEach((r, i) => {
    if (r.out !== undefined) writeFileSync(join(d, `out-${i + 1}`), r.out);
    if (r.err !== undefined) writeFileSync(join(d, `err-${i + 1}`), r.err);
    if (r.rc !== undefined) writeFileSync(join(d, `rc-${i + 1}`), String(r.rc));
  });
  const dump = opts.dump ?? { out: PAYLOAD };
  if (dump.out !== undefined) writeFileSync(join(d, "dump.out"), dump.out);
  if (dump.err !== undefined) writeFileSync(join(d, "dump.err"), dump.err);
  if (dump.rc !== undefined) writeFileSync(join(d, "dump.rc"), String(dump.rc));

  const env: NodeJS.ProcessEnv = {
    NODE_ENV: "test",
    PATH: `${FAKE}:${process.env.PATH ?? ""}`,
    HOME: home,
    FAKE_DIR: d,
    // Wartości, które skrypt ma usunąć albo nadpisać.
    PGOPTIONS: "-c default_transaction_read_only=off",
    PGPASSFILE: join(d, "pgpass"),
  };
  for (const [k, v] of Object.entries({ ...BASE_ENV, ...(opts.env ?? {}) })) {
    if (v !== undefined) env[k] = v;
  }
  const r = spawnSync("bash", [SCRIPT, ...args], { encoding: "utf8", env, timeout: LIMIT });
  const n = Number(readFileSync(join(d, "n"), "utf8"));
  const psql = Array.from({ length: n }, (_, i) => ({
    args: readFileSync(join(d, `psql-${i + 1}.args`), "utf8").split("\n").filter(Boolean),
    env: readFileSync(join(d, `psql-${i + 1}.env`), "utf8"),
    sql: readFileSync(join(d, `psql-${i + 1}.sql`), "utf8"),
  }));
  const dumpRun = existsSync(join(d, "pg_dump.args"))
    ? {
        args: readFileSync(join(d, "pg_dump.args"), "utf8").split("\n").filter(Boolean),
        env: readFileSync(join(d, "pg_dump.env"), "utf8"),
      }
    : null;
  const secure = join(home, "secure");
  const secureFiles = existsSync(secure) ? readdirSync(secure) : [];
  const secureText = secureFiles.map((f) => readFileSync(join(secure, f), "utf8")).join("\n");
  return {
    status: r.status,
    stdout: r.stdout,
    stderr: r.stderr,
    lines: r.stdout.split("\n").filter(Boolean),
    psql,
    dump: dumpRun,
    secureFiles,
    secureText,
    log: secureFiles
      .filter((f) => f.endsWith(".log"))
      .map((f) => readFileSync(join(secure, f), "utf8"))
      .join("\n"),
  };
}

const state = (neon: number, frozen: number, role: number): Reply => ({
  out: `neon_settings=${neon}\nfrozen=${frozen}\nrole_override=${role}\n`,
});
const EXPECTED = '{"tables":{"auth_rate_limit":0,"salons":2,"session":0,"user":3,"verification":0},"sequences":{}}';
const SRC_OK = state(0, 1, 0);
const TGT_OK = state(2, 1, 0);
const DATA_OK: Reply = { out: `fk_cycle_tables=0\nsource_nonempty_tables=2\nexpected=${EXPECTED}\n` };
const TABLES_OK: Reply = { out: "truncated_tables=5\n" };
const STREAM_OK: Reply = { out: "\n\n" };
const AFTER_OK = state(2, 1, 0);
const OK = [SRC_OK, TGT_OK, DATA_OK, TABLES_OK, STREAM_OK, AFTER_OK];
const GATES = ["source_frozen=yes", "source_role_override=0", "target_role_override=0", "target_frozen=yes"];

// ---------------------------------------------------------------------------------
describe("copy-cloudsql-to-neon.sh: głowica trybu D", () => {
  it("pierwsze polecenia: set +x, set -euo pipefail, umask 077", () => {
    expect(LINES[0]).toBe("#!/usr/bin/env bash");
    expect(CODE_LINES.filter((l) => l.trim() !== "").slice(0, 3)).toEqual(["set +x", "set -euo pipefail", "umask 077"]);
  });

  it("exec 3>&1 1>>\"$LOG\" 2>&1 przed pierwszym psql/pg_dump; log w $HOME/secure", () => {
    const execAt = CODE.indexOf('exec 3>&1 1>>"$LOG" 2>&1\n');
    expect(execAt).toBeGreaterThan(0);
    for (const tool of [/\bpsql /, /\bpg_dump /]) {
      const m = tool.exec(CODE);
      expect(m, String(tool)).not.toBeNull();
      expect(m!.index, String(tool)).toBeGreaterThan(execAt);
    }
    expect(SOURCE).toContain('BASE="$HOME/secure/cutover-copy-reverse-$(date -u +%Y%m%dT%H%M%SZ)-$$"\n');
    expect(SOURCE).toContain('LOG="$BASE.log"\n');
  });

  it("wzorzec emit dokładnie z projektu", () => {
    expect(SOURCE).toContain(`EMIT_RE='${EMIT_RE}'\n`);
  });

  it("echo, printf i >&3 wyłącznie w ciele emit", () => {
    const start = CODE.indexOf("emit() {\n");
    const end = CODE.indexOf("\n}\n", start);
    expect(start).toBeGreaterThan(0);
    expect(CODE.slice(0, start) + CODE.slice(end)).not.toMatch(/\becho\b|\bprintf\b|>&3/);
  });

  it("trap … EXIT po exec i przed pierwszym psql; PGPASSFILE=/dev/null, unset PGOPTIONS", () => {
    const trapAt = CODE.search(/trap 'rc=\$\?; rm -f "\$ERRF"[^']*; emit exit "\$rc"' EXIT\n/);
    expect(trapAt).toBeGreaterThan(CODE.indexOf('exec 3>&1 1>>"$LOG" 2>&1'));
    expect(trapAt).toBeLessThan(/\bpsql -X/.exec(CODE)!.index);
    expect(CODE).toContain("unset PGOPTIONS\nexport PGPASSFILE=/dev/null\n");
  });

  it("dwa wywołania psql: odczyt ze stdin i strumień -f pre -f - -f post", () => {
    const calls = CODE_LINES.filter((l) => /\bpsql\s+-/.test(l));
    expect(calls).toEqual([
      '  SQL_OUT="$(use_addr "$addr"; psql -X -q -A -t -w -v ON_ERROR_STOP=1 -v VERBOSITY=sqlstate "$@" -f - 2>"$ERRF")" || rc=$?',
      '  psql -X -q -A -t -w -v ON_ERROR_STOP=1 -v VERBOSITY=sqlstate -v expected="$EXPECTED" -f "$PRE_SQL" -f - -f "$POST_SQL" 2>"$RESTORE_ERR"',
    ]);
    expect(CODE).toContain('PRE_SQL="$SQL_DIR/reverse-pre.sql"\nPOST_SQL="$SQL_DIR/reverse-post.sql"\n');
  });

  it("brak --enable-row-security, .pgpass, gcloud, pg_restore i adresów e-mail", () => {
    expect(CODE).not.toMatch(/--enable-row-security|\.pgpass|\bgcloud\b|\bpg_restore\b/);
    for (const f of [SOURCE, readFileSync(PRE, "utf8"), readFileSync(POST, "utf8")]) {
      expect(f).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/);
    }
  });
});

// ---------------------------------------------------------------------------------
describe("copy-cloudsql-to-neon.sh: jedna transakcja zapisu tylko w SQL z repo", () => {
  it("skrypt: bez -1, --single-transaction, PGOPTIONS=, ALTER DATABASE, zapisu default_transaction_read_only, --disable-triggers", () => {
    expect(CODE).not.toMatch(/(^|\s)-1(\s|$)/m);
    expect(CODE).not.toMatch(/--single-transaction|--disable-triggers|session_replication_role/);
    expect(CODE).not.toMatch(/PGOPTIONS=|export PGOPTIONS/);
    expect(CODE).not.toMatch(/ALTER\s+DATABASE/i);
    expect(CODE).not.toMatch(/\bSET\s+(SESSION\s+|LOCAL\s+)?default_transaction_read_only\b/i);
    expect(CODE).not.toMatch(/set_config\(\s*'default_transaction_read_only'/i);
    // Zapis (READ WRITE, czyszczenie) wyłącznie w reverse-pre.sql, nie w skrypcie.
    expect(CODE).not.toMatch(/READ WRITE|TRUNCATE/);
  });

  it("bloki SQL skryptu: wszystkie READ ONLY, bez zapisów", () => {
    expect(sqlBlocks).toHaveLength(3);
    for (const b of sqlBlocks) {
      expect(b).toMatch(/^BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\n/);
      expect(b).toMatch(/\nCOMMIT;$/);
      expect(b).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|COPY|VACUUM)\b/i);
      expect(b).not.toMatch(/READ WRITE/);
    }
    expect(sqlBlocks[0]).toContain("FROM pg_settings WHERE name LIKE 'neon.%'");
    expect(sqlBlocks[0]).toContain("'default_transaction_read_only=on' = ANY (s.setconfig)");
    expect(sqlBlocks[0]).toContain("current_setting('default_transaction_read_only') = 'on'");
    expect(sqlBlocks[1]).toContain("WHERE c.contype = 'f' AND sn.nspname = 'public' AND dn.nspname = 'public'");
    expect(sqlBlocks[1]).toContain("SET LOCAL row_security = off;");
    // Sekwencje przez SELECT wprost (brak uprawnienia = błąd), nie pg_sequence_last_value (NULL).
    expect(sqlBlocks[1]).toContain("SELECT CASE WHEN is_called THEN last_value ELSE 0 END FROM public.%I");
    expect(SOURCE + PRE_CODE + POST_CODE).not.toMatch(/pg_sequence_last_value|pg_sequences/);
  });

  it("reverse-pre.sql: BEGIN READ WRITE pierwszą instrukcją, lock_timeout, row_security, jedno czyszczenie z RESTRICT", () => {
    const stmts = PRE_CODE.split("\n").filter((l) => l.trim() !== "");
    expect(stmts.slice(0, 3)).toEqual(["BEGIN READ WRITE;", "SET LOCAL lock_timeout = '10s';", "SET LOCAL row_security = off;"]);
    expect(PRE_CODE).toContain("pg_catalog.set_config('cutover_reverse.expected', :'expected', true)");
    expect(PRE_CODE.match(/TRUNCATE/gi)).toHaveLength(1);
    expect(PRE_CODE.match(/READ WRITE/g)).toHaveLength(1);
    expect(PRE_CODE).toContain("' RESTRICT'");
    expect(PRE_CODE).toContain("WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relispartition \\gexec");
    // Czyszczenie obejmuje wszystkie tabele public (także trzy wykluczone z danych).
    expect(PRE_CODE).not.toMatch(/NOT IN|auth_rate_limit|session|verification/);
    expect(PRE_CODE).not.toMatch(/CASCADE|RESTART\s+IDENTITY/i);
    expect(PRE_CODE).not.toMatch(/\b(COMMIT|ROLLBACK|END)\b/i);
    expect(PRE_CODE).not.toMatch(/default_transaction_read_only|ALTER\s+DATABASE/i);
  });

  it("reverse-post.sql: blok DO z RAISE, COMMIT ostatnią instrukcją, bez czyszczenia i bez poleceń psql", () => {
    const stmts = POST_CODE.split("\n").filter((l) => l.trim() !== "");
    expect(stmts[0]).toBe("DO $gate$");
    expect(stmts[stmts.length - 1]).toBe("COMMIT;");
    expect(stmts[stmts.length - 2]).toBe("$gate$;");
    expect(POST_CODE.match(/\bCOMMIT\b/g)).toHaveLength(1);
    expect(POST_CODE).not.toMatch(/TRUNCATE|READ WRITE|CASCADE|ROLLBACK/i);
    expect(POST_CODE).not.toMatch(/\\/);
    expect(POST_CODE).not.toMatch(/default_transaction_read_only|ALTER\s+DATABASE/i);
    expect(POST_CODE).toContain("pg_catalog.current_setting('cutover_reverse.expected')::jsonb");
    expect(POST_CODE).toContain("EXECUTE pg_catalog.format('SELECT pg_catalog.count(*) FROM public.%I', rel.name) INTO got;");
    expect(POST_CODE).toContain(
      "EXECUTE pg_catalog.format('SELECT CASE WHEN is_called THEN last_value ELSE 0 END FROM public.%I', rel.name) INTO got;",
    );
    expect(POST_CODE.match(/RAISE EXCEPTION/g)!.length).toBeGreaterThanOrEqual(6);
  });

  it("kopia w przód bez zmian: cel tylko 127.0.0.1 i kod 4 dla celu z neon.*", () => {
    const fwd = readFileSync(FORWARD, "utf8").split("\n");
    expect(fwd[124]).toBe('[[ "$TARGET_PGHOST" == "127.0.0.1" ]] || exit 2');
    expect(fwd[229]).toBe('[[ "${NUMS[0]}" == 0 ]] || exit 4');
  });
});

// ---------------------------------------------------------------------------------
describe("copy-cloudsql-to-neon.sh: strumień bez pliku pośredniego", () => {
  it("pg_dump: jedno wywołanie, dokładne flagi (-Fp, trzy wykluczenia), stdout tylko do potoku", () => {
    const dumps = CODE_LINES.filter((l) => /\bpg_dump\s+-/.test(l));
    expect(dumps).toEqual([
      '  pg_dump -w --data-only --schema=public -Fp --exclude-table-data=public.auth_rate_limit --exclude-table-data=public.session --exclude-table-data=public.verification 2>"$DUMP_ERR"',
    ]);
    expect(dumps[0]!.replace(/ 2>"\$DUMP_ERR"$/, "")).not.toMatch(/>|\s-f\b|--file\b|\|/);
    expect(CODE).toMatch(/\n {2}pg_dump [^\n]*\n\) \| \(\n {2}use_addr target\n {2}psql /);
    expect(CODE).not.toMatch(/\btee\b|\bmktemp\b|\bmkfifo\b|\.dump\b|\.pgdump\b/);
  });

  it("udany przebieg: wiersze w kolejności, exit=0, zrzut przeszedł potokiem do psql, w $HOME/secure tylko log", () => {
    const r = run([], { psql: OK });
    expect(r.status, r.stdout).toBe(0);
    expect(r.lines.slice(0, 11)).toEqual([
      ...GATES,
      "fk_cycle_tables=0",
      "source_nonempty_tables=2",
      "truncated_tables=5",
      "dump_exit=0",
      "restore_exit=0",
      "target_frozen_after=yes",
      "loaded=yes",
    ]);
    expect(r.lines[11]).toMatch(/^copy_seconds=\d+$/);
    expect(r.lines[12]).toBe("exit=0");
    expect(r.lines).toHaveLength(13);
    for (const l of r.lines) expect(EMIT.test(l), l).toBe(true);
    expect(r.stderr).toBe("");
    expect(r.psql).toHaveLength(6);
    expect(r.psql[4]!.sql).toBe(PAYLOAD);
    expect(r.secureFiles.every((f) => f.endsWith(".log")), r.secureFiles.join(",")).toBe(true);
    expect(r.secureText).not.toContain(PII);
    expect(r.stdout).not.toContain(PII);
  }, LIMIT);

  it("argumenty strumienia: psql -v expected=<liczby źródła> -f pre -f - -f post (w tej kolejności), pg_dump -Fp", () => {
    const r = run([], { psql: OK });
    expect(r.psql[4]!.args).toEqual([
      "-X",
      "-q",
      "-A",
      "-t",
      "-w",
      "-v",
      "ON_ERROR_STOP=1",
      "-v",
      "VERBOSITY=sqlstate",
      "-v",
      `expected=${EXPECTED}`,
      "-f",
      PRE,
      "-f",
      "-",
      "-f",
      POST,
    ]);
    expect(r.psql[4]!.args).not.toContain("-1");
    expect(r.psql[4]!.args).not.toContain("--single-transaction");
    expect(r.dump!.args).toEqual([
      "-w",
      "--data-only",
      "--schema=public",
      "-Fp",
      "--exclude-table-data=public.auth_rate_limit",
      "--exclude-table-data=public.session",
      "--exclude-table-data=public.verification",
    ]);
  }, LIMIT);

  it("adresy: 1, 3 i pg_dump = źródło; 2, 4, 5, 6 = cel (TARGET_* jako PG*); TARGET_* nigdy w narzędziu", () => {
    const r = run([], { psql: OK });
    expect(r.psql[0]!.sql).toContain("neon_settings=");
    expect(r.psql[1]!.sql).toBe(r.psql[0]!.sql);
    expect(r.psql[5]!.sql).toBe(r.psql[0]!.sql);
    for (const env of [r.psql[1]!.env, r.psql[3]!.env, r.psql[4]!.env, r.psql[5]!.env]) {
      expect(env).toMatch(/^PGHOST=ep-x-1\.eu-central-1\.aws\.neon\.tech$/m);
      expect(env).toMatch(/^PGDATABASE=neondb$/m);
      expect(env).toMatch(/^PGUSER=tgt_owner$/m);
      expect(env).toMatch(/^PGPASSWORD=fake-target-secret$/m);
      expect(env).toMatch(/^PGSSLMODE=verify-full$/m);
      expect(env).not.toMatch(/^PGPORT=/m);
    }
    for (const env of [r.psql[0]!.env, r.psql[2]!.env, r.dump!.env]) {
      expect(env).toMatch(/^PGHOST=127\.0\.0\.1$/m);
      expect(env).toMatch(/^PGPORT=5432$/m);
      expect(env).toMatch(/^PGDATABASE=myhelper$/m);
      expect(env).toMatch(/^PGUSER=src_owner$/m);
      expect(env).toMatch(/^PGPASSWORD=fake-source-secret$/m);
      expect(env).not.toMatch(/^PGSSLMODE=/m);
    }
    for (const env of [...r.psql.map((c) => c.env), r.dump!.env]) {
      expect(env).not.toMatch(/^TARGET_/m);
      expect(env).not.toMatch(/^PGOPTIONS=/m);
      expect(env).toMatch(/^PGPASSFILE=\/dev\/null$/m);
    }
    const allArgs = [...r.psql.flatMap((c) => c.args), ...r.dump!.args];
    for (const a of allArgs) expect(a).not.toMatch(/fake-(source|target)-secret/);
    expect(r.stdout + r.log).not.toMatch(/fake-(source|target)-secret/);
  }, LIMIT);

  it("bez TARGET_PGPASSWORD hasło źródła nie trafia do celu", () => {
    const r = run([], { env: { TARGET_PGPASSWORD: undefined }, psql: OK });
    expect(r.status).toBe(0);
    for (const i of [1, 3, 4, 5]) expect(r.psql[i]!.env).not.toMatch(/^PGPASSWORD=/m);
  }, LIMIT);

  it("cel localhost (tylko CI) z inną bazą przechodzi bez verify-full", () => {
    const r = run([], { env: { TARGET_PGHOST: "localhost", TARGET_PGSSLMODE: undefined }, psql: OK });
    expect(r.status, r.stdout).toBe(0);
  }, LIMIT);
});

// ---------------------------------------------------------------------------------
describe("copy-cloudsql-to-neon.sh: bramki przed zapisem (bez pg_dump)", () => {
  const noDump = (r: Run) => {
    expect(r.dump).toBeNull();
    expect(r.psql.every((c) => !c.args.includes("-f") || c.args[c.args.indexOf("-f") + 1] === "-")).toBe(true);
  };

  it("źródło z ustawieniami neon.* → kod 4", () => {
    const r = run([], { psql: [state(1, 1, 0), TGT_OK] });
    expect(r.status).toBe(4);
    expect(r.lines).toEqual(["exit=4"]);
    expect(r.psql).toHaveLength(2);
    noDump(r);
  }, LIMIT);

  it("cel bez ustawień neon.* → kod 4", () => {
    const r = run([], { psql: [SRC_OK, state(0, 1, 0)] });
    expect(r.status).toBe(4);
    expect(r.lines).toEqual(["exit=4"]);
    noDump(r);
  }, LIMIT);

  it("źródło niezamrożone → source_frozen=no, kod 6", () => {
    const r = run([], { psql: [state(0, 0, 0), TGT_OK] });
    expect(r.status).toBe(6);
    expect(r.lines).toEqual(["source_frozen=no", "exit=6"]);
    noDump(r);
  }, LIMIT);

  it.each([
    ["źródło", state(0, 1, 1), TGT_OK, ["source_role_override=1", "target_role_override=0"]],
    ["cel", SRC_OK, state(2, 1, 2), ["source_role_override=0", "target_role_override=2"]],
  ])("role_override ≠ 0 (%s) → kod 7", (_l, s, t, rows) => {
    const r = run([], { psql: [s, t] });
    expect(r.status).toBe(7);
    expect(r.lines).toEqual(["source_frozen=yes", ...rows, "exit=7"]);
    noDump(r);
  }, LIMIT);

  it("cel niezamrożony → target_frozen=no, kod 8", () => {
    const r = run([], { psql: [SRC_OK, state(2, 0, 0)] });
    expect(r.status).toBe(8);
    expect(r.lines).toEqual([...GATES.slice(0, 3), "target_frozen=no", "exit=8"]);
    noDump(r);
  }, LIMIT);

  it("cykl kluczy obcych w źródle → circular_fk, kod 1", () => {
    const r = run([], { psql: [SRC_OK, TGT_OK, { out: `fk_cycle_tables=2\nsource_nonempty_tables=2\nexpected=${EXPECTED}\n` }] });
    expect(r.status).toBe(1);
    expect(r.lines).toEqual([...GATES, "fk_cycle_tables=2", "error_class=circular_fk", "exit=1"]);
    noDump(r);
  }, LIMIT);

  it("puste źródło → source_nonempty_tables=0, kod 5 (nie zeruje celu)", () => {
    const r = run([], {
      psql: [SRC_OK, TGT_OK, { out: 'fk_cycle_tables=0\nsource_nonempty_tables=0\nexpected={"tables":{},"sequences":{}}\n' }],
    });
    expect(r.status).toBe(5);
    expect(r.lines).toEqual([...GATES, "fk_cycle_tables=0", "source_nonempty_tables=0", "exit=5"]);
    expect(r.psql).toHaveLength(3);
    noDump(r);
  }, LIMIT);

  it.each([
    ["wartość z danymi", `fk_cycle_tables=0\nsource_nonempty_tables=2\nexpected={"tables":{"user":"${PII}"},"sequences":{}}\n`],
    ["nazwa z wielką literą", 'fk_cycle_tables=0\nsource_nonempty_tables=2\nexpected={"tables":{"User":1},"sequences":{}}\n'],
    ["spacje w JSON", 'fk_cycle_tables=0\nsource_nonempty_tables=2\nexpected={"tables": {"user": 1}, "sequences": {}}\n'],
    ["liczba ujemna", 'fk_cycle_tables=0\nsource_nonempty_tables=2\nexpected={"tables":{"user":1},"sequences":{"s":-1}}\n'],
    ["brak wiersza oczekiwanych liczb", "fk_cycle_tables=0\nsource_nonempty_tables=2\n"],
    ["pusty wynik", ""],
    ["dodatkowy wiersz", `fk_cycle_tables=0\nx=1\nsource_nonempty_tables=2\nexpected=${EXPECTED}\n`],
  ])("wynik źródła: %s → rejected_line=1, kod 3, bez zrzutu", (_l, out) => {
    const r = run([], { psql: [SRC_OK, TGT_OK, { out }] });
    expect(r.status).toBe(3);
    expect(r.lines).toEqual([...GATES, "rejected_line=1", "exit=3"]);
    expect(r.stdout).not.toContain(PII);
    noDump(r);
  }, LIMIT);

  it.each([
    ["wartość z danymi", `neon_settings=0\nfrozen=${PII}\nrole_override=0\n`],
    ["brak klucza", "neon_settings=0\nfrozen=1\n"],
    ["dodatkowy wiersz", "neon_settings=0\nfrozen=1\nrole_override=0\nx=1\n"],
  ])("wynik stanu źródła: %s → rejected_line=1, kod 3", (_l, out) => {
    const r = run([], { psql: [{ out }, TGT_OK] });
    expect(r.status).toBe(3);
    expect(r.lines).toEqual(["rejected_line=1", "exit=3"]);
    expect(r.stdout).not.toContain(PII);
    noDump(r);
  }, LIMIT);

  it.each([
    ["źródła", 0],
    ["celu", 1],
  ])("błędne hasło %s (psql kod 2) → error_class=connection, kod 1; komunikat tylko w logu", (_l, at) => {
    const err = `psql: error: connection to server at "127.0.0.1", port 5432 failed: FATAL:  password authentication failed for user "x"\n`;
    const replies: Reply[] = [SRC_OK, TGT_OK];
    replies[at] = { err, rc: 2 };
    const r = run([], { psql: replies });
    expect(r.status).toBe(1);
    expect(r.lines).toEqual(["error_class=connection", "exit=1"]);
    expect(r.stderr).toBe("");
    expect(r.log).toContain("password authentication failed");
    noDump(r);
  }, LIMIT);

  it("brak uprawnienia w źródle (42501) → error_class=other, kod 1, nigdy ciche zero", () => {
    const r = run([], { psql: [SRC_OK, TGT_OK, { err: "psql:<stdin>:20: ERROR:  42501\n", rc: 3 }] });
    expect(r.status).toBe(1);
    expect(r.lines).toEqual([...GATES, "error_class=other", "exit=1"]);
    noDump(r);
  }, LIMIT);
});

// ---------------------------------------------------------------------------------
describe("copy-cloudsql-to-neon.sh: strumień, kody ≠ 0, nigdy cichy sukces", () => {
  const head = [...GATES, "fk_cycle_tables=0", "source_nonempty_tables=2", "truncated_tables=5"];
  const stream = (r: Reply, dump?: Reply) => run([], { psql: [SRC_OK, TGT_OK, DATA_OK, TABLES_OK, r, AFTER_OK], ...(dump ? { dump } : {}) });

  it.each([
    ["bramka kompletności (P0001)", "P0001", "other"],
    ["naruszenie CHECK (23514)", "23514", "other"],
    ["lock_timeout (55P03)", "55P03", "other"],
    ["rola celu bez uprawnień (42501)", "42501", "other"],
    ["unikalność (23505)", "23505", "unique_violation"],
    ["baza tylko do odczytu (25006)", "25006", "read_only"],
  ])("psql strumienia: %s → error_class, kod 1, bez kontroli po zatwierdzeniu", (_l, state0, cls) => {
    const err = `psql:${POST}:30: ERROR:  ${state0}\nDETAIL:  Key (email)=(${PII}) already exists.\n`;
    const r = stream({ err, rc: 3 });
    expect(r.status).toBe(1);
    expect(r.lines).toEqual([...head, "dump_exit=0", "restore_exit=3", `error_class=${cls}`, "exit=1"]);
    expect(r.psql).toHaveLength(5);
    expect(r.stdout).not.toContain(PII);
    expect(r.stderr).toBe("");
    expect(r.log).toContain(PII);
  }, LIMIT);

  it("psql strumienia traci połączenie (kod 2) → error_class=connection, kod 1", () => {
    const r = stream({ err: "psql: error: connection to server was lost\n", rc: 2 });
    expect(r.status).toBe(1);
    expect(r.lines.slice(-2)).toEqual(["error_class=connection", "exit=1"]);
  }, LIMIT);

  it("pg_dump pada w połowie (kod 1), psql kończy się bramką → oba kody, kod 1, bez loaded", () => {
    const r = stream(
      { err: "psql:post:30: ERROR:  P0001\n", rc: 3 },
      { out: PAYLOAD.slice(0, 20), err: "pg_dump: error: Dumping the contents of table failed\n", rc: 1 },
    );
    expect(r.status).toBe(1);
    expect(r.lines).toEqual([...head, "dump_exit=1", "restore_exit=3", "error_class=other", "exit=1"]);
  }, LIMIT);

  it("pg_dump kod ≠ 0 przy psql 0 → nadal kod 1 (pipefail, bez loaded=yes)", () => {
    const r = stream(STREAM_OK, { out: PAYLOAD, rc: 1 });
    expect(r.status).toBe(1);
    expect(r.lines).toEqual([...head, "dump_exit=1", "restore_exit=0", "error_class=other", "exit=1"]);
    expect(r.lines).not.toContain("loaded=yes");
  }, LIMIT);

  it("cel po zatwierdzeniu niezamrożony → target_frozen_after=no, kod 8", () => {
    const r = run([], { psql: [SRC_OK, TGT_OK, DATA_OK, TABLES_OK, STREAM_OK, state(2, 0, 0)] });
    expect(r.status).toBe(8);
    expect(r.lines).toEqual([...head, "dump_exit=0", "restore_exit=0", "target_frozen_after=no", "exit=8"]);
  }, LIMIT);
});

// ---------------------------------------------------------------------------------
describe("copy-cloudsql-to-neon.sh: argumenty i środowisko", () => {
  it("--dry-run: bez połączenia, dry_run=yes, steps=7", () => {
    const r = run(["--dry-run"]);
    expect(r.status).toBe(0);
    expect(r.lines).toEqual(["dry_run=yes", "steps=7", "exit=0"]);
    expect(r.psql).toHaveLength(0);
    expect(r.dump).toBeNull();
  }, LIMIT);

  const REMOTE_SRC: Env = { PGHOST: "10.20.0.3", PGSSLMODE: "verify-full" };
  it.each([
    ["nieznany argument", ["--force"], {}],
    ["pusty argument", [""], {}],
    ["pusty argument po --dry-run", ["--dry-run", ""], {}],
    ["--dry-run=", ["--dry-run="], {}],
    ["URL jako argument", ["postgresql://u:p@127.0.0.1/db"], {}],
    ["brak PGHOST", [], { PGHOST: undefined }],
    ["pusty PGHOST", [], { PGHOST: "" }],
    ["źródło localhost (nie 127.0.0.1)", [], { PGHOST: "localhost" }],
    ["źródło zdalne z verify-full", [], REMOTE_SRC],
    ["źródło = Neon", [], { PGHOST: "ep-x-1.eu-central-1.aws.neon.tech", PGSSLMODE: "verify-full" }],
    ["brak PGUSER", [], { PGUSER: undefined }],
    ["pusty PGDATABASE", [], { PGDATABASE: "" }],
    ["brak TARGET_PGHOST", [], { TARGET_PGHOST: undefined }],
    ["pusty TARGET_PGHOST", [], { TARGET_PGHOST: "" }],
    ["brak TARGET_PGDATABASE", [], { TARGET_PGDATABASE: undefined }],
    ["pusty TARGET_PGUSER", [], { TARGET_PGUSER: "" }],
    ["cel 127.0.0.1 (proxy Cloud SQL)", [], { TARGET_PGHOST: "127.0.0.1" }],
    ["cel 127.0.0.1 bez verify-full", [], { TARGET_PGHOST: "127.0.0.1", TARGET_PGSSLMODE: undefined }],
    ["cel przez pooler", [], { TARGET_PGHOST: "ep-x-1-pooler.eu-central-1.aws.neon.tech" }],
    ["cel z wielkimi literami", [], { TARGET_PGHOST: "ep-x-1-POOLER.eu-central-1.aws.neon.tech" }],
    ["cel zdalny bez verify-full (require)", [], { TARGET_PGSSLMODE: "require" }],
    ["cel zdalny z pustym TARGET_PGSSLMODE", [], { TARGET_PGSSLMODE: "" }],
    ["cel zdalny bez TARGET_PGSSLMODE", [], { TARGET_PGSSLMODE: undefined }],
    ["cel jako URL", [], { TARGET_PGHOST: "postgresql://u:p@h/db" }],
    ["TARGET_PGDATABASE jako connection string", [], { TARGET_PGDATABASE: "host=10.0.0.1 dbname=x" }],
    ["PGDATABASE jako connection string", [], { PGDATABASE: "host=10.0.0.1 dbname=x" }],
    ["PGSERVICE", [], { PGSERVICE: "prod" }],
    ["PGHOSTADDR", [], { PGHOSTADDR: "10.0.0.1" }],
    ["TARGET_PGSERVICE", [], { TARGET_PGSERVICE: "prod" }],
    ["TARGET_PGHOSTADDR", [], { TARGET_PGHOSTADDR: "10.0.0.1" }],
    ["gniazdo unix", [], { PGHOST: "/tmp" }],
    ["lista hostów", [], { TARGET_PGHOST: "ep-x-1.eu-central-1.aws.neon.tech,10.0.0.1" }],
    ["port nieliczbowy", [], { TARGET_PGPORT: "5432x" }],
    ["ta sama baza (localhost ≡ 127.0.0.1, ten sam port)", [], { TARGET_PGHOST: "localhost", TARGET_PGPORT: "5432", TARGET_PGDATABASE: "myhelper" }],
    ["ta sama baza (porty domyślne)", [], { PGPORT: undefined, TARGET_PGHOST: "localhost", TARGET_PGDATABASE: "myhelper" }],
  ])("%s → kod 2, bez połączenia, na ekranie tylko exit=2", (_l, args, env) => {
    const r = run(args, { env, psql: OK });
    expect(r.status).toBe(2);
    expect(r.lines).toEqual(["exit=2"]);
    expect(r.psql).toHaveLength(0);
    expect(r.dump).toBeNull();
  }, LIMIT);
});

// ---------------------------------------------------------------------------------
describe("CI: test wycofania na prawdziwym Postgresie", () => {
  const T = readFileSync(join(ROOT, "__tests__/pg/cutover-copy-reverse.pg.test.ts"), "utf8");

  it("plik testu bramkowany tą samą zmienną co compare (krok `pnpm test:pg` w e2e-smoke)", () => {
    expect(T).toContain('process.env.CUTOVER_COMPARE_PG === "1"');
  });

  it("klient PG z kontenera usługi przez nakładki docker exec, hasło tylko jako nazwa zmiennej", () => {
    expect(T).toContain("exec docker exec -i -e PGHOST=${ip} -e PGPORT=5432 ${pass} ${cid} ${tool} \"$@\"");
    expect(T).not.toMatch(/PGPASSWORD=\$/);
  });

  it("własne bazy i role z prefiksem it_cutover_, sprzątane w afterAll; pos_dev nie jest zamrażana", () => {
    expect(T).toContain("const TAG = `it_cutover_${randomBytes(4).toString(\"hex\")}`;");
    expect(T).toMatch(/afterAll\([\s\S]*DROP DATABASE IF EXISTS \$\{db\} WITH \(FORCE\)[\s\S]*DROP ROLE IF EXISTS/);
    expect(T).not.toMatch(/freeze\("pos_dev"|ALTER DATABASE pos_dev/);
  });

  it("założenia psql 18 sprawdzane wprost: kilka -f w jednej sesji i \\restrict przez -f -", () => {
    expect(T).toContain("(a) psql: -f plik -f - -f plik w jednej sesji i jednej transakcji, w tej kolejności");
    expect(T).toContain("(b) pg_dump -Fp emituje \\\\restrict; restrict bez unrestrict nie blokuje SQL z następnego -f");
  });
});
