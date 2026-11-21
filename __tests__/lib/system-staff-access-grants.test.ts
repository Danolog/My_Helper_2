// @vitest-environment node
/**
 * #193: wyjścia systemowe grantów czasowych (`system/staff-access.ts`):
 * listSalonGrants, grantTemporaryAccess, revokeTemporaryAccess.
 *
 * Tabela temporary_access nie ma salon_id — ochroną jest warunek
 * `granted_by = ownerUserId` w KAŻDYM zapytaniu. Pula systemowa = atrapa
 * zapisująca rodzaj zapytania i jego WHERE; operatory drizzle => obiekty.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  grantTemporaryAccess,
  listSalonGrants,
  revokeTemporaryAccess,
} from "@/lib/server/system/staff-access";

const m = vi.hoisted(() => {
  const rows: unknown[][] = [];
  const queries: Array<{ kind: string; where?: unknown; set?: unknown; values?: unknown }> = [];

  function chain(kind: string): Record<string, unknown> {
    const q: { kind: string; where?: unknown; set?: unknown; values?: unknown } = { kind };
    queries.push(q);
    const c: Record<string, unknown> = {};
    for (const method of ["from", "limit", "returning"]) c[method] = () => c;
    c.where = (cond: unknown) => {
      q.where = cond;
      return c;
    };
    c.set = (v: unknown) => {
      q.set = v;
      return c;
    };
    c.values = (v: unknown) => {
      q.values = v;
      return c;
    };
    c.then = (resolve: (r: unknown[]) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(rows.shift() ?? []).then(resolve, reject);
    return c;
  }

  const db = {
    select: () => chain("select"),
    insert: () => chain("insert"),
    update: () => chain("update"),
    delete: () => chain("delete"),
  };
  return { rows, queries, db };
});

vi.mock("@/lib/db", () => ({
  db: new Proxy(
    {},
    {
      get: () => {
        throw new Error("surowy db niedozwolony w system/staff-access (#193)");
      },
    }
  ),
}));
vi.mock("@/lib/server/system/db-system", () => ({
  get dbSystem() {
    return m.db;
  },
}));
vi.mock("drizzle-orm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("drizzle-orm")>()),
  eq: (col: { name?: string }, val: unknown) => ({ op: "eq", col: col?.name, val }),
  ne: (col: { name?: string }, val: unknown) => ({ op: "ne", col: col?.name, val }),
  and: (...args: unknown[]) => ({ op: "and", args }),
  gt: (col: { name?: string }, val: unknown) => ({ op: "gt", col: col?.name, val }),
}));

type Node = { op?: string; args?: unknown[]; col?: string; val?: unknown };

/** Płaska lista warunków (eq/gt) z WHERE. */
function conds(where: unknown): Node[] {
  const out: Node[] = [];
  const walk = (n: unknown) => {
    if (!n || typeof n !== "object") return;
    const node = n as Node;
    if (node.op === "and") node.args?.forEach(walk);
    else out.push(node);
  };
  walk(where);
  return out;
}

const OWNER = "owner-a";
const ownerCond = { op: "eq", col: "granted_by", val: OWNER };

/** Każde zapytanie z WHERE ma granted_by = OWNER; insert zapisuje grantedBy = OWNER. */
function expectEveryQueryScopedToOwner() {
  expect(m.queries.length).toBeGreaterThan(0);
  for (const q of m.queries) {
    if (q.kind === "insert") {
      expect(q.values).toMatchObject({ grantedBy: OWNER });
    } else {
      expect(conds(q.where), q.kind).toContainEqual(ownerCond);
    }
  }
}

beforeEach(() => {
  m.rows.length = 0;
  m.queries.length = 0;
});

