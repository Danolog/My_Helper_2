/**
 * Zadatek wyłączony (`isDepositEnabled()` = false, rejestr PRAWDZIWY):
 * - `POST /api/clients` z `requireDeposit: true` → 409 `DEPOSITS_DISABLED`, bez INSERT;
 * - `PUT /api/clients/[id]` z `requireDeposit: true` → 409, bez UPDATE;
 * - `requireDeposit: false` i brak pola przechodzą (zadatek da się wyłączyć).
 * Kolejność bramek: sesja (401), salon (404), rola i salon z body (403),
 * format id i walidacja (400) — przed bramką zadatku.
 *
 * Atrapy jak w clients.test.ts: dane salonu przez forSalon (db.transaction → tx),
 * surowy `db` poza transakcją rzuca.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockRequest, createRouteParams, parseResponse, makeClient, TEST_IDS } from "./helpers";

const h = vi.hoisted(() => {
  const select = vi.fn();
  const insert = vi.fn();
  const update = vi.fn();
  const del = vi.fn();
  const tx = {
    select: (...a: unknown[]) => select(...a),
    insert: (...a: unknown[]) => insert(...a),
    update: (...a: unknown[]) => update(...a),
    delete: (...a: unknown[]) => del(...a),
    execute: vi.fn().mockResolvedValue(undefined),
  };
  const rawDbUsed = (method: string) => () => {
    throw new Error(`surowy db.${method} — trasa ma iść przez forSalon`);
  };
  return { select, insert, update, del, tx, rawDbUsed };
});

vi.mock("@/lib/db", () => ({
  db: {
    select: h.rawDbUsed("select"),
    insert: h.rawDbUsed("insert"),
    update: h.rawDbUsed("update"),
    delete: h.rawDbUsed("delete"),
    execute: h.rawDbUsed("execute"),
    transaction: (fn: (tx: typeof h.tx) => unknown) => fn(h.tx),
  },
}));
vi.mock("@/lib/server/system", () => ({ findCredentialPasswordHash: vi.fn() }));
vi.mock("@/lib/server/retention/anonymize-client", () => ({
  lockClientForRemoval: vi.fn(),
  countClientRemovalBlockers: vi.fn(),
  anonymizeClientData: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: vi.fn() } } }));
vi.mock("next/headers", () => ({ headers: vi.fn().mockResolvedValue(new Headers()) }));
vi.mock("better-auth/crypto", () => ({ verifyPassword: vi.fn() }));
vi.mock("@/lib/schema", () => {
  const createTable = (name: string) =>
    new Proxy({}, { get: (_t, prop) => (prop === "_table" ? name : `${name}.${String(prop)}`) });
  return { clients: createTable("clients"), appointments: createTable("appointments"), account: createTable("account") };
});
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: unknown[]) => ({ type: "eq", args })),
  and: vi.fn((...args: unknown[]) => ({ type: "and", args })),
  gte: vi.fn((...args: unknown[]) => ({ type: "gte", args })),
  lte: vi.fn((...args: unknown[]) => ({ type: "lte", args })),
  isNotNull: vi.fn((...args: unknown[]) => ({ type: "isNotNull", args })),
  sql: Object.assign(
    vi.fn((...args: unknown[]) => ({ type: "sql", args, as: vi.fn(() => "sql_column") })),
    { raw: vi.fn((...args: unknown[]) => ({ type: "sql_raw", args })) }
  ),
}));
vi.mock("@/lib/auth-middleware", () => ({
  requireAuth: vi.fn().mockResolvedValue({
    session: { user: { id: "test-user-id", email: "test@test.com", name: "Test User" } },
    user: { id: "test-user-id", email: "test@test.com", name: "Test User" },
  }),
  isAuthError: vi.fn().mockReturnValue(false),
}));
vi.mock("@/lib/salon-context", () => ({
  getSalonContext: vi.fn(),
  hasFeatureAccess: vi.fn(async (ctx: { role: string }) => ctx.role === "owner"),
}));
vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { PUT as updateClient } from "@/app/api/clients/[id]/route";
import { POST as createClient } from "@/app/api/clients/route";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";
import { getSalonContext } from "@/lib/salon-context";

const mockGetSalonContext = vi.mocked(getSalonContext);

const OWNER_CTX = { salonId: TEST_IDS.SALON_UUID, role: "owner" as const, employeeId: null, userId: "user-1" };
const EMPLOYEE_CTX = {
  salonId: TEST_IDS.SALON_UUID,
  role: "employee" as const,
  employeeId: TEST_IDS.EMPLOYEE_UUID,
  userId: "user-emp",
};

const DEPOSITS_DISABLED_BODY = {
  success: false,
  code: "DEPOSITS_DISABLED",
  error: "Zadatki są obecnie wyłączone. Wizyty rezerwuje się bez zadatku.",
};

function chainMock(result: unknown[] = []) {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "from", "where", "limit", "insert", "values", "update", "set", "returning"]) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.then = (resolve: (val: unknown[]) => unknown) => resolve(result);
  return chain;
}

function failingChain(message: string) {
  const chain = chainMock([]);
  chain.then = (_: unknown, reject: (err: Error) => void) => reject(new Error(message));
  return chain;
}

async function mockNoSession() {
  const { NextResponse } = await import("next/server");
  vi.mocked(requireAuth).mockResolvedValueOnce(
    NextResponse.json({ success: false, error: "Wymagane logowanie" }, { status: 401 })
  );
  vi.mocked(isAuthError).mockReturnValueOnce(true);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSalonContext.mockResolvedValue(OWNER_CTX);
});

describe("Zadatek wyłączony — POST /api/clients", () => {
  const BASE = { salonId: TEST_IDS.SALON_UUID, firstName: "Jan", lastName: "Kowalski" };

  function post(body: Record<string, unknown>) {
    return createClient(createMockRequest("http://localhost:3000/api/clients", { method: "POST", body }));
  }

  function valuesArg(chain: Record<string, unknown>) {
    return (chain.values as ReturnType<typeof vi.fn>).mock.calls[0]![0];
  }

  it("requireDeposit: true → 409 DEPOSITS_DISABLED z polskim komunikatem, bez INSERT", async () => {
    const { status, body } = await parseResponse(
      await post({ ...BASE, requireDeposit: true, depositType: "fixed", depositValue: "50.00" })
    );

    expect(status).toBe(409);
    expect(body).toEqual(DEPOSITS_DISABLED_BODY);
    expect(h.insert).not.toHaveBeenCalled();
  });

  it("requireDeposit: false → 201, zapis z false", async () => {
    const chain = chainMock([makeClient()]);
    h.insert.mockReturnValue(chain);

    const { status } = await parseResponse(await post({ ...BASE, requireDeposit: false }));

    expect(status).toBe(201);
    expect(valuesArg(chain).requireDeposit).toBe(false);
  });

  it("brak pola requireDeposit → 201, zapis z false", async () => {
    const chain = chainMock([makeClient()]);
    h.insert.mockReturnValue(chain);

    const { status } = await parseResponse(await post(BASE));

    expect(status).toBe(201);
    expect(valuesArg(chain).requireDeposit).toBe(false);
  });

  it("requireDeposit jako napis \"true\" → 400 walidacji (nie 409), bez INSERT", async () => {
    const { status, body } = await parseResponse(await post({ ...BASE, requireDeposit: "true" }));

    expect(status).toBe(400);
    expect((body as { code?: string }).code).not.toBe("DEPOSITS_DISABLED");
    expect(h.insert).not.toHaveBeenCalled();
  });

  it("bez sesji z requireDeposit: true → 401, bez INSERT", async () => {
    await mockNoSession();

    const { status } = await parseResponse(await post({ ...BASE, requireDeposit: true }));

    expect(status).toBe(401);
    expect(h.insert).not.toHaveBeenCalled();
  });

  it("pracownik (employee) z requireDeposit: true → 403 (rola przed bramką zadatku)", async () => {
    mockGetSalonContext.mockResolvedValue(EMPLOYEE_CTX);

    const { status } = await parseResponse(await post({ ...BASE, requireDeposit: true }));

    expect(status).toBe(403);
    expect(h.insert).not.toHaveBeenCalled();
  });

  it("cudzy salon w body z requireDeposit: true → 403", async () => {
    const { status } = await parseResponse(
      await post({ ...BASE, salonId: "99999999-9999-4999-8999-999999999999", requireDeposit: true })
    );

    expect(status).toBe(403);
    expect(h.insert).not.toHaveBeenCalled();
  });

  it("konto bez salonu z requireDeposit: true → 404", async () => {
    mockGetSalonContext.mockResolvedValue(null);

    const { status } = await parseResponse(await post({ ...BASE, requireDeposit: true }));

    expect(status).toBe(404);
    expect(h.insert).not.toHaveBeenCalled();
  });

  it("requireDeposit: false i błąd bazy → 500", async () => {
    h.insert.mockReturnValue(failingChain("DB insert error"));

    const { status, body } = await parseResponse(await post({ ...BASE, requireDeposit: false }));

    expect(status).toBe(500);
    expect(body.error).toBe("Failed to create client");
  });
});

describe("Zadatek wyłączony — PUT /api/clients/[id]", () => {
  function put(body: Record<string, unknown>, id: string = TEST_IDS.CLIENT_UUID) {
    return updateClient(
      createMockRequest(`http://localhost:3000/api/clients/${id}`, { method: "PUT", body }),
      createRouteParams(id)
    );
  }

  function setArg(chain: Record<string, unknown>) {
    return (chain.set as ReturnType<typeof vi.fn>).mock.calls[0]![0];
  }

  it("requireDeposit: true → 409 DEPOSITS_DISABLED z polskim komunikatem, bez UPDATE", async () => {
    const { status, body } = await parseResponse(
      await put({ requireDeposit: true, depositType: "percentage", depositValue: "30" })
    );

    expect(status).toBe(409);
    expect(body).toEqual(DEPOSITS_DISABLED_BODY);
    expect(h.update).not.toHaveBeenCalled();
  });

  it("requireDeposit: true razem z innymi polami → 409, żadne pole nie jest zapisane", async () => {
    const { status } = await parseResponse(await put({ firstName: "Anna", requireDeposit: true }));

    expect(status).toBe(409);
    expect(h.update).not.toHaveBeenCalled();
  });

  it("requireDeposit: false → 200, wyłączenie zapisane", async () => {
    const chain = chainMock([makeClient({ requireDeposit: false })]);
    h.update.mockReturnValue(chain);

    const { status, body } = await parseResponse(await put({ requireDeposit: false }));

    expect(status).toBe(200);
    expect((body as { data: { requireDeposit: boolean } }).data.requireDeposit).toBe(false);
    expect(setArg(chain).requireDeposit).toBe(false);
  });

  it("brak pola requireDeposit → 200, pole nie trafia do UPDATE", async () => {
    const chain = chainMock([makeClient({ firstName: "Ewa" })]);
    h.update.mockReturnValue(chain);

    const { status } = await parseResponse(await put({ firstName: "Ewa", depositValue: "20" }));

    expect(status).toBe(200);
    expect(setArg(chain)).not.toHaveProperty("requireDeposit");
  });

  it("requireDeposit jako napis \"true\" → 400 walidacji (nie 409), bez UPDATE", async () => {
    const { status, body } = await parseResponse(await put({ requireDeposit: "true" }));

    expect(status).toBe(400);
    expect((body as { code?: string }).code).not.toBe("DEPOSITS_DISABLED");
    expect(h.update).not.toHaveBeenCalled();
  });

  it("zły UUID z requireDeposit: true → 400 (format sprawdzany pierwszy)", async () => {
    const { status } = await parseResponse(await put({ requireDeposit: true }, "bad-id"));

    expect(status).toBe(400);
    expect(h.update).not.toHaveBeenCalled();
  });

  it("bez sesji z requireDeposit: true → 401, bez UPDATE", async () => {
    await mockNoSession();

    const { status } = await parseResponse(await put({ requireDeposit: true }));

    expect(status).toBe(401);
    expect(h.update).not.toHaveBeenCalled();
  });

  it("pracownik (employee) z requireDeposit: true → 403 (rola przed bramką zadatku)", async () => {
    mockGetSalonContext.mockResolvedValue(EMPLOYEE_CTX);

    const { status } = await parseResponse(await put({ requireDeposit: true }));

    expect(status).toBe(403);
    expect(h.update).not.toHaveBeenCalled();
  });

  it("konto bez salonu z requireDeposit: true → 404", async () => {
    mockGetSalonContext.mockResolvedValue(null);

    const { status } = await parseResponse(await put({ requireDeposit: true }));

    expect(status).toBe(404);
    expect(h.update).not.toHaveBeenCalled();
  });

  it("requireDeposit: false dla cudzego/nieistniejącego klienta → 404", async () => {
    h.update.mockReturnValue(chainMock([]));

    const { status } = await parseResponse(await put({ requireDeposit: false }));

    expect(status).toBe(404);
  });

  it("requireDeposit: false i błąd bazy → 500", async () => {
    h.update.mockReturnValue(failingChain("DB error"));

    const { status, body } = await parseResponse(await put({ requireDeposit: false }));

    expect(status).toBe(500);
    expect(body.error).toBe("Failed to update client");
  });
});
