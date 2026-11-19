import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";
import { getUserSalonId } from "@/lib/get-user-salon";
import { logger } from "@/lib/logger";
import {
  salonSubscriptions,
  subscriptionPlans,
} from "@/lib/schema";
import { forSalon } from "@/lib/server/repository";

const DEFAULT_WARNING_DAYS = 7;

/**
 * GET /api/subscriptions/expiration-warning
 *
 * Returns the expiration warning status for the current subscription.
 * Includes:
 * - daysRemaining: Number of days until the subscription expires/renews
 * - warningThreshold: Number of days before expiry to show warning
 * - isNearExpiry: Whether the subscription is near its expiry date
 */
export async function GET() {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

    const salonId = await getUserSalonId();
    if (!salonId) {
      return NextResponse.json(
        { success: false, error: "Salon not found" },
        { status: 404 }
      );
    }

    // Find the current active subscription
    const [activeSub] = await forSalon(salonId).raw((tx) =>
      tx
        .select({
          subscription: salonSubscriptions,
          plan: subscriptionPlans,
        })
        .from(salonSubscriptions)
        .innerJoin(
          subscriptionPlans,
          eq(salonSubscriptions.planId, subscriptionPlans.id)
        )
        .where(
          and(
            eq(salonSubscriptions.salonId, salonId),
            eq(salonSubscriptions.status, "active")
          )
        )
    );

    if (!activeSub) {
      return NextResponse.json({
        success: true,
        data: null,
        message: "Brak aktywnej subskrypcji",
      });
    }

    const { subscription: sub, plan } = activeSub;

    // Calculate days remaining
    const now = new Date();
    const periodEnd = sub.currentPeriodEnd
      ? new Date(sub.currentPeriodEnd)
      : null;

    let daysRemaining: number | null = null;
    if (periodEnd) {
      const diffMs = periodEnd.getTime() - now.getTime();
      daysRemaining = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    }

    const warningThreshold = DEFAULT_WARNING_DAYS;
    const isNearExpiry =
      daysRemaining !== null && daysRemaining <= warningThreshold && daysRemaining >= 0;

    return NextResponse.json({
      success: true,
      data: {
        subscriptionId: sub.id,
        planName: plan.name,
        planSlug: plan.slug,
        status: sub.status,
        currentPeriodEnd: sub.currentPeriodEnd,
        daysRemaining,
        warningThreshold,
        isNearExpiry,
        renewalAmount: plan.priceMonthly,
      },
    });
  } catch (error) {
    logger.error("[Subscription Expiration Warning] Error", { error: error });
    return NextResponse.json(
      { success: false, error: "Nie udalo sie sprawdzic statusu wygasniecia" },
      { status: 500 }
    );
  }
}
