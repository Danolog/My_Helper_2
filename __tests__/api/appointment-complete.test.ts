/**
 * Integration tests for /api/appointments/[id]/complete endpoint.
 *
 * Tests cover:
 * - POST /api/appointments/[id]/complete (complete appointment with treatment,
 *   commission, stock deduction, loyalty points)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createMockRequest,
  createRouteParams,
  parseResponse,
  makeAppointment,
  makeService,
  TEST_IDS,
} from "./helpers";

// -------------------------------------------------------
// Mocks
// -------------------------------------------------------

const mockDbSelect = vi.fn();
const mockDbInsert = vi.fn();
const mockDbUpdate = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    select: (...args: unknown[]) => mockDbSelect(...args),
    insert: (...args: unknown[]) => mockDbInsert(...args),
    update: (...args: unknown[]) => mockDbUpdate(...args),
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
    appointments: createTable("appointments"),
    services: createTable("services"),
    treatmentHistory: createTable("treatmentHistory"),
    employeeCommissions: createTable("employeeCommissions"),
    employees: createTable("employees"),
    employeeServicePrices: createTable("employeeServicePrices"),
    serviceProducts: createTable("serviceProducts"),
    products: createTable("products"),
    productUsage: createTable("productUsage"),
    notifications: createTable("notifications"),
    loyaltyPoints: createTable("loyaltyPoints"),
    loyaltyTransactions: createTable("loyaltyTransactions"),
    salons: createTable("salons"),
  };
});

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: unknown[]) => ({ type: "eq", args })),
  and: vi.fn((...args: unknown[]) => ({ type: "and", args })),
  sql: vi.fn((...args: unknown[]) => ({ type: "sql", args })),
}));

vi.mock("@/lib/constants", () => ({
  DEFAULT_COMMISSION_RATE: 50,
}));

// -------------------------------------------------------
// Chain builder
// -------------------------------------------------------

function chainMock(result: unknown[] = []) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  const methods = [
    "select", "from", "where", "leftJoin",
    "limit", "orderBy",
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
// Import route handler
// -------------------------------------------------------

import { POST as completeAppointment } from "@/app/api/appointments/[id]/complete/route";

// -------------------------------------------------------
// Tests
// -------------------------------------------------------

describe("POST /api/appointments/[id]/complete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return 200 when completing an appointment successfully", async () => {
    const appointment = makeAppointment({ status: "scheduled" });
    const service = makeService({ basePrice: "200.00" });
    const treatment = { id: "treatment-1", appointmentId: TEST_IDS.APPOINTMENT_UUID, recipe: "Test recipe" };
    const updatedAppointment = { ...appointment, status: "completed" };
    const commission = { id: "comm-1", employeeId: TEST_IDS.EMPLOYEE_UUID, amount: "100.00", percentage: "50.00" };

    // 1. Fetch appointment with service
    mockDbSelect.mockReturnValueOnce(chainMock([{ appointment, service }]));
    // 2. Check for existing treatment record
    mockDbSelect.mockReturnValueOnce(chainMock([]));
    // 3. Insert new treatment record
    mockDbInsert.mockReturnValueOnce(chainMock([treatment]));
    // 4. Update appointment status to completed
    mockDbUpdate.mockReturnValueOnce(chainMock([updatedAppointment]));
    // 5. Get employee's commission rate
    mockDbSelect.mockReturnValueOnce(chainMock([{ commissionRate: "50.00" }]));
    // 6. Check for employee-specific pricing (none)
    mockDbSelect.mockReturnValueOnce(chainMock([]));
    // 7. Check for existing commission (none)
    mockDbSelect.mockReturnValueOnce(chainMock([]));
    // 8. Insert new commission record
    mockDbInsert.mockReturnValueOnce(chainMock([commission]));
    // 9. Get linked products for service (none)
    mockDbSelect.mockReturnValueOnce(chainMock([]));
    // 10. Loyalty: fetch salon settings (no loyalty)
    mockDbSelect.mockReturnValueOnce(chainMock([{
      id: TEST_IDS.SALON_UUID,
      settingsJson: null,
    }]));

    const request = createMockRequest(
      `http://localhost:3000/api/appointments/${TEST_IDS.APPOINTMENT_UUID}/complete`,
      {
        method: "POST",
        body: {
          recipe: "Test recipe",
          techniques: "Technique A",
          notes: "All good",
        },
      }
    );
    const params = createRouteParams(TEST_IDS.APPOINTMENT_UUID);
    const response = await completeAppointment(request, params);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect((body as any).data.appointment).toBeDefined();
    expect((body as any).data.treatment).toBeDefined();
    expect((body as any).data.commission).toBeDefined();
    expect(body.message).toContain("pomyslnie");
  });

  it("should return 404 when appointment not found", async () => {
    mockDbSelect.mockReturnValue(chainMock([]));

    const request = createMockRequest(
      `http://localhost:3000/api/appointments/${TEST_IDS.APPOINTMENT_UUID}/complete`,
      {
        method: "POST",
        body: {},
      }
    );
    const params = createRouteParams(TEST_IDS.APPOINTMENT_UUID);
    const response = await completeAppointment(request, params);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(404);
    expect(body.success).toBe(false);
    expect(body.error).toContain("not found");
  });

  it("should return 400 when appointment is already completed", async () => {
    const appointment = makeAppointment({ status: "completed" });
    const service = makeService();

    mockDbSelect.mockReturnValue(chainMock([{ appointment, service }]));

    const request = createMockRequest(
      `http://localhost:3000/api/appointments/${TEST_IDS.APPOINTMENT_UUID}/complete`,
      {
        method: "POST",
        body: {},
      }
    );
    const params = createRouteParams(TEST_IDS.APPOINTMENT_UUID);
    const response = await completeAppointment(request, params);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toContain("zakonczona");
  });

  it("should return 400 when appointment is cancelled", async () => {
    const appointment = makeAppointment({ status: "cancelled" });
    const service = makeService();

    mockDbSelect.mockReturnValue(chainMock([{ appointment, service }]));

    const request = createMockRequest(
      `http://localhost:3000/api/appointments/${TEST_IDS.APPOINTMENT_UUID}/complete`,
      {
        method: "POST",
        body: {},
      }
    );
    const params = createRouteParams(TEST_IDS.APPOINTMENT_UUID);
    const response = await completeAppointment(request, params);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toContain("anulowanej");
  });

  it("should return 500 when database throws", async () => {
    const errorChain: Record<string, unknown> = {};
    const methods = ["select", "from", "where", "leftJoin", "limit"];
    for (const m of methods) {
      (errorChain as Record<string, ReturnType<typeof vi.fn>>)[m] = vi.fn().mockReturnValue(errorChain);
    }
    errorChain.then = (_: unknown, reject: (err: Error) => void) => reject(new Error("DB failure"));
    mockDbSelect.mockReturnValue(errorChain);

    const request = createMockRequest(
      `http://localhost:3000/api/appointments/${TEST_IDS.APPOINTMENT_UUID}/complete`,
      {
        method: "POST",
        body: {},
      }
    );
    const params = createRouteParams(TEST_IDS.APPOINTMENT_UUID);
    const response = await completeAppointment(request, params);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(500);
    expect(body.success).toBe(false);
  });
});
