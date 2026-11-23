import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { registerSubscriptionSchema, validateBody } from "@/lib/api-validation";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";
import { TRIAL_DAYS } from "@/lib/constants";
// ADR-001: ścieżka systemowa (salonId z danych subskrypcji/Stripe, nie z sesji) — świadomie surowe db
import { db } from "@/lib/db";
import {
  checkLegalAcceptance,
  recordLegalAcceptances,
  requiredLegalVersions,
  type LegalAcceptanceInput,
} from "@/lib/legal/acceptance";
import { logger } from "@/lib/logger";
import { subscriptionPlans, salonSubscriptions, salons } from "@/lib/schema";
import {
  isSubscriptionLockFailure,
  lockSalonSubscriptions,
  setSubscriptionLockTimeout,
} from "@/lib/subscription-locks";
import { isUniqueViolation } from "@/lib/subscription-predicates";

type SubscriptionRow = typeof salonSubscriptions.$inferSelect;

function alreadySubscribed() {
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

/**
 * POST /api/register-subscription
 *
 * Start triala dla salonu ZALOGOWANEGO konta. Wołana z dwóch miejsc:
 *  - formularz rejestracji (use-registration.ts) zaraz po signUp — gdy
 *    rejestracja wymaga potwierdzenia e-maila, sesji jeszcze nie ma i trasa
 *    zwraca 401 (UI traktuje to jako niekrytyczne),
 *  - CreateSalonPrompt w panelu, gdy zalogowane konto nie ma salonu.
 *
 * Body: { planSlug, email?: string, termsVersion?, dpaVersion?, acceptanceSource? }
 * — planSlug to element PLANS_ON_SALE
 * z @/lib/plan-catalog, inna wartość → 400 z walidacji. `email` jest
 * ignorowany: konto zawsze z sesji (authResult.user). Istniejącej
 * subskrypcji ta trasa nie zmienia (409) — zmiana planu tylko przez Stripe
 * (/api/subscriptions/checkout, /api/subscriptions/downgrade).
 *
 * T3b (Ethan §3 — niezmiennik „każdy salon ma dokładnie jeden wiersz” od
 * strony zapisu):
 *  - salon i subskrypcja w JEDNEJ transakcji — błąd zapisu subskrypcji nie
 *    zostawia salonu bez wiersza,
 *  - blokada salonu (`lockSalonSubscriptions`) przed odczytem jego wierszy,
 *    jak w confirm i webhooku; dwie równoległe rejestracje nie dają dwóch
 *    triali,
 *  - druga linia obrony: indeksy unikalne `salons_owner_id_uq` i
 *    `salon_subscriptions_salon_current_uq` → 23505 → 409,
 *  - tylko aktywny plan (`isActive`).
 *
 * Akceptacja regulaminu i umowy powierzenia (@/lib/legal/acceptance): po
 * publikacji dokumentów obie bieżące wersje są wymagane (inaczej 400
 * LEGAL_ACCEPTANCE_REQUIRED, bez zapytań do bazy), a dwa wpisy
 * `legal_acceptances` powstają w tej samej transakcji co salon i trial. Ta trasa
 * działa przed istnieniem salonu, więc zapis idzie surowym `db` jak reszta
 * transakcji (rola właściciela bazy), nie przez `forSalon`.
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
    const { planSlug, termsVersion, dpaVersion, acceptanceSource } = rawBody as {
      planSlug: string;
    } & LegalAcceptanceInput;
    const account = authResult.user;

    // Akceptacja regulaminu i DPA przed jakimkolwiek zapytaniem: bez niej salon nie
    // powstaje. Dopóki dokumenty nie są opublikowane, akceptacja nie obowiązuje.
    const legal = checkLegalAcceptance(
      { termsVersion, dpaVersion, acceptanceSource },
      requiredLegalVersions()
    );
    if (!legal.ok) {
      return NextResponse.json(legal.body, { status: 400 });
    }

    // Find the subscription plan (only plans offered for sale)
    const [plan] = await db
      .select()
      .from(subscriptionPlans)
      .where(and(eq(subscriptionPlans.slug, planSlug), eq(subscriptionPlans.isActive, true)))
      .limit(1);

    if (!plan) {
      return NextResponse.json(
        { success: false, error: "Plan not found" },
        { status: 404 }
      );
    }

    let result: { exists: true } | { salonId: string; subscription: SubscriptionRow };
    try {
      result = await db.transaction(async (tx) => {
        await setSubscriptionLockTimeout(tx);

        // Salon konta z sesji (jeden na konto — salons_owner_id_uq).
        const [salon] = await tx
          .select({ id: salons.id })
          .from(salons)
          .where(eq(salons.ownerId, account.id))
          .limit(1);

        let salonId = salon?.id;
        if (!salonId) {
          const [newSalon] = await tx
            .insert(salons)
            .values({
              name: `Salon ${account.name || "Nowy"}`,
              email: account.email,
              ownerId: account.id,
            })
            .returning({ id: salons.id });
          if (!newSalon) throw new Error("Register subscription: salon insert returned no row");
          salonId = newSalon.id;
        }

        await lockSalonSubscriptions(tx, salonId);

        // Dowolny wiersz (także canceled) = bez drugiego triala.
        const [existingSub] = await tx
          .select({ id: salonSubscriptions.id })
          .from(salonSubscriptions)
          .where(eq(salonSubscriptions.salonId, salonId))
          .limit(1);
        if (existingSub) return { exists: true } as const;

        const trialEnd = new Date();
        trialEnd.setDate(trialEnd.getDate() + TRIAL_DAYS);

        const [subscription] = await tx
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
        if (!subscription) throw new Error("Register subscription: subscription insert returned no row");

        // Dowód akceptacji w tej samej transakcji co salon i trial: błąd zapisu cofa całość.
        if (legal.acceptance) {
          await recordLegalAcceptances(tx, { salonId, userId: account.id, acceptance: legal.acceptance });
        }
        return { salonId, subscription };
      });
    } catch (error) {
      if (isSubscriptionLockFailure(error)) {
        logger.warn("[Register Subscription] Lock failure — retry", { userId: account.id });
        return NextResponse.json(
          { success: false, code: "LOCK_BUSY", error: "Rejestracja jest w toku. Sprobuj ponownie za chwile." },
          { status: 503 }
        );
      }
      // Równoległa rejestracja tego samego konta zdążyła pierwsza
      // (salons_owner_id_uq albo salon_subscriptions_salon_current_uq).
      if (isUniqueViolation(error)) {
        logger.info("[Register Subscription] Concurrent registration won — 409", { userId: account.id });
        return alreadySubscribed();
      }
      throw error;
    }

    if ("exists" in result) return alreadySubscribed();

    const { salonId, subscription } = result;
    logger.info("[Register Subscription] Created trial subscription", {
      salonId,
      planSlug: plan.slug,
      trialEndsAt: subscription.trialEndsAt?.toISOString() ?? null,
    });

    return NextResponse.json({
      success: true,
      data: {
        subscriptionId: subscription.id,
        planName: plan.name,
        planSlug: plan.slug,
        status: subscription.status,
        trialEndsAt: subscription.trialEndsAt,
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
