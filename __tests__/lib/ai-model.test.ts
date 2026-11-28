// @vitest-environment node
/**
 * getChatModel() — jedyne miejsce wyboru modelu czatu (Vertex AI, lokalizacja `eu`).
 *
 * Bez wywołań na żywo: `fetch` podmieniony na rejestrator, a klient ADC
 * biblioteki uwierzytelnienia Google (ta sama kopia, której używa SDK) zwraca
 * stały token. Każdy adres spoza Vertex AI rzuca błąd, a HOME wskazuje pusty
 * katalog, więc prawdziwe poświadczenia z maszyny nie mają jak się włączyć.
 *
 * Mutacje kontrolne: `low` → `minimal` (czerwony test ciała żądania);
 * lokalizacja `eu` → `global` (czerwony adres); lokalizacja ze zmiennej
 * środowiskowej (czerwony test `GOOGLE_VERTEX_LOCATION=global` i strażnik
 * manifestu); usunięcie odmowy przy `GOOGLE_APPLICATION_CREDENTIALS`
 * (czerwone testy odmowy); komunikat wyjątku w ciele odpowiedzi (czerwone
 * testy ciała); drugi import SDK pod `src/` (czerwony test statyczny);
 * 401 usunięte ze statusów „niedostępny” (czerwony test 401); usunięte
 * rozpoznawanie błędu gaxios po symbolu (czerwony test GaxiosError); wzorzec
 * projektu dopuszcza `?` (czerwona próbka ze znakiem zapytania).
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { APICallError, RetryError, generateText } from "ai";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AIResponseBlockedError,
  AIResponseTruncatedError,
  AIUnavailableError,
  AI_ERROR_MESSAGES,
  CHAT_MODEL_ID,
  CHAT_PROVIDER_OPTIONS,
  aiErrorResponse,
  assertUsableFinish,
  chatCallOptions,
  getChatModel,
} from "@/lib/ai/model";
import { logger } from "@/lib/logger";

// Podnoszone przez Vitest nad importy: model.ts dostaje atrapę loggera.
vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const PROJECT = "test-project";
const EXPECTED_URL = `https://aiplatform.eu.rep.googleapis.com/v1/projects/${PROJECT}/locations/eu/publishers/google/models/${CHAT_MODEL_ID}:generateContent`;

// Biblioteka uwierzytelnienia rozwiązana z miejsca SDK: ta sama instancja modułu,
// którą SDK ładuje (pnpm nie wystawia jej do korzenia node_modules).
const requireHere = createRequire(import.meta.url);
const requireFromVertex = createRequire(requireHere.resolve("@ai-sdk/google-vertex"));
const { GoogleAuth } = requireFromVertex("google-auth-library") as {
  GoogleAuth: { prototype: { getClient: (...args: unknown[]) => Promise<unknown> } };
};

type RecordedCall = { url: string; init: RequestInit };
let calls: RecordedCall[] = [];
let nextResponse: () => Response = () => okResponse();
let getClientSpy: ReturnType<typeof vi.spyOn>;
const emptyHome = mkdtempSync(join(tmpdir(), "ai-model-home-"));

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function okResponse(finishReason = "STOP"): Response {
  return jsonResponse(200, {
    candidates: [
      { content: { role: "model", parts: [{ text: "Odpowiedź testowa" }] }, finishReason },
    ],
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 3, totalTokenCount: 13 },
  });
}

function googleError(status: number, googleStatus: string, message: string): Response {
  return jsonResponse(status, { error: { code: status, message, status: googleStatus } });
}

async function callModel() {
  return generateText({
    model: getChatModel(),
    ...chatCallOptions(),
    prompt: "Ile wizyt było w zeszłym tygodniu?",
    maxRetries: 0,
  });
}

/** Błąd rzucony przez wywołanie modelu (test pada, gdy wywołanie się uda). */
async function callModelError(): Promise<unknown> {
  try {
    await callModel();
  } catch (error) {
    return error;
  }
  throw new Error("wywołanie modelu miało się nie udać");
}

