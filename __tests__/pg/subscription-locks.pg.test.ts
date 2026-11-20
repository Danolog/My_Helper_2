/**
 * Blokady subskrypcji na PRAWDZIWYM Postgresie (T3, ostrzeżenia [MEDIUM] #2
 * i #3 oraz kolejność zdarzeń; warunki a–d).
 *
 * (a) Ścieżka produkcyjna: prawdziwe `confirmSubscriptionCheckout` i
 *     prawdziwe handlery webhooka (`POST /api/stripe/webhook`) na prawdziwej
 *     bazie, z prawdziwym `pg_advisory_xact_lock`. Atrapami są Stripe (z weryfikacją
 *     podpisu zdarzenia), logger, sesja i lista `PLANS_ON_SALE`.
 * (b) Czekanie drugiego połączenia jest dowiedzione przez `pg_locks`
 *     (`granted = false` w przestrzeni blokady), nie przez `sleep`: pierwszy
 *     uczestnik trzyma blokadę na barierze (odczyt Stripe albo jawna
 *     transakcja testu), test czeka, aż drugi pojawi się w `pg_locks` jako
 *     czekający, i dopiero wtedy zwalnia barierę.
 * (c) Scenariusze: confirm → deleted = canceled; deleted bez wiersza → 2xx,
 *     potem confirm 409 bez zapisu; deleted → późne invoice.paid = canceled;
 *     lokalne canceled + Stripe active → zostaje canceled; 50 iteracji
 *     confirm ‖ updated ‖ invoice.paid z losowymi opóźnieniami = zero 40P01
 *     i stan zgodny z atrapą Stripe. Okres próbny na jednym planie i confirm
 *     sesji z innym planem → ten sam wiersz active z planem z sesji.
 * (T3b) Prawdziwa trasa `subscriptions/cancel` (502 przy błędzie Stripe,
 *     `canceled` tylko po potwierdzeniu, cancel ‖ updated), bliźniak (c3'')
 *     bez potwierdzenia, indeksy unikalne 0008 i równoległa rejestracja.
 *     Trasy cancel i checkout pod rolą aplikacji (forSalon): cancel salonu A
 *     zmienia tylko wiersz A; checkout czyta plan pod rolą aplikacji.
 * (d) Baza z `INTEGRATION_POSTGRES_URL` + ochrona hosta z seeda (#56)
 *     (`pg-harness.ts`); przy `CI=true` bez adresu — błąd, nie skip. Własne
 *     wiersze (user, salon, plan) z unikalnymi id, sprzątane w `afterAll` albo w `finally` przypadku, który je wstawia.
 *
 * Uruchomienie: `INTEGRATION_POSTGRES_URL=postgresql://…@localhost:5432/pos_dev pnpm test:pg`
 * (baza z zastosowanymi migracjami; test nie uruchamia `db:*` ani seeda).
 */
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { POST as registerSubscription } from "@/app/api/register-subscription/route";
import { POST as stripeWebhook } from "@/app/api/stripe/webhook/route";
import { POST as cancelSubscription } from "@/app/api/subscriptions/cancel/route";
import { POST as checkoutSubscription } from "@/app/api/subscriptions/checkout/route";
import { DELETE as cancelDowngrade, POST as downgrade } from "@/app/api/subscriptions/downgrade/route";
import { logger } from "@/lib/logger";
import { strictRateLimit } from "@/lib/rate-limit";
import { salonSubscriptions, salons, subscriptionPayments, subscriptionPlans, user } from "@/lib/schema";
import { forSalon } from "@/lib/server/repository";
import { getCurrentPlan, getSalonAccess } from "@/lib/subscription";
import {
  confirmSubscriptionCheckout,
  type SubscriptionCheckoutSession,
} from "@/lib/subscription-confirmation";
import { SUBSCRIPTION_LOCK_NAMESPACE } from "@/lib/subscription-lock-namespace";
import { withSalonSubscriptionLock, withStripeSubscriptionLock } from "@/lib/subscription-locks";
import { isUniqueViolation } from "@/lib/subscription-predicates";

const h = await vi.hoisted(async () => (await import("./pg-harness")).createIntegrationDb());

vi.mock("@/lib/db", () => ({
  get db() {
    if (!h) throw new Error("INTEGRATION_POSTGRES_URL not set");
    return h.db;
  },
}));
const { getStripeMock } = vi.hoisted(() => ({ getStripeMock: vi.fn() }));
vi.mock("@/lib/stripe", () => ({
  getStripe: () => getStripeMock(),
  isStripeWebhookConfigured: () => true,
  getStripeWebhookSecret: () => "mock-webhook-secret",
}));
vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
// Atrapami są m.in. sesja (auth-middleware, get-user-salon), Stripe, logger i lista PLANS_ON_SALE — trasy cancel/register-subscription działają na prawdziwej bazie.
// Atrapa podmienia tylko eksport PLANS_ON_SALE na listę ze slugiem planu testowego, bo schemat
// body trasy register-subscription przyjmuje wyłącznie elementy tej listy; reszta modułu jest prawdziwa.
const { testPlanSlug } = vi.hoisted(() => ({ testPlanSlug: `it-t3-${crypto.randomUUID().slice(0, 8)}` }));
vi.mock("@/lib/plan-catalog", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/plan-catalog")>()),
  PLANS_ON_SALE: [testPlanSlug],
}));
const { sessionUser, sessionSalonId } = vi.hoisted(() => ({
  sessionUser: { current: { id: "", name: "IT", email: "it@example.invalid" } },
  sessionSalonId: { current: "" },
}));
vi.mock("@/lib/auth-middleware", () => ({
  requireAuth: async () => ({ user: sessionUser.current }),
  isAuthError: () => false,
}));
vi.mock("@/lib/get-user-salon", () => ({
  getUserSalonId: async () => sessionSalonId.current || null,
}));

// ---------------------------------------------------------------- atrapa Stripe

interface FakeStripeSub {
  id: string;
  status: string;
  canceled_at?: number | null;
  cancel_at_period_end?: boolean;
  trial_end?: number | null;
  items: { data: Array<{ current_period_start: number; current_period_end: number }> };
}

const PERIOD = { current_period_start: 1783296000, current_period_end: 1785888000 };
const stripeState = new Map<string, FakeStripeSub>();
/** Bariera na NASTĘPNYM odczycie danej subskrypcji: odczyt czeka na `release`. */
const gates = new Map<string, { reached: () => void; wait: Promise<void> }>();
let randomReadDelayMs = 0;
/** Bariera i błąd NASTĘPNEGO `subscriptions.update` (anulowanie w trasie cancel). */
let updateGate: { reached: () => void; wait: Promise<void> } | null = null;
let failNextUpdate = false;

