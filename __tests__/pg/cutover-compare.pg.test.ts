/**
 * `infra/db/cutover/compare.sh` na PRAWDZIWYM Postgresie (krok `pnpm test:pg`
 * joba CI `e2e-smoke`, po migracjach i seedzie bazy `pos_dev`).
 *
 * (f)  pos_dev (po migracjach + seed) → `pg_dump --data-only --schema=public -Fc`
 *      | `pg_restore --data-only --single-transaction --exit-on-error` do drugiej
 *      bazy po migracjach → `compare.sh` obu baz równe (count, rows_hash,
 *      last_value, RLS, polityki, GRANT-y, rozszerzenia, migracje, schemat).
 *      Druga baza z `ALTER DATABASE … SET TimeZone='Europe/Warsaw'` → nadal równe.
 * (f1) UPDATE jednej kolumny jednego wiersza w drugiej bazie → różny wyłącznie
 *      `rows_hash_<tabela>`; dwie świeże bazy z tym samym wierszem
 *      `auth_rate_limit` (timestamptz, bytea), jedna w strefie Europe/Warsaw:
 *      zwykłe zapytanie daje różny tekst, `compare.sh --all-tables` równy hash.
 * (f3) `--expect-empty`: jeden wiersz w `auth_rate_limit` → `expect_empty=yes`
 *      (tabela wyczyszczona); jeden wiersz w `user` → `expect_empty=no`, kod ≠ 0.
 *      Świeża baza po migracjach nie ma niepustych tabel (lista słownikowa pusta).
 * (f4) błędne hasło → na fd 3 tylko `error_class=connection` i `exit=`.
 * (e1) rola logowania testu (nie-właściciel, bez BYPASSRLS, GRANT SELECT na
 *      tabele) → compare.sh i --expect-empty dają `error_class=other`, kod 1
 *      (42501 przy `row_security = off`), a nie przefiltrowane „0 = 0”; ta sama
 *      rola z `row_security = on` widzi mniej wierszy bez błędu (zagrożenie
 *      istnieje), a pg_sequence_last_value bez uprawnienia rzuca 42501.
 *      Rolę tworzy i usuwa sam test; GRANT-y tylko w bazie testu.
 *
 * Bazy testu (`it_cutover_<los>_*`) tworzy i usuwa sam test przez pulę
 * zweryfikowaną w `pg-harness.ts` (pos_dev, ten sam serwer). pos_dev jest tylko
 * czytana (compare.sh w trybie domyślnym i pg_dump). Narzędzia psql, pg_dump,
 * pg_restore w wersji ≥ serwera: z `CUTOVER_PG_CONTAINER` (id kontenera usługi
 * bazy w CI) test tworzy w katalogu tymczasowym nakładki `docker exec -i <id>
 * <narzędzie>` i stawia je pierwsze na PATH narzędzi (bez apt, bez nowych
 * obrazów). Wewnątrz kontenera połączenie idzie na adres kontenera w sieci
 * usług, nie na 127.0.0.1 — pg_hba obrazu ufa pętli zwrotnej bez hasła, a (f4)
 * wymaga sprawdzenia hasła. Bez zmiennej — narzędzia z PATH (lokalnie).
 *
 * Bramka: `CUTOVER_COMPARE_PG=1` (krok `pnpm test:pg` w e2e-smoke, po seedzie).
 * Strażnik kroku: `__tests__/lib/cutover-compare-config.test.ts`.
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createIntegrationDb, HARNESS_GUARD_CONTEXT, INTEGRATION_URL } from "./pg-harness";
import { checkSeedClientOptions, checkSeedTarget } from "../../scripts/seed-host-guard";

const ENABLED = process.env.CUTOVER_COMPARE_PG === "1";
const ROOT = process.cwd();
const SCRIPT = join(ROOT, "infra/db/cutover/compare.sh");
const SCRIPT_SOURCE = readFileSync(SCRIPT, "utf8");
const TAG = `it_cutover_${randomBytes(4).toString("hex")}`;
const DB_B = `${TAG}_b`; // cel zrzutu danych z pos_dev
const DB_C = `${TAG}_c`; // świeża baza po migracjach (--expect-empty, strefa)
const DB_D = `${TAG}_d`; // świeża baza po migracjach, strefa Europe/Warsaw
const OWN_DBS = [DB_B, DB_C, DB_D];
const SEED_OWNER_ID = "test-owner-user-id-00001";
/** Rola logowania testu (e1): nie-właściciel, bez SUPERUSER i BYPASSRLS, z GRANT SELECT. */
const RO_ROLE = `${TAG}_ro`;
const RO_PASS = randomBytes(16).toString("hex");

