/**
 * withApiHandler — wspólny preambuł tras API (Faza 3).
 *
 * Kontrakt: kolejność kroków rate-limit → auth → walidacja body → handler,
 * identyczne statusy/kształty jak dotychczasowy ręczny preambuł tras
 * (429 + Retry-After, 401/403 z requireAuth, 400 { error, details },
 * 500 { success:false, error } z logowaniem).
 */
import { NextResponse } from "next/server";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";

const mockRequireAuth = vi.fn();
const mockRequireCronSecret = vi.fn();

vi.mock("@/lib/auth-middleware", () => ({
  requireAuth: (...a: unknown[]) => mockRequireAuth(...a),
  requireCronSecret: (...a: unknown[]) => mockRequireCronSecret(...a),
  isAuthError: (r: unknown) => r instanceof NextResponse,
}));

const mockLoggerError = vi.fn();
vi.mock("@/lib/logger", () => ({
  logger: {
    error: (...a: unknown[]) => mockLoggerError(...a),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

import { withApiHandler } from "@/lib/api-handler";
import { createRateLimit } from "@/lib/rate-limit";

const AUTH_OK = { session: { user: { id: "user-1" } }, user: { id: "user-1" } };

function jsonRequest(body?: unknown): Request {
  return new Request("http://localhost/api/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

describe("withApiHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue(AUTH_OK);
    mockRequireCronSecret.mockResolvedValue(null);
  });

  it("wywołuje handler z auth i zwraca jego odpowiedź", async () => {
    const route = withApiHandler({ auth: "user" }, async ({ auth }) =>
      NextResponse.json({ success: true, userId: auth?.user.id })
    );
    const res = await route(jsonRequest());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.userId).toBe("user-1");
  });

  it("zwraca błąd requireAuth bez wywołania handlera (401 pass-through)", async () => {
    mockRequireAuth.mockResolvedValue(
      NextResponse.json({ success: false, error: "Wymagane logowanie" }, { status: 401 })
    );
    const handler = vi.fn();
    const route = withApiHandler({ auth: "user" }, handler);
    const res = await route(jsonRequest());
    expect(res.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });

  it("auth: cron — 401 z requireCronSecret zatrzymuje handler", async () => {
    mockRequireCronSecret.mockResolvedValue(
      NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
    );
    const handler = vi.fn();
    const route = withApiHandler({ auth: "cron" }, handler);
    const res = await route(jsonRequest());
    expect(res.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
    expect(mockRequireAuth).not.toHaveBeenCalled();
  });

  it("auth: none — nie woła requireAuth ani requireCronSecret", async () => {
    const route = withApiHandler({ auth: "none" }, async ({ auth }) =>
      NextResponse.json({ success: true, auth })
    );
    const res = await route(jsonRequest());
    expect(res.status).toBe(200);
    expect(mockRequireAuth).not.toHaveBeenCalled();
    expect(mockRequireCronSecret).not.toHaveBeenCalled();
  });

  it("rate limit: po wyczerpaniu limitu zwraca 429 z Retry-After PRZED auth", async () => {
    const limiter = createRateLimit({ interval: 60_000, limit: 1, prefix: "test-wah" });
    const route = withApiHandler({ auth: "user", rateLimit: limiter }, async () =>
      NextResponse.json({ success: true })
    );
    const first = await route(jsonRequest());
    expect(first.status).toBe(200);

    mockRequireAuth.mockClear();
    const second = await route(jsonRequest());
    expect(second.status).toBe(429);
    expect(Number(second.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(mockRequireAuth).not.toHaveBeenCalled();
  });

  it("schema: niepoprawne body -> 400 { error, details }, handler nie woła się", async () => {
    const handler = vi.fn();
    const route = withApiHandler(
      { auth: "user", schema: z.object({ name: z.string().min(2) }) },
      handler
    );
    const res = await route(jsonRequest({ name: "x" }));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toBe("Validation failed");
    expect(body.details).toBeDefined();
    expect(handler).not.toHaveBeenCalled();
  });

  it("schema: poprawne body trafia do handlera po walidacji", async () => {
    const route = withApiHandler(
      { auth: "user", schema: z.object({ name: z.string().min(2) }) },
      async ({ body }) => NextResponse.json({ success: true, name: body.name })
    );
    const res = await route(jsonRequest({ name: "Strzyzenie" }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.name).toBe("Strzyzenie");
  });

  it("rozwiązuje params trasy dynamicznej (Next 16: Promise)", async () => {
    const route = withApiHandler({ auth: "user" }, async ({ params }) =>
      NextResponse.json({ success: true, id: params.id })
    );
    const res = await route(jsonRequest(), { params: Promise.resolve({ id: "abc-123" }) });
    const body = await res.json();
    expect(body.id).toBe("abc-123");
  });

  it("wyjątek w handlerze -> 500 z errorMessage i logiem", async () => {
    const route = withApiHandler(
      { auth: "user", logLabel: "[Test API]", errorMessage: "Failed to test" },
      async () => {
        throw new Error("boom");
      }
    );
    const res = await route(jsonRequest());
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(body).toEqual({ success: false, error: "Failed to test" });
    expect(mockLoggerError).toHaveBeenCalledWith(
      "[Test API] unhandled error",
      expect.objectContaining({ error: expect.any(Error) })
    );
  });

  it("niepoprawny JSON przy zadeklarowanym schema -> 500 (przechwycony), nie crash", async () => {
    const route = withApiHandler(
      { auth: "user", schema: z.object({ a: z.string() }) },
      async () => NextResponse.json({ success: true })
    );
    const res = await route(
      new Request("http://localhost/api/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{nie-json",
      })
    );
    expect(res.status).toBe(500);
  });
});
