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
const PLAN_PRO = { id: crypto.randomUUID(), slug: "pro", name: "Pro" };

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

vi.mock("@/lib/db", () => ({
  db: {
    select: () => chain(() => []),
    update: (...args: unknown[]) => {
      mockUpdate(...args);
      return chain(() => []);
    },
    insert: (table: { _table?: string }) => {
      mockInsert(table._table);
      return chain(() =>
        table._table === "salons"
          ? [{ id: SALON_A }]
          : [{ id: crypto.randomUUID(), status: "trialing", trialEndsAt: new Date() }]
      );
    },
  },
}));

vi.mock("@/lib/schema", () => {
  const table = (name: string) =>
    new Proxy({}, { get: (_t, col) => (col === "_table" ? name : `${name}.${String(col)}`) });
  return {
    subscriptionPlans: table("subscriptionPlans"),
    salonSubscriptions: table("salonSubscriptions"),
    salons: table("salons"),
    user: table("user"),
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
  mockRequireAuth.mockResolvedValue({ session: { user: USER_A }, user: USER_A });
});

describe("POST /api/register-subscription — konto tylko z sesji", () => {
  it("(a) konto A z e-mailem B w body nie dotyka salonu ani subskrypcji B", async () => {
    // Baza: konto B ma salon z aktywną subskrypcją Basic.
    tableRows = {
      subscriptionPlans: [PLAN_PRO],
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

    await post({ planSlug: "pro", email: EMAIL_B });

    expect(selectedTables).not.toContain("user");
    expect(mockEq).not.toHaveBeenCalledWith("user.email", EMAIL_B);
    expect(mockEq).toHaveBeenCalledWith("salons.ownerId", USER_A.id);
    expect(mockEq).not.toHaveBeenCalledWith("salons.ownerId", "user-b");
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("(b) konto A nie przestawia własnej subskrypcji na Pro bez płatności — 409, bez zapisu", async () => {
    tableRows = {
      subscriptionPlans: [PLAN_PRO],
      user: [{ id: USER_A.id, email: USER_A.email, name: USER_A.name }],
      salons: [{ id: SALON_A, ownerId: USER_A.id }],
      salonSubscriptions: [{ id: crypto.randomUUID(), salonId: SALON_A, status: "active", planId: "basic" }],
    };

    const { status, body } = await post({ planSlug: "pro", email: USER_A.email });

    expect(status).toBe(409);
    expect(body.success).toBe(false);
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("(c) odpowiedź nie zdradza, czy konto o e-mailu z body istnieje", async () => {
    // A bez salonu. Main: e-mail nieistniejący => 404 "User not found",
    // e-mail istniejący => 200 — różnica zdradza istnienie konta.
    tableRows = { subscriptionPlans: [PLAN_PRO], user: [], salons: [], salonSubscriptions: [] };
    const r1 = await post({ planSlug: "pro", email: "nie-istnieje@example.com" });

    tableRows = {
      subscriptionPlans: [PLAN_PRO],
      user: [{ id: "user-b", email: EMAIL_B, name: "Bartek" }],
      salons: [],
      salonSubscriptions: [],
    };
    const r2 = await post({ planSlug: "pro", email: EMAIL_B });

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(r1.status);
    expect(JSON.stringify(r1.body)).not.toContain("User not found");
    expect(selectedTables).not.toContain("user");
  });

  it("konto bez salonu: tworzy salon dla konta z sesji i subskrypcję trialing", async () => {
    tableRows = { subscriptionPlans: [PLAN_PRO], user: [{ id: USER_A.id, email: USER_A.email, name: USER_A.name }] };

    const { status, body } = await post({ planSlug: "pro", email: USER_A.email });

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(mockInsert).toHaveBeenNthCalledWith(1, "salons");
    expect(mockInsertValues).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ ownerId: USER_A.id, email: USER_A.email })
    );
    expect(mockInsertValues).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ salonId: SALON_A, planId: PLAN_PRO.id, status: "trialing" })
    );
  });

  it("body bez e-maila jest poprawne (e-mail nie jest już częścią kontraktu)", async () => {
    tableRows = { subscriptionPlans: [PLAN_PRO] };
    const { status } = await post({ planSlug: "pro" });
    expect(status).toBe(200);
  });

  it("nieznany plan => 404", async () => {
    const { status } = await post({ planSlug: "gold" });
    expect(status).toBe(404);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("brak sesji => 401", async () => {
    mockRequireAuth.mockResolvedValue(
      NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
    );
    const { status } = await post({ planSlug: "pro" });
    expect(status).toBe(401);
  });
});
