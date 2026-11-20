import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";
import { getUserSalonId } from "@/lib/get-user-salon";
import { logger } from "@/lib/logger";
import { salonSubscriptions, subscriptionPlans } from "@/lib/schema";
import { forSalon } from "@/lib/server/repository";
import { getStripe } from "@/lib/stripe";

/**
 * POST /api/subscriptions/renew
 *
 * Ręczne odnowienie NIE istnieje. Okres subskrypcji przedłuża wyłącznie
 * webhook Stripe `invoice.paid` (podpisany, po faktycznym obciążeniu),
 * razem z zapisem płatności i zastosowaniem zaplanowanej zmiany planu.
 *
 * Wcześniej ta trasa „symulowała” odnowienie: przesuwała currentPeriodEnd
 * o miesiąc i zapisywała płatność `sim_renewal_pi_*` bez Stripe — każdy
 * właściciel z aktywną subskrypcją dostawał darmowy miesiąc na kliknięcie.
 *
 * Trasa nigdy niczego nie zapisuje:
 * - Stripe nieskonfigurowany → 503 STRIPE_UNAVAILABLE (spójnie z checkout),
 * - Stripe skonfigurowany → 409 RENEWAL_MANAGED_BY_STRIPE.
 */
export async function POST() {
  const authResult = await requireAuth();
  if (isAuthError(authResult)) return authResult;

  if (!getStripe()) {
    logger.warn("Subscription renewal refused: Stripe not configured");
    return NextResponse.json(
      {
        success: false,
        code: "STRIPE_UNAVAILABLE",
        error:
          "Płatności online są chwilowo niedostępne. Subskrypcja nie została odnowiona — spróbuj ponownie później.",
      },
      { status: 503 },
    );
  }

  return NextResponse.json(
    {
      success: false,
      code: "RENEWAL_MANAGED_BY_STRIPE",
      error:
        "Subskrypcja odnawia się automatycznie po pobraniu opłaty przez Stripe. Ręczne odnowienie nie jest dostępne.",
    },
    { status: 409 },
  );
}

/**
 * GET /api/subscriptions/renew
 *
 * Returns information about the next renewal for the active subscription.
 */
export async function GET() {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

    const salonId = await getUserSalonId();
    if (!salonId) {
      return NextResponse.json(
        { success: false, error: "Salon not found" },
        { status: 404 }
      );
    }

    // Oba odczyty przez repozytorium salonu, w jednej transakcji z kontekstem salonu.
    const { activeSub, targetPlan } = await forSalon(salonId).raw(async (tx) => {
      // Find the current active subscription
      const [active] = await tx
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
            eq(salonSubscriptions.salonId, salonId),
            eq(salonSubscriptions.status, "active")
          )
        );

      // Check if there's a scheduled plan change.
      // Katalog planów jest globalny (bez salon_id).
      let target: typeof subscriptionPlans.$inferSelect | undefined;
      const scheduledPlanId = active?.subscription.scheduledPlanId;
      if (scheduledPlanId) {
        [target] = await tx
          .select()
          .from(subscriptionPlans)
          .where(eq(subscriptionPlans.id, scheduledPlanId));
      }

      return { activeSub: active, targetPlan: target };
    });

    if (!activeSub) {
      return NextResponse.json({
        success: true,
        renewal: null,
        message: "Brak aktywnej subskrypcji",
      });
    }

    const { subscription: sub, plan } = activeSub;

    // Plan docelowy odczytany wyżej tylko przy zaplanowanej zmianie.
    const scheduledPlanInfo = targetPlan
      ? {
          id: targetPlan.id,
          name: targetPlan.name,
          slug: targetPlan.slug,
          priceMonthly: targetPlan.priceMonthly,
        }
      : null;

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
    logger.error("[Subscription Renewal] Error", { error: error });
    return NextResponse.json(
      { success: false, error: "Nie udalo sie pobrac informacji o odnowieniu" },
      { status: 500 }
    );
  }
}
