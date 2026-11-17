// @vitest-environment node
/**
 * `register()` (src/instrumentation.ts) sprawdza konfigurację limitu prób
 * logowania przy starcie serwera: niedozwolona wartość AUTH_RATE_LIMIT_STORE
 * albo tryb `database` bez BETTER_AUTH_SECRET kończy proces kodem 1, zanim
 * serwer obsłuży pierwsze żądanie. Strażnik sekretów jest tu nieaktywny
 * (bez K_SERVICE), więc wyjście pochodzi wyłącznie z tego sprawdzenia.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const SECRET = "test-secret-for-auth-throttle-0123456789abcdef";

describe("src/instrumentation.ts register() — limit prób logowania", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  async function runRegister(runtime: string, env: Record<string, string | undefined>) {
    vi.stubEnv("NEXT_RUNTIME", runtime);
    vi.stubEnv("K_SERVICE", undefined);
    vi.stubEnv("NODE_ENV", "test");
    for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { register } = await import("../../src/instrumentation");
    await register();
    return { exit, out: JSON.stringify(err.mock.calls) };
  }

  it("runtime nodejs + niedozwolona wartość → process.exit(1), log z nazwą zmiennej bez wartości", async () => {
    const { exit, out } = await runRegister("nodejs", {
      AUTH_RATE_LIMIT_STORE: "s3cr3t-value",
      BETTER_AUTH_SECRET: SECRET,
    });
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
    expect(out).toContain("AUTH_RATE_LIMIT_STORE");
    expect(out).not.toContain("s3cr3t-value");
    expect(out).not.toContain(SECRET);
  });

  it("runtime nodejs + database bez sekretu → process.exit(1)", async () => {
    const { exit, out } = await runRegister("nodejs", {
      AUTH_RATE_LIMIT_STORE: "database",
      BETTER_AUTH_SECRET: undefined,
    });
    expect(exit).toHaveBeenCalledWith(1);
    expect(out).toContain("BETTER_AUTH_SECRET");
  });

  it.each([
    ["brak zmiennej", { AUTH_RATE_LIMIT_STORE: undefined }],
    ["memory", { AUTH_RATE_LIMIT_STORE: "memory" }],
    ["database z sekretem", { AUTH_RATE_LIMIT_STORE: "database", BETTER_AUTH_SECRET: SECRET }],
  ])("runtime nodejs + poprawna konfiguracja (%s) → bez wyjścia", async (_name, env) => {
    const { exit } = await runRegister("nodejs", env);
    expect(exit).not.toHaveBeenCalled();
  });

  it("runtime edge + niedozwolona wartość → sprawdzenie pominięte", async () => {
    const { exit } = await runRegister("edge", { AUTH_RATE_LIMIT_STORE: "redis" });
    expect(exit).not.toHaveBeenCalled();
  });
});
