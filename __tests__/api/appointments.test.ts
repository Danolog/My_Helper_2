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

// Mock the auth module (used via getOptionalSession in POST)
vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: vi.fn().mockResolvedValue({
        user: { id: "test-user-id", email: "test@test.com", name: "Test User" },
      }),
    },
  },
}));

// Mock next/headers (used in appointments POST)
vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue(new Headers()),
}));

// Mock session module (getOptionalSession used in POST)
vi.mock("@/lib/session", () => ({
  getOptionalSession: vi.fn().mockResolvedValue({
    user: { id: "test-user-id", email: "test@test.com", name: "Test User" },
  }),
}));

// Mock rate-limit module (used in POST for guest booking protection)
vi.mock("@/lib/rate-limit", () => ({
  strictRateLimit: { check: vi.fn().mockReturnValue({ success: true, remaining: 4, reset: 60000 }) },
  getClientIp: vi.fn().mockReturnValue("127.0.0.1"),
  apiRateLimit: { check: vi.fn().mockReturnValue({ success: true, remaining: 59, reset: 60000 }) },
  authRateLimit: { check: vi.fn().mockReturnValue({ success: true, remaining: 9, reset: 60000 }) },
  createRateLimit: vi.fn(),
}));

// Mock refund utilities (used in DELETE)
const mockProcessAutomaticRefund = vi.fn().mockResolvedValue({
  success: true,
  refunded: false,
  message: "Mock refund",
});
const mockCreateRefundNotification = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/refund", () => ({
  processAutomaticRefund: (...args: unknown[]) => mockProcessAutomaticRefund(...args),
  createRefundNotification: (...args: unknown[]) => mockCreateRefundNotification(...args),
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

