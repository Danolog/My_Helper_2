/**
 * `infra/db/cutover/copy-neon-to-cloudsql.sh` i `rls-check.sh` na PRAWDZIWYM
 * Postgresie (krok `pnpm test:pg` joba CI `e2e-smoke`, po migracjach i seedzie
 * bazy `pos_dev`; ta sama bramka i ten sam klient PG z kontenera co compare.sh).
 *
 * Kopia (jeden strumień pg_dump | pg_restore, bez pliku):
 *  - pos_dev po seedzie → pusta baza po migracjach (T): kod 0, potem compare.sh
 *    obu baz równe poza liczbami auth_rate_limit, session, verification, które
 *    w celu mają count=0; schemat równy;
 *  - T z jednym wierszem w każdej z trzech tabel → druga pusta baza (S): różnią
 *    się DOKŁADNIE trzy liczby (źródło 1, cel 0) — wykluczenie działa;
 *  - pg_dump padający w środku strumienia (nakładka ucina archiwum na 90%
 *    i kończy się kodem 1; test najpierw dowodzi, że ucięty prefiks ma ≥ 1 pełny
 *    blok danych z wierszami i mniej pełnych bloków niż całe archiwum) → kod 1,
 *    dump_exit=1, restore_exit ≠ 0, cel pusty (transakcja pg_restore wycofana);
 *  - rola źródła bez uprawnień → błąd i kod 1 (nie cichy sukces), cel pusty;
 *  - cel niepusty → kod 5 bez zrzutu, cel bez zmian; błędne hasło celu →
 *    error_class=connection.
 * rls-check:
 *  - baza z danymi po kopii i pusta baza po migracjach → 0/0/0, atrybuty
 *    myhelper_app no/no/no, kod 0;
 *  - myhelper_app z BYPASSRLS (ALTER ROLE w try/finally) → rls_fail_closed=no,
 *    kod 7; rola bez prawa SET ROLE → error_class=other, kod 1.
 *
 * Bazy (`it_cutover_<los>_*`) i rolę (`it_cutover_<los>_nopriv`) tworzy i usuwa
 * sam test przez pulę zweryfikowaną w `pg-harness.ts`. pos_dev jest tylko
 * czytana. Uwaga lokalnie: przerwanie testu w środku przypadku BYPASSRLS
 * zostawia tę rolę z BYPASSRLS — wtedy `ALTER ROLE myhelper_app NOBYPASSRLS`
 * na lokalnym Dockerze (w CI kontener jest efemeryczny).
 * Przypadki zależą od kolejności (sekwencyjne `it`, `fileParallelism: false`):
 * pierwszy wypełnia T danymi, z których korzystają kolejne, a X ma zostać pusty
 * do rls-check na pustej bazie — porażka pierwszego czerwieni resztę kaskadowo.
 * psql, pg_dump, pg_restore w wersji ≥ serwera: z `CUTOVER_PG_CONTAINER`
 * nakładki `docker exec -i <id> <narzędzie>` (bez apt, bez nowych obrazów).
 *
 * Bramka: `CUTOVER_COMPARE_PG=1`. Strażnik: `__tests__/lib/cutover-copy-config.test.ts`.
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createIntegrationDb, HARNESS_GUARD_CONTEXT, INTEGRATION_URL } from "./pg-harness";
import { checkSeedClientOptions, checkSeedTarget } from "../../scripts/seed-host-guard";

const ENABLED = process.env.CUTOVER_COMPARE_PG === "1";
const ROOT = process.cwd();
const COPY = join(ROOT, "infra/db/cutover/copy-neon-to-cloudsql.sh");
const RLS = join(ROOT, "infra/db/cutover/rls-check.sh");
const COMPARE = join(ROOT, "infra/db/cutover/compare.sh");
const TAG = `it_cutover_${randomBytes(4).toString("hex")}`;
const DB_T = `${TAG}_t`; // cel kopii z pos_dev
const DB_S = `${TAG}_s`; // cel kopii z T (po dopisaniu wierszy w 3 wykluczonych tabelach)
const DB_X = `${TAG}_x`; // cel nieudanych kopii — ma zostać pusty
const OWN_DBS = [DB_T, DB_S, DB_X];
const SEED_OWNER_ID = "test-owner-user-id-00001";
/** Rola źródła bez uprawnień (zwykła rola LOGIN, bez GRANT). */
const NOPRIV = `${TAG}_nopriv`;
const NOPRIV_PASS = randomBytes(16).toString("hex");
const EXCLUDED = ["auth_rate_limit", "session", "verification"];
const EXCLUDE_FLAGS = EXCLUDED.map((t) => `--exclude-table-data=public.${t}`).join(" ");

