// @vitest-environment node
/**
 * Przełącznik magazynu limitu prób logowania (`AUTH_RATE_LIMIT_STORE`).
 *
 * Tryb domyślny daje wyłącznie brak zmiennej. Poza tym dozwolone są dokładnie
 * `memory` i `database`. Każda inna wartość — także pusty napis, inna wielkość
 * liter albo spacja — to błąd z listą dozwolonych wartości, nigdy cichy powrót
 * do trybu domyślnego.
 */
import { describe, expect, it, vi } from "vitest";
import { enforceAuthRateLimitStore, getAuthRateLimitStore } from "@/lib/auth-rate-limit-mode";

const SECRET = "test-secret-for-auth-throttle-0123456789abcdef";

describe("getAuthRateLimitStore", () => {
  it("brak zmiennej → memory (tryb domyślny)", () => {
    expect(getAuthRateLimitStore({})).toBe("memory");
  });

  it("zmienna obecna z wartością undefined → memory", () => {
    expect(getAuthRateLimitStore({ AUTH_RATE_LIMIT_STORE: undefined })).toBe("memory");
  });

  it("pusty napis → błąd (nie tryb domyślny)", () => {
    expect(() => getAuthRateLimitStore({ AUTH_RATE_LIMIT_STORE: "" })).toThrow(/AUTH_RATE_LIMIT_STORE/);
  });

  it("memory → memory", () => {
    expect(getAuthRateLimitStore({ AUTH_RATE_LIMIT_STORE: "memory" })).toBe("memory");
  });

  it("database → database", () => {
    expect(getAuthRateLimitStore({ AUTH_RATE_LIMIT_STORE: "database" })).toBe("database");
  });

  it.each([["Database"], ["DATABASE"], [" database"], ["database "], ["memory "], ["Memory"], ["redis"], ["db"], ["true"], [" "]])(
    "wartość %j → błąd z listą dozwolonych wartości",
    (value) => {
      expect(() => getAuthRateLimitStore({ AUTH_RATE_LIMIT_STORE: value })).toThrow(/AUTH_RATE_LIMIT_STORE/);
      expect(() => getAuthRateLimitStore({ AUTH_RATE_LIMIT_STORE: value })).toThrow(/memory/);
      expect(() => getAuthRateLimitStore({ AUTH_RATE_LIMIT_STORE: value })).toThrow(/database/);
    },
  );

  it("błąd nie zawiera podanej wartości (zmienne środowiska bywają wrażliwe)", () => {
    let message = "";
    try {
      getAuthRateLimitStore({ AUTH_RATE_LIMIT_STORE: "s3cr3t-value" });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).not.toBe("");
    expect(message).not.toContain("s3cr3t-value");
  });

  it("czysta funkcja: nie czyta process.env", () => {
    const prev = process.env.AUTH_RATE_LIMIT_STORE;
    process.env.AUTH_RATE_LIMIT_STORE = "database";
    try {
      expect(getAuthRateLimitStore({})).toBe("memory");
    } finally {
      if (prev === undefined) delete process.env.AUTH_RATE_LIMIT_STORE;
      else process.env.AUTH_RATE_LIMIT_STORE = prev;
    }
  });
});

describe("enforceAuthRateLimitStore", () => {
  function run(env: Record<string, string | undefined>) {
    const exit = vi.fn();
    const logError = vi.fn();
    const allowed = enforceAuthRateLimitStore(env, exit, logError);
    return { allowed, exit, logError, out: JSON.stringify(logError.mock.calls) };
  }

  it.each([
    ["brak zmiennej", {}],
    ["memory", { AUTH_RATE_LIMIT_STORE: "memory" }],
    ["memory z pustym sekretem", { AUTH_RATE_LIMIT_STORE: "memory", BETTER_AUTH_SECRET: "" }],
    ["database z sekretem", { AUTH_RATE_LIMIT_STORE: "database", BETTER_AUTH_SECRET: SECRET }],
  ])("%s → start dozwolony, bez wyjścia i bez logu", (_name, env) => {
    const { allowed, exit, logError } = run(env);
    expect(allowed).toBe(true);
    expect(exit).not.toHaveBeenCalled();
    expect(logError).not.toHaveBeenCalled();
  });

  it.each([[""], ["Database"], ["MEMORY"], [" database"], ["database "], [" "], ["redis"]])(
    "wartość %j → exit(1) raz, log z nazwą zmiennej bez wartości",
    (value) => {
      const { allowed, exit, logError, out } = run({ AUTH_RATE_LIMIT_STORE: value, BETTER_AUTH_SECRET: SECRET });
      expect(allowed).toBe(false);
      expect(exit).toHaveBeenCalledTimes(1);
      expect(exit).toHaveBeenCalledWith(1);
      expect(logError).toHaveBeenCalledTimes(1);
      expect(logError.mock.calls[0]![0]).toMatch(/AUTH_RATE_LIMIT_STORE/);
      expect(logError.mock.calls[0]![1]).toEqual({ variable: "AUTH_RATE_LIMIT_STORE" });
      expect(out).not.toContain(SECRET);
    },
  );

  it("log nie zawiera podanej wartości", () => {
    const { exit, out } = run({ AUTH_RATE_LIMIT_STORE: "s3cr3t-value" });
    expect(exit).toHaveBeenCalledWith(1);
    expect(out).toContain("AUTH_RATE_LIMIT_STORE");
    expect(out).not.toContain("s3cr3t-value");
  });

  it.each([
    ["bez sekretu", {}],
    ["z pustym sekretem", { BETTER_AUTH_SECRET: "" }],
  ])("database %s → exit(1) raz, log z nazwą zmiennej sekretu", (_name, extra) => {
    const { allowed, exit, logError } = run({ AUTH_RATE_LIMIT_STORE: "database", ...extra });
    expect(allowed).toBe(false);
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
    expect(logError).toHaveBeenCalledTimes(1);
    expect(logError.mock.calls[0]![1]).toEqual({ variable: "BETTER_AUTH_SECRET" });
  });

  it("czysta funkcja: nie czyta process.env", () => {
    const prev = process.env.AUTH_RATE_LIMIT_STORE;
    process.env.AUTH_RATE_LIMIT_STORE = "zla-wartosc";
    try {
      expect(run({}).exit).not.toHaveBeenCalled();
    } finally {
      if (prev === undefined) delete process.env.AUTH_RATE_LIMIT_STORE;
      else process.env.AUTH_RATE_LIMIT_STORE = prev;
    }
  });
});
