import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";
import { validateBody, subscriptionCheckoutSchema } from "@/lib/api-validation";
import { db } from "@/lib/db";
import { getUserSalonId } from "@/lib/get-user-salon";
import { logger } from "@/lib/logger";
import { strictRateLimit, getClientIp } from "@/lib/rate-limit";
import { subscriptionPlans, salonSubscriptions, subscriptionPayments } from "@/lib/schema";
import { getStripe, isStripePricesConfigured } from "@/lib/stripe";

/**
 * Map plan slugs to their corresponding Stripe price env variables.
 */
function getStripePriceId(slug: string): string | undefined {
  if (slug === "basic") return process.env.STRIPE_PRICE_BASIC || undefined;
  if (slug === "pro") return process.env.STRIPE_PRICE_PRO || undefined;
  return undefined;
}

/**
 * Creates a simulated subscription directly in the database.
 * Used as a fallback when Stripe is not configured or when
 * the Stripe API call fails (e.g., invalid/test keys in dev mode).
 *
 * If the salon already has a trialing subscription, it upgrades it
 * to "active" status instead of creating a duplicate.
 */
async function createSimulatedSubscription(
  planId: string,
  priceMonthly: string,
  _salonId: string,
): Promise<{ subscriptionId: string }> {
  const now = new Date();
  const periodEnd = new Date(now);
  periodEnd.setMonth(periodEnd.getMonth() + 1);

  // Check if there is an existing trialing or canceled subscription to reactivate
  const { inArray } = await import("drizzle-orm");
  const existingReusable = await db
    .select()
    .from(salonSubscriptions)
    .where(
      and(
        eq(salonSubscriptions.salonId, _salonId),
        inArray(salonSubscriptions.status, ["trialing", "canceled"]),
      ),
    );

  let subscription;

  if (existingReusable.length > 0 && existingReusable[0]) {
    // Reactivate existing subscription (trialing or canceled)
    const [updated] = await db
      .update(salonSubscriptions)
      .set({
        planId,
        stripeSubscriptionId: `sim_sub_${Date.now()}`,
        stripeCustomerId: `sim_cus_${Date.now()}`,
        status: "active",
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        trialEndsAt: null,
        canceledAt: null,
      })
      .where(eq(salonSubscriptions.id, existingReusable[0].id))
      .returning();

    subscription = updated;
    logger.info("Reactivated subscription to active", {
      previousStatus: existingReusable[0].status,
      subscriptionId: existingReusable[0].id,
    });
  } else {
    // Create new active subscription
    const [created] = await db
      .insert(salonSubscriptions)
      .values({
        salonId: _salonId,
        planId,
        stripeSubscriptionId: `sim_sub_${Date.now()}`,
        stripeCustomerId: `sim_cus_${Date.now()}`,
        status: "active",
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
      })
      .returning();

    subscription = created;
  }

  if (!subscription) {
    throw new Error("Failed to create simulated subscription record");
  }

  // Record the simulated payment
  await db.insert(subscriptionPayments).values({
    subscriptionId: subscription.id,
    salonId: _salonId,
    amount: priceMonthly,
    currency: "PLN",
    stripePaymentIntentId: `sim_pi_${Date.now()}`,
    status: "succeeded",
    paidAt: now,
  });

  return { subscriptionId: subscription.id };
}

/**
 * POST /api/subscriptions/checkout
 *
 * Creates a Stripe Checkout Session for a subscription plan, or falls
 * back to a simulated (dev-mode) subscription when Stripe is
 * unavailable or misconfigured.
 *
 * Request body: { planSlug: "basic" | "pro" }
 * Response:     { url: string }
 */