type Sql = ReturnType<typeof postgres>;
type Harness = NonNullable<Awaited<ReturnType<typeof createIntegrationDb>>>;
const base = INTEGRATION_URL ? new URL(INTEGRATION_URL) : null;

const PG_TOOLS = ["psql", "pg_dump", "pg_restore"] as const;
let toolPath = process.env.PATH ?? "";
let toolDir: string | null = null;
const tmpDirs: string[] = [];

/** Nakładki psql/pg_dump/pg_restore na kontener usługi bazy (CI), jak w cutover-compare.pg.test.ts. */
function containerTools(): string | null {
  const cid = process.env.CUTOVER_PG_CONTAINER?.trim();
  if (!cid) return null;
  if (!/^[0-9a-f]{12,64}$/.test(cid)) throw new Error("CUTOVER_PG_CONTAINER: nieoczekiwany kształt id kontenera");
  const r = spawnSync("docker", ["inspect", "-f", "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}", cid], {
    encoding: "utf8",
    timeout: 30_000,
  });
  const ip = (r.stdout ?? "").trim();
  if (r.status !== 0 || !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip)) {
    throw new Error("docker inspect: brak jednego adresu IPv4 kontenera usługi bazy");
  }
  const dir = mkdtempSync(join(tmpdir(), "it-cutover-bin-"));
  const pass = ["PGUSER", "PGPASSWORD", "PGDATABASE", "PGPASSFILE", "PGSSLMODE"].map((k) => `-e ${k}`).join(" ");
  for (const tool of PG_TOOLS) {
    const f = join(dir, tool);
    writeFileSync(f, `#!/bin/sh\nexec docker exec -i -e PGHOST=${ip} -e PGPORT=5432 ${pass} ${cid} ${tool} "$@"\n`);
    chmodSync(f, 0o755);
  }
  return dir;
}

function host(): string {
  return base!.hostname === "localhost" ? "127.0.0.1" : base!.hostname;
}
const port = () => base!.port || "5432";
const superUser = () => decodeURIComponent(base!.username);
const superPass = () => decodeURIComponent(base!.password);

function urlFor(db: string): string {
  const u = new URL(base!.toString());
  u.pathname = `/${db}`;
  return u.toString();
}

/** Klient do bazy testu: te same etapy guardu co harness + sonda serwera. */
async function ownClient(db: string): Promise<Sql> {
  if (!OWN_DBS.includes(db)) throw new Error("baza spoza listy testu");
  const url = urlFor(db);
  const target = checkSeedTarget(url, { VERCEL_ENV: process.env.VERCEL_ENV }, HARNESS_GUARD_CONTEXT);
  if (!target.ok) throw new Error(`Odmowa: ${target.reason}`);
  const sql = postgres(url, { prepare: false, max: 1, connect_timeout: 5, onnotice: () => {} });
  const opts = checkSeedClientOptions(sql.options, HARNESS_GUARD_CONTEXT);
  if (!opts.ok) {
    await sql.end({ timeout: 0 });
    throw new Error(`Odmowa: ${opts.reason}`);
  }
  const [row] = await sql.unsafe(
    "select current_database() as database, (select count(*) from pg_settings where name like 'neon.%')::int as neon",
  );
  if (row?.database !== db || row?.neon !== 0) {
    await sql.end({ timeout: 0 });
    throw new Error("Odmowa: nieoczekiwana tożsamość serwera");
  }
  return sql;
}

/** Zmienne libpq jednej bazy (hasło tylko w środowisku procesu). */
function pgEnv(db: string, user = superUser(), password = superPass()): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    PATH: toolPath,
    HOME: process.env.HOME ?? "",
    PGHOST: host(),
    PGPORT: port(),
    PGUSER: user,
    PGPASSWORD: password,
    PGDATABASE: db,
  };
}

/** Źródło = PG*, cel = TARGET_* (lokalnie, jak proxy Cloud SQL na 127.0.0.1). */
function copyEnv(src: string, dst: string, o: { srcUser?: string; srcPass?: string; dstPass?: string } = {}) {
  return {
    ...pgEnv(src, o.srcUser, o.srcPass),
    TARGET_PGHOST: host(),
    TARGET_PGPORT: port(),
    TARGET_PGDATABASE: dst,
    TARGET_PGUSER: superUser(),
    TARGET_PGPASSWORD: o.dstPass ?? superPass(),
  };
}

