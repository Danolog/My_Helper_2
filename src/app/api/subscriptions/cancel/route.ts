import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { salonSubscriptions } from "@/lib/schema";
import { getStripe } from "@/lib/stripe";
import { getUserSalonId } from "@/lib/get-user-salon";

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
    // Authenticate the user
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) {
      return NextResponse.json(
        { success: false, error: "Wymagane logowanie" },
        { status: 401 },
      );
    }

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

          // eslint-disable-next-line no-console
          console.log(
            `[Subscriptions API] Stripe subscription ${activeSub.stripeSubscriptionId} set to cancel at period end`,
            {
              cancel_at_period_end: canceledStripeSub.cancel_at_period_end,
              current_period_end: canceledStripeSub.current_period_end
                ? new Date(canceledStripeSub.current_period_end * 1000).toISOString()
                : null,
            },
          );
        } catch (err) {
          stripeError = err instanceof Error ? err.message : "Stripe cancellation failed";
          console.error("[Subscriptions API] Stripe cancel error:", err);
          // Continue with local DB update even if Stripe fails
        }
      } else {
        // eslint-disable-next-line no-console
        console.log(
          "[Subscriptions API] Stripe not configured, skipping Stripe cancellation (dev mode)",
        );
      }
    } else {
      // eslint-disable-next-line no-console
      console.log(
        "[Subscriptions API] No Stripe subscription ID, local-only cancellation (dev mode)",
      );
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

    // eslint-disable-next-line no-console
    console.log(
      `[Subscriptions API] Subscription ${activeSub.id} canceled by user ${session.user.id}` +
        (stripeCanceled ? " (Stripe canceled at period end)" : " (local only)"),
    );

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
    console.error("[Subscriptions API] Cancel error:", error);
    return NextResponse.json(
      { success: false, error: "Nie udalo sie anulowac subskrypcji" },
      { status: 500 },
    );
  }
}
