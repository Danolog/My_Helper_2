// @vitest-environment node
/**
 * Strażnik startu „sekret produkcyjny ≠ wartość testowa z repo”
 * (infra/runtime/secret-guard.mjs + src/instrumentation.ts; K-1, #144 W1).
 *
 * Wartości w tym pliku są losowane w czasie testu albo brane z literałów
 * już obecnych w repozytorium (przez extractSecretLiterals) — test nie
 * dodaje nowych wartości. Nie wypisuje wartości w komunikatach błędów.
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  REPO_ROOT,
  extractSecretLiterals,
  scannedFiles,
  secretClassNames,
} from "./secret-literals";
import {
  FORBIDDEN_SHA256,
  GUARDED_SECRET_ENV,
  SECRET_GUARD_MESSAGE,
  STRIPE_PAIR,
  STRIPE_PAIR_MESSAGE,
  enforceSecretGuard,
  forbiddenSecretHits,
  secretGuardActive,
  sha256Hex,
  stripePairMissing,
} from "../../infra/runtime/secret-guard.mjs";

const GUARD_URL = pathToFileURL(join(REPO_ROOT, "infra/runtime/secret-guard.mjs")).href;
const literals = extractSecretLiterals();

/** Wartość testowa jawna w repo: BETTER_AUTH_SECRET z quality-gate.yml. */
function ciAuthSecret(): string {
  const hit = literals.find(
    (l) => l.file === ".github/workflows/quality-gate.yml" && l.name === "BETTER_AUTH_SECRET",
  );
  if (!hit) throw new Error("brak literału BETTER_AUTH_SECRET w quality-gate.yml");
  return hit.value;
}

const fresh = () => `prod-${randomBytes(24).toString("hex")}`;

function startProcess(extra: Record<string, string>) {
  const script =
    `const { enforceSecretGuard } = await import(${JSON.stringify(GUARD_URL)});` +
    `enforceSecretGuard(); console.log("STARTED");`;
  return spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf8",
    env: { PATH: process.env.PATH, NODE_ENV: "production", ...extra },
    timeout: 20_000,
  });
}

describe("lista zakazana i jej kompletność", () => {
  it("GUARDED_SECRET_ENV = zmienne klasy secret z env-manifest.json", () => {
    expect([...GUARDED_SECRET_ENV].sort()).toEqual(secretClassNames());
  });

  it("lista trzyma wyłącznie skróty SHA-256 (64 znaki hex), nigdy wartości", () => {
    expect(FORBIDDEN_SHA256.size).toBeGreaterThan(0);
    for (const h of FORBIDDEN_SHA256) expect(h).toMatch(/^[0-9a-f]{64}$/);
    const raw = new Set(literals.map((l) => l.value));
    for (const h of FORBIDDEN_SHA256) expect(raw.has(h)).toBe(false);
  });

  it("wyszukiwarka widzi znane źródła: workflow, docker-compose, skrypt infra, testy", () => {
    const files = new Set(literals.map((l) => l.file));
    expect(files).toContain(".github/workflows/quality-gate.yml");
    expect(files).toContain("docker-compose.app.yml");
    expect(files).toContain("infra/gcp/smoke-container.sh");
    expect(literals.some((l) => l.file.startsWith("__tests__/"))).toBe(true);
    expect(scannedFiles().some((f) => f.startsWith(".env") && !f.endsWith(".example"))).toBe(false);
  });

  it("wyszukiwarka rozpoznaje formy przypisania i pomija odwołania", () => {
    // Nazwy zastępcze: prawdziwe nazwy w tym pliku same stałyby się literałami.
    const FAKE = ["ZZ_A", "ZZ_B", "ZZ_C", "ZZ_D", "ZZ_E", "ZZ_F", "ZZ_G", "ZZ_H", "ZZ_I"];
    const files: Record<string, string> = {
      "a.yml": [
        "  ZZ_A: lit-yaml-a # komentarz",
        '  ZZ_B: "lit-yaml-b"',
        "  ZZ_C: ${{ secrets.X }}",
        "      - ZZ_D=lit-yaml-c",
      ].join("\n"),
      "b.sh": 'docker run -e ZZ_C="lit-sh-a" -e ZZ_B=$X -e ZZ_D=lit-sh-b -e ZZ_AX=nie',
      "c.test.ts": [
        'vi.stubEnv("ZZ_E", "lit-ts-a");',
        "process.env.ZZ_F = 'lit-ts-b';",
        'vi.stubEnv("ZZ_A", "ab".repeat(3));',
        'process.env["ZZ_G"] = `lit-ts-c`;',
        'const env = { ZZ_H: "lit-ts-d", ZZ_B: `x-${y}` };',
        'args.push("ZZ_I=lit-ts-e");',
        "const o = { ZZ_C: url };",
      ].join("\n"),
    };
    const got = extractSecretLiterals(Object.keys(files), FAKE, (f) => files[f]!)
      .map((l) => `${l.file} ${l.name} ${l.value}`)
      .sort();
    expect([...new Set(got)]).toEqual(
      [
        "a.yml ZZ_A lit-yaml-a",
        "a.yml ZZ_B lit-yaml-b",
        "a.yml ZZ_D lit-yaml-c",
        "b.sh ZZ_C lit-sh-a",
        "b.sh ZZ_D lit-sh-b",
        "c.test.ts ZZ_I lit-ts-e",
        "c.test.ts ZZ_A ababab",
        "c.test.ts ZZ_F lit-ts-b",
        "c.test.ts ZZ_E lit-ts-a",
        "c.test.ts ZZ_H lit-ts-d",
        "c.test.ts ZZ_G lit-ts-c",
      ].sort(),
    );
  });

  it("skrót każdego literału sekretu z repozytorium jest na liście zakazanej", () => {
    // Komunikat: plik, nazwa i skrót do dopisania — bez wartości.
    const missing = literals
      .filter((l) => !FORBIDDEN_SHA256.has(sha256Hex(l.value)))
      .map((l) => `${l.file} ${l.name} ${sha256Hex(l.value)}`);
    expect([...new Set(missing)]).toEqual([]);
  });
});