interface ScriptRun {
  status: number | null;
  lines: string[];
  map: Map<string, string>;
  stderr: string;
  home: string;
  secureFiles: string[];
  log: string;
}

function runScript(script: string, args: string[], env: NodeJS.ProcessEnv): ScriptRun {
  const home = mkdtempSync(join(tmpdir(), "it-cutover-home-"));
  tmpDirs.push(home);
  const r = spawnSync("bash", [script, ...args], { encoding: "utf8", env: { ...env, HOME: home }, timeout: 120_000 });
  const lines = r.stdout.split("\n").filter(Boolean);
  const map = new Map(lines.map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)] as const));
  const dir = join(home, "secure");
  const secureFiles = existsSync(dir) ? readdirSync(dir) : [];
  const log = secureFiles
    .filter((f) => f.endsWith(".log"))
    .map((f) => readFileSync(join(dir, f), "utf8"))
    .join("\n");
  return { status: r.status, lines, map, stderr: r.stderr, home, secureFiles, log };
}

const compare = (db: string, args: string[] = []) => runScript(COMPARE, args, pgEnv(db));

function schemaFile(c: ScriptRun): string {
  const f = c.secureFiles.find((x) => x.endsWith(".schema.sql"));
  if (!f) throw new Error("brak pliku schematu");
  return join(c.home, "secure", f);
}

/** Klucze porównywane między bazami (bez liczników pomocniczych i czasu). */
function diffKeys(a: ScriptRun, b: ScriptRun): string[] {
  const keep = (c: ScriptRun) =>
    new Map([...c.map].filter(([k]) => !k.startsWith("writes_") && k !== "compare_seconds" && k !== "schema_equal"));
  const x = keep(a);
  const y = keep(b);
  return [...new Set([...x.keys(), ...y.keys()])].filter((k) => x.get(k) !== y.get(k)).sort();
}

function migrate(db: string) {
  const r = spawnSync("pnpm", ["exec", "drizzle-kit", "migrate"], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, POSTGRES_URL: urlFor(db) },
    timeout: 120_000,
  });
  if (r.status !== 0) throw new Error(`drizzle-kit migrate (${db}) kod ${r.status}`);
}

function toolMajor(tool: string): number {
  const r = spawnSync(tool, ["--version"], { encoding: "utf8", env: { NODE_ENV: "test", PATH: toolPath, HOME: process.env.HOME ?? "" } });
  const m = /(\d+)(?:\.\d+)?/.exec(r.stdout ?? "");
  return m ? Number(m[1]) : 0;
}

/** Niepuste tabele public (rola właściciela, bez RLS). */
async function nonemptyTables(sql: Sql): Promise<string[]> {
  const rows = await sql.unsafe(
    "select c.relname as t from pg_class c join pg_namespace n on n.oid = c.relnamespace " +
      "where n.nspname = 'public' and c.relkind in ('r','p') and not c.relispartition order by 1",
  );
  const out: string[] = [];
  for (const r of rows) {
    const [x] = await sql.unsafe(`select exists (select 1 from public."${String(r.t).replace(/"/g, '""')}") as e`);
    if (x!.e) out.push(String(r.t));
  }
  return out;
}

const RLS_OK = [
  "salon_context_empty=yes",
  "app_role_active=yes",
  "app_visible_clients=0",
  "app_visible_appointments=0",
  "app_visible_salons=0",
  "app_role_reset=yes",
  "app_rolcanlogin=no",
  "app_rolbypassrls=no",
  "app_rolsuper=no",
  "rls_fail_closed=yes",
  "exit=0",
];

