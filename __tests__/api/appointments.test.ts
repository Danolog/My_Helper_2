/**
 * Integration tests for /api/appointments endpoints.
 *
 * Tests cover:
 * - GET /api/appointments (list with filtering)
 * - POST /api/appointments (create with validation, overlap check, time block check)
 * - GET /api/appointments/[id] (single appointment)
 * - PUT /api/appointments/[id] (reschedule with overlap check)
 * - DELETE /api/appointments/[id] (cancel with deposit rules)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createMockRequest,
  createRouteParams,
  parseResponse,
  makeAppointment,
  makeClient,
  makeEmployee,
  makeService,
  TEST_IDS,
} from "./helpers";

// -------------------------------------------------------
// Mocks - must be declared before importing route handlers
// -------------------------------------------------------

// Mock the database module. Every db method returns a chainable mock.
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

// Mock the auth module (used in POST for bookedByUserId)
vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: vi.fn().mockResolvedValue(null),
    },
  },
}));

// Mock next/headers (used in appointments POST)
vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue(new Headers()),
}));

// Mock refund utilities (used in DELETE)
vi.mock("@/lib/refund", () => ({
  processAutomaticRefund: vi.fn().mockResolvedValue({
    success: true,
    refunded: false,
    message: "Mock refund",
  }),
  createRefundNotification: vi.fn().mockResolvedValue(undefined),
}));

// Mock waiting list (used in DELETE)
vi.mock("@/lib/waiting-list", () => ({
  notifyWaitingList: vi.fn().mockResolvedValue({ notified: 0 }),
}));

// Mock the schema module - provide table references as plain objects
vi.mock("@/lib/schema", () => {
  const createTable = (name: string) => ({
    _table: name,
    id: `${name}.id`,
    salonId: `${name}.salonId`,
    clientId: `${name}.clientId`,
    employeeId: `${name}.employeeId`,
    serviceId: `${name}.serviceId`,
    startTime: `${name}.startTime`,
    endTime: `${name}.endTime`,
    status: `${name}.status`,
    name: `${name}.name`,
    categoryId: `${name}.categoryId`,
    isActive: `${name}.isActive`,
    quantity: `${name}.quantity`,
    message: `${name}.message`,
    createdAt: `${name}.createdAt`,
    type: `${name}.type`,
    appointmentId: `${name}.appointmentId`,
    productId: `${name}.productId`,
    promotionId: `${name}.promotionId`,
    usageLimit: `${name}.usageLimit`,
    usedCount: `${name}.usedCount`,
    expiresAt: `${name}.expiresAt`,
    blockType: `${name}.blockType`,
  });
  return {
    appointments: createTable("appointments"),
    clients: createTable("clients"),
    employees: createTable("employees"),
    services: createTable("services"),
    notifications: createTable("notifications"),
    depositPayments: createTable("depositPayments"),
    salons: createTable("salons"),
    timeBlocks: createTable("timeBlocks"),
    promoCodes: createTable("promoCodes"),
    promotions: createTable("promotions"),
    serviceCategories: createTable("serviceCategories"),
    serviceVariants: createTable("serviceVariants"),
    products: createTable("products"),
    workSchedules: createTable("workSchedules"),
    appointmentMaterials: createTable("appointmentMaterials"),
    treatmentHistory: createTable("treatmentHistory"),
    employeeCommissions: createTable("employeeCommissions"),
    employeeServicePrices: createTable("employeeServicePrices"),
    serviceProducts: createTable("serviceProducts"),
    productUsage: createTable("productUsage"),
    loyaltyPoints: createTable("loyaltyPoints"),
    loyaltyTransactions: createTable("loyaltyTransactions"),
    account: createTable("account"),
  };
});

// Mock drizzle-orm operators to be passthrough functions
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: unknown[]) => ({ type: "eq", args })),
  and: vi.fn((...args: unknown[]) => ({ type: "and", args })),
  or: vi.fn((...args: unknown[]) => ({ type: "or", args })),
  not: vi.fn((...args: unknown[]) => ({ type: "not", args })),
  gte: vi.fn((...args: unknown[]) => ({ type: "gte", args })),
  lte: vi.fn((...args: unknown[]) => ({ type: "lte", args })),
  lt: vi.fn((...args: unknown[]) => ({ type: "lt", args })),
  gt: vi.fn((...args: unknown[]) => ({ type: "gt", args })),
  isNotNull: vi.fn((...args: unknown[]) => ({ type: "isNotNull", args })),
  sql: vi.fn((...args: unknown[]) => ({ type: "sql", args })),
}));

// Mock validations (used in GET/PUT for UUID/date validation)
vi.mock("@/lib/validations", () => ({
  isValidUuid: vi.fn((id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)),
  isValidDateString: vi.fn((d: string) => !isNaN(new Date(d).getTime())),
}));

// -------------------------------------------------------
// Helper to build a chainable mock with specific result
// -------------------------------------------------------

function chainMock(result: unknown[] = []) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  const methods = [
    "select", "from", "where", "leftJoin", "innerJoin",
    "limit", "orderBy", "groupBy", "as",
    "insert", "values", "update", "set", "delete",
    "returning", "execute",
  ];
  for (const method of methods) {
    chain[method] = vi.fn().mockReturnValue(chain);
  }
  // Make the chain awaitable
  (chain as Record<string, unknown>).then = (resolve: (val: unknown[]) => unknown) => resolve(result);
  return chain;
}

// -------------------------------------------------------
// Import route handlers AFTER mocks are set up
// -------------------------------------------------------

// Import list/create handlers
import { GET as listAppointments, POST as createAppointment } from "@/app/api/appointments/route";
// Import single appointment handlers
import {
  GET as getAppointment,
  PUT as updateAppointment,
  DELETE as deleteAppointment,
} from "@/app/api/appointments/[id]/route";

// -------------------------------------------------------
// Tests
// -------------------------------------------------------

describe("GET /api/appointments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return 200 with appointments list", async () => {
    const appointment = makeAppointment();
    const client = makeClient();
    const employee = makeEmployee();
    const service = makeService();

    const row = { appointment, client, employee, service };
    mockDbSelect.mockReturnValue(chainMock([row]));

    const request = createMockRequest("http://localhost:3000/api/appointments?salonId=" + TEST_IDS.SALON_UUID);
    const response = await listAppointments(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(1);
    expect(body.count).toBe(1);
  });

  it("should return 200 with empty list when no appointments found", async () => {
    mockDbSelect.mockReturnValue(chainMock([]));

    const request = createMockRequest("http://localhost:3000/api/appointments");
    const response = await listAppointments(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(0);
    expect(body.count).toBe(0);
  });

  it("should return 400 for invalid startDate format", async () => {
    const request = createMockRequest("http://localhost:3000/api/appointments?startDate=not-a-date");
    const response = await listAppointments(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toContain("Invalid startDate format");
  });

  it("should return 400 for invalid endDate format", async () => {
    const request = createMockRequest(
      "http://localhost:3000/api/appointments?startDate=2026-01-01T00:00:00Z&endDate=bad"
    );
    const response = await listAppointments(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toContain("Invalid endDate format");
  });

  it("should return 400 for invalid salonId UUID", async () => {
    const request = createMockRequest("http://localhost:3000/api/appointments?salonId=not-uuid");
    const response = await listAppointments(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toContain("Invalid salonId format");
  });

  it("should return 400 for invalid employeeId UUID", async () => {
    const request = createMockRequest("http://localhost:3000/api/appointments?employeeId=abc");
    const response = await listAppointments(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toContain("Invalid employeeId format");
  });

  it("should return 500 when database throws", async () => {
    mockDbSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        leftJoin: vi.fn().mockReturnValue({
          leftJoin: vi.fn().mockReturnValue({
            leftJoin: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                then: (_: unknown, reject: (err: Error) => void) => reject(new Error("DB error")),
              }),
              then: (_: unknown, reject: (err: Error) => void) => reject(new Error("DB error")),
            }),
          }),
        }),
      }),
    });

    const request = createMockRequest("http://localhost:3000/api/appointments");
    const response = await listAppointments(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(500);
    expect(body.success).toBe(false);
    expect(body.error).toContain("Failed to fetch appointments");
  });
});

describe("POST /api/appointments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return 201 when creating a valid appointment", async () => {
    const newAppointment = makeAppointment();

    // First select: overlap check returns empty
    // Second select: time block check returns empty
    // Third call: insert returns the new appointment
    const overlapChain = chainMock([]);
    const timeBlockChain = chainMock([]);
    const insertChain = chainMock([newAppointment]);

    mockDbSelect
      .mockReturnValueOnce(overlapChain)
      .mockReturnValueOnce(timeBlockChain);
    mockDbInsert.mockReturnValue(insertChain);

    const request = createMockRequest("http://localhost:3000/api/appointments", {
      method: "POST",
      body: {
        salonId: TEST_IDS.SALON_UUID,
        employeeId: TEST_IDS.EMPLOYEE_UUID,
        serviceId: TEST_IDS.SERVICE_UUID,
        clientId: TEST_IDS.CLIENT_UUID,
        startTime: "2026-04-01T10:00:00Z",
        endTime: "2026-04-01T11:00:00Z",
      },
    });

    const response = await createAppointment(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.data).toBeDefined();
  });

  it("should return 400 when required fields are missing", async () => {
    const request = createMockRequest("http://localhost:3000/api/appointments", {
      method: "POST",
      body: {
        // Missing salonId, employeeId, startTime, endTime
      },
    });

    const response = await createAppointment(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toBe("Validation failed");
    expect(body.details).toBeDefined();
  });

  it("should return 400 when endTime is before startTime", async () => {
    const request = createMockRequest("http://localhost:3000/api/appointments", {
      method: "POST",
      body: {
        salonId: TEST_IDS.SALON_UUID,
        employeeId: TEST_IDS.EMPLOYEE_UUID,
        startTime: "2026-04-01T11:00:00Z",
        endTime: "2026-04-01T10:00:00Z",
      },
    });

    const response = await createAppointment(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(400);
    expect(body.success).toBe(false);
  });

  it("should return 400 for invalid date format in startTime", async () => {
    const request = createMockRequest("http://localhost:3000/api/appointments", {
      method: "POST",
      body: {
        salonId: TEST_IDS.SALON_UUID,
        employeeId: TEST_IDS.EMPLOYEE_UUID,
        startTime: "not-a-date",
        endTime: "2026-04-01T11:00:00Z",
      },
    });

    const response = await createAppointment(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(400);
    expect(body.success).toBe(false);
  });

  it("should return 409 when time slot conflicts with existing appointment", async () => {
    const existingAppointment = makeAppointment();
    const overlapChain = chainMock([existingAppointment]);

    mockDbSelect.mockReturnValueOnce(overlapChain);

    const request = createMockRequest("http://localhost:3000/api/appointments", {
      method: "POST",
      body: {
        salonId: TEST_IDS.SALON_UUID,
        employeeId: TEST_IDS.EMPLOYEE_UUID,
        startTime: "2026-04-01T10:00:00Z",
        endTime: "2026-04-01T11:00:00Z",
      },
    });

    const response = await createAppointment(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(409);
    expect(body.success).toBe(false);
    expect(body.error).toContain("conflicts");
  });

  it("should return 409 when employee has a time block during requested time", async () => {
    // Overlap check: no conflicts
    const overlapChain = chainMock([]);
    // Time block check: has a vacation block
    const timeBlockChain = chainMock([{
      id: "block-1",
      employeeId: TEST_IDS.EMPLOYEE_UUID,
      blockType: "vacation",
      reason: "Urlop",
      startTime: new Date("2026-04-01T00:00:00Z"),
      endTime: new Date("2026-04-02T00:00:00Z"),
    }]);

    mockDbSelect
      .mockReturnValueOnce(overlapChain)
      .mockReturnValueOnce(timeBlockChain);

    const request = createMockRequest("http://localhost:3000/api/appointments", {
      method: "POST",
      body: {
        salonId: TEST_IDS.SALON_UUID,
        employeeId: TEST_IDS.EMPLOYEE_UUID,
        startTime: "2026-04-01T10:00:00Z",
        endTime: "2026-04-01T11:00:00Z",
      },
    });

    const response = await createAppointment(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(409);
    expect(body.success).toBe(false);
    expect(body.error).toContain("urlop");
  });
});

describe("GET /api/appointments/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return 200 with appointment details", async () => {
    const appointment = makeAppointment();
    const client = makeClient();
    const employee = makeEmployee();
    const service = makeService();

    mockDbSelect.mockReturnValue(chainMock([{ appointment, client, employee, service }]));

    const request = createMockRequest(`http://localhost:3000/api/appointments/${TEST_IDS.APPOINTMENT_UUID}`);
    const params = createRouteParams(TEST_IDS.APPOINTMENT_UUID);
    const response = await getAppointment(request, params);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toBeDefined();
    expect((body as any).data.id).toBe(TEST_IDS.APPOINTMENT_UUID);
  });

  it("should return 400 for invalid UUID format", async () => {
    const request = createMockRequest("http://localhost:3000/api/appointments/not-a-uuid");
    const params = createRouteParams("not-a-uuid");
    const response = await getAppointment(request, params);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toContain("Invalid appointment ID format");
  });

  it("should return 404 when appointment not found", async () => {
    mockDbSelect.mockReturnValue(chainMock([]));

    const request = createMockRequest(`http://localhost:3000/api/appointments/${TEST_IDS.APPOINTMENT_UUID}`);
    const params = createRouteParams(TEST_IDS.APPOINTMENT_UUID);
    const response = await getAppointment(request, params);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(404);
    expect(body.success).toBe(false);
    expect(body.error).toContain("not found");
  });

  it("should return 500 when database throws", async () => {
    const errorChain: Record<string, unknown> = {};
    const methods = ["select", "from", "where", "leftJoin", "limit"];
    for (const method of methods) {
      (errorChain as Record<string, ReturnType<typeof vi.fn>>)[method] = vi.fn().mockReturnValue(errorChain);
    }
    errorChain.then = (_: unknown, reject: (err: Error) => void) => reject(new Error("DB failure"));
    mockDbSelect.mockReturnValue(errorChain);

    const request = createMockRequest(`http://localhost:3000/api/appointments/${TEST_IDS.APPOINTMENT_UUID}`);
    const params = createRouteParams(TEST_IDS.APPOINTMENT_UUID);
    const response = await getAppointment(request, params);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(500);
    expect(body.success).toBe(false);
  });
});

describe("PUT /api/appointments/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return 200 when rescheduling successfully", async () => {
    const existing = makeAppointment();
    const updated = makeAppointment({
      startTime: new Date("2026-04-01T14:00:00Z"),
      endTime: new Date("2026-04-01T15:00:00Z"),
    });

    // First select: find existing appointment
    const existChain = chainMock([existing]);
    // Second select: overlap check returns empty
    const overlapChain = chainMock([]);
    // Update returns updated appointment
    const updateChain = chainMock([updated]);

    mockDbSelect
      .mockReturnValueOnce(existChain)
      .mockReturnValueOnce(overlapChain);
    mockDbUpdate.mockReturnValue(updateChain);

    const request = createMockRequest(`http://localhost:3000/api/appointments/${TEST_IDS.APPOINTMENT_UUID}`, {
      method: "PUT",
      body: {
        startTime: "2026-04-01T14:00:00Z",
        endTime: "2026-04-01T15:00:00Z",
      },
    });
    const params = createRouteParams(TEST_IDS.APPOINTMENT_UUID);
    const response = await updateAppointment(request, params);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.message).toContain("rescheduled");
  });

  it("should return 400 for invalid UUID format", async () => {
    const request = createMockRequest("http://localhost:3000/api/appointments/bad-id", {
      method: "PUT",
      body: { notes: "test" },
    });
    const params = createRouteParams("bad-id");
    const response = await updateAppointment(request, params);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(400);
    expect(body.success).toBe(false);
  });

  it("should return 404 when appointment not found for update", async () => {
    mockDbSelect.mockReturnValue(chainMock([]));

    const request = createMockRequest(`http://localhost:3000/api/appointments/${TEST_IDS.APPOINTMENT_UUID}`, {
      method: "PUT",
      body: { notes: "updated" },
    });
    const params = createRouteParams(TEST_IDS.APPOINTMENT_UUID);
    const response = await updateAppointment(request, params);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(404);
    expect(body.success).toBe(false);
    expect(body.error).toContain("not found");
  });

  it("should return 409 when rescheduled time conflicts", async () => {
    const existing = makeAppointment();
    const conflicting = makeAppointment({ id: "conflict-id" });

    // Existing appointment found
    const existChain = chainMock([existing]);
    // Overlap check finds a conflict
    const overlapChain = chainMock([conflicting]);

    mockDbSelect
      .mockReturnValueOnce(existChain)
      .mockReturnValueOnce(overlapChain);

    const request = createMockRequest(`http://localhost:3000/api/appointments/${TEST_IDS.APPOINTMENT_UUID}`, {
      method: "PUT",
      body: {
        startTime: "2026-04-01T10:00:00Z",
        endTime: "2026-04-01T11:00:00Z",
      },
    });
    const params = createRouteParams(TEST_IDS.APPOINTMENT_UUID);
    const response = await updateAppointment(request, params);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(409);
    expect(body.success).toBe(false);
    expect(body.error).toContain("conflicts");
  });
});

describe("DELETE /api/appointments/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return 200 when cancelling successfully", async () => {
    const appointment = makeAppointment({
      startTime: new Date(Date.now() + 48 * 60 * 60 * 1000), // 48h from now
      endTime: new Date(Date.now() + 49 * 60 * 60 * 1000),
    });
    const client = makeClient();
    const employee = makeEmployee();
    const service = makeService();

    const cancelled = { ...appointment, status: "cancelled" };

    // Select: fetch appointment with joins
    mockDbSelect.mockReturnValueOnce(chainMock([{ appointment, client, employee, service }]));
    // Update: set status to cancelled
    mockDbUpdate.mockReturnValueOnce(chainMock([cancelled]));
    // Select: get salon name for waiting list
    mockDbSelect.mockReturnValueOnce(chainMock([{ id: TEST_IDS.SALON_UUID, name: "Test Salon" }]));

    const request = createMockRequest(
      `http://localhost:3000/api/appointments/${TEST_IDS.APPOINTMENT_UUID}`
    );
    const params = createRouteParams(TEST_IDS.APPOINTMENT_UUID);
    const response = await deleteAppointment(request, params);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.message).toContain("cancelled");
    expect(body.cancellationDetails).toBeDefined();
  });

  it("should return 404 when appointment not found for deletion", async () => {
    mockDbSelect.mockReturnValue(chainMock([]));

    const request = createMockRequest(
      `http://localhost:3000/api/appointments/${TEST_IDS.APPOINTMENT_UUID}`
    );
    const params = createRouteParams(TEST_IDS.APPOINTMENT_UUID);
    const response = await deleteAppointment(request, params);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(404);
    expect(body.success).toBe(false);
    expect(body.error).toContain("not found");
  });

  it("should return 400 when appointment is already cancelled", async () => {
    const appointment = makeAppointment({ status: "cancelled" });
    const client = makeClient();
    const employee = makeEmployee();
    const service = makeService();

    mockDbSelect.mockReturnValue(chainMock([{ appointment, client, employee, service }]));

    const request = createMockRequest(
      `http://localhost:3000/api/appointments/${TEST_IDS.APPOINTMENT_UUID}`
    );
    const params = createRouteParams(TEST_IDS.APPOINTMENT_UUID);
    const response = await deleteAppointment(request, params);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toContain("anulowana");
  });

  it("should handle deposit forfeiture for late cancellation (< 24h)", async () => {
    const appointment = makeAppointment({
      startTime: new Date(Date.now() + 2 * 60 * 60 * 1000), // 2h from now
      endTime: new Date(Date.now() + 3 * 60 * 60 * 1000),
      depositAmount: "50.00",
      depositPaid: true,
    });
    const client = makeClient();
    const employee = makeEmployee();
    const service = makeService();

    const cancelled = { ...appointment, status: "cancelled" };

    mockDbSelect.mockReturnValueOnce(chainMock([{ appointment, client, employee, service }]));
    mockDbUpdate
      .mockReturnValueOnce(chainMock([cancelled]))  // cancel the appointment
      .mockReturnValueOnce(chainMock([]));           // mark deposit as forfeited
    mockDbSelect.mockReturnValueOnce(chainMock([{ id: TEST_IDS.SALON_UUID, name: "Test Salon" }]));

    const request = createMockRequest(
      `http://localhost:3000/api/appointments/${TEST_IDS.APPOINTMENT_UUID}`
    );
    const params = createRouteParams(TEST_IDS.APPOINTMENT_UUID);
    const response = await deleteAppointment(request, params);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect((body as any).cancellationDetails.depositForfeited).toBe(true);
    expect((body as any).cancellationDetails.depositRefunded).toBe(false);
  });
});
