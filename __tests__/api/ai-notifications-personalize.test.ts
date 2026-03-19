/**
 * Integration tests for POST /api/ai/notifications/personalize endpoint.
 *
 * Tests cover:
 * - Auth gating (401 when not authenticated)
 * - Pro plan gating (403 when not on Pro plan)
 * - Input validation (400 for invalid JSON, missing fields)
 * - Not found (404 for non-existent client)
 * - Happy path (successful personalized message)
 * - SMS message truncation to 160 characters
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
const VALID_CLIENT_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

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
  trackAIUsage: vi.fn().mockResolvedValue(undefined),
}));

const mockGenerateText = vi.fn();
vi.mock("ai", () => ({
  generateText: (...args: unknown[]) => mockGenerateText(...args),
}));

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
    clients: createTable("clients"),
    appointments: createTable("appointments"),
    services: createTable("services"),
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

import { POST } from "@/app/api/ai/notifications/personalize/route";

// -------------------------------------------------------
// Chain builder
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

function makeClientData(overrides: Record<string, unknown> = {}) {
  return {
    id: TEST_IDS.CLIENT_UUID,
    salonId: TEST_IDS.SALON_UUID,
    firstName: "Anna",
    lastName: "Kowalska",
    phone: "+48123456789",
    email: "anna@example.com",
    preferences: "Preferuje poranne wizyty",
    allergies: null,
    birthday: "1990-06-15",
    ...overrides,
  };
}

// -------------------------------------------------------
// Tests
// -------------------------------------------------------

describe("POST /api/ai/notifications/personalize", () => {
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
      "http://localhost:3000/api/ai/notifications/personalize",
      {
        method: "POST",
        body: {
          clientId: VALID_CLIENT_ID,
          notificationType: "birthday",
        },
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
      "http://localhost:3000/api/ai/notifications/personalize",
      {
        method: "POST",
        body: {
          clientId: VALID_CLIENT_ID,
          notificationType: "birthday",
        },
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
      "http://localhost:3000/api/ai/notifications/personalize",
      {
        method: "POST",
        body: "not json",
        headers: { "Content-Type": "application/json" },
      },
    );

    const response = await POST(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(400);
    expect(body.error).toBe("Invalid JSON");
  });

  it("should return 400 for missing clientId", async () => {
    setupAuthenticatedPro();

    const request = createMockRequest(
      "http://localhost:3000/api/ai/notifications/personalize",
      {
        method: "POST",
        body: { notificationType: "birthday" },
      },
    );

    const response = await POST(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(400);
    expect(body.error).toBe("Invalid request");
    expect(body.details).toBeDefined();
  });

  it("should return 400 for invalid clientId format", async () => {
    setupAuthenticatedPro();

    const request = createMockRequest(
      "http://localhost:3000/api/ai/notifications/personalize",
      {
        method: "POST",
        body: { clientId: "not-a-uuid", notificationType: "birthday" },
      },
    );

    const response = await POST(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(400);
    expect(body.error).toBe("Invalid request");
  });

  it("should return 400 for invalid notificationType", async () => {
    setupAuthenticatedPro();

    const request = createMockRequest(
      "http://localhost:3000/api/ai/notifications/personalize",
      {
        method: "POST",
        body: {
          clientId: VALID_CLIENT_ID,
          notificationType: "invalid_type",
        },
      },
    );

    const response = await POST(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(400);
    expect(body.error).toBe("Invalid request");
  });

  it("should return 404 for non-existent client", async () => {
    setupAuthenticatedPro();

    // Client lookup returns empty
    mockDbSelect.mockReturnValueOnce(chainMock([]));

    const request = createMockRequest(
      "http://localhost:3000/api/ai/notifications/personalize",
      {
        method: "POST",
        body: {
          clientId: VALID_CLIENT_ID,
          notificationType: "birthday",
        },
      },
    );

    const response = await POST(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(404);
    expect(body.error).toContain("Klient nie znaleziony");
  });

  it("should return personalized message for valid birthday request", async () => {
    setupAuthenticatedPro();

    const clientData = makeClientData();

    // 1st select: client lookup
    mockDbSelect.mockReturnValueOnce(chainMock([clientData]));
    // 2nd select: recent appointments
    mockDbSelect.mockReturnValueOnce(
      chainMock([
        {
          serviceName: "Manicure hybrydowy",
          startTime: new Date("2026-03-01T10:00:00Z"),
          status: "completed",
        },
      ]),
    );

    const aiResponse = {
      message:
        "Droga Anno, z okazji Twoich urodzin zyczymy Ci wszystkiego najlepszego! Zapraszamy na specjalny zabieg w naszym salonie ze znizka 20%.",
      smsMessage: "Anno, wszystkiego najlepszego! Zapraszamy na zabieg ze znizka 20%. Test Salon",
    };

    mockGenerateText.mockResolvedValue({
      text: JSON.stringify(aiResponse),
    });

    const request = createMockRequest(
      "http://localhost:3000/api/ai/notifications/personalize",
      {
        method: "POST",
        body: {
          clientId: VALID_CLIENT_ID,
          notificationType: "birthday",
        },
      },
    );

    const response = await POST(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.message).toBeDefined();
    expect(body.smsMessage).toBeDefined();
    expect(typeof body.message).toBe("string");
    expect(typeof body.smsMessage).toBe("string");
  });

  it("should ensure SMS message is max 160 chars", async () => {
    setupAuthenticatedPro();

    const clientData = makeClientData();

    mockDbSelect.mockReturnValueOnce(chainMock([clientData]));
    mockDbSelect.mockReturnValueOnce(chainMock([]));

    // AI returns an smsMessage that exceeds 160 characters
    const longSms = "A".repeat(200);
    const aiResponse = {
      message: "Full message content",
      smsMessage: longSms,
    };

    mockGenerateText.mockResolvedValue({
      text: JSON.stringify(aiResponse),
    });

    const request = createMockRequest(
      "http://localhost:3000/api/ai/notifications/personalize",
      {
        method: "POST",
        body: {
          clientId: VALID_CLIENT_ID,
          notificationType: "we_miss_you",
        },
      },
    );

    const response = await POST(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    // SMS should be truncated to 160 characters (157 chars + "...")
    expect((body.smsMessage as string).length).toBeLessThanOrEqual(160);
    expect((body.smsMessage as string).endsWith("...")).toBe(true);
  });

  it("should handle AI JSON parse failure gracefully", async () => {
    setupAuthenticatedPro();

    const clientData = makeClientData();

    mockDbSelect.mockReturnValueOnce(chainMock([clientData]));
    mockDbSelect.mockReturnValueOnce(chainMock([]));

    // AI returns non-JSON text
    mockGenerateText.mockResolvedValue({
      text: "Droga Anno, tesknimy za Toba! Zapraszamy ponownie.",
    });

    const request = createMockRequest(
      "http://localhost:3000/api/ai/notifications/personalize",
      {
        method: "POST",
        body: {
          clientId: VALID_CLIENT_ID,
          notificationType: "we_miss_you",
        },
      },
    );

    const response = await POST(request);
    const { status, body } = await parseResponse(response);

    // The endpoint falls back to using the raw text for both message and sms
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.message).toBeDefined();
    expect(body.smsMessage).toBeDefined();
  });

  it("should return 500 when AI call throws an error", async () => {
    setupAuthenticatedPro();

    const clientData = makeClientData();

    mockDbSelect.mockReturnValueOnce(chainMock([clientData]));
    mockDbSelect.mockReturnValueOnce(chainMock([]));

    mockGenerateText.mockRejectedValue(new Error("AI service unavailable"));

    const request = createMockRequest(
      "http://localhost:3000/api/ai/notifications/personalize",
      {
        method: "POST",
        body: {
          clientId: VALID_CLIENT_ID,
          notificationType: "reminder",
        },
      },
    );

    const response = await POST(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(500);
    expect(body.error).toContain("Blad podczas generowania wiadomosci");
  });

  it("should accept optional context field", async () => {
    setupAuthenticatedPro();

    const clientData = makeClientData();

    mockDbSelect.mockReturnValueOnce(chainMock([clientData]));
    mockDbSelect.mockReturnValueOnce(chainMock([]));

    const aiResponse = {
      message: "Follow-up po zabiegu koloryzacji.",
      smsMessage: "Anno, jak samopoczucie po koloryzacji? Zapraszamy!",
    };

    mockGenerateText.mockResolvedValue({
      text: JSON.stringify(aiResponse),
    });

    const request = createMockRequest(
      "http://localhost:3000/api/ai/notifications/personalize",
      {
        method: "POST",
        body: {
          clientId: VALID_CLIENT_ID,
          notificationType: "follow_up",
          context: "Klientka miala koloryzacje wczoraj",
        },
      },
    );

    const response = await POST(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.message).toBeDefined();
    // Verify generateText was called (context was built and passed)
    expect(mockGenerateText).toHaveBeenCalledTimes(1);
  });

  it("should return 500 when AI returns empty response", async () => {
    setupAuthenticatedPro();

    const clientData = makeClientData();

    mockDbSelect.mockReturnValueOnce(chainMock([clientData]));
    mockDbSelect.mockReturnValueOnce(chainMock([]));

    mockGenerateText.mockResolvedValue({ text: "" });

    const request = createMockRequest(
      "http://localhost:3000/api/ai/notifications/personalize",
      {
        method: "POST",
        body: {
          clientId: VALID_CLIENT_ID,
          notificationType: "birthday",
        },
      },
    );

    const response = await POST(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(500);
    expect(body.error).toContain("AI nie wygenerowalo wiadomosci");
  });
});
