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
 * - Frozen module (404 MODULE_DISABLED before session, database and model)
 * - Request sent to the model: no name, contact data, allergies, notes or
 *   birth date from the client record; the first name is inserted by the
 *   server in place of the {imie} token
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockRequest, parseResponse, TEST_IDS } from "./helpers";

// -------------------------------------------------------
// Module registry: the real state of the registry is used by the frozen-module
// test; every other test unfreezes this module so it checks the route itself.
// -------------------------------------------------------

const frozenState = vi.hoisted(() => ({ unfreezeAiNotifications: true }));

vi.mock("@/lib/features", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/features")>();
  return {
    ...actual,
    isModuleFrozen: (key: Parameters<typeof actual.isModuleFrozen>[0]) =>
      frozenState.unfreezeAiNotifications && key === "aiNotifications"
        ? false
        : actual.isModuleFrozen(key),
  };
});

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
// `tx` w transakcji deleguje do tych samych mocków co `db` — warstwa repo
// (forSalon) otwiera db.transaction() i woła tx.select(...). Po migracji tras
// na forSalon(salonId).raw(tx => ...) istniejące asercje na mockDbSelect dalej
// działają (ADR-001 R2).
const mockTx = {
  select: (...args: unknown[]) => mockDbSelect(...args),
  execute: vi.fn().mockResolvedValue(undefined),
};
vi.mock("@/lib/db", () => ({
  db: {
    select: (...args: unknown[]) => mockDbSelect(...args),
    transaction: (fn: (tx: typeof mockTx) => unknown) => fn(mockTx),
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
  // sql + sql.raw — używane przez warstwę repo (withSalonContext: SET LOCAL ROLE
  // + set_config). Bez tego forSalon().raw() rzuca i trasa zwraca 500.
  sql: Object.assign(
    vi.fn((...args: unknown[]) => ({ type: "sql", args, as: vi.fn(() => "sql_column") })),
    { raw: vi.fn((...args: unknown[]) => ({ type: "sql_raw", args })) },
  ),
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

const URL = "http://localhost:3000/api/ai/notifications/personalize";

/** Full client record, as `select()` without a column list would return it. */
function makeFullClient(overrides: Record<string, unknown> = {}) {
  return makeClientData({
    phone: "+48600111222",
    email: "anna.kowalska@example.com",
    allergies: "Alergia na amoniak",
    notes: "Notatka wewnetrzna o kliencie",
    preferences: "Lubi cisze\nPreferuje poranne terminy",
    birthday: "1990-06-15",
    ...overrides,
  });
}

const FORBIDDEN_VALUES = [
  "Anna",
  "Kowalska",
  "+48600111222",
  "600111222",
  "anna.kowalska@example.com",
  "Alergia na amoniak",
  "amoniak",
  "Notatka wewnetrzna",
  "1990",
  "15.06",
  "06-15",
  "15.6",
];

/** Calls the route with the given client and model answer; returns body and request. */
async function callRoute(opts: {
  client?: Record<string, unknown>;
  modelText?: string;
  body?: Record<string, unknown>;
}) {
  setupAuthenticatedPro();
  mockDbSelect.mockReturnValueOnce(chainMock([opts.client ?? makeFullClient()]));
  mockDbSelect.mockReturnValueOnce(chainMock([]));
  mockGenerateText.mockResolvedValue({
    text: opts.modelText ?? JSON.stringify({ message: "Zapraszamy!", smsMessage: "Zapraszamy!" }),
  });
  const response = await POST(
    createMockRequest(URL, {
      method: "POST",
      body: opts.body ?? { clientId: VALID_CLIENT_ID, notificationType: "birthday" },
    }),
  );
  const { status, body } = await parseResponse(response);
  const args = mockGenerateText.mock.calls[0]?.[0] as
    | { system: string; prompt: string }
    | undefined;
  return { status, body: body as Record<string, unknown>, system: args?.system, prompt: args?.prompt };
}

function modelJson(message: string, smsMessage: string) {
  return JSON.stringify({ message, smsMessage });
}

describe("POST /api/ai/notifications/personalize", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbSelect.mockReset();
    mockGenerateText.mockReset();
    frozenState.unfreezeAiNotifications = true;
  });

  describe("frozen module", () => {
    it("returns 404 MODULE_DISABLED before session, database and model", async () => {
      frozenState.unfreezeAiNotifications = false;
      const { isModuleFrozen } =
        await vi.importActual<typeof import("@/lib/features")>("@/lib/features");
      expect(isModuleFrozen("aiNotifications")).toBe(true);

      const response = await POST(
        createMockRequest(URL, {
          method: "POST",
          body: { clientId: VALID_CLIENT_ID, notificationType: "birthday" },
        }),
      );
      const { status, body } = await parseResponse(response);

      expect(status).toBe(404);
      expect(body.code).toBe("MODULE_DISABLED");
      expect(mockRequireProAI).not.toHaveBeenCalled();
      expect(mockIsProAIError).not.toHaveBeenCalled();
      expect(mockDbSelect).not.toHaveBeenCalled();
      expect(mockGetSalonContext).not.toHaveBeenCalled();
      expect(mockCreateAIClient).not.toHaveBeenCalled();
      expect(mockGenerateText).not.toHaveBeenCalled();
    });
  });

  describe("request sent to the model", () => {
    it("has no name, contact data, allergies, notes or birth date from the client record", async () => {
      const { status, system, prompt } = await callRoute({});

      expect(status).toBe(200);
      for (const text of [system!, prompt!]) {
        for (const value of FORBIDDEN_VALUES) {
          expect(text).not.toContain(value);
        }
      }
    });

    it("labels the client and keeps preferences on one line", async () => {
      const { prompt } = await callRoute({});

      expect(prompt).toMatch(/(^|\n)Klient(\n|$)/);
      expect(prompt).toMatch(
        /(^|\n)Preferencje: Lubi cisze Preferuje poranne terminy(\n|$)/,
      );
    });

    it("selects an explicit column list for the client", async () => {
      await callRoute({});

      const selectArg = mockDbSelect.mock.calls[0]![0] as Record<string, unknown> | undefined;
      expect(selectArg).toBeDefined();
      expect(Object.keys(selectArg!).sort()).toEqual(["firstName", "id", "preferences"]);
    });

    it("asks for the {imie} token when the client has a first name", async () => {
      const { system } = await callRoute({});

      expect(system).toContain("{imie}");
    });

    it("asks for no token and no first-name address when the client has no first name", async () => {
      const { system } = await callRoute({ client: makeFullClient({ firstName: "  " }) });

      expect(system).not.toContain("{imie}");
      expect(system).not.toMatch(/Zwroc sie do klienta po imieniu/);
    });

    it("puts the context field on one line", async () => {
      const { prompt } = await callRoute({
        body: {
          clientId: VALID_CLIENT_ID,
          notificationType: "follow_up",
          context: "Koloryzacja wczoraj\nKlientka prosi o krotsza wizyte\r\n  Uwaga",
        },
      });

      expect(prompt).toMatch(
        /(^|\n)Dodatkowy kontekst: Koloryzacja wczoraj Klientka prosi o krotsza wizyte Uwaga(\n|$)/,
      );
    });
  });

  describe("first name inserted by the server", () => {
    it("replaces the token in the message", async () => {
      const { status, body } = await callRoute({
        modelText: modelJson("Droga {imie}, zapraszamy!", "Zapraszamy!"),
      });

      expect(status).toBe(200);
      expect(body.message).toBe("Droga Anna, zapraszamy!");
    });

    it("replaces every token in both fields", async () => {
      const { body } = await callRoute({
        modelText: modelJson(
          "{imie}, wszystkiego dobrego! {imie}, czekamy na Ciebie.",
          "{imie}, sto lat! Do zobaczenia, {imie}!",
        ),
      });

      expect(body.message).toBe("Anna, wszystkiego dobrego! Anna, czekamy na Ciebie.");
      expect(body.smsMessage).toBe("Anna, sto lat! Do zobaczenia, Anna!");
    });

    it("uses only the first word of a multi-word first name", async () => {
      const { body } = await callRoute({
        client: makeFullClient({ firstName: "Anna Maria" }),
        modelText: modelJson("Witaj {imie}!", "Witaj {imie}!"),
      });

      expect(body.message).toBe("Witaj Anna!");
      expect(body.smsMessage).toBe("Witaj Anna!");
    });

    it("removes the token with correct spacing when the client has no first name", async () => {
      const { body } = await callRoute({
        client: makeFullClient({ firstName: null }),
        modelText: modelJson(
          "Droga {imie}, zapraszamy! Witaj {imie}! Do zobaczenia {imie} w salonie.",
          "{imie}, sto lat!",
        ),
      });

      expect(body.message).toBe("Droga, zapraszamy! Witaj! Do zobaczenia w salonie.");
      expect(body.smsMessage).toBe("sto lat!");
      for (const text of [body.message as string, body.smsMessage as string]) {
        expect(text).not.toContain("{imie}");
        expect(text).not.toMatch(/ {2}/);
        expect(text).not.toMatch(/ [,!.?]/);
      }
    });

    it("replaces the token in the fallback when the answer is not JSON", async () => {
      const { status, body } = await callRoute({
        modelText: "Droga {imie}, tesknimy! Do zobaczenia, {imie}.",
      });

      expect(status).toBe(200);
      expect(body.message).toBe("Droga Anna, tesknimy! Do zobaczenia, Anna.");
      expect(body.smsMessage).toBe("Droga Anna, tesknimy! Do zobaczenia, Anna.");
    });

    it("applies the 160-character SMS limit after inserting a long first name", async () => {
      const longName = "Konstantynopolitanka";
      const sms = "{imie}, " + "x".repeat(150);
      expect(sms.length).toBeLessThanOrEqual(160);

      const { body } = await callRoute({
        client: makeFullClient({ firstName: longName }),
        modelText: modelJson("Wiadomosc", sms),
      });

      const smsOut = body.smsMessage as string;
      expect(smsOut.length).toBe(160);
      expect(smsOut.startsWith(`${longName}, `)).toBe(true);
      expect(smsOut.endsWith("...")).toBe(true);
    });
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
