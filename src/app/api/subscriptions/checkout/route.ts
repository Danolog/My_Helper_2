import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { subscriptionPlans, salonSubscriptions, subscriptionPayments } from "@/lib/schema";
import { getStripe, isStripePricesConfigured } from "@/lib/stripe";

const DEMO_SALON_ID = "00000000-0000-0000-0000-000000000001";

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

  // Check if there is an existing trialing subscription to upgrade
  const existingTrialing = await db
    .select()
    .from(salonSubscriptions)
    .where(
      and(
        eq(salonSubscriptions.salonId, _salonId),
        eq(salonSubscriptions.status, "trialing"),
      ),
    );

  let subscription;

  if (existingTrialing.length > 0 && existingTrialing[0]) {
    // Upgrade existing trialing subscription to active
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
      })
      .where(eq(salonSubscriptions.id, existingTrialing[0].id))
      .returning();

    subscription = updated;
    // eslint-disable-next-line no-console
    console.log(
      `[Subscriptions API] Upgraded trialing subscription ${existingTrialing[0].id} to active`,
    );
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
  try {
    // Authenticate the user via Better Auth session
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) {
      return NextResponse.json(
        { success: false, error: "Wymagane logowanie" },
        { status: 401 },
      );
    }

    const body: unknown = await request.json();
    if (
      !body ||
      typeof body !== "object" ||
      !("planSlug" in body) ||
      typeof (body as Record<string, unknown>).planSlug !== "string"
    ) {
      return NextResponse.json(
        { success: false, error: "planSlug is required" },
        { status: 400 },
      );
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
          eq(salonSubscriptions.salonId, DEMO_SALON_ID),
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
        salonId: DEMO_SALON_ID,
        amount: plan.priceMonthly,
        currency: "PLN",
        stripePaymentIntentId: `sim_upgrade_pi_${Date.now()}`,
        status: "succeeded",
        paidAt: now,
      });

      // eslint-disable-next-line no-console
      console.log(
        `[Subscriptions API] Upgraded subscription ${existingSub.id} to plan ${plan.slug}`,
      );

      return NextResponse.json({
        success: true,
        url: "/dashboard/subscription?activated=true",
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
          customer_email: session.user.email,
          metadata: {
            salonId: DEMO_SALON_ID,
            planId: plan.id,
            planSlug: plan.slug,
            userId: session.user.id,
          },
        });

        // eslint-disable-next-line no-console
        console.log(
          `[Subscriptions API] Stripe Checkout created: ${checkoutSession.id} for plan ${plan.slug}`,
        );

        return NextResponse.json({
          success: true,
          url: checkoutSession.url,
        });
      } catch (stripeError) {
        // Stripe call failed -- fall through to dev-mode simulation
        console.warn(
          "[Subscriptions API] Stripe Checkout creation failed, using dev fallback:",
          stripeError instanceof Error ? stripeError.message : stripeError,
        );
      }
    }

    // Dev-mode fallback: create a simulated subscription directly in DB
    // eslint-disable-next-line no-console
    console.log(
      `[Subscriptions API] Creating simulated subscription for plan ${plan.slug} (dev fallback)`,
    );

    await createSimulatedSubscription(plan.id, plan.priceMonthly, DEMO_SALON_ID);

    return NextResponse.json({
      success: true,
      url: "/dashboard/subscription?activated=true",
    });
  } catch (error) {
    console.error("[Subscriptions API] Checkout error:", error);
    return NextResponse.json(
      { success: false, error: "Nie udalo sie utworzyc sesji platnosci" },
      { status: 500 },
    );
  }
}
