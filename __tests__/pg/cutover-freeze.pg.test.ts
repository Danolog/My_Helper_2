/**
 * `infra/db/cutover/freeze-neon.sh` i `unfreeze-neon.sh` na PRAWDZIWYM Postgresie
 * (krok `pnpm test:pg` joba CI `e2e-smoke`, ta sama bramka co test compare.sh).
 *
 * (f2) połączenie otwarte rolą logowania (nie myhelper_app, zwykła rola LOGIN)
 *      PRZED freeze → freeze zrywa je (`terminated ≥ 1`, proces klienta kończy
 *      się „administrator command”), a zapis na NOWYM połączeniu tą rolą kończy
 *      się 25006 (read_only). Połączenie superużytkownika w tej bazie zostaje
 *      (`skipped_superuser ≥ 1`).
 *      unfreeze → połączenie z czasu zamrożenia zerwane, zapis na nowym
 *      połączeniu przechodzi (w ROLLBACK).
 *      `ALTER ROLE … SET default_transaction_read_only` (globalnie i IN DATABASE)
 *      → role_override=1, kod 7, baza bez zmian.
 * Realne zachowanie uprawnień: rola właściciela bazy bez pg_signal_backend nie
 * może zerwać połączenia innej roli — pg_terminate_backend rzuca 42501, a skrypt
 * kończy się error_class=other, kod 1 (nie cichym terminated=0).
 *
 * Skrypty działają jako rola właściciela bazy testu (nie superużytkownik), jak
 * rola właściciela u dostawcy. Bazę (`it_cutover_<los>_f`) i role
 * (`it_cutover_<los>_owner`, `…_login`) tworzy i usuwa sam test przez pulę
 * zweryfikowaną w `pg-harness.ts`. pos_dev nie jest dotykana.
 * psql w wersji ≥ serwera: z `CUTOVER_PG_CONTAINER` nakładka `docker exec -i <id>
 * psql` (bez apt, bez nowych obrazów), jak w teście compare.sh.
 *
 * Bramka: `CUTOVER_COMPARE_PG=1`. Strażnik: `__tests__/lib/cutover-freeze-config.test.ts`.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createIntegrationDb, INTEGRATION_URL } from "./pg-harness";

const ENABLED = process.env.CUTOVER_COMPARE_PG === "1";
const ROOT = process.cwd();
const FREEZE = join(ROOT, "infra/db/cutover/freeze-neon.sh");
const UNFREEZE = join(ROOT, "infra/db/cutover/unfreeze-neon.sh");
const TAG = `it_cutover_${randomBytes(4).toString("hex")}`;
const DB_F = `${TAG}_f`;
/** Właściciel bazy testu: NOSUPERUSER, jak rola właściciela u dostawcy. */
const OWNER = `${TAG}_owner`;
const OWNER_PASS = randomBytes(16).toString("hex");
/** Rola logowania aplikacji (zwykła rola LOGIN, nie myhelper_app). */
const LOGIN = `${TAG}_login`;
const LOGIN_PASS = randomBytes(16).toString("hex");
const SLEEP_SQL = "select pg_sleep(300)";

type Harness = NonNullable<Awaited<ReturnType<typeof createIntegrationDb>>>;
const base = INTEGRATION_URL ? new URL(INTEGRATION_URL) : null;

let toolPath = process.env.PATH ?? "";
let toolDir: string | null = null;

/** Nakładka psql na kontener usługi bazy (CI), jak w cutover-compare.pg.test.ts. */
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
  for (const tool of ["psql"]) {
    const f = join(dir, tool);
    writeFileSync(f, `#!/bin/sh\nexec docker exec -i -e PGHOST=${ip} -e PGPORT=5432 ${pass} ${cid} ${tool} "$@"\n`);
    chmodSync(f, 0o755);
  }
  return dir;
}

function host(): string {
  return base!.hostname === "localhost" ? "127.0.0.1" : base!.hostname;
}

/** Zmienne libpq jednej roli do bazy testu (hasło tylko w środowisku procesu). */
function pgEnv(user: string, password: string): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    PATH: toolPath,
    HOME: process.env.HOME ?? "",
    PGHOST: host(),
    PGPORT: base!.port || "5432",
    PGUSER: user,
    PGPASSWORD: password,
    PGDATABASE: DB_F,
    PGPASSFILE: "/dev/null",
  };
}

