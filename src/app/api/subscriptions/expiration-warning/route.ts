import { NextResponse } from "next/server";
import { eq, and, or, like, sql } from "drizzle-orm";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";
// salonId z sesji; surowe db: odczyt aktywnej subskrypcji; odczyt ostatnich ostrzeżeń idzie
// przez forSalon
import { db } from "@/lib/db";
import { getUserSalonId } from "@/lib/get-user-salon";
import { logger } from "@/lib/logger";
import {
  salonSubscriptions,
  subscriptionPlans,
  notifications,
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
 * - recentWarnings: Up to 5 newest notifications of the salon whose message matches one of the expiration-warning patterns
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
    const [activeSub] = await db
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

    // Get recent expiration warning notifications
    const recentWarnings = await forSalon(salonId).raw((tx) =>
      tx
        .select()
        .from(notifications)
        .where(
          and(
            eq(notifications.salonId, salonId),
            or(
              like(notifications.message, "%wygasa%"),
              like(notifications.message, "%odnowienia%"),
              like(notifications.message, "%expir%")
            )
          )
        )
        .orderBy(sql`${notifications.createdAt} DESC`)
        .limit(5)
    );

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
        recentWarnings: recentWarnings.map((w) => ({
          id: w.id,
          type: w.type,
          message: w.message,
          status: w.status,
          sentAt: w.sentAt,
          createdAt: w.createdAt,
        })),
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
