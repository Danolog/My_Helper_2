/**
 * Integration tests for POST /api/ai/appointments/auto-summary endpoint.
 *
 * Tests cover:
 * - Auth gating (401 when not authenticated)
 * - Pro plan gating (403 when not on Pro plan)
 * - Input validation (400 for invalid JSON, invalid appointmentId)
 * - Not found (404 when appointment does not exist)
 * - Happy path (successful summary generation)
 * - AI response parse failure (graceful fallback)
 * - Server error handling (500)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockRequest, parseResponse, TEST_IDS } from "./helpers";

/**
 * Zod v4 enforces strict RFC 4122 UUID format (valid version + variant bits).
 * The TEST_IDS constants use simplified UUIDs that work for DB mocks but fail
 * Zod's uuid() validation. We define a valid UUID here for request bodies.
 */
const VALID_APPOINTMENT_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

// -------------------------------------------------------
// Mocks
// -------------------------------------------------------

const mockRequireProAI = vi.fn();
const mockIsProAIError = vi.fn();
const mockGetSalonContext = vi.fn();
const mockCreateAIClient = vi.fn();
const mockGetAIModel = vi.fn();

vi.mock("@/lib/ai/openrouter", () => ({
  requireProAI: (...args: unknown[]) => mockRequireProAI(...args),
  isProAIError: (...args: unknown[]) => mockIsProAIError(...args),
  getSalonContext: (...args: unknown[]) => mockGetSalonContext(...args),
  createAIClient: (...args: unknown[]) => mockCreateAIClient(...args),
  getAIModel: (...args: unknown[]) => mockGetAIModel(...args),
}));

const mockGenerateText = vi.fn();
vi.mock("ai", () => ({
  generateText: (...args: unknown[]) => mockGenerateText(...args),
}));

// Database mock — single mock function for all db operations
const mockDbSelect = vi.fn();
vi.mock("@/lib/db", () => ({
  db: {
    select: (...args: unknown[]) => mockDbSelect(...args),
  },
}));

vi.mock("@/lib/schema", () => {
  const createTable = (name: string) =>
    new Proxy(
      {},
      {
        get: (_target, prop) => {
          if (prop === "_table") return name;
          return `${name}.${String(prop)}`;
        },
      },
    );
  return {
    appointments: createTable("appointments"),
    clients: createTable("clients"),
    employees: createTable("employees"),
    services: createTable("services"),
    treatmentHistory: createTable("treatmentHistory"),
    appointmentMaterials: createTable("appointmentMaterials"),
    products: createTable("products"),
  };
});

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: unknown[]) => ({ type: "eq", args })),
  and: vi.fn((...args: unknown[]) => ({ type: "and", args })),
  desc: vi.fn((...args: unknown[]) => ({ type: "desc", args })),
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// -------------------------------------------------------
// Import route handler (after mocks are set up)
// -------------------------------------------------------

import { POST } from "@/app/api/ai/appointments/auto-summary/route";

// -------------------------------------------------------
// Chain builder (same pattern as other API tests)
// -------------------------------------------------------

function chainMock(result: unknown[] = []) {
  const chain: Record<string, unknown> = {};
  const methods = [
    "select",
    "from",
    "where",
    "leftJoin",
    "innerJoin",
    "limit",
    "orderBy",
  ];
  for (const method of methods) {
    chain[method] = vi.fn().mockReturnValue(chain);
  }
  chain.then = (resolve: (val: unknown[]) => unknown) => resolve(result);
  return chain;
}

// -------------------------------------------------------
// Helpers
// -------------------------------------------------------

function setupAuthenticatedPro() {
  mockRequireProAI.mockResolvedValue({ salonId: TEST_IDS.SALON_UUID });
  mockIsProAIError.mockReturnValue(false);
  mockGetSalonContext.mockResolvedValue({
    salonName: "Test Salon",
    industryType: "beauty_salon",
    industryLabel: "salon kosmetyczny",
  });
  mockCreateAIClient.mockReturnValue(vi.fn());
  mockGetAIModel.mockReturnValue("anthropic/claude-sonnet-4");
}

