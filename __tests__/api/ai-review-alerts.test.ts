/**
 * Integration tests for GET /api/ai/business/review-alerts.
 *
 * Tests cover:
 * - Auth gating (401 when not authenticated)
 * - Plan gating (403 when the salon plan has no AI)
 * - Happy path (200 with alerts for the salon owner, full client and
 *   employee names added on the server side)
 * - Empty result (200 with no alerts, model not called)
 * - Review without a client or employee
 * - Fallback to the template response (no API key, model failure)
 * - Server errors (500 when the database fails)
 * - Request sent to the model: the suggested response is addressed to the
 *   client, so the request carries only the client's first name; never last
 *   names, the employee's name or contact data
 *
 * The route takes no input (GET without parameters) and returns an empty
 * list instead of 404, so it has no 400 or 404 responses.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createMockRequest, parseResponse, TEST_IDS } from "./helpers";

const URL = "http://localhost:3000/api/ai/business/review-alerts";
const REVIEW_ID = "c1d2e3f4-a5b6-4789-abcd-ef1234567890";

// -------------------------------------------------------
// Mocks
// -------------------------------------------------------

const mockRequireProAI = vi.fn();
const mockIsProAIError = vi.fn();
const mockTrackAIUsage = vi.fn();
const MODEL_FROM_GETTER = "test-provider/model-from-getter";
const mockGetAIModel = vi.fn(() => MODEL_FROM_GETTER);

vi.mock("@/lib/ai/openrouter", () => ({
  requireProAI: (...args: unknown[]) => mockRequireProAI(...args),
  isProAIError: (...args: unknown[]) => mockIsProAIError(...args),
  trackAIUsage: (...args: unknown[]) => mockTrackAIUsage(...args),
  getAIModel: () => mockGetAIModel(),
}));

vi.mock("@openrouter/ai-sdk-provider", () => ({
  createOpenRouter: vi.fn(() => vi.fn((modelId: string) => ({ modelId }))),
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
    reviews: createTable("reviews"),
    clients: createTable("clients"),
    employees: createTable("employees"),
    services: createTable("services"),
    appointments: createTable("appointments"),
  };
});

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: unknown[]) => ({ type: "eq", args })),
  and: vi.fn((...args: unknown[]) => ({ type: "and", args })),
  gte: vi.fn((...args: unknown[]) => ({ type: "gte", args })),
  lte: vi.fn((...args: unknown[]) => ({ type: "lte", args })),
  desc: vi.fn((...args: unknown[]) => ({ type: "desc", args })),
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

import { GET } from "@/app/api/ai/business/review-alerts/route";

// -------------------------------------------------------
// Chain builder (same pattern as other API tests)
// -------------------------------------------------------

function chainMock(result: unknown[] = []) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "from", "where", "leftJoin", "innerJoin", "limit", "orderBy"]) {
    chain[method] = vi.fn().mockReturnValue(chain);
  }
  chain.then = (resolve: (val: unknown[]) => unknown) => resolve(result);
  return chain;
}

function errorChain() {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "from", "where", "leftJoin", "innerJoin", "limit", "orderBy"]) {
    chain[method] = vi.fn().mockReturnValue(chain);
  }
  chain.then = (_: unknown, reject: (err: Error) => void) =>
    reject(new Error("DB connection failed"));
  return chain;
}

// -------------------------------------------------------
// Helpers
// -------------------------------------------------------

function setupAuthenticatedPro() {
  mockRequireProAI.mockResolvedValue({ salonId: TEST_IDS.SALON_UUID });
  mockIsProAIError.mockReturnValue(false);
  mockTrackAIUsage.mockResolvedValue(undefined);
}

/** Row shape returned by the negative-reviews query of the route. */
function makeReviewRow(overrides: Record<string, unknown> = {}) {
  return {
    reviewId: REVIEW_ID,
    rating: 2,
    comment: "Za dlugo czekalam",
    reviewCreatedAt: new Date("2026-04-02T10:00:00Z"),
    clientFirstName: "Anna",
    clientLastName: "Kowalska",
    employeeFirstName: "Marta",
    employeeLastName: "Zielinska",
    serviceName: "Koloryzacja",
    appointmentStartTime: new Date("2026-04-01T10:00:00Z"),
    ...overrides,
  };
}

function setupReviews(rows: unknown[]) {
  mockDbSelect.mockReturnValueOnce(chainMock(rows));
  mockDbSelect.mockReturnValueOnce(chainMock(rows.map(() => ({ reviewId: REVIEW_ID }))));
}

function makeRequest() {
  return createMockRequest(URL, { method: "GET" });
}

const FORBIDDEN_VALUES = [
  "Kowalska",
  "Marta",
  "Zielinska",
  "+48600111222",
  "anna.kowalska@example.com",
  "+48700222333",
  "marta.zielinska@example.com",
];

