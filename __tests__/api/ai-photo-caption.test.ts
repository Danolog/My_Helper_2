/**
 * Integration tests for POST /api/ai/content/photo-caption.
 *
 * Tests cover:
 * - Auth gating (401 when not authenticated)
 * - Plan gating (403 when the salon plan has no AI)
 * - Input validation (400 for invalid JSON and invalid photoId)
 * - Not found (404 when the photo does not exist in the salon)
 * - Happy path (200 with the generated caption)
 * - Server errors (500 when reading the photo fails, the model fails or
 *   returns no text)
 * - Request sent to the model: the employee only by the first word of the
 *   first name, never the last name; no employee line without a first name
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createMockRequest, parseResponse, TEST_IDS } from "./helpers";

/** Zod v4 enforces strict RFC 4122 UUID format. */
const VALID_PHOTO_ID = "d1e2f3a4-b5c6-4789-abcd-ef1234567890";
const URL = "http://localhost:3000/api/ai/content/photo-caption";

// -------------------------------------------------------
// Mocks
// -------------------------------------------------------

const mockRequireProAI = vi.fn();
const mockIsProAIError = vi.fn();
const mockGetSalonContext = vi.fn();
const mockCreateAIClient = vi.fn();
const mockGetAIModel = vi.fn();
const mockTrackAIUsage = vi.fn();

vi.mock("@/lib/ai/openrouter", () => ({
  requireProAI: (...args: unknown[]) => mockRequireProAI(...args),
  isProAIError: (...args: unknown[]) => mockIsProAIError(...args),
  getSalonContext: (...args: unknown[]) => mockGetSalonContext(...args),
  createAIClient: (...args: unknown[]) => mockCreateAIClient(...args),
  getAIModel: (...args: unknown[]) => mockGetAIModel(...args),
  trackAIUsage: (...args: unknown[]) => mockTrackAIUsage(...args),
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
    galleryPhotos: createTable("galleryPhotos"),
    employees: createTable("employees"),
    services: createTable("services"),
  };
});

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: unknown[]) => ({ type: "eq", args })),
  and: vi.fn((...args: unknown[]) => ({ type: "and", args })),
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

import { POST } from "@/app/api/ai/content/photo-caption/route";

// -------------------------------------------------------
// Chain builder (same pattern as other API tests)
// -------------------------------------------------------

function chainMock(result: unknown[] = []) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "from", "where", "leftJoin", "innerJoin", "limit", "orderBy"]) {
    chain[method] = vi.fn().mockReturnValue(chain);
  }
  chain.then = (resolve: (val: unknown[]) => unknown) => Promise.resolve(resolve(result));
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
  mockTrackAIUsage.mockResolvedValue(undefined);
}

/**
 * Row as the database would return it. The last-name value is present on
 * purpose: even if a query returned it, it must not reach the model.
 */
function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: VALID_PHOTO_ID,
    description: "Efekt koloryzacji",
    productsUsed: "Farba testowa",
    techniques: "Balayage",
    duration: 90,
    beforePhotoUrl: null,
    afterPhotoUrl: null,
    employeeFirstName: "Marta Ewa",
    employeeLastName: "Zielinska",
    serviceName: "Koloryzacja",
    ...overrides,
  };
}

function makeRequest(body: unknown = { photoId: VALID_PHOTO_ID, platform: "instagram" }) {
  return createMockRequest(URL, { method: "POST", body });
}

async function callAndGetRequest(row: unknown) {
  mockDbSelect.mockReturnValueOnce(chainMock([row]));
  mockGenerateText.mockResolvedValue({ text: "Nowy look! #koloryzacja" });
  const response = await POST(makeRequest());
  expect(mockGenerateText).toHaveBeenCalledTimes(1);
  const args = mockGenerateText.mock.calls[0]![0] as { prompt: string; system: string };
  return { status: response.status, prompt: args.prompt, system: args.system };
}

// -------------------------------------------------------
// Tests
// -------------------------------------------------------

