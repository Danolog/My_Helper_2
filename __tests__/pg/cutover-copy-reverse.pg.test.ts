/**
 * `infra/db/cutover/copy-cloudsql-to-neon.sh` (wycofanie przełączenia) na
 * PRAWDZIWYM Postgresie (krok `pnpm test:pg` joba CI `e2e-smoke`, po migracjach
 * i seedzie bazy `pos_dev`; ta sama bramka i ten sam klient PG z kontenera co
 * compare.sh i kopia w przód).
 *
 * Bazy testu: źródło S (po migracjach, dane pos_dev, własna sekwencja, wiersze
 * session i auth_rate_limit), cel T (szablon S, potem ustawienie neon.*
 * w bazie, zmieniony i dodatkowy wiersz user, dodatkowa sesja, inna wartość
 * sekwencji) i pusta baza E. Wszystkie trzy zamrożone przez freeze-neon.sh.
 * Źródło łączy się przez 127.0.0.1, cel przez localhost. pos_dev jest tylko
 * czytana (nigdy zamrażana).
 *
 * Założenia psql 18 sprawdzane wprost:
 *  (a) `-f plik -f - -f plik` = jedna sesja, jedna transakcja przez trzy
 *      źródła, wykonane w tej kolejności;
 *  (b) pg_dump -Fp 18 emituje `\restrict`/`\unrestrict`; `\restrict` bez
 *      `\unrestrict` (zrzut ucięty) nie blokuje SQL z następnego `-f`, więc
 *      bramka kompletności nadal się wykonuje. Pełny zrzut przez `-f -` =
 *      udany przebieg skryptu.
 * Przypadki (najpierw porażki, gdy cel ma jeszcze własne dane — „cel bez zmian”
 * odróżnia wtedy wycofaną transakcję i od pustego celu, i od kopii źródła):
 *  - zamienione serwery (neon.* po złej stronie) → 4; źródło niezamrożone → 6;
 *    cel niezamrożony → 8; ALTER ROLE … IN DATABASE … SET → 7; puste źródło → 5;
 *    cykl kluczy obcych w źródle → circular_fk, 1; błędne hasło celu → wyłącznie
 *    error_class=connection i exit=; rola źródła bez uprawnień → 1 (nie ciche 0);
 *  - rola celu niebędąca właścicielem → 1; otwarta transakcja z ACCESS SHARE na
 *    tabeli celu → 1 po ok. 10 s (lock_timeout); CHECK celu łamany przez wiersz
 *    źródła → 1; strumień ucięty na granicy wiersza (nakładka pg_dump; test
 *    najpierw dowodzi, że prefiks ma ≥ 1 pełny blok danych z wierszami i kończy
 *    się w środku kolejnego bloku) → bramka kompletności (P0001), kod 1. Po
 *    każdym: compare.sh celu równy stanowi sprzed (cel bez zmian), cel zamrożony;
 *  - sukces: kod 0, compare.sh obu baz równe poza count trzech tabel
 *    wykluczonych (w celu 0), schemat równy, sekwencja równa źródłu; nowe
 *    połączenie do celu jest tylko do odczytu; drugie uruchomienie → 0 i ten sam
 *    wynik compare.sh.
 *
 * Bazy (`it_cutover_<los>_*`) i rolę (`it_cutover_<los>_nonowner`) tworzy i usuwa
 * sam test przez pulę zweryfikowaną w `pg-harness.ts`. Pliki SQL skryptu (i
 * pliki sond) są kopiowane do kontenera usługi pod tę samą ścieżką (`docker cp`),
 * bo psql z nakładki czyta `-f` wewnątrz kontenera. Przypadki zależą od
 * kolejności (sekwencyjne `it`, `fileParallelism: false`).
 *
 * Bramka: `CUTOVER_COMPARE_PG=1`. Strażnik: `__tests__/lib/cutover-copy-reverse-config.test.ts`.
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createIntegrationDb, HARNESS_GUARD_CONTEXT, INTEGRATION_URL } from "./pg-harness";
import { checkSeedClientOptions, checkSeedTarget } from "../../scripts/seed-host-guard";

const ENABLED = process.env.CUTOVER_COMPARE_PG === "1";
const ROOT = process.cwd();
const REVERSE = join(ROOT, "infra/db/cutover/copy-cloudsql-to-neon.sh");
const FREEZE = join(ROOT, "infra/db/cutover/freeze-neon.sh");
const UNFREEZE = join(ROOT, "infra/db/cutover/unfreeze-neon.sh");
const COMPARE = join(ROOT, "infra/db/cutover/compare.sh");
const SQL_DIR = join(ROOT, "infra/db/cutover/sql");
const TAG = `it_cutover_${randomBytes(4).toString("hex")}`;
const DB_S = `${TAG}_rs`; // źródło (rola Cloud SQL)
const DB_T = `${TAG}_rt`; // cel (rola Neona: ustawienie neon.* w bazie)
const DB_E = `${TAG}_re`; // puste źródło
const OWN_DBS = [DB_S, DB_T, DB_E];
const SEED_OWNER_ID = "test-owner-user-id-00001";
/** Rola bez uprawnień do tabel (zwykła rola LOGIN, bez GRANT). */
const NONOWNER = `${TAG}_nonowner`;
const NONOWNER_PASS = randomBytes(16).toString("hex");
/** Sekwencja testu (schemat aplikacji nie ma dziś własnych sekwencji). */
const SEQ = `${TAG}_seq`;
const EXCLUDED = ["auth_rate_limit", "session", "verification"];
const EXCLUDE_FLAGS = EXCLUDED.map((t) => `--exclude-table-data=public.${t}`).join(" ");
const GATES = ["source_frozen=yes", "source_role_override=0", "target_role_override=0", "target_frozen=yes"];
const LIMIT = 120_000;
const HEAVY = 360_000;
const WRITE_PROBE = "BEGIN;\nCREATE TEMP TABLE it_probe (x int);\nROLLBACK;\n";
const RATE_ROW =
  "INSERT INTO public.auth_rate_limit (key, count, window_start, blocked_until, updated_at) " +
  "VALUES ('\\x00ff10'::bytea, 3, '2026-11-21 21:00:00+00', NULL, '2026-11-21 21:05:30+00')";

