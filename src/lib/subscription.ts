import { eq, and, desc, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { salonSubscriptions, subscriptionPlans } from "@/lib/schema";
import { getUserSalonId } from "@/lib/get-user-salon";

export type PlanSlug = "basic" | "pro";

export type CurrentPlan = {
  slug: PlanSlug;
  name: string;
  status: string;
};

/**
 * Gets the current subscription plan for the given salon (or the authenticated user's salon).
 * Returns the plan slug and name, or defaults to "basic" if no subscription found.
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

    return {
      slug: row.planSlug as PlanSlug,
      name: row.planName,
      status: row.status,
    };
  } catch (error) {
    console.error("[Subscription] Error fetching current plan:", error);
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
