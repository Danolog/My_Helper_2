/**
 * POST /api/subscriptions/confirm — potwierdzenie opłaconego Checkoutu (T3).
 *
 * Kontrakt (przegląd Ethana i Ryana P2 po #37):
 * - salon z sesji; `metadata.salonId` innego salonu → 403, zero odczytów
 *   płatności i zero zapisów (dawniej metadata wygrywała z sesją),
 * - brak `metadata.salonId` → 400 (bez cichego zastępstwa salonem z sesji),
 * - tylko `mode === "subscription"` z prawdziwą subskrypcją Stripe
 *   (bez zmyślonego `stripe_sub_${Date.now()}`),
 * - okres z `current_period_*` Stripe, nie „teraz + miesiąc”,
 * - idempotencja zawężona do salonu; wyścig z webhookiem (konflikt na
 *   unikalnym indeksie) → alreadyConfirmed, transakcja wycofana, bez duplikatu,
 * - trial → płatny plan: wiersz `trialing` przechodzi w `active`, bez drugiego
 *   wiersza; inne wiersze `trialing` salonu są zamykane,
 * - salon płacący już za INNĄ subskrypcję Stripe → 409, bez nadpisania.
 * Bez Stripe → 503 STRIPE_UNAVAILABLE (bez zmian od #37).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/subscriptions/confirm/route";
import { subscriptionPayments } from "@/lib/schema";

const f = await vi.hoisted(async () =>
  (await import("./subscription-db-fake")).createSubscriptionDbFake()
);

const { mockRequireAuth, mockIsAuthError, mockGetUserSalonId, mockGetStripe } = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
  mockIsAuthError: vi.fn(),
  mockGetUserSalonId: vi.fn(),
  mockGetStripe: vi.fn(),
}));

const { eqCalls } = vi.hoisted(() => ({ eqCalls: [] as unknown[][] }));
// Prawdziwe drizzle; zapisujemy tylko argumenty eq(), żeby sprawdzić zawężenie
// idempotencji do salonu (atrapa bazy nie wykonuje WHERE).
vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    eq: (...args: Parameters<typeof actual.eq>) => {
      eqCalls.push(args);
      return actual.eq(...args);
    },
  };
});

vi.mock("@/lib/db", () => ({ db: f.db }));
vi.mock("@/lib/auth-middleware", () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
  isAuthError: (...args: unknown[]) => mockIsAuthError(...args),
}));
vi.mock("@/lib/get-user-salon", () => ({
  getUserSalonId: (...args: unknown[]) => mockGetUserSalonId(...args),
}));
vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
// Atrapa klienta Stripe — zero wywołań sieciowych.
vi.mock("@/lib/stripe", () => ({
  getStripe: (...a: unknown[]) => mockGetStripe(...a),
}));

const PLAN_PRO = { id: "plan-pro", name: "Pro", slug: "pro", priceMonthly: "149.00", isActive: true };
// Okres ze Stripe celowo NIE jest „teraz + miesiąc”.
const PERIOD_START = 1783296000; // 2026-07-06T00:00:00Z
const PERIOD_END = 1785888000; // 2026-08-05T00:00:00Z

function checkoutSession(overrides: Record<string, unknown> = {}) {
  return {
    id: "cs_test_123",
    mode: "subscription",
    payment_status: "paid",
    metadata: { salonId: "salon-1", planId: PLAN_PRO.id },
    customer: "cus_1",
    subscription: {
      id: "sub_1",
      items: { data: [{ current_period_start: PERIOD_START, current_period_end: PERIOD_END }] },
    },
    ...overrides,
  };
}

let retrieveSession: ReturnType<typeof vi.fn>;
let retrieveSubscription: ReturnType<typeof vi.fn>;

function withStripe(session: unknown) {
  retrieveSession = vi.fn().mockResolvedValue(session);
  retrieveSubscription = vi.fn();
  mockGetStripe.mockReturnValue({
    checkout: { sessions: { retrieve: retrieveSession } },
    subscriptions: { retrieve: retrieveSubscription },
  });
}

async function confirm(body: unknown = { sessionId: "cs_test_123" }) {
  const res = await POST(
    new Request("http://localhost/api/subscriptions/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );
  return { status: res.status, body: await res.json() };
}

const subWrites = () => f.committed.filter((w) => w.table === "salon_subscriptions");
const paymentWrites = () => f.committed.filter((w) => w.table === "subscription_payments");

function expectNoWrites() {
  expect(f.state.transactions).toBe(0);
  expect(f.committed).toEqual([]);
}

beforeEach(() => {
  vi.clearAllMocks();
  f.reset();
  eqCalls.length = 0;
  mockRequireAuth.mockResolvedValue({ user: { id: "owner-1" } });
  mockIsAuthError.mockReturnValue(false);
  mockGetUserSalonId.mockResolvedValue("salon-1");
  mockGetStripe.mockReturnValue(null);
});

describe("POST /api/subscriptions/confirm — 200", () => {
  it("nowa subskrypcja: okres ze Stripe, płatność z id sesji i salonem", async () => {
    withStripe(checkoutSession());
    f.selects.push([], [PLAN_PRO], []); // brak płatności, plan, brak wierszy salonu

    const { status, body } = await confirm();

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.alreadyConfirmed).toBeUndefined();
    expect(body.plan).toEqual(expect.objectContaining({ slug: "pro" }));
    expect(subWrites()).toEqual([
      expect.objectContaining({
        op: "insert",
        values: expect.objectContaining({
          salonId: "salon-1",
          planId: PLAN_PRO.id,
          status: "active",
          stripeSubscriptionId: "sub_1",
          stripeCustomerId: "cus_1",
          currentPeriodStart: new Date(PERIOD_START * 1000),
          currentPeriodEnd: new Date(PERIOD_END * 1000),
        }),
      }),
    ]);
    expect(paymentWrites()).toEqual([
      expect.objectContaining({
        op: "insert",
        values: expect.objectContaining({
          salonId: "salon-1",
          stripePaymentIntentId: "cs_test_123",
          amount: "149.00",
          status: "succeeded",
        }),
      }),
    ]);
  });

  it("okres ze starszego formatu API (current_period_* na subskrypcji)", async () => {
    withStripe(
      checkoutSession({
        subscription: { id: "sub_1", current_period_start: PERIOD_START, current_period_end: PERIOD_END },
      })
    );
    f.selects.push([], [PLAN_PRO], []);
    expect((await confirm()).status).toBe(200);
    expect(subWrites()[0]?.values.currentPeriodEnd).toEqual(new Date(PERIOD_END * 1000));
  });

  it("subskrypcja jako id (bez expand) → pobrana ze Stripe", async () => {
    withStripe(checkoutSession({ subscription: "sub_1" }));
    retrieveSubscription.mockResolvedValue({
      id: "sub_1",
      items: { data: [{ current_period_start: PERIOD_START, current_period_end: PERIOD_END }] },
    });
    f.selects.push([], [PLAN_PRO], []);
    expect((await confirm()).status).toBe(200);
    expect(retrieveSubscription).toHaveBeenCalledWith("sub_1");
  });

  it("trial → płatny plan: ten sam wiersz przechodzi w active, bez drugiego wiersza", async () => {
    withStripe(checkoutSession());
    const trial = { id: "sub-trial", salonId: "salon-1", status: "trialing", stripeSubscriptionId: null };
    f.selects.push([], [PLAN_PRO], [trial]);

    expect((await confirm()).status).toBe(200);
    expect(subWrites()).toEqual([
      expect.objectContaining({
        op: "update",
        values: expect.objectContaining({ status: "active", trialEndsAt: null, stripeSubscriptionId: "sub_1" }),
      }),
    ]);
    expect(subWrites().some((w) => w.op === "insert")).toBe(false);
  });

  it("aktywny wiersz + zaległe wiersze trialing: aktywny zaktualizowany, trialing zamknięte", async () => {
    withStripe(checkoutSession());
    f.selects.push([], [PLAN_PRO], [
      { id: "sub-active", status: "active", stripeSubscriptionId: null },
      { id: "sub-trial", status: "trialing", stripeSubscriptionId: null },
    ]);

    expect((await confirm()).status).toBe(200);
    expect(subWrites().map((w) => [w.op, w.values.status])).toEqual([
      ["update", "active"],
      ["update", "canceled"],
    ]);
  });

  it("aktywny wiersz z dawnej symulacji (sim_) zostaje zastąpiony prawdziwą subskrypcją", async () => {
    withStripe(checkoutSession());
    f.selects.push([], [PLAN_PRO], [{ id: "sub-sim", status: "active", stripeSubscriptionId: "sim_123" }]);
    expect((await confirm()).status).toBe(200);
    expect(subWrites()[0]?.values.stripeSubscriptionId).toBe("sub_1");
  });

  it("idempotencja: sesja już potwierdzona w tym salonie → alreadyConfirmed, bez transakcji", async () => {
    withStripe(checkoutSession());
    f.selects.push([{ id: "pay-1", subscriptionId: "sub-1", salonId: "salon-1" }], [{ id: "sub-1" }]);

    const { status, body } = await confirm();

    expect(status).toBe(200);
    expect(body).toEqual({ success: true, alreadyConfirmed: true, subscription: { id: "sub-1" } });
    expectNoWrites();
  });

  it("idempotencja zawężona do salonu: szukamy płatności po id sesji I salonie", async () => {
    withStripe(checkoutSession());
    f.selects.push([{ id: "pay-1", subscriptionId: "sub-1" }], [{ id: "sub-1" }]);
    await confirm();
    expect(eqCalls).toEqual(
      expect.arrayContaining([
        [subscriptionPayments.stripePaymentIntentId, "cs_test_123"],
        [subscriptionPayments.salonId, "salon-1"],
      ])
    );
  });

  it("wyścig z webhookiem: konflikt na płatności → alreadyConfirmed, transakcja wycofana", async () => {
    withStripe(checkoutSession());
    f.state.paymentInsertResult = []; // ON CONFLICT DO NOTHING nic nie wstawił
    f.selects.push([], [PLAN_PRO], [], [{ id: "pay-w", subscriptionId: "sub-w" }], [{ id: "sub-w" }]);

    const { status, body } = await confirm();

    expect(status).toBe(200);
    expect(body).toEqual({ success: true, alreadyConfirmed: true, subscription: { id: "sub-w" } });
    expect(f.state.rolledBack).toBe(1);
    expect(f.committed).toEqual([]);
  });

  it("wyścig na unikalnym indeksie wiersza subskrypcji (23505) → alreadyConfirmed", async () => {
    withStripe(checkoutSession());
    f.state.failNextSubscriptionWrite = { code: "23505" };
    f.selects.push([], [PLAN_PRO], [], [{ id: "pay-w", subscriptionId: "sub-w" }], [{ id: "sub-w" }]);

    const { status, body } = await confirm();

    expect(status).toBe(200);
    expect(body.alreadyConfirmed).toBe(true);
    expect(f.committed).toEqual([]);
  });
});

describe("POST /api/subscriptions/confirm — 400/401/403/404/409", () => {
  it("403: metadata.salonId innego salonu — przed odczytem płatności, zero zapisów", async () => {
    withStripe(checkoutSession({ metadata: { salonId: "salon-B", planId: PLAN_PRO.id } }));
    f.selects.push([{ id: "pay-B", subscriptionId: "sub-B" }], [{ id: "sub-B" }]);

    const { status, body } = await confirm();

    expect(status).toBe(403);
    expect(body.code).toBe("SALON_MISMATCH");
    expect(body).not.toHaveProperty("subscription");
    expect(f.selects).toHaveLength(2); // nikt nie zapytał o płatności salonu B
    expectNoWrites();
  });

  it("400: brak metadata.salonId — bez cichego zastępstwa salonem z sesji", async () => {
    withStripe(checkoutSession({ metadata: { planId: PLAN_PRO.id } }));
    const { status, body } = await confirm();
    expect(status).toBe(400);
    expect(body.code).toBe("MISSING_SALON");
    expectNoWrites();
  });

  it("400: sesja w trybie payment (np. zadatek) nie daje planu", async () => {
    withStripe(checkoutSession({ mode: "payment" }));
    const { status, body } = await confirm();
    expect(status).toBe(400);
    expect(body.code).toBe("INVALID_SESSION_MODE");
    expectNoWrites();
  });

  it("400: sesja nieopłacona", async () => {
    withStripe(checkoutSession({ payment_status: "unpaid" }));
    expect((await confirm()).status).toBe(400);
    expectNoWrites();
  });

  it("400: brak subskrypcji Stripe w sesji — bez zmyślonego identyfikatora", async () => {
    withStripe(checkoutSession({ subscription: null }));
    f.selects.push([], [PLAN_PRO]);
    const { status, body } = await confirm();
    expect(status).toBe(400);
    expect(body.code).toBe("MISSING_SUBSCRIPTION");
    expectNoWrites();
  });

  it("400: brak planId w sesji", async () => {
    withStripe(checkoutSession({ metadata: { salonId: "salon-1" } }));
    f.selects.push([]);
    expect((await confirm()).status).toBe(400);
    expectNoWrites();
  });

  it("400: brak sessionId", async () => {
    expect((await confirm({})).status).toBe(400);
    expectNoWrites();
  });

  it("401: niezalogowany", async () => {
    mockRequireAuth.mockResolvedValue(new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }));
    mockIsAuthError.mockReturnValue(true);
    expect((await confirm()).status).toBe(401);
    expectNoWrites();
  });

  it("404: brak salonu", async () => {
    mockGetUserSalonId.mockResolvedValue(null);
    expect((await confirm()).status).toBe(404);
    expectNoWrites();
  });

  it("404: plan z sesji nie istnieje", async () => {
    withStripe(checkoutSession());
    f.selects.push([], []);
    const { status, body } = await confirm();
    expect(status).toBe(404);
    expect(body.code).toBe("PLAN_NOT_FOUND");
    expectNoWrites();
  });

  it("409: salon płaci już za inną subskrypcję Stripe — bez nadpisania", async () => {
    withStripe(checkoutSession());
    f.selects.push([], [PLAN_PRO], [{ id: "sub-paid", status: "active", stripeSubscriptionId: "sub_OTHER" }]);
    const { status, body } = await confirm();
    expect(status).toBe(409);
    expect(body.code).toBe("SUBSCRIPTION_CONFLICT");
    expect(f.committed).toEqual([]);
  });
});

describe("POST /api/subscriptions/confirm — 5xx", () => {
  it("503: bez Stripe — błąd zamiast fałszywego sukcesu, zero zapisów", async () => {
    const { status, body } = await confirm();
    expect(status).toBe(503);
    expect(body.code).toBe("STRIPE_UNAVAILABLE");
    expect(body).not.toHaveProperty("alreadyConfirmed");
    expectNoWrites();
  });

  it("502: błąd Stripe przy pobraniu sesji", async () => {
    withStripe(checkoutSession());
    retrieveSession.mockRejectedValue(new Error("network"));
    expect((await confirm()).status).toBe(502);
    expectNoWrites();
  });

  it("502: Stripe nie zwrócił okresu — bez liczenia okresu lokalnie", async () => {
    withStripe(checkoutSession({ subscription: { id: "sub_1", items: { data: [{}] } } }));
    f.selects.push([], [PLAN_PRO]);
    const { status, body } = await confirm();
    expect(status).toBe(502);
    expect(body.code).toBe("STRIPE_PERIOD_MISSING");
    expectNoWrites();
  });

  it("500: błąd bazy w transakcji — wycofana, bez zapisów", async () => {
    withStripe(checkoutSession());
    f.state.failNextSubscriptionWrite = { code: "08006" };
    f.selects.push([], [PLAN_PRO], []);
    expect((await confirm()).status).toBe(500);
    expect(f.committed).toEqual([]);
  });

  it("500: konflikt na płatności, ale zwycięzcy nie widać w tym salonie — błąd, nie sukces", async () => {
    withStripe(checkoutSession());
    f.state.paymentInsertResult = [];
    f.selects.push([], [PLAN_PRO], [], []);
    const { status, body } = await confirm();
    expect(status).toBe(500);
    expect(body.success).toBe(false);
  });
});
