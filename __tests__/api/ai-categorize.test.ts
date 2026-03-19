/**
 * Integration tests for POST /api/ai/categorize endpoint.
 *
 * Tests cover:
 * - Auth gating (401 when not authenticated)
 * - Pro plan gating (403 when not on Pro plan)
 * - Input validation (400 for invalid JSON, missing fields)
 * - Happy path (successful categorization)
 * - AI response parse failure (graceful fallback)
 * - Server error handling (500)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockRequest, parseResponse } from "./helpers";

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

import { POST } from "@/app/api/ai/categorize/route";

// -------------------------------------------------------
// Helpers
// -------------------------------------------------------

/** Set up mocks for a successful (authenticated + Pro plan) request. */
function setupAuthenticatedPro() {
  mockRequireProAI.mockResolvedValue({ salonId: "test-salon-id" });
  mockIsProAIError.mockReturnValue(false);
  mockGetSalonContext.mockResolvedValue({
    salonName: "Test Salon",
    industryType: "hair_salon",
    industryLabel: "salon fryzjerski",
  });
  mockCreateAIClient.mockReturnValue(vi.fn());
  mockGetAIModel.mockReturnValue("anthropic/claude-sonnet-4");
}

// -------------------------------------------------------
// Tests
// -------------------------------------------------------

describe("POST /api/ai/categorize", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return 401 when not authenticated", async () => {
    // requireProAI returns a 401 Response when auth fails
    const authError = Response.json(
      { error: "Unauthorized" },
      { status: 401 },
    );
    mockRequireProAI.mockResolvedValue(authError);
    mockIsProAIError.mockReturnValue(true);

    const request = createMockRequest("http://localhost:3000/api/ai/categorize", {
      method: "POST",
      body: { name: "Strzyzenie", type: "service" },
    });

    const response = await POST(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(401);
    expect(body.error).toBe("Unauthorized");
  });

  it("should return 403 when not on Pro plan", async () => {
    const planError = Response.json(
      { error: "Funkcje AI sa dostepne tylko w Planie Pro.", code: "PLAN_UPGRADE_REQUIRED" },
      { status: 403 },
    );
    mockRequireProAI.mockResolvedValue(planError);
    mockIsProAIError.mockReturnValue(true);

    const request = createMockRequest("http://localhost:3000/api/ai/categorize", {
      method: "POST",
      body: { name: "Strzyzenie", type: "service" },
    });

    const response = await POST(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(403);
    expect(body.code).toBe("PLAN_UPGRADE_REQUIRED");
  });

  it("should return 400 for invalid JSON body", async () => {
    setupAuthenticatedPro();

    // Create a request with malformed JSON so req.json() throws
    const request = new Request("http://localhost:3000/api/ai/categorize", {
      method: "POST",
      body: "this is not valid json",
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(400);
    expect(body.error).toBe("Invalid JSON");
  });

  it("should return 400 for missing required fields (empty name)", async () => {
    setupAuthenticatedPro();

    const request = createMockRequest("http://localhost:3000/api/ai/categorize", {
      method: "POST",
      body: { name: "", type: "service" },
    });

    const response = await POST(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(400);
    expect(body.error).toBe("Invalid request");
    expect(body.details).toBeDefined();
  });

  it("should return 400 for missing type field", async () => {
    setupAuthenticatedPro();

    const request = createMockRequest("http://localhost:3000/api/ai/categorize", {
      method: "POST",
      body: { name: "Strzyzenie" },
    });

    const response = await POST(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(400);
    expect(body.error).toBe("Invalid request");
    expect(body.details).toBeDefined();
  });

  it("should return categorization result for valid request", async () => {
    setupAuthenticatedPro();

    const aiCategorization = {
      suggestedCategory: "Fryzjerstwo",
      confidence: "high",
      isNew: false,
      reason: "Strzyzenie jednoznacznie wskazuje na kategorie fryzjerska",
    };

    mockGenerateText.mockResolvedValue({
      text: JSON.stringify(aiCategorization),
    });

    const request = createMockRequest("http://localhost:3000/api/ai/categorize", {
      method: "POST",
      body: {
        name: "Strzyzenie meskie",
        type: "service",
        existingCategories: ["Fryzjerstwo", "Koloryzacja"],
      },
    });

    const response = await POST(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.suggestedCategory).toBe("Fryzjerstwo");
    expect(body.confidence).toBe("high");
    expect(body.isNew).toBe(false);
    expect(body.reason).toBeDefined();
  });

  it("should handle AI response parse failure gracefully", async () => {
    setupAuthenticatedPro();

    // AI returns something that is not valid JSON
    mockGenerateText.mockResolvedValue({
      text: "Proponuje kategorie Fryzjerstwo",
    });

    const request = createMockRequest("http://localhost:3000/api/ai/categorize", {
      method: "POST",
      body: { name: "Strzyzenie", type: "service" },
    });

    const response = await POST(request);
    const { status, body } = await parseResponse(response);

    // The endpoint falls back to a low-confidence result using the raw text
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.confidence).toBe("low");
    expect(body.isNew).toBe(true);
    expect(body.reason).toBe("Nie udalo sie przetworzyc odpowiedzi AI");
  });

  it("should return 500 when AI call throws an error", async () => {
    setupAuthenticatedPro();

    mockGenerateText.mockRejectedValue(new Error("OpenRouter API timeout"));

    const request = createMockRequest("http://localhost:3000/api/ai/categorize", {
      method: "POST",
      body: { name: "Strzyzenie", type: "service" },
    });

    const response = await POST(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(500);
    expect(body.error).toContain("Blad podczas kategoryzacji");
  });

  it("should work with product type and no existing categories", async () => {
    setupAuthenticatedPro();

    const aiCategorization = {
      suggestedCategory: "Szampony",
      confidence: "high",
      isNew: true,
      reason: "Nowa kategoria dla produktu szampon",
    };

    mockGenerateText.mockResolvedValue({
      text: JSON.stringify(aiCategorization),
    });

    const request = createMockRequest("http://localhost:3000/api/ai/categorize", {
      method: "POST",
      body: {
        name: "Szampon nawilzajacy",
        type: "product",
        existingCategories: [],
      },
    });

    const response = await POST(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.suggestedCategory).toBe("Szampony");
    expect(body.isNew).toBe(true);
  });
});
