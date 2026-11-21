// @vitest-environment node
/**
 * #193: wyjście systemowe `findAccountForEmployeeLink` (`system/staff-access.ts`).
 *
 * Trzy zapytania przeniesione 1:1 z `PUT /api/employees/[id]/link-account`:
 * 1. `user` po e-mailu (id, emailVerified), limit 1;
 * 2. pracownik z `userId = konto` AND `id <> exceptEmployeeId` (dowolny salon), limit 1;
 * 3. salon z `ownerId = konto` (dowolny), limit 1.
 * Przez pulę systemową (nie surowy `db`). Wynik: null albo id + flagi, bez id
 * innych salonów i pracowników.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { employees, salons, user } from "@/lib/schema";
import { findAccountForEmployeeLink } from "@/lib/server/system/staff-access";

type Call = { query: number; method: string; args: unknown[] };

const h = vi.hoisted(() => {
  const calls: { query: number; method: string; args: unknown[] }[] = [];
  const state: { results: unknown[][]; error: Error | null; query: number } = {
    results: [],
    error: null,
    query: -1,
  };
  const chain: Record<string, unknown> = {};
  for (const method of ["from", "where", "limit"]) {
    chain[method] = (...args: unknown[]) => {
      calls.push({ query: state.query, method, args });
      return chain;
    };
  }
  chain.then = (resolve: (v: unknown[]) => unknown, reject: (e: Error) => unknown) =>
    state.error ? reject(state.error) : resolve(state.results[state.query] ?? []);
  const select = (...args: unknown[]) => {
    state.query += 1;
    calls.push({ query: state.query, method: "select", args });
    return chain;
  };
  return { calls, state, select };
});

// Pula systemowa jawnie podmieniona (wygrywa z bezpiecznikiem z __tests__/setup.ts).
vi.mock("@/lib/server/system/db-system", () => ({
  dbSystem: { select: (...args: unknown[]) => h.select(...args) },
}));
// Surowy `db` nie może być użyty przez wyjście systemowe.
vi.mock("@/lib/db", () => ({
  get db(): never {
    throw new Error("surowy db w wyjściu systemowym staff-access");
  },
}));
vi.mock("drizzle-orm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("drizzle-orm")>()),
  eq: (...args: unknown[]) => ({ op: "eq", args }),
  and: (...args: unknown[]) => ({ op: "and", args }),
  ne: (...args: unknown[]) => ({ op: "ne", args }),
}));

type Cond = { op: string; args: unknown[] };
const callsOf = (query: number, method: string) =>
  (h.calls as Call[]).filter((c) => c.query === query && c.method === method).map((c) => c.args);
const whereOf = (query: number) => callsOf(query, "where")[0]![0] as Cond;

describe("findAccountForEmployeeLink", () => {
  beforeEach(() => {
    h.calls.length = 0;
    h.state.results = [];
    h.state.error = null;
    h.state.query = -1;
  });

  it("warunki zapytań 1:1: user po e-mailu, pracownik ≠ exceptEmployeeId, salon po ownerId; limit 1", async () => {
    h.state.results = [[{ id: "acc-1", emailVerified: true }], [], []];

    await findAccountForEmployeeLink("anna@example.invalid", "emp-1");

    // 1. konto po e-mailu
    expect(callsOf(0, "select")).toEqual([[{ id: user.id, emailVerified: user.emailVerified }]]);
    expect(callsOf(0, "from")).toEqual([[user]]);
    expect(whereOf(0)).toEqual({ op: "eq", args: [user.email, "anna@example.invalid"] });
    expect(callsOf(0, "limit")).toEqual([[1]]);

    // 2. konto podpięte pod INNEGO pracownika (bez warunku salonu)
    expect(callsOf(1, "select")).toEqual([[{ id: employees.id }]]);
    expect(callsOf(1, "from")).toEqual([[employees]]);
    const linked = whereOf(1);
    expect(linked.op).toBe("and");
    expect(linked.args).toEqual([
      { op: "eq", args: [employees.userId, "acc-1"] },
      { op: "ne", args: [employees.id, "emp-1"] },
    ]);
    expect(callsOf(1, "limit")).toEqual([[1]]);

    // 3. konto jest właścicielem jakiegoś salonu
    expect(callsOf(2, "select")).toEqual([[{ id: salons.id }]]);
    expect(callsOf(2, "from")).toEqual([[salons]]);
    expect(whereOf(2)).toEqual({ op: "eq", args: [salons.ownerId, "acc-1"] });
    expect(callsOf(2, "limit")).toEqual([[1]]);
  });

  it("brak konta → null, bez kolejnych zapytań", async () => {
    h.state.results = [[]];

    await expect(findAccountForEmployeeLink("brak@example.invalid", "emp-1")).resolves.toBeNull();
    expect(callsOf(1, "select")).toEqual([]);
    expect(callsOf(2, "select")).toEqual([]);
  });

  it("konto wolne: flagi false", async () => {
    h.state.results = [[{ id: "acc-1", emailVerified: true }], [], []];

    await expect(findAccountForEmployeeLink("anna@example.invalid", "emp-1")).resolves.toEqual({
      id: "acc-1",
      emailVerified: true,
      linkedElsewhere: false,
      ownsSalon: false,
    });
  });

  it("konto podpięte gdzie indziej i właściciel salonu: same flagi, bez id cudzych wierszy", async () => {
    h.state.results = [[{ id: "acc-1", emailVerified: true }], [{ id: "emp-obcy" }], [{ id: "salon-obcy" }]];

    const result = await findAccountForEmployeeLink("anna@example.invalid", "emp-1");

    expect(result).toEqual({ id: "acc-1", emailVerified: true, linkedElsewhere: true, ownsSalon: true });
    expect(JSON.stringify(result)).not.toContain("emp-obcy");
    expect(JSON.stringify(result)).not.toContain("salon-obcy");
  });

  it("emailVerified inne niż true (false/null) → false", async () => {
    h.state.results = [[{ id: "acc-1", emailVerified: null }], [], []];
    await expect(findAccountForEmployeeLink("anna@example.invalid", "emp-1")).resolves.toMatchObject({
      emailVerified: false,
    });
  });

  it("błąd bazy propaguje do wołającego", async () => {
    h.state.error = new Error("DB down");
    await expect(findAccountForEmployeeLink("anna@example.invalid", "emp-1")).rejects.toThrow("DB down");
  });
});