function gateNextUpdate() {
  let release!: () => void;
  let reached!: () => void;
  const wait = new Promise<void>((r) => (release = r));
  const reachedP = new Promise<void>((r) => (reached = r));
  updateGate = { reached, wait };
  return { reached: reachedP, release };
}

function setStripe(id: string, status: string, extra: Partial<FakeStripeSub> = {}) {
  stripeState.set(id, { id, status, items: { data: [PERIOD] }, ...extra });
}

function gateNextRetrieve(id: string) {
  let release!: () => void;
  let reached!: () => void;
  const wait = new Promise<void>((r) => (release = r));
  const reachedP = new Promise<void>((r) => (reached = r));
  gates.set(id, { reached, wait });
  return { reached: reachedP, release };
}

const fakeStripe = {
  subscriptions: {
    retrieve: vi.fn(async (id: string) => {
      // Stan z chwili odczytu (jak w Stripe), potem ewentualne czekanie.
      const snapshot = structuredClone(stripeState.get(id));
      const gate = gates.get(id);
      if (gate) {
        gates.delete(id);
        gate.reached();
        await gate.wait;
      }
      if (randomReadDelayMs) await new Promise((r) => setTimeout(r, Math.random() * randomReadDelayMs));
      if (!snapshot) throw new Error(`no such subscription: ${id}`);
      return snapshot;
    }),
    update: vi.fn(async (id: string, params: { cancel_at_period_end?: boolean }) => {
      const gate = updateGate;
      if (gate) {
        updateGate = null;
        gate.reached();
        await gate.wait;
      }
      if (failNextUpdate) {
        failNextUpdate = false;
        throw Object.assign(new Error("Stripe API unavailable"), { type: "StripeAPIError" });
      }
      const current = stripeState.get(id);
      if (!current) throw new Error(`no such subscription: ${id}`);
      const next = { ...current, ...params };
      stripeState.set(id, next);
      return structuredClone(next);
    }),
  },
  webhooks: { constructEvent: vi.fn() },
  checkout: {
    sessions: {
      create: vi.fn(async () => ({ id: "cs_it_checkout", url: "https://checkout.example.invalid/cs_it_checkout" })),
    },
  },
};

// ---------------------------------------------------------------- dane testu

const RUN = randomUUID().slice(0, 8);
const USER_ID = `it-t3-${RUN}`;
let salonId = "";
let planId = "";

async function deliver(type: string, object: Record<string, unknown>) {
  const eventId = `evt_${type}_${randomUUID().slice(0, 8)}`;
  fakeStripe.webhooks.constructEvent.mockReturnValueOnce({ id: eventId, type, data: { object } });
  const res = await stripeWebhook(
    new Request("http://localhost/api/stripe/webhook", {
      method: "POST",
      headers: { "stripe-signature": "t=1,v1=ok" },
      body: "{}",
    })
  );
  return { status: res.status, eventId };
}

function session(stripeSubId: string, sessionId = `cs_${randomUUID().slice(0, 12)}`): SubscriptionCheckoutSession {
  return {
    id: sessionId,
    mode: "subscription",
    payment_status: "paid",
    amount_total: 14900,
    currency: "pln",
    metadata: { salonId, planId },
    customer: "cus_it",
    subscription: stripeSubId,
  };
}

function confirm(s: SubscriptionCheckoutSession) {
  return confirmSubscriptionCheckout(fakeStripe as never, s, { expectedSalonId: salonId });
}

type InvoiceLinePeriod = { start: number; end: number };

/** Faktura odnowienia; `linePeriods` = okresy linii faktury (bez parametru — faktura bez linii). */
const invoicePaid = (stripeSubId: string, linePeriods?: InvoiceLinePeriod[]) => ({
  id: `in_${randomUUID().slice(0, 8)}`,
  subscription: stripeSubId,
  payment_intent: `pi_${randomUUID().slice(0, 12)}`,
  billing_reason: "subscription_cycle",
  amount_paid: 14900,
  currency: "pln",
  ...(linePeriods ? { lines: { data: linePeriods.map((period) => ({ period })), has_more: false } } : {}),
});

const DAY = 86_400;
/** Okres po PERIOD (odnowienie o kolejny cykl). */
const NEXT_PERIOD = { start: PERIOD.current_period_end, end: PERIOD.current_period_end + 30 * DAY };
const at = (unixSeconds: number) => new Date(unixSeconds * 1000);

async function rows() {
  return h!.db.select().from(salonSubscriptions).where(eq(salonSubscriptions.salonId, salonId));
}
async function payments() {
  return h!.db.select().from(subscriptionPayments).where(eq(subscriptionPayments.salonId, salonId));
}

/**
 * Czeka, aż `count` połączeń CZEKA (granted = false) na blokadę
 * `namespace`/`key` w `pg_locks`. Zwraca false po `timeoutMs` — wtedy nikt
 * nie czekał (np. odczyt wiersza poza blokadą), a asercja w teście pada.
 */
async function waitForLockWaiters(
  namespace: keyof typeof SUBSCRIPTION_LOCK_NAMESPACE,
  key: string,
  count = 1,
  timeoutMs = 3_000
): Promise<boolean> {
  const ns = SUBSCRIPTION_LOCK_NAMESPACE[namespace];
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const [r] = await h!.observer<{ n: number }[]>`
      select count(*)::int as n from pg_locks
      where locktype = 'advisory' and not granted
        and classid = ${ns}::oid and objsubid = 2
        and objid = (hashtext(${key})::bigint & 4294967295)::oid`;
    if ((r?.n ?? 0) >= count) return true;
    await new Promise((res) => setImmediate(res));
  }
  return false;
}

/** Jawna transakcja testu trzymająca blokadę stripe_sub (bariera „pierwszego połączenia”). */
function holdStripeSubLock(stripeSubId: string) {
  let release!: () => void;
  let held!: () => void;
  const releaseP = new Promise<void>((r) => (release = r));
  const heldP = new Promise<void>((r) => (held = r));
  const done = withStripeSubscriptionLock(stripeSubId, async () => {
    held();
    await releaseP;
  });
  return { held: heldP, release, done };
}

const suite = h ? describe : describe.skip;

