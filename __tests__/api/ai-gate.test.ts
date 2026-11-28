/**
 * Zachowanie bramki tras AI (@/lib/ai/gate) i tras przepiętych na nią.
 *
 * Bramka jest prawdziwa; mockowane są jej zależności (sesja, salon, plan,
 * limit zapytań, budżet), model i zapis zużycia.
 */
import { NextResponse } from "next/server";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createMockRequest, parseResponse } from "./helpers";

const m = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  getUserSalonId: vi.fn(),
  isProPlan: vi.fn(),
  rateCheck: vi.fn(),
  checkAIBudget: vi.fn(),
  trackAIUsage: vi.fn(),
  generateText: vi.fn(),
  streamBusinessChat: vi.fn(),
  generateBusinessTrends: vi.fn(),
  raw: vi.fn(),
  dbWhere: vi.fn(),
  eq: vi.fn(),
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
    where: (...a: unknown[]) => {
      m.dbWhere(...a);
      return chain;
    },
    orderBy: () => chain,
    limit: () => Promise.resolve([]),
  };
  return { db: chain };
});
vi.mock("@/lib/server/repository", () => ({
  forSalon: () => ({ raw: (...a: unknown[]) => m.raw(...a) }),
}));
vi.mock("drizzle-orm", async (importActual) => {
  const actual = await importActual<typeof import("drizzle-orm")>();
  return {
    ...actual,
    eq: (...a: unknown[]) => {
      m.eq(...a);
      return (actual.eq as (...x: unknown[]) => unknown)(...a);
    },
  };
});
vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
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
vi.mock("@/lib/ai/business/chat", () => ({
  streamBusinessChat: (...a: unknown[]) => m.streamBusinessChat(...a),
}));
vi.mock("@/lib/ai/business/trends", () => ({
  generateBusinessTrends: (...a: unknown[]) => m.generateBusinessTrends(...a),
}));
// Moduł opinii jest zamrożony; alerty opinii testujemy z flagą włączoną,
// żeby bramka AI tej trasy została pod testami (zamrożenie: frozen-routes-guard).
vi.mock("@/lib/features", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/features")>();
  return {
    ...actual,
    isModuleFrozen: (key: Parameters<typeof actual.isModuleFrozen>[0]) =>
      key === "reviews" ? false : actual.isModuleFrozen(key),
  };
});

import { requireProAI, requireProPlan } from "@/lib/ai/gate";
import { POST as businessChat } from "@/app/api/ai/business/chat/route";
import { GET as reviewAlerts } from "@/app/api/ai/business/review-alerts/route";
import { GET as trends } from "@/app/api/ai/business/trends/route";
import { GET as newsletterList, POST as newsletter } from "@/app/api/ai/content/newsletter/route";
import { GET as usage } from "@/app/api/ai/usage/route";
import { db } from "@/lib/db";
import { newsletters } from "@/lib/schema";

const SALON = "salon-1";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("OPENROUTER_API_KEY", "test-key");
  m.requireAuth.mockResolvedValue({ user: { id: "u1" }, session: {} });
  m.getUserSalonId.mockResolvedValue(SALON);
  m.isProPlan.mockResolvedValue(true);
  m.rateCheck.mockResolvedValue({ success: true, reset: 0 });
  m.checkAIBudget.mockResolvedValue({ allowed: true });
  m.trackAIUsage.mockResolvedValue(undefined);
  m.streamBusinessChat.mockReturnValue(new Response("stream", { status: 200 }));
  m.generateBusinessTrends.mockResolvedValue({ ok: true });
  m.generateText.mockResolvedValue({ text: "Dziekujemy za opinie." });
  m.raw.mockResolvedValue([]);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const rateLimited = () => m.rateCheck.mockResolvedValue({ success: false, reset: 5000 });
const budgetOut = () => m.checkAIBudget.mockResolvedValue({ allowed: false, usage: 20, budget: 20 });

