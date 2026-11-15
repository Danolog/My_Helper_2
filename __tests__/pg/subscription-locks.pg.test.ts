/**
 * Blokady subskrypcji na PRAWDZIWYM Postgresie (T3, ostrzeżenia [MEDIUM] #2
 * i #3 oraz kolejność zdarzeń; warunki Ethana a–d, `scratchpad/ethan/pr62-shape.md`).
 *
 * (a) Ścieżka produkcyjna: prawdziwe `confirmSubscriptionCheckout` i
 *     prawdziwe handlery webhooka (`POST /api/stripe/webhook`) na prawdziwej
 *     bazie, z prawdziwym `pg_advisory_xact_lock`. Atrapa dotyczy tylko Stripe
 *     (i weryfikacji podpisu zdarzenia).
 * (b) Czekanie drugiego połączenia jest dowiedzione przez `pg_locks`
 *     (`granted = false` w przestrzeni blokady), nie przez `sleep`: pierwszy
 *     uczestnik trzyma blokadę na barierze (odczyt Stripe albo jawna
 *     transakcja testu), test czeka, aż drugi pojawi się w `pg_locks` jako
 *     czekający, i dopiero wtedy zwalnia barierę.
 * (c) Scenariusze: confirm → deleted = canceled; deleted bez wiersza → 2xx,
 *     potem confirm 409 bez zapisu; deleted → późne invoice.paid = canceled;
 *     lokalne canceled + Stripe active → zostaje canceled; 50 iteracji
 *     confirm ‖ updated ‖ invoice.paid z losowymi opóźnieniami = zero 40P01
 *     i stan zgodny z atrapą Stripe.
 * (T3b) Prawdziwa trasa `subscriptions/cancel` (502 przy błędzie Stripe,
 *     `canceled` tylko po potwierdzeniu, cancel ‖ updated), bliźniak (c3'')
 *     bez potwierdzenia, indeksy unikalne 0008 i równoległa rejestracja.
 * (d) Baza z `INTEGRATION_POSTGRES_URL` + ochrona hosta z seeda (#56)
 *     (`pg-harness.ts`); przy `CI=true` bez adresu — błąd, nie skip. Własne
 *     wiersze (user, salon, plan) z unikalnymi id, sprzątane w `afterAll`.
 *
 * Uruchomienie: `INTEGRATION_POSTGRES_URL=postgresql://…@localhost:5432/pos_dev pnpm test:pg`
 * (baza z zastosowanymi migracjami; test nie uruchamia `db:*` ani seeda).
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { POST as registerSubscription } from "@/app/api/register-subscription/route";
import { POST as stripeWebhook } from "@/app/api/stripe/webhook/route";
import { POST as cancelSubscription } from "@/app/api/subscriptions/cancel/route";
import { logger } from "@/lib/logger";
import { salonSubscriptions, salons, subscriptionPayments, subscriptionPlans, user } from "@/lib/schema";
import {
  confirmSubscriptionCheckout,
  type SubscriptionCheckoutSession,
} from "@/lib/subscription-confirmation";
import { SUBSCRIPTION_LOCK_NAMESPACE } from "@/lib/subscription-lock-namespace";
import { withStripeSubscriptionLock } from "@/lib/subscription-locks";
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
// Tylko sesja jest atrapą — trasy cancel/register-subscription działają na prawdziwej bazie.
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
    metadata: { salonId, planId },
    customer: "cus_it",
    subscription: stripeSubId,
  };
}

function confirm(s: SubscriptionCheckoutSession) {
  return confirmSubscriptionCheckout(fakeStripe as never, s, { expectedSalonId: salonId });
}

const invoicePaid = (stripeSubId: string) => ({
  id: `in_${randomUUID().slice(0, 8)}`,
  subscription: stripeSubId,
  payment_intent: `pi_${randomUUID().slice(0, 12)}`,
  billing_reason: "subscription_cycle",
  amount_paid: 14900,
});

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
      .values({ name: "IT T3", slug: `it-t3-${RUN}`, priceMonthly: "149.00" })
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

  it("sprzątanie: test nie zostawia blokad (żadnej czekającej ani trzymanej w przestrzeniach subskrypcji)", async () => {
    const [r] = await h!.observer<{ n: number }[]>`
      select count(*)::int as n from pg_locks
      where locktype = 'advisory' and classid in (${SUBSCRIPTION_LOCK_NAMESPACE.stripeSub}::oid, ${SUBSCRIPTION_LOCK_NAMESPACE.salon}::oid)
        and objsubid = 2`;
    expect(r?.n).toBe(0);
  });
});
