import { NextResponse } from "next/server";
import { eq, and, inArray, desc } from "drizzle-orm";
import { validateBody, subscriptionCheckoutSchema } from "@/lib/api-validation";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";
// ADR-001: ścieżka systemowa (salonId z danych subskrypcji/Stripe, nie z sesji) — świadomie surowe db
import { db } from "@/lib/db";
import { getUserSalonId } from "@/lib/get-user-salon";
import { logger } from "@/lib/logger";
import { strictRateLimit, getClientIp } from "@/lib/rate-limit";
import { subscriptionPlans, salonSubscriptions } from "@/lib/schema";
import { forSalon } from "@/lib/server/repository";
import { getStripe, isStripePricesConfigured } from "@/lib/stripe";
import {
  CURRENT_LOCAL_STATUSES,
  hasRealStripeSubscription,
  isCurrentLocalStatus,
  isCurrentPaidStripeRow,
  pickSalonAccessRow,
  resolveSalonAccess,
  type SalonSubscriptionAccessRow,
} from "@/lib/subscription-predicates";

type AccessRow = SalonSubscriptionAccessRow & { stripeSubscriptionId: string | null };

const warsawDate = new Intl.DateTimeFormat("pl-PL", {
  timeZone: "Europe/Warsaw",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

// Czas życia sesji Checkout (`expires_at`, sekundy). Stripe przyjmuje od
// 30 minut do 24 godzin od utworzenia sesji; 5 minut ponad dolną granicę to
// zapas na opóźnienie żądania i różnicę zegarów.
const CHECKOUT_SESSION_TTL_SECONDS = 35 * 60;

/**
 * Map plan slugs to their corresponding Stripe price env variables.
 */
function getStripePriceId(slug: string): string | undefined {
  if (slug === "basic") return process.env.STRIPE_PRICE_BASIC || undefined;
  if (slug === "pro") return process.env.STRIPE_PRICE_PRO || undefined;
  return undefined;
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
 * Creates a Stripe Checkout Session for a subscription plan. The session's
 * `expires_at` is set to 35 minutes after the moment it is created.
 *
 * This endpoint NEVER writes a subscription or a payment. The subscription
 * is created/updated only by /api/subscriptions/confirm after Stripe reports
 * the Checkout Session as paid. Stripe not configured → 503, Stripe error
 * → 502; in both cases nothing is granted.
 *
 * 409 PURCHASE_BLOCKED_UNTIL_PERIOD_END (with `until`): the salon still has
 * full access from a canceled or past_due row with a real Stripe
 * subscription (`resolveSalonAccess` over all salon rows). A new Checkout
 * would create a second Stripe subscription while access from the first one
 * lasts; a new purchase is possible after `until`.
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

    // Bieżące wiersze salonu (trialing/active). Ten sam predykat konfliktu co
    // confirm (`isCurrentPaidStripeRow`): wiersz z prawdziwą subskrypcją
    // Stripe — także trial prowadzony przez Stripe — blokuje nowy Checkout
    // TUTAJ, przed pobraniem pieniędzy, a nie dopiero 409 w confirm.
    const currentRows = (
      await db
        .select()
        .from(salonSubscriptions)
        .where(
          and(
            eq(salonSubscriptions.salonId, salonId),
            inArray(salonSubscriptions.status, [...CURRENT_LOCAL_STATUSES]),
          ),
        )
    ).filter((s) => isCurrentLocalStatus(s.status));

    const paidStripeRow = currentRows.find(isCurrentPaidStripeRow);
    const samePlanActive = currentRows.find((s) => s.status === "active" && s.planId === plan.id);
    if (samePlanActive || paidStripeRow?.planId === plan.id) {
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
    if (paidStripeRow) {
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
    // Wiersz bez prawdziwego Stripe (nasz trial z rejestracji, dawne `sim_*`):
    // nowy plan tylko przez Checkout, planId zmienia confirm po opłaceniu —
    // ten sam wiersz, bez drugiego.

    // Dostęp z wszystkich wierszy salonu (ta sama reguła co bramki):
    // pełny dostęp z wiersza canceled/past_due z prawdziwą subskrypcją Stripe
    // znaczy, że nowy Checkout założyłby drugą subskrypcję w Stripe, gdy
    // dostęp z pierwszej jeszcze trwa (canceled — druga opłata za te same
    // dni; past_due — stara subskrypcja w Stripe nie jest zakończona). Odmawiamy do
    // `access.until`, bez wywołania Stripe i bez zapisu.
    const accessRows = await forSalon(salonId).raw(async (tx) => {
      const all = await tx
        .select({
          subscription: salonSubscriptions,
          plan: subscriptionPlans,
        })
        .from(salonSubscriptions)
        .innerJoin(
          subscriptionPlans,
          eq(salonSubscriptions.planId, subscriptionPlans.id),
        )
        .where(eq(salonSubscriptions.salonId, salonId))
        .orderBy(desc(salonSubscriptions.createdAt), desc(salonSubscriptions.id));
      return all.map(
        ({ subscription, plan: rowPlan }): AccessRow => ({
          status: subscription.status,
          planSlug: rowPlan.slug,
          trialEndsAt: subscription.trialEndsAt,
          currentPeriodStart: subscription.currentPeriodStart,
          currentPeriodEnd: subscription.currentPeriodEnd,
          createdAt: subscription.createdAt,
          stripeSubscriptionId: subscription.stripeSubscriptionId,
        }),
      );
    });
    const picked = pickSalonAccessRow(accessRows);
    const access = resolveSalonAccess(accessRows, new Date());
    if (
      access.mode === "full" &&
      (access.state === "canceled" || access.state === "past_due") &&
      access.until &&
      picked &&
      hasRealStripeSubscription(picked.stripeSubscriptionId)
    ) {
      const untilText = warsawDate.format(access.until);
      return NextResponse.json(
        {
          success: false,
          code: "PURCHASE_BLOCKED_UNTIL_PERIOD_END",
          until: access.until.toISOString(),
          error:
            access.state === "canceled"
              ? `Subskrypcja jest anulowana, ale dostęp trwa do ${untilText}. Nowy zakup będzie możliwy po tym terminie.`
              : `Płatność za subskrypcję jest zaległa. Nowy zakup będzie możliwy po ${untilText}. W sprawie zaległej płatności skontaktuj się z obsługą.`,
        },
        { status: 409 },
      );
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
        expires_at: Math.floor(Date.now() / 1000) + CHECKOUT_SESSION_TTL_SECONDS,
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
