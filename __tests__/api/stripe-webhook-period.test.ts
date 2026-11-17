/**
 * Okres rozliczeniowy w handlerach webhooka Stripe (T3, warunek dla 1.1).
 *
 * Nowsze API Stripe nie ma `current_period_*` na poziomie subskrypcji, tylko
 * w `items.data[0]`. Przed poprawką `customer.subscription.updated` czytał
 * wyłącznie poziom subskrypcji i w nowym API zostawiał STARY okres
 * (`canceled` tracił dostęp przed końcem zapłaconego okresu). Odczyt jest
 * teraz w jednym miejscu (`@/lib/stripe-period`), wspólnym z confirm i cancel.
 *
 * Od ostrzeżenia #3 (kolejność zdarzeń) handlery traktują zdarzenie tylko jako
 * sygnał: okres i stan pochodzą z BIEŻĄCEGO odczytu subskrypcji ze Stripe pod
 * blokadą (`stripe.subscriptions.retrieve`), a nie z payloadu zdarzenia ani
 * z faktury (`invoice.period_*` faktury odnowienia to okres poprzedni).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST as stripeWebhook } from "@/app/api/stripe/webhook/route";

const f = await vi.hoisted(async () =>
  (await import("./subscription-db-fake")).createSubscriptionDbFake()
);

const { mockGetStripe, mockIsConfigured, constructEvent } = vi.hoisted(() => ({
  mockGetStripe: vi.fn(),
  mockIsConfigured: vi.fn(),
  constructEvent: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: f.db }));
vi.mock("@/lib/stripe", () => ({
  getStripe: (...a: unknown[]) => mockGetStripe(...a),
  isStripeWebhookConfigured: (...a: unknown[]) => mockIsConfigured(...a),
  getStripeWebhookSecret: () => (mockIsConfigured() ? "mock-webhook-secret" : null),
}));
vi.mock("@/lib/deposit-confirmation", () => ({ confirmDepositPayment: vi.fn() }));
vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const OLD_START = new Date("2026-06-06T00:00:00Z");
const OLD_END = new Date("2026-07-06T00:00:00Z");
const NEW_START = 1783296000; // 2026-07-06T00:00:00Z
const NEW_END = 1785888000; // 2026-08-05T00:00:00Z

const LOCAL_SUB = {
  id: "sub-local",
  salonId: "salon-1",
  planId: "plan-pro",
  status: "active",
  stripeSubscriptionId: "sub_1",
  currentPeriodStart: OLD_START,
  currentPeriodEnd: OLD_END,
  canceledAt: null,
  scheduledPlanId: null,
  scheduledChangeAt: null,
};

async function deliver(type: string, object: Record<string, unknown>) {
  constructEvent.mockReturnValue({ id: "evt_1", type, data: { object } });
  const res = await stripeWebhook(
    new Request("http://localhost/api/stripe/webhook", {
      method: "POST",
      headers: { "stripe-signature": "t=1,v1=ok" },
      body: "{}",
    })
  );
  return res.status;
}

const subUpdate = () =>
  f.committed.find((w) => w.table === "salon_subscriptions" && w.op === "update")?.values;

const retrieveSubscription = vi.fn();

/** Bieżący stan subskrypcji w Stripe (świeży odczyt pod blokadą). */
function stripeSays(sub: Record<string, unknown>) {
  retrieveSubscription.mockResolvedValue({ id: "sub_1", ...sub });
}

beforeEach(() => {
  vi.clearAllMocks();
  f.reset();
  mockIsConfigured.mockReturnValue(true);
  mockGetStripe.mockReturnValue({
    webhooks: { constructEvent },
    subscriptions: { retrieve: retrieveSubscription },
  });
});

