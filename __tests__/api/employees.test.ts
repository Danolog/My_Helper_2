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
  parseResponse,
  makeEmployee,
  TEST_IDS,
} from "./helpers";

// -------------------------------------------------------
// Mocks
// -------------------------------------------------------

const mockDbSelect = vi.fn();
const mockDbInsert = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    select: (...args: unknown[]) => mockDbSelect(...args),
    insert: (...args: unknown[]) => mockDbInsert(...args),
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

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: unknown[]) => ({ type: "eq", args })),
  and: vi.fn((...args: unknown[]) => ({ type: "and", args })),
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
});