beforeEach(() => {
  calls = [];
  nextResponse = () => okResponse();
  vi.stubEnv("HOME", emptyHome);
  vi.stubEnv("METADATA_SERVER_DETECTION", "none");
  vi.stubEnv("GOOGLE_VERTEX_PROJECT", PROJECT);
  vi.stubEnv("GOOGLE_VERTEX_LOCATION", undefined);
  vi.stubEnv("GOOGLE_APPLICATION_CREDENTIALS", undefined);
  vi.stubEnv("google_application_credentials", undefined);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (!url.startsWith("https://aiplatform.eu.rep.googleapis.com/")) {
        throw new Error(`sieć zablokowana w testach: ${url}`);
      }
      calls.push({ url, init });
      return nextResponse();
    }),
  );
  getClientSpy = vi
    .spyOn(GoogleAuth.prototype, "getClient")
    .mockResolvedValue({ getAccessToken: async () => ({ token: "test-token" }) });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.mocked(logger.warn).mockClear();
});

afterAll(() => {
  rmSync(emptyHome, { recursive: true, force: true });
});

describe("getChatModel — adres, model, uwierzytelnienie", () => {
  it("woła Vertex AI w lokalizacji eu, model gemini-3.8-flash, token z ADC", async () => {
    const result = await callModel();

    expect(result.text).toBe("Odpowiedź testowa");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(EXPECTED_URL);
    expect(calls[0]!.url).toContain("/projects/test-project/locations/eu/");
    const headers = new Headers(calls[0]!.init.headers);
    expect(headers.get("authorization")).toBe("Bearer test-token");
    expect(getClientSpy).toHaveBeenCalled();
  });

  it("ciało żądania: thinkingLevel low, bez myśli w odpowiedzi, bez temperature/topP", async () => {
    await callModel();

    const body = JSON.parse(String(calls[0]!.init.body)) as {
      generationConfig?: Record<string, unknown> & {
        thinkingConfig?: Record<string, unknown>;
      };
    };
    expect(body.generationConfig?.thinkingConfig).toEqual({
      thinkingLevel: "low",
      includeThoughts: false,
    });
    expect(body.generationConfig).not.toHaveProperty("temperature");
    expect(body.generationConfig).not.toHaveProperty("topP");
    expect(body.generationConfig?.thinkingConfig).not.toHaveProperty("thinkingBudget");
  });

  it("GOOGLE_VERTEX_LOCATION=global nie zmienia lokalizacji (eu na stałe w kodzie)", async () => {
    vi.stubEnv("GOOGLE_VERTEX_LOCATION", "global");

    await callModel();

    expect(calls[0]!.url).toBe(EXPECTED_URL);
    expect(calls[0]!.url).not.toContain("global");
  });

  it("chatCallOptions zwraca świeżą kopię (wywołanie nie zmienia stałej)", () => {
    const first = chatCallOptions();
    (first.providerOptions.google as { thinkingConfig: { thinkingLevel: string } })
      .thinkingConfig.thinkingLevel = "high";

    expect(CHAT_PROVIDER_OPTIONS.google.thinkingConfig.thinkingLevel).toBe("low");
    expect(chatCallOptions().providerOptions).toEqual(CHAT_PROVIDER_OPTIONS);
  });
});

describe("getChatModel — odmowa przed siecią", () => {
  it.each([
    ["nieustawiony", undefined, "missing_project"],
    ["pusty napis (pusta zmienna repo w workflow)", "", "missing_project"],
    ["z ukośnikiem", "test-project/locations/global", "invalid_project"],
    ["ze znakiem zapytania", "test-project?x", "invalid_project"],
    ["z wielkimi literami", "Test-Project", "invalid_project"],
    ["za krótki", "abc", "invalid_project"],
  ])("projekt %s → AIUnavailableError, zero fetch", (_label, value, reason) => {
    vi.stubEnv("GOOGLE_VERTEX_PROJECT", value);

    let thrown: unknown;
    try {
      getChatModel();
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AIUnavailableError);
    expect((thrown as AIUnavailableError).reason).toBe(reason);
    expect((thrown as AIUnavailableError).code).toBe("AI_UNAVAILABLE");
    if (value) expect((thrown as Error).message).not.toContain(value);
    expect(fetch).not.toHaveBeenCalled();
    expect(getClientSpy).not.toHaveBeenCalled();
  });

  it.each(["GOOGLE_APPLICATION_CREDENTIALS", "google_application_credentials"])(
    "ustawione %s → odmowa (klucz w pliku), zero fetch, zero ADC",
    (name) => {
      vi.stubEnv(name, "/tmp/key.json");

      expect(() => getChatModel()).toThrow(AIUnavailableError);
      try {
        getChatModel();
      } catch (error) {
        expect((error as AIUnavailableError).reason).toBe("key_file_credentials");
      }
      expect(fetch).not.toHaveBeenCalled();
      expect(getClientSpy).not.toHaveBeenCalled();
    },
  );
});

