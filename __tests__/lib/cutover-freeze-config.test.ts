// @vitest-environment node
/**
 * Strażnik skryptów zamrożenia i odmrożenia bazy źródłowej:
 * infra/db/cutover/freeze-neon.sh i infra/db/cutover/unfreeze-neon.sh.
 * Skrypty są uruchamiane z podstawionym `psql` (zapisuje argumenty, środowisko
 * PG* i VERIFY_*, treść SQL ze stdin), więc testy sprawdzają ZACHOWANIE:
 *  - głowica jak compare.sh: `set +x`, `set -euo pipefail`, `umask 077`,
 *    `exec 3>&1 1>>"$LOG" 2>&1` przed pierwszym psql, `trap … EXIT`, wzorzec emit
 *    dokładnie z projektu, echo/printf/>&3 tylko w emit;
 *  - zrywanie PO BAZIE: filtr `datname = current_database() AND pid <> pg_backend_pid()`
 *    + wykluczenie superużytkownika (rolsuper); żadnego filtra po nazwie roli
 *    (`usename`, `rolname`, `myhelper_app`); jedno pg_terminate_backend;
 *  - role_override ≠ 0 → kod 7 bez ALTER DATABASE; kontrola widoczności
 *    w osobnym wywołaniu przed ALTER (wiersz stats_visible=1), więc odmowa
 *    widoczności i odmowa zerwania dają różne wiersze; terminated <
 *    backends_before → kod 8 bez testu zapisu;
 *  - test zapisu: nowe połączenie adresem VERIFY_* (przekazanym do psql jako PG*),
 *    freeze oczekuje 25006, unfreeze sukcesu; inaczej kod 9, nigdy cichy sukces;
 *  - VERIFY_* nie trafia do wywołań administracyjnych, hasła tylko w środowisku;
 *  - odrzucenie URL, PGSERVICE, PGHOSTADDR, gniazda, hosta zdalnego bez
 *    verify-full, poolera jako adresu administracyjnego, zdalnego adresu
 *    aplikacji bez poolera i adresu aplikacji z innego endpointu niż adres
 *    administracyjny.
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
const FILTER = "WHERE datname = current_database() AND pid <> pg_backend_pid()";
const PII = "jan.kowalski@example.invalid";

const DIR = mkdtempSync(join(tmpdir(), "cutover-freeze-"));
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
env | grep -E '^(PG|VERIFY_)' | sort > "$d/psql-$n.env"
cat > "$d/psql-$n.sql"
[ -f "$d/err-$n" ] && cat "$d/err-$n" >&2
[ -f "$d/out-$n" ] && cat "$d/out-$n"
[ -f "$d/rc-$n" ] && exit "$(cat "$d/rc-$n")"
exit 0
`,
);
chmodSync(join(FAKE, "psql"), 0o755);

type Env = Record<string, string | undefined>;
const ENV_LOCAL: Env = {
  PGHOST: "127.0.0.1",
  PGPORT: "5432",
  PGDATABASE: "neondb",
  PGUSER: "owner_role",
  PGPASSWORD: "fake-admin-secret",
  VERIFY_PGHOST: "127.0.0.1",
  VERIFY_PGPORT: "5432",
  VERIFY_PGDATABASE: "neondb",
  VERIFY_PGUSER: "app_login",
  VERIFY_PGPASSWORD: "fake-verify-secret",
};
const ENV_REMOTE: Env = {
  PGHOST: "ep-x-1.eu-central-1.aws.neon.tech",
  PGSSLMODE: "verify-full",
  VERIFY_PGHOST: "ep-x-1-pooler.eu-central-1.aws.neon.tech",
  VERIFY_PGSSLMODE: "verify-full",
};

type Reply = { out?: string; err?: string; rc?: number };
interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
  lines: string[];
  psql: { args: string[]; env: string; sql: string }[];
  home: string;
  log: string;
}

let counter = 0;
function run(script: string, args: string[], opts: { env?: Env; psql?: Reply[] } = {}): Run {
  const d = join(DIR, `run-${counter++}`);
  const home = join(d, "home");
  mkdirSync(home, { recursive: true });
  writeFileSync(join(d, "n"), "0");
  (opts.psql ?? []).forEach((r, i) => {
    if (r.out !== undefined) writeFileSync(join(d, `out-${i + 1}`), r.out);
    if (r.err !== undefined) writeFileSync(join(d, `err-${i + 1}`), r.err);
    if (r.rc !== undefined) writeFileSync(join(d, `rc-${i + 1}`), String(r.rc));
  });
  const env: Record<string, string> = {
    PATH: `${FAKE}:${process.env.PATH}`,
    HOME: home,
    FAKE_DIR: d,
    PGOPTIONS: "-c default_transaction_read_only=off",
    PGPASSFILE: join(d, "pgpass"),
  };
  for (const [k, v] of Object.entries({ ...ENV_LOCAL, ...(opts.env ?? {}) })) {
    if (v !== undefined) env[k] = v;
  }
  const r = spawnSync("bash", [script, ...args], { encoding: "utf8", env: env as NodeJS.ProcessEnv });
  const n = Number(readFileSync(join(d, "n"), "utf8"));
  const psql = Array.from({ length: n }, (_, i) => ({
    args: readFileSync(join(d, `psql-${i + 1}.args`), "utf8").split("\n").filter(Boolean),
    env: readFileSync(join(d, `psql-${i + 1}.env`), "utf8"),
    sql: readFileSync(join(d, `psql-${i + 1}.sql`), "utf8"),
  }));
  const secure = join(home, "secure");
  const logs = existsSync(secure) ? readdirSync(secure).filter((f) => f.endsWith(".log")) : [];
  return {
    status: r.status,
    stdout: r.stdout,
    stderr: r.stderr,
    lines: r.stdout.split("\n").filter(Boolean),
    psql,
    home,
    log: logs.map((f) => readFileSync(join(secure, f), "utf8")).join("\n"),
  };
}

const OVERRIDE_0: Reply = { out: "role_override=0\n" };
const VISIBLE: Reply = { out: "stats_visible=1\n" };
const DENIED_42501: Reply = { err: "psql:<stdin>:2: ERROR:  42501\n", rc: 3 };
const TERMINATE_OK: Reply = { out: "backends_before=2\nterminated=2\nlogin_roles=1\nskipped_superuser=1\n" };
const READ_ONLY_ERR: Reply = { err: "psql:<stdin>:2: ERROR:  25006\n", rc: 3 };

const SCRIPTS = [
  {
    name: "freeze-neon.sh",
    logPrefix: "cutover-freeze",
    value: "on",
    result: "frozen",
    /** Udany przebieg: zapis na nowym połączeniu odrzucony (25006). */
    ok: [OVERRIDE_0, VISIBLE, TERMINATE_OK, { out: "true on\n" }, READ_ONLY_ERR],
    /** Niezgodny wynik testu zapisu (zapis przeszedł). */
    badWrite: [OVERRIDE_0, VISIBLE, TERMINATE_OK, { out: "true on\n" }, { out: "" }],
    badShow: [OVERRIDE_0, VISIBLE, TERMINATE_OK, { out: "true off\n" }],
  },
  {
    name: "unfreeze-neon.sh",
    logPrefix: "cutover-unfreeze",
    value: "off",
    result: "unfrozen",
    ok: [OVERRIDE_0, VISIBLE, TERMINATE_OK, { out: "true off\n" }, { out: "" }],
    badWrite: [OVERRIDE_0, VISIBLE, TERMINATE_OK, { out: "true off\n" }, READ_ONLY_ERR],
    badShow: [OVERRIDE_0, VISIBLE, TERMINATE_OK, { out: "true on\n" }],
  },
] as const;