describe("listSalonGrants", () => {
  it("granted_by = właściciel i tylko aktywne (gt expires_at); bez filtra bez user_id", async () => {
    m.rows.push([{ id: "g-1" }]);
    const before = Date.now();
    expect(await listSalonGrants(OWNER, {})).toEqual([{ id: "g-1" }]);
    expectEveryQueryScopedToOwner();
    const c = conds(m.queries[0]!.where);
    expect(c.map((n) => n.col)).toEqual(["granted_by", "expires_at"]);
    const gt = c.find((n) => n.op === "gt")!;
    expect((gt.val as Date).getTime()).toBeGreaterThanOrEqual(before);
  });

  it("filter.userId zawęża dalej (granted_by zostaje)", async () => {
    await listSalonGrants(OWNER, { userId: "staff-x" });
    expectEveryQueryScopedToOwner();
    expect(conds(m.queries[0]!.where)).toContainEqual({ op: "eq", col: "user_id", val: "staff-x" });
  });

  it("pusty filter.userId nie dodaje warunku user_id (jak ?userId= bez wartości)", async () => {
    await listSalonGrants(OWNER, { userId: "" });
    expect(conds(m.queries[0]!.where).map((n) => n.col)).toEqual(["granted_by", "expires_at"]);
  });

  it("pusty ownerUserId => wyjątek, bez zapytania", async () => {
    await expect(listSalonGrants("", {})).rejects.toThrow(/ownerUserId/);
    expect(m.queries).toEqual([]);
  });
});

describe("grantTemporaryAccess", () => {
  const input = () => ({ userId: "staff-x", featureName: "reports", expiresAt: new Date(Date.now() + 3600_000) });

  it("brak aktywnego grantu tego właściciela => insert (extended: false)", async () => {
    m.rows.push([], [{ id: "g-new", grantedBy: OWNER }]);
    const g = input();
    expect(await grantTemporaryAccess(OWNER, g)).toEqual({
      grant: { id: "g-new", grantedBy: OWNER },
      extended: false,
    });
    expect(m.queries.map((q) => q.kind)).toEqual(["select", "insert"]);
    expect(m.queries[1]!.values).toEqual({
      userId: "staff-x",
      featureName: "reports",
      grantedBy: OWNER,
      expiresAt: g.expiresAt,
    });
    expectEveryQueryScopedToOwner();
    // Szukany grant: to samo konto i funkcja, aktywny.
    const c = conds(m.queries[0]!.where);
    expect(c).toContainEqual({ op: "eq", col: "user_id", val: "staff-x" });
    expect(c).toContainEqual({ op: "eq", col: "feature_name", val: "reports" });
    expect(c.some((n) => n.op === "gt" && n.col === "expires_at")).toBe(true);
  });

  it("aktywny grant tego właściciela => update expires_at (extended: true), bez insertu", async () => {
    m.rows.push([{ id: "g-old" }], [{ id: "g-old", grantedBy: OWNER }]);
    const g = input();
    expect(await grantTemporaryAccess(OWNER, g)).toEqual({
      grant: { id: "g-old", grantedBy: OWNER },
      extended: true,
    });
    expect(m.queries.map((q) => q.kind)).toEqual(["select", "update"]);
    expect(m.queries[1]!.set).toEqual({ expiresAt: g.expiresAt });
    expect(conds(m.queries[1]!.where)).toContainEqual({ op: "eq", col: "id", val: "g-old" });
    expectEveryQueryScopedToOwner();
  });

  it("pusty ownerUserId => wyjątek, bez zapytania", async () => {
    await expect(grantTemporaryAccess("", input())).rejects.toThrow(/ownerUserId/);
    expect(m.queries).toEqual([]);
  });
});

describe("revokeTemporaryAccess", () => {
  it("usuwa grant id AND granted_by; zwraca usunięty wiersz", async () => {
    m.rows.push([{ id: "g-1", grantedBy: OWNER }]);
    expect(await revokeTemporaryAccess(OWNER, "g-1")).toEqual({ id: "g-1", grantedBy: OWNER });
    expect(m.queries.map((q) => q.kind)).toEqual(["delete"]);
    expect(conds(m.queries[0]!.where)).toEqual([
      { op: "eq", col: "id", val: "g-1" },
      ownerCond,
    ]);
  });

  it("grant innego właściciela / nieistniejący => null", async () => {
    m.rows.push([]);
    expect(await revokeTemporaryAccess(OWNER, "g-foreign")).toBeNull();
    expectEveryQueryScopedToOwner();
  });

  it("pusty ownerUserId => wyjątek, bez zapytania", async () => {
    await expect(revokeTemporaryAccess("", "g-1")).rejects.toThrow(/ownerUserId/);
    expect(m.queries).toEqual([]);
  });
});