describe("aiErrorResponse — błędy dostawcy", () => {
  async function bodyOf(response: Response) {
    const text = await response.text();
    return { text, json: JSON.parse(text) as { error: string; code: string } };
  }

  /** Log błędu bez komunikatu wyjątku i bez nazwy projektu. */
  function expectSafeLog(forbidden: string[]) {
    expect(logger.warn).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(vi.mocked(logger.warn).mock.calls[0]);
    for (const text of forbidden) expect(logged).not.toContain(text);
  }

  it("429 dostawcy → 503 AI_PROVIDER_BUSY z Retry-After", async () => {
    nextResponse = () => googleError(429, "RESOURCE_EXHAUSTED", "Quota exceeded for test-project");

    const response = aiErrorResponse(await callModelError(), { feature: "chat", salonId: "salon-1" });
    const { text, json } = await bodyOf(response);

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("60");
    expect(json).toEqual({ error: AI_ERROR_MESSAGES.AI_PROVIDER_BUSY, code: "AI_PROVIDER_BUSY" });
    expect(text).not.toContain("Quota");
    expect(text).not.toContain(PROJECT);
    expectSafeLog(["Quota", PROJECT]);
    expect(vi.mocked(logger.warn).mock.calls[0]![1]).toMatchObject({
      feature: "chat",
      salonId: "salon-1",
      providerStatus: 429,
      providerErrorStatus: "RESOURCE_EXHAUSTED",
    });
  });

  it("403 dostawcy (brak roli IAM) → 503 AI_UNAVAILABLE, ciało bez tekstu wyjątku", async () => {
    nextResponse = () =>
      googleError(403, "PERMISSION_DENIED", "Permission denied on resource project test-project.");

    const response = aiErrorResponse(await callModelError());
    const { text, json } = await bodyOf(response);

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBeNull();
    expect(json).toEqual({ error: AI_ERROR_MESSAGES.AI_UNAVAILABLE, code: "AI_UNAVAILABLE" });
    expect(text).not.toContain("Permission denied");
    expect(text).not.toContain(PROJECT);
    expectSafeLog(["Permission denied", PROJECT]);
    expect(vi.mocked(logger.warn).mock.calls[0]![1]).toMatchObject({
      providerStatus: 403,
      providerErrorStatus: "PERMISSION_DENIED",
    });
  });

  it("401 dostawcy (token odrzucony) → 503 AI_UNAVAILABLE, ciało bez tekstu wyjątku", async () => {
    nextResponse = () =>
      googleError(401, "UNAUTHENTICATED", "Request had invalid authentication credentials.");

    const response = aiErrorResponse(await callModelError());
    const { text, json } = await bodyOf(response);

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBeNull();
    expect(json).toEqual({ error: AI_ERROR_MESSAGES.AI_UNAVAILABLE, code: "AI_UNAVAILABLE" });
    expect(text).not.toContain("invalid authentication");
    expectSafeLog(["invalid authentication"]);
    expect(vi.mocked(logger.warn).mock.calls[0]![1]).toMatchObject({
      providerStatus: 401,
      providerErrorStatus: "UNAUTHENTICATED",
    });
  });

  it("404 dostawcy (model niedostępny w lokalizacji) → 503 AI_UNAVAILABLE", async () => {
    nextResponse = () => googleError(404, "NOT_FOUND", "Publisher model was not found");

    const response = aiErrorResponse(await callModelError());

    expect(response.status).toBe(503);
    expect((await bodyOf(response)).json.code).toBe("AI_UNAVAILABLE");
  });

  it("500 dostawcy → 502 AI_PROVIDER_ERROR", async () => {
    nextResponse = () => googleError(500, "INTERNAL", "Internal error encountered.");

    const response = aiErrorResponse(await callModelError());
    const { text, json } = await bodyOf(response);

    expect(response.status).toBe(502);
    expect(json).toEqual({ error: AI_ERROR_MESSAGES.AI_PROVIDER_ERROR, code: "AI_PROVIDER_ERROR" });
    expect(text).not.toContain("Internal error");
  });

  it("błąd ADC z zamockowanej biblioteki uwierzytelnienia → 503 AI_UNAVAILABLE, ciało bez tekstu wyjątku", async () => {
    getClientSpy.mockRejectedValue(
      new Error("Could not load the default credentials. Browse to https://cloud.google.com/docs/authentication"),
    );

    const error = await callModelError();
    const response = aiErrorResponse(error);
    const { text, json } = await bodyOf(response);

    expect(calls).toHaveLength(0);
    expect(response.status).toBe(503);
    expect(json).toEqual({ error: AI_ERROR_MESSAGES.AI_UNAVAILABLE, code: "AI_UNAVAILABLE" });
    expect(text).not.toContain("credentials");
    expectSafeLog(["credentials", "cloud.google.com"]);
  });

  it("GaxiosError z biblioteki uwierzytelnienia (np. token z serwera metadanych) → 503 AI_UNAVAILABLE", async () => {
    // gaxios oznacza swoje błędy właściwością pod symbolem z globalnego rejestru
    // (`Symbol.for("gaxios-gaxios-error")`, wartość: wersja paczki). Komunikat
    // celowo bez żadnego z rozpoznawanych początków: rozstrzyga tylko symbol.
    const gaxiosError = Object.assign(
      new Error("Unsuccessful response status code. Request failed with status code 403"),
      { [Symbol.for("gaxios-gaxios-error")]: "7.1.4" },
    );
    gaxiosError.name = "GaxiosError";
    getClientSpy.mockRejectedValue(gaxiosError);

    const error = await callModelError();
    const response = aiErrorResponse(error);
    const { text, json } = await bodyOf(response);

    expect(calls).toHaveLength(0);
    expect(response.status).toBe(503);
    expect(json).toEqual({ error: AI_ERROR_MESSAGES.AI_UNAVAILABLE, code: "AI_UNAVAILABLE" });
    expect(text).not.toContain("status code");
    expectSafeLog(["Unsuccessful", "status code"]);
    expect(vi.mocked(logger.warn).mock.calls[0]![1]).toMatchObject({ errorName: "GaxiosError" });
  });

  it("błąd sieci → 502 AI_PROVIDER_ERROR (nie „niedostępny”)", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError("fetch failed"));

    const response = aiErrorResponse(await callModelError());

    expect(response.status).toBe(502);
    expect((await bodyOf(response)).json.code).toBe("AI_PROVIDER_ERROR");
  });

  it("RetryError po ponowieniach oceniany po ostatnim błędzie (429 → AI_PROVIDER_BUSY)", async () => {
    const last = new APICallError({
      message: "Quota exceeded",
      url: EXPECTED_URL,
      requestBodyValues: {},
      statusCode: 429,
      isRetryable: true,
    });
    const error = new RetryError({
      message: "Failed after 3 attempts",
      reason: "maxRetriesExceeded",
      errors: [new Error("pierwszy"), last],
    });

    const response = aiErrorResponse(error);

    expect(response.status).toBe(503);
    expect((await bodyOf(response)).json.code).toBe("AI_PROVIDER_BUSY");
  });

  it("AIUnavailableError z getChatModel → 503 AI_UNAVAILABLE, powód w logu", async () => {
    vi.stubEnv("GOOGLE_VERTEX_PROJECT", "");

    let error: unknown;
    try {
      getChatModel();
    } catch (e) {
      error = e;
    }
    const response = aiErrorResponse(error);

    expect(response.status).toBe(503);
    expect((await bodyOf(response)).json.code).toBe("AI_UNAVAILABLE");
    expect(vi.mocked(logger.warn).mock.calls[0]![1]).toMatchObject({ reason: "missing_project" });
  });
});