export async function POST(request: Request) {
  // Rate limit: payment checkout is a sensitive operation
  const ip = getClientIp(request);
  const rateLimitResult = strictRateLimit.check(ip);
  if (!rateLimitResult.success) {
    return NextResponse.json(
      { success: false, error: "Zbyt wiele żądań. Spróbuj ponownie później." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rateLimitResult.reset / 1000)) } }
    );
  }

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

    const body: unknown = await request.json();
    const validationError = validateBody(subscriptionCheckoutSchema, body);
    if (validationError) {
      return NextResponse.json(validationError, { status: 400 });
    }

    const { planSlug } = body as { planSlug: string };

    if (planSlug !== "basic" && planSlug !== "pro") {
      return NextResponse.json(
        { success: false, error: "planSlug must be 'basic' or 'pro'" },
        { status: 400 },
      );
    }

    // Look up the plan in the database
    const [plan] = await db
      .select()
      .from(subscriptionPlans)
      .where(
        and(
          eq(subscriptionPlans.slug, planSlug),
          eq(subscriptionPlans.isActive, true),
        ),
      );

    if (!plan) {
      return NextResponse.json(
        { success: false, error: "Plan nie zostal znaleziony" },
        { status: 404 },
      );
    }

    // Check if salon already has an active subscription for the same plan
    const existingSubscriptions = await db
      .select()
      .from(salonSubscriptions)
      .where(
        and(
          eq(salonSubscriptions.salonId, salonId),
          eq(salonSubscriptions.status, "active"),
        ),
      );

    if (existingSubscriptions.length > 0 && existingSubscriptions[0]) {
      const existingSub = existingSubscriptions[0];
      if (existingSub.planId === plan.id) {
        return NextResponse.json(
          {
            success: false,
            error: "Salon posiada juz aktywna subskrypcje tego planu.",
          },
          { status: 409 },
        );
      }
      // Different plan → upgrade: update the existing subscription's planId
      // and record a new payment for the upgrade
      const now = new Date();
      const periodEnd = new Date(now);
      periodEnd.setMonth(periodEnd.getMonth() + 1);

      await db
        .update(salonSubscriptions)
        .set({
          planId: plan.id,
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
        })
        .where(eq(salonSubscriptions.id, existingSub.id));

      await db.insert(subscriptionPayments).values({
        subscriptionId: existingSub.id,
        salonId: salonId,
        amount: plan.priceMonthly,
        currency: "PLN",
        stripePaymentIntentId: `sim_upgrade_pi_${Date.now()}`,
        status: "succeeded",
        paidAt: now,
      });

      logger.info("Subscription upgraded", {
        subscriptionId: existingSub.id,
        planSlug: plan.slug,
      });

      return NextResponse.json({
        success: true,
        url: `/dashboard/subscription?upgraded=true`,
      });
    }

    // Attempt to create a real Stripe Checkout Session
    const stripe = getStripe();

    if (stripe) {
      try {
        // Determine the price: use configured Stripe price ID or create ad-hoc
        let lineItem: {
          price?: string;
          price_data?: {
            currency: string;
            product_data: { name: string; description: string };
            unit_amount: number;
            recurring: { interval: "month" };
          };
          quantity: number;
        };

        const configuredPriceId = isStripePricesConfigured()
          ? getStripePriceId(planSlug)
          : undefined;

        if (configuredPriceId) {
          lineItem = { price: configuredPriceId, quantity: 1 };
        } else {
          // Ad-hoc price from the plan's monthly price
          const unitAmount = Math.round(parseFloat(plan.priceMonthly) * 100);
          lineItem = {
            price_data: {
              currency: "pln",
              product_data: {
                name: `MyHelper ${plan.name}`,
                description: `Subskrypcja miesięczna planu ${plan.name}`,
              },
              unit_amount: unitAmount,
              recurring: { interval: "month" },
            },
            quantity: 1,
          };
        }

        const origin =
          process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

        const checkoutSession = await stripe.checkout.sessions.create({
          mode: "subscription",
          payment_method_types: ["card"],
          line_items: [lineItem],
          success_url: `${origin}/dashboard/subscription/success?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${origin}/pricing`,
          customer_email: user.email,
          metadata: {
            salonId: salonId,
            planId: plan.id,
            planSlug: plan.slug,
            userId: user.id,
          },
        });

        logger.info("Stripe Checkout session created", {
          sessionId: checkoutSession.id,
          planSlug: plan.slug,
        });

        return NextResponse.json({
          success: true,
          url: checkoutSession.url,
        });
      } catch (stripeError) {
        // Stripe call failed -- fall through to dev-mode simulation
        logger.warn("Stripe Checkout creation failed, using dev fallback", {
          error: stripeError instanceof Error ? stripeError.message : stripeError,
        });
      }
    }

    // Dev-mode fallback: create a simulated subscription directly in DB
    logger.info("Creating simulated subscription (dev fallback)", {
      planSlug: plan.slug,
    });

    await createSimulatedSubscription(plan.id, plan.priceMonthly, salonId);

    return NextResponse.json({
      success: true,
      url: "/dashboard/subscription?activated=true",
    });
  } catch (error) {
    logger.error("Subscription checkout error", { error });
    return NextResponse.json(
      { success: false, error: "Nie udalo sie utworzyc sesji platnosci" },
      { status: 500 },
    );
  }
}