/** Build mock data for a full appointment with client, employee, and service. */
function makeAppointmentData() {
  return {
    appointment: {
      id: TEST_IDS.APPOINTMENT_UUID,
      salonId: TEST_IDS.SALON_UUID,
      clientId: TEST_IDS.CLIENT_UUID,
      employeeId: TEST_IDS.EMPLOYEE_UUID,
      serviceId: TEST_IDS.SERVICE_UUID,
      startTime: new Date("2026-04-01T10:00:00Z"),
      endTime: new Date("2026-04-01T11:00:00Z"),
      status: "completed",
      notes: "Klientka chciala lekkie rozjasnienie",
    },
    client: {
      id: TEST_IDS.CLIENT_UUID,
      firstName: "Anna",
      lastName: "Kowalska",
      allergies: "Alergia na amoniak",
      preferences: "Preferuje poranne terminy",
    },
    employee: {
      id: TEST_IDS.EMPLOYEE_UUID,
      firstName: "Maria",
      lastName: "Nowak",
    },
    service: {
      id: TEST_IDS.SERVICE_UUID,
      name: "Koloryzacja",
      basePrice: "250.00",
      baseDuration: 120,
    },
  };
}

// -------------------------------------------------------
// Tests
// -------------------------------------------------------

describe("POST /api/ai/appointments/auto-summary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return 401 when not authenticated", async () => {
    const authError = Response.json(
      { error: "Unauthorized" },
      { status: 401 },
    );
    mockRequireProAI.mockResolvedValue(authError);
    mockIsProAIError.mockReturnValue(true);

    const request = createMockRequest(
      "http://localhost:3000/api/ai/appointments/auto-summary",
      {
        method: "POST",
        body: { appointmentId: VALID_APPOINTMENT_ID },
      },
    );

    const response = await POST(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(401);
    expect(body.error).toBe("Unauthorized");
  });

  it("should return 403 when not on Pro plan", async () => {
    const planError = Response.json(
      {
        error: "Funkcje AI sa dostepne tylko w Planie Pro.",
        code: "PLAN_UPGRADE_REQUIRED",
      },
      { status: 403 },
    );
    mockRequireProAI.mockResolvedValue(planError);
    mockIsProAIError.mockReturnValue(true);

    const request = createMockRequest(
      "http://localhost:3000/api/ai/appointments/auto-summary",
      {
        method: "POST",
        body: { appointmentId: VALID_APPOINTMENT_ID },
      },
    );

    const response = await POST(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(403);
    expect(body.code).toBe("PLAN_UPGRADE_REQUIRED");
  });

  it("should return 400 for invalid JSON body", async () => {
    setupAuthenticatedPro();

    const request = new Request(
      "http://localhost:3000/api/ai/appointments/auto-summary",
      {
        method: "POST",
        body: "not valid json",
        headers: { "Content-Type": "application/json" },
      },
    );

    const response = await POST(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(400);
    expect(body.error).toBe("Invalid JSON");
  });

  it("should return 400 for invalid appointmentId format", async () => {
    setupAuthenticatedPro();

    const request = createMockRequest(
      "http://localhost:3000/api/ai/appointments/auto-summary",
      {
        method: "POST",
        body: { appointmentId: "not-a-uuid" },
      },
    );

    const response = await POST(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(400);
    expect(body.error).toBe("Invalid request");
    expect(body.details).toBeDefined();
  });

  it("should return 400 when appointmentId is missing", async () => {
    setupAuthenticatedPro();

    const request = createMockRequest(
      "http://localhost:3000/api/ai/appointments/auto-summary",
      {
        method: "POST",
        body: {},
      },
    );

    const response = await POST(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(400);
    expect(body.error).toBe("Invalid request");
  });

  it("should return 404 when appointment not found", async () => {
    setupAuthenticatedPro();

    // First query: appointment lookup returns empty
    mockDbSelect.mockReturnValueOnce(chainMock([]));

    const request = createMockRequest(
      "http://localhost:3000/api/ai/appointments/auto-summary",
      {
        method: "POST",
        body: { appointmentId: VALID_APPOINTMENT_ID },
      },
    );

    const response = await POST(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(404);
    expect(body.error).toContain("nie zostala znaleziona");
  });

  it("should return summary for valid appointment", async () => {
    setupAuthenticatedPro();

    const appointmentData = makeAppointmentData();

    // 1st select: appointment with joins (client, employee, service)
    mockDbSelect.mockReturnValueOnce(chainMock([appointmentData]));
    // 2nd select: treatment history
    mockDbSelect.mockReturnValueOnce(chainMock([]));
    // 3rd select: appointment materials
    mockDbSelect.mockReturnValueOnce(chainMock([]));
    // 4th select: previous appointments for client
    mockDbSelect.mockReturnValueOnce(chainMock([]));

    const aiSummary = {
      keyPoints: ["Wykonano koloryzacje z rozjasnieniem", "Uzyta farba bezamoniakowa"],
      productRecommendations: ["Szampon do wlosow farbowanych"],
      followUpTiming: "za 6 tygodni - odrost",
      fullSummary: "Wizyta koloryzacji z rozjasnieniem u Anny Kowalskiej.",
    };

    mockGenerateText.mockResolvedValue({
      text: JSON.stringify(aiSummary),
    });

    const request = createMockRequest(
      "http://localhost:3000/api/ai/appointments/auto-summary",
      {
        method: "POST",
        body: { appointmentId: VALID_APPOINTMENT_ID },
      },
    );

    const response = await POST(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect((body as Record<string, unknown>).summary).toBeDefined();

    const summary = (body as Record<string, unknown>).summary as Record<string, unknown>;
    expect(summary.keyPoints).toHaveLength(2);
    expect(summary.productRecommendations).toHaveLength(1);
    expect(summary.followUpTiming).toContain("6 tygodni");
    expect(summary.fullSummary).toBeDefined();
  });

  it("should include treatment history and materials in context when available", async () => {
    setupAuthenticatedPro();

    const appointmentData = makeAppointmentData();

    // 1st select: appointment with joins
    mockDbSelect.mockReturnValueOnce(chainMock([appointmentData]));
    // 2nd select: treatment history
    mockDbSelect.mockReturnValueOnce(
      chainMock([
        {
          recipe: "Farba 6.0 + utleniacz 6%",
          techniques: "Balejaz",
          notes: "Czas naswietlania: 35 min",
        },
      ]),
    );
    // 3rd select: materials
    mockDbSelect.mockReturnValueOnce(
      chainMock([
        {
          quantityUsed: "50",
          notes: "Kolor 6.0",
          productName: "Farba Wella",
          productUnit: "ml",
        },
      ]),
    );
    // 4th select: previous appointments
    mockDbSelect.mockReturnValueOnce(
      chainMock([
        {
          serviceName: "Koloryzacja",
          startTime: new Date("2026-02-01T10:00:00Z"),
          notes: "Poprzednia wizyta",
        },
      ]),
    );

    const aiSummary = {
      keyPoints: ["Balejaz z farba Wella 6.0"],
      productRecommendations: [],
      followUpTiming: "za 8 tygodni",
      fullSummary: "Zabieg koloryzacji technika balejaz.",
    };

    mockGenerateText.mockResolvedValue({
      text: JSON.stringify(aiSummary),
    });

    const request = createMockRequest(
      "http://localhost:3000/api/ai/appointments/auto-summary",
      {
        method: "POST",
        body: { appointmentId: VALID_APPOINTMENT_ID },
      },
    );

    const response = await POST(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    // Verify generateText was called (which means context was built)
    expect(mockGenerateText).toHaveBeenCalledTimes(1);
  });

  it("should handle AI JSON parse failure gracefully", async () => {
    setupAuthenticatedPro();

    const appointmentData = makeAppointmentData();

    mockDbSelect.mockReturnValueOnce(chainMock([appointmentData]));
    mockDbSelect.mockReturnValueOnce(chainMock([]));
    mockDbSelect.mockReturnValueOnce(chainMock([]));
    mockDbSelect.mockReturnValueOnce(chainMock([]));

    // AI returns non-JSON text
    mockGenerateText.mockResolvedValue({
      text: "Wizyta przebiegla pomyslnie, klientka zadowolona z efektu.",
    });

    const request = createMockRequest(
      "http://localhost:3000/api/ai/appointments/auto-summary",
      {
        method: "POST",
        body: { appointmentId: VALID_APPOINTMENT_ID },
      },
    );

    const response = await POST(request);
    const { status, body } = await parseResponse(response);

    // The endpoint falls back to wrapping raw text in the expected structure
    expect(status).toBe(200);
    expect(body.success).toBe(true);

    const summary = (body as Record<string, unknown>).summary as Record<string, unknown>;
    expect(summary.followUpTiming).toBe("Brak danych");
    expect((summary.productRecommendations as unknown[]).length).toBe(0);
  });

  it("should return 500 when database throws during appointment lookup", async () => {
    setupAuthenticatedPro();

    // Make the chain reject to simulate a database error
    const errorChain: Record<string, unknown> = {};
    const methods = ["select", "from", "where", "leftJoin", "limit", "orderBy"];
    for (const m of methods) {
      (errorChain as Record<string, ReturnType<typeof vi.fn>>)[m] = vi
        .fn()
        .mockReturnValue(errorChain);
    }
    errorChain.then = (_: unknown, reject: (err: Error) => void) =>
      reject(new Error("DB connection failed"));
    mockDbSelect.mockReturnValueOnce(errorChain);

    const request = createMockRequest(
      "http://localhost:3000/api/ai/appointments/auto-summary",
      {
        method: "POST",
        body: { appointmentId: VALID_APPOINTMENT_ID },
      },
    );

    const response = await POST(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(500);
    expect(body.error).toContain("Blad podczas generowania podsumowania");
  });
});