describe("powód zakończenia", () => {
  it("filtr treści (finishReason content-filter, bez wyjątku) → 422 AI_RESPONSE_BLOCKED", async () => {
    nextResponse = () => okResponse("SAFETY");

    const result = await callModel();
    expect(result.finishReason).toBe("content-filter");

    let error: unknown;
    try {
      assertUsableFinish(result.finishReason);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(AIResponseBlockedError);
    const response = aiErrorResponse(error);
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      error: AI_ERROR_MESSAGES.AI_RESPONSE_BLOCKED,
      code: "AI_RESPONSE_BLOCKED",
    });
  });

  it("ucięcie przez limit długości: błąd tylko, gdy trasa oczekuje JSON (→ 502)", async () => {
    nextResponse = () => okResponse("MAX_TOKENS");

    const result = await callModel();
    expect(result.finishReason).toBe("length");

    expect(() => assertUsableFinish(result.finishReason)).not.toThrow();
    let error: unknown;
    try {
      assertUsableFinish(result.finishReason, { expectJson: true });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(AIResponseTruncatedError);
    expect(aiErrorResponse(error).status).toBe(502);
  });

  it("zwykłe zakończenie nie rzuca", () => {
    expect(() => assertUsableFinish("stop", { expectJson: true })).not.toThrow();
  });
});

