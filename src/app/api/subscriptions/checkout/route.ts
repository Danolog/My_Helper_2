import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { validateBody, subscriptionCheckoutSchema } from "@/lib/api-validation";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";
// ADR-001: ścieżka systemowa (salonId z danych subskrypcji/Stripe, nie z sesji) — świadomie surowe db
// eslint-disable-next-line no-restricted-imports
import { db } from "@/lib/db";
import { getUserSalonId } from "@/lib/get-user-salon";
import { logger } from "@/lib/logger";
import { strictRateLimit, getClientIp } from "@/lib/rate-limit";
import { subscriptionPlans, salonSubscriptions } from "@/lib/schema";
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
 * Lokalny wiersz subskrypcji bez prawdziwej subskrypcji w Stripe
 * (null albo identyfikator z dawnej symulacji `sim_*`).
 */
function hasRealStripeSubscription(stripeSubscriptionId: string | null): boolean {
  return !!stripeSubscriptionId && !stripeSubscriptionId.startsWith("sim_");
}

function stripeUnavailableResponse() {
  return NextResponse.json(
    {
      success: false,
      code: "STRIPE_UNAVAILABLE",
      error:
        "Płatności online są chwilowo niedostępne. Plan nie został zmieniony — spróbuj ponownie później.",
    },
    { status: 503 },
  );
}

/**
 * POST /api/subscriptions/checkout
 *
 * Creates a Stripe Checkout Session for a subscription plan.
 *
 * This endpoint NEVER writes a subscription or a payment. The subscription
 * is created/updated only by /api/subscriptions/confirm after Stripe reports
 * the Checkout Session as paid. Stripe not configured → 503, Stripe error
 * → 502; in both cases nothing is granted.
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

    // salonId z body (jesli ktos go wysle) jest odrzucany przez schemat —
    // salon wylacznie z sesji (wyzej).
    const { planSlug } = subscriptionCheckoutSchema.parse(body);

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
      // Zmiana planu opłaconej subskrypcji Stripe wymaga
      // stripe.subscriptions.update (proracja + synchronizacja planId z
      // webhooka) — do decyzji architektonicznej. Nowy Checkout założyłby
      // drugą subskrypcję w Stripe (podwójne obciążenie), więc odmawiamy.
      if (hasRealStripeSubscription(existingSub.stripeSubscriptionId)) {
        return NextResponse.json(
          {
            success: false,
            code: "PLAN_CHANGE_UNSUPPORTED",
            error:
              "Zmiana planu opłaconej subskrypcji nie jest jeszcze dostępna online. Skontaktuj się z obsługą.",
          },
          { status: 409 },
        );
      }
      // Subskrypcja bez prawdziwego Stripe: nowy plan tylko przez Checkout,
      // planId zmienia /api/subscriptions/confirm po opłaceniu.
    }

    // Attempt to create a real Stripe Checkout Session
    const stripe = getStripe();
    if (!stripe) {
      logger.warn("Subscription checkout refused: Stripe not configured", {
        planSlug: plan.slug,
      });
      return stripeUnavailableResponse();
    }

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
      logger.error("Stripe Checkout creation failed", {
        error: stripeError instanceof Error ? stripeError.message : stripeError,
        planSlug: plan.slug,
      });
      return NextResponse.json(
        {
          success: false,
          code: "STRIPE_ERROR",
          error:
            "Nie udało się połączyć z systemem płatności. Plan nie został zmieniony — spróbuj ponownie później.",
        },
        { status: 502 },
      );
    }
  } catch (error) {
    logger.error("Subscription checkout error", { error });
    return NextResponse.json(
      { success: false, error: "Nie udalo sie utworzyc sesji platnosci" },
      { status: 500 },
    );
  }
}
