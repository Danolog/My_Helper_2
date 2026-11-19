import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";
// ADR-001: ścieżka systemowa (salonId z danych subskrypcji/Stripe, nie z sesji) — świadomie surowe db
import { db } from "@/lib/db";
import { getUserSalonId } from "@/lib/get-user-salon";
import { logger } from "@/lib/logger";
import { salonSubscriptions } from "@/lib/schema";
import { getStripe } from "@/lib/stripe";
import { stripeSubscriptionPeriod } from "@/lib/stripe-period";
import {
  isSubscriptionLockFailure,
  lockSalonSubscriptions,
  lockStripeSubscription,
  setSubscriptionLockTimeout,
  STRIPE_LOCKED_READ_OPTIONS,
} from "@/lib/subscription-locks";
import { hasRealStripeSubscription } from "@/lib/subscription-predicates";

type SubscriptionRow = typeof salonSubscriptions.$inferSelect;

type CancelOutcome =
  | { updated: SubscriptionRow }
  | { changed: true }
  | { stripeFailed: true }
  | { stripeNotConfirmed: string };

/** Stany Stripe, które same w sobie potwierdzają koniec subskrypcji. */
const STRIPE_ENDED_STATUSES = new Set(["canceled", "incomplete_expired"]);

function json(status: number, code: string, error: string) {
  return NextResponse.json({ success: false, code, error }, { status });
}

/**
 * POST /api/subscriptions/cancel
 *
 * Anuluje bieżącą (active) subskrypcję salonu z sesji (T3b, warunek
 * z przeglądu #62 §2b — przed pierwszym płacącym salonem).
 *
 * Prawdziwa subskrypcja Stripe: `cancel_at_period_end: true` w Stripe
 * (Stripe nie odnawia subskrypcji po końcu okresu), a lokalne `canceled`
 * zapisujemy TYLKO, gdy odpowiedź Stripe to potwierdza
 * (`cancel_at_period_end === true` albo stan końcowy). Błąd Stripe → 502,
 * Stripe nieskonfigurowany → 503 — w obu przypadkach bez zapisu: lokalne
 * `canceled` przy aktywnej subskrypcji w Stripe to dryf (Stripe dalej
 * pobiera opłaty, a salon nie ma planu).
 *
 * Blokady jak w webhooku (`subscription-locks.ts`): lock_timeout →
 * stripe_sub → (wywołanie Stripe) → salon. Webhook tej subskrypcji czeka
 * na nas i czyta ze Stripe stan PO anulowaniu. Bez prawdziwej subskrypcji
 * Stripe (null, dawne `sim_*`) — tylko blokada salonu i zapis lokalny.
 *
 * Zakleszczenie / lock_timeout → 503 LOCK_BUSY, bez zapisu.
 */