describe("kiedy strażnik działa", () => {
  it("tylko K_SERVICE + NODE_ENV=production", () => {
    expect(secretGuardActive({ K_SERVICE: "myhelper", NODE_ENV: "production" })).toBe(true);
    expect(secretGuardActive({ NODE_ENV: "production" })).toBe(false);
    expect(secretGuardActive({ NODE_ENV: "production", VERCEL: "1" })).toBe(false);
    expect(secretGuardActive({ NODE_ENV: "production", CI: "true" })).toBe(false);
    expect(secretGuardActive({ K_SERVICE: "", NODE_ENV: "production" })).toBe(false);
    expect(secretGuardActive({ K_SERVICE: "myhelper", NODE_ENV: "development" })).toBe(false);
    expect(secretGuardActive({ K_SERVICE: "myhelper", NODE_ENV: "test" })).toBe(false);
  });

  it("trafienie po wartości i po wartości z białymi znakami; tylko zmienne klasy secret", () => {
    const v = ciAuthSecret();
    expect(forbiddenSecretHits({ BETTER_AUTH_SECRET: v })).toEqual(["BETTER_AUTH_SECRET"]);
    expect(forbiddenSecretHits({ CRON_SECRET: `${v}\n` })).toEqual(["CRON_SECRET"]);
    expect(forbiddenSecretHits({ BETTER_AUTH_SECRET: fresh(), CRON_SECRET: "" })).toEqual([]);
    expect(forbiddenSecretHits({ NEXT_PUBLIC_APP_URL: v })).toEqual([]);
  });

  it("kilka trafień naraz → wszystkie nazwy, w kolejności listy", () => {
    const v = ciAuthSecret();
    expect(forbiddenSecretHits({ STRIPE_WEBHOOK_SECRET: v, BETTER_AUTH_SECRET: v, CRON_SECRET: fresh() })).toEqual([
      "BETTER_AUTH_SECRET",
      "STRIPE_WEBHOOK_SECRET",
    ]);
    const log = vi.fn();
    enforceSecretGuard({ K_SERVICE: "myhelper", NODE_ENV: "production", POSTGRES_URL: v, VAPID_PRIVATE_KEY: v }, vi.fn(), log);
    expect(log.mock.calls.map((c) => (c[1] as { variable: string }).variable)).toEqual(["POSTGRES_URL", "VAPID_PRIVATE_KEY"]);
  });

  it("każda zmienna z listy jest sprawdzana", () => {
    const v = ciAuthSecret();
    for (const name of GUARDED_SECRET_ENV) {
      expect(forbiddenSecretHits({ [name]: v })).toEqual([name]);
    }
  });

  it("enforceSecretGuard: trafienie → exit(1), log tylko z nazwą zmiennej", () => {
    const v = ciAuthSecret();
    const exit = vi.fn();
    const log = vi.fn();
    const ok = enforceSecretGuard(
      { K_SERVICE: "myhelper", NODE_ENV: "production", STRIPE_WEBHOOK_SECRET: v },
      exit,
      log,
    );
    expect(ok).toBe(false);
    expect(exit).toHaveBeenCalledWith(1);
    expect(log).toHaveBeenCalledWith(SECRET_GUARD_MESSAGE, { variable: "STRIPE_WEBHOOK_SECRET" });
    expect(JSON.stringify(log.mock.calls)).not.toContain(sha256Hex(v));
  });

  it("enforceSecretGuard poza Cloud Run nic nie robi nawet przy trafieniu", () => {
    const exit = vi.fn();
    const log = vi.fn();
    expect(enforceSecretGuard({ NODE_ENV: "production", BETTER_AUTH_SECRET: ciAuthSecret() }, exit, log)).toBe(true);
    expect(exit).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });
});