const superUser = () => decodeURIComponent(base!.username);
const superPass = () => decodeURIComponent(base!.password);

interface ScriptRun {
  status: number | null;
  lines: string[];
  map: Map<string, string>;
  stderr: string;
  log: string;
}

const homes: string[] = [];
function runScript(script: string, adminPass = OWNER_PASS): ScriptRun {
  const home = mkdtempSync(join(tmpdir(), "it-cutover-home-"));
  homes.push(home);
  const r = spawnSync("bash", [script], {
    encoding: "utf8",
    env: {
      ...pgEnv(OWNER, adminPass),
      HOME: home,
      VERIFY_PGHOST: host(),
      VERIFY_PGPORT: base!.port || "5432",
      VERIFY_PGDATABASE: DB_F,
      VERIFY_PGUSER: LOGIN,
      VERIFY_PGPASSWORD: LOGIN_PASS,
    },
    timeout: 60_000,
  });
  const lines = r.stdout.split("\n").filter(Boolean);
  const map = new Map(lines.map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)] as const));
  const dir = join(home, "secure");
  const log = readdirSync(dir)
    .filter((f) => f.endsWith(".log"))
    .map((f) => readFileSync(join(dir, f), "utf8"))
    .join("\n");
  return { status: r.status, lines, map, stderr: r.stderr, log };
}

/** Nowe połączenie (osobny proces psql) z SQL ze stdin. */
function psqlAs(user: string, password: string, sql: string) {
  return spawnSync("psql", ["-X", "-q", "-A", "-t", "-w", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=sqlstate", "-f", "-"], {
    input: sql,
    encoding: "utf8",
    env: pgEnv(user, password),
    timeout: 30_000,
  });
}

const WRITE_PROBE = "BEGIN;\nCREATE TEMP TABLE it_probe (x int);\nROLLBACK;\n";

interface Holder {
  child: ChildProcess;
  pid: number;
  exited: Promise<{ code: number | null; stderr: string }>;
}
const holders: Holder[] = [];

/**
 * Otwarte połączenie z bazą testu: osobny proces psql z długim pg_sleep. Zwraca
 * pid backendu odczytany przez obserwatora (superużytkownik, pos_dev).
 */