describe("customer.subscription.updated — okres", () => {
  it("nowe API: brak current_period_* na subskrypcji → okres z items.data[0], nie stary", async () => {
    f.selects.push([LOCAL_SUB]);
    stripeSays({
      status: "canceled",
      canceled_at: NEW_START,
      cancel_at_period_end: true,
      items: { data: [{ current_period_start: NEW_START, current_period_end: NEW_END }] },
    });
    const status = await deliver("customer.subscription.updated", { id: "sub_1" });
    expect(status).toBe(200);
    expect(subUpdate()).toEqual(
      expect.objectContaining({
        status: "canceled",
        currentPeriodStart: new Date(NEW_START * 1000),
        currentPeriodEnd: new Date(NEW_END * 1000),
      })
    );
  });

  it("starsze API: okres na poziomie subskrypcji nadal działa", async () => {
    f.selects.push([LOCAL_SUB]);
    stripeSays({
      status: "past_due",
      canceled_at: null,
      cancel_at_period_end: false,
      current_period_start: NEW_START,
      current_period_end: NEW_END,
    });
    await deliver("customer.subscription.updated", { id: "sub_1" });
    expect(subUpdate()?.currentPeriodEnd).toEqual(new Date(NEW_END * 1000));
  });

  it("brak okresu w obu miejscach → zostaje zapisany okres (z ostrzeżeniem), status się zmienia", async () => {
    f.selects.push([LOCAL_SUB]);
    stripeSays({ status: "past_due", canceled_at: null, cancel_at_period_end: false });
    await deliver("customer.subscription.updated", { id: "sub_1" });
    expect(subUpdate()).toEqual(
      expect.objectContaining({ status: "past_due", currentPeriodEnd: OLD_END })
    );
  });

  it("trialing ze Stripe: trialEndsAt z trial_end, nie z rejestracji", async () => {
    f.selects.push([{ ...LOCAL_SUB, status: "trialing" }]);
    stripeSays({
      status: "trialing",
      canceled_at: null,
      cancel_at_period_end: false,
      trial_end: NEW_END,
      items: { data: [{ current_period_start: NEW_START, current_period_end: NEW_END }] },
    });
    await deliver("customer.subscription.updated", { id: "sub_1" });
    expect(subUpdate()?.trialEndsAt).toEqual(new Date(NEW_END * 1000));
  });

  it("active: trialEndsAt nietknięte", async () => {
    f.selects.push([LOCAL_SUB]);
    stripeSays({
      status: "active",
      canceled_at: null,
      cancel_at_period_end: false,
      trial_end: NEW_START,
      items: { data: [{ current_period_start: NEW_START, current_period_end: NEW_END }] },
    });
    await deliver("customer.subscription.updated", { id: "sub_1" });
    expect(subUpdate()).not.toHaveProperty("trialEndsAt");
  });
});

describe("invoice.paid (odnowienie) — okres", () => {
  const invoice = {
    id: "in_1",
    amount_paid: 14900,
    billing_reason: "subscription_cycle",
    subscription: "sub_1",
    payment_intent: "pi_1",
    // Okres faktury odnowienia = okres POPRZEDNI — nie jest używany.
    period_start: Math.floor(OLD_START.getTime() / 1000),
    period_end: Math.floor(OLD_END.getTime() / 1000),
  };

  it("okres z bieżącej subskrypcji Stripe (items.data[0]), nie z invoice.period_*", async () => {
    f.selects.push([LOCAL_SUB], [{ id: "plan-pro", priceMonthly: "149.00" }]);
    stripeSays({
      status: "active",
      items: { data: [{ current_period_start: NEW_START, current_period_end: NEW_END }] },
    });
    expect(await deliver("invoice.paid", invoice)).toBe(200);
    expect(subUpdate()).toEqual(
      expect.objectContaining({
        status: "active",
        currentPeriodStart: new Date(NEW_START * 1000),
        currentPeriodEnd: new Date(NEW_END * 1000),
      })
    );
  });

  it("Stripe bez okresu → zostaje zapisany okres, płatność i tak zapisana", async () => {
    f.selects.push([LOCAL_SUB], [{ id: "plan-pro", priceMonthly: "149.00" }]);
    stripeSays({ status: "active" });
    expect(await deliver("invoice.paid", invoice)).toBe(200);
    expect(subUpdate()?.currentPeriodEnd).toEqual(OLD_END);
    expect(f.committed.some((w) => w.table === "subscription_payments")).toBe(true);
  });
});
