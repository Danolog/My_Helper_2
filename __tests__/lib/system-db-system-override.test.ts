// @vitest-environment node
/**
 * #193 P0b: mock `system/db-system` w pliku testu nadpisuje globalny
 * bezpiecznik z __tests__/setup.ts (warunek Ethana 16.11).
 */
import { describe, expect, it, vi } from "vitest";

const limit = vi.fn(async () => [{ id: "salon-1" }]);
const select = vi.fn(() => ({ from: () => ({ where: () => ({ limit }) }) }));

vi.mock("@/lib/server/system/db-system", () => ({ dbSystem: { select } }));

describe("mock w pliku > bezpiecznik globalny", () => {
  it("dbSystem z pliku testu, nie z bezpiecznika", async () => {
    const { dbSystem } = await import("@/lib/server/system/db-system");
    expect((dbSystem as unknown as { select: unknown }).select).toBe(select);
  });

  it("moduł systemowy dostaje mock z pliku (isSalonOwner → true)", async () => {
    const { isSalonOwner } = await import("@/lib/server/system/session");
    await expect(isSalonOwner("user-1")).resolves.toBe(true);
    expect(select).toHaveBeenCalled();
  });
});
