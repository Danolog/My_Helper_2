// @vitest-environment node
/**
 * Strażnik skryptu `infra/gcp/smoke-container.sh` (K-1b, W1) — wykonany
 * z fałszywym `docker` i `curl` (stan kontenerów w plikach). Prawdziwy obraz
 * sprawdza ten sam skrypt w workflow (i lokalnie przez slot testowy).
 *  - W1: kontener w trybie Cloud Run z jawną wartością testową
 *    BETTER_AUTH_SECRET musi się zakończyć kodem 1, log z nazwą zmiennej,
 *    bez wartości i bez skrótu — sprawdzane PRZED pierwszym /api/health;
 *  - tryb limitu: kontener w trybie platformy z losowym sekretem
 *    i niedozwoloną wartością AUTH_RATE_LIMIT_STORE musi się zakończyć kodem 1,
 *    log z nazwą zmiennej, bez wartości — także PRZED pierwszym /api/health;
 *  - kontrola W1: losowa wartość + jednorazowa baza w sieci --internal; przed
 *    migracją /api/health = 503 „Service not ready” (strażnik schematu), potem
 *    obraz migratora (MIGRATOR_IMAGE) z kodem 0, potem kontener kontrolny → 200;
 *  - bez bazy i bez K_SERVICE → 503 (dotychczasowy przypadek), a potem
 *    /_next/image → 200 i content-type image/* (sharp w obrazie standalone).
 * Mutacje: wynik w opisie PR.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { getAuthRateLimitStore } from "@/lib/auth-rate-limit-mode";
import { FORBIDDEN_SHA256, SECRET_GUARD_MESSAGE, sha256Hex } from "../../infra/runtime/secret-guard.mjs";

const ROOT = process.cwd();
const SCRIPT = join(ROOT, "infra/gcp/smoke-container.sh");
const SOURCE = readFileSync(SCRIPT, "utf8");
// Nazwy zmiennych w stałych: zapis NAZWA=… w tym pliku byłby dla G-K1 nowym literałem.
const AUTH = "BETTER_AUTH_SECRET";
const PG_URL = "POSTGRES_URL";
const envOf = (env: string[], name: string) => env.find((e) => e.startsWith(`${name}=`))!.slice(name.length + 1);
const W1_VALUE = SOURCE.match(new RegExp(`^w1_env=\\("${AUTH}=([^"\\s]+)"\\)$`, "m"))?.[1] ?? "";
const STORE = "AUTH_RATE_LIMIT_STORE";
const STORE_VALUE = SOURCE.match(/^store_value="([^"\s]+)"$/m)?.[1] ?? "";
const MIGRATOR = "img:migrator";

const DIR = mkdtempSync(join(tmpdir(), "smoke-container-"));
afterAll(() => rmSync(DIR, { recursive: true, force: true }));
const BIN = join(DIR, "bin");
mkdirSync(BIN);

// Fałszywy docker. Kontener = pliki $FAKE_STATE/<nazwa>.{env,status,code,log,role}.
// Rola: obraz pgvector → db; obraz migratora → migrator; K_SERVICE + BETTER_AUTH_SECRET
// = wartość W1 → guard; K_SERVICE + AUTH_RATE_LIMIT_STORE → store; K_SERVICE i nazwa
// mh-smoke-pre-* → pre (kontrola negatywna przed migracją); K_SERVICE → ctl; inaczej plain.
// FAKE_GUARD i FAKE_STORE sterują zachowaniem kontenerów guard i store.
writeFileSync(
  join(BIN, "docker"),
  String.raw`#!/bin/sh
S="$FAKE_STATE"
echo "$*" >> "$FAKE_LOG"
cmd="$1"; shift
case "$cmd" in
  run)
    name=""; img=""; envf="$S/tmp.env"; : > "$envf"
    while [ $# -gt 0 ]; do
      case "$1" in
        -d) ;;
        --name) name="$2"; shift ;;
        --network|-p) shift ;;
        -e) printf '%s\n' "$2" >> "$envf"; shift ;;
        *) img="$1" ;;
      esac
      shift
    done
    mv "$envf" "$S/$name.env"
    echo "$img" > "$S/$name.image"
    secret=$(grep '^BETTER_AUTH_SECRET' "$S/$name.env" | cut -d= -f2-)
    store=$(grep '^AUTH_RATE_LIMIT_STORE=' "$S/$name.env" | cut -d= -f2-)
    if [ "$img" = "pgvector/pgvector:pg18" ]; then role=db
    elif [ "$img" = "$FAKE_MIGRATOR_IMAGE" ]; then role=migrator
    elif grep -q '^K_SERVICE=' "$S/$name.env" && [ "$secret" = "$FAKE_W1_VALUE" ]; then role=guard
    elif grep -q '^K_SERVICE=' "$S/$name.env" && grep -q '^AUTH_RATE_LIMIT_STORE=' "$S/$name.env"; then role=store
    elif grep -q '^K_SERVICE=' "$S/$name.env"; then
      case "$name" in mh-smoke-pre-*) role=pre ;; *) role=ctl ;; esac
    else role=plain; fi
    echo "$role" > "$S/$name.role"
    echo running > "$S/$name.status"; echo 0 > "$S/$name.code"; : > "$S/$name.log"
    if [ "$role" = guard ]; then
      msg="secret-guard: odmowa startu — sekret ma wartość testową jawną w repozytorium"
      case "$FAKE_GUARD" in
        run) echo "server listening" > "$S/$name.log" ;;
        exit0) echo exited > "$S/$name.status"; echo "$msg (BETTER_AUTH_SECRET)" > "$S/$name.log" ;;
        leak) echo exited > "$S/$name.status"; echo 1 > "$S/$name.code"; echo "$msg (BETTER_AUTH_SECRET) $secret" > "$S/$name.log" ;;
        hash) echo exited > "$S/$name.status"; echo 1 > "$S/$name.code"; echo "$msg (BETTER_AUTH_SECRET) $FAKE_W1_SHA" > "$S/$name.log" ;;
        noname) echo exited > "$S/$name.status"; echo 1 > "$S/$name.code"; echo "$msg" > "$S/$name.log" ;;
        nomsg) echo exited > "$S/$name.status"; echo 1 > "$S/$name.code"; echo "fatal: BETTER_AUTH_SECRET" > "$S/$name.log" ;;
        *) echo exited > "$S/$name.status"; echo 1 > "$S/$name.code"; echo "$msg (BETTER_AUTH_SECRET)" > "$S/$name.log" ;;
      esac
    fi
    if [ "$role" = store ]; then
      smsg='{"level":"error","msg":"AUTH_RATE_LIMIT_STORE: niedozwolona wartość; dozwolone: memory, database albo brak zmiennej","variable":"AUTH_RATE_LIMIT_STORE"}'
      case "$FAKE_STORE" in
        run) echo "server listening" > "$S/$name.log" ;;
        exit0) echo exited > "$S/$name.status"; echo "$smsg" > "$S/$name.log" ;;
        noname) echo exited > "$S/$name.status"; echo 1 > "$S/$name.code"; echo "fatal: startup failed" > "$S/$name.log" ;;
        leak) echo exited > "$S/$name.status"; echo 1 > "$S/$name.code"; echo "$smsg $store" > "$S/$name.log" ;;
        secret) echo exited > "$S/$name.status"; echo 1 > "$S/$name.code"; echo "$smsg $secret" > "$S/$name.log" ;;
        *) echo exited > "$S/$name.status"; echo 1 > "$S/$name.code"; echo "$smsg" > "$S/$name.log" ;;
      esac
    fi
    if [ "$role" = ctl ] && [ -n "$FAKE_CTL_CRASH" ]; then echo exited > "$S/$name.status"; echo 1 > "$S/$name.code"; fi
    if [ "$role" = pre ] && [ -n "$FAKE_PRE_CRASH" ]; then echo exited > "$S/$name.status"; echo 1 > "$S/$name.code"; fi
    if [ "$role" = migrator ]; then
      # Migrator: pierwszy plan (bez -d), kod wyjścia = kod docker run.
      code="$FAKE_MIGRATE_EXIT"; [ -n "$code" ] || code=0
      echo exited > "$S/$name.status"; echo "$code" > "$S/$name.code"
      if [ "$code" = 0 ]; then echo "[migrate] done" > "$S/$name.log"; : > "$S/migrated"
      else echo "[migrate] failed: fake migration error" > "$S/$name.log"; fi
      cat "$S/$name.log"
      exit "$code"
    fi
    echo "fakeid-$name" ;;
  inspect)
    fmt="$2"; name="$3"
    [ -f "$S/$name.status" ] || exit 1
    case "$fmt" in
      *Status*) cat "$S/$name.status" ;;
      *ExitCode*) cat "$S/$name.code" ;;
      *Running*) [ "$(cat "$S/$name.status")" = running ] && echo true || echo false ;;
    esac ;;
  logs) cat "$S/$1.log" ;;
  exec)
    name="$1"; shift
    case "$1" in
      pg_isready) [ -z "$FAKE_DB_DOWN" ] ;;
      node)
        # Stan bazy: plik $S/migrated po udanym migratorze. Bez niego strażnik
        # schematu daje 503 „Service not ready”, z nim 200. FAKE_PRE_HEALTH
        # i FAKE_CTL_HEALTH nadpisują odpowiedź kontenera pre / ctl.
        role=$(cat "$S/$name.role")
        echo "$role-probe" >> "$FAKE_LOG"
        if [ "$role" = pre ]; then
          if [ -n "$FAKE_PRE_HEALTH" ]; then echo "$FAKE_PRE_HEALTH"
          elif [ -f "$S/migrated" ]; then echo "200 "
          else echo "503 Service not ready"; fi
        elif [ -n "$FAKE_CTL_HEALTH" ]; then echo "$FAKE_CTL_HEALTH"
        elif [ -f "$S/migrated" ]; then echo 200
        else echo 503; fi ;;
      id) echo 1000 ;;
    esac ;;
  network|rm) ;;
esac
`,
);
// Fałszywy curl: sonda /_next/image dostaje FAKE_IMAGE („kod typ”, jak -w
// '%{http_code} %{content_type}'), każda inna — FAKE_PLAIN_HEALTH.
writeFileSync(
  join(BIN, "curl"),
  String.raw`#!/bin/sh
echo "curl $*" >> "$FAKE_LOG"
case "$*" in
  */_next/image*) printf "%s" "$FAKE_IMAGE" ;;
  *) printf "%s" "$FAKE_PLAIN_HEALTH" ;;
