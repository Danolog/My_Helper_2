/**
 * POST /api/register-subscription — konto wyłącznie z sesji.
 *
 * Przed poprawką trasa szukała konta po `email` z body (alias `userTable`),
 * potem tworzyła salon dla TAMTEGO konta albo zmieniała `planId` jego
 * istniejącej subskrypcji. Skutki (P1, Ryan):
 *  (a) konto A z e-mailem B w body zmienia plan subskrypcji salonu B,
 *  (b) konto A przestawia własną subskrypcję na Pro bez płatności,
 *  (c) 404 "User not found" / 200 zdradza, czy konto o danym e-mailu istnieje.
 *
 * Kontrakt po poprawce: konto = authResult.user.id, e-mail z body ignorowany;
 * istniejącej subskrypcji ta trasa nie zmienia (zmiana planu tylko przez
 * Stripe) — 409, bez zapisu.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";
import { createMockRequest, parseResponse } from "./helpers";

const USER_A = { id: "user-a", name: "Anna", email: "anna@example.com", emailVerified: true };
const EMAIL_B = "bartek@example.com";
const SALON_A = crypto.randomUUID();
const SALON_B = crypto.randomUUID();
const PLAN_BASIC = { id: crypto.randomUUID(), slug: "basic", name: "Basic" };

// Stan "bazy": wynik db.select(...) zależy od tabeli w `from` (mock ignoruje
// where — co trasa filtruje, sprawdzamy przez wywołania eq).
let tableRows: Record<string, unknown[]> = {};
const selectedTables: string[] = [];
const mockUpdate = vi.fn();
const mockUpdateSet = vi.fn();
const mockInsert = vi.fn();
const mockInsertValues = vi.fn();

function chain(result: () => unknown[]) {
  const c: Record<string, unknown> = {};
  let fromTable: string | null = null;
  for (const m of ["select", "where", "limit", "returning"]) c[m] = vi.fn(() => c);
  c.from = vi.fn((table: { _table?: string }) => {
    fromTable = String(table._table);
    selectedTables.push(fromTable);
    return c;
  });
  c.set = vi.fn((v: unknown) => {
    mockUpdateSet(v);
    return c;
  });
  c.values = vi.fn((v: unknown) => {
    mockInsertValues(v);
    return c;
  });
  c.then = (resolve: (v: unknown[]) => unknown) =>
    resolve(fromTable ? (tableRows[fromTable] ?? []) : result());
  return c;
}

// Kolejność operacji (T3b): `tx:start`, `lock_timeout`, `select:<tabela>`,
// `insert:<tabela>`, `lock:salon:<id>`, `commit`/`rollback`.
const opLog: string[] = [];
const dbOutsideTx = { insert: vi.fn(), update: vi.fn() };
let failInsert: { table: string; error: unknown } | null = null;

function insertChain(table: { _table?: string }) {
  mockInsert(table._table);
  opLog.push(`insert:${table._table}`);
  if (failInsert && failInsert.table === table._table) {
    const { error } = failInsert;
    failInsert = null;
    const c: Record<string, unknown> = {};
    for (const m of ["values", "returning"]) c[m] = (v: unknown) => (m === "values" && mockInsertValues(v), c);
    c.then = (_res: unknown, rej: (e: unknown) => unknown) => rej(error);
    return c;
  }
  return chain(() =>
    table._table === "salons"
      ? [{ id: SALON_A }]
      : [{ id: crypto.randomUUID(), status: "trialing", trialEndsAt: new Date() }]
  );
}

function selectChainLogged() {
  const c = chain(() => []);
  const from = c.from as (t: { _table?: string }) => unknown;
  c.from = (t: { _table?: string }) => {
    opLog.push(`select:${t._table}`);
    return from(t);
  };
  return c;
}

vi.mock("@/lib/db", () => ({
  db: {
    select: () => selectChainLogged(),
    update: (...args: unknown[]) => {
      dbOutsideTx.update(...args);
      mockUpdate(...args);
      return chain(() => []);
    },
    insert: (table: { _table?: string }) => {
      dbOutsideTx.insert(table._table);
      return insertChain(table);
    },
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      opLog.push("tx:start");
      const tx = {
        select: () => selectChainLogged(),
        insert: (table: { _table?: string }) => insertChain(table),
        update: (...args: unknown[]) => {
          mockUpdate(...args);
          return chain(() => []);
        },
      };
      try {
        const r = await fn(tx);
        opLog.push("commit");
        return r;
      } catch (e) {
        opLog.push("rollback");
        throw e;
      }
    },
  },
}));

const { lockFailure } = vi.hoisted(() => ({ lockFailure: { next: null as { code: string } | null } }));
vi.mock("@/lib/subscription-locks", () => ({
  setSubscriptionLockTimeout: async () => {
    opLog.push("lock_timeout");
  },
  lockSalonSubscriptions: async (_tx: unknown, salonId: string) => {
    opLog.push(`lock:salon:${salonId}`);
    if (lockFailure.next) {
      const err = Object.assign(new Error("lock failure"), lockFailure.next);
      lockFailure.next = null;
      throw err;
    }
  },
  isSubscriptionLockFailure: (e: unknown) => ["40P01", "55P03"].includes(String((e as { code?: unknown }).code)),
}));

vi.mock("@/lib/schema", () => {
  const table = (name: string) =>
    new Proxy({}, { get: (_t, col) => (col === "_table" ? name : `${name}.${String(col)}`) });
  return {
    subscriptionPlans: table("subscriptionPlans"),
    salonSubscriptions: table("salonSubscriptions"),
    salons: table("salons"),
    user: table("user"),
    legalAcceptances: table("legalAcceptances"),
  };
});

// Stan publikacji dokumentów prawnych. Domyślnie jak w module (nieopublikowane);
// testy akceptacji włączają flagę i ustawiają wersje.
const legalState = vi.hoisted(() => ({
  published: false,
  terms: null as string | null,
  dpa: null as string | null,
}));
vi.mock("@/lib/legal/documents", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/legal/documents")>();
  return {
    ...real,
    get LEGAL_DOCS_PUBLISHED() {
      return legalState.published;
    },
    get LEGAL_DOCUMENTS() {
      return {
        ...real.LEGAL_DOCUMENTS,
        terms: { ...real.LEGAL_DOCUMENTS.terms, version: legalState.terms },
        dpa: { ...real.LEGAL_DOCUMENTS.dpa, version: legalState.dpa },
      };
    },
  };
});

const mockEq = vi.fn((...args: unknown[]) => ({ type: "eq", args }));
vi.mock("drizzle-orm", () => ({
  eq: (...args: unknown[]) => mockEq(...args),
  and: vi.fn((...args: unknown[]) => ({ type: "and", args })),
}));

const mockRequireAuth = vi.fn();
vi.mock("@/lib/auth-middleware", () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
  isAuthError: (r: unknown) => r instanceof NextResponse,
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { POST } from "@/app/api/register-subscription/route";

function post(body: unknown) {
  return POST(
    createMockRequest("http://localhost:3000/api/register-subscription", { method: "POST", body }) as never
  ).then(parseResponse);
}

beforeEach(() => {
  vi.clearAllMocks();
  tableRows = {};
  selectedTables.length = 0;
  opLog.length = 0;
  failInsert = null;
  lockFailure.next = null;
  legalState.published = false;
  legalState.terms = null;
  legalState.dpa = null;
  mockRequireAuth.mockResolvedValue({ session: { user: USER_A }, user: USER_A });
});

describe("POST /api/register-subscription — konto tylko z sesji", () => {
  it("(a) konto A z e-mailem B w body nie dotyka salonu ani subskrypcji B", async () => {
    // Baza: konto B ma salon z aktywną subskrypcją Basic.
    tableRows = {
      subscriptionPlans: [PLAN_BASIC],
      user: [{ id: "user-b", email: EMAIL_B, name: "Bartek" }],
      salons: [],
      salonSubscriptions: [],
    };
    // Na main trasa po koncie B znajduje salon B i jego subskrypcję:
    const salonB = { id: SALON_B, ownerId: "user-b" };
    const subB = { id: crypto.randomUUID(), salonId: SALON_B, status: "active" };
    tableRows.salons = [salonB];
    tableRows.salonSubscriptions = [subB];
    // Mock nie filtruje po where, więc o tym, CZYJ salon trasa czyta,
    // rozstrzygają wywołania eq: musi szukać po koncie z sesji (A).

    await post({ planSlug: "basic", email: EMAIL_B });

    expect(selectedTables).not.toContain("user");
    expect(mockEq).not.toHaveBeenCalledWith("user.email", EMAIL_B);
    expect(mockEq).toHaveBeenCalledWith("salons.ownerId", USER_A.id);
    expect(mockEq).not.toHaveBeenCalledWith("salons.ownerId", "user-b");
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("(b) konto A z istniejącą subskrypcją: trasa jej nie zmienia — 409, bez zapisu", async () => {
    tableRows = {
      subscriptionPlans: [PLAN_BASIC],
      user: [{ id: USER_A.id, email: USER_A.email, name: USER_A.name }],
      salons: [{ id: SALON_A, ownerId: USER_A.id }],
      salonSubscriptions: [{ id: crypto.randomUUID(), salonId: SALON_A, status: "active", planId: "basic" }],
    };

    const { status, body } = await post({ planSlug: "basic", email: USER_A.email });

    expect(status).toBe(409);
    expect(body.success).toBe(false);
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("(c) odpowiedź nie zdradza, czy konto o e-mailu z body istnieje", async () => {
    // A bez salonu. Main: e-mail nieistniejący => 404 "User not found",
    // e-mail istniejący => 200 — różnica zdradza istnienie konta.
    tableRows = { subscriptionPlans: [PLAN_BASIC], user: [], salons: [], salonSubscriptions: [] };
    const r1 = await post({ planSlug: "basic", email: "nie-istnieje@example.com" });

    tableRows = {
      subscriptionPlans: [PLAN_BASIC],
      user: [{ id: "user-b", email: EMAIL_B, name: "Bartek" }],
      salons: [],
      salonSubscriptions: [],
    };
    const r2 = await post({ planSlug: "basic", email: EMAIL_B });

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(r1.status);
    expect(JSON.stringify(r1.body)).not.toContain("User not found");
    expect(selectedTables).not.toContain("user");
  });

  it("konto bez salonu: tworzy salon dla konta z sesji i subskrypcję trialing", async () => {
    tableRows = { subscriptionPlans: [PLAN_BASIC], user: [{ id: USER_A.id, email: USER_A.email, name: USER_A.name }] };

    const { status, body } = await post({ planSlug: "basic", email: USER_A.email });

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(mockInsert).toHaveBeenNthCalledWith(1, "salons");
    expect(mockInsertValues).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ ownerId: USER_A.id, email: USER_A.email })
    );
    expect(mockInsertValues).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ salonId: SALON_A, planId: PLAN_BASIC.id, status: "trialing" })
    );
  });

  it("body bez e-maila jest poprawne (e-mail nie jest już częścią kontraktu)", async () => {
    tableRows = { subscriptionPlans: [PLAN_BASIC] };
    const { status } = await post({ planSlug: "basic" });
    expect(status).toBe(200);
  });

  it('plan spoza PLANS_ON_SALE ("gold") => 400 z walidacji, bez zapytań i bez zapisu', async () => {
    const { status } = await post({ planSlug: "gold" });
    expect(status).toBe(400);
    expect(opLog).toEqual([]);
    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('planSlug "pro" (poza PLANS_ON_SALE) => 400 z walidacji, bez zapytań i bez zapisu', async () => {
    tableRows = { subscriptionPlans: [{ id: crypto.randomUUID(), slug: "pro", name: "Pro" }] };

    const { status } = await post({ planSlug: "pro" });

    expect(status).toBe(400);
    expect(opLog).toEqual([]);
    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("brak sesji => 401", async () => {
    mockRequireAuth.mockResolvedValue(
      NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
    );
    const { status } = await post({ planSlug: "basic" });
    expect(status).toBe(401);
  });
});

describe("POST /api/register-subscription — T3b: jedna transakcja, blokada salonu, indeksy unikalne", () => {
  it("salon i trial w JEDNEJ transakcji; blokada salonu przed odczytem jego wierszy", async () => {
    tableRows = { subscriptionPlans: [PLAN_BASIC] };

    const { status } = await post({ planSlug: "basic" });

    expect(status).toBe(200);
    expect(opLog).toEqual([
      "select:subscriptionPlans",
      "tx:start",
      "lock_timeout",
      "select:salons",
      "insert:salons",
      `lock:salon:${SALON_A}`,
      "select:salonSubscriptions",
      "insert:salonSubscriptions",
      "commit",
    ]);
    expect(dbOutsideTx.insert).not.toHaveBeenCalled();
  });

  it("istniejący salon bez subskrypcji (np. z POST /api/salons): blokada jego id, trial, bez drugiego salonu", async () => {
    tableRows = { subscriptionPlans: [PLAN_BASIC], salons: [{ id: SALON_B, ownerId: USER_A.id }] };

    const { status } = await post({ planSlug: "basic" });

    expect(status).toBe(200);
    expect(mockInsert).not.toHaveBeenCalledWith("salons");
    expect(opLog).toContain(`lock:salon:${SALON_B}`);
    expect(mockInsertValues).toHaveBeenCalledWith(expect.objectContaining({ salonId: SALON_B, status: "trialing" }));
  });

  it("błąd zapisu subskrypcji → rollback całej transakcji (salon nie zostaje bez wiersza), 500", async () => {
    tableRows = { subscriptionPlans: [PLAN_BASIC] };
    failInsert = { table: "salonSubscriptions", error: Object.assign(new Error("boom"), { code: "XX000" }) };

    const { status } = await post({ planSlug: "basic" });

    expect(status).toBe(500);
    expect(opLog).toContain("insert:salons");
    expect(opLog.at(-1)).toBe("rollback");
    expect(dbOutsideTx.insert).not.toHaveBeenCalled();
  });

  it.each([
    ["salons_owner_id_uq (równoległe utworzenie salonu)", "salons"],
    ["salon_subscriptions_salon_current_uq (równoległy trial)", "salonSubscriptions"],
  ])("23505 z %s → 409, rollback", async (_name, table) => {
    tableRows = { subscriptionPlans: [PLAN_BASIC] };
    failInsert = { table, error: Object.assign(new Error("db"), { cause: { code: "23505" } }) };

    const { status, body } = await post({ planSlug: "basic" });

    expect(status).toBe(409);
    expect(body.success).toBe(false);
    expect(opLog.at(-1)).toBe("rollback");
  });

  it.each(["40P01", "55P03"])("%s przy blokadzie salonu → 503 LOCK_BUSY, rollback", async (code) => {
    tableRows = { subscriptionPlans: [PLAN_BASIC], salons: [{ id: SALON_A, ownerId: USER_A.id }] };
    lockFailure.next = { code };

    const { status, body } = await post({ planSlug: "basic" });

    expect(status).toBe(503);
    expect(body.code).toBe("LOCK_BUSY");
    expect(mockInsert).not.toHaveBeenCalled();
    expect(opLog.at(-1)).toBe("rollback");
  });

  it("tylko aktywny plan: zapytanie filtruje isActive = true; plan wycofany (brak w wyniku) → 404 bez transakcji", async () => {
    tableRows = { subscriptionPlans: [] };

    const { status } = await post({ planSlug: "basic" });

    expect(status).toBe(404);
    expect(mockEq).toHaveBeenCalledWith("subscriptionPlans.isActive", true);
    expect(opLog).not.toContain("tx:start");
  });

  it("400 przy niepoprawnym body, bez zapytań", async () => {
    const { status } = await post({ planSlug: 123 });
    expect(status).toBe(400);
    expect(opLog).toEqual([]);
  });
});

describe("POST /api/register-subscription — akceptacja regulaminu i DPA", () => {
  const TERMS_V = "2026-12-01";
  const DPA_V = "2026-12-02";
  const ACCEPTED = { termsVersion: TERMS_V, dpaVersion: DPA_V, acceptanceSource: "registration" };

  function publish() {
    legalState.published = true;
    legalState.terms = TERMS_V;
    legalState.dpa = DPA_V;
  }

  it("dokumenty nieopublikowane: rejestracja bez akceptacji przechodzi, bez wpisów legal_acceptances", async () => {
    tableRows = { subscriptionPlans: [PLAN_BASIC] };

    const { status } = await post({ planSlug: "basic" });

    expect(status).toBe(200);
    expect(mockInsert).not.toHaveBeenCalledWith("legalAcceptances");
  });

  it("dokumenty nieopublikowane: przysłane wersje są ignorowane (nie ma czego akceptować)", async () => {
    tableRows = { subscriptionPlans: [PLAN_BASIC] };

    const { status } = await post({ planSlug: "basic", ...ACCEPTED });

    expect(status).toBe(200);
    expect(mockInsert).not.toHaveBeenCalledWith("legalAcceptances");
  });

  it("(b) opublikowane, bez obu wersji → 400 LEGAL_ACCEPTANCE_REQUIRED, bez zapytań i bez salonu", async () => {
    publish();
    tableRows = { subscriptionPlans: [PLAN_BASIC] };

    const { status, body } = await post({ planSlug: "basic" });

    expect(status).toBe(400);
    expect(body.code).toBe("LEGAL_ACCEPTANCE_REQUIRED");
    expect(Object.keys(body.details as object)).toEqual(expect.arrayContaining(["termsVersion", "dpaVersion"]));
    expect(body.requiredVersions).toEqual({ terms: TERMS_V, dpa: DPA_V });
    expect(opLog).toEqual([]);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it.each([
    ["tylko regulamin", { termsVersion: TERMS_V, acceptanceSource: "registration" }],
    ["tylko DPA", { dpaVersion: DPA_V, acceptanceSource: "registration" }],
    ["nieaktualna wersja regulaminu", { ...ACCEPTED, termsVersion: "2026-01-01" }],
    ["nieaktualna wersja DPA", { ...ACCEPTED, dpaVersion: "2026-01-01" }],
    ["bez źródła akceptacji", { termsVersion: TERMS_V, dpaVersion: DPA_V }],
  ])("(b) opublikowane, %s → 400, bez salonu", async (_n, fields) => {
    publish();
    tableRows = { subscriptionPlans: [PLAN_BASIC] };

    const { status, body } = await post({ planSlug: "basic", ...fields });

    expect(status).toBe(400);
    expect(body.code).toBe("LEGAL_ACCEPTANCE_REQUIRED");
    expect(opLog).toEqual([]);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it.each([
    ["źródło spoza formularza (email_pilot)", { ...ACCEPTED, acceptanceSource: "email_pilot" }],
    ["wersja nie jest napisem", { ...ACCEPTED, termsVersion: 20261201 }],
    ["wersja dłuższa niż 64 znaki", { ...ACCEPTED, dpaVersion: "x".repeat(65) }],
  ])("%s → 400 z walidacji, bez zapytań", async (_n, fields) => {
    publish();
    const { status } = await post({ planSlug: "basic", ...fields });
    expect(status).toBe(400);
    expect(opLog).toEqual([]);
  });

  it("(c) opublikowane, obie bieżące wersje → dwa wpisy w tej samej transakcji co salon i trial", async () => {
    publish();
    tableRows = { subscriptionPlans: [PLAN_BASIC] };

    const { status } = await post({ planSlug: "basic", ...ACCEPTED, acceptanceSource: "create_salon" });

    expect(status).toBe(200);
    expect(opLog).toEqual([
      "select:subscriptionPlans",
      "tx:start",
      "lock_timeout",
      "select:salons",
      "insert:salons",
      `lock:salon:${SALON_A}`,
      "select:salonSubscriptions",
      "insert:salonSubscriptions",
      "insert:legalAcceptances",
      "commit",
    ]);
    expect(mockInsertValues).toHaveBeenCalledWith([
      { salonId: SALON_A, userId: USER_A.id, document: "terms", version: TERMS_V, source: "create_salon" },
      { salonId: SALON_A, userId: USER_A.id, document: "dpa", version: DPA_V, source: "create_salon" },
    ]);
    expect(dbOutsideTx.insert).not.toHaveBeenCalled();
  });

  it("(c) opublikowane, istniejący salon bez subskrypcji → trial i dwa wpisy z id istniejącego salonu, bez drugiego salonu", async () => {
    publish();
    tableRows = { subscriptionPlans: [PLAN_BASIC], salons: [{ id: SALON_B, ownerId: USER_A.id }] };

    const { status } = await post({ planSlug: "basic", ...ACCEPTED, acceptanceSource: "create_salon" });

    expect(status).toBe(200);
    expect(opLog).toEqual([
      "select:subscriptionPlans",
      "tx:start",
      "lock_timeout",
      "select:salons",
      `lock:salon:${SALON_B}`,
      "select:salonSubscriptions",
      "insert:salonSubscriptions",
      "insert:legalAcceptances",
      "commit",
    ]);
    expect(mockInsert).not.toHaveBeenCalledWith("salons");
    expect(mockInsertValues).toHaveBeenCalledWith([
      { salonId: SALON_B, userId: USER_A.id, document: "terms", version: TERMS_V, source: "create_salon" },
      { salonId: SALON_B, userId: USER_A.id, document: "dpa", version: DPA_V, source: "create_salon" },
    ]);
    expect(dbOutsideTx.insert).not.toHaveBeenCalled();
  });

  it("(c) błąd zapisu akceptacji → rollback salonu i triala, 500", async () => {
    publish();
    tableRows = { subscriptionPlans: [PLAN_BASIC] };
    failInsert = { table: "legalAcceptances", error: Object.assign(new Error("boom"), { code: "XX000" }) };

    const { status } = await post({ planSlug: "basic", ...ACCEPTED });

    expect(status).toBe(500);
    expect(opLog).toContain("insert:salons");
    expect(opLog.at(-1)).toBe("rollback");
  });

  it("opublikowane, salon ma już subskrypcję → 409 bez wpisów akceptacji", async () => {
    publish();
    tableRows = {
      subscriptionPlans: [PLAN_BASIC],
      salons: [{ id: SALON_A, ownerId: USER_A.id }],
      salonSubscriptions: [{ id: crypto.randomUUID(), salonId: SALON_A, status: "active" }],
    };

    const { status } = await post({ planSlug: "basic", ...ACCEPTED });

    expect(status).toBe(409);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("flaga włączona, DPA bez wersji (błąd konfiguracji) → 500, bez zapytań i bez salonu", async () => {
    legalState.published = true;
    legalState.terms = TERMS_V;
    legalState.dpa = null;

    const { status } = await post({ planSlug: "basic", ...ACCEPTED });

    expect(status).toBe(500);
    expect(opLog).toEqual([]);
    expect(mockInsert).not.toHaveBeenCalled();
  });
});
