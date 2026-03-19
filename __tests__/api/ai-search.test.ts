/**
 * Integration tests for POST /api/ai/search endpoint.
 *
 * Tests cover:
 * - Auth gating (401 when not authenticated)
 * - Pro plan gating (403 when not on Pro plan)
 * - Input validation (400 for empty query, invalid JSON)
 * - Happy path (successful search with results)
 * - AI intent parse failure (422 graceful error)
 * - Server error handling (500)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockRequest, parseResponse, TEST_IDS } from "./helpers";

// -------------------------------------------------------
// Mocks
// -------------------------------------------------------

const mockRequireProAI = vi.fn();
const mockIsProAIError = vi.fn();
const mockCreateAIClient = vi.fn();
const mockGetAIModel = vi.fn();

vi.mock("@/lib/ai/openrouter", () => ({
  requireProAI: (...args: unknown[]) => mockRequireProAI(...args),
  isProAIError: (...args: unknown[]) => mockIsProAIError(...args),
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
    employees: createTable("employees"),
    services: createTable("services"),
    products: createTable("products"),
  };
});

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: unknown[]) => ({ type: "eq", args })),
  and: vi.fn((...args: unknown[]) => ({ type: "and", args })),
  desc: vi.fn((...args: unknown[]) => ({ type: "desc", args })),
  ilike: vi.fn((...args: unknown[]) => ({ type: "ilike", args })),
  gte: vi.fn((...args: unknown[]) => ({ type: "gte", args })),
  lte: vi.fn((...args: unknown[]) => ({ type: "lte", args })),
  sql: Object.assign(
    vi.fn((...args: unknown[]) => ({
      type: "sql",
      args,
      as: vi.fn(() => "sql_column"),
    })),
    {
      raw: vi.fn((...args: unknown[]) => ({ type: "sql_raw", args })),
    },
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

import { POST } from "@/app/api/ai/search/route";

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
  mockCreateAIClient.mockReturnValue(vi.fn());
  mockGetAIModel.mockReturnValue("anthropic/claude-sonnet-4");
}

// -------------------------------------------------------
// Tests
// -------------------------------------------------------

describe("POST /api/ai/search", () => {
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

    const request = createMockRequest("http://localhost:3000/api/ai/search", {
      method: "POST",
      body: { query: "klienci z dzisiejszymi wizytami" },
    });

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

    const request = createMockRequest("http://localhost:3000/api/ai/search", {
      method: "POST",
      body: { query: "pokaz najdrozsze uslugi" },
    });

    const response = await POST(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(403);
    expect(body.code).toBe("PLAN_UPGRADE_REQUIRED");
  });

  it("should return 400 for invalid JSON body", async () => {
    setupAuthenticatedPro();

    const request = new Request("http://localhost:3000/api/ai/search", {
      method: "POST",
      body: "not json",
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(400);
    expect(body.error).toBe("Invalid JSON");
  });

  it("should return 400 for empty query", async () => {
    setupAuthenticatedPro();

    const request = createMockRequest("http://localhost:3000/api/ai/search", {
      method: "POST",
      body: { query: "" },
    });

    const response = await POST(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(400);
    expect(body.error).toBe("Invalid request");
    expect(body.details).toBeDefined();
  });

  it("should return 400 when query field is missing", async () => {
    setupAuthenticatedPro();

    const request = createMockRequest("http://localhost:3000/api/ai/search", {
      method: "POST",
      body: {},
    });

    const response = await POST(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(400);
    expect(body.error).toBe("Invalid request");
  });

  it("should return search results for valid client query", async () => {
    setupAuthenticatedPro();

    // AI parses the query into a structured intent for clients
    const aiIntent = {
      entity: "clients",
      filters: { nameContains: "Kowalska", status: null, dateFrom: null, dateTo: null },
      sort: null,
      limit: 10,
      description: "Szukam klientki Kowalska",
    };

    mockGenerateText.mockResolvedValue({
      text: JSON.stringify(aiIntent),
    });

    // DB returns matching clients
    mockDbSelect.mockReturnValueOnce(
      chainMock([
        {
          id: TEST_IDS.CLIENT_UUID,
          firstName: "Anna",
          lastName: "Kowalska",
          phone: "+48123456789",
          email: "anna@example.com",
        },
      ]),
    );

    const request = createMockRequest("http://localhost:3000/api/ai/search", {
      method: "POST",
      body: { query: "Anna Kowalska" },
    });

    const response = await POST(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.results).toHaveLength(1);

    const group = (body.results as Array<Record<string, unknown>>)[0]!;
    expect(group.type).toBe("clients");
    expect(group.label).toBe("Klienci");
    expect((group.items as unknown[]).length).toBe(1);
    expect(body.description).toBe("Szukam klientki Kowalska");
  });

  it("should return search results for service query", async () => {
    setupAuthenticatedPro();

    const aiIntent = {
      entity: "services",
      filters: { nameContains: null, status: null, dateFrom: null, dateTo: null },
      sort: "price",
      limit: 5,
      description: "Najdrozsze uslugi",
    };

    mockGenerateText.mockResolvedValue({
      text: JSON.stringify(aiIntent),
    });

    mockDbSelect.mockReturnValueOnce(
      chainMock([
        {
          id: TEST_IDS.SERVICE_UUID,
          name: "Koloryzacja premium",
          basePrice: "350.00",
          baseDuration: 180,
        },
      ]),
    );

    const request = createMockRequest("http://localhost:3000/api/ai/search", {
      method: "POST",
      body: { query: "najdrozsze uslugi" },
    });

    const response = await POST(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(200);
    expect(body.success).toBe(true);

    const group = (body.results as Array<Record<string, unknown>>)[0]!;
    expect(group.type).toBe("services");
    expect(group.label).toBe("Uslugi");
  });

  it("should return 422 when AI intent parse fails", async () => {
    setupAuthenticatedPro();

    // AI returns text that does not match the expected intent schema
    mockGenerateText.mockResolvedValue({
      text: "Przepraszam, nie rozumiem tego zapytania.",
    });

    const request = createMockRequest("http://localhost:3000/api/ai/search", {
      method: "POST",
      body: { query: "pokaz mi cos ciekawego" },
    });

    const response = await POST(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(422);
    expect(body.error).toContain("Nie udalo sie zinterpretowac zapytania");
  });

  it("should return 422 when AI returns invalid intent structure", async () => {
    setupAuthenticatedPro();

    // AI returns JSON but with an invalid entity type
    const invalidIntent = {
      entity: "unknown_entity",
      filters: {},
      description: "test",
    };

    mockGenerateText.mockResolvedValue({
      text: JSON.stringify(invalidIntent),
    });

    const request = createMockRequest("http://localhost:3000/api/ai/search", {
      method: "POST",
      body: { query: "znajdz nieistniejacy typ" },
    });

    const response = await POST(request);
    const { status, body } = await parseResponse(response);

    // The zod validation of the intent will fail, returning 422
    expect(status).toBe(422);
    expect(body.error).toContain("Nie udalo sie zinterpretowac zapytania");
  });

  it("should return 500 when AI call throws an error", async () => {
    setupAuthenticatedPro();

    mockGenerateText.mockRejectedValue(new Error("OpenRouter rate limited"));

    const request = createMockRequest("http://localhost:3000/api/ai/search", {
      method: "POST",
      body: { query: "wizyty na jutro" },
    });

    const response = await POST(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(500);
    expect(body.error).toContain("Blad podczas wyszukiwania");
  });

  it("should return empty items when no DB matches found", async () => {
    setupAuthenticatedPro();

    const aiIntent = {
      entity: "employees",
      filters: { nameContains: "Nieistniejacy", status: null, dateFrom: null, dateTo: null },
      sort: null,
      limit: 10,
      description: "Szukam pracownika Nieistniejacy",
    };

    mockGenerateText.mockResolvedValue({
      text: JSON.stringify(aiIntent),
    });

    // DB returns no results
    mockDbSelect.mockReturnValueOnce(chainMock([]));

    const request = createMockRequest("http://localhost:3000/api/ai/search", {
      method: "POST",
      body: { query: "pracownik Nieistniejacy" },
    });

    const response = await POST(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(200);
    expect(body.success).toBe(true);

    const group = (body.results as Array<Record<string, unknown>>)[0]!;
    expect(group.type).toBe("employees");
    expect((group.items as unknown[]).length).toBe(0);
  });
});
