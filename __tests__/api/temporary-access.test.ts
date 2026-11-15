/**
 * /api/temporary-access — kto nadaje, cofa i widzi granty czasowe.
 *
 * Przed naprawą: user.role "owner"/"admin" wystarczał do nadania/cofnięcia
 * grantu (bez salonu => bez sprawdzenia, czy cel jest pracownikiem), a
 * GET ?userId= zwracał granty dowolnego konta ze wszystkich salonów.
 * Teraz: tylko właściciel salonu z kontekstu sesji (salons.ownerId), cel
 * zawsze pracownikiem TEGO salonu, a odczyt/cofnięcie/aktualizacja tylko
 * grantów nadanych przez właściciela tego salonu (granted_by).
 *
 * Mockowane są krawędzie: sesja, db (kolejka wyników + zapis warunków
 * WHERE) i operatory drizzle (eq/and => zwykłe obiekty do asercji).
 * Bramka requireSalonStaff jest prawdziwa.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET, POST, DELETE } from "@/app/api/temporary-access/route";

const m = vi.hoisted(() => {
  const rows: unknown[][] = [];
  const wheres: unknown[] = [];
  const calls: string[] = [];
  const insertedValues: unknown[] = [];
  const getSession = vi.fn();

  function chain(kind: string): Record<string, unknown> {
    calls.push(kind);
    const c: Record<string, unknown> = {};
    for (const method of [
      "from", "innerJoin", "leftJoin", "limit", "orderBy", "returning", "set",
    ]) {
      c[method] = () => c;
    }
    c.where = (cond: unknown) => {
      wheres.push(cond);
      return c;
    };
    c.values = (v: unknown) => {
      insertedValues.push(v);
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

  return { rows, wheres, calls, insertedValues, getSession, db };
});

vi.mock("next/headers", () => ({ headers: vi.fn().mockResolvedValue(new Headers()) }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: m.getSession } } }));
vi.mock("@/lib/db", () => ({ db: m.db }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock("drizzle-orm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("drizzle-orm")>()),
  eq: (col: { name?: string }, val: unknown) => ({ op: "eq", col: col?.name, val }),
  and: (...args: unknown[]) => ({ op: "and", args }),
  gt: (col: { name?: string }, val: unknown) => ({ op: "gt", col: col?.name, val }),
  lt: (col: { name?: string }, val: unknown) => ({ op: "lt", col: col?.name, val }),
  inArray: (col: { name?: string }, val: unknown) => ({ op: "inArray", col: col?.name, val }),
}));

const SALON_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

/** Wszystkie pary eq(kolumna, wartość) z zapisanych WHERE. */
function eqs(): Array<{ col?: string | undefined; val: unknown }> {
  const out: Array<{ col?: string | undefined; val: unknown }> = [];
  const walk = (n: unknown) => {
    if (!n || typeof n !== "object") return;
    const node = n as { op?: string; args?: unknown[]; col?: string; val?: unknown };
    if (node.op === "and") node.args?.forEach(walk);
    if (node.op === "eq") out.push({ col: node.col, val: node.val });
  };
  m.wheres.forEach(walk);
  return out;
}

function signIn(userId: string, role?: string) {
  m.getSession.mockResolvedValue({
    user: { id: userId, email: `${userId}@test.pl`, name: userId, ...(role ? { role } : {}) },
    session: { id: `s-${userId}`, userId },
  });
}

/** Właściciel salonu A (salons.ownerId) — kontekst: salon, brak własnego rekordu. */
function asOwnerA() {
  signIn("owner-a");
  m.rows.push([{ id: SALON_A }], []);
}

/** Konto bez salonu z user.role = "owner" (stan produkcyjny konta z rolą). */
function asRoleOwnerWithoutSalon() {
  signIn("role-owner", "owner");
  m.rows.push([], []);
}

/** Recepcjonistka salonu A, na koncie dodatkowo user.role = "owner". */
function asReceptionistWithOwnerRole() {
  signIn("rec-a", "owner");
  m.rows.push([], [{ id: "emp-rec", salonId: SALON_A, role: "receptionist" }]);
}

