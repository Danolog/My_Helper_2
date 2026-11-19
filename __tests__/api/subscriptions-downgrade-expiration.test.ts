/**
 * `subscriptions/downgrade` (POST, DELETE) — odczyt „active” i zapis pod
 * blokadą salonu; moduł `subscriptions/expiration-warning/route` — eksporty
 * (brak POST, GET jest funkcją).
 *
 * Bez blokady zapis trasy downgrade mógł się przepleść z webhookiem, który w tym czasie
 * zmienia stan tej subskrypcji (utrata zapisu / decyzja na nieaktualnym
 * „active”). Ta trasa nie woła Stripe, więc bierze TYLKO blokadę salonu —
 * zgodnie z regułą kolejności (`subscription-locks.ts`).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";
import { DELETE as cancelDowngrade, POST as downgrade } from "@/app/api/subscriptions/downgrade/route";
import * as expirationWarningRoute from "@/app/api/subscriptions/expiration-warning/route";
import { createMockRequest } from "./helpers";

const f = await vi.hoisted(async () =>
  (await import("./subscription-db-fake")).createSubscriptionDbFake()
);
const { mockRequireAuth, mockGetUserSalonId } = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
  mockGetUserSalonId: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: f.db }));
vi.mock("@/lib/auth-middleware", () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
  isAuthError: (r: unknown) => r instanceof NextResponse,
}));
vi.mock("@/lib/get-user-salon", () => ({
  getUserSalonId: (...args: unknown[]) => mockGetUserSalonId(...args),
}));
vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const PLAN_PRO = { id: "plan-pro", name: "Pro", slug: "pro", priceMonthly: "149.00", isActive: true };
const PLAN_BASIC = { id: "plan-basic", name: "Basic", slug: "basic", priceMonthly: "49.00", isActive: true };
const PERIOD_END = new Date(Date.now() + 20 * 24 * 3600 * 1000);
const ACTIVE = {
  id: "sub-local",
  salonId: "salon-1",
  planId: PLAN_PRO.id,
  status: "active",
  stripeSubscriptionId: "sub_1",
  currentPeriodEnd: PERIOD_END,
  scheduledPlanId: null,
  scheduledChangeAt: null,
};
const LOCKED_PREFIX = ["lock_timeout", "lock:salon:salon-1"];
const subWrites = () => f.committed.filter((w) => w.table === "salon_subscriptions");

async function call(handler: (r: Request) => Promise<Response>, method: string, body?: unknown) {
  const res = await handler(
    createMockRequest("http://localhost:3000/api/subscriptions/x", { method, body }) as unknown as Request
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

beforeEach(() => {
  vi.clearAllMocks();
  f.reset();
  mockRequireAuth.mockResolvedValue({ user: { id: "user-1" } });
  mockGetUserSalonId.mockResolvedValue("salon-1");
});

describe("POST /api/subscriptions/downgrade — pod blokadą salonu", () => {
  it("200: Pro → Basic na koniec okresu; odczyt i zapis po blokadzie salonu, w jednej transakcji", async () => {
    f.selects.push([{ subscription: ACTIVE, plan: PLAN_PRO }], [PLAN_BASIC]);

    const { status, body } = await call(downgrade, "POST", { targetPlanSlug: "basic" });

    expect(status).toBe(200);
    expect(body).toEqual(expect.objectContaining({ success: true, currentPlan: "pro", targetPlan: "basic" }));
    expect(f.log).toEqual([...LOCKED_PREFIX, "select", "select", "update:salon_subscriptions", "commit"]);
    expect(subWrites()[0]?.values).toEqual({ scheduledPlanId: PLAN_BASIC.id, scheduledChangeAt: PERIOD_END });
  });

  it.each([
    ["404 bez aktywnej subskrypcji", [[]], "pro", 404],
    ["409 ten sam plan", [[{ subscription: ACTIVE, plan: PLAN_BASIC }]], "basic", 409],
    ["404 plan docelowy nie istnieje / nieaktywny", [[{ subscription: ACTIVE, plan: PLAN_PRO }], []], "basic", 404],
    ["400 to nie jest obniżenie", [[{ subscription: ACTIVE, plan: PLAN_BASIC }], [PLAN_PRO]], "pro", 400],
  ] as const)("%s → zero zapisów (decyzja pod blokadą)", async (_n, selects, target, expected) => {
    f.selects.push(...(selects as unknown as unknown[][]));

    const { status } = await call(downgrade, "POST", { targetPlanSlug: target });

    expect(status).toBe(expected);
    expect(f.committed).toEqual([]);
    expect(f.log.slice(0, 2)).toEqual(LOCKED_PREFIX);
  });

  it.each(["40P01", "55P03"])("503: %s przy blokadzie → LOCK_BUSY, bez odczytu i zapisu", async (code) => {
    f.state.failNextLock = { code };
    f.selects.push([{ subscription: ACTIVE, plan: PLAN_PRO }], [PLAN_BASIC]);

    const { status, body } = await call(downgrade, "POST", { targetPlanSlug: "basic" });

    expect(status).toBe(503);
    expect(body.code).toBe("LOCK_BUSY");
    expect(f.log).not.toContain("select");
    expect(f.committed).toEqual([]);
  });

  it("500: błąd bazy przy zapisie → rollback", async () => {
    f.state.failNextSubscriptionWrite = { code: "XX000" };
    f.selects.push([{ subscription: ACTIVE, plan: PLAN_PRO }], [PLAN_BASIC]);

    const { status } = await call(downgrade, "POST", { targetPlanSlug: "basic" });

    expect(status).toBe(500);
    expect(f.committed).toEqual([]);
    expect(f.log.at(-1)).toBe("rollback");
  });

  it("400 przy niepoprawnym body — bez transakcji", async () => {
    const { status } = await call(downgrade, "POST", { targetPlanSlug: 42 });
    expect(status).toBe(400);
    expect(f.state.transactions).toBe(0);
  });

  it("401 bez sesji, 404 bez salonu", async () => {
    mockRequireAuth.mockResolvedValueOnce(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
    expect((await call(downgrade, "POST", { targetPlanSlug: "basic" })).status).toBe(401);
    mockGetUserSalonId.mockResolvedValueOnce(null);
    expect((await call(downgrade, "POST", { targetPlanSlug: "basic" })).status).toBe(404);
    expect(f.state.transactions).toBe(0);
  });
});

describe("DELETE /api/subscriptions/downgrade — pod blokadą salonu", () => {
  it("200: czyści zaplanowane obniżenie po blokadzie salonu", async () => {
    f.selects.push([{ ...ACTIVE, scheduledPlanId: PLAN_BASIC.id, scheduledChangeAt: PERIOD_END }]);

    const res = await cancelDowngrade();

    expect(res.status).toBe(200);
    expect(f.log).toEqual([...LOCKED_PREFIX, "select", "update:salon_subscriptions", "commit"]);
    expect(subWrites()[0]?.values).toEqual({ scheduledPlanId: null, scheduledChangeAt: null });
  });

  it("404: brak zaplanowanego obniżenia → bez zapisu", async () => {
    f.selects.push([ACTIVE]);
    expect((await cancelDowngrade()).status).toBe(404);
    expect(f.committed).toEqual([]);
  });

  it("503: 55P03 przy blokadzie → LOCK_BUSY", async () => {
    f.state.failNextLock = { code: "55P03" };
    expect((await cancelDowngrade()).status).toBe(503);
    expect(f.committed).toEqual([]);
  });
});

describe("moduł expiration-warning/route — eksporty", () => {
  it("nie eksportuje POST, a GET jest funkcją", () => {
    const m: Record<string, unknown> = expirationWarningRoute;
    expect(m.POST).toBeUndefined();
    expect(typeof m.GET).toBe("function");
  });
});
