import { eq, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { getUserSalonId } from "@/lib/get-user-salon";
import { logger } from "@/lib/logger";
import { salonSubscriptions, subscriptionPlans } from "@/lib/schema";
import {
  SALON_ACCESS_UNAVAILABLE,
  pickSalonAccessRow,
  resolveSalonAccess,
  type SalonAccess,
  type SalonSubscriptionAccessRow,
} from "@/lib/subscription-predicates";

export type PlanSlug = "basic" | "pro";

export type CurrentPlan = {
  slug: PlanSlug;
  name: string;
  status: string;
};

type AccessRow = SalonSubscriptionAccessRow & { planName: string };

type AccessRead = { access: SalonAccess; row: AccessRow | undefined };

/**
 * Jeden odczyt: wszystkie wiersze subskrypcji salonu z planem, od najnowszego.
 * Przy tym samym `createdAt` kolejność ustala `id`, malejąco.
 * Dostęp liczy `resolveSalonAccess` w chwili odczytu. Błąd odczytu →
 * `unavailable` (tylko odczyt), bez wyjątku.
 */
async function readSalonAccess(salonId: string): Promise<AccessRead> {
  try {
    const rows: AccessRow[] = await db
      .select({
        planSlug: subscriptionPlans.slug,
        planName: subscriptionPlans.name,
        status: salonSubscriptions.status,
        trialEndsAt: salonSubscriptions.trialEndsAt,
        currentPeriodStart: salonSubscriptions.currentPeriodStart,
        currentPeriodEnd: salonSubscriptions.currentPeriodEnd,
        createdAt: salonSubscriptions.createdAt,
      })
      .from(salonSubscriptions)
      .innerJoin(subscriptionPlans, eq(salonSubscriptions.planId, subscriptionPlans.id))
      .where(eq(salonSubscriptions.salonId, salonId))
      .orderBy(desc(salonSubscriptions.createdAt), desc(salonSubscriptions.id));

    const row = pickSalonAccessRow(rows);
    if (row?.status === "trialing" && !row.trialEndsAt) {
      // Stan niespójny (każdy trial ma datę końca) — widoczny w logach.
      logger.warn("Trialing subscription without trial end date", { salonId });
    }
    return { access: resolveSalonAccess(rows, new Date()), row };
  } catch (error) {
    logger.error("Error reading salon subscription access", { error, salonId });
    return { access: { ...SALON_ACCESS_UNAVAILABLE }, row: undefined };
  }
}

/**
 * Stan dostępu salonu wg jego subskrypcji (`resolveSalonAccess`). Nie rzuca:
 * błąd odczytu daje `unavailable` / `read_only`.
 */
export async function getSalonAccess(salonId: string): Promise<SalonAccess> {
  return (await readSalonAccess(salonId)).access;
}

function basicPlan(status: string): CurrentPlan {
  return { slug: "basic", name: "Basic", status };
}

/**
 * Plan salonu (podanego albo z sesji) liczony ze stanu dostępu.
 *
 * Pełny dostęp → plan z wybranego wiersza ze statusem wiersza (`active`,
 * `trialing`, `past_due`, `canceled` przed końcem okresu). Bez pełnego dostępu → `basic` ze
 * statusem stanu dostępu (`trial_expired` dla zakończonego triala, inaczej
 * `none`, `unavailable`, `past_due`, `canceled`, `inactive`). Brak salonu
 * w sesji → `basic` / `none`.
 */
export async function getCurrentPlan(salonId?: string): Promise<CurrentPlan> {
  let resolvedSalonId: string | null;
  try {
    resolvedSalonId = salonId ?? (await getUserSalonId());
  } catch (error) {
    logger.error("Error resolving salon for current subscription plan", { error });
    return basicPlan("unavailable");
  }
  if (!resolvedSalonId) return basicPlan("none");

  const { access, row } = await readSalonAccess(resolvedSalonId);
  if (access.mode === "full" && row) {
    return { slug: row.planSlug as PlanSlug, name: row.planName, status: access.state };
  }
  return basicPlan(access.state === "expired" ? "trial_expired" : access.state);
}

/**
 * Checks if the given salon (or the authenticated user's salon) has a Pro plan.
 * Returns true if the plan is "pro", false otherwise.
 */
export async function isProPlan(salonId?: string): Promise<boolean> {
  const plan = await getCurrentPlan(salonId);
  return plan.slug === "pro";
}