async function callAndGetRequest(row: Record<string, unknown>) {
  setupReviews([row]);
  mockGenerateText.mockResolvedValue({ text: "Przepraszamy za czekanie." });
  const response = await GET(makeRequest());
  expect(mockGenerateText).toHaveBeenCalledTimes(1);
  const args = mockGenerateText.mock.calls[0]![0] as { prompt: string; system: string };
  return { status: response.status, prompt: args.prompt, system: args.system };
}

// -------------------------------------------------------
// Tests
// -------------------------------------------------------

describe("GET /api/ai/business/review-alerts", () => {
  const originalKey = process.env.OPENROUTER_API_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDbSelect.mockReset();
    mockGenerateText.mockReset();
    process.env.OPENROUTER_API_KEY = "test-key";
  });
  afterEach(() => {
    mockDbSelect.mockReset();
    if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalKey;
  });

  it("should return 401 when not authenticated", async () => {
    mockRequireProAI.mockResolvedValue(
      Response.json({ error: "Unauthorized" }, { status: 401 }),
    );
    mockIsProAIError.mockReturnValue(true);

    const { status, body } = await parseResponse(await GET(makeRequest()));

    expect(status).toBe(401);
    expect(body.error).toBe("Unauthorized");
    expect(mockDbSelect).not.toHaveBeenCalled();
    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  it("should return 403 when the salon plan has no AI", async () => {
    mockRequireProAI.mockResolvedValue(
      Response.json(
        { error: "Funkcje AI sa dostepne tylko w Planie Pro.", code: "PLAN_UPGRADE_REQUIRED" },
        { status: 403 },
      ),
    );
    mockIsProAIError.mockReturnValue(true);

    const { status, body } = await parseResponse(await GET(makeRequest()));

    expect(status).toBe(403);
    expect(body.code).toBe("PLAN_UPGRADE_REQUIRED");
    expect(mockDbSelect).not.toHaveBeenCalled();
    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  it("should return 200 with alerts containing client and employee data for the owner", async () => {
    setupAuthenticatedPro();
    setupReviews([makeReviewRow()]);
    mockGenerateText.mockResolvedValue({ text: "Przepraszamy, Anno." });

    const { status, body } = await parseResponse(await GET(makeRequest()));

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    const data = body as Record<string, unknown>;
    expect(data.totalNegativeReviews).toBe(1);
    const alerts = data.alerts as Array<Record<string, unknown>>;
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      id: `review-alert-${REVIEW_ID}`,
      reviewId: REVIEW_ID,
      rating: 2,
      comment: "Za dlugo czekalam",
      clientName: "Anna Kowalska",
      employeeName: "Marta Zielinska",
      serviceName: "Koloryzacja",
      appointmentDate: "2026-04-01T10:00:00.000Z",
      severity: "critical",
      suggestedResponse: "Przepraszamy, Anno.",
      responseType: "ai",
    });
    expect(mockTrackAIUsage).toHaveBeenCalledWith(TEST_IDS.SALON_UUID, "review_alerts");
  });

  it("should mark a 3-star review as warning", async () => {
    setupAuthenticatedPro();
    setupReviews([makeReviewRow({ rating: 3 })]);
    mockGenerateText.mockResolvedValue({ text: "Dziekujemy." });

    const { status, body } = await parseResponse(await GET(makeRequest()));

    expect(status).toBe(200);
    const alerts = (body as Record<string, unknown>).alerts as Array<Record<string, unknown>>;
    expect(alerts[0]!.severity).toBe("warning");
  });

  it("should return 200 with no alerts when there are no negative reviews", async () => {
    setupAuthenticatedPro();
    setupReviews([]);

    const { status, body } = await parseResponse(await GET(makeRequest()));

    expect(status).toBe(200);
    const data = body as Record<string, unknown>;
    expect(data.alerts).toEqual([]);
    expect(data.totalNegativeReviews).toBe(0);
    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  it("should use placeholder names for a review without client and employee", async () => {
    setupAuthenticatedPro();
    setupReviews([
      makeReviewRow({
        clientFirstName: null,
        clientLastName: null,
        employeeFirstName: null,
        employeeLastName: null,
        serviceName: null,
        appointmentStartTime: null,
      }),
    ]);
    mockGenerateText.mockResolvedValue({ text: "Przepraszamy." });

    const { status, body } = await parseResponse(await GET(makeRequest()));

    expect(status).toBe(200);
    const alerts = (body as Record<string, unknown>).alerts as Array<Record<string, unknown>>;
    expect(alerts[0]).toMatchObject({
      clientName: "Nieznany klient",
      employeeName: "Nieprzypisany",
      serviceName: "Nieokreslona",
      appointmentDate: null,
    });
  });

  it("should fall back to the template response when the API key is missing", async () => {
    setupAuthenticatedPro();
    delete process.env.OPENROUTER_API_KEY;
    setupReviews([makeReviewRow()]);

    const { status, body } = await parseResponse(await GET(makeRequest()));

    expect(status).toBe(200);
    const alerts = (body as Record<string, unknown>).alerts as Array<Record<string, unknown>>;
    expect(alerts[0]!.responseType).toBe("template");
    expect(alerts[0]!.suggestedResponse).toContain("Anna Kowalska");
    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  it("should fall back to the template response when the model call fails", async () => {
    setupAuthenticatedPro();
    setupReviews([makeReviewRow()]);
    mockGenerateText.mockRejectedValue(new Error("model unavailable"));

    const { status, body } = await parseResponse(await GET(makeRequest()));

    expect(status).toBe(200);
    const alerts = (body as Record<string, unknown>).alerts as Array<Record<string, unknown>>;
    expect(alerts[0]!.responseType).toBe("template");
    expect(alerts[0]!.clientName).toBe("Anna Kowalska");
    expect(mockTrackAIUsage).not.toHaveBeenCalled();
  });

  it("should return 500 when the database fails", async () => {
    setupAuthenticatedPro();
    mockDbSelect.mockReturnValueOnce(errorChain());

    const { status, body } = await parseResponse(await GET(makeRequest()));

    expect(status).toBe(500);
    expect(body.error).toBe("Failed to generate review alerts");
    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  describe("request sent to the model", () => {
    it("contains only the client's first name, the service, rating and comment", async () => {
      setupAuthenticatedPro();

      const { status, prompt } = await callAndGetRequest(makeReviewRow());

      expect(status).toBe(200);
      expect(prompt).toMatch(/(^|\n)Klient: Anna(\n|$)/);
      expect(prompt).toContain("Usluga: Koloryzacja");
      expect(prompt).toContain("Ocena: 2/5");
      expect(prompt).toMatch(/(^|\n)Komentarz: Za dlugo czekalam(\n|$)/);
    });

    it("has no last names, employee name or contact data", async () => {
      setupAuthenticatedPro();

      const { prompt, system } = await callAndGetRequest(
        makeReviewRow({
          clientPhone: "+48600111222",
          clientEmail: "anna.kowalska@example.com",
          employeePhone: "+48700222333",
          employeeEmail: "marta.zielinska@example.com",
        }),
      );

      for (const text of [prompt, system]) {
        for (const value of FORBIDDEN_VALUES) {
          expect(text).not.toContain(value);
        }
      }
    });

    it("uses only the first word of a multi-word first name", async () => {
      setupAuthenticatedPro();

      const { prompt } = await callAndGetRequest(
        makeReviewRow({ clientFirstName: "Anna Maria\nTelefon: 600" }),
      );

      expect(prompt).toMatch(/(^|\n)Klient: Anna(\n|$)/);
      expect(prompt).not.toContain("Maria");
      expect(prompt).not.toContain("600");
    });

    it("omits the client line when the review has no client", async () => {
      setupAuthenticatedPro();

      const { status, prompt } = await callAndGetRequest(
        makeReviewRow({ clientFirstName: null, clientLastName: null }),
      );

      expect(status).toBe(200);
      expect(prompt).not.toMatch(/(^|\n)Klient:/);
      expect(prompt).toContain("Usluga: Koloryzacja");
    });

    it("omits the client line when the client has only a last name", async () => {
      setupAuthenticatedPro();

      const { prompt } = await callAndGetRequest(
        makeReviewRow({ clientFirstName: "  " }),
      );

      expect(prompt).not.toMatch(/(^|\n)Klient:/);
      expect(prompt).not.toContain("Kowalska");
    });

    it("uses the model id returned by getAIModel()", async () => {
      setupAuthenticatedPro();
      const previousModel = process.env.OPENROUTER_MODEL;
      process.env.OPENROUTER_MODEL = "env/model-read-directly";
      try {
        await callAndGetRequest(makeReviewRow());
      } finally {
        if (previousModel === undefined) delete process.env.OPENROUTER_MODEL;
        else process.env.OPENROUTER_MODEL = previousModel;
      }

      expect(mockGetAIModel).toHaveBeenCalled();
      const args = mockGenerateText.mock.calls[0]![0] as { model: { modelId: string } };
      expect(args.model).toEqual({ modelId: MODEL_FROM_GETTER });
    });

    it("system prompt never asks for the last name", async () => {
      setupAuthenticatedPro();

      const { system } = await callAndGetRequest(makeReviewRow());

      expect(system).not.toMatch(/nazwisk/i);
    });
  });
});