vi.mock("@/lib/auth-middleware", () => ({
  requireAuth: vi.fn().mockResolvedValue({
    session: { user: { id: "test-user-id", email: "test@test.com", name: "Test User" } },
    user: { id: "test-user-id", email: "test@test.com", name: "Test User" },
  }),
  isAuthError: vi.fn().mockReturnValue(false),
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

  it("should return 200 with data when startDate and endDate range is provided", async () => {
    const appointment = makeAppointment();
    const client = makeClient();
    const employee = makeEmployee();
    const service = makeService();

    mockDbSelect.mockReturnValue(chainMock([{ appointment, client, employee, service }]));

    const request = createMockRequest(
      "http://localhost:3000/api/appointments?startDate=2026-04-01T00:00:00Z&endDate=2026-04-02T00:00:00Z"
    );
    const response = await listAppointments(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(1);
    expect(body.count).toBe(1);
  });

  it("should return 200 with gte filter when only startDate is provided", async () => {
    const appointment = makeAppointment();
    const client = makeClient();
    const employee = makeEmployee();
    const service = makeService();

    mockDbSelect.mockReturnValue(chainMock([{ appointment, client, employee, service }]));

    const request = createMockRequest(
      "http://localhost:3000/api/appointments?startDate=2026-04-01T00:00:00Z"
    );
    const response = await listAppointments(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(1);
  });

  it("should return 200 with lte filter when only endDate is provided", async () => {
    const appointment = makeAppointment();
    const client = makeClient();
    const employee = makeEmployee();
    const service = makeService();

    mockDbSelect.mockReturnValue(chainMock([{ appointment, client, employee, service }]));

    const request = createMockRequest(
      "http://localhost:3000/api/appointments?endDate=2026-04-02T00:00:00Z"
    );
    const response = await listAppointments(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(1);
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

  it("should return 409 with fallback label and no reason for break time block", async () => {
    // Overlap check: no conflicts
    const overlapChain = chainMock([]);
    // Time block check: has a break block with no reason (covers blockTypeLabels fallback and no-reason branch)
    const timeBlockChain = chainMock([{
      id: "block-2",
      employeeId: TEST_IDS.EMPLOYEE_UUID,
      blockType: "break",
      reason: null,
      startTime: new Date("2026-04-01T09:00:00Z"),
      endTime: new Date("2026-04-01T12:00:00Z"),
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
    // "przerwa" is the label for "break" in blockTypeLabels
    expect(body.error).toContain("przerwa");
    // No reason appended since reason is null
    expect(body.error).not.toContain("(");
  });

  it("should return 201 with valid promo code and increment usage count", async () => {
    const PROMO_CODE_UUID = "77777777-7777-7777-7777-777777777777";
    const newAppointment = makeAppointment({ promoCodeId: PROMO_CODE_UUID, discountAmount: "20.00" });

    // 1st select: overlap check returns empty
    const overlapChain = chainMock([]);
    // 2nd select: time block check returns empty
    const timeBlockChain = chainMock([]);
    // 3rd select: promo code validation returns valid promo
    const promoChain = chainMock([{
      promoCode: {
        id: PROMO_CODE_UUID,
        expiresAt: new Date("2027-01-01T00:00:00Z"),
        usageLimit: 100,
        usedCount: 5,
        promotionId: "promo-1",
      },
      promotion: {
        id: "promo-1",
        isActive: true,
      },
    }]);
    // insert: returns the new appointment
    const insertChain = chainMock([newAppointment]);
    // update: increment promo code usedCount
    const updatePromoChain = chainMock([]);

    mockDbSelect
      .mockReturnValueOnce(overlapChain)
      .mockReturnValueOnce(timeBlockChain)
      .mockReturnValueOnce(promoChain);
    mockDbInsert.mockReturnValue(insertChain);
    mockDbUpdate.mockReturnValue(updatePromoChain);

    const request = createMockRequest("http://localhost:3000/api/appointments", {
      method: "POST",
      body: {
        salonId: TEST_IDS.SALON_UUID,
        employeeId: TEST_IDS.EMPLOYEE_UUID,
        serviceId: TEST_IDS.SERVICE_UUID,
        clientId: TEST_IDS.CLIENT_UUID,
        startTime: "2026-04-01T10:00:00Z",
        endTime: "2026-04-01T11:00:00Z",
        promoCodeId: PROMO_CODE_UUID,
        discountAmount: "20.00",
      },
    });

    const response = await createAppointment(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.data).toBeDefined();
    // Verify promo code usage was incremented (update was called)
    expect(mockDbUpdate).toHaveBeenCalled();
  });

  it("should return 400 when promo code is expired", async () => {
    const PROMO_CODE_UUID = "77777777-7777-7777-7777-777777777777";

    const overlapChain = chainMock([]);
    const timeBlockChain = chainMock([]);
    // Promo code with expiresAt in the past
    const promoChain = chainMock([{
      promoCode: {
        id: PROMO_CODE_UUID,
        expiresAt: new Date("2020-01-01T00:00:00Z"),
        usageLimit: 100,
        usedCount: 5,
        promotionId: "promo-1",
      },
      promotion: {
        id: "promo-1",
        isActive: true,
      },
    }]);

    mockDbSelect
      .mockReturnValueOnce(overlapChain)
      .mockReturnValueOnce(timeBlockChain)
      .mockReturnValueOnce(promoChain);

    const request = createMockRequest("http://localhost:3000/api/appointments", {
      method: "POST",
      body: {
        salonId: TEST_IDS.SALON_UUID,
        employeeId: TEST_IDS.EMPLOYEE_UUID,
        startTime: "2026-04-01T10:00:00Z",
        endTime: "2026-04-01T11:00:00Z",
        promoCodeId: PROMO_CODE_UUID,
      },
    });

    const response = await createAppointment(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toContain("wygasl");
  });

  it("should return 400 when promo code usage limit is exhausted", async () => {
    const PROMO_CODE_UUID = "77777777-7777-7777-7777-777777777777";

    const overlapChain = chainMock([]);
    const timeBlockChain = chainMock([]);
    // Promo code with usedCount >= usageLimit
    const promoChain = chainMock([{
      promoCode: {
        id: PROMO_CODE_UUID,
        expiresAt: new Date("2027-01-01T00:00:00Z"),
        usageLimit: 10,
        usedCount: 10,
        promotionId: "promo-1",
      },
      promotion: {
        id: "promo-1",
        isActive: true,
      },
    }]);

    mockDbSelect
      .mockReturnValueOnce(overlapChain)
      .mockReturnValueOnce(timeBlockChain)
      .mockReturnValueOnce(promoChain);

    const request = createMockRequest("http://localhost:3000/api/appointments", {
      method: "POST",
      body: {
        salonId: TEST_IDS.SALON_UUID,
        employeeId: TEST_IDS.EMPLOYEE_UUID,
        startTime: "2026-04-01T10:00:00Z",
        endTime: "2026-04-01T11:00:00Z",
        promoCodeId: PROMO_CODE_UUID,
      },
    });

    const response = await createAppointment(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toContain("Limit uzycia");
  });

  it("should return 400 when linked promotion is inactive", async () => {
    const PROMO_CODE_UUID = "77777777-7777-7777-7777-777777777777";

    const overlapChain = chainMock([]);
    const timeBlockChain = chainMock([]);
    // Promo code with inactive promotion
    const promoChain = chainMock([{
      promoCode: {
        id: PROMO_CODE_UUID,
        expiresAt: new Date("2027-01-01T00:00:00Z"),
        usageLimit: 100,
        usedCount: 5,
        promotionId: "promo-1",
      },
      promotion: {
        id: "promo-1",
        isActive: false,
      },
    }]);

    mockDbSelect
      .mockReturnValueOnce(overlapChain)
      .mockReturnValueOnce(timeBlockChain)
      .mockReturnValueOnce(promoChain);

    const request = createMockRequest("http://localhost:3000/api/appointments", {
      method: "POST",
      body: {
        salonId: TEST_IDS.SALON_UUID,
        employeeId: TEST_IDS.EMPLOYEE_UUID,
        startTime: "2026-04-01T10:00:00Z",
        endTime: "2026-04-01T11:00:00Z",
        promoCodeId: PROMO_CODE_UUID,
      },
    });

    const response = await createAppointment(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toContain("nieaktywna");
  });

  it("should return 400 when promo code ID does not exist", async () => {
    const FAKE_PROMO_UUID = "88888888-8888-8888-8888-888888888888";

    const overlapChain = chainMock([]);
    const timeBlockChain = chainMock([]);
    // Promo code select returns empty (not found)
    const promoChain = chainMock([]);

    mockDbSelect
      .mockReturnValueOnce(overlapChain)
      .mockReturnValueOnce(timeBlockChain)
      .mockReturnValueOnce(promoChain);

    const request = createMockRequest("http://localhost:3000/api/appointments", {
      method: "POST",
      body: {
        salonId: TEST_IDS.SALON_UUID,
        employeeId: TEST_IDS.EMPLOYEE_UUID,
        startTime: "2026-04-01T10:00:00Z",
        endTime: "2026-04-01T11:00:00Z",
        promoCodeId: FAKE_PROMO_UUID,
      },
    });

    const response = await createAppointment(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toContain("Nieprawidlowy kod promocyjny");
  });

  it("should return 201 with guest fields and clientId='none'", async () => {
    const newAppointment = makeAppointment({
      clientId: null,
      guestName: "Guest User",
      guestPhone: "+48111222333",
      guestEmail: "guest@example.com",
    });

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
        startTime: "2026-04-01T10:00:00Z",
        endTime: "2026-04-01T11:00:00Z",
        clientId: "none",
        guestName: "Guest User",
        guestPhone: "+48111222333",
        guestEmail: "guest@example.com",
      },
    });

    const response = await createAppointment(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.data).toBeDefined();
  });

  // -------------------------------------------------------
  // Guest booking tests (no auth session)
  // -------------------------------------------------------

  it("should return 201 for guest booking with valid guestName and guestPhone", async () => {
    // Temporarily mock getOptionalSession to return null (guest)
    const { getOptionalSession } = await import("@/lib/session");
    vi.mocked(getOptionalSession).mockResolvedValueOnce(null);

    const newAppointment = makeAppointment({
      clientId: null,
      guestName: "Jan Kowalski",
      guestPhone: "123456789",
      bookedByUserId: null,
    });

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
        startTime: "2026-04-01T10:00:00Z",
        endTime: "2026-04-01T11:00:00Z",
        guestName: "Jan Kowalski",
        guestPhone: "123456789",
      },
    });

    const response = await createAppointment(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.data).toBeDefined();
  });

  it("should return 400 for guest booking without guestName", async () => {
    const { getOptionalSession } = await import("@/lib/session");
    vi.mocked(getOptionalSession).mockResolvedValueOnce(null);

    const request = createMockRequest("http://localhost:3000/api/appointments", {
      method: "POST",
      body: {
        salonId: TEST_IDS.SALON_UUID,
        employeeId: TEST_IDS.EMPLOYEE_UUID,
        startTime: "2026-04-01T10:00:00Z",
        endTime: "2026-04-01T11:00:00Z",
        guestPhone: "123456789",
      },
    });

    const response = await createAppointment(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toContain("Imię i nazwisko");
  });

  it("should return 400 for guest booking without guestPhone", async () => {
    const { getOptionalSession } = await import("@/lib/session");
    vi.mocked(getOptionalSession).mockResolvedValueOnce(null);

    const request = createMockRequest("http://localhost:3000/api/appointments", {
      method: "POST",
      body: {
        salonId: TEST_IDS.SALON_UUID,
        employeeId: TEST_IDS.EMPLOYEE_UUID,
        startTime: "2026-04-01T10:00:00Z",
        endTime: "2026-04-01T11:00:00Z",
        guestName: "Jan Kowalski",
      },
    });

    const response = await createAppointment(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toContain("numer telefonu");
  });

  it("should return 400 for guest booking with too short guestName", async () => {
    const { getOptionalSession } = await import("@/lib/session");
    vi.mocked(getOptionalSession).mockResolvedValueOnce(null);

    const request = createMockRequest("http://localhost:3000/api/appointments", {
      method: "POST",
      body: {
        salonId: TEST_IDS.SALON_UUID,
        employeeId: TEST_IDS.EMPLOYEE_UUID,
        startTime: "2026-04-01T10:00:00Z",
        endTime: "2026-04-01T11:00:00Z",
        guestName: "J",
        guestPhone: "123456789",
      },
    });

    const response = await createAppointment(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toContain("min. 2 znaki");
  });

  it("should return 429 when rate limited", async () => {
    const { strictRateLimit } = await import("@/lib/rate-limit");
    vi.mocked(strictRateLimit.check).mockReturnValueOnce({
      success: false,
      remaining: 0,
      reset: 30000,
    });

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

    expect(status).toBe(429);
    expect(body.success).toBe(false);
    expect(body.error).toContain("Zbyt wiele");
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

  it("should return 200 when updating only notes without changing times", async () => {
    const existing = makeAppointment();
    const updated = makeAppointment({ notes: "Updated notes" });

    // First select: find existing appointment
    const existChain = chainMock([existing]);
    // Second select: overlap check returns empty (uses existing times as fallback)
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
        notes: "Updated notes",
      },
    });
    const params = createRouteParams(TEST_IDS.APPOINTMENT_UUID);
    const response = await updateAppointment(request, params);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.message).toContain("rescheduled");
  });

  it("should return 500 when database throws during update", async () => {
    // First select: find existing appointment succeeds
    const existing = makeAppointment();
    const existChain = chainMock([existing]);
    // Second select: overlap check succeeds
    const overlapChain = chainMock([]);

    mockDbSelect
      .mockReturnValueOnce(existChain)
      .mockReturnValueOnce(overlapChain);

    // Update throws a database error
    const errorChain: Record<string, unknown> = {};
    const methods = ["update", "set", "where", "returning"];
    for (const method of methods) {
      (errorChain as Record<string, ReturnType<typeof vi.fn>>)[method] = vi.fn().mockReturnValue(errorChain);
    }
    errorChain.then = (_: unknown, reject: (err: Error) => void) => reject(new Error("DB update failed"));
    mockDbUpdate.mockReturnValue(errorChain);

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

    expect(status).toBe(500);
    expect(body.success).toBe(false);
    expect(body.error).toContain("Failed to update appointment");
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

  it("should process deposit refund when cancellation is >24h before appointment and deposit is paid", async () => {
    const appointment = makeAppointment({
      startTime: new Date(Date.now() + 48 * 60 * 60 * 1000), // 48h from now
      endTime: new Date(Date.now() + 49 * 60 * 60 * 1000),
      depositAmount: "100.00",
      depositPaid: true,
    });
    const client = makeClient();
    const employee = makeEmployee();
    const service = makeService();

    const cancelled = { ...appointment, status: "cancelled" };

    // Override processAutomaticRefund to return a successful refund
    mockProcessAutomaticRefund.mockResolvedValueOnce({
      success: true,
      refunded: true,
      refundId: "ref-1",
      amount: 100,
      message: "Refunded",
    });

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
    const details = (body as any).cancellationDetails;
    expect(details.depositRefunded).toBe(true);
    expect(details.depositForfeited).toBe(false);
    expect(details.isMoreThan24h).toBe(true);
    expect(details.hasDeposit).toBe(true);
    expect(details.depositPaid).toBe(true);
    expect(details.refund).toBeDefined();
    expect(details.refund.processed).toBe(true);
    expect(details.refund.refundId).toBe("ref-1");
    expect(details.refund.amount).toBe(100);
    // Verify processAutomaticRefund was called
    expect(mockProcessAutomaticRefund).toHaveBeenCalledWith(
      TEST_IDS.APPOINTMENT_UUID,
      expect.stringContaining("24h")
    );
    // Verify createRefundNotification was called for client
    expect(mockCreateRefundNotification).toHaveBeenCalled();
  });

  it("should skip deposit logic when appointment has no deposit at all", async () => {
    const appointment = makeAppointment({
      startTime: new Date(Date.now() + 48 * 60 * 60 * 1000), // 48h from now
      endTime: new Date(Date.now() + 49 * 60 * 60 * 1000),
      depositAmount: null,
      depositPaid: false,
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
    const details = (body as any).cancellationDetails;
    expect(details.hasDeposit).toBe(false);
    expect(details.depositRefunded).toBe(false);
    expect(details.depositForfeited).toBe(false);
    expect(details.refund).toBeNull();
    // processAutomaticRefund should NOT have been called
    expect(mockProcessAutomaticRefund).not.toHaveBeenCalled();
  });

  it("should create notification when notifyClient=true query param is set", async () => {
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
    // Insert: notification record
    mockDbInsert.mockReturnValueOnce(chainMock([]));
    // Select: get salon name for waiting list
    mockDbSelect.mockReturnValueOnce(chainMock([{ id: TEST_IDS.SALON_UUID, name: "Test Salon" }]));

    const request = createMockRequest(
      `http://localhost:3000/api/appointments/${TEST_IDS.APPOINTMENT_UUID}?notifyClient=true`
    );
    const params = createRouteParams(TEST_IDS.APPOINTMENT_UUID);
    const response = await deleteAppointment(request, params);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect((body as any).cancellationDetails.clientNotified).toBe(true);
    // Verify db.insert was called for the notification
    expect(mockDbInsert).toHaveBeenCalled();
  });

  it("should return 500 when database throws during deletion", async () => {
    // Select: simulate database error when fetching the appointment
    const errorChain: Record<string, unknown> = {};
    const methods = ["select", "from", "where", "leftJoin", "limit"];
    for (const method of methods) {
      (errorChain as Record<string, ReturnType<typeof vi.fn>>)[method] = vi.fn().mockReturnValue(errorChain);
    }
    errorChain.then = (_: unknown, reject: (err: Error) => void) => reject(new Error("DB delete failure"));
    mockDbSelect.mockReturnValue(errorChain);

    const request = createMockRequest(
      `http://localhost:3000/api/appointments/${TEST_IDS.APPOINTMENT_UUID}`
    );
    const params = createRouteParams(TEST_IDS.APPOINTMENT_UUID);
    const response = await deleteAppointment(request, params);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(500);
    expect(body.success).toBe(false);
    expect(body.error).toContain("Failed to cancel appointment");
  });
});