/**
 * Gałąź --expect-empty liczy wszystkie tabele public (lista słownikowa pusta,
 * bo migracje nie wstawiają wierszy). Ten plik sprawdza to na świeżej bazie.
 */
const EXPECT_EMPTY_COUNTS_ALL = (() => {
  const start = SCRIPT_SOURCE.indexOf("\nexpect_empty() {\n");
  const body = SCRIPT_SOURCE.slice(start, SCRIPT_SOURCE.indexOf("\n}\n", start));
  return start > 0 && !/NOT IN/.test(body);
})();

type Sql = ReturnType<typeof postgres>;
type Harness = NonNullable<Awaited<ReturnType<typeof createIntegrationDb>>>;

const base = INTEGRATION_URL ? new URL(INTEGRATION_URL) : null;

const PG_TOOLS = ["psql", "pg_dump", "pg_restore"] as const;
/** PATH narzędzi PG dla compare.sh, zrzutu i sondy wersji (nakładki na początku w CI). */
let toolPath = process.env.PATH ?? "";
let toolDir: string | null = null;

/**
 * Nakładki psql/pg_dump/pg_restore na kontener usługi bazy (CI). Hasło i pozostałe
 * zmienne libpq idą do `docker exec` jako `-e NAZWA` (wartość ze środowiska procesu,
 * nie z argumentu). PGHOST w kontenerze = jego adres w sieci usług (pg_hba z hasłem).
 * Zwraca katalog nakładek albo null, gdy zmiennej brak.
 */
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

function urlFor(db: string): string {
  const u = new URL(base!.toString());
  u.pathname = `/${db}`;
  return u.toString();
}

/** Klient do bazy testu: te same etapy 1–2 guardu co harness + sonda serwera. */
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

/** Zmienne libpq dla narzędzi (hasło tylko w środowisku procesu). */
function pgEnv(db: string, password?: string, user?: string): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    PATH: toolPath,
    // Klient docker (nakładki w CI) czyta konfigurację z $HOME; compare() podaje własny HOME.
    HOME: process.env.HOME ?? "",
    PGHOST: base!.hostname === "localhost" ? "127.0.0.1" : base!.hostname,
    PGPORT: base!.port || "5432",
    PGUSER: user ?? decodeURIComponent(base!.username),
    PGPASSWORD: password ?? decodeURIComponent(base!.password),
    PGDATABASE: db,
  };
}

interface Compare {
  status: number | null;
  lines: string[];
  map: Map<string, string>;
  stderr: string;
  home: string;
}

const homes: string[] = [];
function compare(db: string, args: string[] = [], password?: string, user?: string): Compare {
  const home = mkdtempSync(join(tmpdir(), "it-cutover-home-"));
  homes.push(home);
  const r = spawnSync("bash", [SCRIPT, ...args], {
    encoding: "utf8",
    env: { ...pgEnv(db, password, user), HOME: home },
    timeout: 120_000,
  });
  const lines = r.stdout.split("\n").filter(Boolean);
  const map = new Map(lines.map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)] as const));
  return { status: r.status, lines, map, stderr: r.stderr, home };
}

function schemaFile(c: Compare): string {
  const dir = join(c.home, "secure");
  const f = readdirSync(dir).find((x) => x.endsWith(".schema.sql"));
  if (!f) throw new Error("brak pliku schematu");
  return join(dir, f);
}

/** Klucze porównywane między bazami (bez liczników pomocniczych i czasu). */
function comparable(c: Compare): Map<string, string> {
  return new Map([...c.map].filter(([k]) => !k.startsWith("writes_") && k !== "compare_seconds"));
}

function diffKeys(a: Compare, b: Compare): string[] {
  const x = comparable(a);
  const y = comparable(b);
  const keys = new Set([...x.keys(), ...y.keys()]);
  return [...keys].filter((k) => x.get(k) !== y.get(k)).sort();
}

function logOf(c: Compare): string {
  const dir = join(c.home, "secure");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".log"))
    .map((f) => readFileSync(join(dir, f), "utf8"))
    .join("\n");
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

