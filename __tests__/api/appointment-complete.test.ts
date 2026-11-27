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

interface MockTx {
  select: (...args: unknown[]) => ReturnType<typeof mockDbSelect>;
  insert: (...args: unknown[]) => ReturnType<typeof mockDbInsert>;
  update: (...args: unknown[]) => ReturnType<typeof mockDbUpdate>;
  execute: (...args: unknown[]) => Promise<undefined>;
  /** Zagnieżdżona transakcja (savepoint) — ten sam obiekt; liczona w `savepoints`. */
  transaction: (cb: (tx: MockTx) => Promise<unknown>) => Promise<unknown>;
}

const savepoints = vi.hoisted(() => ({ count: 0 }));

vi.mock("@/lib/db", () => {
  // The tx object passed into db.transaction() reuses the same mock fns
  // so that existing mockReturnValueOnce chains work identically.
  // execute: SET LOCAL ROLE + set_config wykonywane przez forSalon (ADR-001).
  const tx: MockTx = {
    select: (...args: unknown[]) => mockDbSelect(...args),
    insert: (...args: unknown[]) => mockDbInsert(...args),
    update: (...args: unknown[]) => mockDbUpdate(...args),
    execute: () => Promise.resolve(undefined),
    transaction: async (cb) => {
      savepoints.count++;
      return cb(tx);
    },
  };
  return {
    db: {
      select: (...args: unknown[]) => mockDbSelect(...args),
      insert: (...args: unknown[]) => mockDbInsert(...args),
      update: (...args: unknown[]) => mockDbUpdate(...args),
      transaction: async (cb: (tx: MockTx) => Promise<unknown>) => cb(tx),
    },
  };
});

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
    appointmentMaterials: createTable("appointmentMaterials"),
    notifications: createTable("notifications"),
    loyaltyPoints: createTable("loyaltyPoints"),
    loyaltyTransactions: createTable("loyaltyTransactions"),
    salons: createTable("salons"),
  };
});

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: unknown[]) => ({ type: "eq", args })),
  and: vi.fn((...args: unknown[]) => ({ type: "and", args })),
  like: vi.fn((...args: unknown[]) => ({ type: "like", args })),
  notInArray: vi.fn((...args: unknown[]) => ({ type: "notInArray", args })),
  // sql`...` (set_config) + sql.raw (SET LOCAL ROLE) — oba używa forSalon.
  sql: Object.assign(
    vi.fn((...args: unknown[]) => ({ type: "sql", args })),
    { raw: vi.fn((query: string) => ({ type: "sql.raw", query })) }
  ),
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

// Tenant isolation (P0-A): the route resolves the salon from the session.
// Without this mock the route hits the real DB-backed resolver and throws.
vi.mock("@/lib/get-user-salon", () => ({
  getUserSalonId: vi.fn().mockResolvedValue(TEST_IDS.SALON_UUID),
  getUserSalon: vi.fn().mockResolvedValue({ id: TEST_IDS.SALON_UUID }),
}));

// Faza 3 (role): trasa complete przeszła na getSalonContext. Domyślnie
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

// Lojalność jest zamrożona w rejestrze modułów (hardOff w src/lib/features.ts,
// krok B1). Kod naliczania punktów zostaje w repo i czeka na odmrożenie —
// jego testy też zostają: `loyaltyThaw.on = true` symuluje moduł odmrożony.
// Domyślnie false, czyli obowiązuje prawdziwy rejestr (test blokady niżej).
const loyaltyThaw = vi.hoisted(() => ({ on: false }));

vi.mock("@/lib/features", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/features")>();
  return {
    ...actual,
    resolveModules: (settingsJson: unknown) => {
      const state = actual.resolveModules(settingsJson);
      return loyaltyThaw.on ? { ...state, loyalty: true } : state;
    },
  };
});

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
import {
  NO_SHOW_COMPLETE_BLOCKED_CODE,
  NO_SHOW_COMPLETE_BLOCKED_MESSAGE,
  NO_SHOW_RESTORED_STATUS,
  NO_SHOW_STATUS,
} from "@/lib/no-show";

// -------------------------------------------------------
// Tests
// -------------------------------------------------------