describe.skipIf(!ENABLED || !INTEGRATION_URL)("copy-neon-to-cloudsql.sh i rls-check.sh na prawdziwym Postgresie", () => {
  let h: Harness;
  let t: Sql;
  let s: Sql;
  let x: Sql;

  beforeAll(async () => {
    const harness = await createIntegrationDb();
    if (!harness) throw new Error("brak INTEGRATION_POSTGRES_URL");
    h = harness;
    toolDir = containerTools();
    if (toolDir) toolPath = `${toolDir}:${toolPath}`;
    const [srv] = await h.observer.unsafe("select current_setting('server_version_num')::int / 10000 as major");
    for (const tool of PG_TOOLS) {
      expect(toolMajor(tool), `${tool} w wersji ≥ serwera`).toBeGreaterThanOrEqual(Number(srv!.major));
    }
    const [seeded] = await h.observer.unsafe(`select count(*)::int as n from "user" where id = '${SEED_OWNER_ID}'`);
    expect(seeded!.n, "pos_dev po seedzie").toBe(1);

    for (const db of OWN_DBS) {
      await h.observer.unsafe(`CREATE DATABASE ${db}`);
      migrate(db);
    }
    t = await ownClient(DB_T);
    s = await ownClient(DB_S);
    x = await ownClient(DB_X);
    for (const c of [t, s, x]) expect(await nonemptyTables(c), "baza po migracjach pusta").toEqual([]);
    await h.observer.unsafe(
      `CREATE ROLE ${NOPRIV} LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD '${NOPRIV_PASS}'`,
    );
  }, 180_000);

  afterAll(async () => {
    await Promise.allSettled([t?.end({ timeout: 5 }), s?.end({ timeout: 5 }), x?.end({ timeout: 5 })]);
    if (h) {
      for (const db of OWN_DBS) {
        if (db.startsWith("it_cutover_")) await h.observer.unsafe(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
      }
      if (NOPRIV.startsWith("it_cutover_")) await h.observer.unsafe(`DROP ROLE IF EXISTS ${NOPRIV}`);
      await h.end();
    }
    for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
    if (toolDir) rmSync(toolDir, { recursive: true, force: true });
  }, 60_000);

  it("(c) pos_dev → pusta baza po migracjach: kod 0; compare.sh równe poza trzema wykluczonymi (w celu 0)", () => {
    const r = runScript(COPY, [], copyEnv("pos_dev", DB_T));
    expect(r.status, r.lines.join(" ")).toBe(0);
    expect(r.lines.slice(0, 5)).toEqual([
      "target_nonempty_tables=0",
      "fk_cycle_tables=0",
      "dump_exit=0",
      "restore_exit=0",
      "copied=yes",
    ]);
    expect(r.lines[5]).toMatch(/^copy_seconds=\d+$/);
    expect(r.lines[6]).toBe("exit=0");
    expect(r.stderr).toBe("");
    // Bez pliku pośredniego: w $HOME/secure tylko log, bez haseł.
    expect(r.secureFiles.every((f) => f.endsWith(".log")), r.secureFiles.join(",")).toBe(true);
    expect(r.log).not.toContain(superPass());

    const a = compare("pos_dev");
    expect(a.status, a.lines.join(" ")).toBe(0);
    const b = compare(DB_T, [`--schema-baseline=${schemaFile(a)}`]);
    expect(b.status, b.lines.join(" ")).toBe(0);
    expect(b.map.get("schema_equal")).toBe("yes");
    expect([...a.map.keys()].filter((k) => k.startsWith("rows_hash_")).length).toBeGreaterThan(10);
    expect(Number(b.map.get("count_user"))).toBeGreaterThan(0);
    const allowed = EXCLUDED.map((k) => `count_${k}`);
    for (const k of diffKeys(a, b)) expect(allowed, k).toContain(k);
    for (const k of allowed) expect(b.map.get(k), k).toBe("0");
  });

  it("(c) wykluczenie: po jednym wierszu w auth_rate_limit, session, verification → różnią się dokładnie trzy liczby", async () => {
    await t.unsafe(
      "INSERT INTO public.auth_rate_limit (key, count, window_start, blocked_until, updated_at) " +
        "VALUES ('\\x00ff10'::bytea, 3, '2026-11-21 21:00:00+00', NULL, '2026-11-21 21:05:30+00')",
    );
    await t.unsafe(
      `INSERT INTO public.session (id, expires_at, token, created_at, updated_at, user_id) ` +
        `VALUES ('${TAG}-s', now() + interval '1 day', '${TAG}-token', now(), now(), '${SEED_OWNER_ID}')`,
    );
    await t.unsafe(
      `INSERT INTO public.verification (id, identifier, value, expires_at, created_at, updated_at) ` +
        `VALUES ('${TAG}-v', '${TAG}-identifier', '${TAG}-value', now() + interval '1 day', now(), now())`,
    );
    const r = runScript(COPY, [], copyEnv(DB_T, DB_S));
    expect(r.status, r.lines.join(" ")).toBe(0);
    expect(r.map.get("copied")).toBe("yes");

    const a = compare(DB_T);
    const b = compare(DB_S);
    expect(a.status).toBe(0);
    expect(b.status).toBe(0);
    expect(diffKeys(a, b)).toEqual(EXCLUDED.map((k) => `count_${k}`));
    for (const k of EXCLUDED) {
      expect(a.map.get(`count_${k}`), k).toBe("1");
      expect(b.map.get(`count_${k}`), k).toBe("0");
    }
  }, 120_000);

  it("(c) pg_dump pada w połowie strumienia → kod 1, dump_exit=1, restore_exit ≠ 0, cel pusty", async () => {
    // Pełny rozmiar archiwum (licznik bajtów, bez pliku), potem nakładka ucinająca
    // je na 90%. Zanim ruszy skrypt, test dowodzi, że ucięty prefiks zawiera co
    // najmniej jeden PEŁNY blok danych z wierszami, a pełne archiwum ma więcej
    // pełnych bloków niż prefiks (cięcie wypada w danych, nie w spisie treści).
    // Dopiero wtedy pusty cel znaczy: COPY wykonane i transakcja wycofana.
    const dump = `pg_dump -w --data-only --schema=public -Fc ${EXCLUDE_FLAGS}`;
    const size = spawnSync("bash", ["-c", `set -o pipefail; ${dump} | wc -c`], {
      encoding: "utf8",
      env: pgEnv(DB_T),
      timeout: 120_000,
    });
    expect(size.status).toBe(0);
    const bytes = Number(size.stdout.trim());
    expect(bytes, "archiwum na tyle duże, żeby uciąć je w środku").toBeGreaterThan(1024);
    const cut = Math.floor(bytes * 0.9);
    // Pełne bloki COPY w SQL z pg_restore -f - (do potoku, bez pliku): blok jest
    // pełny dopiero z terminatorem `\.`; blok ucięty w środku go nie dostaje.
    // Wynik: "<wszystkie pełne bloki> <pełne bloki z ≥ 1 wierszem>". Kod potoku
    // jest dowolny — pg_restore na uciętym strumieniu pada na końcu, o to chodzi.
    const AWK = String.raw`/^COPY .* FROM stdin;$/ { inb = 1; n = 0; next }
inb && $0 == "\\." { all++; if (n > 0) rows++; inb = 0; next }
inb { n++ }
END { print all + 0, rows + 0 }`;
    const blocks = (limit?: number): [number, number] => {
      const head = limit === undefined ? "" : ` | head -c ${limit}`;
      const r = spawnSync("bash", ["-c", `${dump}${head} | pg_restore --data-only -f - | awk "$1"`, "bash", AWK], {
        encoding: "utf8",
        env: pgEnv(DB_T),
        timeout: 120_000,
        maxBuffer: 64 * 1024 * 1024,
      });
      const m = /^(\d+) (\d+)$/.exec((r.stdout ?? "").trim());
      expect(m, `licznik bloków: ${r.stdout}`).not.toBeNull();
      return [Number(m![1]), Number(m![2])];
    };
    const [fullAll] = blocks();
    const [cutAll, cutRows] = blocks(cut);
    expect(cutRows, "prefiks zawiera ≥ 1 pełny blok danych z wierszami").toBeGreaterThanOrEqual(1);
    expect(cutAll, "cięcie wypada przed końcem danych").toBeLessThan(fullAll);
    const real = toolDir
      ? join(toolDir, "pg_dump")
      : spawnSync("bash", ["-c", "command -v pg_dump"], { encoding: "utf8", env: { NODE_ENV: "test", PATH: toolPath } }).stdout.trim();
    expect(real).toMatch(/^\//);
    const breakDir = mkdtempSync(join(tmpdir(), "it-cutover-break-"));
    tmpDirs.push(breakDir);
    writeFileSync(join(breakDir, "pg_dump"), `#!/bin/sh\n"${real}" "$@" | head -c ${cut}\nexit 1\n`);
    chmodSync(join(breakDir, "pg_dump"), 0o755);

    const r = runScript(COPY, [], { ...copyEnv(DB_T, DB_X), PATH: `${breakDir}:${toolPath}` });
    expect(r.status, r.lines.join(" ")).toBe(1);
    expect(r.map.get("dump_exit")).toBe("1");
    expect(Number(r.map.get("restore_exit"))).toBeGreaterThan(0);
    expect(r.map.has("copied")).toBe(false);
    expect(r.lines[r.lines.length - 1]).toBe("exit=1");
    expect(r.map.get("error_class")).toMatch(/^(other|connection)$/);
    expect(await nonemptyTables(x), "transakcja pg_restore wycofana").toEqual([]);
  }, 120_000);

  it("(c) rola źródła bez uprawnień → błąd, kod 1 (nie cichy sukces), cel pusty", async () => {
    const r = runScript(COPY, [], copyEnv(DB_T, DB_X, { srcUser: NOPRIV, srcPass: NOPRIV_PASS }));
    expect(r.status, r.lines.join(" ")).toBe(1);
    expect(Number(r.map.get("dump_exit"))).toBeGreaterThan(0);
    expect(r.map.has("copied")).toBe(false);
    expect(r.map.get("error_class")).toBe("other");
    expect(r.log).toMatch(/permission denied/);
    expect(r.log).not.toContain(NOPRIV_PASS);
    expect(await nonemptyTables(x)).toEqual([]);
  }, 120_000);

  it("(c) cel niepusty → target_nonempty_tables=n, kod 5, bez zrzutu, cel bez zmian", async () => {
    const [before] = await t.unsafe(`select count(*)::int as n from "user"`);
    const r = runScript(COPY, [], copyEnv("pos_dev", DB_T));
    expect(r.status).toBe(5);
    expect(r.lines).toHaveLength(2);
    expect(r.lines[0]).toMatch(/^target_nonempty_tables=[1-9]\d*$/);
    expect(r.lines[1]).toBe("exit=5");
    const [after] = await t.unsafe(`select count(*)::int as n from "user"`);
    expect(after!.n).toBe(before!.n);
  }, 120_000);

  it("(c) błędne hasło celu → na fd 3 wyłącznie error_class=connection i exit=", () => {
    const wrong = `wrong-${randomBytes(8).toString("hex")}`;
    const r = runScript(COPY, [], copyEnv(DB_T, DB_X, { dstPass: wrong }));
    expect(r.lines).toEqual(["error_class=connection", "exit=1"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toBe("");
    expect(r.log).toMatch(/password authentication failed/);
    expect(r.log).not.toContain(wrong);
  });

  it("(d) rls-check na bazie z danymi po kopii → 0/0/0, no/no/no, kod 0 (właściciel widzi wiersze)", async () => {
    const [own] = await t.unsafe(`select count(*)::int as n from public.salons`);
    expect(own!.n, "salony w bazie po kopii (test nie jest pusty)").toBeGreaterThan(0);
    const r = runScript(RLS, [], pgEnv(DB_T));
    expect(r.lines).toEqual(RLS_OK);
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
  }, 120_000);

  it("(d) rls-check na pustej bazie po migracjach → 0/0/0, no/no/no, kod 0", () => {
    const r = runScript(RLS, [], pgEnv(DB_X));
    expect(r.lines).toEqual(RLS_OK);
    expect(r.status).toBe(0);
  });

  it("(d) myhelper_app z BYPASSRLS → rls_fail_closed=no, kod 7", async () => {
    await h.observer.unsafe("ALTER ROLE myhelper_app BYPASSRLS");
    try {
      const r = runScript(RLS, [], pgEnv(DB_T));
      expect(r.status, r.lines.join(" ")).toBe(7);
      expect(r.map.get("app_rolbypassrls")).toBe("yes");
      expect(Number(r.map.get("app_visible_salons"))).toBeGreaterThan(0);
      expect(r.lines.slice(-2)).toEqual(["rls_fail_closed=no", "exit=7"]);
    } finally {
      await h.observer.unsafe("ALTER ROLE myhelper_app NOBYPASSRLS");
    }
    const [attrs] = await h.observer.unsafe("select rolbypassrls from pg_roles where rolname = 'myhelper_app'");
    expect(attrs!.rolbypassrls).toBe(false);
  }, 120_000);

  it("(d) rola bez prawa SET ROLE myhelper_app → error_class=other, kod 1 (nie ciche 0)", () => {
    const r = runScript(RLS, [], pgEnv(DB_T, NOPRIV, NOPRIV_PASS));
    expect(r.lines).toEqual(["error_class=other", "exit=1"]);
    expect(r.status).toBe(1);
    expect(r.log).toMatch(/ERROR: +42501/);
  });
});
