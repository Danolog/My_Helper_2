import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { salonSubscriptions, subscriptionPayments, subscriptionPlans } from "@/lib/schema";
import { stripeSubscriptionPeriod, type StripeSubscriptionPeriodSource } from "@/lib/stripe-period";
import type Stripe from "stripe";

/**
 * Potwierdzenie opłaconej sesji Stripe Checkout dla subskrypcji (T3).
 *
 * Jedna funkcja dla dwóch wejść, żeby zachowywały się identycznie:
 * - `POST /api/subscriptions/confirm` — strona sukcesu po powrocie ze Stripe,
 *   z `expectedSalonId` = salon z sesji użytkownika,
 * - `POST /api/stripe/webhook` na `checkout.session.completed` /
 *   `checkout.session.async_payment_succeeded` — bez sesji użytkownika;
 *   salon z `metadata` podpisanego zdarzenia.
 *
 * Kluczem idempotencji jest id sesji Checkout (`cs_…`) zapisane w
 * `subscription_payments.stripe_payment_intent_id` (unikalny indeks), zawężone
 * do salonu. Kto przyjdzie drugi (strona sukcesu albo webhook, także
 * równolegle), dostaje `alreadyConfirmed`, a nie drugi wiersz.
 *
 * Surowe `db` świadomie (ADR-001 sekcja 4): ścieżka płatności, salon
 * z danych Stripe, porównany z sesją tam, gdzie sesja jest.
 */

/** Minimalny kształt sesji Checkout, z którego korzystamy (SDK i surowy webhook). */
export interface SubscriptionCheckoutSession {
  id: string;
  mode?: string | null;
  payment_status?: string | null;
  metadata?: Record<string, string> | null;
  subscription?: string | RawStripeSubscription | null;
  customer?: string | { id: string } | null;
}

/** Subskrypcja Stripe: id + okres (`@/lib/stripe-period`). */
interface RawStripeSubscription extends StripeSubscriptionPeriodSource {
  id: string;
  /** Stan subskrypcji w Stripe w chwili odczytu (zawsze świeżo pobranej). */
  status?: string | null;
  trial_end?: number | null;
}

/**
 * Stany Stripe, które dają dostęp, i ich odpowiednik u nas. Reszta
 * (canceled, past_due, unpaid, incomplete, incomplete_expired, paused) →
 * odmowa z logiem do ręcznej obsługi, bez zapisu: przejścia do tych stanów
 * należą do handlerów customer.subscription.updated/deleted, a potwierdzenie
 * Checkoutu tylko przyznaje plan — nigdy nie przywraca go spóźnionym
 * zdarzeniem (ostrzeżenie [MEDIUM] fail-open state drift).
 */
const GRANTING_STRIPE_STATUSES = { active: "active", trialing: "trialing" } as const;

type SubscriptionRow = typeof salonSubscriptions.$inferSelect;
type PlanRow = typeof subscriptionPlans.$inferSelect;

export type ConfirmSubscriptionResult =
  | {
      ok: true;
      alreadyConfirmed: boolean;
      subscription: SubscriptionRow | null;
      plan: PlanRow | null;
    }
  | {
      ok: false;
      status: 400 | 403 | 404 | 409 | 502;
      code: string;
      error: string;
    };

export interface ConfirmSubscriptionOptions {
  /** Salon z sesji użytkownika. Inny salon w `metadata` → 403, zero zapisów. */
  expectedSalonId?: string | undefined;
}

class PaymentAlreadyRecorded extends Error {}

