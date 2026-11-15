/**
 * Ostrzeżenie [MEDIUM] #2 TOCTOU (T3): potwierdzenie Checkoutu i webhook
 * zmieniający stan subskrypcji są serializowane blokadą salonu.
 *
 * Przed poprawką confirm czytał tylko wiersze active/trialing, bez blokady:
 * „confirm odczytał active ze Stripe → webhook deleted zapisał canceled →
 * transakcja confirm” zakładała NOWY wiersz active (stary canceled nie był
 * widoczny dla filtra), a częściowy indeks unikalny z T3(b) tego nie
 * zatrzyma, bo obejmuje tylko trialing/active.
 *
 * Teraz:
 * - confirm bierze `pg_advisory_xact_lock(hashtext('salon_subscriptions:'||salon))`
 *   na początku transakcji i pod nią czyta WSZYSTKIE wiersze salonu,
 * - wiersz tej subskrypcji Stripe w stanie canceled/past_due/unpaid/
 *   incomplete_expired → odmowa (409, „manual handling”), bez drugiego wiersza,
 * - handlery webhooka updated/deleted/invoice.paid/invoice.payment_failed
 *   biorą tę samą blokadą przed zapisem.
 * Wariant (2) bez ponownego odczytu Stripe pod blokadą: wywołanie sieciowe
 * trzymałoby blokadę salonu przez czas odpowiedzi Stripe, a stan, który
 * Stripe już zgłosił, jest u nas w wierszu odczytanym pod tą blokadą.
 *
 * Test na atrapie `tx` z zapisem kolejności wywołań (`f.log`), nie na dwóch
 * prawdziwych transakcjach: lokalna baza należy do sesji głównej, a ten PR nie
 * uruchamia `db:*`. Blokada w Postgresie to `pg_advisory_xact_lock` — tu
 * sprawdzamy, że jest brana przed odczytem i zapisem w obu ścieżkach.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST as stripeWebhook } from "@/app/api/stripe/webhook/route";
import { POST as confirmRoute } from "@/app/api/subscriptions/confirm/route";
import { salonSubscriptions } from "@/lib/schema";

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
  retrieveSubscription = vi.fn().mockResolvedValue(STRIPE_SUB);
  mockGetStripe.mockReturnValue({
    webhooks: { constructEvent },
    subscriptions: { retrieve: retrieveSubscription },
    checkout: { sessions: { retrieve: vi.fn().mockResolvedValue(SESSION) } },
  });
});

describe("TOCTOU — blokada salonu w potwierdzeniu", () => {
  it("odczyt stanu i zapisy confirm są pod blokadą salonu, w jednej transakcji", async () => {
    f.selects.push([], [PLAN_PRO], []);
    expect((await confirm()).status).toBe(200);
    const lockAt = f.log.indexOf("lock:salon-1");
    expect(lockAt).toBeGreaterThan(-1);
    // przed blokadą: tylko odczyt idempotencji i planu
    expect(f.log.slice(0, lockAt)).toEqual(["select", "select"]);
    expect(f.log.slice(lockAt)).toEqual([
      "lock:salon-1",
      "select",
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

  it("przeplot: confirm odczytał active → webhook deleted zapisał canceled → transakcja confirm: brak active i brak drugiego wiersza", async () => {
    // confirm: idempotencja, plan; webhook deleted: wiersz po stripe id;
    // confirm pod blokadą: wiersze salonu — już canceled (zapisał webhook).
    f.selects.push([], [PLAN_PRO], [LOCAL_ACTIVE], [{ ...LOCAL_ACTIVE, status: "canceled" }]);
    // Stripe odpowiada „active” (stan sprzed anulowania), a zanim confirm
    // otworzy transakcję, przychodzi customer.subscription.deleted.
    retrieveSubscription.mockImplementationOnce(async () => {
      expect(await deliver("customer.subscription.deleted", { id: "sub_1", status: "canceled" })).toBe(200);
      return STRIPE_SUB;
    });

    const { status, body } = await confirm();

    expect(status).toBe(409);
    expect(body.code).toBe("SUBSCRIPTION_NOT_ACTIVE");
    // Jedyny zapis: canceled z webhooka. Ani active, ani drugiego wiersza.
    expect(f.committed.map((w) => [w.op, w.table, w.values.status])).toEqual([
      ["update", "salon_subscriptions", "canceled"],
    ]);
    // Webhook zatwierdził pod blokadą, zanim confirm wziął swoją.
    expect(f.log).toEqual([
      "select", // confirm: idempotencja
      "select", // confirm: plan
      "select", // webhook: wiersz po stripe id
      "lock:salon-1",
      "update:salon_subscriptions",
      "commit",
      "lock:salon-1", // confirm
      "select",
      "commit",
    ]);
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

describe("TOCTOU — ta sama blokada w handlerach webhooka", () => {
  it.each([
    ["customer.subscription.updated", { id: "sub_1", status: "past_due", canceled_at: null, cancel_at_period_end: false, items: { data: [PERIOD] } }, [[LOCAL_ACTIVE]]],
    ["customer.subscription.deleted", { id: "sub_1", status: "canceled" }, [[LOCAL_ACTIVE]]],
    ["invoice.payment_failed", { id: "in_1", subscription: "sub_1", payment_intent: "pi_1" }, [[LOCAL_ACTIVE], [PLAN_PRO]]],
    [
      "invoice.paid",
      { id: "in_1", subscription: "sub_1", payment_intent: "pi_1", billing_reason: "subscription_cycle", amount_paid: 14900, period_start: 1, period_end: 2 },
      [[LOCAL_ACTIVE], [PLAN_PRO]],
    ],
  ] as const)("%s: blokada salonu przed zapisem stanu", async (type, object, selects) => {
    f.selects.push(...(selects as unknown as unknown[][]));
    expect(await deliver(type, object as unknown as Record<string, unknown>)).toBe(200);
    const lockAt = f.log.indexOf("lock:salon-1");
    const firstWrite = f.log.findIndex((e) => e.startsWith("update:") || e.startsWith("insert:"));
    expect(lockAt).toBeGreaterThan(-1);
    expect(lockAt).toBeLessThan(firstWrite);
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
