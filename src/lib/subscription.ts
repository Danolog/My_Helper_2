import { eq, and, desc, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { getUserSalonId } from "@/lib/get-user-salon";
import { logger } from "@/lib/logger";
import { salonSubscriptions, subscriptionPlans } from "@/lib/schema";

export type PlanSlug = "basic" | "pro";

export type CurrentPlan = {
  slug: PlanSlug;
  name: string;
  status: string;
};

/** Wartość dla wiersza `trialing`, którego okres próbny się skończył albo nie ma daty końca. */
const TRIAL_EXPIRED_PLAN: CurrentPlan = { slug: "basic", name: "Basic", status: "trial_expired" };

/**
 * Gets the current subscription plan for the given salon (or the authenticated user's salon).
 * Returns the plan slug and name, or defaults to "basic" if no subscription found.
 *
 * Okres próbny jest egzekwowany w chwili odczytu: wiersz `trialing` daje swój
 * plan tylko dopóki `trialEndsAt > teraz` (granica wyłącznie). Brak
 * `trialEndsAt` przy `trialing` zamyka dostęp. Porównanie w JS, nie w SQL:
 * kolumna jest bez strefy, a `now()` zależałoby od strefy sesji. Wiersz
 * `active` nie zależy od `trialEndsAt`.
 */
export async function getCurrentPlan(salonId?: string): Promise<CurrentPlan> {
  try {
    const resolvedSalonId = salonId ?? (await getUserSalonId());
    if (!resolvedSalonId) {
      return { slug: "basic", name: "Basic", status: "active" };
    }

    const results = await db
      .select({
        planSlug: subscriptionPlans.slug,
        planName: subscriptionPlans.name,
        status: salonSubscriptions.status,
        trialEndsAt: salonSubscriptions.trialEndsAt,
      })
      .from(salonSubscriptions)
      .innerJoin(
        subscriptionPlans,
        eq(salonSubscriptions.planId, subscriptionPlans.id)
      )
      .where(
        and(
          eq(salonSubscriptions.salonId, resolvedSalonId),
          inArray(salonSubscriptions.status, ["active", "trialing"])
        )
      )
      .orderBy(desc(salonSubscriptions.createdAt))
      .limit(1);

    const row = results[0];
    if (!row) {
      return { slug: "basic", name: "Basic", status: "active" };
    }

    if (row.status === "trialing") {
      if (!row.trialEndsAt) {
        // Stan niespójny (każdy trial ma datę końca) — widoczny w logach.
        logger.warn("Trialing subscription without trial end date", { salonId: resolvedSalonId });
        return TRIAL_EXPIRED_PLAN;
      }
      if (row.trialEndsAt.getTime() <= Date.now()) {
        return TRIAL_EXPIRED_PLAN;
      }
    }

    return {
      slug: row.planSlug as PlanSlug,
      name: row.planName,
      status: row.status,
    };
  } catch (error) {
    logger.error("Error fetching current subscription plan", { error });
    return { slug: "basic", name: "Basic", status: "active" };
  }
}

/**
 * Checks if the given salon (or the authenticated user's salon) has a Pro plan.
 * Returns true if the plan is "pro", false otherwise.
 */
export async function isProPlan(salonId?: string): Promise<boolean> {
  const plan = await getCurrentPlan(salonId);
  return plan.slug === "pro";
}
