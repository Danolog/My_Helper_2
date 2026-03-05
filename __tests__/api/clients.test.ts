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

vi.mock("@/lib/db", () => ({
  db: {
    select: (...args: unknown[]) => mockDbSelect(...args),
    insert: (...args: unknown[]) => mockDbInsert(...args),
    update: (...args: unknown[]) => mockDbUpdate(...args),
    delete: (...args: unknown[]) => mockDbDelete(...args),
  },
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

import { GET as listClients, POST as createClient } from "@/app/api/clients/route";
import {
  GET as getClient,
  PUT as updateClient,
  DELETE as deleteClient,
} from "@/app/api/clients/[id]/route";

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
      requireDeposit: true,
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
        favoriteEmployeeId: employeeUuid,
        requireDeposit: true,
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
    expect((body as any).data.requireDeposit).toBe(true);
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

    // Account found with password hash
    mockDbSelect.mockReturnValue(chainMock([{
      userId: "user-1",
      providerId: "credential",
      password: "hashed-password",
    }]));

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

    // Account found with password hash
    mockDbSelect.mockReturnValue(chainMock([{
      userId: "user-1",
      providerId: "credential",
      password: "hashed-password",
    }]));

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
  });

  it("should return 404 when client not found after password verification", async () => {
    mockGetSession.mockResolvedValue({
      user: { id: "user-1", email: "owner@test.com" },
    });

    mockDbSelect.mockReturnValue(chainMock([{
      userId: "user-1",
      providerId: "credential",
      password: "hashed-password",
    }]));

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

    // Account found but password is null (OAuth-only account, no credential password)
    mockDbSelect.mockReturnValue(chainMock([{
      userId: "user-1",
      providerId: "credential",
      password: null,
    }]));

    const request = createMockRequest(`http://localhost:3000/api/clients/${TEST_IDS.CLIENT_UUID}`, {
      method: "DELETE",
      body: { password: "some-password" },
    });
    const params = createRouteParams(TEST_IDS.CLIENT_UUID);
    const response = await deleteClient(request, params);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toContain("Nie mozna zweryfikowac hasla");
  });
});