describe("para Stripe: oba albo żaden (K-1b)", () => {
  const CR = { K_SERVICE: "myhelper", NODE_ENV: "production" };

  it("stripePairMissing: dokładnie jedna ustawiona → nazwa brakującej; obie / żadna → []", () => {
    expect(stripePairMissing({ STRIPE_SECRET_KEY: fresh() })).toEqual(["STRIPE_WEBHOOK_SECRET"]);
    expect(stripePairMissing({ STRIPE_WEBHOOK_SECRET: fresh() })).toEqual(["STRIPE_SECRET_KEY"]);
    expect(stripePairMissing({ STRIPE_SECRET_KEY: fresh(), STRIPE_WEBHOOK_SECRET: fresh() })).toEqual([]);
    expect(stripePairMissing({})).toEqual([]);
    // Pusta albo same białe znaki = nieustawiona.
    // Klucz wyliczany: zapis { NAZWA: "…" } byłby dla G-K1 nowym literałem.
    const webhook = STRIPE_PAIR[1]!;
    expect(stripePairMissing({ STRIPE_SECRET_KEY: fresh(), [webhook]: "" })).toEqual(["STRIPE_WEBHOOK_SECRET"]);
    expect(stripePairMissing({ STRIPE_SECRET_KEY: fresh(), [webhook]: " \n" })).toEqual(["STRIPE_WEBHOOK_SECRET"]);
    expect([...STRIPE_PAIR].sort()).toEqual(["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"]);
  });

  it.each([
    ["tylko klucz API", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"],
    ["tylko sekret webhooka", "STRIPE_WEBHOOK_SECRET", "STRIPE_SECRET_KEY"],
  ])("enforceSecretGuard: %s → exit(1), log z nazwą brakującej zmiennej, bez wartości", (_l, present, missing) => {
    const value = fresh();
    const env: Record<string, string> = { ...CR, BETTER_AUTH_SECRET: fresh(), [present]: value };
    const exit = vi.fn();
    const log = vi.fn();
    expect(enforceSecretGuard(env, exit, log)).toBe(false);
    expect(exit).toHaveBeenCalledWith(1);
    expect(log).toHaveBeenCalledWith(STRIPE_PAIR_MESSAGE, { variable: missing });
    expect(STRIPE_PAIR_MESSAGE).toContain("STRIPE_SECRET_KEY");
    expect(STRIPE_PAIR_MESSAGE).toContain("STRIPE_WEBHOOK_SECRET");
    expect(JSON.stringify(log.mock.calls)).not.toContain(value);
  });

  it("enforceSecretGuard: obie albo żadna → start", () => {
    for (const env of [{ ...CR, STRIPE_SECRET_KEY: fresh(), STRIPE_WEBHOOK_SECRET: fresh() }, { ...CR }]) {
      const exit = vi.fn();
      const log = vi.fn();
      expect(enforceSecretGuard(env, exit, log)).toBe(true);
      expect(exit).not.toHaveBeenCalled();
      expect(log).not.toHaveBeenCalled();
    }
  });

  it("poza Cloud Run niepełna para nie blokuje (lokalnie, CI, Vercel)", () => {
    const exit = vi.fn();
    expect(enforceSecretGuard({ NODE_ENV: "production", STRIPE_SECRET_KEY: fresh() }, exit, vi.fn())).toBe(true);
    expect(exit).not.toHaveBeenCalled();
  });

  it("proces: tylko STRIPE_SECRET_KEY na Cloud Run → kod 1, log z nazwą STRIPE_WEBHOOK_SECRET, bez wartości", () => {
    const value = fresh();
    const r = startProcess({ K_SERVICE: "myhelper", BETTER_AUTH_SECRET: fresh(), STRIPE_SECRET_KEY: value });
    const out = r.stdout + r.stderr;
    expect(r.status).toBe(1);
    expect(out).not.toContain("STARTED");
    expect(out).toContain("STRIPE_WEBHOOK_SECRET");
    expect(out).not.toContain(value);
  });
});

describe("proces", () => {
  it("trafienie → kod wyjścia ≠ 0, aplikacja nie startuje; log bez wartości i bez skrótu", () => {
    const v = ciAuthSecret();
    const r = startProcess({ K_SERVICE: "myhelper", BETTER_AUTH_SECRET: v, POSTGRES_URL: fresh() });
    const out = r.stdout + r.stderr;
    expect(r.status).not.toBe(0);
    expect(r.status).toBe(1);
    expect(out).not.toContain("STARTED");
    expect(out).toContain("BETTER_AUTH_SECRET");
    expect(out).not.toContain("POSTGRES_URL");
    expect(out).not.toContain(v);
    expect(out).not.toContain(sha256Hex(v));
  });

  it("wartość spoza listy → start", () => {
    const r = startProcess({ K_SERVICE: "myhelper", BETTER_AUTH_SECRET: fresh(), CRON_SECRET: fresh() });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("STARTED");
  });

  it("lokalnie / CI / Vercel (bez K_SERVICE) start także z wartością testową", () => {
    const v = ciAuthSecret();
    for (const extra of [{}, { CI: "true" }, { VERCEL: "1" }]) {
      const r = startProcess({ ...extra, BETTER_AUTH_SECRET: v });
      expect(r.status).toBe(0);
      expect(r.stdout).toContain("STARTED");
    }
    const dev = startProcess({ K_SERVICE: "myhelper", NODE_ENV: "development", BETTER_AUTH_SECRET: v });
    expect(dev.status).toBe(0);
  });
});

describe("src/instrumentation.ts register()", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  async function runRegister(runtime: string, secret: string) {
    vi.stubEnv("NEXT_RUNTIME", runtime);
    vi.stubEnv("K_SERVICE", "myhelper");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("BETTER_AUTH_SECRET", secret);
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { register } = await import("../../src/instrumentation");
    await register();
    return { exit, out: JSON.stringify(err.mock.calls) };
  }

  it("runtime nodejs + trafienie → process.exit(1), log z nazwą zmiennej", async () => {
    const v = ciAuthSecret();
    const { exit, out } = await runRegister("nodejs", v);
    expect(exit).toHaveBeenCalledWith(1);
    expect(out).toContain("BETTER_AUTH_SECRET");
    expect(out).not.toContain(v);
    expect(out).not.toContain(sha256Hex(v));
  });

  it("runtime nodejs + wartość spoza listy → bez wyjścia", async () => {
    const { exit } = await runRegister("nodejs", fresh());
    expect(exit).not.toHaveBeenCalled();
  });

  it("runtime edge → strażnik pominięty", async () => {
    const { exit } = await runRegister("edge", ciAuthSecret());
    expect(exit).not.toHaveBeenCalled();
  });
});
