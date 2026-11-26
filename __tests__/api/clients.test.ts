/**
 * Integration tests for /api/clients endpoints.
 *
 * Tests cover:
 * - GET /api/clients (list with filtering)
 * - POST /api/clients (create with validation)
 * - GET /api/clients/[id] (single client)
 * - PUT /api/clients/[id] (update)
 * - DELETE /api/clients/[id] (delete with password verification)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createMockRequest,
  createRouteParams,
  parseResponse,
  makeClient,
  TEST_IDS,
} from "./helpers";

// -------------------------------------------------------
// Mocks
// -------------------------------------------------------

const mockDbSelect = vi.fn();
const mockDbInsert = vi.fn();
const mockDbUpdate = vi.fn();
const mockDbDelete = vi.fn();

// `tx` w transakcji deleguje do tych samych mocków co `db` — warstwa repo
// (forSalon) otwiera db.transaction() i woła tx.select/update/delete. Dzięki
// temu istniejące asercje na mockDbSelect/Update/Delete dalej działają po
// migracji tras na repozytorium (ADR-001 R1).
const mockTx = {
  select: (...args: unknown[]) => mockDbSelect(...args),
  insert: (...args: unknown[]) => mockDbInsert(...args),
  update: (...args: unknown[]) => mockDbUpdate(...args),
  delete: (...args: unknown[]) => mockDbDelete(...args),
  execute: vi.fn().mockResolvedValue(undefined), // SET LOCAL app.current_salon_id
};

// #193: trasy /api/clients i /api/clients/[id] nie biorą surowego `db` —
// dane salonu idą przez forSalon (db.transaction → tx), hash hasła przez
// wyjście systemowe. Każde zapytanie na surowym `db` poza transakcją rzuca.
// (vi.hoisted: fabryka niżej woła rawDbUsed w chwili wywołania.)
const { rawDbUsed } = vi.hoisted(() => ({
  rawDbUsed: (method: string) => () => {
    throw new Error(`surowy db.${method} w teście clients — trasa ma iść przez forSalon albo @/lib/server/system`);
  },
}));
vi.mock("@/lib/db", () => ({
  db: {
    select: rawDbUsed("select"),
    insert: rawDbUsed("insert"),
    update: rawDbUsed("update"),
    delete: rawDbUsed("delete"),
    execute: rawDbUsed("execute"),
    transaction: (fn: (tx: typeof mockTx) => unknown) => fn(mockTx),
  },
}));

// #193: hash hasła konta `credential` — wyjście systemowe (nie surowy db).
const systemMocks = vi.hoisted(() => ({ findCredentialPasswordHash: vi.fn() }));
vi.mock("@/lib/server/system", () => ({
  findCredentialPasswordHash: (...args: unknown[]) => systemMocks.findCredentialPasswordHash(...args),
}));
const mockFindCredentialPasswordHash = systemMocks.findCredentialPasswordHash;

// Usunięcie klienta: blokady, liczenie zobowiązań i anonimizacja w transakcji.
// Zachowanie na danych sprawdzają testy pg; tu kolejność i odpowiedzi trasy.
const retentionMocks = vi.hoisted(() => ({
  lockClientForRemoval: vi.fn(),
  countClientRemovalBlockers: vi.fn(),
  anonymizeClientData: vi.fn(),
}));
vi.mock("@/lib/server/retention/anonymize-client", () => ({
  lockClientForRemoval: (...args: unknown[]) => retentionMocks.lockClientForRemoval(...args),
  countClientRemovalBlockers: (...args: unknown[]) => retentionMocks.countClientRemovalBlockers(...args),
  anonymizeClientData: (...args: unknown[]) => retentionMocks.anonymizeClientData(...args),
}));

// Mock session for DELETE endpoint
const mockGetSession = vi.fn();
vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: (...args: unknown[]) => mockGetSession(...args),
    },
  },
}));

vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue(new Headers()),
}));

// Mock better-auth/crypto for password verification in DELETE
const mockVerifyPassword = vi.fn();
vi.mock("better-auth/crypto", () => ({
  verifyPassword: (...args: unknown[]) => mockVerifyPassword(...args),
}));

vi.mock("@/lib/schema", () => {
  const createTable = (name: string) => {
    const proxy = new Proxy({}, {
      get: (_target, prop) => {
        if (prop === "_table") return name;
        return `${name}.${String(prop)}`;
      },
    });
    return proxy;
  };
  return {
    clients: createTable("clients"),
    appointments: createTable("appointments"),
    account: createTable("account"),
  };
});

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: unknown[]) => ({ type: "eq", args })),
  and: vi.fn((...args: unknown[]) => ({ type: "and", args })),
  gte: vi.fn((...args: unknown[]) => ({ type: "gte", args })),
  lte: vi.fn((...args: unknown[]) => ({ type: "lte", args })),
  isNotNull: vi.fn((...args: unknown[]) => ({ type: "isNotNull", args })),
  // sql is a tagged template literal function that returns an object with .as() method
  sql: Object.assign(
    vi.fn((...args: unknown[]) => ({
      type: "sql",
      args,
      as: vi.fn(() => "sql_column"),
    })),
    {
      // Support sql`template` tagged template usage
      raw: vi.fn((...args: unknown[]) => ({ type: "sql_raw", args })),
    }
  ),
}));

vi.mock("@/lib/validations", () => ({
  isValidUuid: vi.fn((id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)),
}));

vi.mock("@/lib/auth-middleware", () => ({
  requireAuth: vi.fn().mockResolvedValue({
    session: { user: { id: "test-user-id", email: "test@test.com", name: "Test User" } },
    user: { id: "test-user-id", email: "test@test.com", name: "Test User" },
  }),
  isAuthError: vi.fn().mockReturnValue(false),
}));

// Tenant isolation (P0-A): scoped routes resolve the salon from the session.
vi.mock("@/lib/get-user-salon", () => ({
  getUserSalonId: vi.fn().mockResolvedValue(TEST_IDS.SALON_UUID),
  getUserSalon: vi.fn().mockResolvedValue({ id: TEST_IDS.SALON_UUID }),
}));

// Faza 3 (role): trasy klientów przeszły na getSalonContext. Domyślnie
// właściciel — scenariusze właścicielskie przechodzą bez zmian.
vi.mock("@/lib/salon-context", () => ({
  getSalonContext: vi.fn().mockResolvedValue({
    salonId: TEST_IDS.SALON_UUID,
    role: "owner",
    employeeId: null,
    userId: "user-1",
  }),
  hasFeatureAccess: vi.fn(async (ctx: { role: string }) => ctx.role === "owner"),
}));

// -------------------------------------------------------
// Chain builder helper
// -------------------------------------------------------

function chainMock(result: unknown[] = []) {
  const chain: Record<string, unknown> = {};
  const methods = [
    "select", "from", "where", "leftJoin", "innerJoin",
    "limit", "orderBy", "groupBy",
    "insert", "values", "update", "set", "delete",
    "returning", "execute",
  ];
  for (const method of methods) {
    chain[method] = vi.fn().mockReturnValue(chain);
  }
  // `.as()` returns a subquery-like object that has column properties
  // needed by the clients GET handler (lastVisitSubquery.lastVisit, .clientId)
  chain.as = vi.fn().mockImplementation(() => {
    const subquery: Record<string, unknown> = {};
    // Return a proxy that provides any accessed property as a string column ref
    return new Proxy(subquery, {
      get: (_target, prop) => {
        if (typeof prop === "string") return `subquery.${prop}`;
        return undefined;
      },
    });
  });
  chain.then = (resolve: (val: unknown[]) => unknown) => resolve(result);
  return chain;
}

// -------------------------------------------------------
// Import route handlers
// -------------------------------------------------------

import {
  GET as getClient,
  PUT as updateClient,
  DELETE as deleteClient,
} from "@/app/api/clients/[id]/route";
import { GET as listClients, POST as createClient } from "@/app/api/clients/route";

// Mocked tenant resolver — flip it to simulate "no salon" / wrong tenant.
import { getSalonContext } from "@/lib/salon-context";
const mockGetSalonContext = vi.mocked(getSalonContext);

// Konteksty ról (Faza 3) — owner odtwarza dawne zachowanie getUserSalonId.
const OWNER_CTX = {
  salonId: TEST_IDS.SALON_UUID,
  role: "owner" as const,
  employeeId: null,
  userId: "user-1",
};
const EMPLOYEE_CTX = {
  salonId: TEST_IDS.SALON_UUID,
  role: "employee" as const,
  employeeId: TEST_IDS.EMPLOYEE_UUID,
  userId: "user-emp",
};

// -------------------------------------------------------
// Tests
// -------------------------------------------------------

describe("GET /api/clients", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return 200 with clients list", async () => {
    const client = makeClient();

    // First db.select() call: subquery for lastVisit
    const subqueryChain = chainMock([]);
    // Second db.select() call: main query with results
    const mainChain = chainMock([{ client, lastVisit: null }]);

    mockDbSelect
      .mockReturnValueOnce(subqueryChain)
      .mockReturnValueOnce(mainChain);

    const request = createMockRequest(
      `http://localhost:3000/api/clients?salonId=${TEST_IDS.SALON_UUID}`
    );
    const response = await listClients(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(1);
    expect(body.count).toBe(1);
    expect((body as any).data[0].firstName).toBe("Jan");
  });

  it("should return 200 with empty list when no clients found", async () => {
    // First db.select() call: subquery
    const subqueryChain = chainMock([]);
    // Second db.select() call: main query
    const mainChain = chainMock([]);

    mockDbSelect
      .mockReturnValueOnce(subqueryChain)
      .mockReturnValueOnce(mainChain);

    const request = createMockRequest("http://localhost:3000/api/clients");
    const response = await listClients(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(0);
  });

  it("should return 500 when database throws", async () => {
    // Subquery succeeds
    const subqueryChain = chainMock([]);
    mockDbSelect.mockReturnValueOnce(subqueryChain);

    // Main query throws
    const errorChain: Record<string, unknown> = {};
    const methods = ["select", "from", "where", "leftJoin", "limit", "orderBy", "groupBy"];
    for (const m of methods) {
      (errorChain as Record<string, ReturnType<typeof vi.fn>>)[m] = vi.fn().mockReturnValue(errorChain);
    }
    errorChain.as = vi.fn().mockReturnValue(new Proxy({}, {
      get: (_target, prop) => typeof prop === "string" ? `subquery.${prop}` : undefined,
    }));
    errorChain.then = (_: unknown, reject: (err: Error) => void) => reject(new Error("DB error"));
    mockDbSelect.mockReturnValueOnce(errorChain);

    const request = createMockRequest("http://localhost:3000/api/clients");
    const response = await listClients(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(500);
    expect(body.success).toBe(false);
    expect(body.error).toContain("Failed to fetch clients");
  });
});

describe("POST /api/clients", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return 201 when creating a valid client", async () => {
    const newClient = makeClient();
    mockDbInsert.mockReturnValue(chainMock([newClient]));

    const request = createMockRequest("http://localhost:3000/api/clients", {
      method: "POST",
      body: {
        salonId: TEST_IDS.SALON_UUID,
        firstName: "Jan",
        lastName: "Kowalski",
        phone: "+48123456789",
        email: "jan@example.com",
      },
    });

    const response = await createClient(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.data).toBeDefined();
  });

  // UAT X-1: owner nie moze utworzyc klienta w cudzym salonie
  it("should return 403 when an owner passes a different salonId (cross-tenant)", async () => {
    mockGetSalonContext.mockResolvedValue(OWNER_CTX); // owner of SALON_UUID
    const request = createMockRequest("http://localhost:3000/api/clients", {
      method: "POST",
      body: {
        salonId: "99999999-9999-4999-8999-999999999999", // inny salon
        firstName: "Intruz",
        lastName: "Test",
      },
    });

    const response = await createClient(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(403);
    expect(body.success).toBe(false);
    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  it("should return 400 when required fields are missing", async () => {
    const request = createMockRequest("http://localhost:3000/api/clients", {
      method: "POST",
      body: {
        // Missing salonId, firstName, lastName
      },
    });

    const response = await createClient(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toBe("Validation failed");
    expect(body.details).toBeDefined();
  });

  it("should return 400 for invalid email format", async () => {
    const request = createMockRequest("http://localhost:3000/api/clients", {
      method: "POST",
      body: {
        salonId: TEST_IDS.SALON_UUID,
        firstName: "Jan",
        lastName: "Kowalski",
        email: "invalid-email",
      },
    });

    const response = await createClient(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(400);
    expect(body.success).toBe(false);
  });

  it("should return 400 for invalid phone format", async () => {
    const request = createMockRequest("http://localhost:3000/api/clients", {
      method: "POST",
      body: {
        salonId: TEST_IDS.SALON_UUID,
        firstName: "Jan",
        lastName: "Kowalski",
        phone: "abc",
      },
    });

    const response = await createClient(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(400);
    expect(body.success).toBe(false);
  });

  it("should return 500 when database throws on insert", async () => {
    const errorChain: Record<string, unknown> = {};
    const methods = ["insert", "values", "returning"];
    for (const m of methods) {
      (errorChain as Record<string, ReturnType<typeof vi.fn>>)[m] = vi.fn().mockReturnValue(errorChain);
    }
    errorChain.then = (_: unknown, reject: (err: Error) => void) => reject(new Error("DB insert error"));
    mockDbInsert.mockReturnValue(errorChain);

    const request = createMockRequest("http://localhost:3000/api/clients", {
      method: "POST",
      body: {
        salonId: TEST_IDS.SALON_UUID,
        firstName: "Jan",
        lastName: "Kowalski",
      },
    });

    const response = await createClient(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(500);
    expect(body.success).toBe(false);
  });
});

describe("GET /api/clients/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return 200 with client details", async () => {
    const client = makeClient();
    mockDbSelect.mockReturnValue(chainMock([client]));

    const request = createMockRequest(`http://localhost:3000/api/clients/${TEST_IDS.CLIENT_UUID}`);
    const params = createRouteParams(TEST_IDS.CLIENT_UUID);
    const response = await getClient(request, params);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect((body as any).data.id).toBe(TEST_IDS.CLIENT_UUID);
    expect((body as any).data.firstName).toBe("Jan");
  });

  it("should return 400 for invalid UUID format", async () => {
    const request = createMockRequest("http://localhost:3000/api/clients/bad-id");
    const params = createRouteParams("bad-id");
    const response = await getClient(request, params);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toContain("Invalid client ID format");
  });

  it("should return 404 when client not found", async () => {
    mockDbSelect.mockReturnValue(chainMock([]));

    const request = createMockRequest(`http://localhost:3000/api/clients/${TEST_IDS.CLIENT_UUID}`);
    const params = createRouteParams(TEST_IDS.CLIENT_UUID);
    const response = await getClient(request, params);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(404);
    expect(body.success).toBe(false);
    expect(body.error).toContain("not found");
  });

  it("should return 500 when database throws", async () => {
    const errorChain: Record<string, unknown> = {};
    const methods = ["select", "from", "where", "limit"];
    for (const m of methods) {
      (errorChain as Record<string, ReturnType<typeof vi.fn>>)[m] = vi.fn().mockReturnValue(errorChain);
    }
    errorChain.then = (_: unknown, reject: (err: Error) => void) => reject(new Error("DB error"));
    mockDbSelect.mockReturnValue(errorChain);

    const request = createMockRequest(`http://localhost:3000/api/clients/${TEST_IDS.CLIENT_UUID}`);
    const params = createRouteParams(TEST_IDS.CLIENT_UUID);
    const response = await getClient(request, params);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(500);
    expect(body.success).toBe(false);
    expect(body.error).toContain("Failed to fetch client");
  });
});

describe("PUT /api/clients/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return 200 when updating a client", async () => {
    const updated = makeClient({ firstName: "Updated" });
    mockDbUpdate.mockReturnValue(chainMock([updated]));

    const request = createMockRequest(`http://localhost:3000/api/clients/${TEST_IDS.CLIENT_UUID}`, {
      method: "PUT",
      body: { firstName: "Updated" },
    });
    const params = createRouteParams(TEST_IDS.CLIENT_UUID);
    const response = await updateClient(request, params);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect((body as any).data.firstName).toBe("Updated");
  });

  it("should return 400 for invalid UUID format", async () => {
    const request = createMockRequest("http://localhost:3000/api/clients/bad-id", {
      method: "PUT",
      body: { firstName: "X" },
    });
    const params = createRouteParams("bad-id");
    const response = await updateClient(request, params);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(400);
    expect(body.success).toBe(false);
  });

  it("should return 404 when client not found for update", async () => {
    mockDbUpdate.mockReturnValue(chainMock([]));

    const request = createMockRequest(`http://localhost:3000/api/clients/${TEST_IDS.CLIENT_UUID}`, {
      method: "PUT",
      body: { firstName: "X" },
    });
    const params = createRouteParams(TEST_IDS.CLIENT_UUID);
    const response = await updateClient(request, params);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(404);
    expect(body.success).toBe(false);
  });

  it("should return 200 when updating with all fields", async () => {
    const employeeUuid = TEST_IDS.EMPLOYEE_UUID;
    const updated = makeClient({
      firstName: "Janina",
      lastName: "Nowak",
      phone: "+48999888777",
      email: "janina@example.com",
      notes: "VIP client",
      preferences: "Morning appointments",
      allergies: "Latex",
      favoriteEmployeeId: employeeUuid,
      requireDeposit: false,
      depositType: "fixed",
      depositValue: "50.00",
    });
    mockDbUpdate.mockReturnValue(chainMock([updated]));

    const request = createMockRequest(`http://localhost:3000/api/clients/${TEST_IDS.CLIENT_UUID}`, {
      method: "PUT",
      body: {
        firstName: "Janina",
        lastName: "Nowak",
        phone: "+48999888777",
        email: "janina@example.com",
        notes: "VIP client",
        preferences: "Morning appointments",
        allergies: "Latex",
        healthDataConsent: true,
        favoriteEmployeeId: employeeUuid,
        requireDeposit: false,
        depositType: "fixed",
        depositValue: "50.00",
      },
    });
    const params = createRouteParams(TEST_IDS.CLIENT_UUID);
    const response = await updateClient(request, params);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect((body as any).data.firstName).toBe("Janina");
    expect((body as any).data.lastName).toBe("Nowak");
    expect((body as any).data.phone).toBe("+48999888777");
    expect((body as any).data.email).toBe("janina@example.com");
    expect((body as any).data.notes).toBe("VIP client");
    expect((body as any).data.preferences).toBe("Morning appointments");
    expect((body as any).data.allergies).toBe("Latex");
    expect((body as any).data.favoriteEmployeeId).toBe(employeeUuid);
    expect((body as any).data.requireDeposit).toBe(false);
    expect((body as any).data.depositType).toBe("fixed");
    expect((body as any).data.depositValue).toBe("50.00");
  });

  it("should return 500 when database throws on update", async () => {
    const errorChain: Record<string, unknown> = {};
    const methods = ["update", "set", "where", "returning"];
    for (const m of methods) {
      (errorChain as Record<string, ReturnType<typeof vi.fn>>)[m] = vi.fn().mockReturnValue(errorChain);
    }
    errorChain.then = (_: unknown, reject: (err: Error) => void) => reject(new Error("DB update error"));
    mockDbUpdate.mockReturnValue(errorChain);

    const request = createMockRequest(`http://localhost:3000/api/clients/${TEST_IDS.CLIENT_UUID}`, {
      method: "PUT",
      body: { firstName: "X" },
    });
    const params = createRouteParams(TEST_IDS.CLIENT_UUID);
    const response = await updateClient(request, params);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(500);
    expect(body.success).toBe(false);
    expect(body.error).toContain("Failed to update client");
  });
});

describe("DELETE /api/clients/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    retentionMocks.lockClientForRemoval.mockResolvedValue(true);
    retentionMocks.countClientRemovalBlockers.mockResolvedValue({ futureAppointments: 0, depositsToRefund: 0 });
    retentionMocks.anonymizeClientData.mockResolvedValue({});
  });

  it("should return 401 when not authenticated", async () => {
    mockGetSession.mockResolvedValue(null);

    const request = createMockRequest(`http://localhost:3000/api/clients/${TEST_IDS.CLIENT_UUID}`, {
      method: "DELETE",
      body: { password: "testpassword" },
    });
    const params = createRouteParams(TEST_IDS.CLIENT_UUID);
    const response = await deleteClient(request, params);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(401);
    expect(body.success).toBe(false);
  });

  it("should return 400 when password is missing", async () => {
    mockGetSession.mockResolvedValue({
      user: { id: "user-1", email: "owner@test.com" },
    });

    // ADR-001 2.4: brama "zasób mój?" (findOne) wykonuje się PRZED kontrolą
    // hasła — musi zwrócić własnego klienta, by dojść do gate 400 brak hasła.
    mockDbSelect.mockReturnValue(chainMock([makeClient()]));

    const request = createMockRequest(`http://localhost:3000/api/clients/${TEST_IDS.CLIENT_UUID}`, {
      method: "DELETE",
      body: {},
    });
    const params = createRouteParams(TEST_IDS.CLIENT_UUID);
    const response = await deleteClient(request, params);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toContain("Haslo");
  });

  it("should return 400 for invalid UUID format", async () => {
    const request = createMockRequest("http://localhost:3000/api/clients/bad-id", {
      method: "DELETE",
      body: { password: "test" },
    });
    const params = createRouteParams("bad-id");
    const response = await deleteClient(request, params);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(400);
    expect(body.success).toBe(false);
  });

  it("should return 403 when password is incorrect", async () => {
    mockGetSession.mockResolvedValue({
      user: { id: "user-1", email: "owner@test.com" },
    });

    // findOne (forSalon, tx): własny klient; hash z wyjścia systemowego.
    mockDbSelect.mockReturnValue(chainMock([makeClient()]));
    mockFindCredentialPasswordHash.mockResolvedValue("hashed-password");

    mockVerifyPassword.mockResolvedValue(false);

    const request = createMockRequest(`http://localhost:3000/api/clients/${TEST_IDS.CLIENT_UUID}`, {
      method: "DELETE",
      body: { password: "wrong-password" },
    });
    const params = createRouteParams(TEST_IDS.CLIENT_UUID);
    const response = await deleteClient(request, params);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(403);
    expect(body.success).toBe(false);
    expect(body.error).toContain("Nieprawidlowe haslo");
  });

  it("should return 200 when password is correct and client is deleted", async () => {
    mockGetSession.mockResolvedValue({
      user: { id: "user-1", email: "owner@test.com" },
    });

    mockDbSelect.mockReturnValue(chainMock([makeClient()]));
    mockFindCredentialPasswordHash.mockResolvedValue("hashed-password");

    mockVerifyPassword.mockResolvedValue(true);

    const deletedClient = makeClient();
    mockDbDelete.mockReturnValue(chainMock([deletedClient]));

    const request = createMockRequest(`http://localhost:3000/api/clients/${TEST_IDS.CLIENT_UUID}`, {
      method: "DELETE",
      body: { password: "correct-password" },
    });
    const params = createRouteParams(TEST_IDS.CLIENT_UUID);
    const response = await deleteClient(request, params);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect((body as any).data.id).toBe(TEST_IDS.CLIENT_UUID);
    // Hash z wyjścia systemowego dla użytkownika z sesji, porównany z hasłem z body.
    expect(mockFindCredentialPasswordHash).toHaveBeenCalledTimes(1);
    expect(mockFindCredentialPasswordHash).toHaveBeenCalledWith("user-1");
    expect(mockVerifyPassword).toHaveBeenCalledWith({ hash: "hashed-password", password: "correct-password" });
    expect(mockDbDelete).toHaveBeenCalledTimes(1);
  });

  it("should return 404 when client not found after password verification", async () => {
    mockGetSession.mockResolvedValue({
      user: { id: "user-1", email: "owner@test.com" },
    });

    mockDbSelect.mockReturnValue(chainMock([makeClient()]));
    mockFindCredentialPasswordHash.mockResolvedValue("hashed-password");

    mockVerifyPassword.mockResolvedValue(true);
    mockDbDelete.mockReturnValue(chainMock([]));

    const request = createMockRequest(`http://localhost:3000/api/clients/${TEST_IDS.CLIENT_UUID}`, {
      method: "DELETE",
      body: { password: "correct-password" },
    });
    const params = createRouteParams(TEST_IDS.CLIENT_UUID);
    const response = await deleteClient(request, params);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(404);
    expect(body.success).toBe(false);
    expect(body.error).toContain("not found");
  });

  it("should return 400 when request body is malformed (json parse fails)", async () => {
    mockGetSession.mockResolvedValue({
      user: { id: "user-1", email: "owner@test.com" },
    });

    // Create a request with invalid JSON body so request.json() throws.
    // The handler catches this and falls through with body = {}, so password
    // is undefined and it returns 400 "Haslo jest wymagane".
    const request = new Request(
      `http://localhost:3000/api/clients/${TEST_IDS.CLIENT_UUID}`,
      {
        method: "DELETE",
        body: "this is not valid json",
        headers: { "Content-Type": "application/json" },
      }
    );
    const params = createRouteParams(TEST_IDS.CLIENT_UUID);
    const response = await deleteClient(request, params);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toContain("Haslo");
  });

  it("should return 400 when account has no password hash (OAuth-only)", async () => {
    mockGetSession.mockResolvedValue({
      user: { id: "user-1", email: "owner@test.com" },
    });

    // Brak konta `credential` albo konto bez hasła (tylko OAuth): wyjście systemowe zwraca null.
    mockDbSelect.mockReturnValue(chainMock([makeClient()]));
    mockFindCredentialPasswordHash.mockResolvedValue(null);

    const request = createMockRequest(`http://localhost:3000/api/clients/${TEST_IDS.CLIENT_UUID}`, {
      method: "DELETE",
      body: { password: "some-password" },
    });
    const params = createRouteParams(TEST_IDS.CLIENT_UUID);
    const response = await deleteClient(request, params);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toBe("Nie mozna zweryfikowac hasla - brak konta z haslem");
    expect(mockFindCredentialPasswordHash).toHaveBeenCalledWith("user-1");
    expect(mockVerifyPassword).not.toHaveBeenCalled();
    expect(mockDbDelete).not.toHaveBeenCalled();
  });

  it("#193: cudzy klient → 404 PRZED sprawdzeniem hasła (bez odczytu hasha i bez usunięcia)", async () => {
    mockGetSession.mockResolvedValue({
      user: { id: "user-1", email: "owner@test.com" },
    });
    // forSalon(salon z sesji).findOne: klient innego salonu niewidoczny.
    mockDbSelect.mockReturnValue(chainMock([]));
    mockFindCredentialPasswordHash.mockResolvedValue("hashed-password");
    mockVerifyPassword.mockResolvedValue(true);

    const request = createMockRequest(`http://localhost:3000/api/clients/${TEST_IDS.CLIENT_UUID}`, {
      method: "DELETE",
      body: { password: "correct-password" },
    });
    const response = await deleteClient(request, createRouteParams(TEST_IDS.CLIENT_UUID));
    const { status, body } = await parseResponse(response);

    expect(status).toBe(404);
    expect(body.error).toBe("Client not found");
    expect(mockFindCredentialPasswordHash).not.toHaveBeenCalled();
    expect(mockVerifyPassword).not.toHaveBeenCalled();
    expect(mockDbDelete).not.toHaveBeenCalled();
  });

  it("#193: błąd odczytu hasha → 500, bez usunięcia", async () => {
    mockGetSession.mockResolvedValue({
      user: { id: "user-1", email: "owner@test.com" },
    });
    mockDbSelect.mockReturnValue(chainMock([makeClient()]));
    mockFindCredentialPasswordHash.mockRejectedValue(new Error("DB error"));

    const request = createMockRequest(`http://localhost:3000/api/clients/${TEST_IDS.CLIENT_UUID}`, {
      method: "DELETE",
      body: { password: "correct-password" },
    });
    const response = await deleteClient(request, createRouteParams(TEST_IDS.CLIENT_UUID));
    const { status, body } = await parseResponse(response);

    expect(status).toBe(500);
    expect(body.error).toBe("Failed to delete client");
    expect(mockVerifyPassword).not.toHaveBeenCalled();
    expect(mockDbDelete).not.toHaveBeenCalled();
  });

  it("#193: atrapa surowego db rzuca — DELETE idzie wyłącznie przez forSalon i wyjście systemowe", async () => {
    const { db } = await import("@/lib/db");
    expect(() => db.select()).toThrow(/surowy db\.select/);

    mockGetSession.mockResolvedValue({
      user: { id: "user-1", email: "owner@test.com" },
    });
    mockDbSelect.mockReturnValue(chainMock([makeClient()]));
    mockFindCredentialPasswordHash.mockResolvedValue("hashed-password");
    mockVerifyPassword.mockResolvedValue(true);
    mockDbDelete.mockReturnValue(chainMock([makeClient()]));

    const request = createMockRequest(`http://localhost:3000/api/clients/${TEST_IDS.CLIENT_UUID}`, {
      method: "DELETE",
      body: { password: "correct-password" },
    });
    const response = await deleteClient(request, createRouteParams(TEST_IDS.CLIENT_UUID));
    expect((await parseResponse(response)).status).toBe(200);
    // Jedno zapytanie select (findOne w transakcji) — hash nie idzie przez db.select.
    expect(mockDbSelect).toHaveBeenCalledTimes(1);
  });

  describe("anonimizacja i zobowiązania klienta", () => {
    const deleteWithPassword = () =>
      deleteClient(
        createMockRequest(`http://localhost:3000/api/clients/${TEST_IDS.CLIENT_UUID}`, {
          method: "DELETE",
          body: { password: "correct-password" },
        }),
        createRouteParams(TEST_IDS.CLIENT_UUID)
      );

    beforeEach(() => {
      mockGetSession.mockResolvedValue({ user: { id: "user-1", email: "owner@test.com" } });
      mockDbSelect.mockReturnValue(chainMock([makeClient()]));
      mockFindCredentialPasswordHash.mockResolvedValue("hashed-password");
      mockVerifyPassword.mockResolvedValue(true);
      mockDbDelete.mockReturnValue(chainMock([makeClient()]));
    });

    /** Błąd jak z postgres-js: `code` na samym błędzie. */
    const pgError = (code: string) => Object.assign(new Error("db"), { code });
    /** Błąd opakowany przez Drizzle: kod tylko w `cause`. */
    const wrappedPgError = (code: string) => new Error("Failed query", { cause: pgError(code) });

    it("200: w jednej transakcji blokady → liczenie → anonimizacja → DELETE, z salonem z sesji", async () => {
      const order: string[] = [];
      retentionMocks.lockClientForRemoval.mockImplementation(async () => {
        order.push("lock");
        return true;
      });
      retentionMocks.countClientRemovalBlockers.mockImplementation(async () => {
        order.push("count");
        return { futureAppointments: 0, depositsToRefund: 0 };
      });
      retentionMocks.anonymizeClientData.mockImplementation(async () => {
        order.push("anonymize");
        return {};
      });
      const deletedRow = makeClient({ allergies: "Uczulenie na lateks" });
      mockDbDelete.mockImplementation(() => {
        order.push("delete");
        return chainMock([deletedRow]);
      });

      const { status, body } = await parseResponse<Record<string, unknown>>(await deleteWithPassword());

      expect(status).toBe(200);
      // Minimalizacja: sam identyfikator, bez danych usuwanej kartoteki.
      expect(body).toEqual({ success: true, data: { id: deletedRow.id } });
      const raw = JSON.stringify(body);
      expect(raw).not.toContain(deletedRow.firstName as string);
      expect(raw).not.toContain("allergies");
      expect(raw).not.toContain("Uczulenie na lateks");
      expect(order).toEqual(["lock", "count", "anonymize", "delete"]);
      for (const fn of [
        retentionMocks.lockClientForRemoval,
        retentionMocks.countClientRemovalBlockers,
        retentionMocks.anonymizeClientData,
      ]) {
        expect(fn).toHaveBeenCalledWith(mockTx, TEST_IDS.SALON_UUID, TEST_IDS.CLIENT_UUID);
      }
    });

    it("409: przyszłe wizyty → kod i liczby, bez danych klienta; bez anonimizacji i DELETE", async () => {
      retentionMocks.countClientRemovalBlockers.mockResolvedValue({ futureAppointments: 2, depositsToRefund: 0 });

      const { status, body } = await parseResponse<Record<string, unknown>>(await deleteWithPassword());

      expect(status).toBe(409);
      expect(body).toEqual({
        success: false,
        code: "CLIENT_HAS_PENDING_OBLIGATIONS",
        error: expect.any(String),
        futureAppointments: 2,
        depositsToRefund: 0,
      });
      expect(retentionMocks.anonymizeClientData).not.toHaveBeenCalled();
      expect(mockDbDelete).not.toHaveBeenCalled();
    });

    it("409: zadatek do zwrotu przy odwołanej wizycie → kod i liczby; bez anonimizacji i DELETE", async () => {
      retentionMocks.countClientRemovalBlockers.mockResolvedValue({ futureAppointments: 0, depositsToRefund: 1 });

      const { status, body } = await parseResponse<Record<string, unknown>>(await deleteWithPassword());

      expect(status).toBe(409);
      expect(body.code).toBe("CLIENT_HAS_PENDING_OBLIGATIONS");
      expect(body.futureAppointments).toBe(0);
      expect(body.depositsToRefund).toBe(1);
      expect(JSON.stringify(body)).not.toContain(makeClient().firstName);
      expect(retentionMocks.anonymizeClientData).not.toHaveBeenCalled();
      expect(mockDbDelete).not.toHaveBeenCalled();
    });

    it("404: klient zniknął przed blokadą (równoległe usunięcie) → bez liczenia, anonimizacji i DELETE", async () => {
      retentionMocks.lockClientForRemoval.mockResolvedValue(false);

      const { status, body } = await parseResponse(await deleteWithPassword());

      expect(status).toBe(404);
      expect(body.error).toBe("Client not found");
      expect(retentionMocks.countClientRemovalBlockers).not.toHaveBeenCalled();
      expect(retentionMocks.anonymizeClientData).not.toHaveBeenCalled();
      expect(mockDbDelete).not.toHaveBeenCalled();
    });

    it.each([
      ["55P03 (lock_timeout) z blokady", "lock", "55P03", pgError],
      ["40P01 (zakleszczenie) z blokady", "lock", "40P01", pgError],
      ["55P03 opakowany w cause, z anonimizacji", "anonymize", "55P03", wrappedPgError],
      ["40P01 opakowany w cause, z DELETE", "delete", "40P01", wrappedPgError],
    ] as const)("503 + Retry-After: 2 — %s", async (_label, where, code, makeError) => {
      const { logger } = await import("@/lib/logger");
      const warnSpy = vi.spyOn(logger, "warn");
      const error = makeError(code);
      if (where === "lock") retentionMocks.lockClientForRemoval.mockRejectedValue(error);
      if (where === "anonymize") retentionMocks.anonymizeClientData.mockRejectedValue(error);
      if (where === "delete") {
        mockDbDelete.mockImplementation(() => {
          throw error;
        });
      }

      const response = await deleteWithPassword();
      const { status, body } = await parseResponse<Record<string, unknown>>(response);

      expect(status).toBe(503);
      expect(response.headers.get("Retry-After")).toBe("2");
      expect(body).toEqual({ success: false, code: "CLIENT_DELETE_RETRY", error: "Spróbuj ponownie za chwilę" });
      // Bez ponawiania w serwerze: jedna próba blokady.
      expect(retentionMocks.lockClientForRemoval).toHaveBeenCalledTimes(1);
      // W logu tylko kod błędu — bez message, stacku i parametrów zapytania.
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(expect.any(String), { code });
      warnSpy.mockRestore();
    });

    it("500: inny błąd bazy w transakcji (np. 23503) → ogólny komunikat, bez Retry-After", async () => {
      retentionMocks.anonymizeClientData.mockRejectedValue(wrappedPgError("23503"));

      const response = await deleteWithPassword();
      const { status, body } = await parseResponse(response);

      expect(status).toBe(500);
      expect(body.error).toBe("Failed to delete client");
      expect(response.headers.get("Retry-After")).toBeNull();
    });

    it("403: recepcja bez czasowego dostępu → bez sprawdzania hasła i bez transakcji", async () => {
      mockGetSalonContext.mockResolvedValueOnce({
        salonId: TEST_IDS.SALON_UUID,
        role: "receptionist",
        employeeId: null,
        userId: "user-1",
      });

      const { status } = await parseResponse(await deleteWithPassword());

      expect(status).toBe(403);
      expect(mockVerifyPassword).not.toHaveBeenCalled();
      expect(retentionMocks.lockClientForRemoval).not.toHaveBeenCalled();
    });
  });
});

