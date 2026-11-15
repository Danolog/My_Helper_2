/**
 * Webhook Stripe — `checkout.session.completed` dla subskrypcji (T3).
 *
 * Webhook potwierdza Checkout subskrypcji tą samą funkcją co
 * `/api/subscriptions/confirm` (`confirmSubscriptionCheckout`), więc plan
 * powstaje także wtedy, gdy użytkownik nie wróci na stronę sukcesu, a kto
 * przyjdzie drugi — dostaje alreadyConfirmed. Salon z metadata podpisanego
 * zdarzenia (tu nie ma sesji użytkownika).
 *
 * Kody HTTP webhooka: 200 (przetworzone albo świadomie pominięte — błędne
 * dane i konflikt logowane do ręcznej obsługi, ponowienie nic by nie
 * zmieniło), 400 (brak/zły podpis), 500 (błąd Stripe/bazy — Stripe ponowi).
 * 401/403/404/409 nie istnieją na poziomie HTTP webhooka: odpowiedniki
 * (inny salon nie dotyczy, brak planu, konflikt) kończą się 200 bez zapisu.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST as stripeWebhook } from "@/app/api/stripe/webhook/route";
import { POST as confirmRoute } from "@/app/api/subscriptions/confirm/route";
import { logger } from "@/lib/logger";

const f = await vi.hoisted(async () =>
  (await import("./subscription-db-fake")).createSubscriptionDbFake()
);

const { mockGetStripe, mockIsConfigured, mockConfirmDeposit } = vi.hoisted(() => ({
  mockGetStripe: vi.fn(),
  mockIsConfigured: vi.fn(),
  mockConfirmDeposit: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: f.db }));
vi.mock("@/lib/stripe", () => ({
  getStripe: (...a: unknown[]) => mockGetStripe(...a),
  isStripeWebhookConfigured: (...a: unknown[]) => mockIsConfigured(...a),
}));
vi.mock("@/lib/deposit-confirmation", () => ({
  confirmDepositPayment: (...a: unknown[]) => mockConfirmDeposit(...a),
}));
vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock("@/lib/auth-middleware", () => ({
  requireAuth: async () => ({ user: { id: "owner-1" } }),
  isAuthError: () => false,
}));
vi.mock("@/lib/get-user-salon", () => ({ getUserSalonId: async () => "salon-1" }));

const PLAN_PRO = { id: "plan-pro", name: "Pro", slug: "pro", priceMonthly: "149.00", isActive: true };
const PERIOD_START = 1783296000;
const PERIOD_END = 1785888000;
const STRIPE_SUB = {
  id: "sub_1",
  items: { data: [{ current_period_start: PERIOD_START, current_period_end: PERIOD_END }] },
};

/** Sesja z webhooka: subskrypcja jako id (zdarzenia nie mają expand). */
function webhookSession(overrides: Record<string, unknown> = {}) {
  return {
    id: "cs_test_123",
    mode: "subscription",
    payment_status: "paid",
    metadata: { salonId: "salon-1", planId: PLAN_PRO.id, planSlug: "pro", userId: "owner-1" },
    customer: "cus_1",
    subscription: "sub_1",
    ...overrides,
  };
}

let constructEvent: ReturnType<typeof vi.fn>;
let retrieveSubscription: ReturnType<typeof vi.fn>;
let retrieveSession: ReturnType<typeof vi.fn>;

function stripeClient() {
  constructEvent = vi.fn();
  retrieveSubscription = vi.fn().mockResolvedValue(STRIPE_SUB);
  retrieveSession = vi.fn();
  mockIsConfigured.mockReturnValue(true);
  mockGetStripe.mockReturnValue({
    webhooks: { constructEvent },
    subscriptions: { retrieve: retrieveSubscription },
    checkout: { sessions: { retrieve: retrieveSession } },
  });
}

async function deliver(object: Record<string, unknown>, type = "checkout.session.completed") {
  constructEvent.mockReturnValue({ id: "evt_1", type, data: { object } });
  const res = await stripeWebhook(
    new Request("http://localhost/api/stripe/webhook", {
      method: "POST",
      headers: { "stripe-signature": "t=1,v1=ok" },
      body: JSON.stringify({}),
    })
  );
  return { status: res.status, body: await res.json() };
}