const RATE_ROW =
  "INSERT INTO public.auth_rate_limit (key, count, window_start, blocked_until, updated_at) " +
  "VALUES ('\\x00ff10'::bytea, 3, '2026-11-21 21:00:00+00', NULL, '2026-11-21 21:05:30.123456+00')";

describe.skipIf(!ENABLED || !INTEGRATION_URL)("compare.sh na prawdziwym Postgresie", () => {
  let h: Harness;
  let b: Sql;
  let c: Sql;
  let d: Sql;
  let a0: Compare;

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
    b = await ownClient(DB_B);
    c = await ownClient(DB_C);
    d = await ownClient(DB_D);

    // (f) zrzut danych pos_dev → B, jednym strumieniem, bez pliku.
    const r = spawnSync(
      "bash",
      [
        "-c",
        'set -o pipefail; pg_dump -w --data-only --schema=public -Fc -d "$SRC" | pg_restore -w --data-only --single-transaction --exit-on-error -d "$DST"',
      ],
      { encoding: "utf8", env: { ...pgEnv("pos_dev"), SRC: "pos_dev", DST: DB_B }, timeout: 120_000 },
    );
    expect(r.stderr, "zrzut bez cykli FK").not.toMatch(/circular foreign-key/i);
    expect(r.status, "pg_dump | pg_restore").toBe(0);

    a0 = compare("pos_dev");
    expect(a0.status, a0.lines.join(" ")).toBe(0);
  }, 300_000);

  afterAll(async () => {
    await Promise.allSettled([b?.end({ timeout: 5 }), c?.end({ timeout: 5 }), d?.end({ timeout: 5 })]);
    if (h) {
      for (const db of OWN_DBS) {
        if (db.startsWith("it_cutover_")) await h.observer.unsafe(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
      }
      // GRANT-y roli testu żyją tylko w DB_B (usuniętej wyżej), więc rola nie ma zależności.
      if (RO_ROLE.startsWith("it_cutover_")) await h.observer.unsafe(`DROP ROLE IF EXISTS ${RO_ROLE}`);
      await h.end();
    }
    for (const home of homes) rmSync(home, { recursive: true, force: true });
    if (toolDir) rmSync(toolDir, { recursive: true, force: true });
  }, 60_000);

  it("(f) pos_dev i baza po zrzucie danych: wszystkie klucze równe, schemat równy", () => {
    expect(a0.lines[a0.lines.length - 1]).toBe("exit=0");
    expect([...a0.map.keys()].filter((k) => k.startsWith("rows_hash_")).length).toBeGreaterThan(10);
    expect(Number(a0.map.get("count_user"))).toBeGreaterThan(0);
    expect(a0.map.has("rows_hash_session")).toBe(false);
    expect(a0.map.has("rows_hash_auth_rate_limit")).toBe(false);

    const bRun = compare(DB_B, [`--schema-baseline=${schemaFile(a0)}`]);
    expect(bRun.status, bRun.lines.join(" ")).toBe(0);
    expect(bRun.map.get("schema_equal")).toBe("yes");
    expect(diffKeys(a0, bRun).filter((k) => k !== "schema_equal")).toEqual([]);
    expect(bRun.stderr).toBe("");
  });

  it("(f) --all-tables: także session, verification, auth_rate_limit; równe", () => {
    const a = compare("pos_dev", ["--all-tables"]);
    const bb = compare(DB_B, ["--all-tables"]);
    expect(a.status).toBe(0);
    expect(bb.status).toBe(0);
    for (const t of ["session", "verification", "auth_rate_limit"]) expect(a.map.has(`rows_hash_${t}`), t).toBe(true);
    expect(diffKeys(a, bb)).toEqual([]);
  });

  it("(f) druga baza w strefie Europe/Warsaw → wszystkie rows_hash_* nadal równe", async () => {
    await h.observer.unsafe(`ALTER DATABASE ${DB_B} SET TimeZone = 'Europe/Warsaw'`);
    const bRun = compare(DB_B);
    expect(bRun.status).toBe(0);
    expect(diffKeys(a0, bRun)).toEqual([]);
  });

  it("(f1) UPDATE jednej kolumny jednego wiersza → różny wyłącznie rows_hash_user", async () => {
    const updated = await b`UPDATE "user" SET name = name || ' (x)' WHERE id = ${SEED_OWNER_ID}`;
    expect(updated.count).toBe(1);
    const bRun = compare(DB_B);
    expect(bRun.status).toBe(0);
    expect(diffKeys(a0, bRun)).toEqual(["rows_hash_user"]);
    expect(bRun.map.get("count_user")).toBe(a0.map.get("count_user"));
  });

  it("(f1) ten sam wiersz timestamptz/bytea w strefach UTC i Europe/Warsaw: tekst różny, hash compare.sh równy", async () => {
    await h.observer.unsafe(`ALTER DATABASE ${DB_D} SET TimeZone = 'Europe/Warsaw'`);
    await d.end({ timeout: 5 });
    d = await ownClient(DB_D); // nowa sesja z ustawieniem bazy
    await c.unsafe(RATE_ROW);
    await d.unsafe(RATE_ROW);
    const q = "select string_agg(t::text, E'\\n' order by t::text) as v from public.auth_rate_limit t";
    const [tc] = await c.unsafe(q);
    const [td] = await d.unsafe(q);
    expect(tc!.v, "ustawienie strefy działa (test nie jest pusty)").not.toBe(td!.v);

    const cr = compare(DB_C, ["--all-tables"]);
    const dr = compare(DB_D, ["--all-tables"]);
    expect(cr.status).toBe(0);
    expect(dr.status).toBe(0);
    expect(cr.map.get("rows_hash_auth_rate_limit")).toMatch(/^[0-9a-f]{32}$/);
    expect(diffKeys(cr, dr)).toEqual([]);
    await d.unsafe("DELETE FROM public.auth_rate_limit");
  });

  it("(f3) świeża baza po migracjach nie ma niepustych tabel (lista słownikowa skryptu pusta)", async () => {
    expect(EXPECT_EMPTY_COUNTS_ALL).toBe(true);
    const rows = await d.unsafe(
      "select c.relname as t from pg_class c join pg_namespace n on n.oid = c.relnamespace " +
        "where n.nspname = 'public' and c.relkind in ('r','p') and not c.relispartition order by 1",
    );
    const nonempty: string[] = [];
    for (const r of rows) {
      const [x] = await d.unsafe(`select exists (select 1 from public."${String(r.t).replace(/"/g, '""')}") as e`);
      if (x!.e) nonempty.push(String(r.t));
    }
    expect(nonempty).toEqual([]);
  });

  it("(f3) --expect-empty: wiersz w auth_rate_limit → yes, tabela wyczyszczona; wiersz w user → no, kod ≠ 0", async () => {
    const [before] = await c.unsafe("select count(*)::int as n from public.auth_rate_limit");
    expect(before!.n).toBe(1); // wiersz z przypadku strefy
    const yes = compare(DB_C, ["--expect-empty"]);
    expect(yes.lines).toEqual(["nonempty_tables=0", "expect_empty=yes", "exit=0"]);
    expect(yes.status).toBe(0);
    const [after] = await c.unsafe("select count(*)::int as n from public.auth_rate_limit");
    expect(after!.n).toBe(0);

    await c.unsafe(
      `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at) ` +
        `VALUES ('${TAG}-user', 'IT cutover', '${TAG}@example.invalid', false, now(), now())`,
    );
    const no = compare(DB_C, ["--expect-empty"]);
    expect(no.lines).toEqual(["nonempty_tables=1", "expect_empty=no", "exit=5"]);
    expect(no.status).not.toBe(0);
  });

  it("(f3) --expect-empty z PGHOST=localhost → kod 4 bez połączenia", () => {
    const home = mkdtempSync(join(tmpdir(), "it-cutover-home-"));
    homes.push(home);
    const r = spawnSync("bash", [SCRIPT, "--expect-empty"], {
      encoding: "utf8",
      env: { ...pgEnv(DB_C), PGHOST: "localhost", HOME: home },
    });
    expect(r.status).toBe(4);
    expect(r.stdout).toBe("exit=4\n");
  });

  it("(f4) błędne hasło → na fd 3 wyłącznie error_class=connection i exit=", () => {
    const wrong = `wrong-${randomBytes(8).toString("hex")}`;
    const r = compare(DB_C, [], wrong);
    expect(r.lines).toEqual(["error_class=connection", "exit=1"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toBe("");
    expect(logOf(r)).toMatch(/password authentication failed/);
    expect(logOf(r)).not.toContain(wrong);
  });

  it("(e1) rola nie-właściciel bez BYPASSRLS z GRANT SELECT → error_class=other, exit=1 (42501), nie ciche 0 = 0", async () => {
    await h.observer.unsafe(
      `CREATE ROLE ${RO_ROLE} LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD '${RO_PASS}'`,
    );
    await b.unsafe(`GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${RO_ROLE}`);
    await b.unsafe(`GRANT USAGE ON SCHEMA drizzle TO ${RO_ROLE}`);
    await b.unsafe(`GRANT SELECT ON ALL TABLES IN SCHEMA drizzle TO ${RO_ROLE}`);
    // Jedyny zapis --expect-empty; bez tego rola padłaby na TRUNCATE, a nie na bloku odczytu.
    await b.unsafe(`GRANT TRUNCATE ON public.auth_rate_limit TO ${RO_ROLE}`);
    const [attrs] = await b.unsafe(`select rolsuper, rolbypassrls from pg_roles where rolname = '${RO_ROLE}'`);
    expect(attrs).toMatchObject({ rolsuper: false, rolbypassrls: false });

    // Tabela z RLS i wierszami w B (po zrzucie seeda).
    const rlsTables = await b.unsafe(
      "select c.relname as t from pg_class c join pg_namespace n on n.oid = c.relnamespace " +
        "where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity order by c.relname collate \"C\"",
    );
    let table = "";
    let total = 0;
    for (const r of rlsTables) {
      const q = `"${String(r.t).replace(/"/g, '""')}"`;
      const [x] = await b.unsafe(`select count(*)::int as n from public.${q}`);
      if (x!.n > 0) {
        table = q;
        total = x!.n;
        break;
      }
    }
    expect(table, "tabela z RLS i wierszami w bazie po zrzucie seeda").not.toBe("");

    // Zagrożenie, które zamyka poprawka: z row_security = on ta rola widzi mniej
    // wierszy niż właściciel, bez błędu (po obu stronach porównania byłoby „0 = 0”).
    const filtered = await b.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL ROLE ${RO_ROLE}`);
      await tx.unsafe("SET LOCAL row_security = on");
      const [x] = await tx.unsafe(`select count(*)::int as n from public.${table}`);
      return x!.n as number;
    });
    expect(filtered).toBeLessThan(total);
    // Z row_security = off ta sama rola dostaje 42501.
    await expect(
      b.begin(async (tx) => {
        await tx.unsafe(`SET LOCAL ROLE ${RO_ROLE}`);
        await tx.unsafe("SET LOCAL row_security = off");
        await tx.unsafe(`select count(*) from public.${table}`);
      }),
    ).rejects.toMatchObject({ code: "42501" });

    // Sekwencja bez uprawnienia: pg_sequence_last_value rzuca 42501 (nie NULL → 0).
    const [seq] = await b.unsafe(
      "select sequencename as s from pg_sequences where schemaname = 'public' order by sequencename collate \"C\" limit 1",
    );
    expect(seq, "sekwencja w schemacie public").toBeDefined();
    const seqName = `"${String(seq!.s).replace(/"/g, '""')}"`;
    await expect(
      b.begin(async (tx) => {
        await tx.unsafe(`SET LOCAL ROLE ${RO_ROLE}`);
        await tx.unsafe(`select pg_sequence_last_value('public.${seqName.replace(/'/g, "''")}'::regclass)`);
      }),
    ).rejects.toMatchObject({ code: "42501" });

    // compare.sh jako ta rola: błąd, nie liczby.
    const cmp = compare(DB_B, [], RO_PASS, RO_ROLE);
    expect(cmp.lines).toEqual(["error_class=other", "exit=1"]);
    expect(cmp.status).toBe(1);
    expect(cmp.stderr).toBe("");
    expect(logOf(cmp)).toMatch(/ERROR: +42501/);
    expect(logOf(cmp)).not.toContain(RO_PASS);

    // --expect-empty jako ta rola na niepustej bazie: błąd, nie expect_empty=yes.
    const ee = compare(DB_B, ["--expect-empty"], RO_PASS, RO_ROLE);
    expect(ee.lines).toEqual(["error_class=other", "exit=1"]);
    expect(ee.status).toBe(1);
    expect(logOf(ee)).toMatch(/ERROR: +42501/);
  });
});
