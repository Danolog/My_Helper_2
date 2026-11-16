// @vitest-environment node
/**
 * #193 P0b: adapter Better Auth na puli systemowej, z jawnym schematem
 * obejmującym WYŁĄCZNIE 4 tabele auth (user, session, account, verification).
 *
 * Schemat ma faktycznie zawężać adapter, a nie tylko go opisywać: model spoza
 * 4 tabel kończy się błędem adaptera drizzle, nawet gdy Better Auth go zna
 * (wtyczka deklarująca `salons`), i nie dociera do bazy.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: string[] = [];

/** Łańcuch zapytań drizzle: każda metoda zapisuje nazwę i zwraca łańcuch; await → []. */
function chain(): Record<string, unknown> {
  const c: Record<string, unknown> = {};
  for (const m of ["select", "from", "where", "limit", "offset", "orderBy", "execute", "insert", "values", "returning", "update", "set", "delete", "leftJoin", "innerJoin"]) {
    c[m] = (..._a: unknown[]) => {
      calls.push(m);
      return c;
    };
  }
  c.then = (resolve: (rows: unknown[]) => unknown) => Promise.resolve([]).then(resolve);
  return c;
}

const fakeDb = {
  select: (..._a: unknown[]) => {
    calls.push("dbSystem.select");
    return chain();
  },
  transaction: async (fn: (tx: unknown) => unknown) => fn(fakeDb),
};

vi.mock("@/lib/server/system/db-system", () => ({ dbSystem: fakeDb }));
// Surowa pula żądań nie może być użyta przez adapter.
vi.mock("@/lib/db", () => ({
  db: new Proxy(
    {},
    {
      get(_t, p) {
        if (p === "then") return undefined;
        throw new Error(`adapter użył db (${String(p)}) zamiast dbSystem`);
      },
    }
  ),
}));

type FindOne = (q: { model: string; where: { field: string; value: string }[] }) => Promise<unknown>;

async function adapter(): Promise<{ findOne: FindOne }> {
  const { authAdapter } = await import("@/lib/server/system/auth-adapter");
  // Wtyczka deklaruje `salons`, żeby Better Auth znał model — o odmowie decyduje schemat adaptera.
  const options = {
    plugins: [{ id: "p0b-probe", schema: { salons: { fields: { name: { type: "string" } } } } }],
  };
  return (authAdapter as unknown as (o: unknown) => { findOne: FindOne })(options);
}

describe("authAdapter: dbSystem + dokładnie 4 tabele auth", () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it.each([["user"], ["session"], ["account"], ["verification"]])(
    "model %s → zapytanie przez dbSystem",
    async (model) => {
      const a = await adapter();
      await expect(a.findOne({ model, where: [{ field: "id", value: "x" }] })).resolves.toBeNull();
      expect(calls).toContain("dbSystem.select");
    }
  );

  it.each([["salons"]])("model spoza 4 tabel (%s) → błąd schematu adaptera, bez zapytania", async (model) => {
    const a = await adapter();
    // Wynik zbierany bez rzucania, żeby najpierw sprawdzić, czy zapytanie w ogóle poszło.
    const outcome = await a.findOne({ model, where: [{ field: "id", value: "x" }] }).then(
      (value) => ({ status: "fulfilled" as const, value, error: undefined as unknown }),
      (error: unknown) => ({ status: "rejected" as const, value: undefined as unknown, error })
    );
    expect(calls, "adapter wykonał zapytanie poza 4 tabelami auth").not.toContain("dbSystem.select");
    expect(outcome.status).toBe("rejected");
    expect(String(outcome.error)).toMatch(/was not found in the schema object/);
  });
});
