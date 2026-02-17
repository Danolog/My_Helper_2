import { NextResponse } from "next/server";
import { eq, and, desc, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { salonSubscriptions, subscriptionPlans } from "@/lib/schema";

const DEMO_SALON_ID = "00000000-0000-0000-0000-000000000001";

/**
 * GET /api/subscriptions/current
 *
 * Returns the current active (or most recent) subscription for the
 * demo salon, joined with plan details so the UI can display plan
 * name, features, and pricing without a second request.
 *
 * Includes "active", "trialing", and "canceled" subscriptions so the
 * UI can show the current plan state (including canceled status with
 * reactivation option).
 *
 * Response shape:
 *   { subscription: {...} | null, plan: {...} | null }
 */
export async function GET() {
  try {
    // Find the most recent subscription for the salon (active, trialing, or canceled)
    const results = await db
      .select({
        subscription: salonSubscriptions,
        plan: subscriptionPlans,
      })
      .from(salonSubscriptions)
      .innerJoin(
        subscriptionPlans,
        eq(salonSubscriptions.planId, subscriptionPlans.id),
      )
      .where(
        and(
          eq(salonSubscriptions.salonId, DEMO_SALON_ID),
          inArray(salonSubscriptions.status, ["active", "trialing", "canceled"]),
        ),
      )
      .orderBy(desc(salonSubscriptions.createdAt))
      .limit(1);

    const row = results[0];

    if (!row) {
      return NextResponse.json({
        success: true,
        subscription: null,
        plan: null,
      });
    }

    return NextResponse.json({
      success: true,
      subscription: {
        id: row.subscription.id,
        salonId: row.subscription.salonId,
        planId: row.subscription.planId,
        stripeSubscriptionId: row.subscription.stripeSubscriptionId,
        stripeCustomerId: row.subscription.stripeCustomerId,
        status: row.subscription.status,
        trialEndsAt: row.subscription.trialEndsAt,
        currentPeriodStart: row.subscription.currentPeriodStart,
        currentPeriodEnd: row.subscription.currentPeriodEnd,
        canceledAt: row.subscription.canceledAt,
        createdAt: row.subscription.createdAt,
      },
      plan: {
        id: row.plan.id,
        name: row.plan.name,
        slug: row.plan.slug,
        priceMonthly: row.plan.priceMonthly,
        features: row.plan.featuresJson as string[],
        isActive: row.plan.isActive,
      },
    });
  } catch (error) {
    console.error("[Subscriptions API] Error fetching current subscription:", error);
    return NextResponse.json(
      { success: false, error: "Nie udalo sie pobrac subskrypcji" },
      { status: 500 },
    );
  }
}
