// @vitest-environment node
/**
 * #193 A2b: wyjście systemowe `findCredentialPasswordHash` (`system/credentials.ts`).
 *
 * Zapytanie przeniesione z `DELETE /api/clients/[id]`: konto `account` użytkownika
 * z `provider_id = 'credential'`, limit 1, przez pulę systemową (nie surowy `db`).
 * Wynik: sam hash albo null.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { account } from "@/lib/schema";
import { findCredentialPasswordHash } from "@/lib/server/system/credentials";

const h = vi.hoisted(() => {
  const calls: { method: string; args: unknown[] }[] = [];
  const state: { rows: unknown[]; error: Error | null } = { rows: [], error: null };
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "from", "where", "limit"]) {
    chain[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return chain;
    };
  }
  chain.then = (resolve: (v: unknown[]) => unknown, reject: (e: Error) => unknown) =>
    state.error ? reject(state.error) : resolve(state.rows);
  return { calls, state, chain };
});

// Pula systemowa jawnie podmieniona (wygrywa z bezpiecznikiem z __tests__/setup.ts).
vi.mock("@/lib/server/system/db-system", () => ({
  dbSystem: { select: (...args: unknown[]) => (h.chain.select as (...a: unknown[]) => unknown)(...args) },
}));
// Surowy `db` nie może być użyty przez wyjście systemowe.
vi.mock("@/lib/db", () => ({
  get db(): never {
    throw new Error("surowy db w wyjściu systemowym credentials");
  },
}));
vi.mock("drizzle-orm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("drizzle-orm")>()),
  eq: (...args: unknown[]) => ({ op: "eq", args }),
  and: (...args: unknown[]) => ({ op: "and", args }),
}));

const argsOf = (method: string) => h.calls.filter((c) => c.method === method).map((c) => c.args);

describe("findCredentialPasswordHash", () => {
  beforeEach(() => {
    h.calls.length = 0;
    h.state.rows = [];
    h.state.error = null;
  });

  it("warunek: userId z argumentu AND providerId = 'credential', limit 1, tylko kolumna password", async () => {
    h.state.rows = [{ password: "hash-1" }];
    await expect(findCredentialPasswordHash("user-1")).resolves.toBe("hash-1");

    expect(argsOf("select")).toEqual([[{ password: account.password }]]);
    expect(argsOf("from")).toEqual([[account]]);
    expect(argsOf("where")).toHaveLength(1);
    const where = argsOf("where")[0]![0] as { op: string; args: { op: string; args: unknown[] }[] };
    expect(where.op).toBe("and");
    expect(where.args).toHaveLength(2);
    expect(where.args[0]!.op).toBe("eq");
    expect(where.args[0]!.args[0]).toBe(account.userId);
    expect(where.args[0]!.args[1]).toBe("user-1");
    expect(where.args[1]!.op).toBe("eq");
    expect(where.args[1]!.args[0]).toBe(account.providerId);
    expect(where.args[1]!.args[1]).toBe("credential");
    expect(argsOf("limit")).toEqual([[1]]);
  });

  it("brak konta credential → null", async () => {
    h.state.rows = [];
    await expect(findCredentialPasswordHash("user-2")).resolves.toBeNull();
  });

  it("konto bez hasła (password null) → null", async () => {
    h.state.rows = [{ password: null }];
    await expect(findCredentialPasswordHash("user-3")).resolves.toBeNull();
  });

  it("błąd bazy propaguje do wołającego", async () => {
    h.state.error = new Error("DB down");
    await expect(findCredentialPasswordHash("user-4")).rejects.toThrow("DB down");
  });
});
