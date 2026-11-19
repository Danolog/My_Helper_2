/**
 * Treść odpowiedzi 500 tras trendów i newslettera.
 *
 * Odpowiedź ma stałą treść bez tekstu złapanego wyjątku; szczegóły błędu
 * trafiają wyłącznie do logu. Odpowiedź 400 walidacji nadal zwraca błędy pól.
 *
 * Bramka jest prawdziwa; mockowane są jej zależności (sesja, salon, plan,
 * limit zapytań, budżet), baza, model i logger.
 */
import { NextResponse } from "next/server";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GET as trends } from "@/app/api/ai/business/trends/route";
import { POST as newsletter } from "@/app/api/ai/content/newsletter/route";
import { createMockRequest } from "./helpers";

const m = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  getUserSalonId: vi.fn(),
  isProPlan: vi.fn(),
  rateCheck: vi.fn(),
  checkAIBudget: vi.fn(),
  trackAIUsage: vi.fn(),
  generateText: vi.fn(),
  generateBusinessTrends: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock("@/lib/auth-middleware", () => ({
  requireAuth: (...a: unknown[]) => m.requireAuth(...a),
  isAuthError: (r: unknown) => r instanceof NextResponse,
}));
vi.mock("@/lib/get-user-salon", () => ({
  getUserSalonId: (...a: unknown[]) => m.getUserSalonId(...a),
}));
vi.mock("@/lib/subscription", () => ({
  isProPlan: (...a: unknown[]) => m.isProPlan(...a),
}));
vi.mock("@/lib/rate-limit", () => ({
  aiRateLimit: { checkAsync: (...a: unknown[]) => m.rateCheck(...a) },
}));
vi.mock("@/lib/ai/usage-limits", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/ai/usage-limits")>()),
  checkAIBudget: (...a: unknown[]) => m.checkAIBudget(...a),
}));
vi.mock("@/lib/db", () => {
  const chain = {
    select: () => chain,
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: () => Promise.resolve([]),
    then: (resolve: (rows: unknown[]) => unknown) => resolve([]),
  };
  return { db: chain };
});
vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: (...a: unknown[]) => m.loggerError(...a),
  },
}));
vi.mock("@/lib/ai/openrouter", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/ai/openrouter")>()),
  trackAIUsage: (...a: unknown[]) => m.trackAIUsage(...a),
}));
vi.mock("ai", () => ({
  generateText: (...a: unknown[]) => m.generateText(...a),
}));
vi.mock("@openrouter/ai-sdk-provider", () => ({
  createOpenRouter: () => (id: string) => ({ id }),
}));
vi.mock("@/lib/ai/business/trends", () => ({
  generateBusinessTrends: (...a: unknown[]) => m.generateBusinessTrends(...a),
}));

const SALON = "salon-1";
const MARKER =
  "znacznik-bledu jan.kowalski@example.com SELECT * FROM clients WHERE salon_id = 'salon-1'";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("OPENROUTER_API_KEY", "test-key");
  m.requireAuth.mockResolvedValue({ user: { id: "u1" }, session: {} });
  m.getUserSalonId.mockResolvedValue(SALON);
  m.isProPlan.mockResolvedValue(true);
  m.rateCheck.mockResolvedValue({ success: true, reset: 0 });
  m.checkAIBudget.mockResolvedValue({ allowed: true });
  m.trackAIUsage.mockResolvedValue(undefined);
  m.generateBusinessTrends.mockResolvedValue({ ok: true });
  m.generateText.mockResolvedValue({ text: "TEMAT: Nowosci\n\nTresc newslettera." });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const getTrends = () => trends(createMockRequest("http://localhost/api/ai/business/trends"));
const postNewsletter = (body: unknown) =>
  newsletter(
    createMockRequest("http://localhost/api/ai/content/newsletter", { method: "POST", body }),
  );

describe("ai/business/trends — odpowiedź 500", () => {
  it("wyjątek Error → 500 ze stałą treścią, tekst błędu tylko w logu", async () => {
    const thrown = new Error(MARKER);
    m.generateBusinessTrends.mockRejectedValue(thrown);
    const res = await getTrends();
    expect(res.status).toBe(500);
    const raw = await res.text();
    expect(JSON.parse(raw)).toEqual({ error: "Failed to compute business trends" });
    expect(raw).not.toContain("znacznik-bledu");
    expect(raw).not.toContain("example.com");
    expect(m.loggerError).toHaveBeenCalledWith("[AI Business Trends] Error", { error: thrown });
  });

  it("rzucona wartość niebędąca Error → ta sama stała treść", async () => {
    m.generateBusinessTrends.mockRejectedValue(MARKER);
    const res = await getTrends();
    expect(res.status).toBe(500);
    const raw = await res.text();
    expect(JSON.parse(raw)).toEqual({ error: "Failed to compute business trends" });
    expect(raw).not.toContain("znacznik-bledu");
  });

  it("ścieżka szczęśliwa → 200 z wynikiem bez zmian", async () => {
    const result = { trends: [{ metric: "revenue", change: 12 }] };
    m.generateBusinessTrends.mockResolvedValue(result);
    const res = await getTrends();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(result);
    expect(m.generateBusinessTrends).toHaveBeenCalledWith(SALON);
  });
});

describe("ai/content/newsletter POST — odpowiedź 500 i 400", () => {
  it("wyjątek w generowaniu → 500 ze stałą treścią, tekst błędu tylko w logu", async () => {
    const thrown = new Error(MARKER);
    m.generateText.mockRejectedValue(thrown);
    const res = await postNewsletter({ topic: "Nowosci jesienne" });
    expect(res.status).toBe(500);
    const raw = await res.text();
    expect(JSON.parse(raw)).toEqual({
      error: "Blad podczas generowania newslettera. Sprobuj ponownie.",
    });
    expect(raw).not.toContain("znacznik-bledu");
    expect(raw).not.toContain("example.com");
    expect(m.generateText).toHaveBeenCalledTimes(1);
    expect(m.loggerError).toHaveBeenCalledWith("[AI Newsletter] Error generating newsletter", {
      error: thrown,
    });
  });

  it("błąd walidacji ciała → 400 nadal z błędami pól w details", async () => {
    const res = await postNewsletter({ topic: "" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; details: Record<string, unknown> };
    expect(body.error).toBe("Invalid request");
    expect(body.details).toBeTypeOf("object");
    expect(body.details).not.toBeNull();
    expect(Object.keys(body.details)).toContain("topic");
    expect(m.generateText).not.toHaveBeenCalled();
  });
});