function post(body: Record<string, unknown>) {
  return POST(
    new Request("http://localhost/api/temporary-access", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

function del(grantId: string) {
  return DELETE(
    new Request(`http://localhost/api/temporary-access?grantId=${grantId}`, { method: "DELETE" })
  );
}

function get(query = "") {
  return GET(new Request(`http://localhost/api/temporary-access${query}`));
}

const validGrant = { userId: "staff-x", featureName: "reports", durationMinutes: 60 };

beforeEach(() => {
  m.rows.length = 0;
  m.wheres.length = 0;
  m.calls.length = 0;
  m.insertedValues.length = 0;
  m.getSession.mockReset();
});

describe("POST /api/temporary-access", () => {
  it("401 bez sesji", async () => {
    m.getSession.mockResolvedValue(null);
    const res = await post(validGrant);
    expect(res.status).toBe(401);
    expect(m.calls).not.toContain("insert");
  });

  it("user.role='owner' bez salonu NIE nadaje grantu", async () => {
    asRoleOwnerWithoutSalon();
    m.rows.push([], [], [{ id: "g-1" }]); // gdyby trasa szła dalej: cleanup, existing, insert
    const res = await post(validGrant);
    expect(res.status).toBe(404);
    expect(m.calls).not.toContain("insert");
    expect(m.calls).not.toContain("update");
  });

  it("recepcjonistka z user.role='owner' NIE nadaje grantu (403)", async () => {
    asReceptionistWithOwnerRole();
    m.rows.push([], [], [{ id: "g-1" }]);
    const res = await post(validGrant);
    expect(res.status).toBe(403);
    expect(m.calls).not.toContain("insert");
  });

  it("właściciel: cel spoza jego salonu => 404, bez zapisu", async () => {
    asOwnerA();
    m.rows.push([], []); // cleanup, lookup pracownika w salonie A => brak
    const res = await post(validGrant);
    expect(res.status).toBe(404);
    expect(m.calls).not.toContain("insert");
    expect(eqs()).toContainEqual({ col: "salon_id", val: SALON_A });
  });

  it("właściciel: istniejący grant szukany tylko wśród nadanych przez niego (granted_by)", async () => {
    asOwnerA();
    m.rows.push([], [{ id: "emp-x" }], [], [{ id: "g-new", grantedBy: "owner-a" }]);
    const res = await post(validGrant);
    expect(res.status).toBe(201);
    // Grant tego samego konta nadany w innym salonie nie może zostać
    // nadpisany (przejęty) — lookup "existing" zawężony do granted_by.
    expect(eqs()).toContainEqual({ col: "granted_by", val: "owner-a" });
    expect(m.insertedValues).toEqual([
      expect.objectContaining({ userId: "staff-x", featureName: "reports", grantedBy: "owner-a" }),
    ]);
  });

  it("400 dla nieznanej funkcji (po autoryzacji)", async () => {
    asOwnerA();
    m.rows.push([]);
    const res = await post({ ...validGrant, featureName: "root" });
    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/temporary-access", () => {
  it("user.role='owner' bez salonu NIE cofa grantu", async () => {
    asRoleOwnerWithoutSalon();
    m.rows.push([{ id: "g-1", userId: "u", grantedBy: "owner-b" }], [{ id: "g-1" }]);
    const res = await del("g-1");
    expect(res.status).toBe(404);
    expect(m.calls).not.toContain("delete");
  });

  it("recepcjonistka z user.role='owner' NIE cofa grantu (403)", async () => {
    asReceptionistWithOwnerRole();
    m.rows.push([{ id: "g-1", userId: "u", grantedBy: "owner-a" }], [{ id: "g-1" }]);
    const res = await del("g-1");
    expect(res.status).toBe(403);
    expect(m.calls).not.toContain("delete");
  });

  it("właściciel: grant spoza jego salonu (inny granted_by) => 404", async () => {
    asOwnerA();
    m.rows.push([]); // lookup grantu zawężony do granted_by = owner-a => brak
    const res = await del("g-foreign");
    expect(res.status).toBe(404);
    expect(m.calls).not.toContain("delete");
    expect(eqs()).toContainEqual({ col: "granted_by", val: "owner-a" });
  });

  it("właściciel cofa własny grant", async () => {
    asOwnerA();
    m.rows.push(
      [{ id: "g-1", userId: "staff-x", grantedBy: "owner-a", featureName: "reports" }],
      [{ id: "g-1", userId: "staff-x", grantedBy: "owner-a", featureName: "reports" }]
    );
    const res = await del("g-1");
    expect(res.status).toBe(200);
    expect(m.calls).toContain("delete");
  });
});

describe("GET /api/temporary-access", () => {
  it("?userId= u właściciela: tylko granty nadane w jego salonie", async () => {
    asOwnerA();
    m.rows.push([], [{ id: "g-1", userId: "staff-x", grantedBy: "owner-a" }]);
    const res = await get("?userId=staff-x");
    expect(res.status).toBe(200);
    expect(eqs()).toContainEqual({ col: "granted_by", val: "owner-a" });
    expect(eqs()).toContainEqual({ col: "user_id", val: "staff-x" });
  });

  it("pracownik nie listuje grantów cudzego konta (403)", async () => {
    signIn("staff-a");
    m.rows.push([], [{ id: "emp-a", salonId: SALON_A, role: "employee" }]);
    m.rows.push([], [{ id: "g-9", userId: "victim", grantedBy: "owner-z" }]);
    const res = await get("?userId=victim");
    expect(res.status).toBe(403);
  });

  it("bez salonu => 404 (zero grantów)", async () => {
    asRoleOwnerWithoutSalon();
    m.rows.push([], [{ id: "g-9", userId: "victim", grantedBy: "owner-z" }]);
    const res = await get("?userId=victim");
    expect(res.status).toBe(404);
  });
});