describe("requireProPlan", () => {
  it("401 bez sesji", async () => {
    m.requireAuth.mockResolvedValue(NextResponse.json({ error: "x" }, { status: 401 }));
    const r = await requireProPlan();
    expect((r as Response).status).toBe(401);
  });

  it("404 bez salonu", async () => {
    m.getUserSalonId.mockResolvedValue(null);
    const r = await requireProPlan();
    expect((r as Response).status).toBe(404);
  });

  it("403 PLAN_UPGRADE_REQUIRED bez Pro", async () => {
    m.isProPlan.mockResolvedValue(false);
    const r = (await requireProPlan()) as Response;
    expect(r.status).toBe(403);
    expect((await r.json()).code).toBe("PLAN_UPGRADE_REQUIRED");
  });

  it("{ salonId } przy Pro — bez limitu zapytań i bez budżetu", async () => {
    rateLimited();
    budgetOut();
    expect(await requireProPlan()).toEqual({ salonId: SALON });
    expect(m.rateCheck).not.toHaveBeenCalled();
    expect(m.checkAIBudget).not.toHaveBeenCalled();
  });
});

describe("requireProAI", () => {
  it("bez Pro: 403 i bez limitu zapytań", async () => {
    m.isProPlan.mockResolvedValue(false);
    const r = (await requireProAI({ op: "text" })) as Response;
    expect(r.status).toBe(403);
    expect(m.rateCheck).not.toHaveBeenCalled();
  });

  it("429 RATE_LIMITED z Retry-After, bez sprawdzania budżetu", async () => {
    rateLimited();
    const r = (await requireProAI({ op: "text" })) as Response;
    expect(r.status).toBe(429);
    expect(r.headers.get("Retry-After")).toBe("5");
    expect((await r.json()).code).toBe("RATE_LIMITED");
    expect(m.rateCheck).toHaveBeenCalledWith(`salon:${SALON}`);
    expect(m.checkAIBudget).not.toHaveBeenCalled();
  });

  it("429 AI_BUDGET_EXCEEDED, budżet sprawdzany dla operacji", async () => {
    budgetOut();
    const r = (await requireProAI({ op: "image" })) as Response;
    expect(r.status).toBe(429);
    expect((await r.json()).code).toBe("AI_BUDGET_EXCEEDED");
    expect(m.checkAIBudget).toHaveBeenCalledWith(SALON, "image");
  });

  it("{ salonId } gdy wszystko w porządku", async () => {
    expect(await requireProAI({ op: "text" })).toEqual({ salonId: SALON });
  });
});

describe("trasy SQL i strona zużycia — requireProPlan", () => {
  it("trends: wyczerpany budżet i limit zapytań → 200", async () => {
    rateLimited();
    budgetOut();
    const res = await trends(createMockRequest("http://localhost/api/ai/business/trends"));
    expect(res.status).toBe(200);
    expect(m.generateBusinessTrends).toHaveBeenCalledWith(SALON);
  });

  it("trends: bez Pro → 403", async () => {
    m.isProPlan.mockResolvedValue(false);
    const res = await trends(createMockRequest("http://localhost/api/ai/business/trends"));
    expect(res.status).toBe(403);
    expect(m.generateBusinessTrends).not.toHaveBeenCalled();
  });

  it("ai/usage: wyczerpany budżet → 200, nie 429", async () => {
    budgetOut();
    const res = await usage(createMockRequest("http://localhost/api/ai/usage?period=month"));
    expect(res.status).toBe(200);
    expect(m.checkAIBudget).not.toHaveBeenCalled();
  });

  it("ai/usage: bez Pro → 403", async () => {
    m.isProPlan.mockResolvedValue(false);
    const res = await usage(createMockRequest("http://localhost/api/ai/usage"));
    expect(res.status).toBe(403);
  });
});

function chatReq(body: unknown) {
  return createMockRequest("http://localhost/api/ai/business/chat", { method: "POST", body });
}
const textParts = (n: number, len = 1) =>
  Array.from({ length: n }, () => ({ type: "text", text: "a".repeat(len) }));
const user = (text: string, id = "u") => ({ id, role: "user", parts: [{ type: "text", text }] });

