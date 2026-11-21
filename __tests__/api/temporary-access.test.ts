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
 * #193: trasa nie sięga do surowego `db` (atrapa `@/lib/db` rzuca przy każdym
 * użyciu). Granty idą przez wyjścia systemowe (pula systemowa = atrapa z kolejką
 * wyników i zapisem warunków WHERE), pracownik salonu przez
 * `forSalon(ctx.salonId).raw` (atrapa podaje tę samą kolejkę jako `tx`).
 * Operatory drizzle (eq/and/gt/lt) => zwykłe obiekty do asercji.
 * Bramka requireSalonStaff i wyjścia systemowe są prawdziwe.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET, POST, DELETE } from "@/app/api/temporary-access/route";

const m = vi.hoisted(() => {
  const rows: unknown[][] = [];
  const wheres: unknown[] = [];
  const calls: string[] = [];
  const insertedValues: unknown[] = [];
  const setValues: unknown[] = [];
  const forSalonCalls: string[] = [];
  const getSession = vi.fn();

  function chain(kind: string): Record<string, unknown> {
    calls.push(kind);
    const c: Record<string, unknown> = {};
    for (const method of ["from", "innerJoin", "leftJoin", "limit", "orderBy", "returning"]) {
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
    c.set = (v: unknown) => {
      setValues.push(v);
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

  return { rows, wheres, calls, insertedValues, setValues, forSalonCalls, getSession, db };
});

vi.mock("@/lib/db", () => ({
  db: new Proxy(
    {},
    {
      get: () => {
        throw new Error("surowy db niedozwolony w temporary-access (#193)");
      },
    }
  ),
}));
vi.mock("@/lib/server/system/db-system", () => ({
  get dbSystem() {
    return m.db;
  },
}));
vi.mock("@/lib/server/repository", () => ({
  forSalon: (salonId: string) => {
    m.forSalonCalls.push(salonId);
    return { salonId, raw: (fn: (tx: unknown) => Promise<unknown>) => fn(m.db) };
  },
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: (...args: unknown[]) => m.getSession(...args) } },
}));
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

type Eq = { col?: string | undefined; val: unknown };

/** Pary eq(kolumna, wartość) jednego warunku WHERE. */
function eqsOf(where: unknown): Eq[] {
  const out: Eq[] = [];
  const walk = (n: unknown) => {
    if (!n || typeof n !== "object") return;
    const node = n as { op?: string; args?: unknown[]; col?: string; val?: unknown };
    if (node.op === "and") node.args?.forEach(walk);
    if (node.op === "eq") out.push({ col: node.col, val: node.val });
  };
  walk(where);
  return out;
}

/** Wszystkie pary eq(kolumna, wartość) z zapisanych WHERE. */
function eqs(): Eq[] {
  return m.wheres.flatMap(eqsOf);
}

/** WHERE-y zapytań do temporary_access poza sprzątaniem (bez warunku `lt`). */
function grantWheres(): unknown[] {
  // Kolejność zapytań: [kontekst sesji: 2 selecty] … — kontekst nie dotyka
  // temporary_access, sprzątanie ma sam warunek lt(expires_at).
  return m.wheres.filter((w) => {
    const node = w as { op?: string };
    if (node.op === "lt") return false;
    return eqsOf(w).some((e) => e.col === "granted_by" || e.col === "feature_name" || e.col === "id");
  });
}

function signIn(userId: string, role?: string) {
  m.getSession.mockResolvedValue({
    user: { id: userId, email: `${userId}@example.invalid`, name: userId, ...(role ? { role } : {}) },
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
  m.setValues.length = 0;
  m.forSalonCalls.length = 0;
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

  it("właściciel: cel spoza jego salonu => 404, bez zapisu; pracownik szukany przez forSalon(salon z sesji)", async () => {
    asOwnerA();
    m.rows.push([], []); // cleanup, lookup pracownika w salonie A => brak
    const res = await post(validGrant);
    const body = await res.json();
    expect(res.status).toBe(404);
    expect(body.error).toBe("Uzytkownik nie jest pracownikiem tego salonu");
    expect(m.calls).not.toContain("insert");
    expect(m.calls).not.toContain("update");
    expect(m.forSalonCalls).toEqual([SALON_A]);
    expect(eqs()).toContainEqual({ col: "salon_id", val: SALON_A });
    expect(eqs()).toContainEqual({ col: "user_id", val: "staff-x" });
  });

  it("właściciel: nowy grant (201) — istniejący szukany tylko wśród nadanych przez niego (granted_by)", async () => {
    asOwnerA();
    m.rows.push([], [{ id: "emp-x" }], [], [{ id: "g-new", grantedBy: "owner-a" }]);
    const res = await post(validGrant);
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.message).toBe("Czasowy dostep zostal nadany");
    expect(body.data).toEqual({ id: "g-new", grantedBy: "owner-a" });
    // Grant tego samego konta nadany w innym salonie nie może zostać
    // nadpisany (przejęty) — lookup "existing" zawężony do granted_by.
    expect(eqs()).toContainEqual({ col: "granted_by", val: "owner-a" });
    expect(m.calls).not.toContain("update");
    expect(m.insertedValues).toEqual([
      expect.objectContaining({ userId: "staff-x", featureName: "reports", grantedBy: "owner-a" }),
    ]);
  });

  it("właściciel: aktywny grant tego samego właściciela => przedłużenie (200), bez nowego wiersza", async () => {
    asOwnerA();
    m.rows.push([], [{ id: "emp-x" }], [{ id: "g-old" }], [{ id: "g-old", grantedBy: "owner-a" }]);
    const before = Date.now();
    const res = await post(validGrant);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.message).toBe("Czasowy dostep zostal zaktualizowany");
    expect(body.data).toEqual({ id: "g-old", grantedBy: "owner-a" });
    expect(m.calls).not.toContain("insert");
    expect(m.calls).toContain("update");
    const [set] = m.setValues as Array<{ expiresAt: Date }>;
    expect(set!.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 60 * 60 * 1000);
    // Update zawężony do znalezionego grantu I właściciela.
    const updateWhere = eqsOf(m.wheres[m.wheres.length - 1]);
    expect(updateWhere).toContainEqual({ col: "id", val: "g-old" });
    expect(updateWhere).toContainEqual({ col: "granted_by", val: "owner-a" });
  });

  it("każde zapytanie do grantów ma warunek granted_by = właściciel z sesji", async () => {
    asOwnerA();
    m.rows.push([], [{ id: "emp-x" }], [{ id: "g-old" }], [{ id: "g-old" }]);
    await post(validGrant);
    const ws = grantWheres();
    expect(ws.length).toBe(2); // existing + update
    for (const w of ws) expect(eqsOf(w)).toContainEqual({ col: "granted_by", val: "owner-a" });
  });

  it("400 dla nieznanej funkcji (po autoryzacji)", async () => {
    asOwnerA();
    m.rows.push([]);
    const res = await post({ ...validGrant, featureName: "root" });
    expect(res.status).toBe(400);
    expect(m.forSalonCalls).toEqual([]);
  });

  it("400 dla durationMinutes poza zakresem, bez zapytania o pracownika", async () => {
    asOwnerA();
    m.rows.push([]);
    const res = await post({ ...validGrant, durationMinutes: 43201 });
    expect(res.status).toBe(400);
    expect(m.forSalonCalls).toEqual([]);
    expect(m.calls).not.toContain("insert");
  });

  it("400 dla niepoprawnego JSON", async () => {
    asOwnerA();
    m.rows.push([]);
    const res = await POST(
      new Request("http://localhost/api/temporary-access", { method: "POST", body: "{nie-json" })
    );
    expect(res.status).toBe(400);
  });

  it("błąd bazy => 500 z komunikatem trasy", async () => {
    asOwnerA();
    m.rows.push([], [{ id: "emp-x" }]);
    const orig = m.db.select;
    let n = 0;
    m.db.select = () => {
      n += 1;
      // 1, 2: kontekst sesji; 3: pracownik; 4: existing => błąd
      if (n === 4) throw new Error("db down");
      return orig();
    };
    try {
      const res = await post(validGrant);
      const body = await res.json();
      expect(res.status).toBe(500);
      expect(body.error).toBe("Nie udało się nadać uprawnień tymczasowych");
    } finally {
      m.db.select = orig;
    }
  });
});

