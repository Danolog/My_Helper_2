// @vitest-environment node
/**
 * #193 P0b, bezpiecznik delegujący (a) przy automocku: `vi.mock("@/lib/db")`
 * bez fabryki, bez mocka `system/db-system` → `dbSystem` to ten sam obiekt
 * co automockowane `db`, a połączenie nie jest otwierane.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db");

describe("bezpiecznik: automock db → dbSystem = to samo db", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("dbSystem toBe automockowane db (bez adresu bazy)", async () => {
    vi.stubEnv("POSTGRES_URL", "");
    const { db } = await import("@/lib/db");
    const { dbSystem } = await import("@/lib/server/system/db-system");
    expect(Object.is(dbSystem, db)).toBe(true);
  });
});
