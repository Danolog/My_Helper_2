import { NextResponse } from "next/server";
import { eq, and, desc, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";
import { db } from "@/lib/db";
import { getUserSalonId } from "@/lib/get-user-salon";
import { salonSubscriptions, subscriptionPlans } from "@/lib/schema";

/**
 * GET /api/subscriptions/current
 *
 * Returns the current active (or most recent) subscription for the
 * authenticated user's salon, joined with plan details so the UI can
 * display plan name, features, and pricing without a second request.
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
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

    const salonId = await getUserSalonId();
    if (!salonId) {
      return NextResponse.json(
        { success: false, error: "Salon not found" },
        { status: 404 },
      );
    }

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
          eq(salonSubscriptions.salonId, salonId),
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

    // If there's a scheduled plan change (downgrade), fetch the target plan details
    let scheduledPlan: { id: string; name: string; slug: string; priceMonthly: string; features: string[] } | null = null;
    if (row.subscription.scheduledPlanId) {
      const scheduledPlanAlias = alias(subscriptionPlans, "scheduled_plan");
      const [targetPlan] = await db
        .select()
        .from(scheduledPlanAlias)
        .where(eq(scheduledPlanAlias.id, row.subscription.scheduledPlanId));

      if (targetPlan) {
        scheduledPlan = {
          id: targetPlan.id,
          name: targetPlan.name,
          slug: targetPlan.slug,
          priceMonthly: targetPlan.priceMonthly,
          features: targetPlan.featuresJson as string[],
        };
      }
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
        scheduledPlanId: row.subscription.scheduledPlanId,
        scheduledChangeAt: row.subscription.scheduledChangeAt,
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
      scheduledPlan,
    });
  } catch (error) {
    console.error("[Subscriptions API] Error fetching current subscription:", error);
    return NextResponse.json(
      { success: false, error: "Nie udalo sie pobrac subskrypcji" },
      { status: 500 },
    );
  }
}
