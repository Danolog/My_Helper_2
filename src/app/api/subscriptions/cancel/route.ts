import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";
import { db } from "@/lib/db";
import { getUserSalonId } from "@/lib/get-user-salon";
import { logger } from "@/lib/logger";
import { salonSubscriptions } from "@/lib/schema";
import { getStripe } from "@/lib/stripe";

/**
 * POST /api/subscriptions/cancel
 *
 * Cancels the current active subscription for the demo salon.
 * Sets the status to "canceled" and records the cancellation timestamp.
 *
 * If Stripe is configured and the subscription has a stripeSubscriptionId,
 * it cancels the Stripe subscription at the end of the current billing period
 * (cancel_at_period_end). This way the customer retains access until the
 * period they already paid for ends.
 *
 * If Stripe is not configured (dev mode), it simply updates the database record.
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

    // Find the current active subscription
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

    const now = new Date();
    let stripeCanceled = false;
    let stripeError: string | null = null;

    // Cancel Stripe subscription if configured and subscription has a Stripe ID
    if (activeSub.stripeSubscriptionId) {
      const stripe = getStripe();
      if (stripe) {
        try {
          // Cancel at period end so customer keeps access until billing cycle ends
          const canceledStripeSub = await stripe.subscriptions.update(
            activeSub.stripeSubscriptionId,
            { cancel_at_period_end: true },
          );
          stripeCanceled = true;

          logger.info("Stripe subscription set to cancel at period end", {
            stripeSubscriptionId: activeSub.stripeSubscriptionId,
            cancelAtPeriodEnd: canceledStripeSub.cancel_at_period_end,
            currentPeriodEnd: canceledStripeSub.items.data[0]?.current_period_end
              ? new Date(canceledStripeSub.items.data[0].current_period_end * 1000).toISOString()
              : null,
          });
        } catch (err) {
          stripeError = err instanceof Error ? err.message : "Stripe cancellation failed";
          logger.error("Stripe subscription cancel error", { error: err });
          // Continue with local DB update even if Stripe fails
        }
      } else {
        logger.info("Stripe not configured, skipping Stripe cancellation (dev mode)");
      }
    } else {
      logger.info("No Stripe subscription ID, local-only cancellation (dev mode)");
    }

    // Update the subscription status to canceled in our database
    const [updated] = await db
      .update(salonSubscriptions)
      .set({
        status: "canceled",
        canceledAt: now,
      })
      .where(eq(salonSubscriptions.id, activeSub.id))
      .returning();

    if (!updated) {
      return NextResponse.json(
        { success: false, error: "Nie udalo sie anulowac subskrypcji" },
        { status: 500 },
      );
    }

    logger.info("Subscription canceled", {
      subscriptionId: activeSub.id,
      userId: user.id,
      stripeCanceled,
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
      stripeCanceled,
      stripeError,
    });
  } catch (error) {
    logger.error("Subscription cancel error", { error });
    return NextResponse.json(
      { success: false, error: "Nie udalo sie anulowac subskrypcji" },
      { status: 500 },
    );
  }
}
