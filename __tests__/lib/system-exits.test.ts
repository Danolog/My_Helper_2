// @vitest-environment node
/**
 * #193 P0b: zachowanie nowych wyjść systemowych na `dbSystem`:
 * - session.ts `isSalonOwner` (zapytanie z requireAdmin, warunek z audytu bezpieczeństwa z #206),
 * - cron.ts `cleanupExpiredTemporaryAccess` (warunek z audytu bezpieczeństwa z #206),
 * - health.ts `pingDatabase` (health) i `checkDatabase` (diagnostics).
 * Surowe `db` jest pułapką: każde użycie = czerwony test.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  limit: vi.fn(),
  returning: vi.fn(),
  execute: vi.fn(),
  where: [] as unknown[],
  selected: [] as unknown[],
  deletedFrom: [] as unknown[],
}));

vi.mock("@/lib/server/system/db-system", () => ({
  dbSystem: {
    select: (cols?: unknown) => {
      m.selected.push(cols);
      return {
        from: () => ({
          where: (w: unknown) => {
            m.where.push(w);
            return { limit: m.limit };
          },
          limit: m.limit,
        }),
      };
    },
    delete: (table: unknown) => {
      m.deletedFrom.push(table);
      return {
        where: (w: unknown) => {
          m.where.push(w);
          return { returning: m.returning };
        },
      };
    },
    execute: m.execute,
  },
}));

vi.mock("@/lib/db", () => ({
  db: new Proxy(
    {},
    {
      get(_t, p) {
        if (p === "then") return undefined;
        throw new Error(`wyjście systemowe użyło db (${String(p)}) zamiast dbSystem`);
      },
    }
  ),
}));

vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { temporaryAccess } from "@/lib/schema";

beforeEach(() => {
  m.limit.mockReset();
  m.returning.mockReset();
  m.execute.mockReset();
  m.where.length = 0;
  m.selected.length = 0;
  m.deletedFrom.length = 0;
});

describe("session.ts: isSalonOwner(userId)", () => {
  it("właściciel salonu → true", async () => {
    m.limit.mockResolvedValue([{ id: "salon-1" }]);
    const { isSalonOwner } = await import("@/lib/server/system/session");
    await expect(isSalonOwner("user-1")).resolves.toBe(true);
    expect(m.limit).toHaveBeenCalledWith(1);
    expect(m.where).toHaveLength(1);
  });

  it("bez salonu → false", async () => {
    m.limit.mockResolvedValue([]);
    const { isSalonOwner } = await import("@/lib/server/system/session");
    await expect(isSalonOwner("user-2")).resolves.toBe(false);
  });

  it("błąd bazy → propaguje (bez cichego false)", async () => {
    m.limit.mockRejectedValue(new Error("db down"));
    const { isSalonOwner } = await import("@/lib/server/system/session");
    await expect(isSalonOwner("user-3")).rejects.toThrow("db down");
  });
});

describe("cron.ts: cleanupExpiredTemporaryAccess()", () => {
  it("kasuje wygasłe granty przez dbSystem i zwraca ich liczbę", async () => {
    m.returning.mockResolvedValue([{ id: "g1" }, { id: "g2" }]);
    const { cleanupExpiredTemporaryAccess } = await import("@/lib/server/system/cron");
    await expect(cleanupExpiredTemporaryAccess()).resolves.toBe(2);
    expect(m.deletedFrom).toEqual([temporaryAccess]);
    expect(m.where).toHaveLength(1);
  });

  it("nic wygasłego → 0", async () => {
    m.returning.mockResolvedValue([]);
    const { cleanupExpiredTemporaryAccess } = await import("@/lib/server/system/cron");
    await expect(cleanupExpiredTemporaryAccess()).resolves.toBe(0);
  });

  it("lib/temporary-access re-eksportuje tę samą funkcję (ścieżka tras bez zmian)", async () => {
    const lib = await import("@/lib/temporary-access");
    const cron = await import("@/lib/server/system/cron");
    expect(lib.cleanupExpiredTemporaryAccess).toBe(cron.cleanupExpiredTemporaryAccess);
  });
});

describe("health.ts", () => {
  it("pingDatabase: SELECT 1 przez dbSystem", async () => {
    m.execute.mockResolvedValue([{ connected: 1 }]);
    const { pingDatabase } = await import("@/lib/server/system/health");
    await expect(pingDatabase()).resolves.toBeUndefined();
    expect(m.execute).toHaveBeenCalledTimes(1);
  });

  it("pingDatabase: błąd bazy → propaguje", async () => {
    m.execute.mockRejectedValue(new Error("Connection refused"));
    const { pingDatabase } = await import("@/lib/server/system/health");
    await expect(pingDatabase()).rejects.toThrow("Connection refused");
  });

  it("checkDatabase: ping i tabela user → connected i schemaApplied", async () => {
    m.execute.mockResolvedValue([{ ping: 1 }]);
    m.limit.mockResolvedValue([]);
    const { checkDatabase } = await import("@/lib/server/system/health");
    await expect(checkDatabase()).resolves.toEqual({ connected: true, schemaApplied: true });
    expect(m.limit).toHaveBeenCalledWith(1);
  });

  it("checkDatabase: brak tabeli user → connected, schemaApplied false", async () => {
    m.execute.mockResolvedValue([{ ping: 1 }]);
    m.limit.mockRejectedValue(new Error('relation "user" does not exist'));
    const { checkDatabase } = await import("@/lib/server/system/health");
    await expect(checkDatabase()).resolves.toEqual({ connected: true, schemaApplied: false });
  });

  it("checkDatabase: ping bez wyniku albo błąd → odrzuca (trasa mapuje na „not connected”)", async () => {
    const { checkDatabase } = await import("@/lib/server/system/health");
    m.execute.mockResolvedValue(undefined);
    await expect(checkDatabase()).rejects.toThrow("Database query returned no result");
    m.execute.mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(checkDatabase()).rejects.toThrow("ECONNREFUSED");
  });
});