describe("strażnik statyczny: jedno miejsce wyboru modelu", () => {
  const ROOT = process.cwd();
  const MODEL_FILE = "src/lib/ai/model.ts";

  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) return walk(full);
      return /\.(m|c)?[jt]sx?$/.test(name) ? [full] : [];
    });
  }

  const FILES = walk(join(ROOT, "src")).map((file) => ({
    path: relative(ROOT, file).split(sep).join("/"),
    text: readFileSync(file, "utf8"),
  }));

  it("kontrola: skaner widzi pliki i model.ts", () => {
    expect(FILES.length).toBeGreaterThan(100);
    expect(FILES.some((f) => f.path === MODEL_FILE)).toBe(true);
  });

  it("tylko model.ts importuje @ai-sdk/google-vertex", () => {
    const importers = FILES.filter((f) => /["'`]@ai-sdk\/google-vertex["'`/]/.test(f.text)).map(
      (f) => f.path,
    );
    expect(importers).toEqual([MODEL_FILE]);
  });

  it("identyfikator modelu tylko w model.ts", () => {
    const hits = FILES.filter((f) => f.text.includes(CHAT_MODEL_ID)).map((f) => f.path);
    expect(hits).toEqual([MODEL_FILE]);
  });

  it("żaden plik nie ma lokalizacji global ani hosta Vertex spoza eu", () => {
    const global = FILES.filter((f) => f.text.includes("locations/global")).map((f) => f.path);
    expect(global).toEqual([]);
    const otherHosts = FILES.flatMap((f) =>
      [...f.text.matchAll(/[a-z0-9.-]{0,40}aiplatform[a-z0-9.-]{0,40}/g)]
        .map((m) => m[0])
        .filter((host) => host !== "aiplatform.eu.rep.googleapis.com")
        .map((host) => `${f.path}: ${host}`),
    );
    expect(otherHosts).toEqual([]);
  });

  it("model.ts nie ustawia temperature, topP ani thinkingBudget (kod bez komentarzy)", () => {
    const text = FILES.find((f) => f.path === MODEL_FILE)!.text;
    const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");
    expect(code).not.toMatch(/\b(temperature|topP|thinkingBudget)\b/);
    expect(code).not.toContain("credentials:");
    expect(code).not.toContain("keyFile");
  });
});
