// @vitest-environment node
/**
 * Przełącznik magazynu limitu prób logowania (`AUTH_RATE_LIMIT_STORE`).
 *
 * Tryb domyślny daje wyłącznie brak zmiennej. Poza tym dozwolone są dokładnie
 * `memory` i `database`. Każda inna wartość — także pusty napis, inna wielkość
 * liter albo spacja — to błąd z listą dozwolonych wartości, nigdy cichy powrót
 * do trybu domyślnego.
 */
import { describe, expect, it } from "vitest";
import { getAuthRateLimitStore } from "@/lib/auth-rate-limit-mode";

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
