import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";
import { db } from "@/lib/db";
import { getUserSalonId } from "@/lib/get-user-salon";
import { salonSubscriptions, subscriptionPlans } from "@/lib/schema";
import { downgradeSubscriptionSchema, validateBody } from "@/lib/api-validation";

import { logger } from "@/lib/logger";
/**
 * POST /api/subscriptions/downgrade
 *
 * Schedules a downgrade from the current plan to a lower plan.
 * The downgrade takes effect at the end of the current billing period.
 *
 * Request body: { targetPlanSlug: "basic" }
 * Response: { success: true, scheduledChangeAt: string, message: string }
 */
export async function POST(request: Request) {
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

    const rawBody: unknown = await request.json();
    const validationError = validateBody(downgradeSubscriptionSchema, rawBody);
    if (validationError) {
      return NextResponse.json(validationError, { status: 400 });
    }

    const { targetPlanSlug } = rawBody as { targetPlanSlug: string };

    // Find the current active subscription
    const [activeSub] = await db
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
          eq(salonSubscriptions.status, "active"),
        ),
      );

    if (!activeSub) {
      return NextResponse.json(
        { success: false, error: "Brak aktywnej subskrypcji" },
        { status: 404 },
      );
    }

    // Can only downgrade, not upgrade via this endpoint
    if (activeSub.plan.slug === targetPlanSlug) {
      return NextResponse.json(
        { success: false, error: "Juz posiadasz ten plan" },
        { status: 409 },
      );
    }

    // Find the target plan
    const [targetPlan] = await db
      .select()
      .from(subscriptionPlans)
      .where(
        and(
          eq(subscriptionPlans.slug, targetPlanSlug),
          eq(subscriptionPlans.isActive, true),
        ),
      );

    if (!targetPlan) {
      return NextResponse.json(
        { success: false, error: "Plan docelowy nie zostal znaleziony" },
        { status: 404 },
      );
    }

    // Verify this is actually a downgrade (lower price)
    const currentPrice = parseFloat(activeSub.plan.priceMonthly);
    const targetPrice = parseFloat(targetPlan.priceMonthly);

    if (targetPrice >= currentPrice) {
      return NextResponse.json(
        { success: false, error: "To nie jest obnizenie planu. Uzyj endpointu upgrade." },
        { status: 400 },
      );
    }

    // Schedule the downgrade to take effect at the end of the current billing period
    const scheduledChangeAt = activeSub.subscription.currentPeriodEnd || new Date();

    const [updated] = await db
      .update(salonSubscriptions)
      .set({
        scheduledPlanId: targetPlan.id,
        scheduledChangeAt,
      })
      .where(eq(salonSubscriptions.id, activeSub.subscription.id))
      .returning();

    if (!updated) {
      return NextResponse.json(
        { success: false, error: "Nie udalo sie zaplanowac obnizenia planu" },
        { status: 500 },
      );
    }

    // eslint-disable-next-line no-console
    logger.info(`[Subscriptions API] Downgrade scheduled: ${activeSub.plan.slug} → ${targetPlanSlug} at ${scheduledChangeAt}`,);

    return NextResponse.json({
      success: true,
      message: `Obnizenie planu zaplanowane na ${scheduledChangeAt}`,
      scheduledChangeAt,
      currentPlan: activeSub.plan.slug,
      targetPlan: targetPlanSlug,
    });
  } catch (error) {
    logger.error("[Subscriptions API] Downgrade error", { error: error });
    return NextResponse.json(
      { success: false, error: "Nie udalo sie zaplanowac obnizenia planu" },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/subscriptions/downgrade
 *
 * Cancels a scheduled downgrade, removing the pending plan change.
 */
export async function DELETE() {
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

    // Find the current active subscription with a scheduled downgrade
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
        { success: false, error: "Brak aktywnej subskrypcji" },
        { status: 404 },
      );
    }

    if (!activeSub.scheduledPlanId) {
      return NextResponse.json(
        { success: false, error: "Brak zaplanowanego obnizenia planu" },
        { status: 404 },
      );
    }

    // Clear the scheduled downgrade
    await db
      .update(salonSubscriptions)
      .set({
        scheduledPlanId: null,
        scheduledChangeAt: null,
      })
      .where(eq(salonSubscriptions.id, activeSub.id));

    // eslint-disable-next-line no-console
    logger.info(`[Subscriptions API] Scheduled downgrade cancelled for subscription ${activeSub.id}`,);

    return NextResponse.json({
      success: true,
      message: "Zaplanowane obnizenie planu zostalo anulowane",
    });
  } catch (error) {
    logger.error("[Subscriptions API] Cancel downgrade error", { error: error });
    return NextResponse.json(
      { success: false, error: "Nie udalo sie anulowac obnizenia planu" },
      { status: 500 },
    );
  }
}
