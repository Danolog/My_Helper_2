/**
 * Integration tests for /api/appointments endpoints.
 *
 * Tests cover:
 * - GET /api/appointments (list with filtering)
 * - POST /api/appointments (create with validation, overlap check, time block check)
 * - GET /api/appointments/[id] (single appointment)
 * - PUT /api/appointments/[id] (reschedule with overlap check)
 * - DELETE /api/appointments/[id] (odwołanie przez salon: pełny zwrot, jeden SMS — refund-fix, #70)
 */
import { eq } from "drizzle-orm";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
import { matchesPredicate } from "./predicate-tree";
import { deadlock, wrapped } from "./deadlock-fixture";

// -------------------------------------------------------
// Mocks - must be declared before importing route handlers
// -------------------------------------------------------

// Mock the database module. Every db method returns a chainable mock.
const mockDbSelect = vi.fn();
const mockDbInsert = vi.fn();
const mockDbUpdate = vi.fn();
const mockDbDelete = vi.fn();

// `tx` deleguje do tych samych mocków co `db` — warstwa repo (forSalon) otwiera
// db.transaction() i woła tx.select/update/delete + tx.execute (SET LOCAL).
const mockTx = {
  select: (...args: unknown[]) => mockDbSelect(...args),
  insert: (...args: unknown[]) => mockDbInsert(...args),
  update: (...args: unknown[]) => mockDbUpdate(...args),
  delete: (...args: unknown[]) => mockDbDelete(...args),
  execute: vi.fn().mockResolvedValue(undefined),
};

// Dopasowanie karty z blokadą sprawdza online-booking-block.test.ts; tu tylko
// miejsce wywołania w trasie (domyślnie: brak blokady).
const mockBlockResponse = vi.fn(async (..._args: unknown[]): Promise<Response | null> => null);
vi.mock("@/lib/online-booking-block", () => ({
  onlineBookingBlockResponse: (...args: unknown[]) => mockBlockResponse(...args),
}));
vi.mock("@/lib/db", () => ({
  db: {
    select: (...args: unknown[]) => mockDbSelect(...args),
    insert: (...args: unknown[]) => mockDbInsert(...args),
    update: (...args: unknown[]) => mockDbUpdate(...args),
    delete: (...args: unknown[]) => mockDbDelete(...args),
    transaction: (fn: (tx: typeof mockTx) => unknown) => fn(mockTx),
  },
}));

// #193: prawdziwa warstwa repo (na atrapie db wyżej) z podglądem wywołań
// forSalon — test sprawdza, z jakim salonem POST otwiera kontekst RLS.
vi.mock("@/lib/server/repository", async (orig) => {
  const actual = await orig<typeof import("@/lib/server/repository")>();
  return { ...actual, forSalon: vi.fn(actual.forSalon) };
});

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

const mockSessionsExpire = vi.fn().mockResolvedValue({ status: "expired" });
vi.mock("@/lib/stripe", () => ({
  getStripe: () => ({ checkout: { sessions: { expire: (...args: unknown[]) => mockSessionsExpire(...args) } } }),
}));

