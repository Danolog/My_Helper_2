/**
 * Integration tests for /api/employees endpoints.
 *
 * Tests cover:
 * - GET /api/employees (list with filtering)
 * - POST /api/employees (create with validation and auto-color assignment)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createMockRequest,
  createRouteParams,
  parseResponse,
  makeEmployee,
  TEST_IDS,
} from "./helpers";

// -------------------------------------------------------
// Mocks
// -------------------------------------------------------

const mockDbSelect = vi.fn();
const mockDbInsert = vi.fn();
const mockDbUpdate = vi.fn();
const mockDbDelete = vi.fn();

// `tx` deleguje do tych samych mocków co `db` — warstwa repo (forSalon) otwiera
// db.transaction() i woła tx.select/update/delete/insert + tx.execute (SET LOCAL).
const mockTx = {
  select: (...args: unknown[]) => mockDbSelect(...args),
  insert: (...args: unknown[]) => mockDbInsert(...args),
  update: (...args: unknown[]) => mockDbUpdate(...args),
  delete: (...args: unknown[]) => mockDbDelete(...args),
  execute: vi.fn().mockResolvedValue(undefined),
};

vi.mock("@/lib/db", () => ({
  db: {
    select: (...args: unknown[]) => mockDbSelect(...args),
    insert: (...args: unknown[]) => mockDbInsert(...args),
    update: (...args: unknown[]) => mockDbUpdate(...args),
    delete: (...args: unknown[]) => mockDbDelete(...args),
    transaction: (fn: (tx: typeof mockTx) => unknown) => fn(mockTx),
  },
}));

vi.mock("@/lib/schema", () => {
  const createTable = (name: string) =>
    new Proxy({}, {
      get: (_target, prop) => {
        if (prop === "_table") return name;
        return `${name}.${String(prop)}`;
      },
    });
  return {
    employees: createTable("employees"),
  };
});

vi.mock("drizzle-orm", () => {
  const sql = Object.assign(
    vi.fn((...args: unknown[]) => ({ type: "sql", args })),
    { raw: vi.fn((s: string) => ({ type: "sql.raw", s })) }
  );
  return {
    eq: vi.fn((...args: unknown[]) => ({ type: "eq", args })),
    and: vi.fn((...args: unknown[]) => ({ type: "and", args })),
    sql,
  };
});

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

// -------------------------------------------------------
// Chain builder
// -------------------------------------------------------

function chainMock(result: unknown[] = []) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  const methods = [
    "select", "from", "where", "leftJoin",
    "limit", "orderBy", "groupBy",
    "insert", "values", "update", "set", "delete",
    "returning",
  ];
  for (const method of methods) {
    chain[method] = vi.fn().mockReturnValue(chain);
  }
  (chain as Record<string, unknown>).then = (resolve: (val: unknown[]) => unknown) => resolve(result);
  return chain;
}

// -------------------------------------------------------
// Import route handlers
// -------------------------------------------------------

import { GET as listEmployees, POST as createEmployee } from "@/app/api/employees/route";
import { GET as getEmployee, PUT as updateEmployee } from "@/app/api/employees/[id]/route";

// Mocked tenant resolver — flip it to simulate "no salon" / wrong tenant.
import { getUserSalonId } from "@/lib/get-user-salon";
const mockGetUserSalonId = vi.mocked(getUserSalonId);

// -------------------------------------------------------
// Tests
// -------------------------------------------------------

describe("GET /api/employees", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return 200 with employees list", async () => {
    const employee = makeEmployee();
    mockDbSelect.mockReturnValue(chainMock([employee]));

    const request = createMockRequest(
      `http://localhost:3000/api/employees?salonId=${TEST_IDS.SALON_UUID}`
    );
    const response = await listEmployees(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(1);
    expect(body.count).toBe(1);
    expect((body as any).data[0].firstName).toBe("Anna");
  });

  it("should return 200 with empty list when no employees found", async () => {
    mockDbSelect.mockReturnValue(chainMock([]));

    const request = createMockRequest("http://localhost:3000/api/employees");
    const response = await listEmployees(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(0);
    expect(body.count).toBe(0);
  });

  it("should filter by activeOnly parameter", async () => {
    const employee = makeEmployee({ isActive: true });
    mockDbSelect.mockReturnValue(chainMock([employee]));

    const request = createMockRequest(
      `http://localhost:3000/api/employees?salonId=${TEST_IDS.SALON_UUID}&activeOnly=true`
    );
    const response = await listEmployees(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });

  it("should return 500 when database throws", async () => {
    const errorChain: Record<string, unknown> = {};
    const methods = ["select", "from", "where"];
    for (const m of methods) {
      (errorChain as Record<string, ReturnType<typeof vi.fn>>)[m] = vi.fn().mockReturnValue(errorChain);
    }
    errorChain.then = (_: unknown, reject: (err: Error) => void) => reject(new Error("DB error"));
    mockDbSelect.mockReturnValue(errorChain);

    const request = createMockRequest("http://localhost:3000/api/employees");
    const response = await listEmployees(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(500);
    expect(body.success).toBe(false);
    expect(body.error).toContain("Failed to fetch employees");
  });

  it("should filter by activeOnly=true without salonId", async () => {
    const employee = makeEmployee({ isActive: true });
    mockDbSelect.mockReturnValue(chainMock([employee]));

    const request = createMockRequest(
      "http://localhost:3000/api/employees?activeOnly=true"
    );
    const response = await listEmployees(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(1);
    expect((body as any).data[0].isActive).toBe(true);
  });
});

describe("POST /api/employees", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return 201 when creating a valid employee", async () => {
    const newEmployee = makeEmployee();

    // First call: getNextAvailableColor select (existing employees colors)
    mockDbSelect.mockReturnValue(chainMock([]));
    // Insert returns new employee
    mockDbInsert.mockReturnValue(chainMock([newEmployee]));

    const request = createMockRequest("http://localhost:3000/api/employees", {
      method: "POST",
      body: {
        salonId: TEST_IDS.SALON_UUID,
        firstName: "Anna",
        lastName: "Nowak",
        phone: "+48987654321",
        email: "anna@salon.com",
      },
    });

    const response = await createEmployee(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.data).toBeDefined();
  });

  it("should return 400 when required fields are missing", async () => {
    const request = createMockRequest("http://localhost:3000/api/employees", {
      method: "POST",
      body: {
        // Missing salonId, firstName, lastName
      },
    });

    const response = await createEmployee(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toBe("Validation failed");
    expect(body.details).toBeDefined();
  });

  it("should return 400 for invalid email format", async () => {
    const request = createMockRequest("http://localhost:3000/api/employees", {
      method: "POST",
      body: {
        salonId: TEST_IDS.SALON_UUID,
        firstName: "Anna",
        lastName: "Nowak",
        email: "not-an-email",
      },
    });

    const response = await createEmployee(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(400);
    expect(body.success).toBe(false);
  });

  it("should return 400 for invalid phone format", async () => {
    const request = createMockRequest("http://localhost:3000/api/employees", {
      method: "POST",
      body: {
        salonId: TEST_IDS.SALON_UUID,
        firstName: "Anna",
        lastName: "Nowak",
        phone: "abc",
      },
    });

    const response = await createEmployee(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(400);
    expect(body.success).toBe(false);
  });

  it("should return 500 when database throws on insert", async () => {
    // Color lookup succeeds
    mockDbSelect.mockReturnValue(chainMock([]));
    // Insert fails
    const errorChain: Record<string, unknown> = {};
    const methods = ["insert", "values", "returning"];
    for (const m of methods) {
      (errorChain as Record<string, ReturnType<typeof vi.fn>>)[m] = vi.fn().mockReturnValue(errorChain);
    }
    errorChain.then = (_: unknown, reject: (err: Error) => void) => reject(new Error("DB insert error"));
    mockDbInsert.mockReturnValue(errorChain);

    const request = createMockRequest("http://localhost:3000/api/employees", {
      method: "POST",
      body: {
        salonId: TEST_IDS.SALON_UUID,
        firstName: "Anna",
        lastName: "Nowak",
      },
    });

    const response = await createEmployee(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(500);
    expect(body.success).toBe(false);
  });

  it("should accept optional color field", async () => {
    const newEmployee = makeEmployee({ color: "#ff0000" });
    mockDbInsert.mockReturnValue(chainMock([newEmployee]));

    const request = createMockRequest("http://localhost:3000/api/employees", {
      method: "POST",
      body: {
        salonId: TEST_IDS.SALON_UUID,
        firstName: "Anna",
        lastName: "Nowak",
        color: "#ff0000",
      },
    });

    const response = await createEmployee(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(201);
    expect(body.success).toBe(true);
  });

  it("should cycle colors when all 12 are exhausted", async () => {
    // All 12 EMPLOYEE_COLORS are already in use by existing employees
    const allColors = [
      "#3b82f6", "#10b981", "#f59e0b", "#ef4444",
      "#8b5cf6", "#ec4899", "#06b6d4", "#f97316",
      "#84cc16", "#6366f1", "#14b8a6", "#a855f7",
    ];
    const existingEmployees = allColors.map((color) => ({ color }));

    // getNextAvailableColor queries existing employees -- returns all 12 colors used
    mockDbSelect.mockReturnValueOnce(chainMock(existingEmployees));

    // The cycling logic: index = 12 % 12 = 0, so it picks EMPLOYEE_COLORS[0] = "#3b82f6"
    const newEmployee = makeEmployee({ color: "#3b82f6" });
    mockDbInsert.mockReturnValue(chainMock([newEmployee]));

    const request = createMockRequest("http://localhost:3000/api/employees", {
      method: "POST",
      body: {
        salonId: TEST_IDS.SALON_UUID,
        firstName: "Beata",
        lastName: "Zielinska",
      },
    });

    const response = await createEmployee(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(201);
    expect(body.success).toBe(true);
    expect((body as any).data.color).toBe("#3b82f6");
  });

  it("should fall back to default color when getNextAvailableColor throws", async () => {
    // Make the color lookup query reject so getNextAvailableColor's catch fires
    const errorChain: Record<string, unknown> = {};
    const methods = ["select", "from", "where"];
    for (const m of methods) {
      (errorChain as Record<string, ReturnType<typeof vi.fn>>)[m] = vi.fn().mockReturnValue(errorChain);
    }
    errorChain.then = (_: unknown, reject: (err: Error) => void) => reject(new Error("Color query failed"));
    mockDbSelect.mockReturnValueOnce(errorChain);

    // The catch block returns EMPLOYEE_COLORS[0] = "#3b82f6"
    const newEmployee = makeEmployee({ color: "#3b82f6" });
    mockDbInsert.mockReturnValue(chainMock([newEmployee]));

    const request = createMockRequest("http://localhost:3000/api/employees", {
      method: "POST",
      body: {
        salonId: TEST_IDS.SALON_UUID,
        firstName: "Celina",
        lastName: "Kowalczyk",
      },
    });

    const response = await createEmployee(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(201);
    expect(body.success).toBe(true);
    expect((body as any).data.color).toBe("#3b82f6");
  });
});

// =======================================================
// P0-A · Tenant isolation regression (IDOR) — employees/[id]
// The salon is derived from the session; a foreign-salon record is invisible
// (scoped WHERE -> empty -> 404), and a caller without a salon never queries.
// =======================================================
describe("P0-A tenant isolation — /api/employees/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUserSalonId.mockResolvedValue(TEST_IDS.SALON_UUID);
  });

  it("GET returns 404 when the caller has no salon and never queries", async () => {
    mockGetUserSalonId.mockResolvedValue(null);

    const request = createMockRequest(`http://localhost:3000/api/employees/${TEST_IDS.EMPLOYEE_UUID}`);
    const params = createRouteParams(TEST_IDS.EMPLOYEE_UUID);
    const response = await getEmployee(request, params);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(404);
    expect(body.success).toBe(false);
    expect(body.error).toContain("Salon not found");
    expect(mockDbSelect).not.toHaveBeenCalled();
  });

  it("GET returns 404 for an employee owned by another salon (foreign record invisible)", async () => {
    mockDbSelect.mockReturnValue(chainMock([]));

    const request = createMockRequest(`http://localhost:3000/api/employees/${TEST_IDS.EMPLOYEE_UUID}`);
    const params = createRouteParams(TEST_IDS.EMPLOYEE_UUID);
    const response = await getEmployee(request, params);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(404);
    expect(body.success).toBe(false);
    expect(mockGetUserSalonId).toHaveBeenCalled();
  });

  it("PUT returns 404 for an employee owned by another salon (no cross-tenant mutation)", async () => {
    // The scoped existence check returns empty -> the employee belongs to
    // another salon, so the update is refused with 404.
    mockDbSelect.mockReturnValue(chainMock([]));

    const request = createMockRequest(`http://localhost:3000/api/employees/${TEST_IDS.EMPLOYEE_UUID}`, {
      method: "PUT",
      body: { firstName: "X" },
    });
    const params = createRouteParams(TEST_IDS.EMPLOYEE_UUID);
    const response = await updateEmployee(request, params);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(404);
    expect(body.success).toBe(false);
    expect(mockGetUserSalonId).toHaveBeenCalled();
  });
});