export async function POST() {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;
    const { user } = authResult;

    const salonId = await getUserSalonId();
    if (!salonId) {
      return NextResponse.json(
        { success: false, error: "Salon not found" },
        { status: 404 },
      );
    }

    // Odczyt poza blokadą tylko po to, żeby znać klucz blokady stripe_sub;
    // stan jest sprawdzany ponownie pod blokadą.
    const [activeSub] = await db
      .select()
      .from(salonSubscriptions)
      .where(
        and(
          eq(salonSubscriptions.salonId, salonId),
          eq(salonSubscriptions.status, "active"),
        ),
      );

    if (!activeSub) {
      return NextResponse.json(
        { success: false, error: "Brak aktywnej subskrypcji do anulowania" },
        { status: 404 },
      );
    }

    const stripeSubscriptionId = hasRealStripeSubscription(activeSub.stripeSubscriptionId)
      ? activeSub.stripeSubscriptionId
      : null;
    const stripe = stripeSubscriptionId ? getStripe() : null;
    if (stripeSubscriptionId && !stripe) {
      logger.error("Subscription cancel refused: Stripe not configured — local subscription unchanged", {
        subscriptionId: activeSub.id,
        stripeSubscriptionId,
      });
      return json(
        503,
        "STRIPE_UNAVAILABLE",
        "System płatności jest chwilowo niedostępny. Subskrypcja nie została anulowana — spróbuj ponownie później.",
      );
    }

    const now = new Date();
    let outcome: CancelOutcome;
    try {
      outcome = await db.transaction(async (tx): Promise<CancelOutcome> => {
        await setSubscriptionLockTimeout(tx);

        if (stripeSubscriptionId && stripe) {
          await lockStripeSubscription(tx, stripeSubscriptionId);
          const [row] = await tx
            .select()
            .from(salonSubscriptions)
            .where(eq(salonSubscriptions.id, activeSub.id));
          if (row?.status !== "active" || row.stripeSubscriptionId !== stripeSubscriptionId) {
            return { changed: true };
          }

          let stripeSub;
          try {
            // Ustawienie cancel_at_period_end jest idempotentne — ponowienie
            // po błędzie niczego nie podwaja.
            stripeSub = await stripe.subscriptions.update(
              stripeSubscriptionId,
              { cancel_at_period_end: true },
              STRIPE_LOCKED_READ_OPTIONS,
            );
          } catch (error) {
            logger.error("Stripe subscription cancel failed — local subscription unchanged", {
              error,
              subscriptionId: activeSub.id,
              stripeSubscriptionId,
            });
            return { stripeFailed: true };
          }

          if (stripeSub.cancel_at_period_end !== true && !STRIPE_ENDED_STATUSES.has(stripeSub.status)) {
            logger.error("Stripe did not confirm cancellation — local subscription unchanged, manual handling", {
              subscriptionId: activeSub.id,
              stripeSubscriptionId,
              stripeStatus: stripeSub.status,
            });
            return { stripeNotConfirmed: stripeSub.status };
          }
          const period = stripeSubscriptionPeriod(stripeSub);
          logger.info("Stripe subscription set to cancel at period end", {
            stripeSubscriptionId,
            stripeStatus: stripeSub.status,
            currentPeriodEnd: period?.end.toISOString() ?? null,
          });
        }

        await lockSalonSubscriptions(tx, salonId);
        if (!stripeSubscriptionId) {
          const [row] = await tx
            .select()
            .from(salonSubscriptions)
            .where(eq(salonSubscriptions.id, activeSub.id));
          if (row?.status !== "active") return { changed: true };
        }

        const [updated] = await tx
          .update(salonSubscriptions)
          .set({
            status: "canceled",
            canceledAt: now,
            // Okres w wierszu zostaje bez zmian: anulowanie nie zmienia tego, do kiedy subskrypcja jest opłacona.
          })
          .where(eq(salonSubscriptions.id, activeSub.id))
          .returning();
        if (!updated) throw new Error("Subscription cancel: update returned no row");
        return { updated };
      });
    } catch (error) {
      if (isSubscriptionLockFailure(error)) {
        logger.warn("Subscription cancel lock failure — retry", { subscriptionId: activeSub.id });
        return json(503, "LOCK_BUSY", "Subskrypcja jest właśnie aktualizowana. Spróbuj ponownie za chwilę.");
      }
      throw error;
    }

    if ("changed" in outcome) {
      return json(
        409,
        "SUBSCRIPTION_CHANGED",
        "Subskrypcja zmieniła się w międzyczasie. Odśwież stronę i spróbuj ponownie.",
      );
    }
    if ("stripeFailed" in outcome || "stripeNotConfirmed" in outcome) {
      return json(
        502,
        "STRIPE_ERROR",
        "Nie udało się anulować subskrypcji w systemie płatności. Subskrypcja nie została anulowana — spróbuj ponownie.",
      );
    }

    const { updated } = outcome;
    logger.info("Subscription canceled", {
      subscriptionId: updated.id,
      userId: user.id,
      stripeCanceled: !!stripeSubscriptionId,
    });

    return NextResponse.json({
      success: true,
      message: "Subskrypcja zostala anulowana",
      subscription: {
        id: updated.id,
        status: updated.status,
        canceledAt: updated.canceledAt,
        currentPeriodEnd: updated.currentPeriodEnd,
      },
      stripeCanceled: !!stripeSubscriptionId,
    });
  } catch (error) {
    logger.error("Subscription cancel error", { error });
    return NextResponse.json(
      { success: false, error: "Nie udalo sie anulowac subskrypcji" },
      { status: 500 },
    );
  }
}
