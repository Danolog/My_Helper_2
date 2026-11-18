/**
 * Integration tests for POST /api/ai/clients/insights endpoint.
 *
 * Tests cover:
 * - Auth gating (401 when not authenticated)
 * - Pro plan gating (403 when not on Pro plan)
 * - Input validation (400 for invalid JSON, invalid or missing clientId)
 * - Not found (404 when client does not exist in the salon)
 * - Happy path (200 with parsed insights)
 * - AI response parse failure (graceful fallback)
 * - Server error handling (500)
 * - Client context sent to the model: only whitelisted client fields
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createMockRequest, parseResponse, TEST_IDS } from "./helpers";
import { REVIEW_COMMENT_MAX_LENGTH } from "@/lib/ai/client-context";

/**
 * Zod v4 enforces strict RFC 4122 UUID format, so request bodies use a valid
 * UUID instead of the simplified TEST_IDS constants.
 */
const VALID_CLIENT_ID = "b1c2d3e4-f5a6-4789-abcd-ef1234567890";
const URL = "http://localhost:3000/api/ai/clients/insights";

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

// `tx` inside the salon-scoped transaction delegates to the same select mock.
const mockDbSelect = vi.fn();
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
    appointments: createTable("appointments"),
    clients: createTable("clients"),
    services: createTable("services"),
    reviews: createTable("reviews"),
    loyaltyPoints: createTable("loyaltyPoints"),
  };
});

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: unknown[]) => ({ type: "eq", args })),
  and: vi.fn((...args: unknown[]) => ({ type: "and", args })),
  desc: vi.fn((...args: unknown[]) => ({ type: "desc", args })),
  count: vi.fn(() => ({ type: "count" })),
  // sql + sql.raw are also used by the salon-scoped repository layer.
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

import { POST } from "@/app/api/ai/clients/insights/route";

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
    "groupBy",
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

/** Full client record as returned by `select()` from the clients table. */
function makeClient(overrides: Record<string, unknown> = {}) {
  return {
    id: TEST_IDS.CLIENT_UUID,
    salonId: TEST_IDS.SALON_UUID,
    firstName: "Anna",
    lastName: "Kowalska",
    phone: "+48600111222",
    email: "anna.kowalska@example.com",
    allergies: "Alergia na amoniak",
    preferences: "Preferuje poranne terminy",
    notes: "Notatka wewnetrzna o kliencie",
    birthday: "1990-05-20",
    ...overrides,
  };
}

const AI_INSIGHTS = {
  churnRisk: 3,
  spendingTrend: "Stabilne wydatki",
  topServices: ["Koloryzacja"],
  visitFrequency: "Regularnie co 6 tygodni",
  reengagementSuggestions: ["Przypomnienie o wizycie"],
  summary: "Lojalny klient z regularnymi wizytami.",
};

/** Queues the route's database reads in order, for an existing client. */
function setupClientData(
  client: unknown,
  reviewRows: unknown[] = [{ rating: 5, comment: "Super" }],
) {
  // 1. client profile
  mockDbSelect.mockReturnValueOnce(chainMock([client]));
  // 2. appointment statistics
  mockDbSelect.mockReturnValueOnce(
    chainMock([
      {
        totalVisits: 4,
        completedVisits: 3,
        cancelledVisits: 1,
        noShowVisits: 0,
        firstVisit: new Date("2026-01-10T10:00:00Z"),
        lastVisit: new Date("2026-04-01T10:00:00Z"),
      },
    ]),
  );
  // 3. top services
  mockDbSelect.mockReturnValueOnce(
    chainMock([{ serviceName: "Koloryzacja", servicePrice: "250.00", visitCount: 3 }]),
  );
  // 4. reviews
  mockDbSelect.mockReturnValueOnce(chainMock(reviewRows));
  // 5. loyalty points
  mockDbSelect.mockReturnValueOnce(chainMock([{ points: 120 }]));
  // 6. spending
  mockDbSelect.mockReturnValueOnce(
    chainMock([{ totalSpent: "750.00", avgSpent: "250.00" }]),
  );
}

function makeRequest(body: unknown = { clientId: VALID_CLIENT_ID }) {
  return createMockRequest(URL, { method: "POST", body });
}

// -------------------------------------------------------
// Tests
// -------------------------------------------------------

