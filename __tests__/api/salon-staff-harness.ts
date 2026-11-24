/**
 * Wspólna uprząż testów izolacji salonu dla tras na requireSalonStaff.
 *
 * Celowo NIE mockuje @/lib/salon-context ani @/lib/server/repository —
 * test przechodzi przez prawdziwą bramkę (salon z sesji) i prawdziwe
 * forSalon. Mockowane są tylko krawędzie: sesja (auth.api.getSession),
 * baza (db) i granty (hasTemporaryAccess).
 *
 * Dwa niezależne strumienie wyników bazy:
 *   - ctxRows: zapytania kontekstu salonu (db.select().from().where().limit()
 *     poza transakcją) — kolejność jak w getSalonContext,
 *   - txRows:  zapytania trasy wewnątrz forSalon (db.transaction -> tx.*).
 *
 * Użycie (fabryki vi.mock nie widzą zwykłych importów):
 *   const m = await vi.hoisted(async () =>
 *     (await import("./salon-staff-harness")).createSalonStaffMocks());
 */
import { vi } from "vitest";

export const SALON_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const SALON_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

export function createSalonStaffMocks() {
  const getSession = vi.fn();
  const hasTemporaryAccess = vi.fn();
  const ctxRows: unknown[][] = [];
  const txRows: unknown[][] = [];
  /** Argumenty każdego tx.insert(...).values(x) — dowód, do którego salonu zapis. */
  const insertedValues: unknown[] = [];
  /**
   * Każde tx.update(...) / tx.delete(...) z argumentem .where(...) — dowód,
   * że zapis w ogóle poszedł i jakim filtrem był zawężony.
   */
  const writes: { op: "update" | "delete"; where?: unknown }[] = [];
  const txExecute = vi.fn().mockResolvedValue(undefined);

  function txChain(write?: { op: "update" | "delete"; where?: unknown }): Record<string, unknown> {
    const chain: Record<string, unknown> = {};
    for (const method of [
      "select", "from", "where", "leftJoin", "innerJoin", "orderBy",
      "limit", "offset", "groupBy", "insert", "returning", "update", "set",
    ]) {
      chain[method] = () => chain;
    }
    if (write) {
      writes.push(write);
      chain.where = (w: unknown) => {
        write.where = w;
        return chain;
      };
    }
    chain.values = (v: unknown) => {
      insertedValues.push(v);
      return chain;
    };
    chain.then = (resolve: (rows: unknown[]) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(txRows.shift() ?? []).then(resolve, reject);
    return chain;
  }

  const tx = {
    select: () => txChain(),
    insert: () => txChain(),
    update: () => txChain({ op: "update" }),
    delete: () => txChain({ op: "delete" }),
    execute: txExecute,
  };

  /**
   * Surowa pula żądań: WYŁĄCZNIE transakcja (forSalon). `db.select` poza
   * transakcją nie istnieje — w trasie na requireSalonStaff byłoby to
   * zapytanie poza izolacją (#193 P0b, decyzja z recenzji).
   */
  const db = {
    transaction: (fn: (t: typeof tx) => unknown) => fn(tx),
  };

  /**
   * #193 P0b: zapytania kontekstu salonu idą przez pulę systemową
   * (system/session.ts) — osobny strumień ctxRows.
   * Użycie: vi.mock("@/lib/server/system/db-system", () => ({ dbSystem: m.dbSystem }));
   */
  const dbSystem = {
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => ctxRows.shift() ?? [] }),
      }),
    }),
  };

  function reset() {
    getSession.mockReset();
    hasTemporaryAccess.mockReset();
    hasTemporaryAccess.mockResolvedValue(false);
    ctxRows.length = 0;
    txRows.length = 0;
    insertedValues.length = 0;
    writes.length = 0;
    txExecute.mockClear();
  }

  function signIn(userId: string) {
    getSession.mockResolvedValue({
      user: { id: userId, email: `${userId}@test.pl`, name: userId },
      session: { id: `s-${userId}`, userId },
    });
  }

  /** Właściciel salonu (salons.ownerId) — bez rekordu employees. */
  function asOwnerOf(salonId: string, userId = "owner-a") {
    signIn(userId);
    ctxRows.push([{ id: salonId }], []);
  }

  /** Aktywny pracownik podpięty kontem. */
  function asStaffOf(salonId: string, role: "employee" | "receptionist", userId = "staff-a") {
    signIn(userId);
    ctxRows.push([], [{ id: "emp-a", salonId, role }]);
  }

  /**
   * salonId ustawione w kontekście RLS (set_config) we wszystkich transakcjach
   * — czyli salony, dla których trasa faktycznie wołała forSalon(...).
   */
  function rlsSalonIds(): string[] {
    return txExecute.mock.calls
      .map(([q]) => (q as { queryChunks?: unknown[] }).queryChunks ?? [])
      .flat()
      .filter((c): c is string => typeof c === "string" && /^[0-9a-f-]{36}$/.test(c));
  }

  return {
    getSession,
    hasTemporaryAccess,
    ctxRows,
    txRows,
    insertedValues,
    writes,
    db,
    dbSystem,
    reset,
    signIn,
    asOwnerOf,
    asStaffOf,
    rlsSalonIds,
  };
}