type Sql = ReturnType<typeof postgres>;
type Harness = NonNullable<Awaited<ReturnType<typeof createIntegrationDb>>>;
const base = INTEGRATION_URL ? new URL(INTEGRATION_URL) : null;

const PG_TOOLS = ["psql", "pg_dump", "pg_restore"] as const;
let toolPath = process.env.PATH ?? "";
let toolDir: string | null = null;
const tmpDirs: string[] = [];

/** Nakładki psql/pg_dump/pg_restore na kontener usługi bazy (CI), jak w cutover-copy.pg.test.ts. */
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

/**
 * psql z nakładki czyta `-f <plik>` wewnątrz kontenera: katalog trafia tam pod
 * tę samą ścieżką bezwzględną (docker cp, bez nowych obrazów). Lokalnie no-op.
 */
function mirrorIntoContainer(dir: string) {
  const cid = process.env.CUTOVER_PG_CONTAINER?.trim();
  if (!cid) return;
  if (!/^[0-9a-f]{12,64}$/.test(cid)) throw new Error("CUTOVER_PG_CONTAINER: nieoczekiwany kształt id kontenera");
  const mk = spawnSync("docker", ["exec", cid, "mkdir", "-p", dir], { encoding: "utf8", timeout: 30_000 });
  if (mk.status !== 0) throw new Error(`docker exec mkdir: kod ${mk.status}`);
  const cp = spawnSync("docker", ["cp", `${dir}/.`, `${cid}:${dir}`], { encoding: "utf8", timeout: 30_000 });
  if (cp.status !== 0) throw new Error(`docker cp: kod ${cp.status}`);
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

/** Klient do bazy testu: te same etapy guardu co harness + sonda serwera (neon.* tylko w celu). */
async function ownClient(db: string, neon: boolean): Promise<Sql> {
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
  if (row?.database !== db || (neon ? !(row?.neon > 0) : row?.neon !== 0)) {
    await sql.end({ timeout: 0 });
    throw new Error(neon ? "Odmowa: ustawienie neon.* niewidoczne w pg_settings celu" : "Odmowa: nieoczekiwana tożsamość serwera");
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

/** Źródło = PG* przez 127.0.0.1 (jak proxy Cloud SQL), cel = TARGET_* przez localhost. */
function reverseEnv(
  src: string,
  dst: string,
  o: { srcUser?: string; srcPass?: string; dstUser?: string; dstPass?: string } = {},
): NodeJS.ProcessEnv {
  return {
    ...pgEnv(src, o.srcUser, o.srcPass),
    TARGET_PGHOST: "localhost",
    TARGET_PGPORT: port(),
    TARGET_PGDATABASE: dst,
    TARGET_PGUSER: o.dstUser ?? superUser(),
    TARGET_PGPASSWORD: o.dstPass ?? superPass(),
  };
}

/** Adres administracyjny i adres sprawdzenia zamrożenia: ta sama rola, 127.0.0.1. */
function adminEnv(db: string): NodeJS.ProcessEnv {
  return {
    ...pgEnv(db),
    VERIFY_PGHOST: host(),
    VERIFY_PGPORT: port(),
    VERIFY_PGDATABASE: db,
    VERIFY_PGUSER: superUser(),
    VERIFY_PGPASSWORD: superPass(),
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
  const r = spawnSync("bash", [script, ...args], { encoding: "utf8", env: { ...env, HOME: home }, timeout: LIMIT });
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

const reverse = (env: NodeJS.ProcessEnv) => runScript(REVERSE, [], env);
const compare = (db: string, args: string[] = []) => runScript(COMPARE, args, pgEnv(db));

function freeze(db: string) {
  const r = runScript(FREEZE, [], adminEnv(db));
  expect(r.status, `freeze ${r.lines.join(" ")}`).toBe(0);
  expect(r.map.get("frozen")).toBe("yes");
}

function unfreeze(db: string) {
  const r = runScript(UNFREEZE, [], adminEnv(db));
  expect(r.status, `unfreeze ${r.lines.join(" ")}`).toBe(0);
  expect(r.map.get("unfrozen")).toBe("yes");
}

/** Nowe połączenie psql (osobny proces) z podanymi źródłami SQL. */
function psqlRun(args: string[], input: string, env: NodeJS.ProcessEnv) {
  return spawnSync(
    "psql",
    ["-X", "-q", "-A", "-t", "-w", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=sqlstate", ...args],
    { input, encoding: "utf8", env, timeout: 60_000 },
  );
}

function schemaFile(c: ScriptRun): string {
  const f = c.secureFiles.find((x) => x.endsWith(".schema.sql"));
  if (!f) throw new Error("brak pliku schematu");
  return join(c.home, "secure", f);
}

/** Klucze porównywane między przebiegami compare.sh (bez liczników pomocniczych i czasu). */
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
    timeout: LIMIT,
  });
  if (r.status !== 0) throw new Error(`drizzle-kit migrate (${db}) kod ${r.status}`);
}

function toolMajor(tool: string): number {
  const r = spawnSync(tool, ["--version"], { encoding: "utf8", env: { NODE_ENV: "test", PATH: toolPath, HOME: process.env.HOME ?? "" } });
  const m = /(\d+)(?:\.\d+)?/.exec(r.stdout ?? "");
  return m ? Number(m[1]) : 0;
}

describe.skipIf(!ENABLED || !INTEGRATION_URL)("copy-cloudsql-to-neon.sh na prawdziwym Postgresie", () => {
  let h: Harness;
  let s: Sql;
  let t: Sql;
  let tBefore: ScriptRun;
  let afterLoad: ScriptRun;

  /** Ustawienia na poziomie bazy (setrole = 0). */
  async function dbSettings(db: string): Promise<string> {
    const rows = await h.observer.unsafe(
      "select array_to_string(s.setconfig, ',') as c from pg_db_role_setting s " +
        "join pg_database d on d.oid = s.setdatabase where d.datname = $1 and s.setrole = 0",
      [db],
    );
    return rows.map((r) => String(r.c)).join(",");
  }

  /** Cel bez zmian: compare.sh --all-tables równy stanowi sprzed przypadków, cel zamrożony. */
  async function expectTargetUnchanged() {
    const now = compare(DB_T, ["--all-tables"]);
    expect(now.status, now.lines.join(" ")).toBe(0);
    expect(diffKeys(tBefore, now)).toEqual([]);
    expect(await dbSettings(DB_T)).toContain("default_transaction_read_only=on");
  }

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

    // Źródło: migracje + dane pos_dev jednym strumieniem (pos_dev tylko czytana).
    await h.observer.unsafe(`CREATE DATABASE ${DB_S}`);
    migrate(DB_S);
    const copy = spawnSync(
      "bash",
      [
        "-c",
        'set -o pipefail; pg_dump -w --data-only --schema=public -Fc -d "$SRC" | pg_restore -w --data-only --single-transaction --exit-on-error -d "$DST"',
      ],
      { encoding: "utf8", env: { ...pgEnv("pos_dev"), SRC: "pos_dev", DST: DB_S }, timeout: LIMIT },
    );
    expect(copy.status, "pg_dump | pg_restore pos_dev → źródło").toBe(0);
    const s0 = await ownClient(DB_S, false);
    try {
      await s0.unsafe(`CREATE SEQUENCE public.${SEQ}`);
      await s0.unsafe(`SELECT setval('public.${SEQ}', 41)`);
      await s0.unsafe(
        `INSERT INTO public.session (id, expires_at, token, created_at, updated_at, user_id) ` +
          `VALUES ('${TAG}-src-s', now() + interval '1 day', '${TAG}-src-token', now(), now(), '${SEED_OWNER_ID}')`,
      );
      await s0.unsafe(RATE_ROW);
    } finally {
      await s0.end({ timeout: 5 });
    }

    // Cel: szablon źródła, potem ustawienie neon.* w bazie i własne dane celu.
    await h.observer.unsafe(`CREATE DATABASE ${DB_T} TEMPLATE ${DB_S}`);
    await h.observer.unsafe(`ALTER DATABASE ${DB_T} SET neon.cutover_probe = 'on'`);
    t = await ownClient(DB_T, true);
    const upd = await t`UPDATE "user" SET name = name || ' (neon)' WHERE id = ${SEED_OWNER_ID}`;
    expect(upd.count).toBe(1);
    await t.unsafe(
      `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at) ` +
        `VALUES ('${TAG}-neon-user', 'IT cutover', '${TAG}@example.invalid', false, now(), now())`,
    );
    await t.unsafe(
      `INSERT INTO public.session (id, expires_at, token, created_at, updated_at, user_id) ` +
        `VALUES ('${TAG}-tgt-s', now() + interval '1 day', '${TAG}-tgt-token', now(), now(), '${TAG}-neon-user')`,
    );
    await t.unsafe(`SELECT setval('public.${SEQ}', 99)`);

    await h.observer.unsafe(`CREATE DATABASE ${DB_E}`);
    s = await ownClient(DB_S, false);
    await h.observer.unsafe(
      `CREATE ROLE ${NONOWNER} LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD '${NONOWNER_PASS}'`,
    );
    mirrorIntoContainer(realpathSync(SQL_DIR));
    for (const db of OWN_DBS) freeze(db);

    tBefore = compare(DB_T, ["--all-tables"]);
    const sBefore = compare(DB_S, ["--all-tables"]);
    expect(tBefore.status, tBefore.lines.join(" ")).toBe(0);
    expect(sBefore.status, sBefore.lines.join(" ")).toBe(0);
    // Cel ma inne dane niż źródło (test nie jest pusty).
    const differ = diffKeys(sBefore, tBefore);
    for (const k of ["count_user", "rows_hash_user", "rows_hash_session", `last_value_${SEQ}`]) expect(differ, k).toContain(k);
    expect(Number(tBefore.map.get("count_session"))).toBeGreaterThan(0);
  }, HEAVY);

  afterAll(async () => {
    await Promise.allSettled([s?.end({ timeout: 5 }), t?.end({ timeout: 5 })]);
    if (h) {
      for (const db of OWN_DBS) {
        if (db.startsWith("it_cutover_")) await h.observer.unsafe(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
      }
      if (NONOWNER.startsWith("it_cutover_")) await h.observer.unsafe(`DROP ROLE IF EXISTS ${NONOWNER}`);
      await h.end();
    }
    for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
    if (toolDir) rmSync(toolDir, { recursive: true, force: true });
  }, 60_000);

  it("(a) psql: -f plik -f - -f plik w jednej sesji i jednej transakcji, w tej kolejności", () => {
    const dir = mkdtempSync(join(tmpdir(), "it-cutover-probe-"));
    tmpDirs.push(dir);
    writeFileSync(
      join(dir, "a.sql"),
      "BEGIN READ ONLY;\nSELECT FROM pg_catalog.set_config('cutover_reverse.probe', '7', true);\nSELECT 'a=' || pg_backend_pid();\n",
    );
    writeFileSync(
      join(dir, "c.sql"),
      "SELECT 'c=' || pg_backend_pid() || ':' || current_setting('cutover_reverse.probe');\nCOMMIT;\n" +
        "SELECT 'd=' || coalesce(nullif(current_setting('cutover_reverse.probe', true), ''), 'none');\n",
    );
    mirrorIntoContainer(dir);
    const r = psqlRun(
      ["-f", join(dir, "a.sql"), "-f", "-", "-f", join(dir, "c.sql")],
      "SELECT 'b=' || pg_backend_pid() || ':' || current_setting('cutover_reverse.probe');\n",
      pgEnv(DB_S),
    );
    expect(r.status, r.stderr).toBe(0);
    const out = r.stdout.split("\n").filter(Boolean);
    const pid = (out[0] ?? "").slice(2);
    expect(pid).toMatch(/^\d+$/);
    // Ta sama sesja (pid), ustawienie LOCAL widoczne w b i c (jedna transakcja), po COMMIT z c już nie.
    expect(out).toEqual([`a=${pid}`, `b=${pid}:7`, `c=${pid}:7`, "d=none"]);
  }, LIMIT);

  it("(b) pg_dump -Fp emituje \\restrict; restrict bez unrestrict nie blokuje SQL z następnego -f", () => {
    const d = spawnSync("bash", ["-c", `pg_dump -w --data-only --schema=public -Fp ${EXCLUDE_FLAGS}`], {
      encoding: "utf8",
      env: pgEnv(DB_S),
      timeout: LIMIT,
      maxBuffer: 64 * 1024 * 1024,
    });
    expect(d.status, d.stderr).toBe(0);
    const lines = d.stdout.split("\n");
    expect(lines.some((l) => /^\\restrict \S+$/.test(l)), "\\restrict w zrzucie").toBe(true);
    expect(lines.some((l) => /^\\unrestrict \S+$/.test(l)), "\\unrestrict w zrzucie").toBe(true);

    const dir = mkdtempSync(join(tmpdir(), "it-cutover-probe-"));
    tmpDirs.push(dir);
    writeFileSync(join(dir, "p.sql"), "SELECT 'p=' || 1;\n");
    mirrorIntoContainer(dir);
    const r = psqlRun(["-f", "-", "-f", join(dir, "p.sql")], "\\restrict itprobekey\nSELECT 's=' || 1;\n", pgEnv(DB_S));
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout.split("\n").filter(Boolean)).toEqual(["s=1", "p=1"]);
  }, LIMIT);

  it("zamienione serwery: źródło z neon.* albo cel bez neon.* → kod 4 bez zapisu", () => {
    const a = reverse(reverseEnv(DB_T, DB_S));
    expect(a.lines).toEqual(["exit=4"]);
    expect(a.status).toBe(4);
    const b = reverse(reverseEnv(DB_S, DB_E));
    expect(b.lines).toEqual(["exit=4"]);
    expect(b.status).toBe(4);
  }, LIMIT);

  it("źródło niezamrożone → source_frozen=no, kod 6", () => {
    unfreeze(DB_S);
    try {
      const r = reverse(reverseEnv(DB_S, DB_T));
      expect(r.lines).toEqual(["source_frozen=no", "exit=6"]);
      expect(r.status).toBe(6);
    } finally {
      freeze(DB_S);
    }
  }, LIMIT);

  it("cel niezamrożony → target_frozen=no, kod 8", () => {
    unfreeze(DB_T);
    try {
      const r = reverse(reverseEnv(DB_S, DB_T));
      expect(r.lines).toEqual([...GATES.slice(0, 3), "target_frozen=no", "exit=8"]);
      expect(r.status).toBe(8);
    } finally {
      freeze(DB_T);
    }
  }, LIMIT);

  it("ALTER ROLE … IN DATABASE celu SET default_transaction_read_only → target_role_override=1, kod 7", async () => {
    await h.observer.unsafe(`ALTER ROLE ${NONOWNER} IN DATABASE ${DB_T} SET default_transaction_read_only = off`);
    try {
      const r = reverse(reverseEnv(DB_S, DB_T));
      expect(r.lines).toEqual(["source_frozen=yes", "source_role_override=0", "target_role_override=1", "exit=7"]);
      expect(r.status).toBe(7);
    } finally {
      await h.observer.unsafe(`ALTER ROLE ${NONOWNER} IN DATABASE ${DB_T} RESET default_transaction_read_only`);
    }
  }, LIMIT);

  it("puste źródło → source_nonempty_tables=0, kod 5 (nie zeruje celu)", () => {
    const r = reverse(reverseEnv(DB_E, DB_T));
    expect(r.lines).toEqual([...GATES, "fk_cycle_tables=0", "source_nonempty_tables=0", "exit=5"]);
    expect(r.status).toBe(5);
  }, LIMIT);

  it("cykl kluczy obcych w źródle → fk_cycle_tables=1, error_class=circular_fk, kod 1", async () => {
    const cyc = `${TAG}_cycle`;
    await s.begin("read write", (sql) => sql.unsafe(`CREATE TABLE public.${cyc} (id int PRIMARY KEY, parent int REFERENCES public.${cyc} (id))`));
    try {
      const r = reverse(reverseEnv(DB_S, DB_T));
      expect(r.lines).toEqual([...GATES, "fk_cycle_tables=1", "error_class=circular_fk", "exit=1"]);
      expect(r.status).toBe(1);
    } finally {
      await s.begin("read write", (sql) => sql.unsafe(`DROP TABLE public.${cyc}`));
    }
  }, LIMIT);

  it("błędne hasło celu → na fd 3 wyłącznie error_class=connection i exit=", () => {
    const wrong = `wrong-${randomBytes(8).toString("hex")}`;
    const r = reverse(reverseEnv(DB_S, DB_T, { dstPass: wrong }));
    expect(r.lines).toEqual(["error_class=connection", "exit=1"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toBe("");
    expect(r.log).toMatch(/password authentication failed/);
    expect(r.log).not.toContain(wrong);
  }, LIMIT);

  it("rola źródła bez uprawnień do tabel → 42501, error_class=other, kod 1 (nie ciche zero)", async () => {
    const r = reverse(reverseEnv(DB_S, DB_T, { srcUser: NONOWNER, srcPass: NONOWNER_PASS }));
    expect(r.lines).toEqual([...GATES, "error_class=other", "exit=1"]);
    expect(r.status).toBe(1);
    expect(r.log).toMatch(/ERROR: +42501/);
    expect(r.log).not.toContain(NONOWNER_PASS);
    // Po wszystkich bramkach przed zapisem: cel bez zmian.
    await expectTargetUnchanged();
  }, LIMIT);

  it("rola celu niebędąca właścicielem → błąd przy czyszczeniu, kod 1, cel bez zmian", async () => {
    const r = reverse(reverseEnv(DB_S, DB_T, { dstUser: NONOWNER, dstPass: NONOWNER_PASS }));
    expect(r.status, r.lines.join(" ")).toBe(1);
    expect(r.map.get("restore_exit")).toBe("3");
    expect(r.map.get("error_class")).toBe("other");
    expect(r.map.has("loaded")).toBe(false);
    expect(r.log).toMatch(/ERROR: +42501/);
    await expectTargetUnchanged();
  }, LIMIT);

  it("otwarta transakcja z ACCESS SHARE na tabeli celu → lock_timeout (55P03) po ok. 10 s, kod 1, cel bez zmian", async () => {
    const holder = await ownClient(DB_T, true);
    try {
      await holder.unsafe("BEGIN READ ONLY");
      await holder.unsafe('SELECT 1 FROM public."user" LIMIT 1');
      const t0 = Date.now();
      const r = reverse(reverseEnv(DB_S, DB_T));
      const ms = Date.now() - t0;
      expect(r.status, r.lines.join(" ")).toBe(1);
      expect(r.map.get("restore_exit")).toBe("3");
      expect(r.map.get("error_class")).toBe("other");
      expect(r.log).toMatch(/ERROR: +55P03/);
      expect(ms).toBeGreaterThanOrEqual(9_000);
    } finally {
      await holder.unsafe("ROLLBACK").catch(() => undefined);
      await holder.end({ timeout: 5 });
    }
    await expectTargetUnchanged();
  }, LIMIT);

  it("CHECK celu łamany przez wiersz źródła → 23514, kod 1; czyszczenie wycofane razem z importem", async () => {
    const con = `${TAG}_check`;
    await t.begin("read write", (sql) => sql.unsafe(`ALTER TABLE public."user" ADD CONSTRAINT ${con} CHECK (false) NOT VALID`));
    try {
      const r = reverse(reverseEnv(DB_S, DB_T));
      expect(r.status, r.lines.join(" ")).toBe(1);
      expect(r.map.get("dump_exit")).toMatch(/^\d+$/);
      expect(r.map.get("restore_exit")).toBe("3");
      expect(r.map.get("error_class")).toBe("other");
      expect(r.map.has("loaded")).toBe(false);
      expect(r.log).toMatch(/ERROR: +23514/);
    } finally {
      await t.begin("read write", (sql) => sql.unsafe(`ALTER TABLE public."user" DROP CONSTRAINT ${con}`));
    }
    await expectTargetUnchanged();
  }, LIMIT);

  it("strumień ucięty na granicy wiersza → bramka kompletności (P0001), kod 1, cel bez zmian", async () => {
    // Zrzut tymi samymi flagami co skrypt (do pamięci testu, bez pliku). Cięcie:
    // po pierwszym wierszu bloku, który ma ≥ 2 wiersze i leży za pierwszym pełnym
    // blokiem z wierszami — prefiks ma pełny blok danych, a kończy się w środku
    // kolejnego (psql zakończy COPY na końcu wejścia bez błędu; zatrzymać może
    // tylko bramka).
    const full = spawnSync("bash", ["-c", `pg_dump -w --data-only --schema=public -Fp ${EXCLUDE_FLAGS}`], {
      encoding: "utf8",
      env: pgEnv(DB_S),
      timeout: LIMIT,
      maxBuffer: 64 * 1024 * 1024,
    });
    expect(full.status, full.stderr).toBe(0);
    const lines = full.stdout.split("\n");
    const blocks: { start: number; end: number; rows: number }[] = [];
    let open: { start: number; end: number; rows: number } | null = null;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i]!;
      if (open === null) {
        if (/^COPY .* FROM stdin;$/.test(l)) open = { start: i, end: -1, rows: 0 };
      } else if (l === "\\.") {
        open.end = i;
        blocks.push(open);
        open = null;
      } else {
        open.rows++;
      }
    }
    const first = blocks.find((b) => b.rows >= 1);
    expect(first, "pełny blok danych z wierszami").toBeDefined();
    const later = blocks.find((b) => b.start > first!.end && b.rows >= 2);
    expect(later, "kolejny blok z ≥ 2 wierszami").toBeDefined();
    const keep = later!.start + 2; // wiersz COPY + pierwszy wiersz danych
    const prefix = lines.slice(0, keep);
    expect(blocks.filter((b) => b.end < keep && b.rows > 0).length, "prefiks: ≥ 1 pełny blok z wierszami").toBeGreaterThanOrEqual(1);
    expect(prefix[keep - 1], "prefiks kończy się wierszem danych").not.toBe("\\.");
    expect(prefix.some((l) => l.startsWith("\\unrestrict")), "prefiks bez końca zrzutu").toBe(false);

    const real = toolDir
      ? join(toolDir, "pg_dump")
      : spawnSync("bash", ["-c", "command -v pg_dump"], { encoding: "utf8", env: { NODE_ENV: "test", PATH: toolPath } }).stdout.trim();
    expect(real).toMatch(/^\//);
    const breakDir = mkdtempSync(join(tmpdir(), "it-cutover-break-"));
    tmpDirs.push(breakDir);
    writeFileSync(join(breakDir, "pg_dump"), `#!/bin/sh\n"${real}" "$@" | head -n ${keep}\nexit 1\n`);
    chmodSync(join(breakDir, "pg_dump"), 0o755);

    const r = reverse({ ...reverseEnv(DB_S, DB_T), PATH: `${breakDir}:${toolPath}` });
    expect(r.status, r.lines.join(" ")).toBe(1);
    expect(r.map.get("dump_exit")).toBe("1");
    expect(r.map.get("restore_exit")).toBe("3");
    expect(r.map.get("error_class")).toBe("other");
    expect(r.map.has("loaded")).toBe(false);
    expect(r.lines[r.lines.length - 1]).toBe("exit=1");
    // Zatrzymała bramka (RAISE w reverse-post.sql), nie błąd COPY.
    expect(r.log).toMatch(/ERROR: +P0001/);
    await expectTargetUnchanged();
  }, LIMIT);

  it("sukces: kod 0; compare.sh obu baz równe poza count trzech tabel wykluczonych; cel nadal tylko do odczytu", async () => {
    const r = reverse(reverseEnv(DB_S, DB_T));
    expect(r.status, r.lines.join(" ")).toBe(0);
    expect(r.lines.slice(0, 5)).toEqual([...GATES, "fk_cycle_tables=0"]);
    expect(r.lines[5]).toMatch(/^source_nonempty_tables=[1-9]\d*$/);
    expect(r.lines[6]).toMatch(/^truncated_tables=[1-9]\d*$/);
    expect(r.lines.slice(7, 11)).toEqual(["dump_exit=0", "restore_exit=0", "target_frozen_after=yes", "loaded=yes"]);
    expect(r.lines[11]).toMatch(/^copy_seconds=\d+$/);
    expect(r.lines[12]).toBe("exit=0");
    expect(r.lines).toHaveLength(13);
    expect(r.stderr).toBe("");
    // Bez pliku pośredniego: w $HOME/secure tylko log, bez haseł.
    expect(r.secureFiles.every((f) => f.endsWith(".log")), r.secureFiles.join(",")).toBe(true);
    expect(r.log).not.toContain(superPass());

    const a = compare(DB_S);
    const b = compare(DB_T, [`--schema-baseline=${schemaFile(a)}`]);
    expect(a.status, a.lines.join(" ")).toBe(0);
    expect(b.status, b.lines.join(" ")).toBe(0);
    expect(b.map.get("schema_equal")).toBe("yes");
    expect([...a.map.keys()].filter((k) => k.startsWith("rows_hash_")).length).toBeGreaterThan(10);
    const allowed = EXCLUDED.map((k) => `count_${k}`);
    for (const k of diffKeys(a, b)) expect(allowed, k).toContain(k);
    for (const k of allowed) expect(b.map.get(k), k).toBe("0");
    expect(Number(a.map.get("count_session")), "źródło ma sesje, których cel nie dostaje").toBeGreaterThan(0);
    expect(b.map.get(`last_value_${SEQ}`)).toBe("41");
    expect(b.map.get("rows_hash_user")).not.toBe(tBefore.map.get("rows_hash_user"));
    afterLoad = b;

    // Nowe połączenie do celu: nadal tylko do odczytu.
    expect(await dbSettings(DB_T)).toContain("default_transaction_read_only=on");
    const show = psqlRun(["-f", "-"], "SHOW default_transaction_read_only;\n", pgEnv(DB_T));
    expect(show.stdout.trim()).toBe("on");
    const write = psqlRun(["-f", "-"], WRITE_PROBE, pgEnv(DB_T));
    expect(write.status).not.toBe(0);
    expect(write.stderr).toMatch(/ERROR: +25006/);
  }, HEAVY);

  it("drugie uruchomienie po sukcesie → kod 0 i ten sam wynik compare.sh (idempotentne)", () => {
    const r = reverse(reverseEnv(DB_S, DB_T));
    expect(r.status, r.lines.join(" ")).toBe(0);
    expect(r.map.get("loaded")).toBe("yes");
    const b = compare(DB_T);
    expect(b.status).toBe(0);
    expect(diffKeys(afterLoad, b)).toEqual([]);
  }, LIMIT);
});
