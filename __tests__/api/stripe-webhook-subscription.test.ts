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
import { STRIPE_LOCKED_READ_OPTIONS } from "@/lib/subscription-locks";

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
  getStripeWebhookSecret: () => (mockIsConfigured() ? "mock-webhook-secret" : null),
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
  status: "active",
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
    expect(retrieveSubscription).toHaveBeenCalledWith("sub_1", {}, STRIPE_LOCKED_READ_OPTIONS);
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

  it("N1: 500 z błędem zapytania z danymi → w logu tylko nazwa, kod i id zdarzenia (bez message/stack/parametrów)", async () => {
    const pii = ["Anna Nowak", "+48123456789", "anna@test.pl"];
    retrieveSubscription.mockRejectedValue(
      Object.assign(
        new Error(`Failed query: insert into "appointments" values ($1, $2, $3)\nparams: ${pii.join(",")}`),
        { cause: { code: "23505", detail: "Key (guest_email)=(anna@test.pl) already exists." } }
      )
    );
    f.selects.push([], [PLAN_PRO]);

    expect((await deliver(webhookSession())).status).toBe(500);

    // confirm opakowuje błąd odczytu Stripe w nowy Error (bez cause) — kodu nie ma
    expect(logger.error).toHaveBeenCalledWith("Stripe webhook processing failed", {
      errorName: "Error",
      eventId: "evt_1",
      eventType: "checkout.session.completed",
    });
    // Wewnętrzne logi `{ error }` redaguje prawdziwy logger (N3, #67) — tu sprawdzamy catch webhooka.
    const logged = JSON.stringify(
      vi.mocked(logger.error).mock.calls.filter(([msg]) => msg === "Stripe webhook processing failed")
    );
    for (const value of pii) expect(logged).not.toContain(value);
    expect(logged).not.toContain("Failed query");
  });

  it("N1: 500 z błędem bazy z kodem → kod Postgresa w logu catch webhooka", async () => {
    f.state.failNextSubscriptionWrite = { code: "08006" };
    f.selects.push([], [PLAN_PRO], []);

    expect((await deliver(webhookSession())).status).toBe(500);

    expect(logger.error).toHaveBeenCalledWith(
      "Stripe webhook processing failed",
      expect.objectContaining({ errorCode: "08006", eventId: "evt_1" })
    );
    const [, meta] = vi.mocked(logger.error).mock.calls.find(([m]) => m === "Stripe webhook processing failed")!;
    expect(Object.keys(meta as object).sort()).toEqual(["errorCode", "errorName", "eventId", "eventType"]);
  });
});

describe("webhook — kolejność zdarzeń (ostrzeżenie [MEDIUM] fail-open state drift)", () => {
  const LOCAL_ACTIVE = {
    id: "sub-local",
    salonId: "salon-1",
    status: "active",
    stripeSubscriptionId: "sub_1",
    currentPeriodStart: new Date(PERIOD_START * 1000),
    currentPeriodEnd: new Date(PERIOD_END * 1000),
    canceledAt: null,
  };

  it.each([
    ["customer.subscription.deleted", "canceled"],
    ["customer.subscription.updated", "past_due"],
  ])("checkout.session.completed po %s nie przywraca „active”", async (firstEvent, stripeStatus) => {
    // 1) najpierw stan ze Stripe: anulowanie / zaległość (handler czyta go ze Stripe)
    retrieveSubscription.mockResolvedValue({ ...STRIPE_SUB, status: stripeStatus });
    f.selects.push([LOCAL_ACTIVE], [PLAN_PRO]);
    expect(
      (
        await deliver(
          { id: "sub_1", status: stripeStatus, canceled_at: null, cancel_at_period_end: false, items: STRIPE_SUB.items },
          firstEvent
        )
      ).status
    ).toBe(200);
    const afterFirst = [...f.committed];
    expect(afterFirst.map((w) => w.values.status)).toEqual([stripeStatus]);

    // 2) spóźniony checkout.session.completed — Stripe mówi już stripeStatus
    f.selects.length = 0;
    f.selects.push([], [PLAN_PRO], []);
    expect((await deliver(webhookSession())).status).toBe(200);

    expect(f.committed).toEqual(afterFirst);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("manual handling"),
      expect.objectContaining({ code: "SUBSCRIPTION_NOT_ACTIVE" })
    );
  });

  it("trialing ze Stripe przez webhook → trialing z trial_end", async () => {
    retrieveSubscription.mockResolvedValue({ ...STRIPE_SUB, status: "trialing", trial_end: PERIOD_END });
    f.selects.push([], [PLAN_PRO], []);
    expect((await deliver(webhookSession())).status).toBe(200);
    expect(f.committed[0]?.values).toEqual(
      expect.objectContaining({ status: "trialing", trialEndsAt: new Date(PERIOD_END * 1000) })
    );
  });
});