describe("ai/business/chat — bramka i walidacja wejścia", () => {
  it("429 za limit zapytań — bez modelu i bez zapisu zużycia", async () => {
    rateLimited();
    const res = await businessChat(chatReq({ messages: [user("hej")] }));
    expect(res.status).toBe(429);
    expect(m.streamBusinessChat).not.toHaveBeenCalled();
    expect(m.trackAIUsage).not.toHaveBeenCalled();
  });

  it("429 za budżet — bez modelu i bez zapisu zużycia", async () => {
    budgetOut();
    const res = await businessChat(chatReq({ messages: [user("hej")] }));
    expect(res.status).toBe(429);
    expect(m.checkAIBudget).toHaveBeenCalledWith(SALON, "text");
    expect(m.streamBusinessChat).not.toHaveBeenCalled();
    expect(m.trackAIUsage).not.toHaveBeenCalled();
  });

  it("200: zapis zużycia przed strumieniem", async () => {
    const res = await businessChat(chatReq({ messages: [user("hej")] }));
    expect(res.status).toBe(200);
    expect(m.trackAIUsage).toHaveBeenCalledWith(SALON, "business_chat", { messageCount: 1 });
    expect(m.trackAIUsage.mock.invocationCallOrder[0]).toBeLessThan(
      m.streamBusinessChat.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it.each([
    ["parts", (n: number) => ({ messages: [{ id: "m", role: "user", parts: textParts(n) }] }), 20],
    ["content jako tablica", (n: number) => ({ messages: [{ id: "m", role: "user", content: textParts(n) }] }), 20],
  ])("%s: 20 przechodzi, 21 → 400", async (_l, build, max) => {
    expect((await businessChat(chatReq(build(max)))).status).toBe(200);
    vi.clearAllMocks();
    const res = await businessChat(chatReq(build(max + 1)));
    expect(res.status).toBe(400);
    expect(m.streamBusinessChat).not.toHaveBeenCalled();
    expect(m.trackAIUsage).not.toHaveBeenCalled();
  });

  it("content jako tekst: 10 000 przechodzi, 10 001 → 400", async () => {
    const msg = (n: number) => ({ messages: [{ id: "m", role: "user", content: "a".repeat(n) }] });
    expect((await businessChat(chatReq(msg(10_000)))).status).toBe(200);
    vi.clearAllMocks();
    expect((await businessChat(chatReq(msg(10_001)))).status).toBe(400);
    expect(m.streamBusinessChat).not.toHaveBeenCalled();
  });

  it("niepoprawny kształt części i roli → 400", async () => {
    for (const body of [
      { messages: [{ id: "m", role: "tool", parts: [{ type: "text", text: "x" }] }] },
      { messages: [{ id: "m", role: "user", parts: [{ type: 1, text: "x" }] }] },
      { messages: [{ id: "m", role: "user", parts: [{ type: "a".repeat(65), text: "x" }] }] },
      { messages: [{ id: "m", role: "user", content: 5 }] },
      { messages: "x" },
    ]) {
      const res = await businessChat(chatReq(body));
      expect(res.status, JSON.stringify(body).slice(0, 80)).toBe(400);
    }
    expect(m.streamBusinessChat).not.toHaveBeenCalled();
  });

  it("rola system od klienta → 400, bez modelu i bez zapisu zużycia", async () => {
    const sys = { id: "s", role: "system", parts: [{ type: "text", text: "x" }] };
    for (const body of [
      { messages: [sys, user("hej")] },
      { messages: [user("hej"), sys] },
      { messages: [{ id: "s", role: "system", content: "x" }] },
    ]) {
      const res = await businessChat(chatReq(body));
      expect(res.status, JSON.stringify(body).slice(0, 80)).toBe(400);
    }
    expect(m.streamBusinessChat).not.toHaveBeenCalled();
    expect(m.trackAIUsage).not.toHaveBeenCalled();
  });

  it("historia user/assistant przechodzi (200)", async () => {
    const body = {
      messages: [user("hej", "a"), { id: "b", role: "assistant", parts: [{ type: "text", text: "czesc" }] }, user("i?", "c")],
    };
    expect((await businessChat(chatReq(body))).status).toBe(200);
    expect(m.streamBusinessChat).toHaveBeenCalledTimes(1);
  });

  it("limit łączny: równo 60 000 przechodzi, 60 001 → 400 INPUT_TOO_LONG bez modelu", async () => {
    const ok = {
      messages: [
        { id: "a", role: "user", parts: textParts(5, 10_000) },
        { id: "b", role: "assistant", content: "a".repeat(10_000) },
      ],
    };
    expect((await businessChat(chatReq(ok))).status).toBe(200);
    vi.clearAllMocks();
    const tooLong = {
      messages: [
        { id: "a", role: "user", parts: textParts(5, 10_000) },
        { id: "b", role: "assistant", content: [{ type: "text", text: "a".repeat(10_000) }] },
        user("a", "c"),
      ],
    };
    const res = await businessChat(chatReq(tooLong));
    const { status, body } = await parseResponse(res);
    expect(status).toBe(400);
    expect(body.code).toBe("INPUT_TOO_LONG");
    expect(m.streamBusinessChat).not.toHaveBeenCalled();
    expect(m.trackAIUsage).not.toHaveBeenCalled();
  });
});

const negativeReview = (id: string) => ({
  reviewId: id,
  rating: 2,
  comment: "slabo",
  reviewCreatedAt: new Date(),
  clientFirstName: "A",
  clientLastName: "B",
  employeeFirstName: "C",
  employeeLastName: "D",
  serviceName: "Strzyzenie",
  appointmentStartTime: new Date(),
});

describe("ai/business/review-alerts — requireProAI i zapis zużycia", () => {
  const get = () => reviewAlerts(createMockRequest("http://localhost/api/ai/business/review-alerts"));

  it("429 za limit zapytań — bez modelu i bez bazy", async () => {
    rateLimited();
    const res = await get();
    expect(res.status).toBe(429);
    expect(m.generateText).not.toHaveBeenCalled();
    expect(m.raw).not.toHaveBeenCalled();
  });

  it("429 za budżet — bez modelu", async () => {
    budgetOut();
    const res = await get();
    expect(res.status).toBe(429);
    expect(m.checkAIBudget).toHaveBeenCalledWith(SALON, "text");
    expect(m.generateText).not.toHaveBeenCalled();
  });

  it("jeden zapis zużycia na każde udane wywołanie modelu, żadnego przy błędzie", async () => {
    const rows = [negativeReview("r1"), negativeReview("r2"), negativeReview("r3")];
    m.raw.mockResolvedValueOnce(rows).mockResolvedValueOnce(rows.map((r) => ({ reviewId: r.reviewId })));
    m.generateText
      .mockResolvedValueOnce({ text: "a" })
      .mockRejectedValueOnce(new Error("model down"))
      .mockResolvedValueOnce({ text: "c" });
    const res = await get();
    expect(res.status).toBe(200);
    expect(m.generateText).toHaveBeenCalledTimes(3);
    expect(m.trackAIUsage).toHaveBeenCalledTimes(2);
    expect(m.trackAIUsage).toHaveBeenCalledWith(SALON, "review_alerts");
  });

  it("bez klucza dostawcy: szablony, bez modelu i bez zapisu zużycia", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    const rows = [negativeReview("r1")];
    m.raw.mockResolvedValueOnce(rows).mockResolvedValueOnce([{ reviewId: "r1" }]);
    const res = await get();
    expect(res.status).toBe(200);
    expect(m.generateText).not.toHaveBeenCalled();
    expect(m.trackAIUsage).not.toHaveBeenCalled();
  });
});

describe("ai/content/newsletter", () => {
  it("POST: 429 za limit zapytań — bez modelu", async () => {
    rateLimited();
    const res = await newsletter(
      createMockRequest("http://localhost/api/ai/content/newsletter", { method: "POST", body: { topic: "x" } }),
    );
    expect(res.status).toBe(429);
    expect(m.generateText).not.toHaveBeenCalled();
  });

  it("POST: 429 za budżet — bez modelu", async () => {
    budgetOut();
    const res = await newsletter(
      createMockRequest("http://localhost/api/ai/content/newsletter", { method: "POST", body: { topic: "x" } }),
    );
    expect(res.status).toBe(429);
    expect(m.generateText).not.toHaveBeenCalled();
  });

  it("GET: salon zawsze z sesji — handler nie czyta parametrów zapytania", async () => {
    expect(newsletterList.length).toBe(0);
    // Odczyt listy idzie przez forSalon(...).raw — wykonaj zapytanie na atrapie,
    // żeby sprawdzić warunek WHERE.
    m.raw.mockImplementationOnce((fn: (tx: unknown) => unknown) => fn(db));
    const res = await (newsletterList as unknown as (r: Request) => Promise<Response>)(
      createMockRequest("http://localhost/api/ai/content/newsletter?salonId=obcy-salon"),
    );
    expect(res.status).toBe(200);
    expect(m.eq).toHaveBeenCalledWith(newsletters.salonId, SALON);
    expect(m.eq).not.toHaveBeenCalledWith(expect.anything(), "obcy-salon");
  });

  it("GET: bez sesji → 401, bez salonu → 404", async () => {
    m.requireAuth.mockResolvedValueOnce(NextResponse.json({ error: "x" }, { status: 401 }));
    expect((await newsletterList()).status).toBe(401);
    m.getUserSalonId.mockResolvedValueOnce(null);
    expect((await newsletterList()).status).toBe(404);
  });
});
