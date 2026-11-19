import { NextResponse } from "next/server";
import { eq, desc } from "drizzle-orm";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";
import { getUserSalonId } from "@/lib/get-user-salon";
import { logger } from "@/lib/logger";
import { featuresFor } from "@/lib/plan-features";
import { salonSubscriptions, subscriptionPlans } from "@/lib/schema";
import { forSalon } from "@/lib/server/repository";
import {
  pickSalonAccessRow,
  purchaseBlock,
  resolveSalonAccess,
  toSalonPurchaseAccessRow,
  type SalonPurchaseAccessRow,
} from "@/lib/subscription-predicates";

type SubscriptionWithPlan = {
  subscription: typeof salonSubscriptions.$inferSelect;
  plan: typeof subscriptionPlans.$inferSelect;
};

type AccessRow = SalonPurchaseAccessRow & { source: SubscriptionWithPlan };

function toAccessRow(source: SubscriptionWithPlan): AccessRow {
  return { ...toSalonPurchaseAccessRow(source.subscription, source.plan.slug), source };
}

/**
 * GET /api/subscriptions/current
 *
 * Karta planu salonu z sesji. Jeden odczyt przez repozytorium salonu:
 * wszystkie wiersze subskrypcji salonu z planem; karta pokazuje wiersz,
 * z którego liczony jest dostęp (`pickSalonAccessRow`: bieżący
 * `trialing`/`active`, a bez niego najnowszy — także `past_due`, `canceled`
 * i inne statusy). Gdy wybrany wiersz ma zaplanowaną zmianę planu, plan
 * docelowy jest odczytywany w tym samym odczycie.
 *
 * Response shape:
 *   { subscription: {...} | null, plan: {...} | null, scheduledPlan (gdy jest
 *     wiersz), effectivePlanSlug, access: { state, mode, planSlug, until },
 *     purchaseBlockedUntil: string | null }
 *
 * `plan` opisuje plan wybranego wiersza. `access` — stan dostępu wyliczony
 * tą samą regułą co bramki serwerowe; karta planu w panelu bierze z niego
 * termin dostępu dla anulowanej i zaległej subskrypcji.
 * Liczy go `resolveSalonAccess` na tych samych wierszach. `effectivePlanSlug`
 * to plan przy pełnym dostępie, inaczej "basic" (np. trial po terminie albo
 * `canceled` po końcu okresu). UI decyduje o funkcjach Pro wyłącznie na podstawie
 * `effectivePlanSlug`. `purchaseBlockedUntil` (ISO albo null) to termin, do
 * którego trasa zakupu odmawia nowego zakupu; liczy go `purchaseBlock`, ta
 * sama funkcja co odmowę, na tych samych wierszach i w tej samej chwili co
 * `access`. Błąd odczytu → 500.
 */
export async function GET() {
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

    const { rows, picked, targetPlan } = await forSalon(salonId).raw(async (tx) => {
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

      const accessRows = all.map(toAccessRow);
      const chosen = pickSalonAccessRow(accessRows);

      // Plan docelowy zaplanowanej zmiany — tylko dla wybranego wiersza.
      // Katalog planów jest globalny (bez salon_id).
      let target: typeof subscriptionPlans.$inferSelect | undefined;
      const scheduledPlanId = chosen?.source.subscription.scheduledPlanId;
      if (scheduledPlanId) {
        [target] = await tx
          .select()
          .from(subscriptionPlans)
          .where(eq(subscriptionPlans.id, scheduledPlanId));
      }

      return { rows: accessRows, picked: chosen, targetPlan: target };
    });

    const now = new Date();
    const access = resolveSalonAccess(rows, now);
    const effectivePlanSlug = access.planSlug ?? "basic";
    const purchaseBlockedUntil = purchaseBlock(rows, now)?.until.toISOString() ?? null;

    if (!picked) {
      return NextResponse.json({
        success: true,
        subscription: null,
        plan: null,
        effectivePlanSlug,
        access,
        purchaseBlockedUntil,
      });
    }

    const row = picked.source;
    const scheduledPlan = targetPlan
      ? {
          id: targetPlan.id,
          name: targetPlan.name,
          slug: targetPlan.slug,
          priceMonthly: targetPlan.priceMonthly,
          features: featuresFor(targetPlan.slug, targetPlan.featuresJson),
        }
      : null;

    return NextResponse.json({
      success: true,
      subscription: {
        id: row.subscription.id,
        salonId: row.subscription.salonId,
        planId: row.subscription.planId,
        stripeSubscriptionId: row.subscription.stripeSubscriptionId,
        stripeCustomerId: row.subscription.stripeCustomerId,
        status: row.subscription.status,
        trialEndsAt: row.subscription.trialEndsAt,
        currentPeriodStart: row.subscription.currentPeriodStart,
        currentPeriodEnd: row.subscription.currentPeriodEnd,
        canceledAt: row.subscription.canceledAt,
        scheduledPlanId: row.subscription.scheduledPlanId,
        scheduledChangeAt: row.subscription.scheduledChangeAt,
        createdAt: row.subscription.createdAt,
      },
      plan: {
        id: row.plan.id,
        name: row.plan.name,
        slug: row.plan.slug,
        priceMonthly: row.plan.priceMonthly,
        features: featuresFor(row.plan.slug, row.plan.featuresJson),
        isActive: row.plan.isActive,
      },
      scheduledPlan,
      effectivePlanSlug,
      access,
      purchaseBlockedUntil,
    });
  } catch (error) {
    logger.error("[Subscriptions API] Error fetching current subscription", { error: error });
    return NextResponse.json(
      { success: false, error: "Nie udalo sie pobrac subskrypcji" },
      { status: 500 },
    );
  }
}
