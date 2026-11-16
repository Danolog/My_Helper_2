// @vitest-environment node
/**
 * #193 P0b: `dbSystem`.
 *
 * - Do P6 `dbSystem` to DOKŁADNIE ten sam klient co `db` (decyzja Ethana
 *   16.11): test tożsamości `toBe` na prawdziwych modułach (bez mocków),
 *   bez otwierania połączenia (leniwość z db.ts).
 * - Bezpiecznik w __tests__/setup.ts: test jednostkowy bez własnego mocka
 *   `system/db-system` dostaje głośny błąd zamiast zapytania do bazy.
 *   (Nadpisanie bezpiecznika mockiem w pliku: system-db-system-override.test.ts.)
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const SAFEGUARD = "niezamockowany dbSystem w teście jednostkowym";

describe("dbSystem do P6 = db (ten sam obiekt)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("prawdziwe moduły: dbSystem toBe db, a import obu nie otwiera połączenia", async () => {
    vi.stubEnv("POSTGRES_URL", "");
    vi.resetModules();
    const { db } = await vi.importActual<typeof import("@/lib/db")>("@/lib/db");
    const { dbSystem } = await vi.importActual<typeof import("@/lib/server/system/db-system")>(
      "@/lib/server/system/db-system"
    );
    expect(Object.is(dbSystem, db)).toBe(true);
    // Leniwość: pierwsze użycie bez adresu to jawny błąd z db.ts, czyli połączenia nie było.
    expect(() => (dbSystem as unknown as { select: () => unknown }).select()).toThrow(
      "POSTGRES_URL environment variable is not set"
    );
  });
});

describe("bezpiecznik: niezamockowany dbSystem", () => {
  it("import przez alias bez mocka w pliku → każde użycie rzuca błąd bezpiecznika", async () => {
    const { dbSystem } = await import("@/lib/server/system/db-system");
    expect(() => (dbSystem as unknown as { select: () => unknown }).select()).toThrow(SAFEGUARD);
    expect(() => (dbSystem as unknown as { transaction: unknown }).transaction).toThrow(SAFEGUARD);
  });

  it("moduł systemowy bez mocka puli → zapytanie kończy się błędem bezpiecznika, nie idzie do bazy", async () => {
    const { isSalonOwner } = await import("@/lib/server/system/session");
    await expect(isSalonOwner("user-1")).rejects.toThrow(SAFEGUARD);
  });
});
