import { NextResponse } from "next/server";
import { validateBody, subscriptionConfirmSchema } from "@/lib/api-validation";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";
import { getUserSalonId } from "@/lib/get-user-salon";
import { logger } from "@/lib/logger";
import { getStripe } from "@/lib/stripe";
import {
  confirmSubscriptionCheckout,
  type SubscriptionCheckoutSession,
} from "@/lib/subscription-confirmation";

/**
 * POST /api/subscriptions/confirm
 *
 * Called by the success page after Stripe redirects back.
 * Retrieves the Stripe Checkout Session and confirms it through the shared
 * confirmSubscriptionCheckout() — the same function the webhook uses on
 * `checkout.session.completed` (T3):
 * - salon from the user's session; `metadata.salonId` of another salon → 403,
 * - only `mode === "subscription"` with a real Stripe subscription,
 * - billing period from Stripe (`current_period_*`),
 * - idempotent per salon; a parallel confirmation (webhook) → alreadyConfirmed,
 * - a trial row becomes the paid row (no second row for the salon).
 *
 * Request body: { sessionId: string }
 */
export async function POST(request: Request) {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

    const currentSalonId = await getUserSalonId();
    if (!currentSalonId) {
      return NextResponse.json(
        { success: false, error: "Salon not found" },
        { status: 404 },
      );
    }

    const body: unknown = await request.json();
    const validationError = validateBody(subscriptionConfirmSchema, body);
    if (validationError) {
      return NextResponse.json(validationError, { status: 400 });
    }

    const { sessionId } = body as { sessionId: string };

    const stripe = getStripe();

    if (!stripe) {
      // Bez Stripe nie da się zweryfikować płatności, a checkout bez Stripe
      // niczego nie tworzy (PR #36) — to błąd, nie sukces. Kod spójny z checkout.
      logger.warn("Subscription confirm refused: Stripe not configured");
      return NextResponse.json(
        {
          success: false,
          code: "STRIPE_UNAVAILABLE",
          error:
            "Płatności online są chwilowo niedostępne. Nie udało się potwierdzić płatności — spróbuj ponownie później.",
        },
        { status: 503 },
      );
    }

    // Retrieve the Checkout Session from Stripe
    let checkoutSession;
    try {
      checkoutSession = await stripe.checkout.sessions.retrieve(sessionId, {
        expand: ["subscription"],
      });
    } catch (stripeError) {
      logger.error("Failed to retrieve Stripe session", { error: stripeError });
      return NextResponse.json(
        { success: false, error: "Nie udalo sie zweryfikowac sesji Stripe" },
        { status: 502 },
      );
    }

    const result = await confirmSubscriptionCheckout(
      stripe,
      checkoutSession as unknown as SubscriptionCheckoutSession,
      { expectedSalonId: currentSalonId },
    );

    if (!result.ok) {
      return NextResponse.json(
        { success: false, code: result.code, error: result.error },
        { status: result.status },
      );
    }

    if (result.alreadyConfirmed) {
      return NextResponse.json({
        success: true,
        alreadyConfirmed: true,
        subscription: result.subscription,
      });
    }

    const { plan } = result;
    return NextResponse.json({
      success: true,
      subscription: result.subscription,
      plan: plan
        ? {
            id: plan.id,
            name: plan.name,
            slug: plan.slug,
            priceMonthly: plan.priceMonthly,
          }
        : null,
    });
  } catch (error) {
    logger.error("Subscription confirm error", { error });
    return NextResponse.json(
      { success: false, error: "Nie udalo sie potwierdzic subskrypcji" },
      { status: 500 },
    );
  }
}