describe.each(SCRIPTS)("$name", (s) => {
  const SCRIPT = join(ROOT, "infra/db/cutover", s.name);
  const SOURCE = readFileSync(SCRIPT, "utf8");
  const LINES = SOURCE.split("\n");
  const CODE_LINES = LINES.filter((l) => !l.trim().startsWith("#"));
  const CODE = CODE_LINES.join("\n");
  const sqlBlocks = [...SOURCE.matchAll(/<<'SQL'\n([\s\S]*?)\nSQL\n/g)].map((m) => m[1]!);
  const okLines = [
    "role_override=0",
    "stats_visible=1",
    "backends_before=2",
    "terminated=2",
    "login_roles=1",
    "skipped_superuser=1",
    "pooler=no",
    `${s.result}=yes`,
    "exit=0",
  ];

  describe("głowica trybu D", () => {
    it("pierwsze polecenia: set +x, set -euo pipefail, umask 077", () => {
      expect(LINES[0]).toBe("#!/usr/bin/env bash");
      expect(CODE_LINES.filter((l) => l.trim() !== "").slice(0, 3)).toEqual(["set +x", "set -euo pipefail", "umask 077"]);
    });

    it("exec 3>&1 1>>\"$LOG\" 2>&1 przed pierwszym psql; log w $HOME/secure", () => {
      const execAt = CODE.indexOf('exec 3>&1 1>>"$LOG" 2>&1\n');
      expect(execAt).toBeGreaterThan(0);
      expect(/\bpsql /.exec(CODE)!.index).toBeGreaterThan(execAt);
      expect(SOURCE).toContain(`BASE="$HOME/secure/${s.logPrefix}-$(date -u +%Y%m%dT%H%M%SZ)-$$"\n`);
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

    it("trap … EXIT po exec i przed run_sql", () => {
      const trapAt = CODE.indexOf("trap 'rc=$?; rm -f \"$ERRF\"; emit exit \"$rc\"' EXIT\n");
      expect(trapAt).toBeGreaterThan(CODE.indexOf('exec 3>&1 1>>"$LOG" 2>&1'));
      expect(trapAt).toBeLessThan(CODE.indexOf("run_sql() {"));
    });

    it("jedno wywołanie psql z -X -q -A -t -w -v ON_ERROR_STOP=1 -v VERBOSITY=sqlstate", () => {
      expect(CODE_LINES.filter((l) => /\bpsql\s+-/.test(l))).toEqual([
        '  SQL_OUT="$(use_target "$target"; psql -X -q -A -t -w -v ON_ERROR_STOP=1 -v VERBOSITY=sqlstate "$@" -f - 2>"$ERRF")" || SQL_RC=$?',
      ]);
    });

    it("brak .pgpass, gcloud, pg_dump, pg_restore i adresów e-mail", () => {
      expect(CODE).not.toMatch(/\.pgpass|\bgcloud\b|\bpg_dump\b|\bpg_restore\b/);
      expect(SOURCE).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/);
    });
  });

  describe("SQL: jedyne zapisy i zrywanie po bazie", () => {
    it("jedyne zmiany: jedno ALTER DATABASE i sonda CREATE TEMP TABLE w BEGIN … ROLLBACK", () => {
      const sql = sqlBlocks.join("\n");
      expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE|GRANT|REVOKE|COPY|VACUUM|COMMIT)\b/i);
      expect(CODE_LINES.filter((l) => /\bALTER\b/i.test(l))).toEqual([
        `ALTER DATABASE :"db" SET default_transaction_read_only = ${s.value};`,
      ]);
      expect(CODE_LINES.filter((l) => /\bCREATE\b/i.test(l))).toEqual(["CREATE TEMP TABLE cutover_write_probe (x int);"]);
      expect(sqlBlocks).toContain("BEGIN;\nCREATE TEMP TABLE cutover_write_probe (x int);\nROLLBACK;");
    });

    it("filtr zrywania po bazie (+ wykluczenie superużytkownika), bez filtra po nazwie roli", () => {
      expect(CODE.split(FILTER).length - 1).toBe(1);
      expect(CODE.match(/pg_terminate_backend/g)).toHaveLength(1);
      expect(SOURCE).toContain("EXISTS (SELECT 1 FROM pg_roles r WHERE r.oid = usesysid AND r.rolsuper) AS superuser");
      expect(SOURCE).toContain("SELECT usesysid, pg_terminate_backend(pid, 5000) AS ok\n    FROM target WHERE NOT superuser");
      expect(SOURCE).toContain("AND backend_type = 'client backend'");
      expect(CODE).not.toMatch(/usename|rolname|myhelper_app/i);
      // backends_before i terminated liczone z tego samego zbioru (jedno zapytanie).
      expect(SOURCE).toContain("'backends_before=' || (SELECT count(*) FROM target WHERE NOT superuser)");
    });

    it("widoczność pg_stat_activity: osobny blok SQL przed ALTER DATABASE, 42501 albo stats_visible=1", () => {
      expect(sqlBlocks).toHaveLength(5);
      const step2 = sqlBlocks[1]!;
      expect(step2).toMatch(/^DO \$\$\n[\s\S]*?\n\$\$;\nSELECT 'stats_visible=1';$/);
      expect(step2).toContain("IF NOT pg_has_role(current_user, 'pg_read_all_stats', 'USAGE')");
      expect(step2).toContain("WHERE backend_type IS NULL AND datname = current_database()) THEN");
      expect(step2).toContain("USING ERRCODE = '42501';");
      expect(step2).not.toMatch(/\bALTER\b|pg_terminate_backend/);
      // Blok zmiany nie zawiera już kontroli widoczności.
      const step3 = sqlBlocks[2]!;
      expect(step3).toMatch(/^SET default_transaction_read_only = off;\nALTER DATABASE /);
      expect(step3).not.toMatch(/pg_read_all_stats|RAISE EXCEPTION|\bDO \$\$/);
      // W kodzie: wiersz stats_visible emitowany przed wywołaniem z ALTER DATABASE.
      expect(CODE.indexOf('emit stats_visible "${NUMS[0]}"')).toBeGreaterThan(0);
      expect(CODE.indexOf('emit stats_visible "${NUMS[0]}"')).toBeLessThan(CODE.indexOf("ALTER DATABASE"));
    });

    it("role_override: ustawienia ról (setrole <> 0) globalne i dla tej bazy", () => {
      expect(sqlBlocks[0]).toContain("WHERE setrole <> 0");
      expect(sqlBlocks[0]).toContain("setdatabase IN (0, (SELECT oid FROM pg_database WHERE datname = current_database()))");
      expect(sqlBlocks[0]).toContain("LIKE '%default_transaction_read_only%'");
    });
  });

  describe("przebieg", () => {
    it("udany: wiersze w kolejności, exit=0, stderr pusty", () => {
      const r = run(SCRIPT, [], { psql: s.ok.map((x) => ({ ...x })) });
      expect(r.status, r.stdout).toBe(0);
      expect(r.lines).toEqual(okLines);
      expect(r.stderr).toBe("");
      for (const l of r.lines) expect(EMIT.test(l), l).toBe(true);
      expect(r.psql).toHaveLength(5);
      // Wywołanie 2: sama kontrola widoczności pg_stat_activity (bez zmian w bazie).
      expect(r.psql[1]!.sql).toMatch(/^DO \$\$\n[\s\S]*?\n\$\$;\nSELECT 'stats_visible=1';\n$/);
      expect(r.psql[1]!.sql).not.toMatch(/\bALTER\b|pg_terminate_backend/);
      // Wywołanie 3: sesja administracyjna na zamrożonej bazie startuje tylko do odczytu — SET przed ALTER.
      expect(r.psql[2]!.sql).toMatch(
        new RegExp(
          `^SET default_transaction_read_only = off;\\nALTER DATABASE :"db" SET default_transaction_read_only = ${s.value};\\n`,
        ),
      );
      expect(r.psql[2]!.sql).not.toMatch(/pg_read_all_stats/);
      expect(r.psql[2]!.args).toContain("db=neondb");
      expect(r.psql[3]!.args).toContain("db=neondb");
    });

    it("wywołania 1–3 adresem administracyjnym, 4–5 adresem aplikacji; VERIFY_* nigdy w psql", () => {
      const r = run(SCRIPT, [], { psql: s.ok.map((x) => ({ ...x })) });
      for (const c of r.psql.slice(0, 3)) {
        expect(c.env).toMatch(/^PGUSER=owner_role$/m);
        expect(c.env).toMatch(/^PGPASSWORD=fake-admin-secret$/m);
      }
      for (const c of r.psql.slice(3)) {
        expect(c.env).toMatch(/^PGUSER=app_login$/m);
        expect(c.env).toMatch(/^PGPASSWORD=fake-verify-secret$/m);
        expect(c.env).toMatch(/^PGDATABASE=neondb$/m);
      }
      for (const c of r.psql) {
        expect(c.env).not.toMatch(/^VERIFY_/m);
        expect(c.env).not.toMatch(/^PGOPTIONS=/m);
        expect(c.env).toMatch(/^PGPASSFILE=\/dev\/null$/m);
        for (const a of c.args) expect(a).not.toMatch(/fake-(admin|verify)-secret/);
      }
      expect(r.stdout + r.log).not.toMatch(/fake-(admin|verify)-secret/);
    });

    it("bez VERIFY_PGPASSWORD hasło administracyjne nie trafia do testu zapisu", () => {
      const r = run(SCRIPT, [], { env: { VERIFY_PGPASSWORD: undefined }, psql: s.ok.map((x) => ({ ...x })) });
      expect(r.status).toBe(0);
      for (const c of r.psql.slice(3)) expect(c.env).not.toMatch(/^PGPASSWORD=/m);
    });

    it("adresy zdalne: ten sam endpoint (adres aplikacji = wariant -pooler), verify-full w obu, pooler=yes", () => {
      const r = run(SCRIPT, [], { env: ENV_REMOTE, psql: s.ok.map((x) => ({ ...x })) });
      expect(r.status, r.stdout).toBe(0);
      expect(r.lines).toContain("pooler=yes");
      expect(r.psql[0]!.env).toMatch(/^PGHOST=ep-x-1\.eu-central-1\.aws\.neon\.tech$/m);
      expect(r.psql[4]!.env).toMatch(/^PGHOST=ep-x-1-pooler\.eu-central-1\.aws\.neon\.tech$/m);
      expect(r.psql[4]!.env).toMatch(/^PGSSLMODE=verify-full$/m);
    });

    it.each([
      ["127.0.0.1 = 127.0.0.1", "127.0.0.1", "127.0.0.1"],
      ["localhost = localhost", "localhost", "localhost"],
      ["127.0.0.1 i localhost (oba lokalne, bez zmian)", "127.0.0.1", "localhost"],
    ])("adresy lokalne %s → przechodzi", (_l, pg, verify) => {
      const r = run(SCRIPT, [], { env: { PGHOST: pg, VERIFY_PGHOST: verify }, psql: s.ok.map((x) => ({ ...x })) });
      expect(r.status, r.stdout).toBe(0);
      expect(r.psql).toHaveLength(5);
    });

    it("strażnik endpointu: kod tylko porównuje VERIFY_PGHOST bez -pooler. z PGHOST", () => {
      expect(CODE).toContain('if ! is_local "$PGHOST" || ! is_local "$VERIFY_PGHOST"; then\n');
      expect(CODE).toContain('  [[ "${VERIFY_PGHOST/-pooler./.}" == "$PGHOST" ]] || exit 2\n');
      // Strażnik przed --dry-run, więc przed jakimkolwiek połączeniem.
      expect(CODE.indexOf("${VERIFY_PGHOST/-pooler./.}")).toBeLessThan(CODE.indexOf('if [[ "$DRY_RUN" == 1 ]]'));
    });

    it("role_override ≠ 0 → kod 7, bez ALTER DATABASE i bez zrywania", () => {
      const r = run(SCRIPT, [], { psql: [{ out: "role_override=1\n" }] });
      expect(r.status).toBe(7);
      expect(r.lines).toEqual(["role_override=1", "exit=7"]);
      expect(r.psql).toHaveLength(1);
    });

    it("terminated < backends_before → kod 8, bez testu zapisu", () => {
      const r = run(SCRIPT, [], {
        psql: [OVERRIDE_0, VISIBLE, { out: "backends_before=3\nterminated=2\nlogin_roles=1\nskipped_superuser=0\n" }],
      });
      expect(r.status).toBe(8);
      expect(r.lines).toEqual([
        "role_override=0",
        "stats_visible=1",
        "backends_before=3",
        "terminated=2",
        "login_roles=1",
        "skipped_superuser=0",
        "exit=8",
      ]);
      expect(r.psql).toHaveLength(3);
    });

    it("odmowa widoczności (42501 przed stats_visible) → kod 1, bez wywołania z ALTER DATABASE", () => {
      const r = run(SCRIPT, [], { psql: [OVERRIDE_0, DENIED_42501, TERMINATE_OK] });
      expect(r.status).toBe(1);
      expect(r.lines).toEqual(["role_override=0", "error_class=other", "exit=1"]);
      expect(r.psql).toHaveLength(2);
      expect(r.psql.some((c) => /\bALTER\b/.test(c.sql))).toBe(false);
    });

    it("odmowa zerwania (42501 po stats_visible=1) → kod 1, wiersze inne niż przy odmowie widoczności", () => {
      const r = run(SCRIPT, [], { psql: [OVERRIDE_0, VISIBLE, DENIED_42501] });
      expect(r.status).toBe(1);
      expect(r.lines).toEqual(["role_override=0", "stats_visible=1", "error_class=other", "exit=1"]);
      expect(r.psql).toHaveLength(3);
      expect(r.psql[2]!.sql).toContain(`ALTER DATABASE :"db" SET default_transaction_read_only = ${s.value};`);
    });

    it.each([
      ["stats_visible=0", "stats_visible=0\n"],
      ["pusty wynik", ""],
      ["inny klucz", "visible=1\n"],
      ["dodatkowy wiersz", "stats_visible=1\nbackends_before=0\n"],
    ])("wynik kontroli widoczności: %s → rejected_line=1, kod 3, bez ALTER DATABASE", (_l, out) => {
      const r = run(SCRIPT, [], { psql: [OVERRIDE_0, { out }, TERMINATE_OK] });
      expect(r.status).toBe(3);
      expect(r.lines).toEqual(["role_override=0", "rejected_line=1", "exit=3"]);
      expect(r.psql).toHaveLength(2);
    });

    it(`nowe połączenie nie widzi default_transaction_read_only = ${s.value} → ${s.result}=no, kod 9`, () => {
      const r = run(SCRIPT, [], { psql: s.badShow.map((x) => ({ ...x })) });
      expect(r.status).toBe(9);
      expect(r.lines.slice(-2)).toEqual([`${s.result}=no`, "exit=9"]);
      expect(r.psql).toHaveLength(4);
    });

    it("adres aplikacji w innej bazie → kod 9, bez testu zapisu", () => {
      const r = run(SCRIPT, [], { psql: [OVERRIDE_0, VISIBLE, TERMINATE_OK, { out: `false ${s.value}\n` }] });
      expect(r.status).toBe(9);
      expect(r.psql).toHaveLength(4);
    });

    it(`test zapisu niezgodny z oczekiwaniem → ${s.result}=no, kod 9`, () => {
      const r = run(SCRIPT, [], { psql: s.badWrite.map((x) => ({ ...x })) });
      expect(r.status).toBe(9);
      expect(r.lines.slice(-2)).toEqual([`${s.result}=no`, "exit=9"]);
    });

    it("test zapisu z innym błędem (np. 42501) → error_class=other, kod 1", () => {
      const r = run(SCRIPT, [], {
        psql: [OVERRIDE_0, VISIBLE, TERMINATE_OK, { out: `true ${s.value}\n` }, DENIED_42501],
      });
      expect(r.status).toBe(1);
      expect(r.lines.slice(-2)).toEqual(["error_class=other", "exit=1"]);
    });

    it("błędne hasło → error_class=connection, exit=1; komunikat tylko w logu", () => {
      const err = `psql: error: connection to server at "127.0.0.1", port 5432 failed: FATAL:  password authentication failed for user "owner_role"\n`;
      const r = run(SCRIPT, [], { psql: [{ err, rc: 2 }] });
      expect(r.status).toBe(1);
      expect(r.lines).toEqual(["error_class=connection", "exit=1"]);
      expect(r.stderr).toBe("");
      expect(r.log).toContain("password authentication failed");
    });

    it.each([
      ["wartość nieliczbowa", `role_override=${PII}\n`],
      ["pusty wynik", ""],
      ["dodatkowy wiersz", "role_override=0\nterminated=1\n"],
      ["inny klucz", "override=0\n"],
    ])("wynik kroku 1: %s → rejected_line=1, kod 3, wartość nie na ekranie", (_l, out) => {
      const r = run(SCRIPT, [], { psql: [{ out }] });
      expect(r.status).toBe(3);
      expect(r.lines).toEqual(["rejected_line=1", "exit=3"]);
      expect(r.stdout).not.toContain(PII);
    });

    it("wynik kroku 3 w złej kolejności → rejected_line=1, kod 3, bez testu zapisu", () => {
      const r = run(SCRIPT, [], {
        psql: [OVERRIDE_0, VISIBLE, { out: "terminated=2\nbackends_before=2\nlogin_roles=1\nskipped_superuser=1\n" }],
      });
      expect(r.status).toBe(3);
      expect(r.lines).toEqual(["role_override=0", "stats_visible=1", "rejected_line=1", "exit=3"]);
      expect(r.psql).toHaveLength(3);
    });
  });

  describe("argumenty i środowisko", () => {
    it("--dry-run: bez połączenia, dry_run=yes, steps=5", () => {
      const r = run(SCRIPT, ["--dry-run"]);
      expect(r.status).toBe(0);
      expect(r.lines).toEqual(["dry_run=yes", "steps=5", "exit=0"]);
      expect(r.psql).toHaveLength(0);
    });

    it.each([
      ["nieznany argument", ["--force"], {}],
      ["URL jako argument", ["postgresql://u:p@127.0.0.1/db"], {}],
      ["--target=", ["--target=branch"], {}],
      ["brak PGHOST", [], { PGHOST: undefined }],
      ["brak PGUSER", [], { PGUSER: undefined }],
      ["brak VERIFY_PGHOST", [], { VERIFY_PGHOST: undefined }],
      ["brak VERIFY_PGUSER", [], { VERIFY_PGUSER: undefined }],
      ["brak VERIFY_PGDATABASE", [], { VERIFY_PGDATABASE: undefined }],
      ["VERIFY_PGDATABASE ≠ PGDATABASE", [], { VERIFY_PGDATABASE: "other" }],
      ["PGDATABASE jako connection string", [], { PGDATABASE: "host=10.0.0.1 dbname=x", VERIFY_PGDATABASE: "host=10.0.0.1 dbname=x" }],
      ["VERIFY_PGHOST jako URL", [], { VERIFY_PGHOST: "postgresql://u:p@h/db" }],
      ["PGSERVICE", [], { PGSERVICE: "prod" }],
      ["PGHOSTADDR", [], { PGHOSTADDR: "10.0.0.1" }],
      ["VERIFY_PGSERVICE", [], { VERIFY_PGSERVICE: "prod" }],
      ["VERIFY_PGHOSTADDR", [], { VERIFY_PGHOSTADDR: "10.0.0.1" }],
      ["gniazdo unix", [], { PGHOST: "/tmp" }],
      ["lista hostów", [], { VERIFY_PGHOST: "127.0.0.1,10.0.0.1" }],
      ["port nieliczbowy", [], { VERIFY_PGPORT: "5432x" }],
      ["host zdalny bez verify-full", [], { ...ENV_REMOTE, PGSSLMODE: "require" }],
      ["adres aplikacji zdalny bez verify-full", [], { ...ENV_REMOTE, VERIFY_PGSSLMODE: "require" }],
      ["pooler jako adres administracyjny", [], { ...ENV_REMOTE, PGHOST: "ep-x-1-pooler.eu-central-1.aws.neon.tech" }],
      ["zdalny adres aplikacji bez poolera", [], { ...ENV_REMOTE, VERIFY_PGHOST: "ep-x-1.eu-central-1.aws.neon.tech" }],
      ["endpoint aplikacji ≠ endpoint administracyjny", [], { ...ENV_REMOTE, VERIFY_PGHOST: "ep-y-2-pooler.eu-central-1.aws.neon.tech" }],
      ["endpoint aplikacji w innym regionie", [], { ...ENV_REMOTE, VERIFY_PGHOST: "ep-x-1-pooler.us-east-2.aws.neon.tech" }],
      ["endpoint aplikacji z przedrostkiem administracyjnego", [], { ...ENV_REMOTE, VERIFY_PGHOST: "ep-x-1-2-pooler.eu-central-1.aws.neon.tech" }],
      ["adres administracyjny lokalny, aplikacji zdalny", [], { ...ENV_REMOTE, PGHOST: "127.0.0.1", PGSSLMODE: undefined }],
      ["adres administracyjny zdalny, aplikacji lokalny", [], { ...ENV_REMOTE, VERIFY_PGHOST: "127.0.0.1", VERIFY_PGSSLMODE: undefined }],
    ])("%s → kod 2, bez połączenia, na ekranie tylko exit=2", (_l, args, env) => {
      const r = run(SCRIPT, args, { env, psql: s.ok.map((x) => ({ ...x })) });
      expect(r.status).toBe(2);
      expect(r.lines).toEqual(["exit=2"]);
      expect(r.psql).toHaveLength(0);
    });
  });
});

describe("CI: test zamrożenia na prawdziwym Postgresie", () => {
  const T = readFileSync(join(ROOT, "__tests__/pg/cutover-freeze.pg.test.ts"), "utf8");

  it("plik testu istnieje, bramkowany tą samą zmienną co compare (krok `pnpm test:pg` w e2e-smoke)", () => {
    expect(T).toContain('process.env.CUTOVER_COMPARE_PG === "1"');
  });

  it("klient PG z kontenera usługi przez nakładki docker exec, hasło tylko jako nazwa zmiennej", () => {
    expect(T).toContain("exec docker exec -i -e PGHOST=${ip} -e PGPORT=5432 ${pass} ${cid} ${tool} \"$@\"");
    expect(T).not.toMatch(/PGPASSWORD=\$/);
  });

  it("własne bazy i role z prefiksem it_cutover_, sprzątane w afterAll", () => {
    expect(T).toContain("const TAG = `it_cutover_${randomBytes(4).toString(\"hex\")}`;");
    expect(T).toMatch(/afterAll\([\s\S]*DROP DATABASE IF EXISTS \$\{DB_F\} WITH \(FORCE\)[\s\S]*DROP ROLE IF EXISTS/);
  });
});
