// @vitest-environment node
/**
 * #193 P0b, bezpiecznik delegujący (a): plik mockuje `@/lib/db` fabryką i NIE
 * mockuje `system/db-system` → `dbSystem` to ten sam zmockowany obiekt co `db`
 * (jak prawdziwy re-eksport do P6), a wyjście systemowe idzie przez ten mock.
 */
import { describe, expect, it, vi } from "vitest";

const limit = vi.fn(async () => [{ id: "salon-1" }]);
const mockDb = { select: vi.fn(() => ({ from: () => ({ where: () => ({ limit }) }) })) };

vi.mock("@/lib/db", () => ({ db: mockDb }));

describe("bezpiecznik: zmockowane db → dbSystem = to samo db", () => {
  it("dbSystem toBe zmockowane db", async () => {
    const { db } = await import("@/lib/db");
    const { dbSystem } = await import("@/lib/server/system/db-system");
    expect(db).toBe(mockDb);
    expect(dbSystem).toBe(db);
  });

  it("wyjście systemowe (isSalonOwner) idzie przez zmockowane db", async () => {
    const { isSalonOwner } = await import("@/lib/server/system/session");
    await expect(isSalonOwner("user-1")).resolves.toBe(true);
    expect(mockDb.select).toHaveBeenCalled();
  });
});
