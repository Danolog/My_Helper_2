/**
 * Integration tests for POST /api/ai/content/generate-review-response.
 *
 * Tests cover:
 * - Auth gating (401 when not authenticated)
 * - Plan gating (403 when the salon plan has no AI)
 * - Input validation (400 for invalid JSON, invalid or missing reviewId)
 * - Not found (404 when the review does not exist in the salon)
 * - Happy path (200 with the generated response and tone)
 * - Server errors (500 when the model fails or returns no text)
 * - Database errors (500 without a model call, log without review text or
 *   client data)
 * - Request sent to the model: only the first name of the client and of the
 *   employee, never last names, contact data or health data; without a first
 *   name the system prompt asks to address the client without a name
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createMockRequest, parseResponse, TEST_IDS } from "./helpers";

/** Zod v4 enforces strict RFC 4122 UUID format. */
const VALID_REVIEW_ID = "c1d2e3f4-a5b6-4789-abcd-ef1234567890";
const URL = "http://localhost:3000/api/ai/content/generate-review-response";

// -------------------------------------------------------
// Mocks
// -------------------------------------------------------

/**
 * Moduł opinii jest zamrożony (`hardOff` w `src/lib/features.ts`). Logikę
 * trasy testujemy z flagą podmienioną na włączoną; osobny test sprawdza
 * zamrożenie.
 */
const frozenState = vi.hoisted(() => ({ unfreezeReviews: true }));
vi.mock("@/lib/features", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/features")>();
  return {
    ...actual,
    isModuleFrozen: (key: Parameters<typeof actual.isModuleFrozen>[0]) =>
      frozenState.unfreezeReviews && key === "reviews" ? false : actual.isModuleFrozen(key),
  };
});

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

import { POST } from "@/app/api/ai/content/generate-review-response/route";
import { REVIEW_COMMENT_MAX_LENGTH } from "@/lib/ai/client-context";
import { logger } from "@/lib/logger";

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

/** Full employee record as returned by `select()` from the employees table. */
function makeEmployee(overrides: Record<string, unknown> = {}) {
  return {
    id: TEST_IDS.EMPLOYEE_UUID,
    salonId: TEST_IDS.SALON_UUID,
    firstName: "Marta",
    lastName: "Zielinska",
    phone: "+48700222333",
    email: "marta.zielinska@example.com",
    ...overrides,
  };
}

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    review: {
      id: VALID_REVIEW_ID,
      salonId: TEST_IDS.SALON_UUID,
      rating: 5,
      comment: "Swietna obsluga",
    },
    client: makeClient(),
    employee: makeEmployee(),
    service: { name: "Koloryzacja" },
    appointment: { id: TEST_IDS.APPOINTMENT_UUID },
    ...overrides,
  };
}

function makeRequest(body: unknown = { reviewId: VALID_REVIEW_ID }) {
  return createMockRequest(URL, { method: "POST", body });
}

const FORBIDDEN_VALUES = [
  "Kowalska",
  "+48600111222",
  "anna.kowalska@example.com",
  "Alergia na amoniak",
  "amoniak",
  "Preferuje poranne terminy",
  "Notatka wewnetrzna",
  "1990",
  "Zielinska",
  "+48700222333",
  "marta.zielinska@example.com",
];

/** Rule in the system prompt when the client's first name is known. */
const ADDRESS_BY_NAME = "po imieniu";
/** Rule in the system prompt when there is no first name to use. */
const ADDRESS_WITHOUT_NAME = "bez imienia";

async function callAndGetRequest(row: unknown) {
  mockDbSelect.mockReturnValueOnce(chainMock([row]));
  mockGenerateText.mockResolvedValue({ text: "Dziekujemy za opinie!" });
  const response = await POST(makeRequest());
  expect(mockGenerateText).toHaveBeenCalledTimes(1);
  const args = mockGenerateText.mock.calls[0]![0] as { prompt: string; system: string };
  return { status: response.status, prompt: args.prompt, system: args.system };
}

// -------------------------------------------------------
// Tests
// -------------------------------------------------------

