import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { registerSubscriptionSchema, validateBody } from "@/lib/api-validation";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";
import { TRIAL_DAYS } from "@/lib/constants";
// ADR-001: ścieżka systemowa (salonId z danych subskrypcji/Stripe, nie z sesji) — świadomie surowe db
// eslint-disable-next-line no-restricted-imports
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { subscriptionPlans, salonSubscriptions, salons } from "@/lib/schema";
/**
 * POST /api/register-subscription
 *
 * Start triala dla salonu ZALOGOWANEGO konta. Wołana z dwóch miejsc:
 *  - formularz rejestracji (use-registration.ts) zaraz po signUp — gdy
 *    rejestracja wymaga potwierdzenia e-maila, sesji jeszcze nie ma i trasa
 *    zwraca 401 (UI traktuje to jako niekrytyczne),
 *  - CreateSalonPrompt w panelu, gdy zalogowane konto nie ma salonu.
 *
 * Body: { planSlug: "basic" | "pro", email?: string } — `email` jest
 * ignorowany: konto zawsze z sesji (authResult.user). Istniejącej
 * subskrypcji ta trasa nie zmienia (409) — zmiana planu tylko przez Stripe
 * (/api/subscriptions/checkout, /api/subscriptions/downgrade).
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;
    const rawBody = await request.json();
    const validationError = validateBody(registerSubscriptionSchema, rawBody);
    if (validationError) {
      return NextResponse.json(validationError, { status: 400 });
    }
    const { planSlug } = rawBody as { planSlug: string };
    const account = authResult.user;

    // Find the subscription plan
    const [plan] = await db
      .select()
      .from(subscriptionPlans)
      .where(eq(subscriptionPlans.slug, planSlug))
      .limit(1);

    if (!plan) {
      return NextResponse.json(
        { success: false, error: "Plan not found" },
        { status: 404 }
      );
    }

    // Find the salon owned by this user
    const [salon] = await db
      .select()
      .from(salons)
      .where(eq(salons.ownerId, account.id))
      .limit(1);

    let salonId: string;

    if (salon) {
      salonId = salon.id;
    } else {
      // Create a default salon for the user
      const [newSalon] = await db
        .insert(salons)
        .values({
          name: `Salon ${account.name || "Nowy"}`,
          email: account.email,
          ownerId: account.id,
        })
        .returning();
      salonId = newSalon!.id;
    }

    // Check for existing subscription
    const [existingSub] = await db
      .select()
      .from(salonSubscriptions)
      .where(eq(salonSubscriptions.salonId, salonId))
      .limit(1);

    if (existingSub) {
      // Bez zmiany planu: ta trasa nie pobiera płatności, więc podniesienie
      // planu tutaj = Pro za darmo. Zmiana planu wyłącznie przez Stripe.
      return NextResponse.json(
        {
          success: false,
          error: "Salon ma juz subskrypcje. Zmiana planu odbywa sie w ustawieniach subskrypcji.",
        },
        { status: 409 }
      );
    }

    // Create salon subscription with trial period
    const trialEnd = new Date();
    trialEnd.setDate(trialEnd.getDate() + TRIAL_DAYS);

    const [subscription] = await db
      .insert(salonSubscriptions)
      .values({
        salonId,
        planId: plan.id,
        status: "trialing",
        trialEndsAt: trialEnd,
        currentPeriodStart: new Date(),
        currentPeriodEnd: trialEnd,
      })
      .returning();

    logger.info(`[Register Subscription] Created subscription for salon ${salonId}: plan=${plan.name}, status=trialing, trial_ends=${trialEnd.toISOString()}`);

    return NextResponse.json({
      success: true,
      data: {
        subscriptionId: subscription!.id,
        planName: plan.name,
        planSlug: plan.slug,
        status: subscription!.status,
        trialEndsAt: subscription!.trialEndsAt,
      },
    });
  } catch (error) {
    logger.error("[Register Subscription] Error", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to create subscription" },
      { status: 500 }
    );
  }
}