describe("POST /api/ai/clients/insights", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbSelect.mockReset();
  });
  // Unused `mockReturnValueOnce` values must not leak into the next test.
  afterEach(() => {
    mockDbSelect.mockReset();
  });

  it("should return 401 when not authenticated", async () => {
    mockRequireProAI.mockResolvedValue(
      Response.json({ error: "Unauthorized" }, { status: 401 }),
    );
    mockIsProAIError.mockReturnValue(true);

    const { status, body } = await parseResponse(await POST(makeRequest()));

    expect(status).toBe(401);
    expect(body.error).toBe("Unauthorized");
    expect(mockDbSelect).not.toHaveBeenCalled();
    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  it("should return 403 when the salon plan has no AI", async () => {
    mockRequireProAI.mockResolvedValue(
      Response.json(
        {
          error: "Funkcje AI sa dostepne tylko w Planie Pro.",
          code: "PLAN_UPGRADE_REQUIRED",
        },
        { status: 403 },
      ),
    );
    mockIsProAIError.mockReturnValue(true);

    const { status, body } = await parseResponse(await POST(makeRequest()));

    expect(status).toBe(403);
    expect(body.code).toBe("PLAN_UPGRADE_REQUIRED");
    expect(mockDbSelect).not.toHaveBeenCalled();
    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  it("should return 400 for invalid JSON body", async () => {
    setupAuthenticatedPro();

    const request = new Request(URL, {
      method: "POST",
      body: "not valid json",
      headers: { "Content-Type": "application/json" },
    });
    const { status, body } = await parseResponse(await POST(request));

    expect(status).toBe(400);
    expect(body.error).toBe("Invalid JSON");
  });

  it("should return 400 for invalid clientId format", async () => {
    setupAuthenticatedPro();

    const { status, body } = await parseResponse(
      await POST(makeRequest({ clientId: "not-a-uuid" })),
    );

    expect(status).toBe(400);
    expect(body.error).toBe("Invalid request");
    expect(body.details).toBeDefined();
    expect(mockDbSelect).not.toHaveBeenCalled();
  });

  it("should return 400 when clientId is missing", async () => {
    setupAuthenticatedPro();

    const { status, body } = await parseResponse(await POST(makeRequest({})));

    expect(status).toBe(400);
    expect(body.error).toBe("Invalid request");
  });

  it("should return 404 when client is not found in the salon", async () => {
    setupAuthenticatedPro();
    mockDbSelect.mockReturnValueOnce(chainMock([]));

    const { status, body } = await parseResponse(await POST(makeRequest()));

    expect(status).toBe(404);
    expect(body.error).toBe("Klient nie znaleziony");
    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  it("should return insights for an existing client", async () => {
    setupAuthenticatedPro();
    setupClientData(makeClient());
    mockGenerateText.mockResolvedValue({ text: JSON.stringify(AI_INSIGHTS) });

    const { status, body } = await parseResponse(await POST(makeRequest()));

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect((body as Record<string, unknown>).insights).toEqual(AI_INSIGHTS);
  });

  it("should fall back to a default structure when the AI response is not JSON", async () => {
    setupAuthenticatedPro();
    setupClientData(makeClient());
    mockGenerateText.mockResolvedValue({ text: "Klient odwiedza salon regularnie." });

    const { status, body } = await parseResponse(await POST(makeRequest()));

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    const insights = (body as Record<string, unknown>).insights as Record<string, unknown>;
    expect(insights.churnRisk).toBe(5);
    expect(insights.topServices).toEqual(["Koloryzacja"]);
    expect(insights.summary).toBe("Klient odwiedza salon regularnie.");
  });

  it("should return 500 when the database throws during client lookup", async () => {
    setupAuthenticatedPro();

    const errorChain: Record<string, unknown> = {};
    for (const m of ["select", "from", "where", "limit", "orderBy"]) {
      errorChain[m] = vi.fn().mockReturnValue(errorChain);
    }
    errorChain.then = (_: unknown, reject: (err: Error) => void) =>
      reject(new Error("DB connection failed"));
    mockDbSelect.mockReturnValueOnce(errorChain);

    const { status, body } = await parseResponse(await POST(makeRequest()));

    expect(status).toBe(500);
    expect(body.error).toContain("Blad podczas generowania analizy klienta");
    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  it("should return 500 when the model call fails", async () => {
    setupAuthenticatedPro();
    setupClientData(makeClient());
    mockGenerateText.mockRejectedValue(new Error("model unavailable"));

    const { status, body } = await parseResponse(await POST(makeRequest()));

    expect(status).toBe(500);
    expect(body.error).toContain("Blad podczas generowania analizy klienta");
  });

  describe("client context sent to the model", () => {
    /** Line with the client label only (no first or last name). */
    const CLIENT_LABEL_LINE = /(^|\n)Klient(\n|$)/;

    async function callAndGetPrompt(): Promise<{ status: number; prompt: string; system: string }> {
      mockGenerateText.mockResolvedValue({ text: JSON.stringify(AI_INSIGHTS) });
      const response = await POST(makeRequest());
      expect(mockGenerateText).toHaveBeenCalledTimes(1);
      const args = mockGenerateText.mock.calls[0]![0] as { prompt: string; system: string };
      return { status: response.status, prompt: args.prompt, system: args.system };
    }

    it("prompt has no client allergies, names, contact data, notes or birth year", async () => {
      setupAuthenticatedPro();
      setupClientData(makeClient());

      const { status, prompt, system } = await callAndGetPrompt();

      expect(status).toBe(200);
      for (const text of [prompt, system]) {
        expect(text).not.toContain("Alergia na amoniak");
        expect(text).not.toContain("amoniak");
        expect(text).not.toContain("Anna");
        expect(text).not.toContain("Kowalska");
        expect(text).not.toContain("+48600111222");
        expect(text).not.toContain("anna.kowalska@example.com");
        expect(text).not.toContain("Notatka wewnetrzna");
        expect(text).not.toContain("1990");
      }
      expect(prompt).not.toMatch(/Alergie/i);
    });

    it("prompt has the client label, preferences and birthday as day and month", async () => {
      setupAuthenticatedPro();
      setupClientData(makeClient());

      const { prompt } = await callAndGetPrompt();

      expect(prompt).toMatch(CLIENT_LABEL_LINE);
      expect(prompt).toContain("Preferencje: Preferuje poranne terminy");
      expect(prompt).toContain("Urodziny: 20.05");
      expect(prompt).toContain('Salon: "Test Salon"');
      expect(prompt).toContain("STATYSTYKI WIZYT");
      expect(prompt).toContain("Koloryzacja");
      expect(prompt).toContain("PUNKTY LOJALNOSCIOWE: 120 pkt");
    });

    it("prompt keeps only the client label when there are no preferences or birthday", async () => {
      setupAuthenticatedPro();
      setupClientData(makeClient({ preferences: null, birthday: null, allergies: null }));

      const { status, prompt } = await callAndGetPrompt();

      expect(status).toBe(200);
      expect(prompt).toMatch(CLIENT_LABEL_LINE);
      expect(prompt).not.toContain("Preferencje");
      expect(prompt).not.toContain("Urodziny");
      expect(prompt).not.toContain("Kowalska");
    });

    const MULTI_LINE_COMMENT =
      "Bardzo mila obsluga.\nPolecam salon.\r\nWroce za miesiac.\u{85}Do zobaczenia.\u{2028}Dziekuje.";
    const SINGLE_LINE_COMMENT =
      "Bardzo mila obsluga. Polecam salon. Wroce za miesiac. Do zobaczenia. Dziekuje.";

    it("prompt keeps an ordinary review comment unchanged", async () => {
      setupAuthenticatedPro();
      setupClientData(makeClient(), [
        { rating: 4, comment: "Bardzo mila obsluga." },
      ]);

      const { prompt } = await callAndGetPrompt();

      expect(prompt).toContain('  1. Ocena: 4/5 - "Bardzo mila obsluga."');
    });

    it("prompt has a multi-line review comment in a single line", async () => {
      setupAuthenticatedPro();
      setupClientData(makeClient(), [{ rating: 5, comment: MULTI_LINE_COMMENT }]);
      const { prompt } = await callAndGetPrompt();

      mockGenerateText.mockClear();
      setupAuthenticatedPro();
      setupClientData(makeClient(), [{ rating: 5, comment: SINGLE_LINE_COMMENT }]);
      const { prompt: referencePrompt } = await callAndGetPrompt();

      expect(prompt).toContain(`  1. Ocena: 5/5 - "${SINGLE_LINE_COMMENT}"`);
      expect(prompt).not.toMatch(/[\r\u{85}\u{2028}\u{2029}]/u);
      expect(prompt.split("\n")).toHaveLength(referencePrompt.split("\n").length);
    });

    it("prompt cuts a review comment to the maximum length", async () => {
      setupAuthenticatedPro();
      const longComment = "a".repeat(REVIEW_COMMENT_MAX_LENGTH) + "ZZZ";
      setupClientData(makeClient(), [{ rating: 3, comment: longComment }]);

      const { prompt } = await callAndGetPrompt();

      expect(prompt).toContain(
        `  1. Ocena: 3/5 - "${"a".repeat(REVIEW_COMMENT_MAX_LENGTH)}"`,
      );
      expect(prompt).not.toContain("ZZZ");
    });

    it("prompt has no quoted text for a review comment made only of whitespace", async () => {
      setupAuthenticatedPro();
      setupClientData(makeClient(), [
        { rating: 2, comment: " \n\t\r\n\u{85}\u{2028} " },
      ]);

      const { prompt } = await callAndGetPrompt();

      expect(prompt).toMatch(/\n {2}1\. Ocena: 2\/5\n/);
      expect(prompt).not.toContain(" - \"");
    });

    it("system prompt does not ask about allergies, health or the client's name", async () => {
      setupAuthenticatedPro();
      setupClientData(makeClient());

      const { system } = await callAndGetPrompt();

      expect(system).not.toMatch(/alergi|zdrowi|imie|imienia|nazwisk/i);
    });
  });
});