describe("POST /api/ai/content/photo-caption", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbSelect.mockReset();
    mockGenerateText.mockReset();
  });
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
        { error: "Funkcje AI sa dostepne tylko w Planie Pro.", code: "PLAN_UPGRADE_REQUIRED" },
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
    expect(mockDbSelect).not.toHaveBeenCalled();
  });

  it("should return 400 for invalid photoId format", async () => {
    setupAuthenticatedPro();

    const { status, body } = await parseResponse(
      await POST(makeRequest({ photoId: "not-a-uuid", platform: "instagram" })),
    );

    expect(status).toBe(400);
    expect(body.error).toBe("Invalid request");
    expect(mockDbSelect).not.toHaveBeenCalled();
  });

  it("should return 404 when the photo is not found in the salon", async () => {
    setupAuthenticatedPro();
    mockDbSelect.mockReturnValueOnce(chainMock([]));

    const { status, body } = await parseResponse(await POST(makeRequest()));

    expect(status).toBe(404);
    expect(body.error).toBe("Nie znaleziono zdjecia o podanym ID.");
    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  it("should return 500 when reading the photo fails", async () => {
    setupAuthenticatedPro();
    mockDbSelect.mockImplementationOnce(() => {
      throw new Error("db down");
    });

    const { status, body } = await parseResponse(await POST(makeRequest()));

    expect(status).toBe(500);
    expect(body.error).toBe("Blad podczas pobierania danych zdjecia.");
    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  it("should return 200 with the generated caption and hashtags", async () => {
    setupAuthenticatedPro();
    mockDbSelect.mockReturnValueOnce(chainMock([makeRow()]));
    mockGenerateText.mockResolvedValue({ text: "  Nowy look! #koloryzacja  " });

    const { status, body } = await parseResponse(await POST(makeRequest()));

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    const data = body as Record<string, unknown>;
    expect(data.caption).toBe("Nowy look! #koloryzacja");
    expect(data.platform).toBe("instagram");
    expect(data.hashtags).toEqual(["#koloryzacja"]);
    expect(mockTrackAIUsage).toHaveBeenCalledWith(TEST_IDS.SALON_UUID, "photo_caption");
  });

  it("should return 500 when the model call fails", async () => {
    setupAuthenticatedPro();
    mockDbSelect.mockReturnValueOnce(chainMock([makeRow()]));
    mockGenerateText.mockRejectedValue(new Error("model unavailable"));

    const { status, body } = await parseResponse(await POST(makeRequest()));

    expect(status).toBe(500);
    expect(body.error).toContain("Blad podczas generowania podpisu");
    expect(mockTrackAIUsage).not.toHaveBeenCalled();
  });

  it("should return 500 when the model returns no text", async () => {
    setupAuthenticatedPro();
    mockDbSelect.mockReturnValueOnce(chainMock([makeRow()]));
    mockGenerateText.mockResolvedValue({ text: "   " });

    const { status, body } = await parseResponse(await POST(makeRequest()));

    expect(status).toBe(500);
    expect(body.error).toContain("AI nie wygenerowalo podpisu");
  });

  describe("request sent to the model", () => {
    it("names the employee only by the first word of the first name", async () => {
      setupAuthenticatedPro();

      const { status, prompt, system } = await callAndGetRequest(makeRow());

      expect(status).toBe(200);
      expect(prompt).toMatch(/(^|\n)Wykonawca: Marta(\n|$)/);
      for (const text of [prompt, system]) {
        expect(text).not.toContain("Zielinska");
        expect(text).not.toContain("Ewa");
      }
      expect(prompt).toContain("Wykonana usluga: Koloryzacja");
    });

    it("keeps the employee line on one line when the first name has a line break", async () => {
      setupAuthenticatedPro();

      const { prompt } = await callAndGetRequest(
        makeRow({ employeeFirstName: "Marta\nZielinska" }),
      );

      expect(prompt).toMatch(/(^|\n)Wykonawca: Marta(\n|$)/);
      expect(prompt).not.toContain("Zielinska");
    });

    it("includes the employee's first name even without a last name", async () => {
      setupAuthenticatedPro();

      const { prompt } = await callAndGetRequest(makeRow({ employeeLastName: null }));

      expect(prompt).toMatch(/(^|\n)Wykonawca: Marta(\n|$)/);
    });

    it("omits the employee line when the photo has no employee", async () => {
      setupAuthenticatedPro();

      const { status, prompt, system } = await callAndGetRequest(
        makeRow({ employeeFirstName: null, employeeLastName: null }),
      );

      expect(status).toBe(200);
      expect(prompt).not.toContain("Wykonawca");
      expect(system).not.toContain("Wykonawca");
    });

    it("omits the employee line when the employee has no first name", async () => {
      setupAuthenticatedPro();

      const { prompt, system } = await callAndGetRequest(makeRow({ employeeFirstName: "   " }));

      expect(prompt).not.toContain("Wykonawca");
      for (const text of [prompt, system]) expect(text).not.toContain("Zielinska");
    });
  });
});
