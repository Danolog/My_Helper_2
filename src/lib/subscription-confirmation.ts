import { and, eq, inArray } from "drizzle-orm";
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
}

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
  let stripeSub: RawStripeSubscription;
  if (typeof subRef === "string") {
    try {
      stripeSub = (await stripe.subscriptions.retrieve(subRef)) as unknown as RawStripeSubscription;
    } catch (error) {
      logger.error("Failed to retrieve Stripe subscription", { error, sessionId: session.id });
      return fail(502, "STRIPE_ERROR", "Nie udalo sie pobrac subskrypcji ze Stripe");
    }
  } else {
    stripeSub = subRef;
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
    const result = await db.transaction(async (tx) => {
      const current = await tx
        .select()
        .from(salonSubscriptions)
        .where(
          and(
            eq(salonSubscriptions.salonId, salonId),
            inArray(salonSubscriptions.status, ["active", "trialing"])
          )
        );
      const active = current.find((s) => s.status === "active");

      // Salon płaci już za INNĄ subskrypcję Stripe: nadpisanie osierociłoby
      // płacącą subskrypcję (podwójne obciążenie bez śladu u nas).
      if (
        active &&
        hasRealStripeSubscription(active.stripeSubscriptionId) &&
        active.stripeSubscriptionId !== stripeSub.id
      ) {
        return { conflict: true as const };
      }

      // Trial → płatny plan: ten sam wiersz przechodzi w „active”, a pozostałe
      // wiersze „trialing” są zamykane — bez drugiego wiersza dla salonu.
      const target = active ?? current.find((s) => s.status === "trialing");
      const values = {
        planId,
        stripeSubscriptionId: stripeSub.id,
        stripeCustomerId,
        status: "active",
        trialEndsAt: null,
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

      return { conflict: false as const, record };
    });

    if (result.conflict) {
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
