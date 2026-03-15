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

vi.mock("@/lib/auth-middleware", () => ({
  requireAuth: vi.fn().mockResolvedValue({
    session: { user: { id: "test-user-id", email: "test@test.com", name: "Test User" } },
    user: { id: "test-user-id", email: "test@test.com", name: "Test User" },
  }),
  isAuthError: vi.fn().mockReturnValue(false),
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

  // -------------------------------------------------------
  // Additional branch coverage tests
  // -------------------------------------------------------

  it("should update existing treatment record instead of inserting", async () => {
    const appointment = makeAppointment({ status: "scheduled" });
    const service = makeService({ basePrice: "200.00" });
    const existingTreatment = {
      id: "existing-treat-1",
      appointmentId: TEST_IDS.APPOINTMENT_UUID,
      recipe: "Old recipe",
      techniques: "Old technique",
      notes: "Old notes",
    };
    const updatedTreatment = {
      ...existingTreatment,
      recipe: "New recipe",
      techniques: "New technique",
      notes: "New notes",
    };
    const updatedAppointment = { ...appointment, status: "completed" };
    const commission = { id: "comm-1", employeeId: TEST_IDS.EMPLOYEE_UUID, amount: "100.00", percentage: "50.00" };

    // 1. Fetch appointment with service
    mockDbSelect.mockReturnValueOnce(chainMock([{ appointment, service }]));
    // 2. Check for existing treatment record -> found
    mockDbSelect.mockReturnValueOnce(chainMock([existingTreatment]));
    // 3. Update existing treatment record (not insert)
    mockDbUpdate.mockReturnValueOnce(chainMock([updatedTreatment]));
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
    mockDbSelect.mockReturnValueOnce(chainMock([{ id: TEST_IDS.SALON_UUID, settingsJson: null }]));

    const request = createMockRequest(
      `http://localhost:3000/api/appointments/${TEST_IDS.APPOINTMENT_UUID}/complete`,
      {
        method: "POST",
        body: { recipe: "New recipe", techniques: "New technique", notes: "New notes" },
      }
    );
    const params = createRouteParams(TEST_IDS.APPOINTMENT_UUID);
    const response = await completeAppointment(request, params);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect((body as any).data.treatment).toEqual(updatedTreatment);
    // Treatment update should be the first update call, not an insert
    expect(mockDbUpdate).toHaveBeenCalledTimes(2); // treatment update + appointment update
    // No treatment insert should have been called (only commission insert)
    expect(mockDbInsert).toHaveBeenCalledTimes(1);
  });

  it("should use explicit commissionPercentage from body instead of employee lookup", async () => {
    const appointment = makeAppointment({ status: "scheduled" });
    const service = makeService({ basePrice: "200.00" });
    const treatment = { id: "treatment-1", appointmentId: TEST_IDS.APPOINTMENT_UUID };
    const updatedAppointment = { ...appointment, status: "completed" };

    // With explicit commissionPercentage, the employee lookup for commission rate is skipped.
    // Expected commission: 200 * 30 / 100 = 60.00

    // 1. Fetch appointment with service
    mockDbSelect.mockReturnValueOnce(chainMock([{ appointment, service }]));
    // 2. Check for existing treatment record (none)
    mockDbSelect.mockReturnValueOnce(chainMock([]));
    // 3. Insert new treatment record
    mockDbInsert.mockReturnValueOnce(chainMock([treatment]));
    // 4. Update appointment status to completed
    mockDbUpdate.mockReturnValueOnce(chainMock([updatedAppointment]));
    // NOTE: No employee commission rate lookup (step 5 skipped because commissionPercentage provided)
    // 5. Check for employee-specific pricing (none)
    mockDbSelect.mockReturnValueOnce(chainMock([]));
    // 6. Check for existing commission (none)
    mockDbSelect.mockReturnValueOnce(chainMock([]));
    // 7. Insert new commission record
    const expectedCommission = { id: "comm-1", amount: "60.00", percentage: "30.00" };
    mockDbInsert.mockReturnValueOnce(chainMock([expectedCommission]));
    // 8. Get linked products for service (none)
    mockDbSelect.mockReturnValueOnce(chainMock([]));
    // 9. Loyalty: fetch salon settings (no loyalty)
    mockDbSelect.mockReturnValueOnce(chainMock([{ id: TEST_IDS.SALON_UUID, settingsJson: null }]));

    const request = createMockRequest(
      `http://localhost:3000/api/appointments/${TEST_IDS.APPOINTMENT_UUID}/complete`,
      {
        method: "POST",
        body: { commissionPercentage: "30" },
      }
    );
    const params = createRouteParams(TEST_IDS.APPOINTMENT_UUID);
    const response = await completeAppointment(request, params);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect((body as any).data.commission).toEqual(expectedCommission);
    // Employee commission rate lookup should NOT have been called.
    // Total selects: appointment(1) + treatment(1) + empPrice(1) + existingComm(1) + linkedProducts(1) + salon(1) = 6
    // If employee lookup had occurred, it would be 7.
    expect(mockDbSelect).toHaveBeenCalledTimes(6);
  });

  it("should set commission to null when appointment has no employeeId", async () => {
    const appointment = makeAppointment({ status: "scheduled", employeeId: null });
    const service = makeService({ basePrice: "200.00" });
    const treatment = { id: "treatment-1", appointmentId: TEST_IDS.APPOINTMENT_UUID };
    const updatedAppointment = { ...appointment, status: "completed" };

    // Without employeeId: no employee lookup, no pricing check, no commission, but
    // still check linked products and loyalty.

    // 1. Fetch appointment with service
    mockDbSelect.mockReturnValueOnce(chainMock([{ appointment, service }]));
    // 2. Check for existing treatment record (none)
    mockDbSelect.mockReturnValueOnce(chainMock([]));
    // 3. Insert new treatment record
    mockDbInsert.mockReturnValueOnce(chainMock([treatment]));
    // 4. Update appointment status to completed
    mockDbUpdate.mockReturnValueOnce(chainMock([updatedAppointment]));
    // NOTE: No employee commission rate lookup (no employeeId)
    // NOTE: No employee-specific pricing check (no employeeId)
    // NOTE: No commission record check/insert (no employeeId)
    // 5. Get linked products for service (none)
    mockDbSelect.mockReturnValueOnce(chainMock([]));
    // 6. Loyalty: fetch salon settings (no loyalty)
    mockDbSelect.mockReturnValueOnce(chainMock([{ id: TEST_IDS.SALON_UUID, settingsJson: null }]));

    const request = createMockRequest(
      `http://localhost:3000/api/appointments/${TEST_IDS.APPOINTMENT_UUID}/complete`,
      {
        method: "POST",
        body: { notes: "No employee appointment" },
      }
    );
    const params = createRouteParams(TEST_IDS.APPOINTMENT_UUID);
    const response = await completeAppointment(request, params);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect((body as any).data.commission).toBeNull();
    // No commission insert/update should have occurred
    expect(mockDbInsert).toHaveBeenCalledTimes(1); // only treatment insert
  });

  it("should use employee-specific custom price for commission calculation", async () => {
    const appointment = makeAppointment({ status: "scheduled" });
    const service = makeService({ basePrice: "200.00" });
    const treatment = { id: "treatment-1", appointmentId: TEST_IDS.APPOINTMENT_UUID };
    const updatedAppointment = { ...appointment, status: "completed" };

    // Employee-specific price is 150.00 instead of base 200.00
    // Commission: 150 * 50 / 100 = 75.00
    const employeePrice = { customPrice: "150.00", employeeId: TEST_IDS.EMPLOYEE_UUID, serviceId: TEST_IDS.SERVICE_UUID };
    const expectedCommission = { id: "comm-1", amount: "75.00", percentage: "50.00" };

    // 1. Fetch appointment with service
    mockDbSelect.mockReturnValueOnce(chainMock([{ appointment, service }]));
    // 2. Check for existing treatment record (none)
    mockDbSelect.mockReturnValueOnce(chainMock([]));
    // 3. Insert new treatment record
    mockDbInsert.mockReturnValueOnce(chainMock([treatment]));
    // 4. Update appointment status to completed
    mockDbUpdate.mockReturnValueOnce(chainMock([updatedAppointment]));
    // 5. Get employee's commission rate
    mockDbSelect.mockReturnValueOnce(chainMock([{ commissionRate: "50.00" }]));
    // 6. Check for employee-specific pricing -> found
    mockDbSelect.mockReturnValueOnce(chainMock([employeePrice]));
    // 7. Check for existing commission (none)
    mockDbSelect.mockReturnValueOnce(chainMock([]));
    // 8. Insert new commission record
    mockDbInsert.mockReturnValueOnce(chainMock([expectedCommission]));
    // 9. Get linked products for service (none)
    mockDbSelect.mockReturnValueOnce(chainMock([]));
    // 10. Loyalty: fetch salon settings (no loyalty)
    mockDbSelect.mockReturnValueOnce(chainMock([{ id: TEST_IDS.SALON_UUID, settingsJson: null }]));

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

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect((body as any).data.commission).toEqual(expectedCommission);
  });

  it("should update existing commission record instead of inserting", async () => {
    const appointment = makeAppointment({ status: "scheduled" });
    const service = makeService({ basePrice: "200.00" });
    const treatment = { id: "treatment-1", appointmentId: TEST_IDS.APPOINTMENT_UUID };
    const updatedAppointment = { ...appointment, status: "completed" };

    const existingCommission = { id: "existing-comm-1", employeeId: TEST_IDS.EMPLOYEE_UUID, amount: "80.00", percentage: "40.00" };
    const updatedCommission = { id: "existing-comm-1", employeeId: TEST_IDS.EMPLOYEE_UUID, amount: "100.00", percentage: "50.00" };

    // 1. Fetch appointment with service
    mockDbSelect.mockReturnValueOnce(chainMock([{ appointment, service }]));
    // 2. Check for existing treatment record (none)
    mockDbSelect.mockReturnValueOnce(chainMock([]));
    // 3. Insert new treatment record
    mockDbInsert.mockReturnValueOnce(chainMock([treatment]));
    // 4. Update appointment status to completed
    mockDbUpdate.mockReturnValueOnce(chainMock([updatedAppointment]));
    // 5. Get employee's commission rate
    mockDbSelect.mockReturnValueOnce(chainMock([{ commissionRate: "50.00" }]));
    // 6. Check for employee-specific pricing (none)
    mockDbSelect.mockReturnValueOnce(chainMock([]));
    // 7. Check for existing commission -> found
    mockDbSelect.mockReturnValueOnce(chainMock([existingCommission]));
    // 8. Update existing commission record (not insert)
    mockDbUpdate.mockReturnValueOnce(chainMock([updatedCommission]));
    // 9. Get linked products for service (none)
    mockDbSelect.mockReturnValueOnce(chainMock([]));
    // 10. Loyalty: fetch salon settings (no loyalty)
    mockDbSelect.mockReturnValueOnce(chainMock([{ id: TEST_IDS.SALON_UUID, settingsJson: null }]));

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

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect((body as any).data.commission).toEqual(updatedCommission);
    // Commission should be updated (3 updates: appointment + commission), not inserted
    // treatment insert is the only insert
    expect(mockDbInsert).toHaveBeenCalledTimes(1); // only treatment insert
    expect(mockDbUpdate).toHaveBeenCalledTimes(2); // appointment update + commission update
  });

  it("should deduct stock for linked products and record product usage", async () => {
    const appointment = makeAppointment({ status: "scheduled" });
    const service = makeService({ basePrice: "200.00" });
    const treatment = { id: "treatment-1", appointmentId: TEST_IDS.APPOINTMENT_UUID };
    const updatedAppointment = { ...appointment, status: "completed" };
    const commission = { id: "comm-1", amount: "100.00", percentage: "50.00" };

    const linkedProduct = {
      linkId: "sp-1",
      productId: TEST_IDS.PRODUCT_UUID,
      defaultQuantity: "2",
      productName: "Szampon",
      productQuantity: "10",
      productUnit: "ml",
      productMinQuantity: "5",
      productSalonId: TEST_IDS.SALON_UUID,
    };

    // 1. Fetch appointment with service
    mockDbSelect.mockReturnValueOnce(chainMock([{ appointment, service }]));
    // 2. Check for existing treatment record (none)
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
    // 9. Get linked products for service -> one product found
    mockDbSelect.mockReturnValueOnce(chainMock([linkedProduct]));
    // 10. Update product stock (deduction: 10 - 2 = 8)
    mockDbUpdate.mockReturnValueOnce(chainMock([]));
    // 11. Insert product usage record
    mockDbInsert.mockReturnValueOnce(chainMock([]));
    // 12. Low stock check: query existing notifications (stock 8 > min 5, so won't reach insert)
    // Actually, qty=8 > minQty=5, so checkAndNotifyLowStock returns { notificationSent: false, reason: "stock_ok" }
    // No DB call is made for the "stock_ok" path since 8 > 5
    // 13. Loyalty: fetch salon settings (no loyalty)
    mockDbSelect.mockReturnValueOnce(chainMock([{ id: TEST_IDS.SALON_UUID, settingsJson: null }]));

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

    expect(status).toBe(200);
    expect(body.success).toBe(true);

    const data = (body as any).data;
    expect(data.stockDeductions).toHaveLength(1);
    expect(data.stockDeductions[0].productId).toBe(TEST_IDS.PRODUCT_UUID);
    expect(data.stockDeductions[0].productName).toBe("Szampon");
    expect(data.stockDeductions[0].quantityDeducted).toBe(2);
    expect(data.stockDeductions[0].newQuantity).toBe(8);
    expect(data.stockDeductions[0].unit).toBe("ml");

    // Stock update + appointment update = 2 updates (+ any commission)
    // product update is one of the update calls
    expect(mockDbUpdate).toHaveBeenCalledTimes(2); // appointment update + product stock update
    // treatment insert + commission insert + product usage insert = 3 inserts
    expect(mockDbInsert).toHaveBeenCalledTimes(3);
  });

  it("should skip linked product when productName is null (deleted product)", async () => {
    const appointment = makeAppointment({ status: "scheduled" });
    const service = makeService({ basePrice: "200.00" });
    const treatment = { id: "treatment-1", appointmentId: TEST_IDS.APPOINTMENT_UUID };
    const updatedAppointment = { ...appointment, status: "completed" };
    const commission = { id: "comm-1", amount: "100.00", percentage: "50.00" };

    // A linked product where the product was deleted (productName is null)
    const deletedLinkedProduct = {
      linkId: "sp-1",
      productId: TEST_IDS.PRODUCT_UUID,
      defaultQuantity: "2",
      productName: null,
      productQuantity: null,
      productUnit: null,
      productMinQuantity: null,
      productSalonId: null,
    };

    // 1. Fetch appointment with service
    mockDbSelect.mockReturnValueOnce(chainMock([{ appointment, service }]));
    // 2. Check for existing treatment record (none)
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
    // 9. Get linked products for service -> one product with null name (deleted)
    mockDbSelect.mockReturnValueOnce(chainMock([deletedLinkedProduct]));
    // No stock update or product usage insert - skipped due to null productName
    // 10. Loyalty: fetch salon settings (no loyalty)
    mockDbSelect.mockReturnValueOnce(chainMock([{ id: TEST_IDS.SALON_UUID, settingsJson: null }]));

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

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    // No stock deductions should be recorded for deleted products
    expect((body as any).data.stockDeductions).toHaveLength(0);
    // Only appointment update, no product stock update
    expect(mockDbUpdate).toHaveBeenCalledTimes(1); // only appointment update
  });

  it("should create loyalty record and award points when loyalty is enabled and no existing record", async () => {
    const appointment = makeAppointment({ status: "scheduled" });
    const service = makeService({ basePrice: "200.00", name: "Masaz" });
    const treatment = { id: "treatment-1", appointmentId: TEST_IDS.APPOINTMENT_UUID };
    const updatedAppointment = { ...appointment, status: "completed" };
    const commission = { id: "comm-1", amount: "100.00", percentage: "50.00" };

    const loyaltySettings = {
      enabled: true,
      pointsPerCurrencyUnit: 1,
      currencyUnit: 1,
      pointsExpiryDays: null,
      rewardTiers: [],
    };

    const newLoyaltyRecord = { id: "loyalty-1", clientId: TEST_IDS.CLIENT_UUID, salonId: TEST_IDS.SALON_UUID, points: 0 };
    const loyaltyTransaction = { id: "lt-1", loyaltyId: "loyalty-1", pointsChange: 200 };

    // 1. Fetch appointment with service
    mockDbSelect.mockReturnValueOnce(chainMock([{ appointment, service }]));
    // 2. Check for existing treatment record (none)
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
    // 10. Loyalty: fetch salon settings -> loyalty enabled
    mockDbSelect.mockReturnValueOnce(chainMock([{
      id: TEST_IDS.SALON_UUID,
      settingsJson: { loyalty: loyaltySettings },
    }]));
    // 11. Loyalty: check employee-specific pricing for points (since employeeId exists)
    mockDbSelect.mockReturnValueOnce(chainMock([]));
    // 12. Loyalty: check existing loyalty record -> none
    mockDbSelect.mockReturnValueOnce(chainMock([]));
    // 13. Loyalty: insert new loyalty record
    mockDbInsert.mockReturnValueOnce(chainMock([newLoyaltyRecord]));
    // 14. Loyalty: update points balance (0 + 200 = 200)
    mockDbUpdate.mockReturnValueOnce(chainMock([]));
    // 15. Loyalty: insert loyalty transaction
    mockDbInsert.mockReturnValueOnce(chainMock([loyaltyTransaction]));

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

    expect(status).toBe(200);
    expect(body.success).toBe(true);

    const data = (body as any).data;
    expect(data.loyalty).not.toBeNull();
    expect(data.loyalty.pointsAwarded).toBe(200);
    expect(data.loyalty.totalPoints).toBe(200);
    expect(data.loyalty.loyaltyId).toBe("loyalty-1");
    expect(data.loyalty.transactionId).toBe("lt-1");
  });

  it("should update existing loyalty record and award points when loyalty is enabled", async () => {
    const appointment = makeAppointment({ status: "scheduled" });
    const service = makeService({ basePrice: "100.00", name: "Koloryzacja" });
    const treatment = { id: "treatment-1", appointmentId: TEST_IDS.APPOINTMENT_UUID };
    const updatedAppointment = { ...appointment, status: "completed" };
    const commission = { id: "comm-1", amount: "50.00", percentage: "50.00" };

    const loyaltySettings = {
      enabled: true,
      pointsPerCurrencyUnit: 2,
      currencyUnit: 10,
      pointsExpiryDays: 365,
      rewardTiers: [],
    };

    // Existing loyalty record with 50 points already
    const existingLoyaltyRecord = {
      id: "loyalty-1",
      clientId: TEST_IDS.CLIENT_UUID,
      salonId: TEST_IDS.SALON_UUID,
      points: 50,
    };
    // Points: floor((100 / 10) * 2) = 20 new points, total = 50 + 20 = 70
    const loyaltyTransaction = { id: "lt-1", loyaltyId: "loyalty-1", pointsChange: 20 };

    // 1. Fetch appointment with service
    mockDbSelect.mockReturnValueOnce(chainMock([{ appointment, service }]));
    // 2. Check for existing treatment record (none)
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
    // 10. Loyalty: fetch salon settings -> loyalty enabled
    mockDbSelect.mockReturnValueOnce(chainMock([{
      id: TEST_IDS.SALON_UUID,
      settingsJson: { loyalty: loyaltySettings },
    }]));
    // 11. Loyalty: check employee-specific pricing for points (since employeeId exists)
    mockDbSelect.mockReturnValueOnce(chainMock([]));
    // 12. Loyalty: check existing loyalty record -> found with 50 points
    mockDbSelect.mockReturnValueOnce(chainMock([existingLoyaltyRecord]));
    // NOTE: No insert for loyalty record since it already exists
    // 13. Loyalty: update points balance (50 + 20 = 70)
    mockDbUpdate.mockReturnValueOnce(chainMock([]));
    // 14. Loyalty: insert loyalty transaction
    mockDbInsert.mockReturnValueOnce(chainMock([loyaltyTransaction]));

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

    expect(status).toBe(200);
    expect(body.success).toBe(true);

    const data = (body as any).data;
    expect(data.loyalty).not.toBeNull();
    expect(data.loyalty.pointsAwarded).toBe(20);
    expect(data.loyalty.totalPoints).toBe(70);
    expect(data.loyalty.loyaltyId).toBe("loyalty-1");
  });

  it("should not award loyalty points when loyalty is disabled", async () => {
    const appointment = makeAppointment({ status: "scheduled" });
    const service = makeService({ basePrice: "200.00" });
    const treatment = { id: "treatment-1", appointmentId: TEST_IDS.APPOINTMENT_UUID };
    const updatedAppointment = { ...appointment, status: "completed" };
    const commission = { id: "comm-1", amount: "100.00", percentage: "50.00" };

    const loyaltySettings = {
      enabled: false,
      pointsPerCurrencyUnit: 1,
      currencyUnit: 1,
      pointsExpiryDays: null,
      rewardTiers: [],
    };

    // 1. Fetch appointment with service
    mockDbSelect.mockReturnValueOnce(chainMock([{ appointment, service }]));
    // 2. Check for existing treatment record (none)
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
    // 10. Loyalty: fetch salon settings -> loyalty disabled
    mockDbSelect.mockReturnValueOnce(chainMock([{
      id: TEST_IDS.SALON_UUID,
      settingsJson: { loyalty: loyaltySettings },
    }]));
    // No further loyalty DB calls since loyalty is disabled

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

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect((body as any).data.loyalty).toBeNull();
    // Verify no loyalty-related inserts occurred beyond the base ones
    expect(mockDbInsert).toHaveBeenCalledTimes(2); // treatment + commission only
  });

  it("should reduce price for loyalty points when appointment has discountAmount", async () => {
    const appointment = makeAppointment({ status: "scheduled", discountAmount: "50.00" });
    const service = makeService({ basePrice: "200.00", name: "Premium" });
    const treatment = { id: "treatment-1", appointmentId: TEST_IDS.APPOINTMENT_UUID };
    const updatedAppointment = { ...appointment, status: "completed" };
    const commission = { id: "comm-1", amount: "100.00", percentage: "50.00" };

    const loyaltySettings = {
      enabled: true,
      pointsPerCurrencyUnit: 1,
      currencyUnit: 1,
      pointsExpiryDays: null,
      rewardTiers: [],
    };

    // Effective price for points: 200 - 50 = 150 -> 150 points
    const existingLoyaltyRecord = {
      id: "loyalty-1",
      clientId: TEST_IDS.CLIENT_UUID,
      salonId: TEST_IDS.SALON_UUID,
      points: 10,
    };
    const loyaltyTransaction = { id: "lt-1", loyaltyId: "loyalty-1", pointsChange: 150 };

    // 1. Fetch appointment with service
    mockDbSelect.mockReturnValueOnce(chainMock([{ appointment, service }]));
    // 2. Check for existing treatment record (none)
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
    // 10. Loyalty: fetch salon settings -> loyalty enabled
    mockDbSelect.mockReturnValueOnce(chainMock([{
      id: TEST_IDS.SALON_UUID,
      settingsJson: { loyalty: loyaltySettings },
    }]));
    // 11. Loyalty: check employee-specific pricing for points (since employeeId exists)
    mockDbSelect.mockReturnValueOnce(chainMock([]));
    // 12. Loyalty: check existing loyalty record -> found with 10 points
    mockDbSelect.mockReturnValueOnce(chainMock([existingLoyaltyRecord]));
    // 13. Loyalty: update points balance (10 + 150 = 160)
    mockDbUpdate.mockReturnValueOnce(chainMock([]));
    // 14. Loyalty: insert loyalty transaction
    mockDbInsert.mockReturnValueOnce(chainMock([loyaltyTransaction]));

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

    expect(status).toBe(200);
    expect(body.success).toBe(true);

    const data = (body as any).data;
    expect(data.loyalty).not.toBeNull();
    // Points should be based on discounted price: 200 - 50 = 150
    expect(data.loyalty.pointsAwarded).toBe(150);
    expect(data.loyalty.totalPoints).toBe(160); // 10 existing + 150 new
  });

  it("should trigger low stock notification when stock falls below minimum", async () => {
    const appointment = makeAppointment({ status: "scheduled" });
    const service = makeService({ basePrice: "200.00" });
    const treatment = { id: "treatment-1", appointmentId: TEST_IDS.APPOINTMENT_UUID };
    const updatedAppointment = { ...appointment, status: "completed" };
    const commission = { id: "comm-1", amount: "100.00", percentage: "50.00" };

    // Product with quantity 3, deduct 2 -> new qty 1, min is 5 -> low stock!
    const linkedProduct = {
      linkId: "sp-1",
      productId: TEST_IDS.PRODUCT_UUID,
      defaultQuantity: "2",
      productName: "Farba",
      productQuantity: "3",
      productUnit: "szt.",
      productMinQuantity: "5",
      productSalonId: TEST_IDS.SALON_UUID,
    };

    const notification = { id: "notif-1", salonId: TEST_IDS.SALON_UUID, type: "system" };

    // 1. Fetch appointment with service
    mockDbSelect.mockReturnValueOnce(chainMock([{ appointment, service }]));
    // 2. Check for existing treatment record (none)
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
    // 9. Get linked products for service -> one product
    mockDbSelect.mockReturnValueOnce(chainMock([linkedProduct]));
    // 10. Update product stock (deduction: 3 - 2 = 1)
    mockDbUpdate.mockReturnValueOnce(chainMock([]));
    // 11. Insert product usage record
    mockDbInsert.mockReturnValueOnce(chainMock([]));
    // 12. Low stock check: qty 1 <= minQty 5, check for existing recent notification -> none
    mockDbSelect.mockReturnValueOnce(chainMock([]));
    // 13. Low stock: insert notification
    mockDbInsert.mockReturnValueOnce(chainMock([notification]));
    // 14. Loyalty: fetch salon settings (no loyalty)
    mockDbSelect.mockReturnValueOnce(chainMock([{ id: TEST_IDS.SALON_UUID, settingsJson: null }]));

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

    expect(status).toBe(200);
    expect(body.success).toBe(true);

    const data = (body as any).data;
    expect(data.stockDeductions).toHaveLength(1);
    expect(data.stockDeductions[0].newQuantity).toBe(1);
    expect(data.stockDeductions[0].lowStockAlert).toEqual({
      notificationSent: true,
      notification,
    });
  });

  it("should skip duplicate low stock notification within 24h", async () => {
    const appointment = makeAppointment({ status: "scheduled" });
    const service = makeService({ basePrice: "200.00" });
    const treatment = { id: "treatment-1", appointmentId: TEST_IDS.APPOINTMENT_UUID };
    const updatedAppointment = { ...appointment, status: "completed" };
    const commission = { id: "comm-1", amount: "100.00", percentage: "50.00" };

    // Product with low stock
    const linkedProduct = {
      linkId: "sp-1",
      productId: TEST_IDS.PRODUCT_UUID,
      defaultQuantity: "1",
      productName: "Farba",
      productQuantity: "2",
      productUnit: "szt.",
      productMinQuantity: "5",
      productSalonId: TEST_IDS.SALON_UUID,
    };

    // 1. Fetch appointment with service
    mockDbSelect.mockReturnValueOnce(chainMock([{ appointment, service }]));
    // 2. Check for existing treatment record (none)
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
    // 9. Get linked products for service -> one product
    mockDbSelect.mockReturnValueOnce(chainMock([linkedProduct]));
    // 10. Update product stock (deduction: 2 - 1 = 1)
    mockDbUpdate.mockReturnValueOnce(chainMock([]));
    // 11. Insert product usage record
    mockDbInsert.mockReturnValueOnce(chainMock([]));
    // 12. Low stock check: qty 1 <= minQty 5, check for existing recent notification -> found duplicate
    mockDbSelect.mockReturnValueOnce(chainMock([{ id: "existing-notif-1" }]));
    // No notification insert because duplicate exists
    // 13. Loyalty: fetch salon settings (no loyalty)
    mockDbSelect.mockReturnValueOnce(chainMock([{ id: TEST_IDS.SALON_UUID, settingsJson: null }]));

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

    expect(status).toBe(200);
    expect(body.success).toBe(true);

    const data = (body as any).data;
    expect(data.stockDeductions).toHaveLength(1);
    expect(data.stockDeductions[0].lowStockAlert).toEqual({
      notificationSent: false,
      reason: "duplicate",
    });
  });

  it("should skip low stock check when product has no minQuantity", async () => {
    const appointment = makeAppointment({ status: "scheduled" });
    const service = makeService({ basePrice: "200.00" });
    const treatment = { id: "treatment-1", appointmentId: TEST_IDS.APPOINTMENT_UUID };
    const updatedAppointment = { ...appointment, status: "completed" };
    const commission = { id: "comm-1", amount: "100.00", percentage: "50.00" };

    // Product with no minQuantity set
    const linkedProduct = {
      linkId: "sp-1",
      productId: TEST_IDS.PRODUCT_UUID,
      defaultQuantity: "1",
      productName: "Olejek",
      productQuantity: "5",
      productUnit: "ml",
      productMinQuantity: null,
      productSalonId: TEST_IDS.SALON_UUID,
    };

    // 1. Fetch appointment with service
    mockDbSelect.mockReturnValueOnce(chainMock([{ appointment, service }]));
    // 2. Check for existing treatment record (none)
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
    // 9. Get linked products for service -> one product
    mockDbSelect.mockReturnValueOnce(chainMock([linkedProduct]));
    // 10. Update product stock (deduction: 5 - 1 = 4)
    mockDbUpdate.mockReturnValueOnce(chainMock([]));
    // 11. Insert product usage record
    mockDbInsert.mockReturnValueOnce(chainMock([]));
    // No low stock DB call because minQuantity is null -> checkAndNotifyLowStock returns null early
    // 12. Loyalty: fetch salon settings (no loyalty)
    mockDbSelect.mockReturnValueOnce(chainMock([{ id: TEST_IDS.SALON_UUID, settingsJson: null }]));

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

    expect(status).toBe(200);
    expect(body.success).toBe(true);

    const data = (body as any).data;
    expect(data.stockDeductions).toHaveLength(1);
    expect(data.stockDeductions[0].newQuantity).toBe(4);
    // lowStockAlert should be null since minQuantity is null
    expect(data.stockDeductions[0].lowStockAlert).toBeNull();
  });
});