// =======================================================
// P0-A · Tenant isolation regression (IDOR) — clients/[id]
// The salon is derived from the session; a foreign-salon record is invisible
// (scoped WHERE -> empty -> 404), and a caller without a salon never queries.
// =======================================================
describe("P0-A tenant isolation — /api/clients/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSalonContext.mockResolvedValue(OWNER_CTX);
  });

  it("GET returns 404 when the caller has no salon and never queries", async () => {
    mockGetSalonContext.mockResolvedValue(null);

    const request = createMockRequest(`http://localhost:3000/api/clients/${TEST_IDS.CLIENT_UUID}`);
    const params = createRouteParams(TEST_IDS.CLIENT_UUID);
    const response = await getClient(request, params);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(404);
    expect(body.success).toBe(false);
    expect(body.error).toContain("Salon not found");
    expect(mockDbSelect).not.toHaveBeenCalled();
  });

  it("GET returns 404 for a client owned by another salon (foreign record invisible)", async () => {
    mockDbSelect.mockReturnValue(chainMock([]));

    const request = createMockRequest(`http://localhost:3000/api/clients/${TEST_IDS.CLIENT_UUID}`);
    const params = createRouteParams(TEST_IDS.CLIENT_UUID);
    const response = await getClient(request, params);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(404);
    expect(body.success).toBe(false);
    expect(mockGetSalonContext).toHaveBeenCalled();
  });

  it("PUT returns 404 for a client owned by another salon (no cross-tenant mutation)", async () => {
    mockDbUpdate.mockReturnValue(chainMock([]));

    const request = createMockRequest(`http://localhost:3000/api/clients/${TEST_IDS.CLIENT_UUID}`, {
      method: "PUT",
      body: { firstName: "X" },
    });
    const params = createRouteParams(TEST_IDS.CLIENT_UUID);
    const response = await updateClient(request, params);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(404);
    expect(body.success).toBe(false);
    expect(mockGetSalonContext).toHaveBeenCalled();
  });
});