/** Zapisy bez znaczników czasu zapisu — do porównania confirm vs webhook. */
function writesWithoutClock() {
  return f.committed.map((w) => {
    const { paidAt: _paidAt, ...values } = w.values;
    return { ...w, values };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  f.reset();
  stripeClient();
});

describe("webhook checkout.session.completed — subskrypcja, 200", () => {
  it("potwierdza plan: salon z metadata, okres ze Stripe, płatność z id sesji", async () => {
    f.selects.push([], [PLAN_PRO], []);

    const { status } = await deliver(webhookSession());

    expect(status).toBe(200);
    expect(retrieveSubscription).toHaveBeenCalledWith("sub_1");
    expect(f.committed).toEqual([
      expect.objectContaining({
        table: "salon_subscriptions",
        op: "insert",
        values: expect.objectContaining({
          salonId: "salon-1",
          status: "active",
          stripeSubscriptionId: "sub_1",
          currentPeriodStart: new Date(PERIOD_START * 1000),
          currentPeriodEnd: new Date(PERIOD_END * 1000),
        }),
      }),
      expect.objectContaining({
        table: "subscription_payments",
        values: expect.objectContaining({ salonId: "salon-1", stripePaymentIntentId: "cs_test_123" }),
      }),
    ]);
    expect(mockConfirmDeposit).not.toHaveBeenCalled();
  });

  it("spójność: webhook i strona sukcesu dla tej samej sesji zapisują to samo", async () => {
    const trial = { id: "sub-trial", status: "trialing", stripeSubscriptionId: null };

    f.selects.push([], [PLAN_PRO], [trial]);
    expect((await deliver(webhookSession())).status).toBe(200);
    const viaWebhook = writesWithoutClock();

    f.reset();
    stripeClient();
    retrieveSession.mockResolvedValue(webhookSession());
    f.selects.push([], [PLAN_PRO], [trial]);
    const res = await confirmRoute(
      new Request("http://localhost/api/subscriptions/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: "cs_test_123" }),
      })
    );
    expect(res.status).toBe(200);

    expect(writesWithoutClock()).toEqual(viaWebhook);
    expect(viaWebhook.map((w) => [w.table, w.op])).toEqual([
      ["salon_subscriptions", "update"], // trial przechodzi w active
      ["subscription_payments", "insert"],
    ]);
  });

  it("checkout.session.async_payment_succeeded potwierdza tak samo", async () => {
    f.selects.push([], [PLAN_PRO], []);
    expect((await deliver(webhookSession(), "checkout.session.async_payment_succeeded")).status).toBe(200);
    expect(f.committed).toHaveLength(2);
  });

  it("sesja już potwierdzona przez stronę sukcesu → bez transakcji", async () => {
    f.selects.push([{ id: "pay-1", subscriptionId: "sub-1" }], [{ id: "sub-1" }]);
    expect((await deliver(webhookSession())).status).toBe(200);
    expect(f.state.transactions).toBe(0);
    expect(f.committed).toEqual([]);
  });

  it("wyścig ze stroną sukcesu → alreadyConfirmed, transakcja wycofana, bez duplikatu", async () => {
    f.state.paymentInsertResult = [];
    f.selects.push([], [PLAN_PRO], [], [{ id: "pay-w", subscriptionId: "sub-w" }], [{ id: "sub-w" }]);
    expect((await deliver(webhookSession())).status).toBe(200);
    expect(f.state.rolledBack).toBe(1);
    expect(f.committed).toEqual([]);
  });

  it("nieopłacona (metoda asynchroniczna) → czeka, bez zapytań", async () => {
    expect((await deliver(webhookSession({ payment_status: "unpaid" }))).status).toBe(200);
    expect(retrieveSubscription).not.toHaveBeenCalled();
    expect(f.committed).toEqual([]);
  });

  it("błędne dane (brak salonu) → 200 bez zapisu, zalogowane do ręcznej obsługi", async () => {
    expect((await deliver(webhookSession({ metadata: { planId: PLAN_PRO.id } }))).status).toBe(200);
    expect(f.committed).toEqual([]);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("manual handling"),
      expect.objectContaining({ code: "MISSING_SALON", status: 400 })
    );
  });

  it("brak planu → 200 bez zapisu, zalogowane (404 w confirm)", async () => {
    f.selects.push([], []);
    expect((await deliver(webhookSession())).status).toBe(200);
    expect(f.committed).toEqual([]);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("manual handling"),
      expect.objectContaining({ code: "PLAN_NOT_FOUND", status: 404 })
    );
  });

  it("konflikt z inną opłaconą subskrypcją → 200 bez nadpisania, zalogowane (409 w confirm)", async () => {
    f.selects.push([], [PLAN_PRO], [{ id: "sub-paid", status: "active", stripeSubscriptionId: "sub_OTHER" }]);
    expect((await deliver(webhookSession())).status).toBe(200);
    expect(f.committed).toEqual([]);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("manual handling"),
      expect.objectContaining({ code: "SUBSCRIPTION_CONFLICT", status: 409 })
    );
  });

  it("sesja w trybie payment bez metadata zadatku → pominięta", async () => {
    expect((await deliver(webhookSession({ mode: "payment" }))).status).toBe(200);
    expect(f.committed).toEqual([]);
    expect(mockConfirmDeposit).not.toHaveBeenCalled();
  });
});

describe("webhook checkout.session.completed — subskrypcja, 400/500", () => {
  it("400: brak podpisu — zdarzenie nieprzetworzone", async () => {
    const res = await stripeWebhook(
      new Request("http://localhost/api/stripe/webhook", { method: "POST", body: "{}" })
    );
    expect(res.status).toBe(400);
    expect(f.committed).toEqual([]);
  });

  it("500: Stripe nie oddał subskrypcji → Stripe ponowi zdarzenie", async () => {
    retrieveSubscription.mockRejectedValue(new Error("network"));
    f.selects.push([], [PLAN_PRO]);
    expect((await deliver(webhookSession())).status).toBe(500);
    expect(f.committed).toEqual([]);
  });

  it("500: błąd bazy → transakcja wycofana, Stripe ponowi", async () => {
    f.state.failNextSubscriptionWrite = { code: "08006" };
    f.selects.push([], [PLAN_PRO], []);
    expect((await deliver(webhookSession())).status).toBe(500);
    expect(f.committed).toEqual([]);
  });
});