/** Transakcja Drizzle (typ z `db.transaction`). */
export type SubscriptionTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Blokada wierszy subskrypcji salonu do końca transakcji (ostrzeżenie
 * [MEDIUM] #2 TOCTOU). Biorą ją wszyscy, którzy zmieniają stan subskrypcji
 * salonu: potwierdzenie Checkoutu i handlery webhooka (updated, deleted,
 * invoice.paid, invoice.payment_failed) — więc „odczyt stanu → zapis” jednego
 * nie przeplata się z zapisem drugiego. Blokada doradcza, bo wiersza może
 * jeszcze nie być (pierwszy Checkout), a FOR UPDATE nie blokuje braku wiersza.
 */
export async function lockSalonSubscriptions(tx: SubscriptionTx, salonId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"salon_subscriptions:" + salonId}))`);
}

/** Transakcja z blokadą subskrypcji salonu (patrz `lockSalonSubscriptions`). */
export function withSalonSubscriptionLock<T>(
  salonId: string,
  fn: (tx: SubscriptionTx) => Promise<T>
): Promise<T> {
  return db.transaction(async (tx) => {
    await lockSalonSubscriptions(tx, salonId);
    return fn(tx);
  });
}

/**
 * Stany lokalne, po których subskrypcja Stripe nie wraca do życia przez
 * potwierdzenie Checkoutu (zapisał je webhook — Stripe już to zgłosił).
 */
const ENDED_LOCAL_STATUSES = new Set(["canceled", "past_due", "unpaid", "incomplete_expired"]);

function fail(
  status: 400 | 403 | 404 | 409 | 502,
  code: string,
  error: string
): ConfirmSubscriptionResult {
  return { ok: false, status, code, error };
}

function isUniqueViolation(error: unknown): boolean {
  for (let e: unknown = error, depth = 0; e && depth < 3; depth++) {
    if ((e as { code?: unknown }).code === "23505") return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

function hasRealStripeSubscription(id: string | null): boolean {
  return !!id && !id.startsWith("sim_");
}

async function findConfirmed(sessionId: string, salonId: string) {
  const [payment] = await db
    .select()
    .from(subscriptionPayments)
    .where(
      and(
        eq(subscriptionPayments.stripePaymentIntentId, sessionId),
        eq(subscriptionPayments.salonId, salonId)
      )
    );
  if (!payment) return null;
  const [subscription] = await db
    .select()
    .from(salonSubscriptions)
    .where(eq(salonSubscriptions.id, payment.subscriptionId));
  return { subscription: subscription ?? null };
}

export async function confirmSubscriptionCheckout(
  stripe: Stripe,
  session: SubscriptionCheckoutSession,
  options: ConfirmSubscriptionOptions = {}
): Promise<ConfirmSubscriptionResult> {
  if (session.mode !== "subscription") {
    return fail(400, "INVALID_SESSION_MODE", "Sesja nie dotyczy subskrypcji");
  }
  if (session.payment_status !== "paid") {
    return fail(400, "NOT_PAID", "Platnosc nie zostala zrealizowana");
  }

  const salonId = session.metadata?.salonId;
  if (!salonId) {
    return fail(400, "MISSING_SALON", "Brak identyfikatora salonu w sesji");
  }
  if (options.expectedSalonId !== undefined && salonId !== options.expectedSalonId) {
    return fail(403, "SALON_MISMATCH", "Sesja platnosci nalezy do innego salonu");
  }

  const already = await findConfirmed(session.id, salonId);
  if (already) {
    return { ok: true, alreadyConfirmed: true, subscription: already.subscription, plan: null };
  }

  const planId = session.metadata?.planId;
  if (!planId) {
    return fail(400, "MISSING_PLAN", "Brak identyfikatora planu w sesji");
  }
  const [plan] = await db.select().from(subscriptionPlans).where(eq(subscriptionPlans.id, planId));
  if (!plan) {
    return fail(404, "PLAN_NOT_FOUND", "Plan nie zostal znaleziony");
  }

  // Prawdziwa subskrypcja Stripe — bez zmyślonego identyfikatora.
  const subRef = session.subscription;
  if (!subRef) {
    return fail(400, "MISSING_SUBSCRIPTION", "Sesja nie zawiera subskrypcji Stripe");
  }
  // Zawsze świeży odczyt: obiekt rozwinięty w sesji albo payload spóźnionego
  // zdarzenia może mieć stan sprzed anulowania.
  const stripeSubId = typeof subRef === "string" ? subRef : subRef.id;
  let stripeSub: RawStripeSubscription;
  try {
    stripeSub = (await stripe.subscriptions.retrieve(stripeSubId)) as unknown as RawStripeSubscription;
  } catch (error) {
    logger.error("Failed to retrieve Stripe subscription", { error, sessionId: session.id });
    return fail(502, "STRIPE_ERROR", "Nie udalo sie pobrac subskrypcji ze Stripe");
  }

  const stripeStatus = stripeSub.status ?? "";
  const localStatus =
    stripeStatus in GRANTING_STRIPE_STATUSES
      ? GRANTING_STRIPE_STATUSES[stripeStatus as keyof typeof GRANTING_STRIPE_STATUSES]
      : null;
  if (!localStatus) {
    logger.warn("Subscription checkout NOT granted: Stripe subscription not active — manual handling", {
      sessionId: session.id,
      salonId,
      stripeSubscriptionId: stripeSub.id,
      stripeStatus,
    });
    return fail(
      409,
      "SUBSCRIPTION_NOT_ACTIVE",
      "Subskrypcja w Stripe nie jest aktywna. Skontaktuj sie z obsluga."
    );
  }
  const trialEndsAt =
    localStatus === "trialing" && typeof stripeSub.trial_end === "number"
      ? new Date(stripeSub.trial_end * 1000)
      : null;
  if (localStatus === "trialing" && !trialEndsAt) {
    logger.error("Stripe trialing subscription without trial_end", {
      sessionId: session.id,
      stripeSubscriptionId: stripeSub.id,
    });
    return fail(502, "STRIPE_TRIAL_END_MISSING", "Stripe nie zwrocil konca okresu probnego");
  }
  // Okres ze Stripe, nie liczony lokalnie (miesiąc ≠ okres Stripe przy 31.,
  // zmianie czasu i triale po stronie Stripe).
  const period = stripeSubscriptionPeriod(stripeSub);
  if (!period) {
    logger.error("Stripe subscription without billing period", {
      sessionId: session.id,
      stripeSubscriptionId: stripeSub.id,
    });
    return fail(502, "STRIPE_PERIOD_MISSING", "Stripe nie zwrocil okresu rozliczeniowego");
  }

  const stripeCustomerId =
    typeof session.customer === "string" ? session.customer : (session.customer?.id ?? null);

  try {
    const result = await withSalonSubscriptionLock(salonId, async (tx) => {
      // WSZYSTKIE wiersze salonu (nie tylko active/trialing), odczytane pod
      // blokadą — po webhooku, który mógł zapisać canceled w międzyczasie.
      const rows = await tx
        .select()
        .from(salonSubscriptions)
        .where(eq(salonSubscriptions.salonId, salonId));

      // Ta subskrypcja Stripe jest u nas już zakończona: Stripe zgłosił to
      // webhookiem po naszym odczycie stanu — nie wskrzeszamy jej ani nie
      // zakładamy drugiego wiersza.
      const ended = rows.find(
        (s) => s.stripeSubscriptionId === stripeSub.id && ENDED_LOCAL_STATUSES.has(s.status)
      );
      if (ended) {
        return { ended: ended.status } as const;
      }

      const current = rows.filter((s) => s.status === "active" || s.status === "trialing");
      const active = current.find((s) => s.status === "active");

      // Salon płaci już za INNĄ subskrypcję Stripe: nadpisanie osierociłoby
      // płacącą subskrypcję (podwójne obciążenie bez śladu u nas).
      if (
        active &&
        hasRealStripeSubscription(active.stripeSubscriptionId) &&
        active.stripeSubscriptionId !== stripeSub.id
      ) {
        return { conflict: true } as const;
      }

      // Trial → płatny plan: ten sam wiersz przechodzi w „active”, a pozostałe
      // wiersze „trialing” są zamykane — bez drugiego wiersza dla salonu.
      const target = active ?? current.find((s) => s.status === "trialing");
      const values = {
        planId,
        stripeSubscriptionId: stripeSub.id,
        stripeCustomerId,
        status: localStatus,
        trialEndsAt,
        currentPeriodStart: period.start,
        currentPeriodEnd: period.end,
      };

      let record: SubscriptionRow | undefined;
      if (target) {
        [record] = await tx
          .update(salonSubscriptions)
          .set(values)
          .where(eq(salonSubscriptions.id, target.id))
          .returning();
      } else {
        [record] = await tx
          .insert(salonSubscriptions)
          .values({ salonId, ...values })
          .returning();
      }
      if (!record) throw new Error("Failed to create or update subscription record");

      const otherTrials = current
        .filter((s) => s.status === "trialing" && s.id !== target?.id)
        .map((s) => s.id);
      if (otherTrials.length > 0) {
        await tx
          .update(salonSubscriptions)
          .set({ status: "canceled", canceledAt: new Date() })
          .where(inArray(salonSubscriptions.id, otherTrials));
      }

      const inserted = await tx
        .insert(subscriptionPayments)
        .values({
          subscriptionId: record.id,
          salonId,
          amount: plan.priceMonthly,
          currency: "PLN",
          stripePaymentIntentId: session.id,
          status: "succeeded",
          paidAt: new Date(),
        })
        .onConflictDoNothing({ target: subscriptionPayments.stripePaymentIntentId })
        .returning({ id: subscriptionPayments.id });
      // Równoległe potwierdzenie (strona sukcesu vs webhook) zdążyło pierwsze:
      // wycofaj całą transakcję i oddaj jego wynik.
      if (inserted.length === 0) throw new PaymentAlreadyRecorded();

      return { record } as const;
    });

    if ("ended" in result) {
      logger.warn("Subscription checkout NOT granted: subscription already ended locally — manual handling", {
        sessionId: session.id,
        salonId,
        stripeSubscriptionId: stripeSub.id,
        localStatus: result.ended,
      });
      return fail(
        409,
        "SUBSCRIPTION_NOT_ACTIVE",
        "Subskrypcja w Stripe nie jest aktywna. Skontaktuj sie z obsluga."
      );
    }

    if ("conflict" in result) {
      logger.error("Subscription checkout conflicts with another paid Stripe subscription", {
        sessionId: session.id,
        salonId,
        stripeSubscriptionId: stripeSub.id,
      });
      return fail(
        409,
        "SUBSCRIPTION_CONFLICT",
        "Salon ma juz inna oplacona subskrypcje. Skontaktuj sie z obsluga."
      );
    }

    logger.info("Subscription confirmed", {
      subscriptionId: result.record.id,
      planSlug: plan.slug,
    });
    return { ok: true, alreadyConfirmed: false, subscription: result.record, plan };
  } catch (error) {
    if (error instanceof PaymentAlreadyRecorded || isUniqueViolation(error)) {
      const winner = await findConfirmed(session.id, salonId);
      if (winner) {
        return { ok: true, alreadyConfirmed: true, subscription: winner.subscription, plan: null };
      }
    }
    throw error;
  }
}