describe("webhook — zdarzenie tylko jako sygnał: stan bieżący ze Stripe, canceled końcowe", () => {
  const LOCAL = {
    id: "sub-local",
    salonId: "salon-1",
    planId: PLAN_PRO.id,
    status: "active",
    stripeSubscriptionId: "sub_1",
    currentPeriodStart: new Date(PERIOD_START * 1000),
    currentPeriodEnd: new Date(PERIOD_END * 1000),
    canceledAt: null,
    scheduledPlanId: null,
    scheduledChangeAt: null,
  };
  const INVOICE_PAID = {
    id: "in_2",
    subscription: "sub_1",
    payment_intent: "pi_2",
    billing_reason: "subscription_cycle",
    amount_paid: 14900,
  };
  const subWrites = () => f.committed.filter((w) => w.table === "salon_subscriptions");
  const payments = () => f.committed.filter((w) => w.table === "subscription_payments");

  it("deleted, potem późne invoice.paid → zostaje canceled, płatność zapisana", async () => {
    retrieveSubscription.mockResolvedValue({ ...STRIPE_SUB, status: "canceled", canceled_at: PERIOD_START });
    f.selects.push([LOCAL]);
    expect((await deliver({ id: "sub_1", status: "canceled" }, "customer.subscription.deleted")).status).toBe(200);
    expect(subWrites().map((w) => w.values.status)).toEqual(["canceled"]);

    // późne invoice.paid: wiersz już canceled
    f.selects.push([{ ...LOCAL, status: "canceled" }], [PLAN_PRO]);
    expect((await deliver(INVOICE_PAID, "invoice.paid")).status).toBe(200);

    expect(subWrites().map((w) => w.values.status)).toEqual(["canceled"]); // bez „active”
    expect(payments()).toEqual([
      expect.objectContaining({
        values: expect.objectContaining({ stripePaymentIntentId: "pi_2", status: "succeeded" }),
      }),
    ]);
  });

  it("invoice.paid nie bierze statusu ze zdarzenia: Stripe mówi canceled → zapis canceled, nie „active”", async () => {
    retrieveSubscription.mockResolvedValue({ ...STRIPE_SUB, status: "canceled", canceled_at: PERIOD_START });
    f.selects.push([LOCAL], [PLAN_PRO]);
    expect((await deliver(INVOICE_PAID, "invoice.paid")).status).toBe(200);
    expect(subWrites().map((w) => w.values.status)).toEqual(["canceled"]);
    expect(payments()).toHaveLength(1);
  });

  it("invoice.paid: status i okres z bieżącego stanu Stripe (świeży odczyt pod blokadą)", async () => {
    retrieveSubscription.mockResolvedValue({ ...STRIPE_SUB, status: "past_due" });
    f.selects.push([LOCAL], [PLAN_PRO]);
    await deliver(INVOICE_PAID, "invoice.paid");
    expect(retrieveSubscription).toHaveBeenCalledWith("sub_1", {}, STRIPE_LOCKED_READ_OPTIONS);
    expect(subWrites()[0]?.values).toEqual(
      expect.objectContaining({
        status: "past_due",
        currentPeriodStart: new Date(PERIOD_START * 1000),
        currentPeriodEnd: new Date(PERIOD_END * 1000),
      })
    );
  });

  it.each([
    ["customer.subscription.updated", { id: "sub_1", status: "active" }, []],
    ["customer.subscription.deleted", { id: "sub_1", status: "canceled" }, []],
    ["invoice.paid", INVOICE_PAID, [[PLAN_PRO]]],
    ["invoice.payment_failed", { id: "in_3", subscription: "sub_1", payment_intent: "pi_3" }, [[PLAN_PRO]]],
  ] as const)(
    "lokalne canceled (subscriptions/cancel), Stripe active z cancel_at_period_end=true → %s nie wskrzesza",
    async (type, object, extra) => {
      retrieveSubscription.mockResolvedValue({ ...STRIPE_SUB, status: "active", cancel_at_period_end: true });
      f.selects.push([{ ...LOCAL, status: "canceled" }], ...(extra as unknown as unknown[][]));
      expect((await deliver(object as unknown as Record<string, unknown>, type)).status).toBe(200);
      expect(subWrites()).toEqual([]);
      expect(logger.error).not.toHaveBeenCalled();
    }
  );

  // Bliźniak: lokalne canceled bez potwierdzenia w Stripe (dryf — np. dawne
  // anulowanie mimo błędu Stripe — albo wznowienie w panelu Stripe). Stripe
  // dalej pobiera opłaty, więc stan ze Stripe wygrywa + manual handling
  // (Ethan, przegląd #62 §2b, reguła 2).
  it.each([
    ["customer.subscription.updated", { id: "sub_1", status: "active" }, []],
    ["invoice.paid", INVOICE_PAID, [[PLAN_PRO]]],
    ["invoice.payment_failed", { id: "in_3", subscription: "sub_1", payment_intent: "pi_3" }, [[PLAN_PRO]]],
  ] as const)(
    "lokalne canceled, Stripe active z cancel_at_period_end=false → %s zapisuje stan ze Stripe + logger.error",
    async (type, object, extra) => {
      retrieveSubscription.mockResolvedValue({
        ...STRIPE_SUB,
        status: "active",
        cancel_at_period_end: false,
        canceled_at: null,
      });
      f.selects.push(
        [{ ...LOCAL, status: "canceled", canceledAt: new Date(PERIOD_START * 1000) }],
        ...(extra as unknown as unknown[][])
      );
      expect((await deliver(object as unknown as Record<string, unknown>, type)).status).toBe(200);
      expect(subWrites().map((w) => [w.values.status, w.values.canceledAt])).toEqual([["active", null]]);
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("manual handling"),
        expect.objectContaining({ stripeSubscriptionId: "sub_1", stripeStatus: "active", cancelAtPeriodEnd: false })
      );
    }
  );

  it.each([
    ["canceled", { status: "canceled", canceled_at: PERIOD_START, cancel_at_period_end: false }],
    ["incomplete_expired", { status: "incomplete_expired", cancel_at_period_end: false }],
  ] as const)("lokalne canceled, Stripe %s → końcowe, bez zapisu i bez logger.error", async (_name, stripe) => {
    retrieveSubscription.mockResolvedValue({ ...STRIPE_SUB, ...stripe });
    f.selects.push([{ ...LOCAL, status: "canceled" }]);
    expect((await deliver({ id: "sub_1" }, "customer.subscription.updated")).status).toBe(200);
    expect(subWrites()).toEqual([]);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("późne invoice.payment_failed po invoice.paid: Stripe mówi active → bez fałszywego past_due", async () => {
    retrieveSubscription.mockResolvedValue({ ...STRIPE_SUB, status: "active" });
    f.selects.push([LOCAL], [PLAN_PRO]);
    await deliver({ id: "in_3", subscription: "sub_1", payment_intent: "pi_3" }, "invoice.payment_failed");
    expect(subWrites().map((w) => w.values.status)).toEqual(["active"]);
    expect(payments()[0]?.values).toEqual(expect.objectContaining({ status: "failed" }));
  });

  it("customer.subscription.updated: payload mówi active, Stripe mówi canceled → canceled", async () => {
    retrieveSubscription.mockResolvedValue({ ...STRIPE_SUB, status: "canceled", canceled_at: PERIOD_START });
    f.selects.push([LOCAL]);
    await deliver({ id: "sub_1", status: "active" }, "customer.subscription.updated");
    expect(subWrites().map((w) => w.values.status)).toEqual(["canceled"]);
  });

  it.each([
    ["customer.subscription.updated", { id: "sub_404" }],
    ["customer.subscription.deleted", { id: "sub_404" }],
    ["invoice.paid", { ...INVOICE_PAID, subscription: "sub_404" }],
    ["invoice.payment_failed", { id: "in_3", subscription: "sub_404", payment_intent: "pi_3" }],
  ] as const)("%s: brak wiersza pod blokadą → 200 + warn z id zdarzenia, bez odczytu Stripe i zapisu", async (type, object) => {
    f.selects.push([]);
    expect((await deliver(object as unknown as Record<string, unknown>, type)).status).toBe(200);
    expect(f.committed).toEqual([]);
    expect(retrieveSubscription).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("No local subscription"),
      expect.objectContaining({ eventId: "evt_1", eventType: type, stripeSubscriptionId: "sub_404" })
    );
    // pod blokadą stripe_sub, nie przed nią
    expect(f.log.slice(0, 3)).toEqual(["lock_timeout", "lock:stripe_sub:sub_404", "select"]);
  });

  it.each([
    ["customer.subscription.updated", { id: "sub_1" }],
    ["invoice.paid", INVOICE_PAID],
  ] as const)("%s: błąd Stripe pod blokadą → 500 (Stripe ponowi), bez zapisu", async (type, object) => {
    retrieveSubscription.mockRejectedValue(new Error("timeout"));
    f.selects.push([LOCAL]);
    expect((await deliver(object as unknown as Record<string, unknown>, type)).status).toBe(500);
    expect(f.committed).toEqual([]);
  });

  it.each(["40P01", "55P03"])("%s przy blokadzie w webhooku → 500, nigdy 2xx", async (code) => {
    f.state.failNextLock = { code };
    expect((await deliver({ id: "sub_1" }, "customer.subscription.deleted")).status).toBe(500);
    expect(f.committed).toEqual([]);
  });

  it("checkout.session.completed: 40P01 w confirm → 500 (Stripe ponowi)", async () => {
    f.state.failNextLock = { code: "40P01" };
    f.selects.push([], [PLAN_PRO]);
    expect((await deliver(webhookSession())).status).toBe(500);
    expect(f.committed).toEqual([]);
  });
});