describe("DELETE /api/temporary-access", () => {
  it("user.role='owner' bez salonu NIE cofa grantu", async () => {
    asRoleOwnerWithoutSalon();
    m.rows.push([{ id: "g-1", userId: "u", grantedBy: "owner-b" }]);
    const res = await del("g-1");
    expect(res.status).toBe(404);
    expect(m.calls).not.toContain("delete");
  });

  it("recepcjonistka z user.role='owner' NIE cofa grantu (403)", async () => {
    asReceptionistWithOwnerRole();
    m.rows.push([{ id: "g-1", userId: "u", grantedBy: "owner-a" }]);
    const res = await del("g-1");
    expect(res.status).toBe(403);
    expect(m.calls).not.toContain("delete");
  });

  it("400 bez grantId", async () => {
    asOwnerA();
    const res = await DELETE(new Request("http://localhost/api/temporary-access", { method: "DELETE" }));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toBe("grantId jest wymagane");
    expect(m.calls).not.toContain("delete");
  });

  it("grantId z treści żądania, gdy brak w query", async () => {
    asOwnerA();
    m.rows.push([{ id: "g-2", userId: "staff-x", grantedBy: "owner-a", featureName: "reports" }]);
    const res = await DELETE(
      new Request("http://localhost/api/temporary-access", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ grantId: "g-2" }),
      })
    );
    expect(res.status).toBe(200);
    expect(eqs()).toContainEqual({ col: "id", val: "g-2" });
  });

  it("właściciel: grant spoza jego salonu (inny granted_by) => 404, usunięcie zawężone do granted_by", async () => {
    asOwnerA();
    m.rows.push([]); // delete … where id AND granted_by = owner-a => 0 wierszy
    const res = await del("g-foreign");
    const body = await res.json();
    expect(res.status).toBe(404);
    expect(body.error).toBe("Nie znaleziono uprawnienia");
    const [w] = grantWheres();
    expect(eqsOf(w)).toContainEqual({ col: "id", val: "g-foreign" });
    expect(eqsOf(w)).toContainEqual({ col: "granted_by", val: "owner-a" });
  });

  it("właściciel cofa własny grant (200, zwraca usunięty grant)", async () => {
    asOwnerA();
    m.rows.push([{ id: "g-1", userId: "staff-x", grantedBy: "owner-a", featureName: "reports" }]);
    const res = await del("g-1");
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.message).toBe("Czasowy dostep zostal cofniety");
    expect(body.data).toMatchObject({ id: "g-1", featureName: "reports" });
    expect(m.calls).toContain("delete");
    expect(eqs()).toContainEqual({ col: "granted_by", val: "owner-a" });
  });
});

describe("GET /api/temporary-access", () => {
  it("właściciel: sprzątanie wygasłych, potem tylko granty nadane w jego salonie", async () => {
    asOwnerA();
    m.rows.push([], [{ id: "g-1", userId: "staff-x", grantedBy: "owner-a" }]);
    const res = await get();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.count).toBe(1);
    // Sprzątanie: delete … where lt(expires_at) (jak przed zmianą).
    expect(m.calls.slice(2)).toEqual(["delete", "select"]);
    expect(m.wheres).toContainEqual(expect.objectContaining({ op: "lt", col: "expires_at" }));
    const [w] = grantWheres();
    expect(eqsOf(w)).toEqual([{ col: "granted_by", val: "owner-a" }]);
  });

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

  it("401 bez sesji", async () => {
    m.getSession.mockResolvedValue(null);
    const res = await get();
    expect(res.status).toBe(401);
  });
});