vi.mock("@/lib/refund", () => ({
  refundAppointmentDeposits: (...args: unknown[]) => mockProcessAutomaticRefund(...args),
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
  // PUT: warunek „nie zakończona” w UPDATE zmieniającym coś poza notatkami.
  ne: vi.fn((...args: unknown[]) => ({ type: "ne", args })),
  // sql`...` (set_config) + sql.raw (SET LOCAL ROLE) — oba używa forSalon.
  sql: Object.assign(
    vi.fn((...args: unknown[]) => ({ type: "sql", args })),
    { raw: vi.fn((query: string) => ({ type: "sql.raw", query })) }
  ),
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

// Tenant isolation (P0-A): GET routes resolve the salon from the session.
vi.mock("@/lib/get-user-salon", () => ({
  getUserSalonId: vi.fn().mockResolvedValue(TEST_IDS.SALON_UUID),
  getUserSalon: vi.fn().mockResolvedValue({ id: TEST_IDS.SALON_UUID }),
}));

// Faza 3 (role): GET listy i trasy [id] przeszły na getSalonContext.
// Domyślnie właściciel — scenariusze właścicielskie przechodzą bez zmian.
vi.mock("@/lib/salon-context", () => ({
  getSalonContext: vi.fn().mockResolvedValue({
    salonId: TEST_IDS.SALON_UUID,
    role: "owner",
    employeeId: null,
    userId: "user-1",
  }),
  hasFeatureAccess: vi.fn(async (ctx: { role: string }) => ctx.role === "owner"),
}));

// P1 (audyt bezpieczeństwa): przynależność clientId/employeeId/serviceId do salonu.
// Helper ma własne testy (__tests__/lib/salon-refs.test.ts) — tu sprawdzamy,
// że trasa go woła z właściwymi id i honoruje odrzucenie. Domyślnie: OK (null).
const mockAssertSalonRefs = vi.fn(async (..._args: unknown[]): Promise<Response | null> => null);
vi.mock("@/lib/salon-refs", () => ({
  assertSalonRefs: (...args: unknown[]) => mockAssertSalonRefs(...args),
  SALON_REF_ERROR: "Nieprawidlowe dane dla tego salonu",
}));

// SMS potwierdzenia — atrapa (zero realnych wysyłek w testach).
const mockSendBookingSms = vi.fn(async (..._args: unknown[]) => undefined);
vi.mock("@/lib/sms", () => ({
  sendBookingConfirmationSms: (...args: unknown[]) => mockSendBookingSms(...args),
}));

// #63: strażnik zadatku testowany w appointments-deposit-guard.test.ts;
// tu domyślnie "można zapisać bez zadatku" (null).
const mockDepositGuard = vi.fn(async (..._args: unknown[]): Promise<Response | null> => null);
vi.mock("@/lib/deposit-guard", () => ({
  depositGuardResponse: (...args: unknown[]) => mockDepositGuard(...args),
}));

// Dziennik zmian zadatku (PUT owner_edit) — pomocnik ma własne testy
// (__tests__/lib/deposit-status-events.test.ts); tu: czy i z czym trasa go woła.
const mockRecordDepositStatusEvent = vi.fn(async (..._args: unknown[]): Promise<void> => undefined);
vi.mock("@/lib/deposit-status-events", () => ({
  recordDepositStatusEvent: (...args: unknown[]) => mockRecordDepositStatusEvent(...args),
}));

function salonRefRejection() {
  return new Response(
    JSON.stringify({ success: false, error: "Nieprawidlowe dane dla tego salonu" }),
    { status: 400, headers: { "Content-Type": "application/json" } }
  );
}

// -------------------------------------------------------
// Helper to build a chainable mock with specific result
// -------------------------------------------------------

function chainMock(result: unknown[] = []) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  const methods = [
    "select", "from", "where", "leftJoin", "innerJoin",
    "limit", "orderBy", "groupBy", "as",
    "insert", "values", "update", "set", "delete",
    "returning", "execute", "for",
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
// Import single appointment handlers
import {
  GET as getAppointment,
  PUT as updateAppointment,
  DELETE as deleteAppointment,
} from "@/app/api/appointments/[id]/route";
import { GET as listAppointments, POST as createAppointment } from "@/app/api/appointments/route";

// Mocked tenant resolver — referenced directly so cross-tenant tests can
// flip the resolved salon (simulate "the caller has no salon" / wrong tenant).
import { getSalonContext } from "@/lib/salon-context";
import { salonCancelToast } from "@/components/appointments/cancel-appointment-texts";
import { forSalon } from "@/lib/server/repository";
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

  it("should ignore a client-supplied salonId and scope by the session salon (P0-A)", async () => {
    // After the tenant-isolation fix the route derives the salon from the
    // session and ignores any salonId in the query string. A bogus query
    // salonId must NOT cause a 400 nor leak another salon's data.
    mockDbSelect.mockReturnValue(chainMock([]));

    const request = createMockRequest("http://localhost:3000/api/appointments?salonId=not-uuid");
    const response = await listAppointments(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(0);
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
    expect(body.error).toContain("Termin koliduje");
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

  // UAT X-2 (A9c): malformed UUID -> 400, nie 500 z bazy
  it("should return 400 for a malformed employeeId (not a UUID)", async () => {
    const request = createMockRequest("http://localhost:3000/api/appointments", {
      method: "POST",
      body: {
        salonId: TEST_IDS.SALON_UUID,
        employeeId: "not-a-uuid",
        startTime: "2026-04-01T10:00:00Z",
        endTime: "2026-04-01T11:00:00Z",
      },
    });

    const response = await createAppointment(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(400);
    expect(body.success).toBe(false);
    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  // UAT X-1: personel nie moze utworzyc wizyty w cudzym salonie
  it("should return 403 when staff passes a different salonId (cross-tenant)", async () => {
    // getSalonContext (mock) i getOptionalSession domyslnie: owner SALON_UUID
    const request = createMockRequest("http://localhost:3000/api/appointments", {
      method: "POST",
      body: {
        salonId: "99999999-9999-4999-8999-999999999999", // inny salon
        employeeId: TEST_IDS.EMPLOYEE_UUID,
        startTime: "2026-04-01T10:00:00Z",
        endTime: "2026-04-01T11:00:00Z",
      },
    });

    const response = await createAppointment(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(403);
    expect(body.success).toBe(false);
    expect(mockDbInsert).not.toHaveBeenCalled();
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
        salonId: TEST_IDS.SALON_UUID,
        expiresAt: new Date("2027-01-01T00:00:00Z"),
        usageLimit: 100,
        usedCount: 5,
        promotionId: "promo-1",
      },
      promotion: {
        id: "promo-1",
        salonId: TEST_IDS.SALON_UUID,
        type: "percentage",
        value: "20.00",
        isActive: true,
      },
    }]);
    // 4th select: service of this salon (price base for the discount)
    const serviceChain = chainMock([makeService()]);
    // insert: returns the new appointment
    const insertChain = chainMock([newAppointment]);
    // update: increment promo code usedCount
    const updatePromoChain = chainMock([]);

    mockDbSelect
      .mockReturnValueOnce(overlapChain)
      .mockReturnValueOnce(timeBlockChain)
      .mockReturnValueOnce(promoChain)
      .mockReturnValueOnce(serviceChain);
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
    // Discount computed by the server: 20% of 100 PLN
    expect(insertChain.values).toHaveBeenCalledWith(
      expect.objectContaining({ promoCodeId: PROMO_CODE_UUID, discountAmount: "20.00" })
    );
  });

  it("should return 400 when promo code is expired", async () => {
    const PROMO_CODE_UUID = "77777777-7777-7777-7777-777777777777";

    const overlapChain = chainMock([]);
    const timeBlockChain = chainMock([]);
    // Promo code with expiresAt in the past
    const promoChain = chainMock([{
      promoCode: {
        id: PROMO_CODE_UUID,
        salonId: TEST_IDS.SALON_UUID,
        expiresAt: new Date("2020-01-01T00:00:00Z"),
        usageLimit: 100,
        usedCount: 5,
        promotionId: "promo-1",
      },
      promotion: {
        id: "promo-1",
        salonId: TEST_IDS.SALON_UUID,
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
        salonId: TEST_IDS.SALON_UUID,
        expiresAt: new Date("2027-01-01T00:00:00Z"),
        usageLimit: 10,
        usedCount: 10,
        promotionId: "promo-1",
      },
      promotion: {
        id: "promo-1",
        salonId: TEST_IDS.SALON_UUID,
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
        salonId: TEST_IDS.SALON_UUID,
        expiresAt: new Date("2027-01-01T00:00:00Z"),
        usageLimit: 100,
        usedCount: 5,
        promotionId: "promo-1",
      },
      promotion: {
        id: "promo-1",
        salonId: TEST_IDS.SALON_UUID,
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
        serviceId: TEST_IDS.SERVICE_UUID, // #63: rezerwacja spoza personelu wskazuje usługę
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

  // -------------------------------------------------------
  // bookedByUserId: tylko z sesji. Wczesniej brany z body, wiec wizyte mozna
  // bylo przypisac do cudzego konta (portal klienta, odwolanie, opinia,
  // przypomnienia push trafialy do ofiary).
  // -------------------------------------------------------

  describe("bookedByUserId tylko z sesji", () => {
    const VICTIM_USER_ID = "victim-user-id";

    function arrangeInsert() {
      const insertChain = chainMock([makeAppointment()]);
      mockDbSelect
        .mockReturnValueOnce(chainMock([]))
        .mockReturnValueOnce(chainMock([]));
      mockDbInsert.mockReturnValue(insertChain);
      return insertChain;
    }

    function bookedByOf(insertChain: ReturnType<typeof chainMock>) {
      return (insertChain.values!.mock.calls[0]![0] as Record<string, unknown>).bookedByUserId;
    }

    // Domyślnie sesja = właściciel salonu wizyty (getSalonContext: OWNER_CTX).
    afterEach(() => {
      mockGetSalonContext.mockReset();
      mockGetSalonContext.mockResolvedValue(OWNER_CTX);
    });

    it("#193 personel (właściciel): bookedByUserId z body ignorowany, zapisany jest null", async () => {
      const insertChain = arrangeInsert();

      const response = await createAppointment(
        createMockRequest("http://localhost:3000/api/appointments", {
          method: "POST",
          body: {
            salonId: TEST_IDS.SALON_UUID,
            employeeId: TEST_IDS.EMPLOYEE_UUID,
            clientId: TEST_IDS.CLIENT_UUID,
            startTime: "2026-04-01T10:00:00Z",
            endTime: "2026-04-01T11:00:00Z",
            bookedByUserId: VICTIM_USER_ID,
          },
        })
      );

      expect(response.status).toBe(201);
      expect(bookedByOf(insertChain)).toBeNull();
    });

    it("#193 personel (pracownik): wizyta z panelu nie dostaje userId pracownika", async () => {
      mockGetSalonContext.mockResolvedValue(EMPLOYEE_CTX);
      const insertChain = arrangeInsert();

      const response = await createAppointment(
        createMockRequest("http://localhost:3000/api/appointments", {
          method: "POST",
          body: {
            salonId: TEST_IDS.SALON_UUID,
            employeeId: TEST_IDS.EMPLOYEE_UUID,
            clientId: TEST_IDS.CLIENT_UUID,
            startTime: "2026-04-01T10:00:00Z",
            endTime: "2026-04-01T11:00:00Z",
          },
        })
      );

      expect(response.status).toBe(201);
      expect(bookedByOf(insertChain)).toBeNull();
    });

    it("#193 klient portalu (bez kontekstu salonu): zapisany jest uzytkownik sesji, body ignorowane", async () => {
      mockGetSalonContext.mockResolvedValue(null);
      const insertChain = arrangeInsert();

      const response = await createAppointment(
        createMockRequest("http://localhost:3000/api/appointments", {
          method: "POST",
          body: {
            salonId: TEST_IDS.SALON_UUID,
            employeeId: TEST_IDS.EMPLOYEE_UUID,
            serviceId: TEST_IDS.SERVICE_UUID, // #63: rezerwacja spoza personelu wskazuje usługę
            startTime: "2026-04-01T10:00:00Z",
            endTime: "2026-04-01T11:00:00Z",
            bookedByUserId: VICTIM_USER_ID,
          },
        })
      );

      expect(response.status).toBe(201);
      expect(bookedByOf(insertChain)).toBe("test-user-id");
    });

    it("#193 klient portalu bez bookedByUserId w body: zapisany jest uzytkownik sesji", async () => {
      mockGetSalonContext.mockResolvedValue(null);
      const insertChain = arrangeInsert();

      const response = await createAppointment(
        createMockRequest("http://localhost:3000/api/appointments", {
          method: "POST",
          body: {
            salonId: TEST_IDS.SALON_UUID,
            employeeId: TEST_IDS.EMPLOYEE_UUID,
            serviceId: TEST_IDS.SERVICE_UUID,
            startTime: "2026-04-01T10:00:00Z",
            endTime: "2026-04-01T11:00:00Z",
          },
        })
      );

      expect(response.status).toBe(201);
      expect(bookedByOf(insertChain)).toBe("test-user-id");
    });

    it("gosc: bookedByUserId z body jest ignorowany, zapisany jest null", async () => {
      const { getOptionalSession } = await import("@/lib/session");
      vi.mocked(getOptionalSession).mockResolvedValueOnce(null);
      const insertChain = arrangeInsert();

      const response = await createAppointment(
        createMockRequest("http://localhost:3000/api/appointments", {
          method: "POST",
          body: {
            salonId: TEST_IDS.SALON_UUID,
            employeeId: TEST_IDS.EMPLOYEE_UUID,
            serviceId: TEST_IDS.SERVICE_UUID, // #63: rezerwacja spoza personelu wskazuje usługę
            startTime: "2026-04-01T10:00:00Z",
            endTime: "2026-04-01T11:00:00Z",
            guestName: "Jan Kowalski",
            guestPhone: "123456789",
            bookedByUserId: VICTIM_USER_ID,
          },
        })
      );

      expect(response.status).toBe(201);
      expect(bookedByOf(insertChain)).toBeNull();
    });

    it("#193 personel bez bookedByUserId w body: zapisany jest null", async () => {
      const insertChain = arrangeInsert();

      const response = await createAppointment(
        createMockRequest("http://localhost:3000/api/appointments", {
          method: "POST",
          body: {
            salonId: TEST_IDS.SALON_UUID,
            employeeId: TEST_IDS.EMPLOYEE_UUID,
            startTime: "2026-04-01T10:00:00Z",
            endTime: "2026-04-01T11:00:00Z",
          },
        })
      );

      expect(response.status).toBe(201);
      expect(bookedByOf(insertChain)).toBeNull();
    });
  });

  it("should return 429 for a GUEST when strict rate limit is exceeded", async () => {
    // Guest (no session) uses the strict limiter (5/min anti-abuse)
    const { getOptionalSession } = await import("@/lib/session");
    vi.mocked(getOptionalSession).mockResolvedValueOnce(null);
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

  // UAT S-1: strictRateLimit (5/min) bylo sprawdzane przed auth i blokowalo
  // zalogowanego wlasciciela/recepcje zapelniajacych kalendarz.
  it("does NOT apply the strict guest limiter to an authenticated user", async () => {
    const { strictRateLimit, apiRateLimit } = await import("@/lib/rate-limit");
    // Strict limiter would block (guest cap) — must be ignored for a logged-in user
    vi.mocked(strictRateLimit.check).mockReturnValue({
      success: false,
      remaining: 0,
      reset: 30000,
    });
    vi.mocked(apiRateLimit.check).mockReturnValue({
      success: true,
      remaining: 59,
      reset: 60000,
    });
    // getOptionalSession defaults to an authenticated user (mock at top of file)

    mockDbSelect
      .mockReturnValueOnce(chainMock([])) // overlap check
      .mockReturnValueOnce(chainMock([])); // time block check
    mockDbInsert.mockReturnValue(chainMock([makeAppointment()]));

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
    const { status } = await parseResponse(response);

    expect(status).toBe(201);
    expect(apiRateLimit.check).toHaveBeenCalled();
  });

  it("returns 429 for an authenticated user only when the api limiter is exhausted", async () => {
    const { apiRateLimit } = await import("@/lib/rate-limit");
    vi.mocked(apiRateLimit.check).mockReturnValueOnce({
      success: false,
      remaining: 0,
      reset: 60000,
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
  });
});

// -------------------------------------------------------
// P1 (audyt bezpieczeństwa): rabat wizyty liczy serwer, nie klient.
// Publiczny POST zapisywal discountAmount prosto z zadania, a promoCodeId
// szukal bez zawezenia do salonu wizyty. Kwota rabatu wplywa na punkty
// lojalnosciowe przy zakonczeniu wizyty i na statystyki przychodu.
// -------------------------------------------------------

describe("POST /api/appointments — rabat liczony przez serwer (P1)", () => {
  const PROMO_CODE_UUID = "77777777-7777-4777-8777-777777777777";
  const OTHER_SALON_UUID = "99999999-9999-4999-8999-999999999999";

  type PromoRowOverrides = {
    promoCode?: Record<string, unknown>;
    promotion?: Record<string, unknown> | null;
  };

  function promoRow(overrides: PromoRowOverrides = {}) {
    return {
      promoCode: {
        id: PROMO_CODE_UUID,
        salonId: TEST_IDS.SALON_UUID,
        code: "LATO10",
        expiresAt: new Date("2099-01-01T00:00:00Z"),
        usageLimit: 100,
        usedCount: 5,
        promotionId: "promo-1",
        ...overrides.promoCode,
      },
      promotion:
        overrides.promotion === null
          ? null
          : {
              id: "promo-1",
              salonId: TEST_IDS.SALON_UUID,
              type: "percentage",
              value: "10.00",
              isActive: true,
              startDate: null,
              endDate: null,
              conditionsJson: {},
              ...overrides.promotion,
            },
    };
  }

  /** Kolejnosc selectow: overlap, blokady czasu, kod promocyjny, usluga. */
  function arrangeBooking(row: unknown | null, service: unknown | null = makeService()) {
    const insertChain = chainMock([makeAppointment()]);
    mockDbSelect
      .mockReturnValueOnce(chainMock([]))
      .mockReturnValueOnce(chainMock([]))
      .mockReturnValueOnce(chainMock(row ? [row] : []))
      .mockReturnValueOnce(chainMock(service ? [service] : []));
    mockDbInsert.mockReturnValue(insertChain);
    mockDbUpdate.mockReturnValue(chainMock([]));
    return insertChain;
  }

  function bookingRequest(extra: Record<string, unknown>) {
    return createMockRequest("http://localhost:3000/api/appointments", {
      method: "POST",
      body: {
        salonId: TEST_IDS.SALON_UUID,
        employeeId: TEST_IDS.EMPLOYEE_UUID,
        serviceId: TEST_IDS.SERVICE_UUID,
        clientId: TEST_IDS.CLIENT_UUID,
        startTime: "2026-04-01T10:00:00Z",
        endTime: "2026-04-01T11:00:00Z",
        ...extra,
      },
    });
  }

  function insertedValues(insertChain: ReturnType<typeof chainMock>) {
    return insertChain.values!.mock.calls[0]![0] as Record<string, unknown>;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockDbSelect.mockReset();
    mockDbInsert.mockReset();
    mockDbUpdate.mockReset();
  });

  it("ignoruje discountAmount z zadania i zapisuje rabat policzony z promocji (10% z 100 zl = 10.00)", async () => {
    const insertChain = arrangeBooking(promoRow());

    const response = await createAppointment(
      bookingRequest({ promoCodeId: PROMO_CODE_UUID, discountAmount: "99.00" })
    );

    expect(response.status).toBe(201);
    expect(insertedValues(insertChain).discountAmount).toBe("10.00");
    expect(insertedValues(insertChain).promoCodeId).toBe(PROMO_CODE_UUID);
  });

  it("odrzuca kod promocyjny innego salonu (400, bez zapisu i bez zuzycia kodu)", async () => {
    arrangeBooking(
      promoRow({
        promoCode: { salonId: OTHER_SALON_UUID },
        promotion: { salonId: OTHER_SALON_UUID },
      })
    );

    const response = await createAppointment(
      bookingRequest({ promoCodeId: PROMO_CODE_UUID, discountAmount: "50.00" })
    );
    const { status, body } = await parseResponse(response);

    expect(status).toBe(400);
    expect(body.error).toContain("Nieprawidlowy kod promocyjny");
    expect(mockDbInsert).not.toHaveBeenCalled();
    expect(mockDbUpdate).not.toHaveBeenCalled();
  });

  it("zaweza wyszukanie kodu promocyjnego do salonu wizyty w zapytaniu", async () => {
    arrangeBooking(promoRow());

    await createAppointment(bookingRequest({ promoCodeId: PROMO_CODE_UUID }));

    expect(vi.mocked(eq)).toHaveBeenCalledWith("promoCodes.salonId", TEST_IDS.SALON_UUID);
  });

  it("bez kodu promocyjnego discountAmount z zadania jest ignorowany (null)", async () => {
    const insertChain = arrangeBooking(null);

    const response = await createAppointment(bookingRequest({ discountAmount: "40.00" }));

    expect(response.status).toBe(201);
    expect(insertedValues(insertChain).discountAmount).toBeNull();
    expect(insertedValues(insertChain).promoCodeId).toBeNull();
  });

  it("rabat kwotowy wiekszy niz cena uslugi jest obcinany do ceny (150 zl na 100 zl = 100.00)", async () => {
    const insertChain = arrangeBooking(promoRow({ promotion: { type: "fixed", value: "150.00" } }));

    const response = await createAppointment(
      bookingRequest({ promoCodeId: PROMO_CODE_UUID, discountAmount: "150.00" })
    );

    expect(response.status).toBe(201);
    expect(insertedValues(insertChain).discountAmount).toBe("100.00");
  });

  it("rabat procentowy ponad 100% jest obcinany do ceny uslugi", async () => {
    const insertChain = arrangeBooking(promoRow({ promotion: { value: "150.00" } }));

    const response = await createAppointment(bookingRequest({ promoCodeId: PROMO_CODE_UUID }));

    expect(response.status).toBe(201);
    expect(insertedValues(insertChain).discountAmount).toBe("100.00");
  });

  it("kod bez powiazanej promocji: zapisuje kod, rabat null mimo kwoty w zadaniu", async () => {
    const insertChain = arrangeBooking(promoRow({ promotion: null, promoCode: { promotionId: null } }));

    const response = await createAppointment(
      bookingRequest({ promoCodeId: PROMO_CODE_UUID, discountAmount: "30.00" })
    );

    expect(response.status).toBe(201);
    expect(insertedValues(insertChain).promoCodeId).toBe(PROMO_CODE_UUID);
    expect(insertedValues(insertChain).discountAmount).toBeNull();
  });

  it.each(["happy_hours", "package", "buy2get1", "first_visit"])(
    "odrzuca kod powiazany z promocja typu zamrozonego %s (B2), bez zapisu",
    async (type) => {
      arrangeBooking(promoRow({ promotion: { type } }));

      const response = await createAppointment(bookingRequest({ promoCodeId: PROMO_CODE_UUID }));
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe("Promocja powiazana z kodem jest obecnie niedostepna");
      expect(mockDbInsert).not.toHaveBeenCalled();
    }
  );

  it("odrzuca kod, gdy powiazana promocja jest nieaktywna", async () => {
    arrangeBooking(promoRow({ promotion: { isActive: false } }));

    const response = await createAppointment(bookingRequest({ promoCodeId: PROMO_CODE_UUID }));

    expect(response.status).toBe(400);
    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  it("odrzuca kod, gdy powiazana promocja juz sie zakonczyla", async () => {
    arrangeBooking(promoRow({ promotion: { endDate: new Date("2020-01-01T00:00:00Z") } }));

    const response = await createAppointment(bookingRequest({ promoCodeId: PROMO_CODE_UUID }));

    expect(response.status).toBe(400);
    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  it("odrzuca kod, gdy promocja jeszcze sie nie rozpoczela", async () => {
    arrangeBooking(promoRow({ promotion: { startDate: new Date("2099-01-01T00:00:00Z") } }));

    const response = await createAppointment(bookingRequest({ promoCodeId: PROMO_CODE_UUID }));

    expect(response.status).toBe(400);
    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  it("odrzuca kod, ktory nie dotyczy wybranej uslugi (applicableServiceIds)", async () => {
    arrangeBooking(
      promoRow({ promotion: { conditionsJson: { applicableServiceIds: ["inna-usluga"] } } })
    );

    const response = await createAppointment(bookingRequest({ promoCodeId: PROMO_CODE_UUID }));

    expect(response.status).toBe(400);
    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  it("odrzuca kod bez wybranej uslugi (brak ceny, od ktorej liczyc rabat)", async () => {
    arrangeBooking(promoRow());

    const response = await createAppointment(
      bookingRequest({ serviceId: null, promoCodeId: PROMO_CODE_UUID, discountAmount: "20.00" })
    );

    expect(response.status).toBe(400);
    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  it("odrzuca kod, gdy usluga nie nalezy do salonu wizyty", async () => {
    arrangeBooking(promoRow(), null);

    const response = await createAppointment(bookingRequest({ promoCodeId: PROMO_CODE_UUID }));

    expect(response.status).toBe(400);
    expect(mockDbInsert).not.toHaveBeenCalled();
  });
});

// -------------------------------------------------------
// P1 (audyt bezpieczeństwa): clientId/employeeId/serviceId z body POST musza nalezec do
// salonu wizyty; gosc nie podpina cudzego klienta; depositAmount z body
// ignorowany (zadatek tylko przez /api/deposits/create-session).
// -------------------------------------------------------

describe("POST /api/appointments — referencje z body nalezace do salonu (P1)", () => {
  const FOREIGN_CLIENT_UUID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

  function arrange() {
    const insertChain = chainMock([makeAppointment()]);
    mockDbSelect
      .mockReturnValueOnce(chainMock([])) // overlap
      .mockReturnValueOnce(chainMock([])) // blokady czasu
      .mockReturnValue(chainMock([])); // szczegoly do SMS
    mockDbInsert.mockReturnValue(insertChain);
    return insertChain;
  }

  function req(extra: Record<string, unknown> = {}) {
    return createMockRequest("http://localhost:3000/api/appointments", {
      method: "POST",
      body: {
        salonId: TEST_IDS.SALON_UUID,
        employeeId: TEST_IDS.EMPLOYEE_UUID,
        serviceId: TEST_IDS.SERVICE_UUID,
        clientId: TEST_IDS.CLIENT_UUID,
        startTime: "2026-04-01T10:00:00Z",
        endTime: "2026-04-01T11:00:00Z",
        ...extra,
      },
    });
  }

  function inserted(insertChain: ReturnType<typeof chainMock>) {
    return insertChain.values!.mock.calls[0]![0] as Record<string, unknown>;
  }

  async function asGuest() {
    const { getOptionalSession } = await import("@/lib/session");
    vi.mocked(getOptionalSession).mockResolvedValueOnce(null);
    // Wczesniejsze testy limitu (429) zostawiaja strict limiter wyczerpany.
    const { strictRateLimit } = await import("@/lib/rate-limit");
    vi.mocked(strictRateLimit.check).mockReturnValue({ success: true, remaining: 4, reset: 60000 });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockDbSelect.mockReset();
    mockDbInsert.mockReset();
    mockGetSalonContext.mockResolvedValue(OWNER_CTX);
  });

  // Niezuzyte mockReturnValueOnce nie moga przeciec do kolejnych describe.
  afterEach(() => {
    mockDbSelect.mockReset();
    mockDbInsert.mockReset();
    mockAssertSalonRefs.mockReset();
    mockAssertSalonRefs.mockImplementation(async () => null);
    mockGetSalonContext.mockReset();
    mockGetSalonContext.mockResolvedValue(OWNER_CTX);
  });

  it("personel: sprawdza clientId, employeeId i serviceId w salonie wizyty", async () => {
    arrange();
    const res = await createAppointment(req());
    expect(res.status).toBe(201);
    expect(mockAssertSalonRefs).toHaveBeenCalledWith(TEST_IDS.SALON_UUID, {
      clientId: TEST_IDS.CLIENT_UUID,
      employeeId: TEST_IDS.EMPLOYEE_UUID,
      serviceId: TEST_IDS.SERVICE_UUID,
      variantId: null,
    });
  });

  it("obcy clientId/employeeId/serviceId -> 400, bez sprawdzania kolizji, zapisu i SMS", async () => {
    mockAssertSalonRefs.mockResolvedValueOnce(salonRefRejection());
    arrange();
    const res = await createAppointment(req({ clientId: FOREIGN_CLIENT_UUID }));
    const { status, body } = await parseResponse(res);
    expect(status).toBe(400);
    expect(body).toEqual({ success: false, error: "Nieprawidlowe dane dla tego salonu" });
    expect(mockDbSelect).not.toHaveBeenCalled();
    expect(mockDbInsert).not.toHaveBeenCalled();
    expect(mockSendBookingSms).not.toHaveBeenCalled();
  });

  it("gosc: obcy employeeId (inny salon) -> 400 — nie blokuje kalendarza innego salonu", async () => {
    await asGuest();
    mockAssertSalonRefs.mockResolvedValueOnce(salonRefRejection());
    arrange();
    const res = await createAppointment(
      req({ clientId: undefined, guestName: "Jan Kowalski", guestPhone: "123456789" })
    );
    expect(res.status).toBe(400);
    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  it("gosc: clientId z body jest ignorowany (zapis null, nie sprawdzany, SMS na telefon goscia)", async () => {
    await asGuest();
    // Szczegoly do SMS: brak klienta (clientId null) -> telefon goscia
    const insertChain = chainMock([makeAppointment({ clientId: null })]);
    mockDbSelect
      .mockReturnValueOnce(chainMock([]))
      .mockReturnValueOnce(chainMock([]))
      .mockReturnValueOnce(
        chainMock([
          {
            clientFirstName: null,
            clientPhone: null,
            serviceName: "Strzyzenie",
            employeeFirstName: "Anna",
            employeeLastName: "Nowak",
            salonName: "Salon",
          },
        ])
      );
    mockDbInsert.mockReturnValue(insertChain);

    const res = await createAppointment(
      req({ clientId: FOREIGN_CLIENT_UUID, guestName: "Jan Kowalski", guestPhone: "123456789" })
    );

    expect(res.status).toBe(201);
    expect(inserted(insertChain).clientId).toBeNull();
    expect(mockAssertSalonRefs).toHaveBeenCalledWith(TEST_IDS.SALON_UUID, {
      clientId: null,
      employeeId: TEST_IDS.EMPLOYEE_UUID,
      serviceId: TEST_IDS.SERVICE_UUID,
      variantId: null,
    });
    expect(mockSendBookingSms).toHaveBeenCalledTimes(1);
    const sms = mockSendBookingSms.mock.calls[0]![0] as Record<string, unknown>;
    expect(sms.clientPhone).toBe("+48123456789"); // #64 pkt 4: zapis i SMS w E.164
    expect(sms).not.toHaveProperty("clientId");
  });

  it("zalogowany klient portalu (bez kontekstu salonu): clientId z body ignorowany", async () => {
    mockGetSalonContext.mockResolvedValueOnce(null);
    const insertChain = arrange();
    const res = await createAppointment(req({ clientId: FOREIGN_CLIENT_UUID }));
    expect(res.status).toBe(201);
    expect(inserted(insertChain).clientId).toBeNull();
  });

  it("clientId 'none' (sentinel) zapisuje null", async () => {
    const insertChain = arrange();
    const res = await createAppointment(req({ clientId: "none" }));
    expect(res.status).toBe(201);
    expect(inserted(insertChain).clientId).toBeNull();
  });

  it("depositAmount z body jest ignorowany (null) i nie wylacza potwierdzenia SMS", async () => {
    const insertChain = chainMock([makeAppointment({ depositAmount: null })]);
    mockDbSelect
      .mockReturnValueOnce(chainMock([]))
      .mockReturnValueOnce(chainMock([]))
      .mockReturnValueOnce(
        chainMock([
          {
            clientFirstName: "Ewa",
            clientPhone: "500600700",
            serviceName: "Strzyzenie",
            employeeFirstName: "Anna",
            employeeLastName: "Nowak",
            salonName: "Salon",
          },
        ])
      );
    mockDbInsert.mockReturnValue(insertChain);

    const res = await createAppointment(req({ depositAmount: "0.01" }));

    expect(res.status).toBe(201);
    expect(inserted(insertChain).depositAmount).toBeNull();
    expect(mockSendBookingSms).toHaveBeenCalledTimes(1);
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
      .mockReturnValueOnce(overlapChain)
      .mockReturnValueOnce(chainMock([])); // blokady czasu (#168): termin się zmienia
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
    expect(body.error).toContain("Termin koliduje");
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

  // Audyt bezpieczeństwa (hotfix P1, dane osobowe w logach): PUT logował cały updateData —
  // z wolnym tekstem notatki o kliencie — do logów produkcyjnych.
  it("PII: log aktualizacji wizyty nie zawiera treści notatki, tylko nazwy pól", async () => {
    const PII_NOTE = "Anna Kowalska, tel. 600123456, alergia na lateks";
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {})
    );
    try {
      mockDbSelect
        .mockReturnValueOnce(chainMock([makeAppointment()]))
        .mockReturnValueOnce(chainMock([]));
      mockDbUpdate.mockReturnValue(chainMock([makeAppointment({ notes: PII_NOTE })]));

      const request = createMockRequest(`http://localhost:3000/api/appointments/${TEST_IDS.APPOINTMENT_UUID}`, {
        method: "PUT",
        body: { notes: PII_NOTE },
      });
      const response = await updateAppointment(request, createRouteParams(TEST_IDS.APPOINTMENT_UUID));
      expect(response.status).toBe(200);

      const logged = spies.flatMap((s) => s.mock.calls).map((args) => JSON.stringify(args)).join("\n");
      expect(logged).toContain("Updating appointment");
      expect(logged).toContain("notes");
      expect(logged).not.toContain("Kowalska");
      expect(logged).not.toContain("600123456");
    } finally {
      spies.forEach((s) => s.mockRestore());
    }
  });

  // Audyt bezpieczeństwa (przegląd #90): zapis czyta sparsowane dane, nie surowe body —
  // preprocess schematu zamienia same spacje na null.
  it.each([
    ["same spacje", "   ", null],
    ["pusty tekst", "", null],
    ["null", null, null],
    ["treść", "Alergia", "Alergia"],
  ])("PUT notes: %s (wejście %j) => zapisuje %j", async (_name, notes, saved) => {
    const updateChain = chainMock([makeAppointment()]);
    mockDbSelect
      .mockReturnValueOnce(chainMock([makeAppointment()]))
      .mockReturnValueOnce(chainMock([]));
    mockDbUpdate.mockReturnValue(updateChain);

    const request = createMockRequest(`http://localhost:3000/api/appointments/${TEST_IDS.APPOINTMENT_UUID}`, {
      method: "PUT",
      body: { notes },
    });
    const response = await updateAppointment(request, createRouteParams(TEST_IDS.APPOINTMENT_UUID));

    expect(response.status).toBe(200);
    expect(updateChain.set).toHaveBeenCalledWith(expect.objectContaining({ notes: saved }));
  });

  // #95: data bez strefy => 400 przed jakimkolwiek zapytaniem.
  it.each([
    ["startTime", { startTime: "2026-04-01T14:00:00", endTime: "2026-04-01T15:00:00Z" }],
    ["endTime", { startTime: "2026-04-01T14:00:00Z", endTime: "2026-04-01T15:00" }],
  ])("PUT %s bez strefy => 400, bez zapisu", async (field, body) => {
    const request = createMockRequest(`http://localhost:3000/api/appointments/${TEST_IDS.APPOINTMENT_UUID}`, {
      method: "PUT",
      body,
    });
    const response = await updateAppointment(request, createRouteParams(TEST_IDS.APPOINTMENT_UUID));
    const { status, body: res } = await parseResponse(response);

    expect(status).toBe(400);
    expect(res.details).toHaveProperty(field as string);
    expect(mockDbSelect).not.toHaveBeenCalled();
    expect(mockDbUpdate).not.toHaveBeenCalled();
  });

  it("PUT bez pola notes nie rusza notatek", async () => {
    const updateChain = chainMock([makeAppointment()]);
    mockDbSelect
      .mockReturnValueOnce(chainMock([makeAppointment()]))
      .mockReturnValueOnce(chainMock([]));
    mockDbUpdate.mockReturnValue(updateChain);

    const request = createMockRequest(`http://localhost:3000/api/appointments/${TEST_IDS.APPOINTMENT_UUID}`, {
      method: "PUT",
      body: { startTime: "2026-04-01T14:00:00Z", endTime: "2026-04-01T15:00:00Z" },
    });
    const response = await updateAppointment(request, createRouteParams(TEST_IDS.APPOINTMENT_UUID));

    expect(response.status).toBe(200);
    expect(updateChain.set!.mock.calls[0]![0]).not.toHaveProperty("notes");
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

// -------------------------------------------------------
// P1 (audyt bezpieczeństwa): PUT — clientId/employeeId/serviceId z body musza nalezec do
// salonu; depositAmount/depositPaid zmienia tylko wlasciciel (pracownik nie
// "oplaca" zadatku recznie; normalnie ustawia go potwierdzenie platnosci).
// -------------------------------------------------------

describe("PUT /api/appointments/[id] — referencje i zadatek (P1)", () => {
  const RECEPTION_CTX = { ...EMPLOYEE_CTX, role: "receptionist" as const, employeeId: null };

  function arrange() {
    const updateChain = chainMock([makeAppointment()]);
    mockDbSelect
      .mockReturnValueOnce(chainMock([makeAppointment()])) // findOne
      .mockReturnValueOnce(chainMock([])) // overlap
      .mockReturnValueOnce(chainMock([])); // blokady czasu (#168), gdy termin się zmienia
    mockDbUpdate.mockReturnValue(updateChain);
    return updateChain;
  }

  function put(body: Record<string, unknown>) {
    return updateAppointment(
      createMockRequest(`http://localhost:3000/api/appointments/${TEST_IDS.APPOINTMENT_UUID}`, {
        method: "PUT",
        body,
      }),
      createRouteParams(TEST_IDS.APPOINTMENT_UUID)
    );
  }

  function updated(updateChain: ReturnType<typeof chainMock>) {
    return updateChain.set!.mock.calls[0]![0] as Record<string, unknown>;
  }

  /**
   * PUT z `depositPaid` (termin bez zmian, więc bez blokad czasu):
   * findOne → kolizja → odczyt `depositPaid` z blokadą wiersza → update.
   * `locked`: wartość w zablokowanym wierszu albo "missing" (brak wiersza).
   */
  function arrangeDeposit(locked: boolean | null | "missing", existingPaid: boolean | null = false) {
    const lockedChain = chainMock(locked === "missing" ? [] : [{ depositPaid: locked }]);
    const updateChain = chainMock([makeAppointment()]);
    mockDbSelect
      .mockReturnValueOnce(chainMock([makeAppointment({ depositPaid: existingPaid })])) // findOne
      .mockReturnValueOnce(chainMock([])) // overlap
      .mockReturnValueOnce(lockedChain); // odczyt z blokadą
    mockDbUpdate.mockReturnValue(updateChain);
    return { lockedChain, updateChain };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockDbSelect.mockReset();
    mockDbUpdate.mockReset();
    mockGetSalonContext.mockResolvedValue(OWNER_CTX);
    mockRecordDepositStatusEvent.mockReset();
    mockRecordDepositStatusEvent.mockResolvedValue(undefined);
  });

  afterEach(() => {
    mockDbSelect.mockReset();
    mockDbUpdate.mockReset();
    mockAssertSalonRefs.mockReset();
    mockAssertSalonRefs.mockImplementation(async () => null);
    mockGetSalonContext.mockReset();
    mockGetSalonContext.mockResolvedValue(OWNER_CTX);
  });

  it("sprawdza clientId, employeeId i serviceId w salonie z sesji", async () => {
    arrange();
    const res = await put({
      clientId: TEST_IDS.CLIENT_UUID,
      employeeId: TEST_IDS.EMPLOYEE_UUID,
      serviceId: TEST_IDS.SERVICE_UUID,
    });
    expect(res.status).toBe(200);
    expect(mockAssertSalonRefs).toHaveBeenCalledWith(TEST_IDS.SALON_UUID, {
      clientId: TEST_IDS.CLIENT_UUID,
      employeeId: TEST_IDS.EMPLOYEE_UUID,
      serviceId: TEST_IDS.SERVICE_UUID,
    });
  });

  it("obcy clientId/employeeId/serviceId -> 400 i brak zapisu", async () => {
    mockAssertSalonRefs.mockResolvedValueOnce(salonRefRejection());
    arrange();
    const res = await put({ employeeId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" });
    const { status, body } = await parseResponse(res);
    expect(status).toBe(400);
    expect(body).toEqual({ success: false, error: "Nieprawidlowe dane dla tego salonu" });
    expect(mockDbUpdate).not.toHaveBeenCalled();
  });

  it("wyczyszczenie klienta/uslugi (null) nadal dziala", async () => {
    const updateChain = arrange();
    const res = await put({ clientId: null, serviceId: null });
    expect(res.status).toBe(200);
    expect(updated(updateChain)).toMatchObject({ clientId: null, serviceId: null });
  });

  it.each([
    ["pracownik", "depositPaid", true],
    ["pracownik", "depositAmount", "0.01"],
    ["recepcja", "depositPaid", true],
    ["recepcja", "depositAmount", null],
  ])("%s ustawiajacy %s -> 403, brak zapisu", async (who, field, value) => {
    mockGetSalonContext.mockResolvedValue(who === "pracownik" ? EMPLOYEE_CTX : RECEPTION_CTX);
    arrange();
    const res = await put({ [field]: value });
    expect(res.status).toBe(403);
    expect(mockDbUpdate).not.toHaveBeenCalled();
    expect(mockRecordDepositStatusEvent).not.toHaveBeenCalled();
  });

  it("wlasciciel moze ustawic depositPaid (reczne rozliczenie)", async () => {
    const { updateChain } = arrangeDeposit(false);
    const res = await put({ depositPaid: true });
    expect(res.status).toBe(200);
    expect(updated(updateChain).depositPaid).toBe(true);
  });

  it("owner depositPaid false→true: wpis owner_edit z odczytu z blokadą wiersza", async () => {
    const { lockedChain } = arrangeDeposit(false);
    const res = await put({ depositPaid: true });

    expect(res.status).toBe(200);
    expect(lockedChain.for).toHaveBeenCalledWith("update");
    expect(lockedChain.where).toHaveBeenCalledWith({
      type: "and",
      args: [
        { type: "eq", args: ["appointments.id", TEST_IDS.APPOINTMENT_UUID] },
        { type: "eq", args: ["appointments.salonId", TEST_IDS.SALON_UUID] },
      ],
    });
    expect(mockRecordDepositStatusEvent).toHaveBeenCalledTimes(1);
    const [tx, input] = mockRecordDepositStatusEvent.mock.calls[0]!;
    expect(tx).toBe(mockTx);
    expect(input).toEqual({
      salonId: TEST_IDS.SALON_UUID,
      appointmentId: TEST_IDS.APPOINTMENT_UUID,
      previousDepositPaid: false,
      depositPaid: true,
      source: "owner_edit",
      actor: { userId: OWNER_CTX.userId, role: "owner" },
    });
  });

  it("owner depositPaid true→false: wpis owner_edit", async () => {
    arrangeDeposit(true, true);
    const res = await put({ depositPaid: false });

    expect(res.status).toBe(200);
    expect(mockRecordDepositStatusEvent).toHaveBeenCalledTimes(1);
    expect(mockRecordDepositStatusEvent.mock.calls[0]![1]).toMatchObject({
      previousDepositPaid: true,
      depositPaid: false,
      source: "owner_edit",
    });
  });

  it("decyduje odczyt z blokadą: existing=false, zablokowany=true, body true → bez wpisu", async () => {
    const { updateChain } = arrangeDeposit(true, false);
    const res = await put({ depositPaid: true });

    expect(res.status).toBe(200);
    expect(updated(updateChain).depositPaid).toBe(true);
    expect(mockRecordDepositStatusEvent).not.toHaveBeenCalled();
  });

  it("zablokowany null + body false → bez wpisu (null liczy się jak false)", async () => {
    arrangeDeposit(null, null);
    const res = await put({ depositPaid: false });

    expect(res.status).toBe(200);
    expect(mockRecordDepositStatusEvent).not.toHaveBeenCalled();
  });

  it("zablokowany null + body true → wpis z previousDepositPaid=null (normalizuje pomocnik)", async () => {
    arrangeDeposit(null, null);
    const res = await put({ depositPaid: true });

    expect(res.status).toBe(200);
    expect(mockRecordDepositStatusEvent).toHaveBeenCalledTimes(1);
    expect(mockRecordDepositStatusEvent.mock.calls[0]![1]).toMatchObject({
      previousDepositPaid: null,
      depositPaid: true,
    });
  });

  it("brak wiersza w odczycie z blokadą → bez wpisu, odpowiedź bez zmian", async () => {
    arrangeDeposit("missing");
    const res = await put({ depositPaid: true });

    expect(res.status).toBe(200);
    expect(mockRecordDepositStatusEvent).not.toHaveBeenCalled();
  });

  it.each([
    ["notes", { notes: "Nowa notatka" }],
    ["depositAmount", { depositAmount: "0.00" }], // kwota > 0 przy wyłączonych zadatkach = 409
  ])("PUT bez depositPaid (%s) → bez odczytu z blokadą i bez wpisu", async (_label, body) => {
    const updateChain = chainMock([makeAppointment()]);
    mockDbSelect
      .mockReturnValueOnce(chainMock([makeAppointment()])) // findOne
      .mockReturnValueOnce(chainMock([])); // overlap
    mockDbUpdate.mockReturnValue(updateChain);

    const res = await put(body);

    expect(res.status).toBe(200);
    expect(mockDbSelect).toHaveBeenCalledTimes(2);
    expect(mockRecordDepositStatusEvent).not.toHaveBeenCalled();
  });

  it("kolizja 409 z depositPaid → bez odczytu z blokadą, bez update, bez wpisu", async () => {
    mockDbSelect
      .mockReturnValueOnce(chainMock([makeAppointment()])) // findOne
      .mockReturnValueOnce(chainMock([{ id: TEST_IDS.VALID_UUID }])); // overlap
    const res = await put({ depositPaid: true });

    expect(res.status).toBe(409);
    expect(mockDbSelect).toHaveBeenCalledTimes(2);
    expect(mockDbUpdate).not.toHaveBeenCalled();
    expect(mockRecordDepositStatusEvent).not.toHaveBeenCalled();
  });

  it("pomocnik odrzuca → 500, wołany po update", async () => {
    const { updateChain } = arrangeDeposit(false);
    mockRecordDepositStatusEvent.mockRejectedValueOnce(new Error("insert failed"));

    const res = await put({ depositPaid: true });
    const { status, body } = await parseResponse(res);

    expect(status).toBe(500);
    expect(body.error).toContain("Failed to update appointment");
    expect(mockRecordDepositStatusEvent).toHaveBeenCalledTimes(1);
    expect(updateChain.returning!.mock.invocationCallOrder[0]!).toBeLessThan(
      mockRecordDepositStatusEvent.mock.invocationCallOrder[0]!
    );
  });

  it("pracownik przenosi wlasna wizyte bez pol zadatku -> 200", async () => {
    mockGetSalonContext.mockResolvedValue(EMPLOYEE_CTX);
    arrange();
    const res = await put({ startTime: "2026-04-01T14:00:00Z", endTime: "2026-04-01T15:00:00Z" });
    expect(res.status).toBe(200);
  });
});

describe("DELETE /api/appointments/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // niezużyte kolejki mockReturnValueOnce z poprzedniego testu nie mogą przeciekać
    mockDbSelect.mockReset();
    mockDbUpdate.mockReset();
    mockDbInsert.mockReset();
    mockProcessAutomaticRefund.mockResolvedValue({ success: true, refunded: false, message: "Mock refund" });
    mockSessionsExpire.mockResolvedValue({ status: "expired" });
  });

  /**
   * Kolejność zapytań trasy (refund-fix): odczyt wizyty z joinami →
   * transakcja [płatność pending→failed, wizyta FOR UPDATE, płatności
   * succeeded, wizyta→cancelled] → nazwa i telefon salonu → (SMS).
   */
  function queueSalonCancel(opts: {
    appointment: ReturnType<typeof makeAppointment>;
    client?: ReturnType<typeof makeClient> | null;
    failedPayments?: Array<{ id: string; stripePaymentIntentId: string | null }>;
    paidMethods?: string[];
    current?: Record<string, unknown>;
  }) {
    const { appointment } = opts;
    const client = opts.client === undefined ? makeClient() : opts.client;
    mockDbSelect.mockReturnValueOnce(
      chainMock([{ appointment, client, employee: makeEmployee(), service: makeService() }])
    );
    mockDbUpdate.mockReturnValueOnce(chainMock(opts.failedPayments ?? []));
    mockDbSelect.mockReturnValueOnce(chainMock([opts.current ?? appointment]));
    mockDbSelect.mockReturnValueOnce(chainMock((opts.paidMethods ?? []).map((paymentMethod) => ({ paymentMethod }))));
    mockDbUpdate.mockReturnValueOnce(chainMock([{ ...appointment, status: "cancelled" }]));
    mockDbSelect.mockReturnValueOnce(chainMock([{ name: "Salon Łódź", phone: "+48 600 100 200" }]));
    mockDbInsert.mockReturnValue(chainMock([]));
  }

  async function callDelete(query = "") {
    const request = createMockRequest(
      `http://localhost:3000/api/appointments/${TEST_IDS.APPOINTMENT_UUID}${query}`
    );
    const response = await deleteAppointment(request, createRouteParams(TEST_IDS.APPOINTMENT_UUID));
    return parseResponse(response);
  }

  const smsInserts = () =>
    mockDbInsert.mock.results.flatMap((r) =>
      (r.value as { values: ReturnType<typeof vi.fn> }).values.mock.calls.map((c) => c[0] as Record<string, unknown>)
    );

  it("200: odwołanie bez zadatku — bez zwrotu, bez SMS bez notifyClient", async () => {
    queueSalonCancel({ appointment: makeAppointment({ startTime: new Date(Date.now() + 48 * 3600e3) }) });

    const { status, body } = await callDelete();

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.message).toContain("cancelled");
    const details = (body as any).cancellationDetails;
    expect(details).toEqual(expect.objectContaining({
      hasDeposit: false, depositRefunded: false, depositForfeited: false, depositVariant: "none",
      refundFailed: false, clientNotified: false, refund: null,
    }));
    expect(mockProcessAutomaticRefund).not.toHaveBeenCalled();
    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  it("RF1: wizyta za 2 h, zadatek online — salon zwraca 100% (bez reguły 24 h), jeden SMS ze zwrotem", async () => {
    const appointment = makeAppointment({
      startTime: new Date("2026-11-17T09:00:00Z"),
      depositAmount: "50.00",
      depositPaid: true,
    });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-17T07:00:00Z"));
    try {
      queueSalonCancel({ appointment, paidMethods: ["stripe"] });
      mockProcessAutomaticRefund.mockResolvedValueOnce({
        success: true, refunded: true, refundId: "re_1", amount: 50, message: "ok",
      });

      const { status, body } = await callDelete();

      expect(status).toBe(200);
      const details = (body as any).cancellationDetails;
      expect(details.isMoreThan24h).toBe(false);
      expect(details).toEqual(expect.objectContaining({
        depositRefunded: true, depositForfeited: false, depositVariant: "online", refundFailed: false, clientNotified: true,
      }));
      expect(mockProcessAutomaticRefund).toHaveBeenCalledWith(TEST_IDS.APPOINTMENT_UUID, expect.stringContaining("pelny zwrot"));
      // RF2: dokładnie jeden SMS, dosłowny tekst §6, GSM-7, bez linku
      const sms = smsInserts();
      expect(sms).toHaveLength(1);
      expect(sms[0]).toEqual(expect.objectContaining({ type: "sms", clientId: TEST_IDS.CLIENT_UUID }));
      expect(sms[0]!.message).toBe(
        "Salon Lodz: Twoja wizyta Strzyzenie 17 listopada 2026 zostala odwolana przez salon. Zadatek 50.00 PLN wroci w calosci w ciagu 5-10 dni roboczych."
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("RF3 (backend): zwrot się nie udał → 200 z refundFailed, logger.error z appointmentId", async () => {
    const appointment = makeAppointment({ depositAmount: "50.00", depositPaid: true });
    queueSalonCancel({ appointment, paidMethods: ["stripe"] });
    mockProcessAutomaticRefund.mockResolvedValueOnce({
      success: false, refunded: false, message: "Zwrot Stripe nie powiodl sie",
    });

    const { status, body } = await callDelete("?notifyClient=true");

    expect(status).toBe(200);
    const details = (body as any).cancellationDetails;
    expect(details).toEqual(expect.objectContaining({ depositRefunded: false, refundFailed: true, depositVariant: "online" }));
    expect(smsInserts()).toHaveLength(1);
  });

  // Recenzja (blokada #98): toast po nieudanym zwrocie pokazuje kwotę, która NIE
  // wróciła — liczoną z odpowiedzi serwera (refund.failedAmount), nie sumę
  // udanych zwrotów (`amount`, przy pełnej porażce 0).
  it.each([
    {
      name: "pełna porażka 1 × 50",
      refund: { success: false, refunded: false, amount: 0, failedAmount: 50, error: "stripe_refund_failed", paymentCount: 1 },
      expected: "Zadatek 50.00 PLN nie wrócił",
    },
    {
      name: "częściowa porażka 2 × 25 (jeden zwrot OK)",
      refund: { success: false, refunded: false, refundId: "re_1", amount: 25, failedAmount: 25, error: "stripe_refund_failed", paymentCount: 2 },
      expected: "Zadatek 25.00 PLN nie wrócił",
    },
    {
      name: "częściowa porażka 30 OK + 20 nieudane (kwoty różne — odróżnia amount od failedAmount)",
      refund: { success: false, refunded: false, refundId: "re_1", amount: 30, failedAmount: 20, error: "stripe_refund_failed", paymentCount: 2 },
      expected: "Zadatek 20.00 PLN nie wrócił",
    },
  ])("RF3 + recenzja: $name → odpowiedź niesie failedAmount, toast z tej odpowiedzi pokazuje kwotę niezwróconą", async ({ refund, expected }) => {
    const appointment = makeAppointment({ depositAmount: "50.00", depositPaid: true });
    queueSalonCancel({ appointment, paidMethods: ["stripe"] });
    mockProcessAutomaticRefund.mockResolvedValueOnce({ ...refund, message: "x", results: [] });

    const { status, body } = await callDelete();

    expect(status).toBe(200);
    // JSON z prawdziwej odpowiedzi trasy (przez serializację), nie ręczny obiekt
    const details = JSON.parse(JSON.stringify((body as any).cancellationDetails));
    expect(details.refundFailed).toBe(true);
    expect(details.refund.failedAmount).toBe(refund.failedAmount);
    const toast = salonCancelToast(details);
    expect(toast.kind).toBe("error");
    expect((toast as { description: string }).description).toContain(expected);
    expect((toast as { description: string }).description).not.toContain("Zadatek 0.00 PLN");
  });

  it("RF2: zadatek wpłacony poza MyHelper (bez płatności Stripe) — wariant ręczny z telefonem salonu", async () => {
    const appointment = makeAppointment({ startTime: new Date("2026-11-17T09:00:00Z"), depositAmount: "30.00", depositPaid: true });
    queueSalonCancel({ appointment, paidMethods: [] });

    const { body } = await callDelete("?notifyClient=true");

    expect((body as any).cancellationDetails.depositVariant).toBe("manual");
    expect(smsInserts().map((s) => s.message)).toEqual([
      "Salon Lodz: Twoja wizyta Strzyzenie 17 listopada 2026 zostala odwolana przez salon. W sprawie zwrotu zadatku 30.00 PLN skontaktuj sie z salonem: +48 600 100 200.",
    ]);
  });

  it("RF2: bez zadatku z notifyClient — jeden SMS „nowy termin”, bez linku /book", async () => {
    queueSalonCancel({ appointment: makeAppointment({ startTime: new Date("2026-11-17T09:00:00Z") }) });

    const { body } = await callDelete("?notifyClient=true");

    expect((body as any).cancellationDetails.clientNotified).toBe(true);
    const messages = smsInserts().map((s) => s.message as string);
    expect(messages).toEqual([
      "Salon Lodz: Twoja wizyta Strzyzenie 17 listopada 2026 zostala odwolana przez salon. W sprawie nowego terminu skontaktuj sie z salonem: +48 600 100 200.",
    ]);
    expect(messages[0]).not.toContain("/book");
  });

  it("#70 pkt 1: płatność pending → failed w transakcji, potem expire sesji cs_", async () => {
    const appointment = makeAppointment({ depositAmount: "50.00", depositPaid: false });
    queueSalonCancel({ appointment, failedPayments: [{ id: "dp-1", stripePaymentIntentId: "cs_test_1" }] });

    const { status, body } = await callDelete();

    expect(status).toBe(200);
    // pierwszy update w transakcji = płatność → failed
    const firstSet = (mockDbUpdate.mock.results[0]!.value as { set: ReturnType<typeof vi.fn> }).set;
    expect(firstSet).toHaveBeenCalledWith({ status: "failed" });
    expect(mockSessionsExpire).toHaveBeenCalledWith("cs_test_1");
    expect(mockProcessAutomaticRefund).not.toHaveBeenCalled();
    expect((body as any).cancellationDetails.depositVariant).toBe("none");
  });

  it("#70 pkt 1: bez prawdziwej sesji (symulacja) expire nie jest wołane; błąd expire → nadal 200", async () => {
    const appointment = makeAppointment({ depositAmount: "50.00" });
    queueSalonCancel({ appointment, failedPayments: [{ id: "dp-1", stripePaymentIntentId: null }] });
    expect((await callDelete()).status).toBe(200);
    expect(mockSessionsExpire).not.toHaveBeenCalled();

    queueSalonCancel({ appointment, failedPayments: [{ id: "dp-2", stripePaymentIntentId: "cs_done" }] });
    mockSessionsExpire.mockRejectedValueOnce(new Error("Only Checkout Sessions with a status of open can be expired"));
    const { status } = await callDelete();
    expect(status).toBe(200);
    expect(mockSessionsExpire).toHaveBeenCalledWith("cs_done");
  });

  it("decyzja na stanie po blokadzie: webhook potwierdził wpłatę w międzyczasie → zwrot 100%", async () => {
    const appointment = makeAppointment({ depositAmount: "50.00", depositPaid: false });
    queueSalonCancel({
      appointment,
      current: { ...appointment, status: "confirmed", depositPaid: true },
      paidMethods: ["stripe"],
    });
    mockProcessAutomaticRefund.mockResolvedValueOnce({ success: true, refunded: true, refundId: "re_2", amount: 50, message: "ok" });

    const { body } = await callDelete();

    expect(mockProcessAutomaticRefund).toHaveBeenCalledTimes(1);
    expect((body as any).cancellationDetails).toEqual(expect.objectContaining({ depositPaid: true, depositRefunded: true }));
  });

  it("404 gdy wizyty nie ma", async () => {
    mockDbSelect.mockReturnValue(chainMock([]));
    const { status, body } = await callDelete();
    expect(status).toBe(404);
    expect(body.error).toContain("not found");
  });

  it("400 gdy już anulowana (odczyt przed transakcją)", async () => {
    mockDbSelect.mockReturnValue(
      chainMock([{ appointment: makeAppointment({ status: "cancelled" }), client: makeClient(), employee: null, service: null }])
    );
    const { status, body } = await callDelete();
    expect(status).toBe(400);
    expect(body.error).toContain("anulowana");
    expect(mockDbUpdate).not.toHaveBeenCalled();
  });

  it("400 gdy anulowano równolegle (stan po blokadzie) — bez zwrotu i SMS", async () => {
    const appointment = makeAppointment({ depositAmount: "50.00", depositPaid: true });
    queueSalonCancel({ appointment, current: { ...appointment, status: "cancelled" } });
    const { status } = await callDelete("?notifyClient=true");
    expect(status).toBe(400);
    expect(mockProcessAutomaticRefund).not.toHaveBeenCalled();
    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  it("500 gdy baza rzuca", async () => {
    const errorChain: Record<string, unknown> = {};
    for (const method of ["select", "from", "where", "leftJoin", "limit"]) {
      (errorChain as Record<string, ReturnType<typeof vi.fn>>)[method] = vi.fn().mockReturnValue(errorChain);
    }
    errorChain.then = (_: unknown, reject: (err: Error) => void) => reject(new Error("DB delete failure"));
    mockDbSelect.mockReturnValue(errorChain);
    const { status, body } = await callDelete();
    expect(status).toBe(500);
    expect(body.error).toContain("Failed to cancel appointment");
  });

  // #193: efekty uboczne anulacji (nazwa salonu, wpis powiadomienia) w kontekście
  // RLS salonu z sesji — każde otwarcie bramy z salonem sesji, wpis z salon_id sesji.
  it("#193: odczyt wizyty, transakcja, nazwa salonu i wpis SMS przez forSalon(salon z sesji)", async () => {
    queueSalonCancel({ appointment: makeAppointment({ startTime: new Date("2026-11-17T09:00:00Z") }) });

    const { status, body } = await callDelete("?notifyClient=true");

    expect(status).toBe(200);
    expect((body as any).cancellationDetails.clientNotified).toBe(true);
    const calls = vi.mocked(forSalon).mock.calls;
    expect(calls).toHaveLength(4);
    expect(calls.every(([salonId]) => salonId === TEST_IDS.SALON_UUID)).toBe(true);
    expect(smsInserts()).toEqual([expect.objectContaining({ salonId: TEST_IDS.SALON_UUID, type: "sms" })]);
  });

  it("#193: bez SMS brama otwierana 3 razy (bez wpisu powiadomienia)", async () => {
    queueSalonCancel({ appointment: makeAppointment({ startTime: new Date(Date.now() + 48 * 3600e3) }) });

    const { status } = await callDelete();

    expect(status).toBe(200);
    expect(vi.mocked(forSalon).mock.calls).toHaveLength(3);
    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  it("#193: błąd wpisu powiadomienia w transakcji salonu → nadal 200, clientNotified false", async () => {
    queueSalonCancel({ appointment: makeAppointment({ startTime: new Date("2026-11-17T09:00:00Z") }) });
    const failing = chainMock([]);
    (failing as Record<string, unknown>).then = (_: unknown, reject: (err: Error) => void) =>
      reject(new Error("notif insert failure"));
    mockDbInsert.mockReturnValue(failing);

    const { status, body } = await callDelete("?notifyClient=true");

    expect(status).toBe(200);
    expect((body as any).cancellationDetails.clientNotified).toBe(false);
    expect((body as any).data.status).toBe("cancelled");
  });
});

// =======================================================
// P0-A · Tenant isolation regression (IDOR)
//
// These are the regression witnesses for the cross-tenant fix:
//   - the salon is ALWAYS derived from the session (getUserSalonId),
//   - when the caller has no salon the [id] routes refuse to query (404),
//   - a record from another salon is invisible (db WHERE scopes by salonId,
//     so a foreign record resolves to empty -> 404 "not found").
// Without the fix these routes filtered only by record id and leaked/mutated
// data across salons.
// =======================================================
describe("P0-A tenant isolation — /api/appointments/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: caller belongs to SALON_UUID (Faza 3: kontekst ról).
    mockGetSalonContext.mockResolvedValue(OWNER_CTX);
  });

  it("GET resolves the salon from the session, not from the request", async () => {
    mockDbSelect.mockReturnValue(chainMock([{ appointment: makeAppointment(), client: null, employee: null, service: null }]));

    const request = createMockRequest(`http://localhost:3000/api/appointments/${TEST_IDS.APPOINTMENT_UUID}`);
    const params = createRouteParams(TEST_IDS.APPOINTMENT_UUID);
    await getAppointment(request, params);

    // The route must derive the tenant server-side.
    expect(mockGetSalonContext).toHaveBeenCalled();
  });

  it("GET returns 404 when the caller has no salon (unresolved tenant) and never queries", async () => {
    mockGetSalonContext.mockResolvedValue(null);

    const request = createMockRequest(`http://localhost:3000/api/appointments/${TEST_IDS.APPOINTMENT_UUID}`);
    const params = createRouteParams(TEST_IDS.APPOINTMENT_UUID);
    const response = await getAppointment(request, params);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(404);
    expect(body.success).toBe(false);
    expect(body.error).toContain("Salon not found");
    // Hard guard: no DB read happens before the tenant is known.
    expect(mockDbSelect).not.toHaveBeenCalled();
  });

  it("GET returns 404 for an appointment owned by another salon (foreign record invisible)", async () => {
    // Caller is SALON_UUID; the scoped WHERE (id AND salonId) matches nothing
    // because the appointment belongs to a different salon.
    mockDbSelect.mockReturnValue(chainMock([]));

    const request = createMockRequest(`http://localhost:3000/api/appointments/${TEST_IDS.APPOINTMENT_UUID}`);
    const params = createRouteParams(TEST_IDS.APPOINTMENT_UUID);
    const response = await getAppointment(request, params);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(404);
    expect(body.success).toBe(false);
    expect(mockGetSalonContext).toHaveBeenCalled();
  });

  it("PUT returns 404 for an appointment owned by another salon (no cross-tenant mutation)", async () => {
    // Existing-check select returns empty -> foreign appointment, refuse update.
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
    // The update must never run for a foreign record.
    expect(mockDbUpdate).not.toHaveBeenCalled();
  });

  it("DELETE returns 404 for an appointment owned by another salon (no cross-tenant delete)", async () => {
    // The scoped fetch returns empty -> foreign appointment.
    mockDbSelect.mockReturnValue(chainMock([]));

    const request = createMockRequest(`http://localhost:3000/api/appointments/${TEST_IDS.APPOINTMENT_UUID}`);
    const params = createRouteParams(TEST_IDS.APPOINTMENT_UUID);
    const response = await deleteAppointment(request, params);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(404);
    expect(body.success).toBe(false);
    expect(mockGetSalonContext).toHaveBeenCalled();
  });

  it("DELETE returns 404 when the caller has no salon", async () => {
    mockGetSalonContext.mockResolvedValue(null);

    const request = createMockRequest(`http://localhost:3000/api/appointments/${TEST_IDS.APPOINTMENT_UUID}`);
    const params = createRouteParams(TEST_IDS.APPOINTMENT_UUID);
    const response = await deleteAppointment(request, params);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(404);
    expect(body.success).toBe(false);
    expect(body.error).toContain("Salon not found");
  });
});

// =======================================================
// Faza 3 · Role pracownik/recepcja — /api/appointments
// Employee widzi wyłącznie własne wizyty; cudza wizyta [id] = 404 (nie 403).
// =======================================================
describe("Faza 3 role — /api/appointments (employee)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSalonContext.mockResolvedValue(OWNER_CTX);
  });

  it("GET (lista) jako employee dokłada filtr własnych wizyt z kontekstu sesji", async () => {
    mockGetSalonContext.mockResolvedValue(EMPLOYEE_CTX);
    mockDbSelect.mockReturnValue(chainMock([]));

    const request = createMockRequest("http://localhost:3000/api/appointments");
    const response = await listAppointments(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    // Filtr eq(appointments.employeeId, ctx.employeeId) musiał zostać zbudowany.
    const { eq } = await import("drizzle-orm");
    expect(vi.mocked(eq)).toHaveBeenCalledWith(
      "appointments.employeeId",
      TEST_IDS.EMPLOYEE_UUID
    );
  });

  it("GET (lista) jako employee bez rekordu employees -> pusta lista bez zapytania", async () => {
    mockGetSalonContext.mockResolvedValue({ ...EMPLOYEE_CTX, employeeId: null });

    const request = createMockRequest("http://localhost:3000/api/appointments");
    const response = await listAppointments(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(0);
    expect(mockDbSelect).not.toHaveBeenCalled();
  });

  it("GET [id] jako employee nie widzi cudzej wizyty (404, nie 403)", async () => {
    // Wizyta należy do EMPLOYEE_UUID, a wołający pracownik ma inny rekord.
    mockGetSalonContext.mockResolvedValue({
      ...EMPLOYEE_CTX,
      employeeId: "99999999-9999-9999-9999-999999999999",
    });
    mockDbSelect.mockReturnValue(
      chainMock([{ appointment: makeAppointment(), client: null, employee: null, service: null }])
    );

    const request = createMockRequest(`http://localhost:3000/api/appointments/${TEST_IDS.APPOINTMENT_UUID}`);
    const params = createRouteParams(TEST_IDS.APPOINTMENT_UUID);
    const response = await getAppointment(request, params);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(404);
    expect(body.success).toBe(false);
    expect(body.error).toContain("not found");
  });
});

// -------------------------------------------------------
// #165: kolizja jako przedział półotwarty [start, end)
// -------------------------------------------------------
// Atrapa SELECT-u kolizji filtruje wiersze-fikstury warunkiem WHERE, który
// zbudowała trasa (ewaluator drzewa zamockowanych operatorów drizzle), więc
// 201/409 wynika ze znaczenia predykatu, a nie z tego, co atrapa „zwróci”.

function filteringChain(rows: Record<string, unknown>[]) {
  const chain = chainMock([]);
  (chain as Record<string, unknown>).then = (resolve: (val: unknown[]) => unknown) => {
    const where = chain.where!.mock.calls.at(-1)?.[0];
    if (where === undefined) throw new Error("filteringChain: trasa nie wywołała where()");
    return resolve(rows.filter((r) => matchesPredicate(where, r)));
  };
  return chain;
}

const at165 = (hhmm: string) => `2026-04-01T${hhmm}:00Z`;
const existing10to11 = (extra: Record<string, unknown> = {}) =>
  makeAppointment({
    id: "aaaaaaaa-0000-4000-8000-000000000001",
    startTime: new Date(at165("10:00")),
    endTime: new Date(at165("11:00")),
    ...extra,
  });

/** Kolejne db.select() z kolejki; reset po teście, żeby nic nie przeciekło dalej. */
function queueSelects(...chains: ReturnType<typeof chainMock>[]) {
  mockDbSelect.mockImplementation(() => chains.shift() ?? chainMock([]));
}

describe("POST /api/appointments — kolizja półotwarta (#165)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // wcześniejsze opisy (Faza 3) przełączają kontekst na pracownika
    mockGetSalonContext.mockResolvedValue(OWNER_CTX);
  });
  afterEach(() => {
    mockDbSelect.mockReset();
    mockDbInsert.mockReset();
  });

  async function post(start: string, end: string, rows: Record<string, unknown>[], blocks: Record<string, unknown>[] = []) {
    queueSelects(filteringChain(rows), filteringChain(blocks));
    mockDbInsert.mockReturnValue(chainMock([makeAppointment({ startTime: new Date(start), endTime: new Date(end) })]));
    const response = await createAppointment(
      createMockRequest("http://localhost:3000/api/appointments", {
        method: "POST",
        body: {
          salonId: TEST_IDS.SALON_UUID,
          employeeId: TEST_IDS.EMPLOYEE_UUID,
          serviceId: TEST_IDS.SERVICE_UUID,
          clientId: TEST_IDS.CLIENT_UUID,
          startTime: start,
          endTime: end,
        },
      })
    );
    return parseResponse(response);
  }

  it("styk 10–11, potem 11–12 → 201", async () => {
    const { status } = await post(at165("11:00"), at165("12:00"), [existing10to11()]);
    expect(status).toBe(201);
  });

  it("styk z drugiej strony: 10–11, potem 09–10 → 201", async () => {
    const { status } = await post(at165("09:00"), at165("10:00"), [existing10to11()]);
    expect(status).toBe(201);
  });

  it("nakładanie o 1 minutę → 409 z dotychczasowym komunikatem", async () => {
    const { status, body } = await post(at165("10:59"), at165("12:00"), [existing10to11()]);
    expect(status).toBe(409);
    expect(body.error).toBe("Termin koliduje z istniejaca wizyta. Wybierz inna godzine");
  });

  it("zawieranie (09–12 obejmuje 10–11) → 409", async () => {
    const { status } = await post(at165("09:00"), at165("12:00"), [existing10to11()]);
    expect(status).toBe(409);
  });

  it("anulowana wizyta w tym samym terminie nie koliduje → 201", async () => {
    const { status } = await post(at165("10:00"), at165("11:00"), [existing10to11({ status: "cancelled" })]);
    expect(status).toBe(201);
  });

  it.each(["scheduled", "confirmed", "completed", "no_show"])("wizyta %s blokuje termin → 409", async (s) => {
    const { status } = await post(at165("10:30"), at165("11:30"), [existing10to11({ status: s })]);
    expect(status).toBe(409);
  });

  it("wizyta innego pracownika nie koliduje → 201", async () => {
    const { status } = await post(at165("10:00"), at165("11:00"), [
      existing10to11({ employeeId: "bbbbbbbb-0000-4000-8000-000000000002" }),
    ]);
    expect(status).toBe(201);
  });

  // salonId w blokadzie = salon pracownika z joinu employees (#193).
  it("blokada czasu na styku (11–12 po wizycie 10–11) nie koliduje → 201", async () => {
    const block = {
      id: "block-165",
      employeeId: TEST_IDS.EMPLOYEE_UUID,
      salonId: TEST_IDS.SALON_UUID,
      blockType: "break",
      reason: null,
      startTime: new Date(at165("11:00")),
      endTime: new Date(at165("12:00")),
    };
    const { status } = await post(at165("10:00"), at165("11:00"), [], [block]);
    expect(status).toBe(201);
  });

  it("blokada czasu nachodząca o 1 minutę → 409 (przerwa)", async () => {
    const block = {
      id: "block-165",
      employeeId: TEST_IDS.EMPLOYEE_UUID,
      salonId: TEST_IDS.SALON_UUID,
      blockType: "break",
      reason: null,
      startTime: new Date(at165("10:59")),
      endTime: new Date(at165("12:00")),
    };
    const { status, body } = await post(at165("10:00"), at165("11:00"), [], [block]);
    expect(status).toBe(409);
    expect(body.error).toContain("przerwa");
  });
});

describe("PUT /api/appointments/[id] — kolizja półotwarta (#165)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSalonContext.mockResolvedValue(OWNER_CTX);
  });
  afterEach(() => {
    mockDbSelect.mockReset();
    mockDbUpdate.mockReset();
  });

  async function put(start: string, end: string, rows: Record<string, unknown>[]) {
    // edytowana wizyta: 14–15, ten sam pracownik
    const self = makeAppointment({
      startTime: new Date(at165("14:00")),
      endTime: new Date(at165("15:00")),
    });
    queueSelects(chainMock([self]), filteringChain([self, ...rows]));
    mockDbUpdate.mockReturnValue(chainMock([{ ...self, startTime: new Date(start), endTime: new Date(end) }]));
    const response = await updateAppointment(
      createMockRequest(`http://localhost:3000/api/appointments/${TEST_IDS.APPOINTMENT_UUID}`, {
        method: "PUT",
        body: { startTime: start, endTime: end },
      }),
      createRouteParams(TEST_IDS.APPOINTMENT_UUID)
    );
    return parseResponse(response);
  }

  it("przeciągnięcie na styk (11–12 po 10–11) → 200", async () => {
    const { status } = await put(at165("11:00"), at165("12:00"), [existing10to11()]);
    expect(status).toBe(200);
  });

  it("nakładanie o 1 minutę → 409 z dotychczasowym komunikatem", async () => {
    const { status, body } = await put(at165("10:59"), at165("12:00"), [existing10to11()]);
    expect(status).toBe(409);
    expect(body.error).toBe("Termin koliduje z istniejaca wizyta. Wybierz inna godzine");
  });

  it("wizyta nie koliduje sama ze sobą (przesunięcie o 30 min w obrębie własnego terminu) → 200", async () => {
    const { status } = await put(at165("14:30"), at165("15:30"), []);
    expect(status).toBe(200);
  });

  it("anulowana wizyta w docelowym terminie nie koliduje → 200", async () => {
    const { status } = await put(at165("10:00"), at165("11:00"), [existing10to11({ status: "cancelled" })]);
    expect(status).toBe(200);
  });

  it("wizyta innego salonu nie jest brana pod uwagę (filtr salonu) → 200", async () => {
    const { status } = await put(at165("10:00"), at165("11:00"), [
      existing10to11({ salonId: "cccccccc-0000-4000-8000-000000000003" }),
    ]);
    expect(status).toBe(200);
  });
});

describe("PUT /api/appointments/[id] — koniec po początku na wartościach scalonych (#165)", () => {
  // Zapisana wizyta: 10:00–11:00 (makeAppointment).
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSalonContext.mockResolvedValue(OWNER_CTX);
  });
  afterEach(() => {
    mockDbSelect.mockReset();
    mockDbUpdate.mockReset();
  });

  async function put(body: Record<string, unknown>) {
    queueSelects(chainMock([makeAppointment()]), filteringChain([]));
    mockDbUpdate.mockReturnValue(chainMock([makeAppointment()]));
    const response = await updateAppointment(
      createMockRequest(`http://localhost:3000/api/appointments/${TEST_IDS.APPOINTMENT_UUID}`, {
        method: "PUT",
        body,
      }),
      createRouteParams(TEST_IDS.APPOINTMENT_UUID)
    );
    return parseResponse(response);
  }

  it.each([
    ["samo endTime przed zapisanym startem", { endTime: at165("09:00") }],
    ["samo startTime po zapisanym końcu", { startTime: at165("12:00") }],
    ["samo endTime równe zapisanemu startowi", { endTime: at165("10:00") }],
    ["oba pola odwrócone", { startTime: at165("12:00"), endTime: at165("11:00") }],
    ["oba pola równe", { startTime: at165("12:00"), endTime: at165("12:00") }],
  ])("%s → 400, bez sprawdzania kolizji i bez zapisu", async (_n, body) => {
    const { status, body: res } = await put(body);
    expect(status).toBe(400);
    expect(res.error).toBe("Czas zakonczenia musi byc pozniej niz czas rozpoczecia");
    expect(mockDbSelect).toHaveBeenCalledTimes(1); // tylko odczyt wizyty
    expect(mockDbUpdate).not.toHaveBeenCalled();
  });

  it("samo endTime skracające wizytę (10:30) → 200", async () => {
    const { status } = await put({ endTime: at165("10:30") });
    expect(status).toBe(200);
  });

  it("sama notatka (czasy z zapisu) → 200", async () => {
    const { status } = await put({ notes: "x" });
    expect(status).toBe(200);
  });
});

describe("POST /api/appointments — przedział pusty (#165)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSalonContext.mockResolvedValue(OWNER_CTX);
  });
  afterEach(() => {
    mockDbSelect.mockReset();
  });

  it("endTime = startTime → 400, bez zapytań do bazy", async () => {
    const response = await createAppointment(
      createMockRequest("http://localhost:3000/api/appointments", {
        method: "POST",
        body: {
          salonId: TEST_IDS.SALON_UUID,
          employeeId: TEST_IDS.EMPLOYEE_UUID,
          serviceId: TEST_IDS.SERVICE_UUID,
          startTime: at165("10:00"),
          endTime: at165("10:00"),
        },
      })
    );
    const { status } = await parseResponse(response);
    expect(status).toBe(400);
    expect(mockDbSelect).not.toHaveBeenCalled();
  });
});

describe("PUT /api/appointments/[id] — przeniesienie na innego pracownika (#165, B1)", () => {
  // Edytowana wizyta: pracownik E1 (TEST_IDS.EMPLOYEE_UUID), 14–15.
  // Kolizja ma być liczona u NOWEGO pracownika, nie u zapisanego.
  const E2 = "bbbbbbbb-0000-4000-8000-000000000002";

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSalonContext.mockResolvedValue(OWNER_CTX);
  });
  afterEach(() => {
    mockDbSelect.mockReset();
    mockDbUpdate.mockReset();
  });

  async function moveToE2(rows: Record<string, unknown>[]) {
    const self = makeAppointment({
      employeeId: TEST_IDS.EMPLOYEE_UUID,
      startTime: new Date(at165("14:00")),
      endTime: new Date(at165("15:00")),
    });
    queueSelects(chainMock([self]), filteringChain([self, ...rows]));
    mockDbUpdate.mockReturnValue(
      chainMock([{ ...self, employeeId: E2, startTime: new Date(at165("10:30")), endTime: new Date(at165("11:30")) }])
    );
    const response = await updateAppointment(
      createMockRequest(`http://localhost:3000/api/appointments/${TEST_IDS.APPOINTMENT_UUID}`, {
        method: "PUT",
        body: { employeeId: E2, startTime: at165("10:30"), endTime: at165("11:30") },
      }),
      createRouteParams(TEST_IDS.APPOINTMENT_UUID)
    );
    return parseResponse(response);
  }

  it("nowy pracownik zajęty w tym terminie → 409, bez zapisu", async () => {
    const { status, body } = await moveToE2([existing10to11({ employeeId: E2 })]);
    expect(status).toBe(409);
    expect(body.error).toBe("Termin koliduje z istniejaca wizyta. Wybierz inna godzine");
    expect(mockDbUpdate).not.toHaveBeenCalled();
  });

  it("nowy pracownik wolny, a stary ma w tym terminie inną wizytę → 200", async () => {
    const { status } = await moveToE2([existing10to11({ employeeId: TEST_IDS.EMPLOYEE_UUID })]);
    expect(status).toBe(200);
    expect(mockDbUpdate).toHaveBeenCalledTimes(1);
  });
});

// -------------------------------------------------------
// #171: EXCLUDE appointments_no_overlap w bazie — 23P01 przy zapisie → 409
// -------------------------------------------------------
// Sprawdzenie aplikacyjne przepuszcza (termin wolny w chwili SELECT-u), a
// INSERT/UPDATE odrzuca baza: równoległy zapis zajął termin w międzyczasie.

/** Łańcuch, którego await kończy się błędem (np. odrzuceniem przez bazę). */
function rejectingChain(error: unknown) {
  const chain = chainMock([]);
  (chain as Record<string, unknown>).then = (_res: unknown, reject: (e: unknown) => unknown) => reject(error);
  return chain;
}

// drizzle-orm jest tu zamockowany — kształt DrizzleQueryError (błąd sterownika w cause).
const dbError = (code: string, constraint_name: string) =>
  Object.assign(new Error("Failed query: insert ..."), {
    cause: Object.assign(new Error("db"), { code, constraint_name }),
  });

/** Spy na logger.error (prawdziwy albo zamockowany moduł) — 500 ma trafić do logu z kodem błędu. */
async function spyLoggerError() {
  const { logger } = await import("@/lib/logger");
  return vi.spyOn(logger, "error");
}

describe("POST /api/appointments — wyścig odrzucony przez bazę (#171)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSalonContext.mockResolvedValue(OWNER_CTX);
  });
  afterEach(() => {
    mockDbSelect.mockReset();
    mockDbInsert.mockReset();
  });

  async function postRejected(error: unknown) {
    queueSelects(filteringChain([]), filteringChain([]));
    mockDbInsert.mockReturnValue(rejectingChain(error));
    const response = await createAppointment(
      createMockRequest("http://localhost:3000/api/appointments", {
        method: "POST",
        body: {
          salonId: TEST_IDS.SALON_UUID,
          employeeId: TEST_IDS.EMPLOYEE_UUID,
          serviceId: TEST_IDS.SERVICE_UUID,
          clientId: TEST_IDS.CLIENT_UUID,
          startTime: at165("10:00"),
          endTime: at165("11:00"),
        },
      })
    );
    return parseResponse(response);
  }

  it("23P01 appointments_no_overlap → 409 z dotychczasowym komunikatem kolizji", async () => {
    const { status, body } = await postRejected(dbError("23P01", "appointments_no_overlap"));
    expect(status).toBe(409);
    expect(body.error).toBe("Termin koliduje z istniejaca wizyta. Wybierz inna godzine");
    expect(mockDbInsert).toHaveBeenCalledTimes(1);
  });

  it("naruszenie CHECK (23514) to nie kolizja → 500", async () => {
    const { status } = await postRejected(dbError("23514", "appointments_end_after_start"));
    expect(status).toBe(500);
  });

  it("inny błąd bazy → 500", async () => {
    const { status } = await postRejected(new Error("connection reset"));
    expect(status).toBe(500);
  });

  it("POST: 40P01 przy sprawdzaniu EXCLUDE (zakleszczenie, db71a43) → 409 z komunikatem kolizji", async () => {
    const { status, body } = await postRejected(wrapped(deadlock()));
    expect(status).toBe(409);
    expect(body.error).toBe("Termin koliduje z istniejaca wizyta. Wybierz inna godzine");
    expect(mockDbInsert).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["40P01 bez kontekstu", "40P01", deadlock(null)],
    ["40P01 innej relacji", "40P01", deadlock('while checking exclusion constraint on tuple (1,2) in relation "payments"')],
    ["40001 z kontekstem EXCLUDE", "40001", { ...deadlock(), code: "40001" }],
  ])("POST: %s → 500, w logu kod błędu", async (_n, code, cause) => {
    const spy = await spyLoggerError();
    const { status } = await postRejected(wrapped(cause));
    expect(status).toBe(500);
    expect(spy).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ code }));
    spy.mockRestore();
  });
});

describe("PUT /api/appointments/[id] — wyścig odrzucony przez bazę (#171)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSalonContext.mockResolvedValue(OWNER_CTX);
  });
  afterEach(() => {
    mockDbSelect.mockReset();
    mockDbUpdate.mockReset();
  });

  async function putRejected(error: unknown) {
    queueSelects(chainMock([makeAppointment()]), filteringChain([]));
    mockDbUpdate.mockReturnValue(rejectingChain(error));
    const response = await updateAppointment(
      createMockRequest(`http://localhost:3000/api/appointments/${TEST_IDS.APPOINTMENT_UUID}`, {
        method: "PUT",
        body: { startTime: at165("12:00"), endTime: at165("13:00") },
      }),
      createRouteParams(TEST_IDS.APPOINTMENT_UUID)
    );
    return parseResponse(response);
  }

  it("23P01 appointments_no_overlap → 409 z dotychczasowym komunikatem kolizji", async () => {
    const { status, body } = await putRejected(dbError("23P01", "appointments_no_overlap"));
    expect(status).toBe(409);
    expect(body.error).toBe("Termin koliduje z istniejaca wizyta. Wybierz inna godzine");
    expect(mockDbUpdate).toHaveBeenCalledTimes(1);
  });

  it("inny błąd bazy → 500", async () => {
    const { status } = await putRejected(dbError("23505", "appointments_pkey"));
    expect(status).toBe(500);
  });

  it("PUT: 40P01 przy sprawdzaniu EXCLUDE (zakleszczenie, db71a43) → 409 z komunikatem kolizji", async () => {
    const { status, body } = await putRejected(wrapped(deadlock()));
    expect(status).toBe(409);
    expect(body.error).toBe("Termin koliduje z istniejaca wizyta. Wybierz inna godzine");
    expect(mockDbUpdate).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["40P01 bez kontekstu", "40P01", deadlock(null)],
    ["40P01 innej relacji", "40P01", deadlock('while checking exclusion constraint on tuple (1,2) in relation "payments"')],
    ["40001 z kontekstem EXCLUDE", "40001", { ...deadlock(), code: "40001" }],
  ])("PUT: %s → 500, w logu kod błędu", async (_n, code, cause) => {
    const spy = await spyLoggerError();
    const { status } = await putRejected(wrapped(cause));
    expect(status).toBe(500);
    expect(spy).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ code }));
    spy.mockRestore();
  });
});

// -------------------------------------------------------
// #193: publiczny POST przez forSalon(salonId z żądania), jawne listy kolumn.
// -------------------------------------------------------

describe("POST /api/appointments — forSalon i jawne listy kolumn (#193)", () => {
  const PROMO_CODE_UUID = "77777777-7777-4777-8777-777777777777";
  /** Kolumny wizyty, które odpowiedź 201 zwracała przed #193 (cały wiersz appointments). */
  const RESPONSE_COLUMNS = [
    "id", "salonId", "clientId", "employeeId", "serviceId", "variantId", "bookedByUserId",
    "startTime", "endTime", "status", "notes", "depositAmount", "depositPaid",
    "reminderSentAt", "reminder1hSentAt", "reminderPushSentAt", "reminderPush1hSentAt",
    "promoCodeId", "discountAmount", "guestName", "guestPhone", "guestEmail",
    "createdAt", "updatedAt",
  ];
  const mockForSalon = vi.mocked(forSalon);

  async function asGuest() {
    const { getOptionalSession } = await import("@/lib/session");
    vi.mocked(getOptionalSession).mockResolvedValueOnce(null);
    const { strictRateLimit } = await import("@/lib/rate-limit");
    vi.mocked(strictRateLimit.check).mockReturnValue({ success: true, remaining: 4, reset: 60000 });
  }

  function guestRequest(extra: Record<string, unknown> = {}) {
    return createMockRequest("http://localhost:3000/api/appointments", {
      method: "POST",
      body: {
        salonId: TEST_IDS.SALON_UUID,
        employeeId: TEST_IDS.EMPLOYEE_UUID,
        serviceId: TEST_IDS.SERVICE_UUID,
        startTime: "2026-04-01T10:00:00Z",
        endTime: "2026-04-01T11:00:00Z",
        guestName: "Jan Kowalski",
        guestPhone: "123456789",
        ...extra,
      },
    });
  }

  /** Pełna ścieżka z kodem promocyjnym: kolizja, blokady, kod, usługa, (insert), SMS. */
  function arrangeFullPath() {
    const chains = [
      chainMock([]),
      chainMock([]),
      chainMock([{
        promoCode: { id: PROMO_CODE_UUID, salonId: TEST_IDS.SALON_UUID, expiresAt: null, usageLimit: null, usedCount: 0 },
        promotion: {
          salonId: TEST_IDS.SALON_UUID, type: "percentage", value: "10.00", isActive: true,
          startDate: null, endDate: null, conditionsJson: {},
        },
      }]),
      chainMock([makeService()]),
      chainMock([{
        clientFirstName: null, clientPhone: null, serviceName: "Strzyzenie",
        employeeFirstName: "Anna", employeeLastName: "Nowak", salonName: "Salon",
      }]),
    ];
    for (const c of chains) mockDbSelect.mockReturnValueOnce(c);
    const insertChain = chainMock([makeAppointment({ clientId: null })]);
    const updateChain = chainMock([]);
    mockDbInsert.mockReturnValue(insertChain);
    mockDbUpdate.mockReturnValue(updateChain);
    return { chains, insertChain, updateChain };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockDbSelect.mockReset();
    mockDbInsert.mockReset();
    mockDbUpdate.mockReset();
    mockGetSalonContext.mockResolvedValue(OWNER_CTX);
  });

  afterEach(() => {
    mockDbSelect.mockReset();
    mockDbInsert.mockReset();
    mockDbUpdate.mockReset();
    mockAssertSalonRefs.mockReset();
    mockAssertSalonRefs.mockImplementation(async () => null);
  });

  it("gość: forSalon wołany wyłącznie z salonId z żądania, 201", async () => {
    await asGuest();
    const { insertChain } = arrangeFullPath();

    const res = await createAppointment(guestRequest({ promoCodeId: PROMO_CODE_UUID }));

    expect(res.status).toBe(201);
    expect(mockForSalon).toHaveBeenCalled();
    for (const call of mockForSalon.mock.calls) expect(call).toEqual([TEST_IDS.SALON_UUID]);
    // Insert i zużycie kodu przeszły przez tx z kontekstem salonu.
    expect(insertChain.values).toHaveBeenCalledTimes(1);
    expect(mockDbUpdate).toHaveBeenCalledTimes(1);
    expect(mockSendBookingSms).toHaveBeenCalledWith(expect.objectContaining({ salonName: "Salon", salonId: TEST_IDS.SALON_UUID }));
  });

  it("każde zapytanie POST ma jawną listę kolumn (select z argumentem, returning z listą)", async () => {
    await asGuest();
    const { insertChain } = arrangeFullPath();

    const res = await createAppointment(guestRequest({ promoCodeId: PROMO_CODE_UUID }));

    expect(res.status).toBe(201);
    expect(mockDbSelect).toHaveBeenCalledTimes(5);
    for (const call of mockDbSelect.mock.calls) {
      expect(call[0], "select() bez listy kolumn").toEqual(expect.any(Object));
    }
    expect(insertChain.returning).toHaveBeenCalledTimes(1);
    expect(insertChain.returning!.mock.calls[0]![0], "returning() bez listy kolumn").toEqual(expect.any(Object));
  });

  it("odpowiedź 201: lista kolumn returning = dokładnie kolumny dotychczasowej odpowiedzi", async () => {
    await asGuest();
    const { insertChain } = arrangeFullPath();

    await createAppointment(guestRequest({ promoCodeId: PROMO_CODE_UUID }));

    const columns = insertChain.returning!.mock.calls[0]![0] as Record<string, unknown>;
    expect(Object.keys(columns).sort()).toEqual([...RESPONSE_COLUMNS].sort());
  });

  it("zużycie kodu promocyjnego zawężone do salonu wizyty", async () => {
    await asGuest();
    const { updateChain } = arrangeFullPath();

    await createAppointment(guestRequest({ promoCodeId: PROMO_CODE_UUID }));

    const where = updateChain.where!.mock.calls[0]![0];
    expect(matchesPredicate(where, { id: PROMO_CODE_UUID, salonId: TEST_IDS.SALON_UUID })).toBe(true);
    expect(matchesPredicate(where, { id: PROMO_CODE_UUID, salonId: "99999999-9999-4999-8999-999999999999" })).toBe(false);
  });

  it("zapytanie do SMS zawężone do salonu wizyty", async () => {
    await asGuest();
    const { chains } = arrangeFullPath();

    await createAppointment(guestRequest({ promoCodeId: PROMO_CODE_UUID }));

    const where = chains[4]!.where!.mock.calls[0]![0];
    expect(matchesPredicate(where, { id: TEST_IDS.APPOINTMENT_UUID, salonId: TEST_IDS.SALON_UUID })).toBe(true);
    expect(matchesPredicate(where, { id: TEST_IDS.APPOINTMENT_UUID, salonId: "99999999-9999-4999-8999-999999999999" })).toBe(false);
  });

  it("gość: obcy employeeId/serviceId (inny salon) → 400 jak dziś, bez żadnego zapytania przez forSalon", async () => {
    await asGuest();
    mockAssertSalonRefs.mockResolvedValueOnce(salonRefRejection());
    arrangeFullPath();

    const res = await createAppointment(guestRequest());
    const { status, body } = await parseResponse(res);

    expect(status).toBe(400);
    expect(body).toEqual({ success: false, error: "Nieprawidlowe dane dla tego salonu" });
    expect(mockForSalon).not.toHaveBeenCalled();
    expect(mockDbSelect).not.toHaveBeenCalled();
    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  it("gość: kolizja → 409 z dotychczasowym komunikatem, warunek kolizji z salonId z żądania", async () => {
    await asGuest();
    const overlapChain = chainMock([{ id: "inna" }]);
    mockDbSelect.mockReturnValueOnce(overlapChain);

    const res = await createAppointment(guestRequest());
    const { status, body } = await parseResponse(res);

    expect(status).toBe(409);
    expect(body).toEqual({ success: false, error: "Termin koliduje z istniejaca wizyta. Wybierz inna godzine" });
    expect(mockDbInsert).not.toHaveBeenCalled();
    const where = overlapChain.where!.mock.calls[0]![0];
    const row = {
      id: "inna",
      employeeId: TEST_IDS.EMPLOYEE_UUID,
      status: "scheduled",
      startTime: new Date("2026-04-01T10:30:00Z"),
      endTime: new Date("2026-04-01T11:30:00Z"),
    };
    expect(matchesPredicate(where, { ...row, salonId: TEST_IDS.SALON_UUID })).toBe(true);
    expect(matchesPredicate(where, { ...row, salonId: "99999999-9999-4999-8999-999999999999" })).toBe(false);
  });
});

describe("POST /api/appointments — blokada rezerwacji online", () => {
  const blocked = () =>
    new Response(
      JSON.stringify({
        success: false,
        code: "ONLINE_BOOKING_UNAVAILABLE",
        error: "Rezerwacja online jest niedostępna. Skontaktuj się z salonem.",
      }),
      { status: 403, headers: { "Content-Type": "application/json" } }
    );

  const body = (extra: Record<string, unknown> = {}) => ({
    salonId: TEST_IDS.SALON_UUID,
    employeeId: TEST_IDS.EMPLOYEE_UUID,
    serviceId: TEST_IDS.SERVICE_UUID,
    startTime: "2026-04-01T10:00:00Z",
    endTime: "2026-04-01T11:00:00Z",
    ...extra,
  });
  const post = (extra?: Record<string, unknown>) =>
    createAppointment(
      createMockRequest("http://localhost:3000/api/appointments", { method: "POST", body: body(extra) })
    );

  beforeEach(() => {
    vi.clearAllMocks();
    mockDbSelect.mockReset();
    mockDbInsert.mockReset();
  });

  it("gość z numerem z zablokowanej karty (inny zapis numeru) → 403, przed zadatkiem i zapisem", async () => {
    const { getOptionalSession } = await import("@/lib/session");
    vi.mocked(getOptionalSession).mockResolvedValueOnce(null);
    mockBlockResponse.mockResolvedValueOnce(blocked());

    const res = await post({ guestName: "Jan Kowalski", guestPhone: "000 600 700" });
    const { status, body: json } = await parseResponse<{ code: string }>(res);

    expect(status).toBe(403);
    expect(json.code).toBe("ONLINE_BOOKING_UNAVAILABLE");
    expect(mockBlockResponse).toHaveBeenCalledWith({
      salonId: TEST_IDS.SALON_UUID,
      sessionUser: null,
      phone: "+48000600700",
    });
    expect(mockDepositGuard).not.toHaveBeenCalled();
    expect(mockDbInsert).not.toHaveBeenCalled();
    expect(mockSendBookingSms).not.toHaveBeenCalled();
  });

  it("zalogowany klient portalu → sprawdzenie z użytkownikiem sesji; 403 bez zapisu", async () => {
    mockGetSalonContext.mockResolvedValueOnce(null);
    mockBlockResponse.mockResolvedValueOnce(blocked());

    const res = await post();

    expect(res.status).toBe(403);
    expect(mockBlockResponse).toHaveBeenCalledWith({
      salonId: TEST_IDS.SALON_UUID,
      sessionUser: expect.objectContaining({ id: "test-user-id", email: "test@test.com" }),
      phone: null,
    });
    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  it("personel tego salonu → bez sprawdzenia blokady, wizyta zapisana", async () => {
    mockDbSelect.mockReturnValueOnce(chainMock([])).mockReturnValueOnce(chainMock([]));
    mockDbInsert.mockReturnValue(chainMock([makeAppointment()]));

    const res = await post({ clientId: TEST_IDS.CLIENT_UUID });

    expect(res.status).toBe(201);
    expect(mockBlockResponse).not.toHaveBeenCalled();
  });

  it("błąd sprawdzenia → 500, bez zapisu", async () => {
    mockGetSalonContext.mockResolvedValueOnce(null);
    mockBlockResponse.mockRejectedValueOnce(new Error("connection refused"));

    const res = await post();

    expect(res.status).toBe(500);
    expect(mockDbInsert).not.toHaveBeenCalled();
  });
});