async function hold(h: Harness, user: string, password: string): Promise<Holder> {
  const child = spawn("psql", ["-X", "-q", "-w", "-c", SLEEP_SQL], {
    env: pgEnv(user, password),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr!.on("data", (b: Buffer) => {
    stderr += b.toString();
  });
  child.stdout!.resume();
  const exited = new Promise<{ code: number | null; stderr: string }>((resolve) =>
    child.on("close", (code) => resolve({ code, stderr })),
  );
  const deadline = Date.now() + 20_000;
  for (;;) {
    const rows = await h.observer.unsafe(
      "select pid from pg_stat_activity where datname = $1 and usename = $2 and query = $3 and state = 'active'",
      [DB_F, user, SLEEP_SQL],
    );
    const known = new Set(holders.map((x) => x.pid));
    const fresh = rows.map((r) => Number(r.pid)).filter((p) => !known.has(p));
    if (fresh.length === 1) {
      const holder = { child, pid: fresh[0]!, exited };
      holders.push(holder);
      return holder;
    }
    if (Date.now() > deadline) throw new Error("połączenie testu nie pojawiło się w pg_stat_activity");
    await new Promise((r) => setTimeout(r, 200));
  }
}

async function alive(h: Harness, pid: number): Promise<boolean> {
  const [row] = await h.observer.unsafe("select count(*)::int as n from pg_stat_activity where pid = $1", [pid]);
  return row!.n === 1;
}

async function exitedWithin(x: Holder, ms: number) {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      x.exited,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("proces klienta nie zakończył się")), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Ustawienia na poziomie bazy testu (setrole = 0). */
async function dbSettings(h: Harness): Promise<string> {
  const rows = await h.observer.unsafe(
    "select array_to_string(s.setconfig, ',') as c from pg_db_role_setting s " +
      "join pg_database d on d.oid = s.setdatabase where d.datname = $1 and s.setrole = 0",
    [DB_F],
  );
  return rows.map((r) => String(r.c)).join(",");
}

describe.skipIf(!ENABLED || !INTEGRATION_URL)("freeze-neon.sh / unfreeze-neon.sh na prawdziwym Postgresie", () => {
  let h: Harness;
  let su: Holder;
  let victim: Holder;

  beforeAll(async () => {
    const harness = await createIntegrationDb();
    if (!harness) throw new Error("brak INTEGRATION_POSTGRES_URL");
    h = harness;
    toolDir = containerTools();
    if (toolDir) toolPath = `${toolDir}:${toolPath}`;
    const [srv] = await h.observer.unsafe("select current_setting('server_version_num')::int / 10000 as major");
    const v = spawnSync("psql", ["--version"], { encoding: "utf8", env: { NODE_ENV: "test", PATH: toolPath, HOME: process.env.HOME ?? "" } });
    expect(Number(/(\d+)/.exec(v.stdout ?? "")?.[1] ?? 0), "psql w wersji ≥ serwera").toBeGreaterThanOrEqual(Number(srv!.major));

    await h.observer.unsafe(
      `CREATE ROLE ${OWNER} LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD '${OWNER_PASS}'`,
    );
    await h.observer.unsafe(
      `CREATE ROLE ${LOGIN} LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD '${LOGIN_PASS}'`,
    );
    await h.observer.unsafe(`CREATE DATABASE ${DB_F} OWNER ${OWNER}`);
    const [attrs] = await h.observer.unsafe(
      "select bool_or(rolsuper) as su from pg_roles where rolname in ($1, $2)",
      [OWNER, LOGIN],
    );
    expect(attrs!.su).toBe(false);

    su = await hold(h, superUser(), superPass());
    victim = await hold(h, LOGIN, LOGIN_PASS);
  }, 120_000);

  afterAll(async () => {
    for (const x of holders) x.child.kill();
    if (h) {
      if (DB_F.startsWith("it_cutover_")) await h.observer.unsafe(`DROP DATABASE IF EXISTS ${DB_F} WITH (FORCE)`);
      // DROP ROLE usuwa też członkostwo w pg_signal_backend i ustawienia ALTER ROLE … SET.
      for (const role of [LOGIN, OWNER]) {
        if (role.startsWith("it_cutover_")) await h.observer.unsafe(`DROP ROLE IF EXISTS ${role}`);
      }
      await h.end();
    }
    for (const home of homes) rmSync(home, { recursive: true, force: true });
    if (toolDir) rmSync(toolDir, { recursive: true, force: true });
  }, 60_000);

  it("(f2) ALTER ROLE … SET default_transaction_read_only → role_override=1, kod 7, baza bez zmian", async () => {
    await h.observer.unsafe(`ALTER ROLE ${LOGIN} IN DATABASE ${DB_F} SET default_transaction_read_only = off`);
    const f = runScript(FREEZE);
    expect(f.lines).toEqual(["role_override=1", "exit=7"]);
    expect(f.status).toBe(7);
    await h.observer.unsafe(`ALTER ROLE ${LOGIN} IN DATABASE ${DB_F} RESET default_transaction_read_only`);

    await h.observer.unsafe(`ALTER ROLE ${LOGIN} SET default_transaction_read_only = on`);
    const u = runScript(UNFREEZE);
    expect(u.lines).toEqual(["role_override=1", "exit=7"]);
    expect(u.status).toBe(7);
    await h.observer.unsafe(`ALTER ROLE ${LOGIN} RESET default_transaction_read_only`);

    expect(await dbSettings(h)).not.toContain("default_transaction_read_only");
    expect(await alive(h, victim.pid)).toBe(true);
  });

  it("rola właściciela bez pg_signal_backend: zerwanie połączenia innej roli → 42501, error_class=other, kod 1", async () => {
    const f = runScript(FREEZE);
    expect(f.lines).toEqual(["role_override=0", "error_class=other", "exit=1"]);
    expect(f.status).toBe(1);
    expect(f.log).toMatch(/ERROR: +42501/);
    expect(await alive(h, victim.pid)).toBe(true);
    // ALTER DATABASE przeszło przed zerwaniem; stan wyjściowy dla kolejnego przypadku.
    expect(await dbSettings(h)).toContain("default_transaction_read_only=on");
    await h.observer.unsafe(`ALTER DATABASE ${DB_F} RESET default_transaction_read_only`);
  });

  it("(f2) połączenie rolą logowania sprzed freeze → terminated ≥ 1; zapis na nowym połączeniu → read_only", async () => {
    await h.observer.unsafe(`GRANT pg_signal_backend TO ${OWNER}`);
    // Zapis przed zamrożeniem przechodzi (sonda nie jest pusta).
    expect(psqlAs(LOGIN, LOGIN_PASS, WRITE_PROBE).status).toBe(0);

    const f = runScript(FREEZE);
    expect(f.status, f.lines.join(" ")).toBe(0);
    expect([...f.map.keys()]).toEqual([
      "role_override",
      "backends_before",
      "terminated",
      "login_roles",
      "skipped_superuser",
      "pooler",
      "frozen",
      "exit",
    ]);
    expect(f.map.get("role_override")).toBe("0");
    expect(Number(f.map.get("terminated"))).toBeGreaterThanOrEqual(1);
    expect(f.map.get("terminated")).toBe(f.map.get("backends_before"));
    expect(Number(f.map.get("login_roles"))).toBeGreaterThanOrEqual(1);
    expect(Number(f.map.get("skipped_superuser"))).toBeGreaterThanOrEqual(1);
    expect(f.map.get("pooler")).toBe("no");
    expect(f.map.get("frozen")).toBe("yes");
    expect(f.map.get("exit")).toBe("0");
    expect(f.stderr).toBe("");
    expect(f.log).not.toContain(OWNER_PASS);
    expect(f.log).not.toContain(LOGIN_PASS);

    const gone = await exitedWithin(victim, 15_000);
    expect(gone.code).not.toBe(0);
    expect(gone.stderr).toMatch(/administrator command/);
    expect(await alive(h, victim.pid)).toBe(false);
    expect(await alive(h, su.pid)).toBe(true);

    // Niezależnie od skryptu: nowe połączenie tą rolą widzi zamrożenie.
    const show = psqlAs(LOGIN, LOGIN_PASS, "SHOW default_transaction_read_only;\n");
    expect(show.stdout.trim()).toBe("on");
    const write = psqlAs(LOGIN, LOGIN_PASS, WRITE_PROBE);
    expect(write.status).not.toBe(0);
    expect(write.stderr).toMatch(/ERROR: +25006/);
  });

  it("unfreeze: połączenie z czasu zamrożenia zerwane, zapis na nowym połączeniu przechodzi", async () => {
    const frozenEra = await hold(h, LOGIN, LOGIN_PASS);
    const u = runScript(UNFREEZE);
    expect(u.status, u.lines.join(" ")).toBe(0);
    expect(u.lines[0]).toBe("role_override=0");
    expect(Number(u.map.get("terminated"))).toBeGreaterThanOrEqual(1);
    expect(u.map.get("terminated")).toBe(u.map.get("backends_before"));
    expect(Number(u.map.get("skipped_superuser"))).toBeGreaterThanOrEqual(1);
    expect(u.lines.slice(-3)).toEqual(["pooler=no", "unfrozen=yes", "exit=0"]);

    const gone = await exitedWithin(frozenEra, 15_000);
    expect(gone.code).not.toBe(0);
    expect(await alive(h, frozenEra.pid)).toBe(false);
    expect(await alive(h, su.pid)).toBe(true);

    expect(await dbSettings(h)).toContain("default_transaction_read_only=off");
    expect(psqlAs(LOGIN, LOGIN_PASS, "SHOW default_transaction_read_only;\n").stdout.trim()).toBe("off");
    expect(psqlAs(LOGIN, LOGIN_PASS, WRITE_PROBE).status).toBe(0);
  });

  it("błędne hasło roli właściciela → na fd 3 wyłącznie error_class=connection i exit=", () => {
    const wrong = `wrong-${randomBytes(8).toString("hex")}`;
    const r = runScript(FREEZE, wrong);
    expect(r.lines).toEqual(["error_class=connection", "exit=1"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toBe("");
    expect(r.log).toMatch(/password authentication failed/);
    expect(r.log).not.toContain(wrong);
  });
});
