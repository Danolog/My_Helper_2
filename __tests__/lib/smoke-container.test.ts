// @vitest-environment node
/**
 * Strażnik skryptu `infra/gcp/smoke-container.sh` (K-1b, W1) — wykonany
 * z fałszywym `docker` i `curl` (stan kontenerów w plikach). Prawdziwy obraz
 * sprawdza ten sam skrypt w workflow (i lokalnie przez slot testowy).
 *  - W1: kontener w trybie Cloud Run z jawną wartością testową
 *    BETTER_AUTH_SECRET musi się zakończyć kodem 1, log z nazwą zmiennej,
 *    bez wartości i bez skrótu — sprawdzane PRZED pierwszym /api/health;
 *  - kontrola W1: losowa wartość + jednorazowa baza w sieci --internal → 200;
 *  - bez bazy i bez K_SERVICE → 503 (dotychczasowy przypadek).
 * Mutacje (wynik w PR): scratchpad/eva/k1b-mut.py.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { FORBIDDEN_SHA256, SECRET_GUARD_MESSAGE, sha256Hex } from "../../infra/runtime/secret-guard.mjs";

const ROOT = process.cwd();
const SCRIPT = join(ROOT, "infra/gcp/smoke-container.sh");
const SOURCE = readFileSync(SCRIPT, "utf8");
// Nazwy zmiennych w stałych: zapis NAZWA=… w tym pliku byłby dla G-K1 nowym literałem.
const AUTH = "BETTER_AUTH_SECRET";
const PG_URL = "POSTGRES_URL";
const envOf = (env: string[], name: string) => env.find((e) => e.startsWith(`${name}=`))!.slice(name.length + 1);
const W1_VALUE = SOURCE.match(new RegExp(`^w1_env=\\("${AUTH}=([^"\\s]+)"\\)$`, "m"))?.[1] ?? "";

const DIR = mkdtempSync(join(tmpdir(), "smoke-container-"));
afterAll(() => rmSync(DIR, { recursive: true, force: true }));
const BIN = join(DIR, "bin");
mkdirSync(BIN);

// Fałszywy docker. Kontener = pliki $FAKE_STATE/<nazwa>.{env,status,code,log,role}.
// Rola: obraz pgvector → db; K_SERVICE + BETTER_AUTH_SECRET = wartość W1 → guard;
// K_SERVICE → ctl; inaczej plain. FAKE_GUARD steruje zachowaniem kontenera guard.
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
    if [ "$img" = "pgvector/pgvector:pg18" ]; then role=db
    elif grep -q '^K_SERVICE=' "$S/$name.env" && [ "$secret" = "$FAKE_W1_VALUE" ]; then role=guard
    elif grep -q '^K_SERVICE=' "$S/$name.env"; then role=ctl
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
    if [ "$role" = ctl ] && [ -n "$FAKE_CTL_CRASH" ]; then echo exited > "$S/$name.status"; echo 1 > "$S/$name.code"; fi
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
      node) echo "$(cat "$S/$name.role")-probe" >> "$FAKE_LOG"; echo "$FAKE_CTL_HEALTH" ;;
      id) echo 1000 ;;
    esac ;;
  network|rm) ;;
esac
`,
);
writeFileSync(join(BIN, "curl"), '#!/bin/sh\necho "curl $*" >> "$FAKE_LOG"\nprintf "%s" "$FAKE_PLAIN_HEALTH"\n');
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
      FAKE_CTL_HEALTH: "200",
      FAKE_PLAIN_HEALTH: "503",
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
    expect(lines[1]).toMatch(/^ok: W1 control: .* 200/);
    expect(lines[2]).toMatch(/^ok: \/api\/health -> 503/);
    const guardRun = r.calls.findIndex((c) => c.startsWith("run ") && c.includes("mh-smoke-guard-"));
    const guardExit = r.calls.findIndex((c) => c.startsWith("inspect -f {{.State.ExitCode}} mh-smoke-guard-"));
    const guardLogs = r.calls.findIndex((c) => c.startsWith("logs mh-smoke-guard-"));
    expect(guardRun).toBe(0);
    expect(guardExit).toBeGreaterThan(guardRun);
    expect(guardLogs).toBeGreaterThan(guardRun);
    expect(firstHealth(r.calls)).toBeGreaterThan(Math.max(guardExit, guardLogs));
    expect(r.calls.some((c) => c === "ctl-probe")).toBe(true);
    expect(r.calls.some((c) => c.startsWith("curl "))).toBe(true);
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
    const runs = r.calls.filter((c) => c.startsWith("run ") && (c.includes(db.name) || c.includes(ctl.name)));
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

  it("bez bazy: /api/health 200 zamiast 503 → kod 1 (dotychczasowy przypadek)", () => {
    const r = smoke({ FAKE_PLAIN_HEALTH: "200" });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/without database returned '200' \(expected 503\)/);
    const plain = r.byRole("plain")!;
    expect(plain.env.some((e) => e.startsWith("K_SERVICE="))).toBe(false);
  });

  it("sprzątanie: każdy kontener i sieć usuwane przy wyjściu (także po porażce W1)", () => {
    for (const extra of [{}, { FAKE_GUARD: "run" }, { FAKE_CTL_HEALTH: "503" }]) {
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