describe("POST /api/ai/content/generate-review-response", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    frozenState.unfreezeReviews = true;
    mockDbSelect.mockReset();
    mockGenerateText.mockReset();
  });
  afterEach(() => {
    mockDbSelect.mockReset();
  });

  it("moduł opinii zamrożony: 404 MODULE_DISABLED przed planem, bazą i modelem", async () => {
    frozenState.unfreezeReviews = false;

    const { status, body } = await parseResponse(await POST(makeRequest()));

    expect(status).toBe(404);
    expect(body).toEqual({
      success: false,
      code: "MODULE_DISABLED",
      error: "Ta funkcja jest obecnie niedostępna.",
    });
    expect(mockRequireProAI).not.toHaveBeenCalled();
    expect(mockDbSelect).not.toHaveBeenCalled();
    expect(mockGenerateText).not.toHaveBeenCalled();
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

  it("should return 400 for invalid reviewId format", async () => {
    setupAuthenticatedPro();

    const { status, body } = await parseResponse(
      await POST(makeRequest({ reviewId: "not-a-uuid" })),
    );

    expect(status).toBe(400);
    expect(body.error).toBe("Invalid request");
    expect(body.details).toBeDefined();
    expect(mockDbSelect).not.toHaveBeenCalled();
  });

  it("should return 400 when reviewId is missing", async () => {
    setupAuthenticatedPro();

    const { status, body } = await parseResponse(await POST(makeRequest({})));

    expect(status).toBe(400);
    expect(body.error).toBe("Invalid request");
    expect(mockDbSelect).not.toHaveBeenCalled();
  });

  it("should return 404 when the review is not found in the salon", async () => {
    setupAuthenticatedPro();
    mockDbSelect.mockReturnValueOnce(chainMock([]));

    const { status, body } = await parseResponse(await POST(makeRequest()));

    expect(status).toBe(404);
    expect(body.error).toBe("Opinia nie zostala znaleziona");
    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  it("should return 200 with the generated response and positive tone", async () => {
    setupAuthenticatedPro();
    mockDbSelect.mockReturnValueOnce(chainMock([makeRow()]));
    mockGenerateText.mockResolvedValue({ text: "  Dziekujemy, Anno!  " });

    const { status, body } = await parseResponse(await POST(makeRequest()));

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    const data = body as Record<string, unknown>;
    expect(data.response).toBe("Dziekujemy, Anno!");
    expect(data.reviewId).toBe(VALID_REVIEW_ID);
    expect(data.tone).toBe("positive");
    expect(mockTrackAIUsage).toHaveBeenCalledWith(TEST_IDS.SALON_UUID, "review_response");
  });

  it("should return negative tone for a low rating", async () => {
    setupAuthenticatedPro();
    mockDbSelect.mockReturnValueOnce(
      chainMock([makeRow({ review: { id: VALID_REVIEW_ID, rating: 2, comment: "Slabo" } })]),
    );
    mockGenerateText.mockResolvedValue({ text: "Przepraszamy." });

    const { status, body } = await parseResponse(await POST(makeRequest()));

    expect(status).toBe(200);
    expect((body as Record<string, unknown>).tone).toBe("negative");
  });

  it("should return 500 when the model call fails", async () => {
    setupAuthenticatedPro();
    mockDbSelect.mockReturnValueOnce(chainMock([makeRow()]));
    mockGenerateText.mockRejectedValue(new Error("model unavailable"));

    const { status, body } = await parseResponse(await POST(makeRequest()));

    expect(status).toBe(500);
    expect(body.error).toContain("Blad podczas generowania odpowiedzi");
    expect(mockTrackAIUsage).not.toHaveBeenCalled();
  });

  it("should return 500 when the model returns no text", async () => {
    setupAuthenticatedPro();
    mockDbSelect.mockReturnValueOnce(chainMock([makeRow()]));
    mockGenerateText.mockResolvedValue({ text: "   " });

    const { status, body } = await parseResponse(await POST(makeRequest()));

    expect(status).toBe(500);
    expect(body.error).toContain("AI nie wygenerowalo odpowiedzi");
  });

  describe("request sent to the model", () => {
    it("contains the client's first name and the employee's first name", async () => {
      setupAuthenticatedPro();

      const { status, prompt } = await callAndGetRequest(makeRow());

      expect(status).toBe(200);
      expect(prompt).toContain("Imie klienta: Anna");
      expect(prompt).toContain("Pracownik: Marta");
      expect(prompt).toContain("Usluga: Koloryzacja");
      expect(prompt).toContain('Komentarz klienta: "Swietna obsluga"');
    });

    it("has no last names, contact data, health data, notes or birth year", async () => {
      setupAuthenticatedPro();

      const { prompt, system } = await callAndGetRequest(makeRow());

      for (const text of [prompt, system]) {
        for (const value of FORBIDDEN_VALUES) {
          expect(text).not.toContain(value);
        }
      }
      expect(prompt).toMatch(/(^|\n)Imie klienta: Anna(\n|$)/);
      expect(prompt).toMatch(/(^|\n)Pracownik: Marta(\n|$)/);
    });

    it("uses only the first word of a multi-word first name", async () => {
      setupAuthenticatedPro();

      const { prompt } = await callAndGetRequest(
        makeRow({
          client: makeClient({ firstName: "Anna Maria\nAlergie: lateks" }),
          employee: makeEmployee({ firstName: "Marta Ewa" }),
        }),
      );

      expect(prompt).toMatch(/(^|\n)Imie klienta: Anna(\n|$)/);
      expect(prompt).toMatch(/(^|\n)Pracownik: Marta(\n|$)/);
      expect(prompt).not.toContain("Maria");
      expect(prompt).not.toContain("Ewa");
      expect(prompt).not.toContain("lateks");
    });

    it("omits the client line when the review has no client", async () => {
      setupAuthenticatedPro();

      const { status, prompt } = await callAndGetRequest(makeRow({ client: null }));

      expect(status).toBe(200);
      expect(prompt).not.toContain("Imie klienta");
      expect(prompt).toContain("Pracownik: Marta");
    });

    it("omits the client line when the client has no first name", async () => {
      setupAuthenticatedPro();

      const { prompt } = await callAndGetRequest(
        makeRow({ client: makeClient({ firstName: "  " }) }),
      );

      expect(prompt).not.toContain("Imie klienta");
      expect(prompt).not.toContain("Kowalska");
    });

    it("omits the employee line when the review has no employee", async () => {
      setupAuthenticatedPro();

      const { prompt } = await callAndGetRequest(makeRow({ employee: null }));

      expect(prompt).not.toContain("Pracownik");
      expect(prompt).toContain("Imie klienta: Anna");
    });

    it("omits the employee line when the employee has no first name", async () => {
      setupAuthenticatedPro();

      const { prompt } = await callAndGetRequest(
        makeRow({ employee: makeEmployee({ firstName: null }) }),
      );

      expect(prompt).not.toContain("Pracownik");
      expect(prompt).not.toContain("Zielinska");
    });

    it("puts a multi-line review text in a single line without adding context lines", async () => {
      setupAuthenticatedPro();

      const plain = await callAndGetRequest(
        makeRow({
          review: { id: VALID_REVIEW_ID, rating: 5, comment: "Bardzo mila obsluga. Polecam wizyte." },
        }),
      );
      mockGenerateText.mockReset();
      const multiline = await callAndGetRequest(
        makeRow({
          review: {
            id: VALID_REVIEW_ID,
            rating: 5,
            comment: "Bardzo mila obsluga.\nPolecam\r\nwizyte.\u{85}Do zobaczenia.\u{2028}Dziekuje.",
          },
        }),
      );

      const commentLines = multiline.prompt
        .split(/\r\n|[\n\r\u{85}\u{2028}\u{2029}]/u)
        .filter((line) => line.includes("Komentarz klienta:"));
      expect(commentLines).toHaveLength(1);
      expect(commentLines[0]).toContain("Bardzo mila obsluga.");
      expect(commentLines[0]).toContain("Dziekuje.");
      expect(multiline.prompt).not.toMatch(/[\r\u{85}\u{2028}\u{2029}]/u);
      expect(multiline.prompt.split("\n")).toHaveLength(plain.prompt.split("\n").length);
    });

    it("cuts a review text longer than the limit to the limit", async () => {
      setupAuthenticatedPro();

      const comment = `${"a".repeat(REVIEW_COMMENT_MAX_LENGTH)}ZNACZNIK_ZA_LIMITEM`;
      const { prompt } = await callAndGetRequest(
        makeRow({ review: { id: VALID_REVIEW_ID, rating: 5, comment } }),
      );

      expect(prompt).not.toContain("ZNACZNIK_ZA_LIMITEM");
      expect(prompt).toContain(`Komentarz klienta: "${"a".repeat(REVIEW_COMMENT_MAX_LENGTH)}"`);
    });

    it("treats a review text made only of whitespace as no comment", async () => {
      setupAuthenticatedPro();

      const { prompt } = await callAndGetRequest(
        makeRow({ review: { id: VALID_REVIEW_ID, rating: 4, comment: " \n\t\u{85} \r\n " } }),
      );

      expect(prompt).toContain("Klient nie pozostawil komentarza (tylko ocena)");
      expect(prompt).not.toContain("Komentarz klienta:");
    });

    it("system prompt never asks for the last name", async () => {
      setupAuthenticatedPro();

      const { system } = await callAndGetRequest(makeRow());

      expect(system).not.toMatch(/nazwisk/i);
    });

    it("system prompt asks to address the client by first name when it is known", async () => {
      setupAuthenticatedPro();

      const { system } = await callAndGetRequest(makeRow());

      expect(system).toContain(ADDRESS_BY_NAME);
      expect(system).not.toContain(ADDRESS_WITHOUT_NAME);
    });

    it("system prompt does not ask for a first name when the review has no client", async () => {
      setupAuthenticatedPro();

      const { system } = await callAndGetRequest(makeRow({ client: null }));

      expect(system).not.toContain(ADDRESS_BY_NAME);
      expect(system).toContain(ADDRESS_WITHOUT_NAME);
      expect(system).toMatch(/nie zgaduj/i);
    });

    it("system prompt does not ask for a first name when the client has none", async () => {
      setupAuthenticatedPro();

      const { system } = await callAndGetRequest(
        makeRow({ client: makeClient({ firstName: " \n " }) }),
      );

      expect(system).not.toContain(ADDRESS_BY_NAME);
      expect(system).toContain(ADDRESS_WITHOUT_NAME);
    });
  });

  describe("database errors", () => {
    function rejectingChain(message: string) {
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "from", "where", "leftJoin", "innerJoin", "limit", "orderBy"]) {
        chain[m] = vi.fn().mockReturnValue(chain);
      }
      chain.then = (_: unknown, reject: (err: Error) => void) => reject(new Error(message));
      return chain;
    }

    it("returns 500 without calling the model when the review lookup fails", async () => {
      setupAuthenticatedPro();
      mockDbSelect.mockReturnValueOnce(rejectingChain("DB connection failed"));

      const { status, body } = await parseResponse(await POST(makeRequest()));

      expect(status).toBe(500);
      expect(typeof body.error).toBe("string");
      expect(mockGenerateText).not.toHaveBeenCalled();
      expect(mockTrackAIUsage).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledTimes(1);
    });

    it("logs the lookup error without review text or client data", async () => {
      setupAuthenticatedPro();
      mockDbSelect.mockReturnValueOnce(rejectingChain("DB connection failed"));

      await POST(makeRequest());

      const logged = JSON.stringify(
        vi.mocked(logger.error).mock.calls,
        (_key, value: unknown) =>
          value instanceof Error ? { name: value.name, message: value.message } : value,
      );
      for (const value of ["Swietna obsluga", "Anna", "Marta", ...FORBIDDEN_VALUES]) {
        expect(logged).not.toContain(value);
      }
    });

    it("returns 500 without calling the model when loading the salon context fails", async () => {
      setupAuthenticatedPro();
      mockDbSelect.mockReturnValueOnce(chainMock([makeRow()]));
      mockGetSalonContext.mockRejectedValueOnce(new Error("DB connection failed"));

      const { status, body } = await parseResponse(await POST(makeRequest()));

      expect(status).toBe(500);
      expect(typeof body.error).toBe("string");
      expect(mockGenerateText).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledTimes(1);
    });
  });
});