describe("POST /api/appointments/[id]/complete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loyaltyThaw.on = false;
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

  describe("wizyta „Nie przyszedł”", () => {
    function completeRequest() {
      return completeAppointment(
        createMockRequest(
          `http://localhost:3000/api/appointments/${TEST_IDS.APPOINTMENT_UUID}/complete`,
          { method: "POST", body: {} }
        ),
        createRouteParams(TEST_IDS.APPOINTMENT_UUID)
      );
    }

    it("409 APPOINTMENT_NO_SHOW i żadnego zapisu", async () => {
      const appointment = makeAppointment({ status: NO_SHOW_STATUS });
      mockDbSelect.mockReturnValueOnce(chainMock([{ appointment, service: makeService() }]));

      const { status, body } = await parseResponse(await completeRequest());

      expect(status).toBe(409);
      expect(body.success).toBe(false);
      expect((body as any).code).toBe(NO_SHOW_COMPLETE_BLOCKED_CODE);
      expect(body.error).toBe(NO_SHOW_COMPLETE_BLOCKED_MESSAGE);
      // Odmowa przed transakcją zapisów: brak zabiegu, statusu, prowizji, zużycia.
      expect(mockDbSelect).toHaveBeenCalledTimes(1);
      expect(mockDbInsert).not.toHaveBeenCalled();
      expect(mockDbUpdate).not.toHaveBeenCalled();
    });

    it("200 po cofnięciu oznaczenia (status przywrócony przez trasę no-show)", async () => {
      const appointment = makeAppointment({ status: NO_SHOW_RESTORED_STATUS, employeeId: null });
      mockDbSelect.mockReturnValueOnce(chainMock([{ appointment, service: makeService() }]));
      mockDbSelect.mockReturnValueOnce(chainMock([]));
      mockDbInsert.mockReturnValueOnce(chainMock([{ id: "treatment-1" }]));
      mockDbUpdate.mockReturnValueOnce(chainMock([{ ...appointment, status: "completed" }]));
      mockDbSelect.mockReturnValueOnce(chainMock([]));
      mockDbSelect.mockReturnValueOnce(chainMock([{ id: TEST_IDS.SALON_UUID, settingsJson: null }]));

      const { status, body } = await parseResponse(await completeRequest());

      expect(status).toBe(200);
      expect(body.success).toBe(true);
      expect((body as any).data.appointment.status).toBe("completed");
    });

    it("zapis statusu ma warunek wykluczający „Nie przyszedł”, zakończoną i anulowaną", async () => {
      const { notInArray } = await import("drizzle-orm");
      const appointment = makeAppointment({ status: "scheduled", employeeId: null });
      mockDbSelect.mockReturnValueOnce(chainMock([{ appointment, service: makeService() }]));
      mockDbSelect.mockReturnValueOnce(chainMock([]));
      mockDbInsert.mockReturnValueOnce(chainMock([{ id: "treatment-1" }]));
      mockDbUpdate.mockReturnValueOnce(chainMock([{ ...appointment, status: "completed" }]));
      mockDbSelect.mockReturnValueOnce(chainMock([]));
      mockDbSelect.mockReturnValueOnce(chainMock([{ id: TEST_IDS.SALON_UUID, settingsJson: null }]));

      const response = await completeRequest();

      expect(response.status).toBe(200);
      expect(vi.mocked(notInArray)).toHaveBeenCalledWith(
        "appointments.status",
        expect.arrayContaining([NO_SHOW_STATUS, "completed", "cancelled"])
      );
    });

    it("oznaczenie wstawione między odczytem a zapisem: 409, transakcja przerwana", async () => {
      // Odczyt widzi „zaplanowaną”, ale UPDATE z warunkiem statusu nie trafia
      // w wiersz (równoległe „Nie przyszedł” pod blokadą wiersza).
      const appointment = makeAppointment({ status: "scheduled" });
      mockDbSelect.mockReturnValueOnce(chainMock([{ appointment, service: makeService() }]));
      mockDbSelect.mockReturnValueOnce(chainMock([]));
      mockDbInsert.mockReturnValueOnce(chainMock([{ id: "treatment-1" }]));
      mockDbUpdate.mockReturnValueOnce(chainMock([]));
      // Ponowny odczyt statusu w tej samej transakcji.
      mockDbSelect.mockReturnValueOnce(chainMock([{ status: NO_SHOW_STATUS }]));

      const { status, body } = await parseResponse(await completeRequest());

      expect(status).toBe(409);
      expect((body as any).code).toBe(NO_SHOW_COMPLETE_BLOCKED_CODE);
      expect(body.error).toBe(NO_SHOW_COMPLETE_BLOCKED_MESSAGE);
      // Po nieudanym zapisie statusu nic dalej: bez prowizji i zużycia materiałów.
      expect(mockDbInsert).toHaveBeenCalledTimes(1);
      expect(mockDbUpdate).toHaveBeenCalledTimes(1);
      // Odczyt wizyty, odczyt zabiegu, ponowny odczyt statusu.
      expect(mockDbSelect).toHaveBeenCalledTimes(3);
    });
  });

  describe("zapis statusu nie trafił w wiersz — odpowiedź według bieżącego statusu", () => {
    function completeRequest() {
      return completeAppointment(
        createMockRequest(
          `http://localhost:3000/api/appointments/${TEST_IDS.APPOINTMENT_UUID}/complete`,
          { method: "POST", body: {} }
        ),
        createRouteParams(TEST_IDS.APPOINTMENT_UUID)
      );
    }

    /** Odczyt widzi „zaplanowaną”, UPDATE z warunkiem statusu daje 0 wierszy. */
    function givenRaceWithCurrentRows(currentRows: unknown[]) {
      const appointment = makeAppointment({ status: "scheduled" });
      mockDbSelect.mockReturnValueOnce(chainMock([{ appointment, service: makeService() }]));
      mockDbSelect.mockReturnValueOnce(chainMock([]));
      mockDbInsert.mockReturnValueOnce(chainMock([{ id: "treatment-1" }]));
      mockDbUpdate.mockReturnValueOnce(chainMock([]));
      mockDbSelect.mockReturnValueOnce(chainMock(currentRows));
    }

    it.each([
      ["completed", "Wizyta jest juz zakonczona"],
      ["cancelled", "Nie mozna zakonczyc anulowanej wizyty"],
    ])("równolegle %s → 400 z tym samym komunikatem co przy odczycie, bez kodu no-show", async (current, error) => {
      givenRaceWithCurrentRows([{ status: current }]);

      const { status, body } = await parseResponse(await completeRequest());

      expect(status).toBe(400);
      expect(body).toEqual({ success: false, error });
      expect(mockDbInsert).toHaveBeenCalledTimes(1);
      expect(mockDbUpdate).toHaveBeenCalledTimes(1);
    });

    it("ponowny odczyt z jawnym eq(salonId)", async () => {
      const { eq } = await import("drizzle-orm");
      givenRaceWithCurrentRows([{ status: "completed" }]);

      await completeRequest();

      expect(vi.mocked(eq)).toHaveBeenCalledWith("appointments.salonId", TEST_IDS.SALON_UUID);
      const selectCalls = mockDbSelect.mock.calls;
      expect(selectCalls[selectCalls.length - 1]?.[0]).toEqual({ status: "appointments.status" });
    });

    it("wiersz zniknął po odczycie → 404", async () => {
      givenRaceWithCurrentRows([]);

      const { status, body } = await parseResponse(await completeRequest());

      expect(status).toBe(404);
      expect(body.success).toBe(false);
    });
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

  describe("commissionPercentage — liczba skończona 0–100", () => {
    function completeWith(commissionPercentage: unknown) {
      return completeAppointment(
        createMockRequest(
          `http://localhost:3000/api/appointments/${TEST_IDS.APPOINTMENT_UUID}/complete`,
          { method: "POST", body: { commissionPercentage } }
        ),
        createRouteParams(TEST_IDS.APPOINTMENT_UUID)
      );
    }

    it.each([["abc"], ["NaN"], ["Infinity"], [""], [-50], [-1], [100.01], [1000], ["1000"]])(
      "%j → 400 z polskim komunikatem, bez operacji na bazie",
      async (value) => {
        const { status, body } = await parseResponse(await completeWith(value));

        expect(status).toBe(400);
        expect(JSON.stringify(body)).toContain("Prowizja musi byc liczba od 0 do 100");
        expect(mockDbSelect).not.toHaveBeenCalled();
        expect(mockDbInsert).not.toHaveBeenCalled();
        expect(mockDbUpdate).not.toHaveBeenCalled();
      }
    );

    it.each([
      [0, "0.00", "0.00"],
      ["0", "0.00", "0.00"],
      [100, "100.00", "200.00"],
      ["100", "100.00", "200.00"],
    ])("%j → 200, prowizja zapisana jako %s%%", async (value, percentage, amount) => {
      const appointment = makeAppointment({ status: "scheduled" });
      const service = makeService({ basePrice: "200.00" });
      mockDbSelect.mockReturnValueOnce(chainMock([{ appointment, service }]));
      mockDbSelect.mockReturnValueOnce(chainMock([]));
      mockDbInsert.mockReturnValueOnce(chainMock([{ id: "treatment-1" }]));
      mockDbUpdate.mockReturnValueOnce(chainMock([{ ...appointment, status: "completed" }]));
      mockDbSelect.mockReturnValueOnce(chainMock([]));
      mockDbSelect.mockReturnValueOnce(chainMock([]));
      const commissionChain = chainMock([{ id: "comm-1", amount, percentage }]);
      mockDbInsert.mockReturnValueOnce(commissionChain);
      mockDbSelect.mockReturnValueOnce(chainMock([]));
      mockDbSelect.mockReturnValueOnce(chainMock([{ id: TEST_IDS.SALON_UUID, settingsJson: null }]));

      const { status } = await parseResponse(await completeWith(value));

      expect(status).toBe(200);
      expect(commissionChain.values).toHaveBeenCalledWith(
        expect.objectContaining({ percentage, amount })
      );
    });
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
    // treatment insert + commission insert + material usage insert = 3 inserts
    expect(mockDbInsert).toHaveBeenCalledTimes(3);

    // UAT S-2: auto-zuzycie musi trafic do appointmentMaterials (tabela, ktora
    // czytaja raporty materialow), nie do martwej tabeli productUsage
    const insertedTables = mockDbInsert.mock.calls.map(
      (c) => (c[0] as { _table?: string })?._table,
    );
    expect(insertedTables).toContain("appointmentMaterials");
    expect(insertedTables).not.toContain("productUsage");
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
    loyaltyThaw.on = true;
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
    loyaltyThaw.on = true;
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
    loyaltyThaw.on = true;
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

  it("nie nalicza punktów, gdy moduł lojalności jest zamrożony — mimo programu włączonego w ustawieniach salonu", async () => {
    // Prawdziwy rejestr (loyaltyThaw.on = false). Salon ma program włączony
    // w OBU miejscach zapisu sprzed zamrożenia, a klient ma już saldo 50 pkt.
    const appointment = makeAppointment({ status: "scheduled" });
    const service = makeService({ basePrice: "100.00", name: "Koloryzacja" });
    const treatment = { id: "treatment-1", appointmentId: TEST_IDS.APPOINTMENT_UUID };
    const updatedAppointment = { ...appointment, status: "completed" };
    const commission = { id: "comm-1", amount: "50.00", percentage: "50.00" };

    const loyaltySettings = {
      enabled: true,
      pointsPerCurrencyUnit: 1,
      currencyUnit: 1,
      pointsExpiryDays: null,
      rewardTiers: [],
    };
    const existingLoyaltyRecord = {
      id: "loyalty-1",
      clientId: TEST_IDS.CLIENT_UUID,
      salonId: TEST_IDS.SALON_UUID,
      points: 50,
    };
    const loyaltyTransaction = { id: "lt-1", loyaltyId: "loyalty-1", pointsChange: 100 };

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
    // 10. Loyalty: fetch salon settings -> program włączony w obu zapisach
    mockDbSelect.mockReturnValueOnce(chainMock([{
      id: TEST_IDS.SALON_UUID,
      settingsJson: { loyalty: loyaltySettings, modules: { loyalty: true } },
    }]));
    // Odpowiedzi bazy dla ścieżki naliczania — gdyby blokada nie zadziałała,
    // punkty zostałyby naliczone i test by to pokazał (data.loyalty != null).
    mockDbSelect.mockReturnValueOnce(chainMock([]));
    mockDbSelect.mockReturnValueOnce(chainMock([existingLoyaltyRecord]));
    mockDbUpdate.mockReturnValueOnce(chainMock([]));
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

    // Wizyta zamyka się normalnie...
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    // ...ale punktów nie ma: brak wyniku, brak zapisu salda i transakcji.
    expect((body as any).data.loyalty).toBeNull();
    expect(mockDbInsert).toHaveBeenCalledTimes(2); // treatment + commission
    expect(mockDbUpdate).toHaveBeenCalledTimes(1); // tylko status wizyty

    // Nieużyte odpowiedzi z kolejki nie mogą przeciec do następnego testu.
    mockDbSelect.mockReset();
    mockDbInsert.mockReset();
    mockDbUpdate.mockReset();
  });

  it("should reduce price for loyalty points when appointment has discountAmount", async () => {
    loyaltyThaw.on = true;
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

  it("#193: transakcja domykająca biegnie w kontekście salonu z sesji (rola aplikacji + set_config)", async () => {
    const { sql, eq } = await import("drizzle-orm");
    const appointment = makeAppointment({ status: "scheduled", employeeId: null });
    const service = makeService({ basePrice: "200.00" });

    mockDbSelect.mockReturnValueOnce(chainMock([{ appointment, service }]));
    mockDbSelect.mockReturnValueOnce(chainMock([]));
    mockDbInsert.mockReturnValueOnce(chainMock([{ id: "treatment-1" }]));
    mockDbUpdate.mockReturnValueOnce(chainMock([{ ...appointment, status: "completed" }]));
    mockDbSelect.mockReturnValueOnce(chainMock([]));
    mockDbSelect.mockReturnValueOnce(chainMock([{ id: TEST_IDS.SALON_UUID, settingsJson: null }]));

    const request = createMockRequest(
      `http://localhost:3000/api/appointments/${TEST_IDS.APPOINTMENT_UUID}/complete`,
      { method: "POST", body: {} }
    );
    const response = await completeAppointment(request, createRouteParams(TEST_IDS.APPOINTMENT_UUID));
    expect(response.status).toBe(200);

    // Dwie transakcje forSalon: odczyt wizyty i transakcja zapisów.
    const roleSwitches = vi.mocked(sql.raw).mock.calls.filter(([q]) => /^set local role /.test(String(q)));
    expect(roleSwitches).toHaveLength(2);
    // Aktualizacja statusu ma jawny filtr salonu z sesji.
    expect(vi.mocked(eq).mock.calls).toContainEqual(["appointments.salonId", TEST_IDS.SALON_UUID]);
    expect(vi.mocked(eq).mock.calls).toContainEqual(["salons.id", TEST_IDS.SALON_UUID]);
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

  describe("płatność przy zakończeniu (kwota i metoda)", () => {
    function completeWith(body: Record<string, unknown>) {
      return completeAppointment(
        createMockRequest(
          `http://localhost:3000/api/appointments/${TEST_IDS.APPOINTMENT_UUID}/complete`,
          { method: "POST", body }
        ),
        createRouteParams(TEST_IDS.APPOINTMENT_UUID)
      );
    }

    /**
     * Zakończenie bez pracownika (bez prowizji): odczyt wizyty, odczyt zabiegu,
     * insert zabiegu, UPDATE statusu (zwraca `updatedRow`), produkty, salon.
     * Zwraca łańcuch UPDATE wizyty, żeby sprawdzić argument `set`.
     */
    function givenCompletableAppointment(updatedRow: Record<string, unknown>) {
      const appointment = makeAppointment({ status: "scheduled", employeeId: null });
      const updateChain = chainMock([{ ...appointment, status: "completed", ...updatedRow }]);
      mockDbSelect.mockReturnValueOnce(chainMock([{ appointment, service: makeService() }]));
      mockDbSelect.mockReturnValueOnce(chainMock([]));
      mockDbInsert.mockReturnValueOnce(chainMock([{ id: "treatment-1" }]));
      mockDbUpdate.mockReturnValueOnce(updateChain);
      mockDbSelect.mockReturnValueOnce(chainMock([]));
      mockDbSelect.mockReturnValueOnce(chainMock([{ id: TEST_IDS.SALON_UUID, settingsJson: null }]));
      return updateChain;
    }

    it("200: kwota i metoda w tym samym SET co status, odpowiedź z wartościami zapisanymi", async () => {
      const updateChain = givenCompletableAppointment({ paidAmount: "123.45", paymentMethod: "card" });

      const { status, body } = await parseResponse(
        await completeWith({ paidAmount: "123.45", paymentMethod: "card" })
      );

      expect(status).toBe(200);
      // Jedno wywołanie UPDATE wizyty i jedno `set` z trzema polami naraz.
      expect(mockDbUpdate).toHaveBeenCalledTimes(1);
      expect((mockDbUpdate.mock.calls[0]?.[0] as { _table?: string })?._table).toBe("appointments");
      expect(updateChain.set).toHaveBeenCalledTimes(1);
      expect(updateChain.set).toHaveBeenCalledWith({
        status: "completed",
        paidAmount: "123.45",
        paymentMethod: "card",
      });
      expect((body as any).data.payment).toEqual({ paidAmount: "123.45", paymentMethod: "card" });
      expect((body as any).data.appointment.paidAmount).toBe("123.45");
      expect((body as any).data.appointment.paymentMethod).toBe("card");
    });

    it("200: kwota liczbą trafia do bazy jako tekst", async () => {
      const updateChain = givenCompletableAppointment({ paidAmount: "80.50", paymentMethod: "blik" });

      const { status } = await parseResponse(await completeWith({ paidAmount: 80.5, paymentMethod: "blik" }));

      expect(status).toBe(200);
      expect(updateChain.set).toHaveBeenCalledWith({
        status: "completed",
        paidAmount: "80.5",
        paymentMethod: "blik",
      });
    });

    it("200: bez obu pól — SET tylko statusu, płatność w odpowiedzi pusta", async () => {
      const updateChain = givenCompletableAppointment({ paidAmount: null, paymentMethod: null });

      const { status, body } = await parseResponse(await completeWith({ notes: "ok" }));

      expect(status).toBe(200);
      expect(updateChain.set).toHaveBeenCalledWith({ status: "completed" });
      expect((body as any).data.payment).toEqual({ paidAmount: null, paymentMethod: null });
    });

    it("200: oba pola null traktowane jak brak", async () => {
      const updateChain = givenCompletableAppointment({ paidAmount: null, paymentMethod: null });

      const { status } = await parseResponse(await completeWith({ paidAmount: null, paymentMethod: null }));

      expect(status).toBe(200);
      expect(updateChain.set).toHaveBeenCalledWith({ status: "completed" });
    });

    it("200: kwota 0 (wizyta gratis)", async () => {
      const updateChain = givenCompletableAppointment({ paidAmount: "0.00", paymentMethod: "cash" });

      const { status, body } = await parseResponse(await completeWith({ paidAmount: "0", paymentMethod: "cash" }));

      expect(status).toBe(200);
      expect(updateChain.set).toHaveBeenCalledWith({
        status: "completed",
        paidAmount: "0",
        paymentMethod: "cash",
      });
      expect((body as any).data.payment).toEqual({ paidAmount: "0.00", paymentMethod: "cash" });
    });

    it("200: górna granica 99999999.99", async () => {
      const updateChain = givenCompletableAppointment({ paidAmount: "99999999.99", paymentMethod: "cash" });

      const { status } = await parseResponse(
        await completeWith({ paidAmount: "99999999.99", paymentMethod: "cash" })
      );

      expect(status).toBe(200);
      expect(updateChain.set).toHaveBeenCalledWith(
        expect.objectContaining({ paidAmount: "99999999.99" })
      );
    });

    it("kwota i metoda nie trafiają do logów", async () => {
      const { logger } = await import("@/lib/logger");
      const infoSpy = vi.spyOn(logger, "info");
      givenCompletableAppointment({ paidAmount: "4321.09", paymentMethod: "blik" });

      const { status } = await parseResponse(
        await completeWith({ paidAmount: "4321.09", paymentMethod: "blik" })
      );

      expect(status).toBe(200);
      const logged = JSON.stringify(infoSpy.mock.calls);
      expect(logged).not.toContain("4321.09");
      expect(logged).not.toContain("blik");
      expect(logged).not.toContain("paidAmount");
      expect(logged).not.toContain("paymentMethod");
      infoSpy.mockRestore();
    });

    it.each([
      ["metoda spoza listy: transfer", { paidAmount: "50", paymentMethod: "transfer" }, "paymentMethod"],
      ["metoda wielkimi literami: BLIK", { paidAmount: "50", paymentMethod: "BLIK" }, "paymentMethod"],
      ["kwota ujemna (tekst)", { paidAmount: "-1", paymentMethod: "cash" }, "paidAmount"],
      ["kwota ujemna (liczba)", { paidAmount: -0.01, paymentMethod: "cash" }, "paidAmount"],
      ["trzy miejsca po przecinku", { paidAmount: "10.005", paymentMethod: "cash" }, "paidAmount"],
      ["trzy miejsca po przecinku (liczba)", { paidAmount: 10.005, paymentMethod: "cash" }, "paidAmount"],
      ["powyżej zakresu numeric(10,2)", { paidAmount: "100000000", paymentMethod: "cash" }, "paidAmount"],
      ["kwota nie jest liczbą", { paidAmount: "abc", paymentMethod: "cash" }, "paidAmount"],
      ["kwota pusta", { paidAmount: "", paymentMethod: "cash" }, "paidAmount"],
      ["zapis wykładniczy", { paidAmount: 1e21, paymentMethod: "cash" }, "paidAmount"],
      ["tylko kwota", { paidAmount: "50" }, "paymentMethod"],
      ["tylko metoda", { paymentMethod: "card" }, "paidAmount"],
      ["kwota z metodą null", { paidAmount: "50", paymentMethod: null }, "paymentMethod"],
    ])("400: %s — bez żadnego zapytania do bazy", async (_name, body, field) => {
      const { status, body: res } = await parseResponse(await completeWith(body));

      expect(status).toBe(400);
      expect(res.success).toBe(false);
      expect((res as any).details[field]).toEqual(expect.any(String));
      expect(mockDbSelect).not.toHaveBeenCalled();
      expect(mockDbInsert).not.toHaveBeenCalled();
      expect(mockDbUpdate).not.toHaveBeenCalled();
    });

    it("400: komunikaty po polsku", async () => {
      const negative = await parseResponse(await completeWith({ paidAmount: "-5", paymentMethod: "cash" }));
      expect((negative.body as any).details.paidAmount).toBe("Kwota nie moze byc ujemna");

      const decimals = await parseResponse(await completeWith({ paidAmount: "1.234", paymentMethod: "cash" }));
      expect((decimals.body as any).details.paidAmount).toBe("Kwota moze miec najwyzej 2 miejsca po przecinku");

      const pair = await parseResponse(await completeWith({ paidAmount: "5" }));
      expect((pair.body as any).details.paymentMethod).toBe("Podaj metode platnosci razem z kwota");
    });

    it("401: brak sesji — bez zapisu", async () => {
      const { NextResponse } = await import("next/server");
      const { requireAuth, isAuthError } = await import("@/lib/auth-middleware");
      vi.mocked(requireAuth).mockResolvedValueOnce(
        NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 }) as never
      );
      vi.mocked(isAuthError).mockReturnValueOnce(true);

      const { status } = await parseResponse(await completeWith({ paidAmount: "50", paymentMethod: "cash" }));

      expect(status).toBe(401);
      expect(mockDbSelect).not.toHaveBeenCalled();
      expect(mockDbUpdate).not.toHaveBeenCalled();
    });

    it("404: pracownik kończy cudzą wizytę — płatność niezapisana", async () => {
      const { getSalonContext } = await import("@/lib/salon-context");
      vi.mocked(getSalonContext).mockResolvedValueOnce({
        salonId: TEST_IDS.SALON_UUID,
        role: "employee",
        employeeId: "other-employee-id",
        userId: "user-2",
      } as never);
      const appointment = makeAppointment({ status: "scheduled" });
      mockDbSelect.mockReturnValueOnce(chainMock([{ appointment, service: makeService() }]));

      const { status, body } = await parseResponse(
        await completeWith({ paidAmount: "50", paymentMethod: "cash" })
      );

      expect(status).toBe(404);
      expect(body.success).toBe(false);
      expect(mockDbUpdate).not.toHaveBeenCalled();
      expect(mockDbInsert).not.toHaveBeenCalled();
    });

    it("409: wizyta „Nie przyszedł” — płatność niezapisana", async () => {
      const appointment = makeAppointment({ status: NO_SHOW_STATUS });
      mockDbSelect.mockReturnValueOnce(chainMock([{ appointment, service: makeService() }]));

      const { status, body } = await parseResponse(
        await completeWith({ paidAmount: "50", paymentMethod: "cash" })
      );

      expect(status).toBe(409);
      expect((body as any).code).toBe(NO_SHOW_COMPLETE_BLOCKED_CODE);
      expect(mockDbUpdate).not.toHaveBeenCalled();
    });

    it("500: błąd bazy przy UPDATE — odpowiedź bez kwoty, metody i szczegółów błędu", async () => {
      const appointment = makeAppointment({ status: "scheduled", employeeId: null });
      mockDbSelect.mockReturnValueOnce(chainMock([{ appointment, service: makeService() }]));
      mockDbSelect.mockReturnValueOnce(chainMock([]));
      mockDbInsert.mockReturnValueOnce(chainMock([{ id: "treatment-1" }]));
      const failingUpdate: Record<string, unknown> = {};
      for (const m of ["set", "where", "returning"]) {
        failingUpdate[m] = vi.fn().mockReturnValue(failingUpdate);
      }
      failingUpdate.then = (_: unknown, reject: (err: Error) => void) =>
        reject(Object.assign(new Error("new row violates check constraint"), { code: "23514" }));
      mockDbUpdate.mockReturnValueOnce(failingUpdate);

      const { status, body } = await parseResponse(
        await completeWith({ paidAmount: "77.70", paymentMethod: "card" })
      );

      expect(status).toBe(500);
      expect(body).toEqual({ success: false, error: "Failed to complete appointment" });
    });

    it("500: błąd UPDATE z parametrami w treści — log błędu bez kwoty i metody, z kodem i ograniczeniem", async () => {
      const { logger } = await import("@/lib/logger");
      const errorSpy = vi.spyOn(logger, "error");
      const appointment = makeAppointment({ status: "scheduled", employeeId: null });
      mockDbSelect.mockReturnValueOnce(chainMock([{ appointment, service: makeService() }]));
      mockDbSelect.mockReturnValueOnce(chainMock([]));
      mockDbInsert.mockReturnValueOnce(chainMock([{ id: "treatment-1" }]));
      // Kształt jak DrizzleQueryError: SQL i parametry w `message`, błąd
      // sterownika w `cause` (postgres.js: `code`, `constraint_name`).
      const driverError = Object.assign(new Error("new row violates check constraint"), {
        code: "23514",
        constraint_name: "appointments_paid_amount_nonneg",
      });
      const queryError = new Error(
        'Failed query: update "appointments" set "status" = $1, "paid_amount" = $2, "payment_method" = $3 where ...' +
          "\nparams: completed,4321.09,blik," +
          TEST_IDS.APPOINTMENT_UUID,
        { cause: driverError }
      );
      const failingUpdate: Record<string, unknown> = {};
      for (const m of ["set", "where", "returning"]) {
        failingUpdate[m] = vi.fn().mockReturnValue(failingUpdate);
      }
      failingUpdate.then = (_: unknown, reject: (err: Error) => void) => reject(queryError);
      mockDbUpdate.mockReturnValueOnce(failingUpdate);

      const { status } = await parseResponse(
        await completeWith({ paidAmount: "4321.09", paymentMethod: "blik" })
      );

      expect(status).toBe(500);
      expect(errorSpy).toHaveBeenCalledWith("Failed to complete appointment", {
        errorName: "Error",
        errorCode: "23514",
        constraint: "appointments_paid_amount_nonneg",
      });
      const logged = JSON.stringify(errorSpy.mock.calls);
      expect(logged).not.toContain("4321.09");
      expect(logged).not.toContain("blik");
      expect(logged).not.toContain("params");
      expect(logged).not.toContain("Failed query");
      errorSpy.mockRestore();
    });
  });

  describe("niski stan i punkty — najlepszy wysiłek w zagnieżdżonej transakcji", () => {
    /** Łańcuch zapytania, które kończy się błędem bazy (SQL i parametry w treści). */
    function failingChain() {
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "from", "where", "limit", "values", "returning", "set", "leftJoin"]) {
        chain[m] = vi.fn().mockReturnValue(chain);
      }
      chain.then = (_: unknown, reject: (err: Error) => void) =>
        reject(
          new Error("Failed query: insert into loyalty_points ... params: 4321.09", {
            cause: Object.assign(new Error("boom"), { code: "XT101" }),
          })
        );
      return chain;
    }

    function post(body: Record<string, unknown> = {}) {
      return completeAppointment(
        createMockRequest(`http://localhost:3000/api/appointments/${TEST_IDS.APPOINTMENT_UUID}/complete`, {
          method: "POST",
          body,
        }),
        createRouteParams(TEST_IDS.APPOINTMENT_UUID)
      );
    }

    beforeEach(() => {
      savepoints.count = 0;
    });

    it("błąd bazy w punktach → 200 z zakończeniem i płatnością; błąd w savepoincie, log bez treści zapytania", async () => {
      loyaltyThaw.on = true;
      const { logger } = await import("@/lib/logger");
      const errorSpy = vi.spyOn(logger, "error");
      const infoSpy = vi.spyOn(logger, "info");
      const appointment = makeAppointment({ status: "scheduled", employeeId: null });
      const updated = { ...appointment, status: "completed", paidAmount: "150.00", paymentMethod: "cash" };
      mockDbSelect.mockReturnValueOnce(chainMock([{ appointment, service: makeService({ basePrice: "150.00" }) }]));
      mockDbSelect.mockReturnValueOnce(chainMock([]));
      mockDbInsert.mockReturnValueOnce(chainMock([{ id: "treatment-1" }]));
      mockDbUpdate.mockReturnValueOnce(chainMock([updated]));
      // Produkty usługi (brak), ustawienia salonu z programem, odczyt karty punktów (brak).
      mockDbSelect.mockReturnValueOnce(chainMock([]));
      mockDbSelect.mockReturnValueOnce(
        chainMock([{ id: TEST_IDS.SALON_UUID, settingsJson: { loyalty: { enabled: true } } }])
      );
      mockDbSelect.mockReturnValueOnce(chainMock([]));
      // INSERT karty punktów kończy się błędem bazy.
      mockDbInsert.mockReturnValueOnce(failingChain());

      const { status, body } = await parseResponse(await post({ paidAmount: "150", paymentMethod: "cash" }));

      expect(status).toBe(200);
      expect((body as any).data.payment).toEqual({ paidAmount: "150.00", paymentMethod: "cash" });
      expect((body as any).data.loyalty).toBeNull();
      expect(savepoints.count).toBe(1);
      expect(errorSpy).toHaveBeenCalledWith("Loyalty points error (non-blocking)", {
        errorName: "Error",
        errorCode: "XT101",
      });
      expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("Failed query");
      expect(infoSpy).toHaveBeenCalledWith("Appointment marked as completed", {
        appointmentId: TEST_IDS.APPOINTMENT_UUID,
      });
      errorSpy.mockRestore();
      infoSpy.mockRestore();
    });

    it("błąd bazy w alercie niskiego stanu → 200, alert pusty, zużycie zapisane; każdy blok we własnym savepoincie", async () => {
      const { logger } = await import("@/lib/logger");
      const errorSpy = vi.spyOn(logger, "error");
      const appointment = makeAppointment({ status: "scheduled", employeeId: null });
      mockDbSelect.mockReturnValueOnce(chainMock([{ appointment, service: makeService() }]));
      mockDbSelect.mockReturnValueOnce(chainMock([]));
      mockDbInsert.mockReturnValueOnce(chainMock([{ id: "treatment-1" }]));
      mockDbUpdate.mockReturnValueOnce(chainMock([{ ...appointment, status: "completed" }]));
      mockDbSelect.mockReturnValueOnce(
        chainMock([
          {
            linkId: "sp-1",
            productId: TEST_IDS.PRODUCT_UUID,
            defaultQuantity: "2",
            productName: "Farba",
            productQuantity: "3",
            productUnit: "szt.",
            productMinQuantity: "5",
            productSalonId: TEST_IDS.SALON_UUID,
          },
        ])
      );
      mockDbUpdate.mockReturnValueOnce(chainMock([]));
      mockDbInsert.mockReturnValueOnce(chainMock([]));
      // Odczyt powiadomień w alercie kończy się błędem bazy.
      mockDbSelect.mockReturnValueOnce(failingChain());
      mockDbSelect.mockReturnValueOnce(chainMock([{ id: TEST_IDS.SALON_UUID, settingsJson: null }]));

      const { status, body } = await parseResponse(await post());

      expect(status).toBe(200);
      expect((body as any).data.stockDeductions).toHaveLength(1);
      expect((body as any).data.stockDeductions[0].lowStockAlert).toBeNull();
      // Alert niskiego stanu i punkty — dwa savepointy.
      expect(savepoints.count).toBe(2);
      expect(errorSpy).toHaveBeenCalledWith("Low stock check failed (non-blocking)", {
        errorName: "Error",
        errorCode: "XT101",
      });
      errorSpy.mockRestore();
    });

    it("błąd w głównej transakcji → 500 i bez logu „Appointment marked as completed”", async () => {
      const { logger } = await import("@/lib/logger");
      const infoSpy = vi.spyOn(logger, "info");
      const appointment = makeAppointment({ status: "scheduled" });
      mockDbSelect.mockReturnValueOnce(chainMock([{ appointment, service: makeService() }]));
      mockDbSelect.mockReturnValueOnce(chainMock([]));
      mockDbInsert.mockReturnValueOnce(chainMock([{ id: "treatment-1" }]));
      mockDbUpdate.mockReturnValueOnce(chainMock([{ ...appointment, status: "completed" }]));
      mockDbSelect.mockReturnValueOnce(chainMock([{ commissionRate: "50.00" }]));
      mockDbSelect.mockReturnValueOnce(chainMock([]));
      mockDbSelect.mockReturnValueOnce(chainMock([]));
      // INSERT prowizji (poza savepointem) kończy się błędem.
      mockDbInsert.mockReturnValueOnce(failingChain());

      const { status } = await parseResponse(await post());

      expect(status).toBe(500);
      expect(infoSpy).not.toHaveBeenCalledWith("Appointment marked as completed", expect.anything());
      infoSpy.mockRestore();
    });
  });
});
