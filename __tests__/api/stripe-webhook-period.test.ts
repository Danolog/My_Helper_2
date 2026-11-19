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
 * sygnał: stan pochodzi z BIEŻĄCEGO odczytu subskrypcji ze Stripe pod
 * blokadą (`stripe.subscriptions.retrieve`), a nie z payloadu zdarzenia.
 *
 * `invoice.paid` zapisuje okres OPŁACONY: z linii faktury (`lines.data[].period`),
 * nie z bieżącej subskrypcji Stripe i nie z `invoice.period_*` (faktura
 * odnowienia ma tam okres poprzedni). Zapis w SQL (`greatest` / `case`) nigdy
 * nie cofa okresu — wyrażenia sprawdzane po wyrenderowaniu przez PgDialect.
 */
import { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST as stripeWebhook } from "@/app/api/stripe/webhook/route";
import { logger } from "@/lib/logger";

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
  // Faktura bez linii z okresem — okres w wierszu bez zmian.
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
  // Bieżący okres subskrypcji w Stripe — inny niż opłacony, nie jest używany.
  const STRIPE_START = 1788480000; // 2026-09-04T00:00:00Z
  const STRIPE_END = 1791072000; // 2026-10-04T00:00:00Z
  const PLAN_LINE = { period: { start: NEW_START, end: NEW_END } };
  const ONE_TIME_LINE = { period: { start: NEW_START, end: NEW_START } };
  const paidInvoice = (lines: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
    ...invoice,
    lines,
    ...extra,
  });

  const PAID_END = new Date(NEW_END * 1000).toISOString();
  const PAID_START = new Date(NEW_START * 1000).toISOString();
  const PLAN = { id: "plan-pro", priceMonthly: "149.00" };
  const CANCELED_SUB = { ...LOCAL_SUB, status: "canceled", canceledAt: OLD_START };

  const dialect = new PgDialect();
  const render = (v: unknown) => {
    expect(v).toBeInstanceOf(SQL);
    return dialect.sqlToQuery(v as SQL);
  };
  const PERIOD_FIELDS = ["currentPeriodStart", "currentPeriodEnd"];
  const payment = () => f.committed.find((w) => w.table === "subscription_payments");
  const subUpdates = () =>
    f.committed.filter((w) => w.table === "salon_subscriptions" && w.op === "update");

  /** Okres opłacony zapisany wyrażeniami SQL: `greatest` i `case` ze ścisłym `>`. */
  function expectPaidPeriodWritten(set: Record<string, unknown> | undefined) {
    const end = render(set?.currentPeriodEnd);
    expect(end.sql).toMatch(/^greatest\(\S*"current_period_end", \$1::timestamp\)$/);
    expect(end.params).toEqual([PAID_END]);

    const start = render(set?.currentPeriodStart);
    expect(start.sql).toMatch(
      /^case when \S*"current_period_end" is null or \$1::timestamp > \S*"current_period_end" then \$2::timestamp else \S*"current_period_start" end$/
    );
    expect(start.sql).not.toContain(">=");
    expect(start.params).toEqual([PAID_END, PAID_START]);
  }

  function expectNoPeriodWarn(linesHasMore: boolean) {
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("without a billing period"), {
      eventId: "evt_1",
      subscriptionId: "sub-local",
      linesHasMore,
    });
  }

  it("okres z linii opłaconej faktury — nie z bieżącej subskrypcji Stripe i nie z invoice.period_*", async () => {
    f.selects.push([LOCAL_SUB], [PLAN]);
    stripeSays({
      status: "active",
      items: { data: [{ current_period_start: STRIPE_START, current_period_end: STRIPE_END }] },
    });
    expect(await deliver("invoice.paid", paidInvoice({ data: [PLAN_LINE], has_more: false }))).toBe(200);
    const set = subUpdate();
    expect(set).toEqual(expect.objectContaining({ status: "active", canceledAt: null }));
    expectPaidPeriodWritten(set);
    expect(logger.warn).not.toHaveBeenCalled();
    expect(payment()?.values).toEqual(expect.objectContaining({ stripePaymentIntentId: "pi_1", status: "succeeded" }));
  });

  it("faktura bez linii → status zapisany, okres bez zmian (bez pól okresu w set), ostrzeżenie, płatność zapisana", async () => {
    f.selects.push([LOCAL_SUB], [PLAN]);
    stripeSays({
      status: "past_due",
      items: { data: [{ current_period_start: STRIPE_START, current_period_end: STRIPE_END }] },
    });
    expect(await deliver("invoice.paid", invoice)).toBe(200);
    const set = subUpdate();
    expect(set).toEqual(expect.objectContaining({ status: "past_due" }));
    for (const k of PERIOD_FIELDS) expect(set).not.toHaveProperty(k);
    expectNoPeriodWarn(false);
    expect(payment()?.values).toEqual(expect.objectContaining({ stripePaymentIntentId: "pi_1", status: "succeeded" }));
  });

  it("wiersz końcowy (canceled potwierdzone) + faktura z okresem → update wyłącznie pól okresu", async () => {
    f.selects.push([CANCELED_SUB], [PLAN]);
    stripeSays({ status: "canceled", canceled_at: NEW_START, cancel_at_period_end: true });
    expect(await deliver("invoice.paid", paidInvoice({ data: [PLAN_LINE] }))).toBe(200);
    const updates = subUpdates();
    expect(updates).toHaveLength(1);
    const set = updates[0]!.values;
    expect(Object.keys(set).sort()).toEqual(PERIOD_FIELDS.slice().sort());
    for (const k of ["status", "canceledAt", "planId", "updatedAt"]) expect(set).not.toHaveProperty(k);
    expectPaidPeriodWritten(set);
    expect(payment()).toBeDefined();
  });

  it("wiersz końcowy + faktura bez linii → brak update wiersza, płatność zapisana, ostrzeżenie", async () => {
    f.selects.push([CANCELED_SUB], [PLAN]);
    stripeSays({ status: "canceled", canceled_at: NEW_START, cancel_at_period_end: true });
    expect(await deliver("invoice.paid", invoice)).toBe(200);
    expect(subUpdates()).toEqual([]);
    expect(payment()?.values).toEqual(expect.objectContaining({ stripePaymentIntentId: "pi_1" }));
    expectNoPeriodWarn(false);
  });

  it("niepełna lista linii (has_more) + linia planu → okres zapisany + ostrzeżenie", async () => {
    f.selects.push([LOCAL_SUB], [PLAN]);
    stripeSays({ status: "active" });
    expect(await deliver("invoice.paid", paidInvoice({ data: [PLAN_LINE], has_more: true }))).toBe(200);
    expectPaidPeriodWritten(subUpdate());
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("incomplete"), {
      eventId: "evt_1",
      subscriptionId: "sub-local",
      linesHasMore: true,
    });
  });

  it("niepełna lista linii (has_more) bez linii z pełnym okresem → bez pól okresu + ostrzeżenie", async () => {
    f.selects.push([LOCAL_SUB], [PLAN]);
    stripeSays({ status: "active" });
    expect(await deliver("invoice.paid", paidInvoice({ data: [ONE_TIME_LINE], has_more: true }))).toBe(200);
    const set = subUpdate();
    expect(set).toEqual(expect.objectContaining({ status: "active" }));
    for (const k of PERIOD_FIELDS) expect(set).not.toHaveProperty(k);
    expectNoPeriodWarn(true);
  });

  it("faktura za 0 zł z linią planu → okres zapisany, płatność zapisana", async () => {
    f.selects.push([LOCAL_SUB], [PLAN]);
    stripeSays({ status: "active" });
    expect(await deliver("invoice.paid", paidInvoice({ data: [PLAN_LINE] }, { amount_paid: 0 }))).toBe(200);
    expectPaidPeriodWritten(subUpdate());
    expect(payment()?.values).toEqual(expect.objectContaining({ stripePaymentIntentId: "pi_1", status: "succeeded" }));
  });

  it("sama pozycja jednorazowa (start = end) → bez pól okresu + ostrzeżenie", async () => {
    f.selects.push([LOCAL_SUB], [PLAN]);
    stripeSays({ status: "active" });
    expect(await deliver("invoice.paid", paidInvoice({ data: [ONE_TIME_LINE] }))).toBe(200);
    const set = subUpdate();
    for (const k of PERIOD_FIELDS) expect(set).not.toHaveProperty(k);
    expectNoPeriodWarn(false);
  });
});
