/**
 * Blokady subskrypcji (T3): ostrzeżenia [MEDIUM] #2 TOCTOU i #3 „zdarzenie
 * przed wierszem” — testy jednostkowe na atrapie `tx` z logiem kolejności
 * wywołań (`f.log`). Kolejność i czekanie na prawdziwym Postgresie dowodzi
 * test integracyjny `__tests__/integration/subscription-locks.pg.test.ts`.
 *
 * Kształt (Ethan, `scratchpad/ethan/pr62-shape.md`):
 * - dwuargumentowe `pg_advisory_xact_lock(<przestrzeń>, hashtext(id))`,
 *   przestrzenie `stripe_sub` i `salon`, tylko `xact`;
 * - kolejność: lock_timeout → stripe_sub → odczyt Stripe → salon; co najwyżej
 *   jedna blokada z każdej przestrzeni na transakcję;
 * - confirm czyta Stripe DOPIERO pod blokadą stripe_sub; webhook szuka
 *   wiersza DOPIERO pod blokadą stripe_sub;
 * - pod blokadą salonu confirm czyta WSZYSTKIE wiersze salonu; wiersz tej
 *   subskrypcji Stripe w stanie zakończonym → 409, bez drugiego wiersza.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST as stripeWebhook } from "@/app/api/stripe/webhook/route";
import { POST as confirmRoute } from "@/app/api/subscriptions/confirm/route";
import { salonSubscriptions } from "@/lib/schema";
import { lockSalonSubscriptions, lockStripeSubscription } from "@/lib/subscription-locks";

const f = await vi.hoisted(async () =>
  (await import("./subscription-db-fake")).createSubscriptionDbFake()
);

const { mockGetStripe, constructEvent, inArrayCalls } = vi.hoisted(() => ({
  mockGetStripe: vi.fn(),
  constructEvent: vi.fn(),
  inArrayCalls: [] as unknown[][],
}));

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    inArray: (...args: Parameters<typeof actual.inArray>) => {
      inArrayCalls.push(args);
      return actual.inArray(...args);
    },
  };
});
vi.mock("@/lib/db", () => ({ db: f.db }));
vi.mock("@/lib/stripe", () => ({
  getStripe: (...a: unknown[]) => mockGetStripe(...a),
  isStripeWebhookConfigured: () => true,
  getStripeWebhookSecret: () => "mock-webhook-secret",
}));
vi.mock("@/lib/deposit-confirmation", () => ({ confirmDepositPayment: vi.fn() }));
vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock("@/lib/auth-middleware", () => ({
  requireAuth: async () => ({ user: { id: "owner-1" } }),
  isAuthError: () => false,
}));
vi.mock("@/lib/get-user-salon", () => ({ getUserSalonId: async () => "salon-1" }));

const PLAN_PRO = { id: "plan-pro", name: "Pro", slug: "pro", priceMonthly: "149.00", isActive: true };
const PERIOD = { current_period_start: 1783296000, current_period_end: 1785888000 };
const STRIPE_SUB = { id: "sub_1", status: "active", items: { data: [PERIOD] } };
const SESSION = {
  id: "cs_test_123",
  mode: "subscription",
  payment_status: "paid",
  metadata: { salonId: "salon-1", planId: PLAN_PRO.id },
  customer: "cus_1",
  subscription: "sub_1",
};
const LOCAL_ACTIVE = {
  id: "sub-local",
  salonId: "salon-1",
  planId: PLAN_PRO.id,
  status: "active",
  stripeSubscriptionId: "sub_1",
  currentPeriodStart: null,
  currentPeriodEnd: null,
  canceledAt: null,
};

let retrieveSubscription: ReturnType<typeof vi.fn>;
let stripeStatus = "active";

async function deliver(type: string, object: Record<string, unknown>) {
  constructEvent.mockReturnValueOnce({ id: `evt_${type}`, type, data: { object } });
  const res = await stripeWebhook(
    new Request("http://localhost/api/stripe/webhook", {
      method: "POST",
      headers: { "stripe-signature": "t=1,v1=ok" },
      body: "{}",
    })
  );
  return res.status;
}

async function confirm() {
  const res = await confirmRoute(
    new Request("http://localhost/api/subscriptions/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: SESSION.id }),
    })
  );
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  vi.clearAllMocks();
  f.reset();
  inArrayCalls.length = 0;
  stripeStatus = "active";
  // Odczyt Stripe trafia do logu kolejności — widać, pod którą blokadą jest.
  retrieveSubscription = vi.fn().mockImplementation(async () => {
    f.log.push("stripe:retrieve");
    return { ...STRIPE_SUB, status: stripeStatus };
  });
  mockGetStripe.mockReturnValue({
    webhooks: { constructEvent },
    subscriptions: { retrieve: retrieveSubscription },
    checkout: { sessions: { retrieve: vi.fn().mockResolvedValue(SESSION) } },
  });
});

describe("confirm — kolejność: stripe_sub → odczyt Stripe → salon", () => {
  it("odczyt Stripe jest pod blokadą stripe_sub i przed blokadą salonu; wiersze salonu pod obiema", async () => {
    f.selects.push([], [PLAN_PRO], []);
    expect((await confirm()).status).toBe(200);
    expect(f.log).toEqual([
      "select", // idempotencja (przed transakcją)
      "select", // plan (przed transakcją)
      "lock_timeout",
      "lock:stripe_sub:sub_1",
      "stripe:retrieve",
      "lock:salon:salon-1",
      "select", // wszystkie wiersze salonu
      "insert:salon_subscriptions",
      "insert:subscription_payments",
      "commit",
    ]);
  });

  it("pod blokadą czyta WSZYSTKIE wiersze salonu — bez filtra po statusie", async () => {
    f.selects.push([], [PLAN_PRO], []);
    await confirm();
    expect(inArrayCalls.some(([col]) => col === salonSubscriptions.status)).toBe(false);
  });

  it("Stripe nieaktywny pod blokadą → 409 bez blokady salonu i bez odczytu wierszy", async () => {
    stripeStatus = "canceled";
    f.selects.push([], [PLAN_PRO]);
    expect((await confirm()).status).toBe(409);
    expect(f.log).not.toContain("lock:salon:salon-1");
    expect(f.committed).toEqual([]);
  });

  it("gałąź SUBSCRIPTION_CONFLICT: jedna blokada stripe_sub (bez drugiej dla cudzej subskrypcji)", async () => {
    f.selects.push([], [PLAN_PRO], [{ ...LOCAL_ACTIVE, stripeSubscriptionId: "sub_OTHER" }]);
    const { status, body } = await confirm();
    expect(status).toBe(409);
    expect(body.code).toBe("SUBSCRIPTION_CONFLICT");
    expect(f.log.filter((e) => e.startsWith("lock:stripe_sub:"))).toEqual(["lock:stripe_sub:sub_1"]);
    expect(f.log.filter((e) => e.startsWith("lock:salon:"))).toEqual(["lock:salon:salon-1"]);
  });

  it("deleted przed confirm (bez wiersza): webhook 200 + warn, confirm czyta canceled ze Stripe → 409, zero zapisów", async () => {
    stripeStatus = "canceled";
    f.selects.push([]); // webhook pod blokadą: brak wiersza
    expect(await deliver("customer.subscription.deleted", { id: "sub_1" })).toBe(200);
    f.selects.push([], [PLAN_PRO]);
    const { status, body } = await confirm();
    expect(status).toBe(409);
    expect(body.code).toBe("SUBSCRIPTION_NOT_ACTIVE");
    expect(f.committed).toEqual([]);
  });

  it.each(["canceled", "past_due", "unpaid", "incomplete_expired"])(
    "wiersz tej subskrypcji Stripe w stanie %s → odmowa, bez insertu i bez update",
    async (localStatus) => {
      f.selects.push([], [PLAN_PRO], [{ ...LOCAL_ACTIVE, status: localStatus }]);
      const { status } = await confirm();
      expect(status).toBe(409);
      expect(f.committed).toEqual([]);
    }
  );

  it("zakończony wiersz INNEJ subskrypcji Stripe nie blokuje nowego Checkoutu", async () => {
    f.selects.push([], [PLAN_PRO], [{ ...LOCAL_ACTIVE, stripeSubscriptionId: "sub_OLD", status: "canceled" }]);
    expect((await confirm()).status).toBe(200);
    expect(f.committed.map((w) => w.op + ":" + w.table)).toEqual([
      "insert:salon_subscriptions",
      "insert:subscription_payments",
    ]);
  });
});

describe("webhook — wiersz szukany pod blokadą stripe_sub, odczyt Stripe przed blokadą salonu", () => {
  it.each([
    ["customer.subscription.updated", { id: "sub_1" }, [[LOCAL_ACTIVE]]],
    ["customer.subscription.deleted", { id: "sub_1" }, [[LOCAL_ACTIVE]]],
    ["invoice.payment_failed", { id: "in_1", subscription: "sub_1", payment_intent: "pi_1" }, [[LOCAL_ACTIVE], [PLAN_PRO]]],
    [
      "invoice.paid",
      { id: "in_1", subscription: "sub_1", payment_intent: "pi_1", billing_reason: "subscription_cycle", amount_paid: 14900 },
      [[LOCAL_ACTIVE], [PLAN_PRO]],
    ],
  ] as const)("%s: lock_timeout → stripe_sub → select → Stripe → salon → zapis", async (type, object, selects) => {
    f.selects.push(...(selects as unknown as unknown[][]));
    expect(await deliver(type, object as unknown as Record<string, unknown>)).toBe(200);
    expect(f.log.slice(0, 5)).toEqual([
      "lock_timeout",
      "lock:stripe_sub:sub_1",
      "select",
      "stripe:retrieve",
      "lock:salon:salon-1",
    ]);
    const firstWrite = f.log.findIndex((e) => e.startsWith("update:") || e.startsWith("insert:"));
    expect(firstWrite).toBeGreaterThan(4);
  });
});

describe("reguły blokad pilnowane w kodzie", () => {
  type LockTx = Parameters<typeof lockStripeSubscription>[0];
  it("druga blokada stripe_sub w jednej transakcji → błąd", async () => {
    await expect(
      f.db.transaction(async (tx: unknown) => {
        await lockStripeSubscription(tx as LockTx, "sub_1");
        await lockStripeSubscription(tx as LockTx, "sub_2");
      })
    ).rejects.toThrow(/second stripeSub lock/);
  });

  it("stripe_sub po blokadzie salonu → błąd (odwrotna kolejność = ryzyko zakleszczenia)", async () => {
    await expect(
      f.db.transaction(async (tx: unknown) => {
        await lockSalonSubscriptions(tx as LockTx, "salon-1");
        await lockStripeSubscription(tx as LockTx, "sub_1");
      })
    ).rejects.toThrow(/stripe_sub lock after salon lock/);
  });

  it("druga blokada salonu w jednej transakcji → błąd", async () => {
    await expect(
      f.db.transaction(async (tx: unknown) => {
        await lockStripeSubscription(tx as LockTx, "sub_1");
        await lockSalonSubscriptions(tx as LockTx, "salon-1");
        await lockSalonSubscriptions(tx as LockTx, "salon-2");
      })
    ).rejects.toThrow(/second salon lock/);
  });
});

describe("częściowy indeks unikalny z T3(b) w tym scenariuszu (emulacja)", () => {
  it("indeks NIE zatrzymuje nowego active obok wiersza canceled — dlatego potrzebna jest blokada i sprawdzenie", async () => {
    f.partialUniqueActiveTrialing.push({ salonId: "salon-1", status: "canceled" });
    type InsertTx = {
      insert: (t: unknown) => { values: (v: unknown) => { returning: () => Promise<unknown[]> } };
    };
    const rows = await f.db.transaction(async (tx: unknown) =>
      (tx as InsertTx)
        .insert(salonSubscriptions)
        .values({ salonId: "salon-1", status: "active" })
        .returning()
    );
    expect(rows).toHaveLength(1); // przeszło — indeks obejmuje tylko trialing/active
  });

  it("indeks zatrzymuje drugi active, gdy pierwszy zatwierdził ktoś bez blokady (np. rejestracja) → 23505 → alreadyConfirmed", async () => {
    // Wiersz active zatwierdzony przez inną transakcję — SELECT go nie widzi.
    f.partialUniqueActiveTrialing.push({ salonId: "salon-1", status: "active" });
    f.selects.push([], [PLAN_PRO], [], [{ id: "pay-w", subscriptionId: "sub-w" }], [{ id: "sub-w" }]);

    const { status, body } = await confirm();

    expect(status).toBe(200);
    expect(body.alreadyConfirmed).toBe(true);
    expect(f.committed).toEqual([]);
    expect(f.log).toContain("rollback");
  });

  it("23505 bez zwycięskiej płatności w salonie → 500, bez zapisu (nie udajemy sukcesu)", async () => {
    f.partialUniqueActiveTrialing.push({ salonId: "salon-1", status: "trialing" });
    f.selects.push([], [PLAN_PRO], [], []);
    expect((await confirm()).status).toBe(500);
    expect(f.committed).toEqual([]);
  });
});