// =======================================================
// Faza 3 · Role pracownik/recepcja — /api/clients
// Kartoteka klientów: owner/receptionist tak, employee 403 "Brak uprawnien".
// =======================================================
describe("Faza 3 role — /api/clients (employee 403)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSalonContext.mockResolvedValue(OWNER_CTX);
  });

  it("GET (lista) jako employee -> 403 Brak uprawnien i zero zapytań", async () => {
    mockGetSalonContext.mockResolvedValue(EMPLOYEE_CTX);

    const request = createMockRequest("http://localhost:3000/api/clients");
    const response = await listClients(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(403);
    expect(body.success).toBe(false);
    expect(body.error).toContain("Brak uprawnien");
    expect(mockDbSelect).not.toHaveBeenCalled();
  });

  it("POST jako employee -> 403 Brak uprawnien (nie tworzy klienta)", async () => {
    mockGetSalonContext.mockResolvedValue(EMPLOYEE_CTX);

    const request = createMockRequest("http://localhost:3000/api/clients", {
      method: "POST",
      body: {
        salonId: TEST_IDS.SALON_UUID,
        firstName: "Jan",
        lastName: "Kowalski",
      },
    });
    const response = await createClient(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(403);
    expect(body.success).toBe(false);
    expect(body.error).toContain("Brak uprawnien");
    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  it("GET (lista) jako receptionist -> 200 (pełna kartoteka salonu)", async () => {
    mockGetSalonContext.mockResolvedValue({
      ...EMPLOYEE_CTX,
      role: "receptionist" as const,
    });
    const subqueryChain = chainMock([]);
    const mainChain = chainMock([{ client: makeClient(), lastVisit: null }]);
    mockDbSelect
      .mockReturnValueOnce(subqueryChain)
      .mockReturnValueOnce(mainChain);

    const request = createMockRequest("http://localhost:3000/api/clients");
    const response = await listClients(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(1);
  });
});

// -------------------------------------------------------
// Zgoda na zapis informacji o zdrowiu (allergies)
// -------------------------------------------------------

/** Tekst zapytania z atrapy `sql` (tagged template): fragmenty sklejone, wartości jako ${…}. */
function sqlText(value: unknown): string {
  const v = value as { type?: string; args?: unknown[] };
  if (v?.type !== "sql" || !Array.isArray(v.args)) return String(value);
  const [strings, ...values] = v.args as [string[], ...unknown[]];
  return strings.reduce((acc, s, i) => acc + s + (i < values.length ? "${" + String(values[i]) + "}" : ""), "");
}

/** Czy warunek `where` (atrapa and/eq/isNotNull) zawiera isNotNull(clients.healthDataConsentAt). */
function whereRequiresStoredConsent(where: unknown): boolean {
  const node = where as { type?: string; args?: unknown[] };
  if (node?.type === "isNotNull") return node.args?.[0] === "clients.healthDataConsentAt";
  return Array.isArray(node?.args) && node.args.some(whereRequiresStoredConsent);
}

async function mockNoSession() {
  const { requireAuth, isAuthError } = await import("@/lib/auth-middleware");
  const { NextResponse } = await import("next/server");
  vi.mocked(requireAuth).mockResolvedValueOnce(
    NextResponse.json({ success: false, error: "Wymagane logowanie" }, { status: 401 })
  );
  vi.mocked(isAuthError).mockReturnValueOnce(true);
}

describe("Zgoda na informacje o zdrowiu — POST /api/clients", () => {
  const BASE = { salonId: TEST_IDS.SALON_UUID, firstName: "Jan", lastName: "Kowalski" };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSalonContext.mockResolvedValue(OWNER_CTX);
  });

  function post(body: Record<string, unknown>) {
    return createClient(createMockRequest("http://localhost:3000/api/clients", { method: "POST", body }));
  }

  function valuesArg(chain: Record<string, unknown>) {
    return (chain.values as ReturnType<typeof vi.fn>).mock.calls[0]![0];
  }

  it("allergies bez zgody → 400 z kodem i polskim komunikatem, bez zapisu", async () => {
    const { status, body } = await parseResponse(await post({ ...BASE, allergies: "Lateks" }));

    expect(status).toBe(400);
    expect(body.success).toBe(false);
    expect((body as any).code).toBe("HEALTH_DATA_CONSENT_REQUIRED");
    expect(body.error).toContain("zgod");
    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  it("allergies przy healthDataConsent: false → 400, bez zapisu", async () => {
    const { status } = await parseResponse(await post({ ...BASE, allergies: "Lateks", healthDataConsent: false }));

    expect(status).toBe(400);
    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  it.each([
    ["pusty napis", ""],
    ["same spacje", "   "],
    ["null", null],
  ])("allergies = %s bez zgody → 201, zapis NULL i brak zgody", async (_label, allergies) => {
    const chain = chainMock([makeClient()]);
    mockDbInsert.mockReturnValue(chain);

    const { status } = await parseResponse(await post({ ...BASE, allergies }));

    expect(status).toBe(201);
    const values = valuesArg(chain);
    expect(values.allergies).toBeNull();
    expect(values.healthDataConsentAt).toBeNull();
    expect(values.healthDataConsentBy).toBeNull();
  });

  it("zgoda zaznaczona → czas z bazy (now()) i konto z sesji; wartości z body ignorowane", async () => {
    const chain = chainMock([makeClient({ allergies: "Lateks" })]);
    mockDbInsert.mockReturnValue(chain);

    const { status } = await parseResponse(
      await post({
        ...BASE,
        allergies: "Lateks",
        healthDataConsent: true,
        healthDataConsentAt: "2000-01-01T00:00:00.000Z",
        healthDataConsentBy: "konto-z-body",
      })
    );

    expect(status).toBe(201);
    const values = valuesArg(chain);
    expect(values.allergies).toBe("Lateks");
    expect(sqlText(values.healthDataConsentAt)).toBe("now()");
    expect(values.healthDataConsentBy).toBe(OWNER_CTX.userId);
    expect(JSON.stringify(values)).not.toContain("2000-01-01");
    expect(JSON.stringify(values)).not.toContain("konto-z-body");
  });

  it("zgoda zaznaczona bez allergies → 201, zgoda zapisana, allergies NULL", async () => {
    const chain = chainMock([makeClient()]);
    mockDbInsert.mockReturnValue(chain);

    const { status } = await parseResponse(await post({ ...BASE, healthDataConsent: true }));

    expect(status).toBe(201);
    const values = valuesArg(chain);
    expect(values.allergies).toBeNull();
    expect(sqlText(values.healthDataConsentAt)).toBe("now()");
    expect(values.healthDataConsentBy).toBe(OWNER_CTX.userId);
  });

  it("healthDataConsent nie-boolean → 400 walidacji, bez zapisu", async () => {
    const { status } = await parseResponse(await post({ ...BASE, healthDataConsent: "tak" }));

    expect(status).toBe(400);
    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  it("bez sesji → 401, bez zapisu", async () => {
    await mockNoSession();

    const { status } = await parseResponse(await post({ ...BASE, allergies: "Lateks", healthDataConsent: true }));

    expect(status).toBe(401);
    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  it("pracownik (employee) ze zgodą → 403, bez zapisu", async () => {
    mockGetSalonContext.mockResolvedValue(EMPLOYEE_CTX);

    const { status } = await parseResponse(await post({ ...BASE, allergies: "Lateks", healthDataConsent: true }));

    expect(status).toBe(403);
    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  it("konto bez salonu → 404, bez zapisu", async () => {
    mockGetSalonContext.mockResolvedValue(null);

    const { status } = await parseResponse(await post({ ...BASE, allergies: "Lateks", healthDataConsent: true }));

    expect(status).toBe(404);
    expect(mockDbInsert).not.toHaveBeenCalled();
  });
});

describe("Zgoda na informacje o zdrowiu — PUT /api/clients/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSalonContext.mockResolvedValue(OWNER_CTX);
  });

  function put(body: Record<string, unknown>, id: string = TEST_IDS.CLIENT_UUID) {
    return updateClient(
      createMockRequest(`http://localhost:3000/api/clients/${id}`, { method: "PUT", body }),
      createRouteParams(id)
    );
  }

  function setArg(chain: Record<string, unknown>) {
    return (chain.set as ReturnType<typeof vi.fn>).mock.calls[0]![0];
  }

  function whereArg(chain: Record<string, unknown>) {
    return (chain.where as ReturnType<typeof vi.fn>).mock.calls[0]![0];
  }

  it("allergies bez zgody w żądaniu i bez zgody zapisanej → 400 z kodem (UPDATE z warunkiem zgody nie trafił, klient istnieje)", async () => {
    const updateChain = chainMock([]); // warunek isNotNull(consent_at) odciął wiersz
    mockDbUpdate.mockReturnValue(updateChain);
    mockDbSelect.mockReturnValue(chainMock([{ id: TEST_IDS.CLIENT_UUID }]));

    const { status, body } = await parseResponse(await put({ allergies: "Lateks" }));

    expect(status).toBe(400);
    expect((body as any).code).toBe("HEALTH_DATA_CONSENT_REQUIRED");
    expect(body.error).toContain("zgod");
    expect(whereRequiresStoredConsent(whereArg(updateChain))).toBe(true);
  });

  it("allergies przy zgodzie zapisanej wcześniej (bez pola zgody w żądaniu) → 200, UPDATE z warunkiem zgody, zgoda bez zmian", async () => {
    const updateChain = chainMock([makeClient({ allergies: "Lateks" })]);
    mockDbUpdate.mockReturnValue(updateChain);

    const { status, body } = await parseResponse(await put({ allergies: "Lateks" }));

    expect(status).toBe(200);
    expect((body as any).data.allergies).toBe("Lateks");
    expect(whereRequiresStoredConsent(whereArg(updateChain))).toBe(true);
    const set = setArg(updateChain);
    expect(set.allergies).toBe("Lateks");
    expect(set).not.toHaveProperty("healthDataConsentAt");
    expect(set).not.toHaveProperty("healthDataConsentBy");
    expect(mockDbSelect).not.toHaveBeenCalled();
  });

  it("allergies bez zgody dla nieistniejącego/cudzego klienta → 404 (nie 400)", async () => {
    mockDbUpdate.mockReturnValue(chainMock([]));
    mockDbSelect.mockReturnValue(chainMock([]));

    const { status } = await parseResponse(await put({ allergies: "Lateks" }));

    expect(status).toBe(404);
  });

  it("zaznaczenie zgody → serwer nadaje czas (now(), zachowuje wcześniejszy) i konto z sesji; wartości z body ignorowane", async () => {
    const updateChain = chainMock([makeClient({ allergies: "Lateks" })]);
    mockDbUpdate.mockReturnValue(updateChain);

    const { status } = await parseResponse(
      await put({
        allergies: "Lateks",
        healthDataConsent: true,
        healthDataConsentAt: "2000-01-01T00:00:00.000Z",
        healthDataConsentBy: "konto-z-body",
      })
    );

    expect(status).toBe(200);
    // Zgoda w żądaniu → bez warunku zgody zapisanej.
    expect(whereRequiresStoredConsent(whereArg(updateChain))).toBe(false);
    const set = setArg(updateChain);
    expect(set.allergies).toBe("Lateks");
    expect(sqlText(set.healthDataConsentAt)).toBe("coalesce(${clients.healthDataConsentAt}, now())");
    expect(sqlText(set.healthDataConsentBy)).toContain("THEN ${" + OWNER_CTX.userId + "}");
    expect(sqlText(set.healthDataConsentBy)).toContain("ELSE ${clients.healthDataConsentBy}");
    expect(JSON.stringify(set)).not.toContain("2000-01-01");
    expect(JSON.stringify(set)).not.toContain("konto-z-body");
  });

  it("konto zgody bierze z sesji recepcji, nie właściciela", async () => {
    mockGetSalonContext.mockResolvedValue({ ...EMPLOYEE_CTX, role: "receptionist" as const });
    const updateChain = chainMock([makeClient()]);
    mockDbUpdate.mockReturnValue(updateChain);

    const { status } = await parseResponse(await put({ healthDataConsent: true }));

    expect(status).toBe(200);
    expect(sqlText(setArg(updateChain).healthDataConsentBy)).toContain("THEN ${" + EMPLOYEE_CTX.userId + "}");
  });

  it("cofnięcie zgody → w tym samym UPDATE allergies = NULL i oba pola zgody = NULL", async () => {
    const updateChain = chainMock([makeClient({ allergies: null })]);
    mockDbUpdate.mockReturnValue(updateChain);

    const { status, body } = await parseResponse(await put({ healthDataConsent: false, firstName: "Anna" }));

    expect(status).toBe(200);
    expect((body as any).data.allergies).toBeNull();
    expect(mockDbUpdate).toHaveBeenCalledTimes(1);
    const set = setArg(updateChain);
    expect(set.allergies).toBeNull();
    expect(set.healthDataConsentAt).toBeNull();
    expect(set.healthDataConsentBy).toBeNull();
    expect(set.firstName).toBe("Anna");
  });

  it("cofnięcie zgody z jednoczesnym wpisem allergies → 400, bez UPDATE", async () => {
    const { status, body } = await parseResponse(await put({ healthDataConsent: false, allergies: "Lateks" }));

    expect(status).toBe(400);
    expect((body as any).code).toBe("HEALTH_DATA_CONSENT_REQUIRED");
    expect(mockDbUpdate).not.toHaveBeenCalled();
  });

  it("cofnięcie zgody z pustym allergies → 200, allergies NULL", async () => {
    const updateChain = chainMock([makeClient({ allergies: null })]);
    mockDbUpdate.mockReturnValue(updateChain);

    const { status } = await parseResponse(await put({ healthDataConsent: false, allergies: "" }));

    expect(status).toBe(200);
    expect(setArg(updateChain).allergies).toBeNull();
  });

  it.each([
    ["pusty napis", ""],
    ["same spacje", "  "],
    ["null", null],
  ])("allergies = %s bez zgody → 200, zapis NULL bez warunku zgody", async (_label, allergies) => {
    const updateChain = chainMock([makeClient()]);
    mockDbUpdate.mockReturnValue(updateChain);

    const { status } = await parseResponse(await put({ allergies }));

    expect(status).toBe(200);
    expect(setArg(updateChain).allergies).toBeNull();
    expect(whereRequiresStoredConsent(whereArg(updateChain))).toBe(false);
  });

  it("zmiana innych pól bez allergies → bez warunku zgody i bez zmian zgody", async () => {
    const updateChain = chainMock([makeClient({ firstName: "Ewa" })]);
    mockDbUpdate.mockReturnValue(updateChain);

    const { status } = await parseResponse(await put({ firstName: "Ewa" }));

    expect(status).toBe(200);
    const set = setArg(updateChain);
    expect(set).not.toHaveProperty("allergies");
    expect(set).not.toHaveProperty("healthDataConsentAt");
    expect(whereRequiresStoredConsent(whereArg(updateChain))).toBe(false);
  });

  it("healthDataConsent nie-boolean → 400 walidacji, bez UPDATE", async () => {
    const { status } = await parseResponse(await put({ healthDataConsent: "nie" }));

    expect(status).toBe(400);
    expect(mockDbUpdate).not.toHaveBeenCalled();
  });

  it("bez sesji → 401, bez UPDATE", async () => {
    await mockNoSession();

    const { status } = await parseResponse(await put({ healthDataConsent: true }));

    expect(status).toBe(401);
    expect(mockDbUpdate).not.toHaveBeenCalled();
  });

  it("pracownik (employee) → 403, bez UPDATE", async () => {
    mockGetSalonContext.mockResolvedValue(EMPLOYEE_CTX);

    const { status } = await parseResponse(await put({ healthDataConsent: false }));

    expect(status).toBe(403);
    expect(mockDbUpdate).not.toHaveBeenCalled();
  });

  it("cofnięcie zgody u cudzego/nieistniejącego klienta → 404", async () => {
    mockDbUpdate.mockReturnValue(chainMock([]));

    const { status } = await parseResponse(await put({ healthDataConsent: false }));

    expect(status).toBe(404);
    expect(mockDbSelect).not.toHaveBeenCalled();
  });

  it("błąd bazy w UPDATE zgody → 500", async () => {
    const errorChain = chainMock([]);
    errorChain.then = (_: unknown, reject: (err: Error) => void) => reject(new Error("DB error"));
    mockDbUpdate.mockReturnValue(errorChain);

    const { status, body } = await parseResponse(await put({ healthDataConsent: true }));

    expect(status).toBe(500);
    expect(body.error).toContain("Failed to update client");
  });
});
