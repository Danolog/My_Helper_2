// @vitest-environment node
/**
 * Strażnik skryptów przeniesienia danych i kontroli RLS:
 * infra/db/cutover/copy-neon-to-cloudsql.sh i infra/db/cutover/rls-check.sh.
 * Skrypty są uruchamiane z podstawionymi `psql`, `pg_dump` i `pg_restore`
 * (zapisują argumenty, środowisko PG* i TARGET_*, SQL / strumień ze stdin),
 * więc testy sprawdzają ZACHOWANIE:
 *  - głowica jak compare.sh: `set +x`, `set -euo pipefail`, `umask 077`,
 *    `exec 3>&1 1>>"$LOG" 2>&1` przed pierwszym psql/pg_dump/pg_restore,
 *    `trap … EXIT`, wzorzec emit dokładnie z projektu, echo/printf/>&3 tylko w emit;
 *  - kopia: jeden potok pg_dump | pg_restore bez pliku pośredniego (brak -f,
 *    --file, przekierowania stdout do pliku, tee, mktemp, mkfifo); w $HOME/secure
 *    po przebiegu tylko log, bez treści zrzutu; bez --enable-row-security;
 *    wykluczone dane auth_rate_limit, session, verification;
 *  - kopia: każdy kod ≠ 0 po którejkolwiek stronie potoku = kod 1 (nigdy cichy
 *    sukces); cel niepusty = kod 5 bez zrzutu; cykl kluczy obcych = circular_fk
 *    bez zrzutu; cel z ustawieniami neon.* = kod 4;
 *  - TARGET_* tylko w wywołaniach celu (jako PG*), hasła tylko w środowisku;
 *    cel wyłącznie 127.0.0.1; źródło zdalne tylko z verify-full i bez poolera;
 *  - rls-check: SET ROLE myhelper_app bez kontekstu salonu, liczby 0/0/0,
 *    RESET ROLE, atrybuty myhelper_app no/no/no; każda inna wartość = kod 7.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const ROOT = process.cwd();
const EMIT_RE =
  "^[a-z0-9_]+=([0-9]+|[0-9a-f]{32}|[0-9a-f]{64}|yes|no|unique_violation|fk_violation|exclusion_violation|read_only|circular_fk|connection|other)$";
const EMIT = new RegExp(EMIT_RE);
const PII = "jan.kowalski@example.invalid";
const PAYLOAD = `PGDMP-fake-archive-${PII}`;

const DIR = mkdtempSync(join(tmpdir(), "cutover-copy-"));
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
writeFileSync(
  join(FAKE, "pg_restore"),
  `#!/bin/sh
d="$FAKE_DIR"
printf '%s\\n' "$@" > "$d/pg_restore.args"
env | grep -E '^(PG|TARGET_)' | sort > "$d/pg_restore.env"
cat > "$d/pg_restore.stdin"
[ -f "$d/restore.err" ] && cat "$d/restore.err" >&2
[ -f "$d/restore.rc" ] && exit "$(cat "$d/restore.rc")"
exit 0
`,
);
for (const t of ["psql", "pg_dump", "pg_restore"]) chmodSync(join(FAKE, t), 0o755);

type Env = Record<string, string | undefined>;
type Reply = { out?: string; err?: string; rc?: number };
interface Tool {
  args: string[];
  env: string;
}
interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
  lines: string[];
  psql: { args: string[]; env: string; sql: string }[];
  dump: Tool | null;
  restore: (Tool & { stdin: string }) | null;
  home: string;
  secureFiles: string[];
  secureText: string;
  log: string;
}

let counter = 0;
function run(
  script: string,
  args: string[],
  opts: { env?: Env; base?: Env; psql?: Reply[]; dump?: Reply; restore?: Reply } = {},
): Run {
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
  const restore = opts.restore ?? {};
  if (restore.err !== undefined) writeFileSync(join(d, "restore.err"), restore.err);
  if (restore.rc !== undefined) writeFileSync(join(d, "restore.rc"), String(restore.rc));

  const env: Record<string, string> = {
    PATH: `${FAKE}:${process.env.PATH}`,
    HOME: home,
    FAKE_DIR: d,
    PGOPTIONS: "-c row_security=off",
    PGPASSFILE: join(d, "pgpass"),
  };
  for (const [k, v] of Object.entries({ ...(opts.base ?? {}), ...(opts.env ?? {}) })) {
    if (v !== undefined) env[k] = v;
  }
  const r = spawnSync("bash", [script, ...args], { encoding: "utf8", env: env as NodeJS.ProcessEnv });
  const n = Number(readFileSync(join(d, "n"), "utf8"));
  const psql = Array.from({ length: n }, (_, i) => ({
    args: readFileSync(join(d, `psql-${i + 1}.args`), "utf8").split("\n").filter(Boolean),
    env: readFileSync(join(d, `psql-${i + 1}.env`), "utf8"),
    sql: readFileSync(join(d, `psql-${i + 1}.sql`), "utf8"),
  }));
  const tool = (name: string): Tool | null =>
    existsSync(join(d, `${name}.args`))
      ? {
          args: readFileSync(join(d, `${name}.args`), "utf8").split("\n").filter(Boolean),
          env: readFileSync(join(d, `${name}.env`), "utf8"),
        }
      : null;
  const rt = tool("pg_restore");
  const secure = join(home, "secure");
  const secureFiles = existsSync(secure) ? readdirSync(secure) : [];
  const secureText = secureFiles.map((f) => readFileSync(join(secure, f), "utf8")).join("\n");
  return {
    status: r.status,
    stdout: r.stdout,
    stderr: r.stderr,
    lines: r.stdout.split("\n").filter(Boolean),
    psql,
    dump: tool("pg_dump"),
    restore: rt ? { ...rt, stdin: readFileSync(join(d, "pg_restore.stdin"), "utf8") } : null,
    home,
    secureFiles,
    secureText,
    log: secureFiles
      .filter((f) => f.endsWith(".log"))
      .map((f) => readFileSync(join(secure, f), "utf8"))
      .join("\n"),
  };
}

function source(script: string) {
  const SOURCE = readFileSync(script, "utf8");
  const LINES = SOURCE.split("\n");
  const CODE_LINES = LINES.filter((l) => !l.trim().startsWith("#"));
  const CODE = CODE_LINES.join("\n");
  const sqlBlocks = [...SOURCE.matchAll(/<<'SQL'\n([\s\S]*?)\nSQL\n/g)].map((m) => m[1]!);
  return { SOURCE, LINES, CODE_LINES, CODE, sqlBlocks };
}

function headChecks(script: string, logPrefix: string) {
  const { SOURCE, LINES, CODE_LINES, CODE } = source(script);
  describe("głowica trybu D", () => {
    it("pierwsze polecenia: set +x, set -euo pipefail, umask 077", () => {
      expect(LINES[0]).toBe("#!/usr/bin/env bash");
      expect(CODE_LINES.filter((l) => l.trim() !== "").slice(0, 3)).toEqual(["set +x", "set -euo pipefail", "umask 077"]);
    });

    it("exec 3>&1 1>>\"$LOG\" 2>&1 przed pierwszym psql/pg_dump/pg_restore/cloud-sql-proxy; log w $HOME/secure", () => {
      const execAt = CODE.indexOf('exec 3>&1 1>>"$LOG" 2>&1\n');
      expect(execAt).toBeGreaterThan(0);
      for (const tool of [/\bpsql /, /\bpg_dump /, /\bpg_restore /, /\bcloud-sql-proxy\b/]) {
        const m = tool.exec(CODE);
        if (m) expect(m.index, String(tool)).toBeGreaterThan(execAt);
      }
      expect(SOURCE).toContain(`BASE="$HOME/secure/${logPrefix}-$(date -u +%Y%m%dT%H%M%SZ)-$$"\n`);
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

    it("trap … EXIT po exec i przed pierwszym psql", () => {
      const trapAt = CODE.search(/trap 'rc=\$\?; rm -f "\$ERRF"[^']*; emit exit "\$rc"' EXIT\n/);
      expect(trapAt).toBeGreaterThan(CODE.indexOf('exec 3>&1 1>>"$LOG" 2>&1'));
      expect(trapAt).toBeLessThan(/\bpsql -X/.exec(CODE)!.index);
    });

    it("jedno wywołanie psql z -X -q -A -t -w -v ON_ERROR_STOP=1 -v VERBOSITY=sqlstate", () => {
      const calls = CODE_LINES.filter((l) => /\bpsql\s+-/.test(l));
      expect(calls).toHaveLength(1);
      expect(calls[0]).toContain("psql -X -q -A -t -w -v ON_ERROR_STOP=1 -v VERBOSITY=sqlstate");
      expect(calls[0]).toContain(' -f - 2>"$ERRF"');
    });

    it("brak --enable-row-security, .pgpass, gcloud i adresów e-mail", () => {
      expect(CODE).not.toMatch(/--enable-row-security|\.pgpass|\bgcloud\b/);
      expect(SOURCE).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/);
    });
  });
}

// ---------------------------------------------------------------------------------
describe("copy-neon-to-cloudsql.sh", () => {
  const SCRIPT = join(ROOT, "infra/db/cutover/copy-neon-to-cloudsql.sh");
  const { CODE, CODE_LINES, sqlBlocks } = source(SCRIPT);
  const BASE_ENV: Env = {
    PGHOST: "127.0.0.1",
    PGPORT: "5432",
    PGDATABASE: "neondb",
    PGUSER: "src_owner",
    PGPASSWORD: "fake-source-secret",
    TARGET_PGHOST: "127.0.0.1",
    TARGET_PGPORT: "5433",
    TARGET_PGDATABASE: "myhelper",
    TARGET_PGUSER: "tgt_owner",
    TARGET_PGPASSWORD: "fake-target-secret",
  };
  const REMOTE: Env = { PGHOST: "ep-x-1.eu-central-1.aws.neon.tech", PGSSLMODE: "verify-full" };
  const TARGET_OK: Reply = { out: "neon_settings=0\ntarget_nonempty_tables=0\n" };
  const NO_CYCLES: Reply = { out: "fk_cycle_tables=0\n" };
  const OK = [TARGET_OK, NO_CYCLES];
  const go = (args: string[] = [], o: Parameters<typeof run>[2] = {}) => run(SCRIPT, args, { base: BASE_ENV, ...o });

  headChecks(SCRIPT, "cutover-copy");

  describe("strumień bez pliku pośredniego", () => {
    it("pg_dump i pg_restore: po jednym wywołaniu, dokładne flagi, stdout pg_dump tylko do potoku", () => {
      const dumps = CODE_LINES.filter((l) => /\bpg_dump\s+-/.test(l));
      const restores = CODE_LINES.filter((l) => /\bpg_restore\s+-/.test(l));
      expect(dumps).toEqual([
        '  pg_dump -w --data-only --schema=public -Fc --exclude-table-data=public.auth_rate_limit --exclude-table-data=public.session --exclude-table-data=public.verification 2>"$DUMP_ERR"',
      ]);
      expect(restores).toEqual([
        '  pg_restore -w --data-only --single-transaction --exit-on-error --dbname="$PGDATABASE" 2>"$RESTORE_ERR"',
      ]);
      // Poza stderr do pliku żadnego przekierowania (stdout zrzutu nie trafia do pliku).
      for (const l of [...dumps, ...restores]) {
        const rest = l.replace(/ 2>"\$(DUMP|RESTORE)_ERR"$/, "");
        expect(rest).not.toMatch(/>|\s-f\b|--file\b|\|/);
      }
      // Potok: podpowłoka pg_dump kończy się `) | (`, a następna to pg_restore.
      expect(CODE).toMatch(/\n {2}pg_dump [^\n]*\n\) \| \(\n {2}use_addr target\n {2}pg_restore /);
    });

    it("brak tee, mktemp, mkfifo i plików na zrzut w całym skrypcie", () => {
      expect(CODE).not.toMatch(/\btee\b|\bmktemp\b|\bmkfifo\b|\.dump\b|\.pgdump\b|\.sql"/);
    });

    it("udany przebieg: wiersze w kolejności, exit=0, archiwum przeszło potokiem, w $HOME/secure tylko log", () => {
      const r = go([], { psql: OK });
      expect(r.status, r.stdout).toBe(0);
      expect(r.lines.slice(0, 5)).toEqual([
        "target_nonempty_tables=0",
        "fk_cycle_tables=0",
        "dump_exit=0",
        "restore_exit=0",
        "copied=yes",
      ]);
      expect(r.lines[5]).toMatch(/^copy_seconds=\d+$/);
      expect(r.lines[6]).toBe("exit=0");
      expect(r.lines).toHaveLength(7);
      for (const l of r.lines) expect(EMIT.test(l), l).toBe(true);
      expect(r.stderr).toBe("");
      // Treść zrzutu tylko w potoku: dotarła do pg_restore, nie ma jej w żadnym pliku.
      expect(r.restore!.stdin).toBe(PAYLOAD);
      expect(r.secureFiles.every((f) => f.endsWith(".log")), r.secureFiles.join(",")).toBe(true);
      expect(r.secureText).not.toContain(PAYLOAD);
      expect(r.stdout).not.toContain(PII);
    });

    it("flagi w przebiegu: wykluczone 3 tabele, pojedyncza transakcja, --dbname celu, bez --enable-row-security", () => {
      const r = go([], { psql: OK });
      expect(r.dump!.args).toEqual([
        "-w",
        "--data-only",
        "--schema=public",
        "-Fc",
        "--exclude-table-data=public.auth_rate_limit",
        "--exclude-table-data=public.session",
        "--exclude-table-data=public.verification",
      ]);
      expect(r.restore!.args).toEqual(["-w", "--data-only", "--single-transaction", "--exit-on-error", "--dbname=myhelper"]);
      expect([...r.dump!.args, ...r.restore!.args].join(" ")).not.toContain("--enable-row-security");
    });

    it("adresy: wywołanie 1 i pg_restore = cel (TARGET_* jako PG*), wywołanie 2 i pg_dump = źródło; TARGET_* nigdy w narzędziu", () => {
      const r = go([], { psql: OK });
      expect(r.psql).toHaveLength(2);
      for (const env of [r.psql[0]!.env, r.restore!.env]) {
        expect(env).toMatch(/^PGHOST=127\.0\.0\.1$/m);
        expect(env).toMatch(/^PGPORT=5433$/m);
        expect(env).toMatch(/^PGDATABASE=myhelper$/m);
        expect(env).toMatch(/^PGUSER=tgt_owner$/m);
        expect(env).toMatch(/^PGPASSWORD=fake-target-secret$/m);
      }
      for (const env of [r.psql[1]!.env, r.dump!.env]) {
        expect(env).toMatch(/^PGDATABASE=neondb$/m);
        expect(env).toMatch(/^PGUSER=src_owner$/m);
        expect(env).toMatch(/^PGPASSWORD=fake-source-secret$/m);
      }
      for (const env of [r.psql[0]!.env, r.psql[1]!.env, r.dump!.env, r.restore!.env]) {
        expect(env).not.toMatch(/^TARGET_/m);
        expect(env).not.toMatch(/^PGOPTIONS=/m);
        expect(env).toMatch(/^PGPASSFILE=\/dev\/null$/m);
      }
      const allArgs = [...r.psql.flatMap((c) => c.args), ...r.dump!.args, ...r.restore!.args];
      for (const a of allArgs) expect(a).not.toMatch(/fake-(source|target)-secret/);
      expect(r.stdout + r.log).not.toMatch(/fake-(source|target)-secret/);
    });

    it("bez TARGET_PGPASSWORD hasło źródła nie trafia do celu", () => {
      const r = go([], { env: { TARGET_PGPASSWORD: undefined }, psql: OK });
      expect(r.status).toBe(0);
      expect(r.psql[0]!.env).not.toMatch(/^PGPASSWORD=/m);
      expect(r.restore!.env).not.toMatch(/^PGPASSWORD=/m);
    });

    it("źródło zdalne z verify-full przechodzi; cel bez PGSSLMODE źródła", () => {
      const r = go([], { env: REMOTE, psql: OK });
      expect(r.status, r.stdout).toBe(0);
      expect(r.dump!.env).toMatch(/^PGSSLMODE=verify-full$/m);
      expect(r.restore!.env).not.toMatch(/^PGSSLMODE=/m);
    });
  });

  describe("SQL: tylko odczyt", () => {
    it("dwa bloki SQL, oba READ ONLY, bez zapisów", () => {
      expect(sqlBlocks).toHaveLength(2);
      for (const b of sqlBlocks) {
        expect(b).toMatch(/^BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\n/);
        expect(b).toMatch(/\nCOMMIT;$/);
        expect(b).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|COPY|VACUUM)\b/i);
      }
      expect(sqlBlocks[0]).toContain("SET LOCAL row_security = off;");
      expect(sqlBlocks[0]).toContain("FROM pg_settings WHERE name LIKE 'neon.%'");
      expect(sqlBlocks[1]).toContain("WHERE c.contype = 'f' AND sn.nspname = 'public' AND dn.nspname = 'public'");
    });
  });

  describe("kody ≠ 0, nigdy cichy sukces", () => {
    it("cel niepusty → target_nonempty_tables=n, kod 5, bez zrzutu", () => {
      const r = go([], { psql: [{ out: "neon_settings=0\ntarget_nonempty_tables=3\n" }, NO_CYCLES] });
      expect(r.status).toBe(5);
      expect(r.lines).toEqual(["target_nonempty_tables=3", "exit=5"]);
      expect(r.psql).toHaveLength(1);
      expect(r.dump).toBeNull();
      expect(r.restore).toBeNull();
    });

    it("cel z ustawieniami neon.* → kod 4, bez zrzutu", () => {
      const r = go([], { psql: [{ out: "neon_settings=2\ntarget_nonempty_tables=0\n" }] });
      expect(r.status).toBe(4);
      expect(r.lines).toEqual(["exit=4"]);
      expect(r.dump).toBeNull();
    });

    it("cykl kluczy obcych w źródle → fk_cycle_tables=n, error_class=circular_fk, kod 1, bez zrzutu", () => {
      const r = go([], { psql: [TARGET_OK, { out: "fk_cycle_tables=2\n" }] });
      expect(r.status).toBe(1);
      expect(r.lines).toEqual(["target_nonempty_tables=0", "fk_cycle_tables=2", "error_class=circular_fk", "exit=1"]);
      expect(r.dump).toBeNull();
    });

    it("pg_dump pada w połowie (kod 1) → dump_exit=1, kod 1, bez copied", () => {
      const r = go([], {
        psql: OK,
        dump: { out: PAYLOAD.slice(0, 10), err: "pg_dump: error: Dumping the contents of table failed\n", rc: 1 },
        restore: { err: "pg_restore: error: could not read from input file: end of file\n", rc: 1 },
      });
      expect(r.status).toBe(1);
      expect(r.lines).toEqual([
        "target_nonempty_tables=0",
        "fk_cycle_tables=0",
        "dump_exit=1",
        "restore_exit=1",
        "error_class=other",
        "exit=1",
      ]);
    });

    it("pg_dump kod ≠ 0 przy pg_restore 0 → nadal kod 1 (pipefail, bez copied=yes)", () => {
      const r = go([], { psql: OK, dump: { out: PAYLOAD, rc: 1 } });
      expect(r.status).toBe(1);
      expect(r.lines).toContain("dump_exit=1");
      expect(r.lines).toContain("restore_exit=0");
      expect(r.lines).not.toContain("copied=yes");
    });

    it("pg_restore kod ≠ 0 przy pg_dump 0 → kod 1", () => {
      const r = go([], { psql: OK, restore: { err: "pg_restore: error: permission denied for table clients\n", rc: 1 } });
      expect(r.status).toBe(1);
      expect(r.lines.slice(-4)).toEqual(["dump_exit=0", "restore_exit=1", "error_class=other", "exit=1"]);
    });

    it.each([
      ["duplicate key value violates unique constraint \"user_email_unique\"", "unique_violation"],
      ["insert or update on table \"a\" violates foreign key constraint \"a_b_fk\"", "fk_violation"],
      ["conflicting key value violates exclusion constraint \"appointments_no_overlap\"", "exclusion_violation"],
      ["cannot execute COPY in a read-only transaction", "read_only"],
      ["connection to server at \"127.0.0.1\", port 5433 failed", "connection"],
    ])("pg_restore: %s → error_class=%s; DETAIL z wartością tylko w logu", (msg, cls) => {
      const err = `pg_restore: error: COPY failed: ERROR:  ${msg}\nDETAIL:  Key (email)=(${PII}) already exists.\n`;
      const r = go([], { psql: OK, restore: { err, rc: 1 } });
      expect(r.status).toBe(1);
      expect(r.lines.slice(-2)).toEqual([`error_class=${cls}`, "exit=1"]);
      expect(r.stdout).not.toContain(PII);
      expect(r.stderr).toBe("");
      expect(r.log).toContain(PII);
    });

    it("ostrzeżenie pg_dump o cyklu kluczy obcych mimo kroku 2 → circular_fk, kod 1", () => {
      const r = go([], {
        psql: OK,
        dump: { out: PAYLOAD, err: "pg_dump: warning: there are circular foreign-key constraints on this table:\n" },
      });
      expect(r.status).toBe(1);
      expect(r.lines.slice(-2)).toEqual(["error_class=circular_fk", "exit=1"]);
      expect(r.lines).not.toContain("copied=yes");
    });

    it("błędne hasło celu (psql kod 2) → error_class=connection, kod 1, bez zrzutu", () => {
      const err = `psql: error: connection to server at "127.0.0.1", port 5433 failed: FATAL:  password authentication failed for user "tgt_owner"\n`;
      const r = go([], { psql: [{ err, rc: 2 }] });
      expect(r.status).toBe(1);
      expect(r.lines).toEqual(["error_class=connection", "exit=1"]);
      expect(r.stderr).toBe("");
      expect(r.log).toContain("password authentication failed");
      expect(r.dump).toBeNull();
    });

    it("błąd SQL źródła (42501) → error_class=other, kod 1, bez zrzutu", () => {
      const r = go([], { psql: [TARGET_OK, { err: "psql:<stdin>:2: ERROR:  42501\n", rc: 3 }] });
      expect(r.status).toBe(1);
      expect(r.lines).toEqual(["target_nonempty_tables=0", "error_class=other", "exit=1"]);
      expect(r.dump).toBeNull();
    });

    it.each([
      ["wartość z danymi", `neon_settings=0\ntarget_nonempty_tables=${PII}\n`],
      ["pusty wynik", ""],
      ["brak klucza", "target_nonempty_tables=0\n"],
      ["dodatkowy wiersz", "neon_settings=0\ntarget_nonempty_tables=0\nx=1\n"],
    ])("wynik celu: %s → rejected_line=1, kod 3, bez zrzutu", (_l, out) => {
      const r = go([], { psql: [{ out }, NO_CYCLES] });
      expect(r.status).toBe(3);
      expect(r.lines).toEqual(["rejected_line=1", "exit=3"]);
      expect(r.stdout).not.toContain(PII);
      expect(r.dump).toBeNull();
    });
  });

  describe("argumenty i środowisko", () => {
    it("--dry-run: bez połączenia, dry_run=yes, steps=3", () => {
      const r = go(["--dry-run"]);
      expect(r.status).toBe(0);
      expect(r.lines).toEqual(["dry_run=yes", "steps=3", "exit=0"]);
      expect(r.psql).toHaveLength(0);
      expect(r.dump).toBeNull();
    });

    it.each([
      ["nieznany argument", ["--force"], {}],
      ["pusty argument", [""], {}],
      ["--dry-run=", ["--dry-run="], {}],
      ["URL jako argument", ["postgresql://u:p@127.0.0.1/db"], {}],
      ["brak PGHOST", [], { PGHOST: undefined }],
      ["pusty PGHOST", [], { PGHOST: "" }],
      ["brak PGUSER", [], { PGUSER: undefined }],
      ["brak TARGET_PGHOST", [], { TARGET_PGHOST: undefined }],
      ["pusty TARGET_PGHOST", [], { TARGET_PGHOST: "" }],
      ["brak TARGET_PGDATABASE", [], { TARGET_PGDATABASE: undefined }],
      ["pusty TARGET_PGUSER", [], { TARGET_PGUSER: "" }],
      ["cel localhost (nie 127.0.0.1)", [], { TARGET_PGHOST: "localhost" }],
      ["cel zdalny", [], { TARGET_PGHOST: "10.20.0.3", TARGET_PGSSLMODE: "verify-full" }],
      ["cel jako URL", [], { TARGET_PGHOST: "postgresql://u:p@h/db" }],
      ["TARGET_PGDATABASE jako connection string", [], { TARGET_PGDATABASE: "host=10.0.0.1 dbname=x" }],
      ["PGDATABASE jako connection string", [], { PGDATABASE: "host=10.0.0.1 dbname=x" }],
      ["PGSERVICE", [], { PGSERVICE: "prod" }],
      ["PGHOSTADDR", [], { PGHOSTADDR: "10.0.0.1" }],
      ["TARGET_PGSERVICE", [], { TARGET_PGSERVICE: "prod" }],
      ["TARGET_PGHOSTADDR", [], { TARGET_PGHOSTADDR: "10.0.0.1" }],
      ["gniazdo unix", [], { PGHOST: "/tmp" }],
      ["lista hostów", [], { PGHOST: "127.0.0.1,10.0.0.1" }],
      ["port nieliczbowy", [], { TARGET_PGPORT: "5433x" }],
      ["źródło zdalne bez verify-full", [], { ...REMOTE, PGSSLMODE: "require" }],
      ["źródło zdalne z pustym PGSSLMODE", [], { ...REMOTE, PGSSLMODE: "" }],
      ["źródło zdalne przez pooler", [], { ...REMOTE, PGHOST: "ep-x-1-pooler.eu-central-1.aws.neon.tech" }],
      ["źródło z wielkimi literami", [], { ...REMOTE, PGHOST: "ep-x-1-POOLER.eu-central-1.aws.neon.tech" }],
      ["źródło = cel (ten sam host, port, baza)", [], { PGPORT: "5433", PGDATABASE: "myhelper" }],
      ["źródło = cel (porty domyślne)", [], { PGPORT: undefined, TARGET_PGPORT: undefined, PGDATABASE: "myhelper" }],
    ])("%s → kod 2, bez połączenia, na ekranie tylko exit=2", (_l, args, env) => {
      const r = go(args, { env, psql: OK });
      expect(r.status).toBe(2);
      expect(r.lines).toEqual(["exit=2"]);
      expect(r.psql).toHaveLength(0);
      expect(r.dump).toBeNull();
      expect(r.restore).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------------
describe("rls-check.sh", () => {
  const SCRIPT = join(ROOT, "infra/db/cutover/rls-check.sh");
  const { CODE, sqlBlocks } = source(SCRIPT);
  const BASE_ENV: Env = {
    PGHOST: "127.0.0.1",
    PGPORT: "5433",
    PGDATABASE: "myhelper",
    PGUSER: "tgt_owner",
    PGPASSWORD: "fake-target-secret",
  };
  const KEYS = [
    "salon_context_empty",
    "app_role_active",
    "app_visible_clients",
    "app_visible_appointments",
    "app_visible_salons",
    "app_role_reset",
    "app_rolcanlogin",
    "app_rolbypassrls",
    "app_rolsuper",
  ];
  const GOOD = ["yes", "yes", "0", "0", "0", "yes", "no", "no", "no"];
  const out = (vals: string[]) => `${KEYS.map((k, i) => `${k}=${vals[i]}`).join("\n")}\n`;
  const go = (args: string[] = [], o: Parameters<typeof run>[2] = {}) => run(SCRIPT, args, { base: BASE_ENV, ...o });

  headChecks(SCRIPT, "cutover-rls-check");

  it("SQL: jeden blok READ ONLY; SET ROLE myhelper_app bez kontekstu salonu, potem RESET ROLE i pg_roles", () => {
    expect(sqlBlocks).toHaveLength(1);
    const b = sqlBlocks[0]!;
    expect(b).toMatch(/^BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\n/);
    expect(b).toMatch(/\nCOMMIT;$/);
    expect(b).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|COPY)\b/i);
    // Bez ustawiania kontekstu salonu (set_config / SET app.*).
    expect(b).not.toMatch(/set_config|SET (LOCAL )?app\./i);
    const at = (s: string) => b.indexOf(s);
    expect(at("SET ROLE myhelper_app;")).toBeGreaterThan(at("'salon_context_empty='"));
    for (const t of ["clients", "appointments", "salons"]) {
      expect(at(`FROM public.${t};`), t).toBeGreaterThan(at("SET ROLE myhelper_app;"));
      expect(at(`FROM public.${t};`), t).toBeLessThan(at("RESET ROLE;"));
    }
    expect(at("SET LOCAL row_security = on;")).toBeGreaterThan(at("SET ROLE myhelper_app;"));
    expect(at("FROM pg_roles WHERE rolname = 'myhelper_app'")).toBeGreaterThan(at("RESET ROLE;"));
    expect(CODE).not.toMatch(/\bpg_dump\b|\bpg_restore\b/);
  });

  it("udany przebieg: dziewięć wierszy, rls_fail_closed=yes, exit=0", () => {
    const r = go([], { psql: [{ out: out(GOOD) }] });
    expect(r.status, r.stdout).toBe(0);
    expect(r.lines).toEqual([...KEYS.map((k, i) => `${k}=${GOOD[i]}`), "rls_fail_closed=yes", "exit=0"]);
    expect(r.stderr).toBe("");
    expect(r.psql).toHaveLength(1);
    expect(r.psql[0]!.env).toMatch(/^PGPASSFILE=\/dev\/null$/m);
    expect(r.psql[0]!.env).not.toMatch(/^PGOPTIONS=/m);
    for (const a of r.psql[0]!.args) expect(a).not.toContain("fake-target-secret");
  });

  it.each(KEYS.map((k, i) => [k, i] as const))("%s z wartością inną niż oczekiwana → rls_fail_closed=no, kod 7", (_k, i) => {
    const vals = [...GOOD];
    vals[i] = GOOD[i] === "yes" ? "no" : GOOD[i] === "no" ? "yes" : "4";
    const r = go([], { psql: [{ out: out(vals) }] });
    expect(r.status).toBe(7);
    expect(r.lines.slice(-2)).toEqual(["rls_fail_closed=no", "exit=7"]);
  });

  it.each([
    ["wartość z danymi", out(GOOD).replace("app_visible_salons=0", `app_visible_salons=${PII}`)],
    ["pusty wynik", ""],
    ["brak wiersza atrybutów (rola nie istnieje)", out(GOOD).split("\n").slice(0, 6).join("\n") + "\n"],
    ["zła kolejność", out(GOOD).replace("app_visible_clients=0\napp_visible_appointments=0", "app_visible_appointments=0\napp_visible_clients=0")],
    ["dodatkowy wiersz", `${out(GOOD)}x=1\n`],
  ])("wynik: %s → rejected_line=1, kod 3, wartość nie na ekranie", (_l, o) => {
    const r = go([], { psql: [{ out: o }] });
    expect(r.status).toBe(3);
    expect(r.lines).toEqual(["rejected_line=1", "exit=3"]);
    expect(r.stdout).not.toContain(PII);
  });

  it("brak uprawnienia (42501) → error_class=other, kod 1, nigdy ciche 0", () => {
    const r = go([], { psql: [{ err: "psql:<stdin>:3: ERROR:  42501\n", rc: 3 }] });
    expect(r.status).toBe(1);
    expect(r.lines).toEqual(["error_class=other", "exit=1"]);
  });

  it("błędne hasło → error_class=connection, kod 1; komunikat tylko w logu", () => {
    const err = `psql: error: connection to server at "127.0.0.1", port 5433 failed: FATAL:  password authentication failed for user "tgt_owner"\n`;
    const r = go([], { psql: [{ err, rc: 2 }] });
    expect(r.status).toBe(1);
    expect(r.lines).toEqual(["error_class=connection", "exit=1"]);
    expect(r.stderr).toBe("");
    expect(r.log).toContain("password authentication failed");
  });

  it("--dry-run: bez połączenia, dry_run=yes, steps=1", () => {
    const r = go(["--dry-run"]);
    expect(r.lines).toEqual(["dry_run=yes", "steps=1", "exit=0"]);
    expect(r.psql).toHaveLength(0);
  });

  it.each([
    ["nieznany argument", ["--force"], {}],
    ["pusty argument", [""], {}],
    ["URL jako argument", ["postgresql://u:p@127.0.0.1/db"], {}],
    ["brak PGHOST", [], { PGHOST: undefined }],
    ["pusty PGHOST", [], { PGHOST: "" }],
    ["localhost (nie 127.0.0.1)", [], { PGHOST: "localhost" }],
    ["host zdalny z verify-full", [], { PGHOST: "10.20.0.3", PGSSLMODE: "verify-full" }],
    ["Neon", [], { PGHOST: "ep-x-1.eu-central-1.aws.neon.tech", PGSSLMODE: "verify-full" }],
    ["PGSERVICE", [], { PGSERVICE: "prod" }],
    ["PGHOSTADDR", [], { PGHOSTADDR: "10.0.0.1" }],
    ["PGDATABASE jako connection string", [], { PGDATABASE: "host=10.0.0.1 dbname=x" }],
    ["brak PGUSER", [], { PGUSER: undefined }],
    ["port nieliczbowy", [], { PGPORT: "5433x" }],
  ])("%s → kod 2, bez połączenia, na ekranie tylko exit=2", (_l, args, env) => {
    const r = go(args, { env, psql: [{ out: out(GOOD) }] });
    expect(r.status).toBe(2);
    expect(r.lines).toEqual(["exit=2"]);
    expect(r.psql).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------------
describe("CI: test kopii i rls-check na prawdziwym Postgresie", () => {
  const T = readFileSync(join(ROOT, "__tests__/pg/cutover-copy.pg.test.ts"), "utf8");

  it("plik testu bramkowany tą samą zmienną co compare (krok `pnpm test:pg` w e2e-smoke)", () => {
    expect(T).toContain('process.env.CUTOVER_COMPARE_PG === "1"');
  });

  it("klient PG z kontenera usługi przez nakładki docker exec, hasło tylko jako nazwa zmiennej", () => {
    expect(T).toContain("exec docker exec -i -e PGHOST=${ip} -e PGPORT=5432 ${pass} ${cid} ${tool} \"$@\"");
    expect(T).not.toMatch(/PGPASSWORD=\$/);
  });

  it("własne bazy i role z prefiksem it_cutover_, sprzątane w afterAll; BYPASSRLS cofane w finally", () => {
    expect(T).toContain("const TAG = `it_cutover_${randomBytes(4).toString(\"hex\")}`;");
    expect(T).toMatch(/afterAll\([\s\S]*DROP DATABASE IF EXISTS \$\{db\} WITH \(FORCE\)[\s\S]*DROP ROLE IF EXISTS/);
    expect(T).toMatch(/ALTER ROLE myhelper_app BYPASSRLS[\s\S]*?\} finally \{\s*\n\s*await h\.observer\.unsafe\("ALTER ROLE myhelper_app NOBYPASSRLS"\)/);
  });
});
