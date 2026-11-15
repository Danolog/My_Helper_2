import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { downgradeSubscriptionSchema, validateBody } from "@/lib/api-validation";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";
import { getUserSalonId } from "@/lib/get-user-salon";
import { logger } from "@/lib/logger";
import { salonSubscriptions, subscriptionPlans } from "@/lib/schema";
// T3b: odczyt „active” i zapis pod blokadą salonu (jak confirm i webhook) —
// bez przeplotu z webhookiem zmieniającym stan tej subskrypcji.
import { isSubscriptionLockFailure, withSalonSubscriptionLock } from "@/lib/subscription-locks";

function lockBusyResponse() {
  return NextResponse.json(
    { success: false, code: "LOCK_BUSY", error: "Subskrypcja jest właśnie aktualizowana. Spróbuj ponownie za chwilę." },
    { status: 503 },
  );
}

function fail(status: number, error: string) {
  return { response: NextResponse.json({ success: false, error }, { status }) } as const;
}

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

    let result;
    try {
      result = await withSalonSubscriptionLock(salonId, async (tx) => {
        // Find the current active subscription (under the salon lock)
        const [activeSub] = await tx
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

        if (!activeSub) return fail(404, "Brak aktywnej subskrypcji");

        // Can only downgrade, not upgrade via this endpoint
        if (activeSub.plan.slug === targetPlanSlug) return fail(409, "Juz posiadasz ten plan");

        // Find the target plan
        const [targetPlan] = await tx
          .select()
          .from(subscriptionPlans)
          .where(
            and(
              eq(subscriptionPlans.slug, targetPlanSlug),
              eq(subscriptionPlans.isActive, true),
            ),
          );

        if (!targetPlan) return fail(404, "Plan docelowy nie zostal znaleziony");

        // Verify this is actually a downgrade (lower price)
        const currentPrice = parseFloat(activeSub.plan.priceMonthly);
        const targetPrice = parseFloat(targetPlan.priceMonthly);

        if (targetPrice >= currentPrice) {
          return fail(400, "To nie jest obnizenie planu. Uzyj endpointu upgrade.");
        }

        // Schedule the downgrade to take effect at the end of the current billing period
        const scheduledChangeAt = activeSub.subscription.currentPeriodEnd || new Date();

        const [updated] = await tx
          .update(salonSubscriptions)
          .set({
            scheduledPlanId: targetPlan.id,
            scheduledChangeAt,
          })
          .where(eq(salonSubscriptions.id, activeSub.subscription.id))
          .returning();

        if (!updated) throw new Error("Downgrade: update returned no row");
        return { scheduledChangeAt, currentPlanSlug: activeSub.plan.slug } as const;
      });
    } catch (error) {
      if (isSubscriptionLockFailure(error)) return lockBusyResponse();
      throw error;
    }

    if ("response" in result) return result.response;
    const { scheduledChangeAt, currentPlanSlug } = result;

    logger.info("[Subscriptions API] Downgrade scheduled", {
      salonId,
      currentPlan: currentPlanSlug,
      targetPlan: targetPlanSlug,
      scheduledChangeAt: scheduledChangeAt.toISOString(),
    });

    return NextResponse.json({
      success: true,
      message: `Obnizenie planu zaplanowane na ${scheduledChangeAt}`,
      scheduledChangeAt,
      currentPlan: currentPlanSlug,
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

    let result;
    try {
      result = await withSalonSubscriptionLock(salonId, async (tx) => {
        // Find the current active subscription with a scheduled downgrade
        const [activeSub] = await tx
          .select()
          .from(salonSubscriptions)
          .where(
            and(
              eq(salonSubscriptions.salonId, salonId),
              eq(salonSubscriptions.status, "active"),
            ),
          );

        if (!activeSub) return fail(404, "Brak aktywnej subskrypcji");
        if (!activeSub.scheduledPlanId) return fail(404, "Brak zaplanowanego obnizenia planu");

        // Clear the scheduled downgrade
        await tx
          .update(salonSubscriptions)
          .set({
            scheduledPlanId: null,
            scheduledChangeAt: null,
          })
          .where(eq(salonSubscriptions.id, activeSub.id));
        return { subscriptionId: activeSub.id } as const;
      });
    } catch (error) {
      if (isSubscriptionLockFailure(error)) return lockBusyResponse();
      throw error;
    }

    if ("response" in result) return result.response;

    logger.info("[Subscriptions API] Scheduled downgrade cancelled", { subscriptionId: result.subscriptionId });

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
