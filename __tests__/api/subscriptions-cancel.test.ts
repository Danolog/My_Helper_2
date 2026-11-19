/**
 * POST /api/subscriptions/cancel — anulowanie tylko potwierdzone przez Stripe
 * (T3b; warunek z przeglądu #62 §2b, przed pierwszym płacącym salonem).
 *
 * Przed poprawką trasa przy błędzie Stripe zapisywała lokalnie `canceled`
 * („Continue with local DB update even if Stripe fails”): Stripe dalej
 * pobierał opłaty, a salon tracił plan na zawsze (`canceled` końcowe).
 *
 * Kontrakt:
 * - prawdziwa subskrypcja Stripe: `cancel_at_period_end: true` w Stripe pod
 *   blokadą stripe_sub, potem blokada salonu i zapis `canceled` bez pól
 *   okresu (okres Stripe tylko w logu) — tylko gdy odpowiedź Stripe
 *   potwierdza anulowanie,
 * - błąd Stripe albo brak potwierdzenia → 502, zero zapisów,
 * - Stripe nieskonfigurowany przy prawdziwej subskrypcji → 503, zero zapisów,
 * - bez prawdziwej subskrypcji (null, `sim_*`) → tylko blokada salonu, zapis lokalny,
 * - wiersz zmieniony pod blokadą → 409, zakleszczenie / lock_timeout → 503.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";
import { POST } from "@/app/api/subscriptions/cancel/route";
import { logger } from "@/lib/logger";
import { STRIPE_LOCKED_READ_OPTIONS } from "@/lib/subscription-locks";

const f = await vi.hoisted(async () =>
  (await import("./subscription-db-fake")).createSubscriptionDbFake()
);

const { mockRequireAuth, mockGetUserSalonId, mockGetStripe, mockUpdate } = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
  mockGetUserSalonId: vi.fn(),
  mockGetStripe: vi.fn(),
  mockUpdate: vi.fn(),
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
vi.mock("@/lib/stripe", () => ({
  getStripe: (...a: unknown[]) => mockGetStripe(...a),
}));

const PERIOD_START = 1783296000;
const PERIOD_END = 1785888000;

const ACTIVE = {
  id: "sub-local",
  salonId: "salon-1",
  planId: "plan-pro",
  status: "active",
  stripeSubscriptionId: "sub_1",
  stripeCustomerId: "cus_1",
  trialEndsAt: null,
  currentPeriodStart: new Date("2026-06-01T00:00:00Z"),
  currentPeriodEnd: new Date("2026-07-01T00:00:00Z"),
  canceledAt: null,
  scheduledPlanId: null,
  scheduledChangeAt: null,
};

const STRIPE_CANCELED_AT_PERIOD_END = {
  id: "sub_1",
  status: "active",
  cancel_at_period_end: true,
  items: { data: [{ current_period_start: PERIOD_START, current_period_end: PERIOD_END }] },
};

const subWrites = () => f.committed.filter((w) => w.table === "salon_subscriptions");

async function cancel() {
  const res = await POST();
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

beforeEach(() => {
  vi.clearAllMocks();
  f.reset();
  mockRequireAuth.mockResolvedValue({ user: { id: "user-1" } });
  mockGetUserSalonId.mockResolvedValue("salon-1");
  mockUpdate.mockImplementation(async () => {
    f.log.push("stripe.update");
    return STRIPE_CANCELED_AT_PERIOD_END;
  });
  mockGetStripe.mockReturnValue({ subscriptions: { update: mockUpdate } });
});

describe("POST /api/subscriptions/cancel — prawdziwa subskrypcja Stripe", () => {
  it("200: Stripe potwierdza cancel_at_period_end → canceled bez pól okresu (okres w wierszu bez zmian), kolejność blokad stripe_sub → Stripe → salon", async () => {
    f.selects.push([ACTIVE], [ACTIVE]);

    const { status, body } = await cancel();

    expect(status).toBe(200);
    expect(body).toEqual(expect.objectContaining({ success: true, stripeCanceled: true }));
    expect(body).not.toHaveProperty("stripeError");
    expect(mockUpdate).toHaveBeenCalledWith("sub_1", { cancel_at_period_end: true }, STRIPE_LOCKED_READ_OPTIONS);
    expect(subWrites()).toEqual([
      expect.objectContaining({
        op: "update",
        values: expect.objectContaining({ status: "canceled", canceledAt: expect.any(Date) }),
      }),
    ]);
    // Stripe zwraca okres inny niż zapisany w wierszu — zapis go nie przenosi.
    expect(new Date(PERIOD_END * 1000)).not.toEqual(ACTIVE.currentPeriodEnd);
    expect(subWrites()[0]?.values).not.toHaveProperty("currentPeriodStart");
    expect(subWrites()[0]?.values).not.toHaveProperty("currentPeriodEnd");
    // Odpowiedź nie niesie końca okresu ze Stripe.
    expect((body.subscription as Record<string, unknown>).currentPeriodEnd).not.toBe(
      new Date(PERIOD_END * 1000).toISOString(),
    );
    expect(f.log).toEqual([
      "select",
      "lock_timeout",
      "lock:stripe_sub:sub_1",
      "select",
      "stripe.update",
      "lock:salon:salon-1",
      "update:salon_subscriptions",
      "commit",
    ]);
  });

  it("200: odpowiedź Stripe bez okresu → ten sam zapis canceled bez pól okresu", async () => {
    mockUpdate.mockResolvedValue({ id: "sub_1", status: "active", cancel_at_period_end: true, items: { data: [] } });
    f.selects.push([ACTIVE], [ACTIVE]);

    const { status } = await cancel();

    expect(status).toBe(200);
    expect(subWrites()).toEqual([
      expect.objectContaining({
        op: "update",
        values: expect.objectContaining({ status: "canceled", canceledAt: expect.any(Date) }),
      }),
    ]);
    expect(subWrites()[0]?.values).not.toHaveProperty("currentPeriodStart");
    expect(subWrites()[0]?.values).not.toHaveProperty("currentPeriodEnd");
    expect(logger.info).toHaveBeenCalledWith("Stripe subscription set to cancel at period end", {
      stripeSubscriptionId: "sub_1",
      stripeStatus: "active",
      currentPeriodEnd: null,
    });
  });

  it("log anulowania w Stripe niesie koniec okresu ze Stripe", async () => {
    f.selects.push([ACTIVE], [ACTIVE]);

    const { status } = await cancel();

    expect(status).toBe(200);
    expect(logger.info).toHaveBeenCalledWith("Stripe subscription set to cancel at period end", {
      stripeSubscriptionId: "sub_1",
      stripeStatus: "active",
      currentPeriodEnd: new Date(PERIOD_END * 1000).toISOString(),
    });
  });

  it("200: Stripe już canceled (bez cancel_at_period_end) → lokalne canceled", async () => {
    mockUpdate.mockResolvedValue({ ...STRIPE_CANCELED_AT_PERIOD_END, status: "canceled", cancel_at_period_end: false });
    f.selects.push([ACTIVE], [ACTIVE]);

    const { status } = await cancel();

    expect(status).toBe(200);
    expect(subWrites().map((w) => w.values.status)).toEqual(["canceled"]);
  });

  it("502: błąd Stripe → zero zapisów, bez blokady salonu", async () => {
    mockUpdate.mockRejectedValue(Object.assign(new Error("card_declined: secret detail"), { type: "StripeAPIError" }));
    f.selects.push([ACTIVE], [ACTIVE]);

    const { status, body } = await cancel();

    expect(status).toBe(502);
    expect(body.code).toBe("STRIPE_ERROR");
    expect(JSON.stringify(body)).not.toContain("secret detail");
    expect(f.committed).toEqual([]);
    expect(f.log).not.toContain("lock:salon:salon-1");
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("Stripe subscription cancel failed"),
      expect.objectContaining({ stripeSubscriptionId: "sub_1" })
    );
  });

  it("502: Stripe nie potwierdza (active, cancel_at_period_end=false) → zero zapisów + manual handling", async () => {
    mockUpdate.mockResolvedValue({ ...STRIPE_CANCELED_AT_PERIOD_END, cancel_at_period_end: false });
    f.selects.push([ACTIVE], [ACTIVE]);

    const { status } = await cancel();

    expect(status).toBe(502);
    expect(f.committed).toEqual([]);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("manual handling"), expect.anything());
  });

  it("503: Stripe nieskonfigurowany przy prawdziwej subskrypcji → bez transakcji i bez zapisu", async () => {
    mockGetStripe.mockReturnValue(null);
    f.selects.push([ACTIVE]);

    const { status, body } = await cancel();

    expect(status).toBe(503);
    expect(body.code).toBe("STRIPE_UNAVAILABLE");
    expect(f.state.transactions).toBe(0);
    expect(f.committed).toEqual([]);
  });

  it("409: pod blokadą stripe_sub wiersz już nie jest active (np. webhook deleted) → bez wywołania Stripe i zapisu", async () => {
    f.selects.push([ACTIVE], [{ ...ACTIVE, status: "canceled" }]);

    const { status, body } = await cancel();

    expect(status).toBe(409);
    expect(body.code).toBe("SUBSCRIPTION_CHANGED");
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(f.committed).toEqual([]);
  });

  it.each(["40P01", "55P03"])("503: %s przy blokadzie → LOCK_BUSY, bez wywołania Stripe i zapisu", async (code) => {
    f.state.failNextLock = { code };
    f.selects.push([ACTIVE], [ACTIVE]);

    const { status, body } = await cancel();

    expect(status).toBe(503);
    expect(body.code).toBe("LOCK_BUSY");
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(f.committed).toEqual([]);
  });

  it("500: błąd bazy przy zapisie → transakcja wycofana", async () => {
    f.state.failNextSubscriptionWrite = { code: "XX000" };
    f.selects.push([ACTIVE], [ACTIVE]);

    const { status } = await cancel();

    expect(status).toBe(500);
    expect(f.committed).toEqual([]);
    expect(f.state.rolledBack).toBe(1);
  });
});

describe("POST /api/subscriptions/cancel — bez prawdziwej subskrypcji Stripe", () => {
  it.each([
    ["null", null],
    ["sim_*", "sim_sub_1"],
  ])("stripeSubscriptionId = %s → bez Stripe, blokada salonu, lokalne canceled", async (_n, id) => {
    const row = { ...ACTIVE, stripeSubscriptionId: id };
    f.selects.push([row], [row]);

    const { status, body } = await cancel();

    expect(status).toBe(200);
    expect(body.stripeCanceled).toBe(false);
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(f.log).toEqual(["select", "lock_timeout", "lock:salon:salon-1", "select", "update:salon_subscriptions", "commit"]);
    expect(subWrites()[0]?.values).toEqual(expect.objectContaining({ status: "canceled" }));
    // Bez Stripe okres zostaje zapisany.
    expect(subWrites()[0]?.values).not.toHaveProperty("currentPeriodEnd");
  });

  it("409: pod blokadą salonu wiersz już nie jest active → bez zapisu", async () => {
    const row = { ...ACTIVE, stripeSubscriptionId: null };
    f.selects.push([row], [{ ...row, status: "canceled" }]);

    const { status } = await cancel();

    expect(status).toBe(409);
    expect(f.committed).toEqual([]);
  });
});

describe("POST /api/subscriptions/cancel — wejście", () => {
  it("401 bez sesji", async () => {
    mockRequireAuth.mockResolvedValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
    expect((await cancel()).status).toBe(401);
    expect(f.log).toEqual([]);
  });

  it("404 bez salonu", async () => {
    mockGetUserSalonId.mockResolvedValue(null);
    expect((await cancel()).status).toBe(404);
  });

  it("404 bez aktywnej subskrypcji", async () => {
    f.selects.push([]);
    expect((await cancel()).status).toBe(404);
    expect(f.state.transactions).toBe(0);
  });
});
