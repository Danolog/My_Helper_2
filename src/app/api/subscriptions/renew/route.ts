import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  salonSubscriptions,
  subscriptionPayments,
  subscriptionPlans,
} from "@/lib/schema";

const DEMO_SALON_ID = "00000000-0000-0000-0000-000000000001";

/**
 * POST /api/subscriptions/renew
 *
 * Simulates automatic subscription renewal for dev/testing.
 * In production, renewals are handled by Stripe webhooks (invoice.paid).
 *
 * This endpoint:
 * 1. Finds the active subscription
 * 2. Creates a new payment record (simulating the automatic charge)
 * 3. Updates the subscription period dates (advances by 1 month)
 * 4. Applies any scheduled plan changes (e.g., pending downgrades)
 *
 * Response: { success: true, subscription: {...}, payment: {...} }
 */
export async function POST() {
  try {
    // Authenticate the user
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) {
      return NextResponse.json(
        { success: false, error: "Wymagane logowanie" },
        { status: 401 }
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
          eq(salonSubscriptions.salonId, DEMO_SALON_ID),
          eq(salonSubscriptions.status, "active")
        )
      );

    if (!activeSub) {
      return NextResponse.json(
        {
          success: false,
          error: "Brak aktywnej subskrypcji do odnowienia",
        },
        { status: 404 }
      );
    }

    const { subscription: sub, plan } = activeSub;

    // Calculate new period dates
    const now = new Date();
    const newPeriodStart = sub.currentPeriodEnd || now;
    const newPeriodEnd = new Date(newPeriodStart);
    newPeriodEnd.setMonth(newPeriodEnd.getMonth() + 1);

    // Check for scheduled plan change (downgrade at period end)
    let renewPlanId = sub.planId;
    let renewPlan = plan;
    let planChanged = false;

    if (sub.scheduledPlanId) {
      // Apply the scheduled plan change
      const [targetPlan] = await db
        .select()
        .from(subscriptionPlans)
        .where(eq(subscriptionPlans.id, sub.scheduledPlanId));

      if (targetPlan) {
        renewPlanId = targetPlan.id;
        renewPlan = targetPlan;
        planChanged = true;

        // eslint-disable-next-line no-console
        console.log(
          `[Subscription Renewal] Applying scheduled plan change: ${plan.slug} → ${targetPlan.slug}`
        );
      }
    }

    // Record the renewal payment
    const [payment] = await db
      .insert(subscriptionPayments)
      .values({
        subscriptionId: sub.id,
        salonId: DEMO_SALON_ID,
        amount: renewPlan.priceMonthly,
        currency: "PLN",
        stripePaymentIntentId: `sim_renewal_pi_${Date.now()}`,
        status: "succeeded",
        paidAt: now,
      })
      .returning();

    // Update subscription with new period dates
    const [updatedSub] = await db
      .update(salonSubscriptions)
      .set({
        planId: renewPlanId,
        currentPeriodStart: newPeriodStart,
        currentPeriodEnd: newPeriodEnd,
        // Clear scheduled changes if applied
        ...(planChanged
          ? { scheduledPlanId: null, scheduledChangeAt: null }
          : {}),
      })
      .where(eq(salonSubscriptions.id, sub.id))
      .returning();

    // eslint-disable-next-line no-console
    console.log(
      `[Subscription Renewal] Subscription ${sub.id} renewed. ` +
        `Plan: ${renewPlan.slug} (${renewPlan.priceMonthly} PLN). ` +
        `New period: ${newPeriodStart.toISOString()} - ${newPeriodEnd.toISOString()}` +
        (planChanged ? ` (plan changed from ${plan.slug} to ${renewPlan.slug})` : "")
    );

    return NextResponse.json({
      success: true,
      message: planChanged
        ? `Subskrypcja odnowiona z nowym planem ${renewPlan.name}`
        : "Subskrypcja zostala automatycznie odnowiona",
      subscription: {
        id: updatedSub?.id ?? sub.id,
        planId: renewPlanId,
        planName: renewPlan.name,
        planSlug: renewPlan.slug,
        status: "active",
        currentPeriodStart: newPeriodStart,
        currentPeriodEnd: newPeriodEnd,
        amount: renewPlan.priceMonthly,
      },
      payment: payment
        ? {
            id: payment.id,
            amount: payment.amount,
            status: payment.status,
            paidAt: payment.paidAt,
          }
        : null,
      planChanged,
      previousPlan: planChanged ? plan.slug : null,
      newPlan: renewPlan.slug,
    });
  } catch (error) {
    console.error("[Subscription Renewal] Error:", error);
    return NextResponse.json(
      { success: false, error: "Nie udalo sie odnowic subskrypcji" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/subscriptions/renew
 *
 * Returns information about the next renewal for the active subscription.
 */
export async function GET() {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) {
      return NextResponse.json(
        { success: false, error: "Wymagane logowanie" },
        { status: 401 }
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
          eq(salonSubscriptions.salonId, DEMO_SALON_ID),
          eq(salonSubscriptions.status, "active")
        )
      );

    if (!activeSub) {
      return NextResponse.json({
        success: true,
        renewal: null,
        message: "Brak aktywnej subskrypcji",
      });
    }

    const { subscription: sub, plan } = activeSub;

    // Check if there's a scheduled plan change
    let scheduledPlanInfo = null;
    if (sub.scheduledPlanId) {
      const [targetPlan] = await db
        .select()
        .from(subscriptionPlans)
        .where(eq(subscriptionPlans.id, sub.scheduledPlanId));

      if (targetPlan) {
        scheduledPlanInfo = {
          id: targetPlan.id,
          name: targetPlan.name,
          slug: targetPlan.slug,
          priceMonthly: targetPlan.priceMonthly,
        };
      }
    }

    return NextResponse.json({
      success: true,
      renewal: {
        subscriptionId: sub.id,
        currentPlan: {
          name: plan.name,
          slug: plan.slug,
          priceMonthly: plan.priceMonthly,
        },
        nextRenewalDate: sub.currentPeriodEnd,
        renewalAmount: scheduledPlanInfo
          ? scheduledPlanInfo.priceMonthly
          : plan.priceMonthly,
        scheduledPlanChange: scheduledPlanInfo,
        isAutoRenewal: true,
      },
    });
  } catch (error) {
    console.error("[Subscription Renewal] Error:", error);
    return NextResponse.json(
      { success: false, error: "Nie udalo sie pobrac informacji o odnowieniu" },
      { status: 500 }
    );
  }
}