esac
`,
);
writeFileSync(join(BIN, "sleep"), "#!/bin/sh\nexit 0\n");
for (const f of ["docker", "curl", "sleep"]) chmodSync(join(BIN, f), 0o755);

let n = 0;
function smoke(extra: Record<string, string> = {}) {
  const state = join(DIR, `state-${n}`);
  const log = join(DIR, `log-${n++}`);
  mkdirSync(state);
  writeFileSync(log, "");
  const r = spawnSync("bash", [SCRIPT, "img:test"], {
    encoding: "utf8",
    env: {
      NODE_ENV: "test",
      PATH: `${BIN}:${process.env.PATH}`,
      FAKE_STATE: state,
      FAKE_LOG: log,
      FAKE_W1_VALUE: W1_VALUE,
      FAKE_W1_SHA: sha256Hex(W1_VALUE),
      MIGRATOR_IMAGE: MIGRATOR,
      FAKE_MIGRATOR_IMAGE: MIGRATOR,
      FAKE_PLAIN_HEALTH: "503",
      FAKE_IMAGE: "200 image/webp",
      SMOKE_WAIT: "3",
      ...extra,
    },
  });
  const calls = readFileSync(log, "utf8").split("\n").filter(Boolean);
  const containers = readdirSync(state)
    .filter((f) => f.endsWith(".role"))
    .map((f) => {
      const name = f.slice(0, -".role".length);
      return {
        name,
        role: readFileSync(join(state, f), "utf8").trim(),
        env: readFileSync(join(state, `${name}.env`), "utf8").split("\n").filter(Boolean),
      };
    });
  const byRole = (role: string) => containers.find((c) => c.role === role);
  return { ...r, calls, containers, byRole, state };
}

const firstHealth = (calls: string[]) => calls.findIndex((c) => c.startsWith("curl ") || /-probe$/.test(c));

describe("smoke-container.sh: W1 strażnik sekretów na obrazie (K-1b)", () => {
  it("K-1c: wymagany w logu prefiks = początek komunikatu strażnika (SECRET_GUARD_MESSAGE)", () => {
    const prefix = SOURCE.match(/\[\[ "\$guard_log" == \*"([^"]+)"\* \]\]/)?.[1];
    expect(prefix).toBe("secret-guard: odmowa startu");
    expect(SECRET_GUARD_MESSAGE.startsWith(prefix!)).toBe(true);
  });

  it("wartość W1 w skrypcie jest literałem BETTER_AUTH_SECRET ze skrótem na liście zakazanej", () => {
    expect(W1_VALUE).not.toBe("");
    expect(FORBIDDEN_SHA256.has(sha256Hex(W1_VALUE))).toBe(true);
  });

  it("obraz poprawny → kod 0; W1 → kontrola 200 → bez bazy 503, w tej kolejności; W1 przed pierwszym /api/health", () => {
    const r = smoke();
    expect(r.status, r.stderr).toBe(0);
    const lines = r.stdout.split("\n").filter((l) => l.startsWith("ok:"));
    expect(lines[0]).toMatch(/^ok: W1: public test BETTER_AUTH_SECRET → exit 1/);
    expect(lines[1]).toMatch(/^ok: rate-limit store: invalid AUTH_RATE_LIMIT_STORE → exit 1/);
    expect(lines[2]).toMatch(/^ok: schema guard: unmigrated database → \/api\/health 503 Service not ready/);
    expect(lines[3]).toMatch(/^ok: migrator: migrations applied/);
    expect(lines[4]).toMatch(/^ok: W1 control: .* 200 with migrated database/);
    expect(lines[5]).toMatch(/^ok: \/api\/health -> 503/);
    expect(lines[6]).toMatch(/^ok: next\/image -> 200 image\/webp/);
    const guardRun = r.calls.findIndex((c) => c.startsWith("run ") && c.includes("mh-smoke-guard-"));
    const guardExit = r.calls.findIndex((c) => c.startsWith("inspect -f {{.State.ExitCode}} mh-smoke-guard-"));
    const guardLogs = r.calls.findIndex((c) => c.startsWith("logs mh-smoke-guard-"));
    expect(guardRun).toBe(0);
    expect(guardExit).toBeGreaterThan(guardRun);
    expect(guardLogs).toBeGreaterThan(guardRun);
    expect(firstHealth(r.calls)).toBeGreaterThan(Math.max(guardExit, guardLogs));
    const storeRun = r.calls.findIndex((c) => c.startsWith("run ") && c.includes("mh-smoke-store-"));
    const storeExit = r.calls.findIndex((c) => c.startsWith("inspect -f {{.State.ExitCode}} mh-smoke-store-"));
    const storeLogs = r.calls.findIndex((c) => c.startsWith("logs mh-smoke-store-"));
    expect(storeRun).toBeGreaterThan(Math.max(guardExit, guardLogs));
    expect(storeExit).toBeGreaterThan(storeRun);
    expect(storeLogs).toBeGreaterThan(storeRun);
    expect(firstHealth(r.calls)).toBeGreaterThan(Math.max(storeExit, storeLogs));
    expect(r.calls.some((c) => c === "ctl-probe")).toBe(true);
    expect(r.calls.some((c) => c.startsWith("curl "))).toBe(true);
  });

  it("kontener trybu limitu: tryb platformy, losowy BETTER_AUTH_SECRET spoza listy, niedozwolona wartość trybu", () => {
    const r = smoke();
    const store = r.byRole("store")!;
    expect(store).toBeDefined();
    expect(store.env).toEqual(expect.arrayContaining(["K_SERVICE=myhelper", "NODE_ENV=production"]));
    const secret = envOf(store.env, AUTH);
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
    expect(FORBIDDEN_SHA256.has(sha256Hex(secret))).toBe(false);
    expect(envOf(smoke().byRole("store")!.env, AUTH)).not.toBe(secret);
    const value = envOf(store.env, STORE);
    expect(value).toBe(STORE_VALUE);
    expect(() => getAuthRateLimitStore({ [STORE]: value })).toThrow(new RegExp(STORE));
    // Bez bazy: adres wskazuje zamknięty port, kontener nie jest w sieci z bazą.
    expect(envOf(store.env, PG_URL)).toMatch(/@127\.0\.0\.1:1\//);
    const run = r.calls.find((c) => c.startsWith("run ") && c.includes(store.name))!;
    expect(run).not.toMatch(/--network/);
  });

  it.each([
    ["kontener nie kończy się", "run", /rate-limit store: .*still running/],
    ["kod wyjścia 0", "exit0", /rate-limit store: .*exit code \[0\], expected \[1\]/],
    ["log bez nazwy zmiennej", "noname", /rate-limit store: .*log lacks the variable name AUTH_RATE_LIMIT_STORE/],
    ["wartość trybu w logu", "leak", /rate-limit store: .*log contains the AUTH_RATE_LIMIT_STORE value/],
    ["wartość sekretu w logu", "secret", /rate-limit store: .*log contains the BETTER_AUTH_SECRET value/],
  ])("tryb limitu: %s → kod 1, bez żadnego /api/health", (_l, mode, msg) => {
    const r = smoke({ FAKE_STORE: mode });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(msg);
    expect(firstHealth(r.calls)).toBe(-1);
    expect(r.calls.some((c) => c.startsWith("network create"))).toBe(false);
    const secret = envOf(r.byRole("store")!.env, AUTH);
    expect(r.stdout + r.stderr).not.toContain(secret);
    expect(r.stdout + r.stderr).not.toContain(STORE_VALUE);
  });

  it("kontener W1: tryb Cloud Run (K_SERVICE, NODE_ENV=production) i wartość W1; POSTGRES_URL losowy", () => {
    const r = smoke();
    const guard = r.byRole("guard")!;
    expect(guard.env).toEqual(expect.arrayContaining(["K_SERVICE=myhelper", "NODE_ENV=production"]));
    expect(envOf(guard.env, AUTH)).toBe(W1_VALUE);
    const pg = envOf(guard.env, PG_URL);
    expect(FORBIDDEN_SHA256.has(sha256Hex(pg))).toBe(false);
    expect(envOf(smoke().byRole("guard")!.env, PG_URL)).not.toBe(pg);
  });

  it("kontrola: tryb Cloud Run, losowy BETTER_AUTH_SECRET spoza listy, baza w sieci --internal bez portu na hoście", () => {
    const r = smoke();
    const ctl = r.byRole("ctl")!;
    const db = r.byRole("db")!;
    expect(ctl.env).toEqual(expect.arrayContaining(["K_SERVICE=myhelper", "NODE_ENV=production"]));
    const secret = envOf(ctl.env, AUTH);
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
    expect(FORBIDDEN_SHA256.has(sha256Hex(secret))).toBe(false);
    const dbPw = db.env.find((e) => e.startsWith("POSTGRES_PASSWORD="))!.slice("POSTGRES_PASSWORD=".length);
    expect(dbPw).toMatch(/^[0-9a-f]{32}$/);
    expect(envOf(ctl.env, PG_URL)).toBe(`postgresql://smoke:${dbPw}@${db.name}:5432/smoke`);
    expect(r.calls.some((c) => /^network create --internal mh-smoke-net-/.test(c))).toBe(true);
    const pre = r.byRole("pre")!;
    const mig = r.byRole("migrator")!;
    expect(envOf(pre.env, PG_URL)).toBe(envOf(ctl.env, PG_URL));
    expect(envOf(mig.env, PG_URL)).toBe(envOf(ctl.env, PG_URL));
    const names = [db.name, ctl.name, pre.name, mig.name];
    const runs = r.calls.filter((c) => c.startsWith("run ") && names.some((nm) => c.includes(nm)));
    expect(runs).toHaveLength(4);
    for (const c of runs) {
      expect(c).toMatch(/--network mh-smoke-net-/);
      expect(c).not.toMatch(/ -p /);
    }
  });

  it.each([
    ["kontener nie kończy się (strażnik nie odmówił)", "run", /still running .* did not refuse/],
    ["kod wyjścia 0", "exit0", /exit code \[0\], expected \[1\]/],
    ["wartość w logu", "leak", /log contains the secret value/],
    ["skrót w logu", "hash", /log contains the secret hash/],
    ["log bez nazwy zmiennej", "noname", /log lacks the variable name BETTER_AUTH_SECRET/],
    // K-1c: kod 1 + nazwa zmiennej bez komunikatu strażnika (inny błąd startu) to nie dowód W1.
    ["log bez komunikatu strażnika", "nomsg", /log lacks the secret-guard refusal message/],
  ])("W1: %s → kod 1, bez żadnego /api/health; wartość nie trafia na wyjście", (_l, mode, msg) => {
    const r = smoke({ FAKE_GUARD: mode });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(msg);
    expect(firstHealth(r.calls)).toBe(-1);
    expect(r.calls.some((c) => c.startsWith("network create"))).toBe(false);
    expect(r.stdout + r.stderr).not.toContain(W1_VALUE);
    expect(r.stdout + r.stderr).not.toContain(sha256Hex(W1_VALUE));
  });

  it.each([
    ["/api/health 503 z bazą", { FAKE_CTL_HEALTH: "503" }, /W1 control: \/api\/health with database returned '503' \(expected 200\)/],
    ["kontener kontrolny pada", { FAKE_CTL_CRASH: "1" }, /W1 control: container with a random BETTER_AUTH_SECRET exited/],
    ["baza nie wstaje", { FAKE_DB_DOWN: "1" }, /W1 control: database not ready/],
  ])("kontrola W1: %s → kod 1, przypadek bez bazy nie startuje", (_l, extra, msg) => {
    const r = smoke(extra);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(msg);
    expect(r.calls.some((c) => c.startsWith("curl "))).toBe(false);
  });

  it("strażnik schematu: kontrola negatywna → migrator → kontener kontrolny, w tej kolejności; migrator to MIGRATOR_IMAGE na pierwszym planie", () => {
    const r = smoke();
    expect(r.status, r.stderr).toBe(0);
    const pre = r.byRole("pre")!;
    const mig = r.byRole("migrator")!;
    const ctl = r.byRole("ctl")!;
    const at = (pred: (c: string) => boolean) => r.calls.findIndex(pred);
    const preRun = at((c) => c.startsWith("run ") && c.includes(pre.name));
    const preProbe = at((c) => c === "pre-probe");
    const migRun = at((c) => c.startsWith("run ") && c.includes(mig.name));
    const ctlRun = at((c) => c.startsWith("run ") && c.includes(ctl.name));
    const ctlProbe = at((c) => c === "ctl-probe");
    expect(preRun).toBeGreaterThanOrEqual(0);
    expect(preProbe).toBeGreaterThan(preRun);
    expect(migRun).toBeGreaterThan(preProbe);
    expect(ctlRun).toBeGreaterThan(migRun);
    expect(ctlProbe).toBeGreaterThan(ctlRun);
    const migCall = r.calls[migRun]!;
    expect(migCall.endsWith(` ${MIGRATOR}`)).toBe(true);
    expect(migCall).not.toMatch(/(^| )-d( |$)/);
    // Migrator dostaje tylko adres bazy — bez trybu platformy i bez sekretu aplikacji.
    expect(mig.env.map((e) => e.split("=")[0])).toEqual([PG_URL]);
  });

  it.each([
    ["kod 1", "1"],
    ["kod 3", "3"],
  ])("migrator kończy się błędem (%s) → kod 1, kontener kontrolny nie startuje, przypadek bez bazy też nie", (_l, exit) => {
    const r = smoke({ FAKE_MIGRATE_EXIT: exit });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(`FAIL: migrator: exit code [${exit}] on the disposable database, expected [0]`);
    expect(r.stderr).toContain("[migrate] failed: fake migration error");
    expect(r.stdout).not.toMatch(/ok: migrator/);
    expect(r.byRole("ctl")).toBeUndefined();
    expect(r.calls.some((c) => c === "ctl-probe")).toBe(false);
    expect(r.calls.some((c) => c.startsWith("curl "))).toBe(false);
  });

  it.each([
    ["200 na pustej bazie (strażnik nie działa)", { FAKE_PRE_HEALTH: "200 " }, "200 "],
    ["503 od niedostępnej bazy, nie od strażnika", { FAKE_PRE_HEALTH: "503 Database unavailable" }, "503 Database unavailable"],
    ["serwer nie odpowiada", { FAKE_PRE_HEALTH: "0" }, "0"],
  ])("kontrola negatywna: %s → kod 1, migrator nie startuje", (_l, extra, out) => {
    const r = smoke(extra);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(
      `FAIL: schema guard: /api/health on an unmigrated database returned '${out}' (expected '503 Service not ready')`,
    );
    expect(r.byRole("migrator")).toBeUndefined();
    expect(r.byRole("ctl")).toBeUndefined();
  });

  it("kontrola negatywna: kontener pada przy starcie → kod 1, migrator nie startuje", () => {
    const r = smoke({ FAKE_PRE_CRASH: "1" });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/schema guard: container on an unmigrated database exited during startup/);
    expect(r.byRole("migrator")).toBeUndefined();
  });

  it("workflow wdrożenia przekazuje do kroku testu dymnego ten sam obraz migratora, który buduje", () => {
    const wf = readFileSync(join(ROOT, ".github/workflows/deploy-cloud-run.yml"), "utf8");
    const steps = wf.split(/\n(?=      - )/);
    const smokeStep = steps.find((s) => s.includes("infra/gcp/smoke-container.sh"))!;
    const buildStep = steps.find((s) => s.includes("--target migrator"))!;
    expect(smokeStep).toBeDefined();
    expect(buildStep).toContain('-t "$MIGRATOR_IMAGE"');
    expect(buildStep).toContain("MIGRATOR_IMAGE: ${{ steps.img.outputs.migrator }}");
    expect(smokeStep).toContain("MIGRATOR_IMAGE: ${{ steps.img.outputs.migrator }}");
  });

  it("bez MIGRATOR_IMAGE → kod 2 i instrukcja użycia, żaden kontener nie startuje", () => {
    const r = smoke({ MIGRATOR_IMAGE: "" });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/^usage: MIGRATOR_IMAGE=<migrator image> /);
    expect(r.calls.some((c) => c.startsWith("run "))).toBe(false);
  });

  it("bez bazy: /api/health 200 zamiast 503 → kod 1 (dotychczasowy przypadek)", () => {
    const r = smoke({ FAKE_PLAIN_HEALTH: "200" });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/without database returned '200' \(expected 503\)/);
    const plain = r.byRole("plain")!;
    expect(plain.env.some((e) => e.startsWith("K_SERVICE="))).toBe(false);
  });

  it("next/image: 200 + image/webp → kod 0; sonda z hosta po /api/health 503, plik z public/, Accept: image/webp", () => {
    const r = smoke();
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/^ok: next\/image -> 200 image\/webp/m);
    const health = r.calls.findIndex((c) => c.startsWith("curl ") && c.includes("/api/health"));
    const image = r.calls.findIndex((c) => c.startsWith("curl ") && c.includes("/_next/image"));
    expect(health).toBeGreaterThanOrEqual(0);
    expect(image).toBeGreaterThan(health);
    const probe = r.calls[image]!;
    expect(probe).toContain("http://127.0.0.1:18090/_next/image?url=%2Fhero-salon.jpg&w=640&q=75");
    expect(probe).toContain("Accept: image/webp");
    expect(existsSync(join(ROOT, "public/hero-salon.jpg"))).toBe(true);
  });

  it.each([
    ["500", "500 text/html; charset=utf-8", /next\/image: .*returned code '500', content-type 'text\/html; charset=utf-8'/],
    ["200, ale text/html", "200 text/html; charset=utf-8", /next\/image: .*returned code '200', content-type 'text\/html; charset=utf-8'/],
    ["200 bez content-type", "200 ", /next\/image: .*returned code '200', content-type ''/],
    ["200, ale oryginał jpg (bez sharp)", "200 image/jpeg", /next\/image: .*returned code '200', content-type 'image\/jpeg'/],
    ["brak połączenia", "000 ", /next\/image: .*returned code '000'/],
  ])("next/image: %s → kod 1 z komunikatem next/image", (_l, out, msg) => {
    const r = smoke({ FAKE_IMAGE: out });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/^FAIL: next\/image: /m);
    expect(r.stderr).toMatch(msg);
    expect(r.stdout).not.toMatch(/ok: next\/image/);
    // Sonda obrazu po przejściu /api/health, więc porażka dotyczy tylko sharp.
    expect(r.stdout).toMatch(/^ok: \/api\/health -> 503/m);
  });

  it("sprzątanie: każdy kontener i sieć usuwane przy wyjściu (także po porażce W1 i trybu limitu)", () => {
    for (const extra of [
      {},
      { FAKE_GUARD: "run" },
      { FAKE_STORE: "run" },
      { FAKE_PRE_HEALTH: "200 " },
      { FAKE_MIGRATE_EXIT: "1" },
      { FAKE_CTL_HEALTH: "503" },
      { FAKE_IMAGE: "500 text/html" },
    ]) {
      const r = smoke(extra);
      const rmCalls = r.calls.filter((c) => c.startsWith("rm -f ")).join(" ");
      for (const c of r.containers) expect(rmCalls, c.name).toContain(c.name);
      if (r.calls.some((c) => c.startsWith("network create"))) {
        expect(r.calls.some((c) => /^network rm mh-smoke-net-/.test(c))).toBe(true);
      }
      expect(existsSync(r.state)).toBe(true);
    }
  });
});