suite("blokady subskrypcji — prawdziwy Postgres", () => {
  beforeAll(async () => {
    const db = h!.db;
    await db.insert(user).values({ id: USER_ID, name: "IT T3", email: `${USER_ID}@example.invalid` });
    const [salon] = await db.insert(salons).values({ name: `IT T3 ${RUN}`, ownerId: USER_ID }).returning();
    const [plan] = await db
      .insert(subscriptionPlans)
      .values({ name: "IT T3", slug: testPlanSlug, priceMonthly: "149.00" })
      .returning();
    salonId = salon!.id;
    planId = plan!.id;
    getStripeMock.mockReturnValue(fakeStripe);
    sessionUser.current = { id: USER_ID, name: "IT T3", email: `${USER_ID}@example.invalid` };
    sessionSalonId.current = salonId;
  });

  afterAll(async () => {
    if (!h) return;
    const db = h.db;
    // Kaskada z salonu usuwa subskrypcje i płatności; plan (restrict) potem.
    if (salonId) await db.delete(salons).where(eq(salons.id, salonId));
    if (planId) await db.delete(subscriptionPlans).where(eq(subscriptionPlans.id, planId));
    await db.delete(user).where(eq(user.id, USER_ID));
    await h.end();
  });

  beforeEach(async () => {
    vi.mocked(logger.warn).mockClear();
    vi.mocked(logger.error).mockClear();
    stripeState.clear();
    gates.clear();
    randomReadDelayMs = 0;
    updateGate = null;
    failNextUpdate = false;
    await h!.db.delete(salonSubscriptions).where(eq(salonSubscriptions.salonId, salonId));
  });

  it("dwuargumentowa blokada widoczna w pg_locks w przestrzeni stripe_sub (sanity)", async () => {
    const sub = `sub_it_${randomUUID().slice(0, 8)}`;
    const barrier = holdStripeSubLock(sub);
    await barrier.held;
    const second = withStripeSubscriptionLock(sub, async () => "second");
    expect(await waitForLockWaiters("stripeSub", sub)).toBe(true);
    barrier.release();
    await barrier.done;
    expect(await second).toBe("second");
  });

  it("(a) drugi confirm tej samej sesji czeka na commit pierwszego → jeden wiersz, jedna płatność, alreadyConfirmed", async () => {
    const sub = `sub_it_${randomUUID().slice(0, 8)}`;
    setStripe(sub, "active");
    const s = session(sub);
    const gate = gateNextRetrieve(sub);

    const first = confirm(s);
    await gate.reached; // pierwszy trzyma stripe_sub i czeka na Stripe
    const second = confirm(s);
    expect(await waitForLockWaiters("stripeSub", sub)).toBe(true);
    gate.release();

    const [r1, r2] = await Promise.all([first, second]);
    expect(r1).toEqual(expect.objectContaining({ ok: true, alreadyConfirmed: false }));
    expect(r2).toEqual(expect.objectContaining({ ok: true, alreadyConfirmed: true }));
    expect((await rows()).map((r) => r.status)).toEqual(["active"]);
    expect(await payments()).toHaveLength(1);
  });

  it("okres próbny na jednym planie, potwierdzenie sesji z innym planem → ten sam wiersz: active, planId z sesji, jedna płatność", async () => {
    const db = h!.db;
    const [planB] = await db
      .insert(subscriptionPlans)
      .values({ name: "IT T3 B", slug: `${testPlanSlug}-b`, priceMonthly: "49.00" })
      .returning();
    try {
      const [trial] = await db
        .insert(salonSubscriptions)
        .values({ salonId, planId, status: "trialing", trialEndsAt: new Date(Date.now() + 7 * DAY * 1000) })
        .returning();
      const sub = `sub_it_${randomUUID().slice(0, 8)}`;
      setStripe(sub, "active");

      const result = await confirm({ ...session(sub), metadata: { salonId, planId: planB!.id } });

      expect(result).toEqual(expect.objectContaining({ ok: true, alreadyConfirmed: false }));
      expect(result.ok && result.plan?.id).toBe(planB!.id);
      const all = await rows();
      expect(all).toHaveLength(1);
      expect(all[0]!.id).toBe(trial!.id);
      expect(all[0]!.status).toBe("active");
      expect(all[0]!.planId).toBe(planB!.id);
      expect(all[0]!.stripeSubscriptionId).toBe(sub);
      expect(all[0]!.trialEndsAt).toBeNull();
      expect(all[0]!.currentPeriodStart).toEqual(at(PERIOD.current_period_start));
      expect(all[0]!.currentPeriodEnd).toEqual(at(PERIOD.current_period_end));
      const paid = await payments();
      expect(paid).toHaveLength(1);
      expect(paid[0]!.subscriptionId).toBe(trial!.id);
    } finally {
      await db.delete(salonSubscriptions).where(eq(salonSubscriptions.salonId, salonId));
      await db.delete(subscriptionPlans).where(eq(subscriptionPlans.id, planB!.id));
    }
  });

  it("(c1) confirm, potem deleted w trakcie: deleted czeka na blokadę, wynik canceled", async () => {
    const sub = `sub_it_${randomUUID().slice(0, 8)}`;
    setStripe(sub, "active");
    const gate = gateNextRetrieve(sub);

    const confirming = confirm(session(sub));
    await gate.reached; // confirm przeczytał „active” i trzyma stripe_sub
    setStripe(sub, "canceled", { canceled_at: PERIOD.current_period_start });
    const deleted = deliver("customer.subscription.deleted", { id: sub });

    expect(await waitForLockWaiters("stripeSub", sub)).toBe(true); // webhook czeka, nie „brak wiersza”
    gate.release();

    expect(await confirming).toEqual(expect.objectContaining({ ok: true }));
    expect((await deleted).status).toBe(200);
    expect((await rows()).map((r) => [r.stripeSubscriptionId, r.status])).toEqual([[sub, "canceled"]]);
  });

  it("(c2) deleted bez wiersza → 2xx + warn z id zdarzenia; potem confirm czyta canceled → 409, zero zapisów", async () => {
    const sub = `sub_it_${randomUUID().slice(0, 8)}`;
    setStripe(sub, "canceled", { canceled_at: PERIOD.current_period_start });

    const { status, eventId } = await deliver("customer.subscription.deleted", { id: sub });
    expect(status).toBe(200);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("No local subscription"),
      expect.objectContaining({ eventId, stripeSubscriptionId: sub })
    );

    const result = await confirm(session(sub));
    expect(result).toEqual(expect.objectContaining({ ok: false, status: 409, code: "SUBSCRIPTION_NOT_ACTIVE" }));
    expect(await rows()).toEqual([]);
    expect(await payments()).toEqual([]);
  });

  it("(c2') confirm czeka na blokadę, a w tym czasie Stripe anuluje: odczyt PO blokadzie → 409, zero zapisów", async () => {
    const sub = `sub_it_${randomUUID().slice(0, 8)}`;
    setStripe(sub, "active");
    const barrier = holdStripeSubLock(sub); // pierwsze połączenie (np. webhook deleted w toku)
    await barrier.held;

    const confirming = confirm(session(sub));
    expect(await waitForLockWaiters("stripeSub", sub)).toBe(true);
    setStripe(sub, "canceled", { canceled_at: PERIOD.current_period_start });
    barrier.release();
    await barrier.done;

    expect(await confirming).toEqual(expect.objectContaining({ ok: false, status: 409 }));
    expect(await rows()).toEqual([]);
  });

  it("(c3) deleted, potem późne invoice.paid → zostaje canceled, płatność zapisana", async () => {
    const sub = `sub_it_${randomUUID().slice(0, 8)}`;
    setStripe(sub, "active");
    expect(await confirm(session(sub))).toEqual(expect.objectContaining({ ok: true }));

    setStripe(sub, "canceled", { canceled_at: PERIOD.current_period_start });
    expect((await deliver("customer.subscription.deleted", { id: sub })).status).toBe(200);
    const late = invoicePaid(sub);
    expect((await deliver("invoice.paid", late)).status).toBe(200);

    expect((await rows()).map((r) => r.status)).toEqual(["canceled"]);
    expect((await payments()).map((p) => p.stripePaymentIntentId)).toContain(late.payment_intent);
  });

  // (c3') przez prawdziwą trasę `subscriptions/cancel`: describe „T3b” niżej.
  it("(c3') lokalne canceled, Stripe active z cancel_at_period_end=true → późne updated i invoice.paid nie wskrzeszają", async () => {
    const sub = `sub_it_${randomUUID().slice(0, 8)}`;
    setStripe(sub, "active");
    expect(await confirm(session(sub))).toEqual(expect.objectContaining({ ok: true }));
    // stan po anulowaniu w panelu: Stripe active do końca okresu, cancel_at_period_end
    setStripe(sub, "active", { cancel_at_period_end: true });
    await h!.db
      .update(salonSubscriptions)
      .set({ status: "canceled", canceledAt: new Date() })
      .where(eq(salonSubscriptions.salonId, salonId));

    expect((await deliver("customer.subscription.updated", { id: sub })).status).toBe(200);
    expect((await deliver("invoice.paid", invoicePaid(sub))).status).toBe(200);
    expect((await rows()).map((r) => r.status)).toEqual(["canceled"]);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("(c3'' bliźniak) lokalne canceled bez potwierdzenia w Stripe (cancel_at_period_end=false) → stan ze Stripe + manual handling", async () => {
    const sub = `sub_it_${randomUUID().slice(0, 8)}`;
    setStripe(sub, "active");
    expect(await confirm(session(sub))).toEqual(expect.objectContaining({ ok: true }));
    // dryf: lokalne canceled, a Stripe dalej odnawia (np. dawne anulowanie mimo błędu Stripe)
    setStripe(sub, "active", { cancel_at_period_end: false });
    await h!.db
      .update(salonSubscriptions)
      .set({ status: "canceled", canceledAt: new Date() })
      .where(eq(salonSubscriptions.salonId, salonId));

    expect((await deliver("invoice.paid", invoicePaid(sub))).status).toBe(200);

    expect((await rows()).map((r) => [r.status, r.canceledAt])).toEqual([["active", null]]);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("manual handling"),
      expect.objectContaining({ stripeSubscriptionId: sub, cancelAtPeriodEnd: false })
    );
  });

  it(
    "(c4) 50 iteracji confirm ‖ updated ‖ invoice.paid z losowym opóźnieniem: zero 40P01/5xx, stan = Stripe",
    async () => {
      const statuses = ["active", "trialing", "past_due", "canceled"] as const;
      const failures: string[] = [];
      randomReadDelayMs = 8;

      for (let i = 0; i < 50; i++) {
        await h!.db.delete(salonSubscriptions).where(eq(salonSubscriptions.salonId, salonId));
        const sub = `sub_it_${RUN}_${i}`;
        const stripeStatus = statuses[i % statuses.length]!;
        setStripe(sub, stripeStatus, {
          ...(stripeStatus === "trialing" ? { trial_end: PERIOD.current_period_end } : {}),
          ...(stripeStatus === "canceled" ? { canceled_at: PERIOD.current_period_start } : {}),
        });
        const jitter = () => new Promise((r) => setTimeout(r, Math.random() * 15));

        const [c, u, p] = await Promise.all([
          jitter().then(() => confirm(session(sub))),
          jitter().then(() => deliver("customer.subscription.updated", { id: sub })),
          jitter().then(() => deliver("invoice.paid", invoicePaid(sub))),
        ]);

        if (!c.ok && c.status !== 409) failures.push(`#${i} confirm ${c.status} ${c.code}`);
        if (u.status !== 200) failures.push(`#${i} updated ${u.status}`);
        if (p.status !== 200) failures.push(`#${i} invoice.paid ${p.status}`);

        const expected = stripeStatus === "active" || stripeStatus === "trialing" ? [[sub, stripeStatus]] : [];
        const actual = (await rows()).map((r) => [r.stripeSubscriptionId, r.status]);
        if (JSON.stringify(actual) !== JSON.stringify(expected)) {
          failures.push(`#${i} state ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
        }
      }

      const deadlocks = vi
        .mocked(logger.error)
        .mock.calls.concat(vi.mocked(logger.warn).mock.calls)
        .filter((call) => JSON.stringify(call, (_k, v) => (v instanceof Error ? { ...v, message: v.message } : v)).includes("40P01"));
      expect(failures).toEqual([]);
      expect(deadlocks).toEqual([]);
    },
    60_000
  );

  describe("T3b — anulowanie przez trasę cancel i niezmiennik „jeden bieżący wiersz”", () => {
    const cancel = async () => {
      const res = await cancelSubscription();
      return { status: res.status, body: (await res.json()) as Record<string, unknown> };
    };

    it("(c3') cancel w panelu (Stripe potwierdza cap=true) → późne updated i invoice.paid nie wskrzeszają", async () => {
      const sub = `sub_it_${randomUUID().slice(0, 8)}`;
      setStripe(sub, "active");
      expect(await confirm(session(sub))).toEqual(expect.objectContaining({ ok: true }));

      const { status, body } = await cancel();
      expect(status).toBe(200);
      expect(body.success).toBe(true);
      expect(stripeState.get(sub)?.cancel_at_period_end).toBe(true);
      expect((await rows()).map((r) => r.status)).toEqual(["canceled"]);

      expect((await deliver("customer.subscription.updated", { id: sub })).status).toBe(200);
      expect((await deliver("invoice.paid", invoicePaid(sub))).status).toBe(200);
      expect((await rows()).map((r) => r.status)).toEqual(["canceled"]);
      expect(logger.error).not.toHaveBeenCalled();
    });

    it("cancel przy błędzie Stripe → 502, wiersz zostaje active, Stripe bez zmian", async () => {
      const sub = `sub_it_${randomUUID().slice(0, 8)}`;
      setStripe(sub, "active");
      expect(await confirm(session(sub))).toEqual(expect.objectContaining({ ok: true }));
      failNextUpdate = true;

      const { status, body } = await cancel();

      expect(status).toBe(502);
      expect(body.code).toBe("STRIPE_ERROR");
      expect((await rows()).map((r) => [r.status, r.canceledAt])).toEqual([["active", null]]);
      expect(stripeState.get(sub)?.cancel_at_period_end).toBeUndefined();
    });

    it("cancel ‖ updated: webhook czeka na stripe_sub (pg_locks), czyta Stripe PO anulowaniu → canceled", async () => {
      const sub = `sub_it_${randomUUID().slice(0, 8)}`;
      setStripe(sub, "active");
      expect(await confirm(session(sub))).toEqual(expect.objectContaining({ ok: true }));
      const gate = gateNextUpdate();

      const canceling = cancel();
      await gate.reached; // cancel trzyma stripe_sub i czeka na Stripe
      const updated = deliver("customer.subscription.updated", { id: sub });
      expect(await waitForLockWaiters("stripeSub", sub)).toBe(true);
      gate.release();

      expect((await canceling).status).toBe(200);
      expect((await updated).status).toBe(200);
      expect((await rows()).map((r) => r.status)).toEqual(["canceled"]);
      expect(logger.error).not.toHaveBeenCalled();
    });

    it("indeks salon_subscriptions_salon_current_uq: drugi bieżący wiersz salonu → 23505", async () => {
      await h!.db.insert(salonSubscriptions).values({ salonId, planId, status: "active" });
      await expect(
        h!.db.insert(salonSubscriptions).values({ salonId, planId, status: "trialing" })
      ).rejects.toSatisfy(isUniqueViolation);
      // canceled obok bieżącego — dozwolone (historia)
      await h!.db.insert(salonSubscriptions).values({ salonId, planId, status: "canceled" });
      expect((await rows()).map((r) => r.status).sort()).toEqual(["active", "canceled"]);
    });

    it("indeks salons_owner_id_uq: drugi salon tego samego konta → 23505", async () => {
      await expect(
        h!.db.insert(salons).values({ name: `IT T3 dup ${RUN}`, ownerId: USER_ID })
      ).rejects.toSatisfy(isUniqueViolation);
    });

    it("register-subscription ×2 równolegle dla nowego konta → jedno 200 + jedno 409, jeden salon, jeden trial", async () => {
      const freshId = `it-t3-b-${RUN}`; // prefiks it-t3- = sprzątanie z pg-harness.ts
      await h!.db.insert(user).values({ id: freshId, name: "IT T3b", email: `${freshId}@example.invalid` });
      const previous = sessionUser.current;
      sessionUser.current = { id: freshId, name: "IT T3b", email: `${freshId}@example.invalid` };
      try {
        const [planRow] = await h!.db.select().from(subscriptionPlans).where(eq(subscriptionPlans.id, planId));
        const register = async () => {
          const res = await registerSubscription(
            new Request("http://localhost/api/register-subscription", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ planSlug: planRow!.slug }),
            }) as never
          );
          return res.status;
        };

        const statuses = (await Promise.all([register(), register()])).sort();

        expect(statuses).toEqual([200, 409]);
        const owned = await h!.db.select().from(salons).where(eq(salons.ownerId, freshId));
        expect(owned).toHaveLength(1);
        const subs = await h!.db
          .select()
          .from(salonSubscriptions)
          .where(eq(salonSubscriptions.salonId, owned[0]!.id));
        expect(subs.map((s) => s.status)).toEqual(["trialing"]);
      } finally {
        sessionUser.current = previous;
        await h!.db.delete(salons).where(eq(salons.ownerId, freshId));
        await h!.db.delete(user).where(eq(user.id, freshId));
      }
    });
  });

  describe("invoice.paid — okres z linii opłaconej faktury, nigdy wstecz", () => {
    const period = async () => (await rows()).map((r) => [r.currentPeriodStart, r.currentPeriodEnd]);

    /** Wiersz bez okresu (current_period_* NULL) powiązany z subskrypcją Stripe. */
    async function rowWithoutPeriod(sub: string) {
      await h!.db.insert(salonSubscriptions).values({ salonId, planId, status: "active", stripeSubscriptionId: sub });
      expect(await period()).toEqual([[null, null]]);
    }

    it("(p1) odnowienie: faktura z nowszym okresem → okres = okres linii", async () => {
      const sub = `sub_it_${randomUUID().slice(0, 8)}`;
      setStripe(sub, "active");
      expect(await confirm(session(sub))).toEqual(expect.objectContaining({ ok: true }));
      expect(await period()).toEqual([[at(PERIOD.current_period_start), at(PERIOD.current_period_end)]]);

      expect((await deliver("invoice.paid", invoicePaid(sub, [NEXT_PERIOD]))).status).toBe(200);
      expect(await period()).toEqual([[at(NEXT_PERIOD.start), at(NEXT_PERIOD.end)]]);
      expect((await rows()).map((r) => r.status)).toEqual(["active"]);
    });

    it("(p2) starsza faktura po nowszej → okres bez zmian", async () => {
      const sub = `sub_it_${randomUUID().slice(0, 8)}`;
      setStripe(sub, "active");
      expect(await confirm(session(sub))).toEqual(expect.objectContaining({ ok: true }));
      expect((await deliver("invoice.paid", invoicePaid(sub, [NEXT_PERIOD]))).status).toBe(200);

      const older = { start: PERIOD.current_period_start, end: PERIOD.current_period_end };
      expect((await deliver("invoice.paid", invoicePaid(sub, [older]))).status).toBe(200);
      expect(await period()).toEqual([[at(NEXT_PERIOD.start), at(NEXT_PERIOD.end)]]);
    });

    it("(p3) deleted, potem późna faktura z dalszym okresem → zostaje canceled, okres przedłużony", async () => {
      const sub = `sub_it_${randomUUID().slice(0, 8)}`;
      setStripe(sub, "active");
      expect(await confirm(session(sub))).toEqual(expect.objectContaining({ ok: true }));
      setStripe(sub, "canceled", { canceled_at: PERIOD.current_period_start });
      expect((await deliver("customer.subscription.deleted", { id: sub })).status).toBe(200);
      const [before] = await rows();
      expect(before?.status).toBe("canceled");

      const late = invoicePaid(sub, [NEXT_PERIOD]);
      expect((await deliver("invoice.paid", late)).status).toBe(200);

      const [after] = await rows();
      expect(after).toEqual({
        ...before,
        currentPeriodStart: at(NEXT_PERIOD.start),
        currentPeriodEnd: at(NEXT_PERIOD.end),
      });
      expect((await payments()).map((p) => p.stripePaymentIntentId)).toContain(late.payment_intent);
    });

    it("(p4) faktura bez linii → okres bez zmian, płatność zapisana, ostrzeżenie", async () => {
      const sub = `sub_it_${randomUUID().slice(0, 8)}`;
      setStripe(sub, "active");
      expect(await confirm(session(sub))).toEqual(expect.objectContaining({ ok: true }));

      const inv = invoicePaid(sub);
      const { status, eventId } = await deliver("invoice.paid", inv);
      expect(status).toBe(200);
      expect(await period()).toEqual([[at(PERIOD.current_period_start), at(PERIOD.current_period_end)]]);
      expect((await payments()).map((p) => p.stripePaymentIntentId)).toContain(inv.payment_intent);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("without a billing period"),
        expect.objectContaining({ eventId, linesHasMore: false })
      );
    });

    it("(p5) wiersz z current_period_end NULL + faktura z okresem → oba pola ustawione", async () => {
      const sub = `sub_it_${randomUUID().slice(0, 8)}`;
      setStripe(sub, "active");
      await rowWithoutPeriod(sub);

      expect((await deliver("invoice.paid", invoicePaid(sub, [NEXT_PERIOD]))).status).toBe(200);
      expect(await period()).toEqual([[at(NEXT_PERIOD.start), at(NEXT_PERIOD.end)]]);
    });

    it("(p6) ponowienie tego samego zdarzenia → wiersz identyczny, jedna płatność", async () => {
      const sub = `sub_it_${randomUUID().slice(0, 8)}`;
      setStripe(sub, "active");
      expect(await confirm(session(sub))).toEqual(expect.objectContaining({ ok: true }));
      const inv = invoicePaid(sub, [NEXT_PERIOD]);

      expect((await deliver("invoice.paid", inv)).status).toBe(200);
      const first = await rows();
      expect((await deliver("invoice.paid", inv)).status).toBe(200);

      expect(await rows()).toEqual(first);
      expect(first.map((r) => [r.currentPeriodStart, r.currentPeriodEnd])).toEqual([
        [at(NEXT_PERIOD.start), at(NEXT_PERIOD.end)],
      ]);
      expect((await payments()).filter((p) => p.stripePaymentIntentId === inv.payment_intent)).toHaveLength(1);
    });

    it("(p7) faktura z tym samym końcem i innym początkiem → current_period_start bez zmian", async () => {
      const sub = `sub_it_${randomUUID().slice(0, 8)}`;
      setStripe(sub, "active");
      expect(await confirm(session(sub))).toEqual(expect.objectContaining({ ok: true }));

      const sameEnd = { start: PERIOD.current_period_start - DAY, end: PERIOD.current_period_end };
      expect((await deliver("invoice.paid", invoicePaid(sub, [sameEnd]))).status).toBe(200);
      expect(await period()).toEqual([[at(PERIOD.current_period_start), at(PERIOD.current_period_end)]]);
    });

    it("(p8) wiersz z current_period_end NULL + sama pozycja jednorazowa → oba pola NULL", async () => {
      const sub = `sub_it_${randomUUID().slice(0, 8)}`;
      setStripe(sub, "active");
      await rowWithoutPeriod(sub);

      const oneTime = { start: NEXT_PERIOD.start, end: NEXT_PERIOD.start };
      expect((await deliver("invoice.paid", invoicePaid(sub, [oneTime]))).status).toBe(200);
      expect(await period()).toEqual([[null, null]]);
    });
  });

  describe("#193 S1a — bramki planu pod forSalon (rola aplikacji, RLS salonu)", () => {
    const otherUserId = `it-t3-s1a-${RUN}`; // prefiks it-t3- = sprzątanie z pg-harness.ts
    let otherSalonId = "";

    beforeAll(async () => {
      await h!.db.insert(user).values({ id: otherUserId, name: "IT S1a", email: `${otherUserId}@example.invalid` });
      const [other] = await h!.db.insert(salons).values({ name: `IT S1a ${RUN}`, ownerId: otherUserId }).returning();
      otherSalonId = other!.id;
    });

    afterAll(async () => {
      // Kaskada z salonu usuwa jego subskrypcje.
      if (otherSalonId) await h!.db.delete(salons).where(eq(salons.id, otherSalonId));
      await h!.db.delete(user).where(eq(user.id, otherUserId));
    });

    it("salon A active, salon B trial wygasły: stan z wierszy (nie unavailable), A nie widzi wierszy B", async () => {
      const periodEnd = new Date(Date.now() + 20 * DAY * 1000);
      await h!.db.insert(salonSubscriptions).values({ salonId, planId, status: "active", currentPeriodEnd: periodEnd });
      await h!.db.insert(salonSubscriptions).values({
        salonId: otherSalonId,
        planId,
        status: "trialing",
        trialEndsAt: new Date(Date.now() - DAY * 1000),
      });

      const accessA = await getSalonAccess(salonId);
      expect(accessA.state, "unavailable = brak roli myhelper_app albo GRANT na bazie testowej").not.toBe("unavailable");
      expect(accessA).toEqual({ state: "active", mode: "full", planSlug: testPlanSlug, until: periodEnd });
      expect(await getCurrentPlan(salonId)).toEqual({ slug: testPlanSlug, name: "IT T3", status: "active" });
      expect(await getCurrentPlan()).toEqual({ slug: testPlanSlug, name: "IT T3", status: "active" });

      const accessB = await getSalonAccess(otherSalonId);
      expect(accessB.state).not.toBe("unavailable");
      expect(accessB).toEqual({ state: "expired", mode: "read_only", planSlug: null, until: null });
      expect(await getCurrentPlan(otherSalonId)).toEqual({ slug: "basic", name: "Basic", status: "trial_expired" });
      expect(logger.error).not.toHaveBeenCalled();

      // Druga tama: pod kontekstem salonu A zapytanie BEZ filtra salonu widzi tylko wiersze A.
      const visible = await forSalon(salonId).raw((tx) =>
        tx.select({ salonId: salonSubscriptions.salonId }).from(salonSubscriptions)
      );
      expect(visible.length).toBeGreaterThan(0);
      expect(new Set(visible.map((r) => r.salonId))).toEqual(new Set([salonId]));
    });

    it("salon bez wiersza subskrypcji → none (odczyt wykonany, nie unavailable)", async () => {
      expect(await getSalonAccess(salonId)).toEqual({ state: "none", mode: "read_only", planSlug: null, until: null });
      expect(logger.error).not.toHaveBeenCalled();
    });
  });

  describe("#193 — downgrade pod blokadą salonu w transakcji forSalon (rola aplikacji)", () => {
    const appRole = process.env.MYHELPER_APP_DB_ROLE ?? "myhelper_app";
    let higherPlanId = "";
    const periodEnd = new Date(Date.now() + 20 * DAY * 1000);

    const post = async () => {
      const res = await downgrade(
        new Request("http://localhost/api/subscriptions/downgrade", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ targetPlanSlug: testPlanSlug }),
        })
      );
      return { status: res.status, body: (await res.json()) as Record<string, unknown> };
    };
    const del = async () => {
      const res = await cancelDowngrade();
      return { status: res.status, body: (await res.json()) as Record<string, unknown> };
    };
    const routes = [
      ["POST", post],
      ["DELETE", del],
    ] as const;

    /** Wiersz active na droższym planie; dla DELETE z zaplanowanym obniżeniem do planu testu. */
    async function activeOnHigherPlan(scheduled: boolean) {
      await h!.db.insert(salonSubscriptions).values({
        salonId,
        planId: higherPlanId,
        status: "active",
        currentPeriodEnd: periodEnd,
        ...(scheduled ? { scheduledPlanId: planId, scheduledChangeAt: periodEnd } : {}),
      });
    }

    /** Jawna transakcja testu trzymająca blokadę salonu (też przez forSalon). */
    function holdSalonLock() {
      let release!: () => void;
      let held!: () => void;
      const releaseP = new Promise<void>((r) => (release = r));
      const heldP = new Promise<void>((r) => (held = r));
      const done = withSalonSubscriptionLock(salonId, async () => {
        held();
        await releaseP;
      });
      return { held: heldP, release, done };
    }

    beforeAll(async () => {
      const [higher] = await h!.db
        .insert(subscriptionPlans)
        .values({ name: "IT wyższy", slug: `${testPlanSlug}-hi`, priceMonthly: "299.00" })
        .returning();
      higherPlanId = higher!.id;
    });

    afterAll(async () => {
      // Wiersze salonu wskazują plan (restrict) — najpierw one, potem plan.
      await h!.db.delete(salonSubscriptions).where(eq(salonSubscriptions.salonId, salonId));
      if (higherPlanId) await h!.db.delete(subscriptionPlans).where(eq(subscriptionPlans.id, higherPlanId));
    });

    it("transakcja blokady jedzie rolą aplikacji z kontekstem salonu; lock_timeout i pg_advisory_xact_lock działają pod tą rolą", async () => {
      const seen = await withSalonSubscriptionLock(salonId, async (tx) => {
        const [r] = (await tx.execute(sql`
          select current_user::text as role,
                 current_setting('app.current_salon_id', true) as salon,
                 current_setting('lock_timeout') as lock_timeout,
                 (select count(*)::int from pg_locks
                   where locktype = 'advisory' and granted and pid = pg_backend_pid()
                     and classid = ${SUBSCRIPTION_LOCK_NAMESPACE.salon}::oid and objsubid = 2
                     and objid = (hashtext(${salonId})::bigint & 4294967295)::oid) as held`)) as unknown as Array<{
          role: string;
          salon: string;
          lock_timeout: string;
          held: number;
        }>;
        return r;
      });
      expect(seen).toEqual({ role: appRole, salon: salonId, lock_timeout: "5s", held: 1 });
    });

    it("POST 200 przy active: obniżenie zaplanowane na koniec okresu (zapis pod RLS salonu)", async () => {
      await activeOnHigherPlan(false);

      const { status, body } = await post();

      expect(status).toBe(200);
      expect(body).toEqual(
        expect.objectContaining({ success: true, currentPlan: `${testPlanSlug}-hi`, targetPlan: testPlanSlug })
      );
      expect((await rows()).map((r) => [r.status, r.scheduledPlanId, r.scheduledChangeAt])).toEqual([
        ["active", planId, periodEnd],
      ]);
      expect(logger.error).not.toHaveBeenCalled();
    });

    it("DELETE 200 przy active z zaplanowanym obniżeniem: plan i data wyczyszczone", async () => {
      await activeOnHigherPlan(true);

      const { status, body } = await del();

      expect(status).toBe(200);
      expect(body.success).toBe(true);
      expect((await rows()).map((r) => [r.status, r.scheduledPlanId, r.scheduledChangeAt])).toEqual([
        ["active", null, null],
      ]);
      expect(logger.error).not.toHaveBeenCalled();
    });

    it.each(routes)("%s 404 bez aktywnej subskrypcji (tylko canceled) → zero zapisów", async (_m, call) => {
      await h!.db.insert(salonSubscriptions).values({ salonId, planId: higherPlanId, status: "canceled" });
      const before = await rows();

      const { status } = await call();

      expect(status).toBe(404);
      expect(await rows()).toEqual(before);
      expect(logger.error).not.toHaveBeenCalled();
    });

    it.each(routes)("%s ‖ blokada salonu: trasa czeka w pg_locks (granted = false), po zwolnieniu 200", async (method, call) => {
      await activeOnHigherPlan(method === "DELETE");
      const barrier = holdSalonLock();
      await barrier.held;

      const pending = call();
      expect(await waitForLockWaiters("salon", salonId)).toBe(true);
      barrier.release();
      await barrier.done;

      expect((await pending).status).toBe(200);
      const [row] = await rows();
      expect(row?.scheduledPlanId).toBe(method === "POST" ? planId : null);
    });

    it.each(routes)(
      "%s: blokada salonu trzymana dłużej niż lock_timeout → 503 LOCK_BUSY, zero zapisów",
      async (method, call) => {
        await activeOnHigherPlan(method === "DELETE");
        const before = await rows();
        const barrier = holdSalonLock();
        await barrier.held;

        try {
          const { status, body } = await call();
          expect(status).toBe(503);
          expect(body.code).toBe("LOCK_BUSY");
        } finally {
          barrier.release();
          await barrier.done;
        }
        expect(await rows()).toEqual(before);
        expect(logger.error).not.toHaveBeenCalled();
      },
      15_000
    );
  });

  describe("cancel i checkout salonu z sesji w transakcjach forSalon (rola aplikacji)", () => {
    const otherUserId = `it-t3-cc-${RUN}`; // prefiks it-t3- = sprzątanie z pg-harness.ts
    let otherSalonId = "";

    const cancel = async () => {
      const res = await cancelSubscription();
      return { status: res.status, body: (await res.json()) as Record<string, unknown> };
    };
    const checkout = async () => {
      const res = await checkoutSubscription(
        new Request("http://localhost/api/subscriptions/checkout", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ planSlug: testPlanSlug }),
        })
      );
      return { status: res.status, body: (await res.json()) as Record<string, unknown> };
    };
    const otherRows = () =>
      h!.db.select().from(salonSubscriptions).where(eq(salonSubscriptions.salonId, otherSalonId));

    beforeAll(async () => {
      await h!.db.insert(user).values({ id: otherUserId, name: "IT CC", email: `${otherUserId}@example.invalid` });
      const [other] = await h!.db.insert(salons).values({ name: `IT CC ${RUN}`, ownerId: otherUserId }).returning();
      otherSalonId = other!.id;
    });

    afterAll(async () => {
      // Kaskada z salonu usuwa jego subskrypcje.
      if (otherSalonId) await h!.db.delete(salons).where(eq(salons.id, otherSalonId));
      await h!.db.delete(user).where(eq(user.id, otherUserId));
    });

    beforeEach(async () => {
      await h!.db.delete(salonSubscriptions).where(eq(salonSubscriptions.salonId, otherSalonId));
      strictRateLimit.reset();
      fakeStripe.checkout.sessions.create.mockClear();
      // Bez hostingu: cena tworzona w żądaniu z planu testu (slug spoza basic/pro).
      vi.stubEnv("VERCEL", "");
      vi.stubEnv("K_SERVICE", "");
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("cancel salonu A (prawdziwa subskrypcja Stripe) → 200, canceled tylko wiersz A; wiersz salonu B bez zmian", async () => {
      const subA = `sub_it_${randomUUID().slice(0, 8)}`;
      const subB = `sub_it_${randomUUID().slice(0, 8)}`;
      setStripe(subA, "active");
      setStripe(subB, "active");
      await h!.db.insert(salonSubscriptions).values({ salonId, planId, status: "active", stripeSubscriptionId: subA });
      await h!.db
        .insert(salonSubscriptions)
        .values({ salonId: otherSalonId, planId, status: "active", stripeSubscriptionId: subB });
      const beforeB = await otherRows();

      const { status, body } = await cancel();

      expect(status).toBe(200);
      expect(body.success).toBe(true);
      expect((await rows()).map((r) => [r.stripeSubscriptionId, r.status])).toEqual([[subA, "canceled"]]);
      expect(await otherRows()).toEqual(beforeB);
      expect(stripeState.get(subA)?.cancel_at_period_end).toBe(true);
      expect(stripeState.get(subB)?.cancel_at_period_end).toBeUndefined();
      expect(logger.error).not.toHaveBeenCalled();
    });

    it("cancel salonu A bez prawdziwej subskrypcji Stripe → 200, tylko wiersz A; B bez zmian", async () => {
      await h!.db.insert(salonSubscriptions).values({ salonId, planId, status: "active" });
      await h!.db.insert(salonSubscriptions).values({ salonId: otherSalonId, planId, status: "active" });
      const beforeB = await otherRows();

      const { status } = await cancel();

      expect(status).toBe(200);
      expect((await rows()).map((r) => r.status)).toEqual(["canceled"]);
      expect(await otherRows()).toEqual(beforeB);
      expect(logger.error).not.toHaveBeenCalled();
    });

    it("cancel ‖ blokada salonu trzymana dłużej niż lock_timeout → 503 LOCK_BUSY, zero zapisów", async () => {
      await h!.db.insert(salonSubscriptions).values({ salonId, planId, status: "active" });
      const before = await rows();
      let release!: () => void;
      let held!: () => void;
      const releaseP = new Promise<void>((r) => (release = r));
      const heldP = new Promise<void>((r) => (held = r));
      const barrier = withSalonSubscriptionLock(salonId, async () => {
        held();
        await releaseP;
      });
      await heldP;

      try {
        const { status, body } = await cancel();
        expect(status).toBe(503);
        expect(body.code).toBe("LOCK_BUSY");
      } finally {
        release();
        await barrier;
      }
      expect(await rows()).toEqual(before);
    }, 15_000);

    it("checkout salonu A: plan czytany pod rolą aplikacji → 200 z sesją Checkout; aktywny wiersz tego planu w salonie B nie blokuje A", async () => {
      await h!.db.insert(salonSubscriptions).values({ salonId: otherSalonId, planId, status: "active" });

      const { status, body } = await checkout();

      expect(status).toBe(200);
      expect(body.url).toBe("https://checkout.example.invalid/cs_it_checkout");
      expect(fakeStripe.checkout.sessions.create).toHaveBeenCalledTimes(1);
      const [params] = fakeStripe.checkout.sessions.create.mock.calls[0] as unknown as [
        { metadata: Record<string, string>; line_items: Array<{ price_data?: { unit_amount: number } }> },
      ];
      expect(params.metadata).toEqual(expect.objectContaining({ salonId, planId, planSlug: testPlanSlug }));
      expect(params.line_items[0]?.price_data?.unit_amount).toBeGreaterThan(0);
      expect(await rows()).toEqual([]);
      expect(logger.error).not.toHaveBeenCalled();
    });

    it("checkout salonu A z aktywnym wierszem tego planu → 409, bez sesji Checkout (wiersze A widoczne pod RLS)", async () => {
      await h!.db.insert(salonSubscriptions).values({ salonId, planId, status: "active" });

      const { status } = await checkout();

      expect(status).toBe(409);
      expect(fakeStripe.checkout.sessions.create).not.toHaveBeenCalled();
      expect(logger.error).not.toHaveBeenCalled();
    });
  });

  it("sprzątanie: test nie zostawia blokad (żadnej czekającej ani trzymanej w przestrzeniach subskrypcji)", async () => {
    const [r] = await h!.observer<{ n: number }[]>`
      select count(*)::int as n from pg_locks
      where locktype = 'advisory' and classid in (${SUBSCRIPTION_LOCK_NAMESPACE.stripeSub}::oid, ${SUBSCRIPTION_LOCK_NAMESPACE.salon}::oid)
        and objsubid = 2`;
    expect(r?.n).toBe(0);
  });
});
