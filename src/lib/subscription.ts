import { eq, and, desc, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { salonSubscriptions, subscriptionPlans } from "@/lib/schema";

const DEMO_SALON_ID = "00000000-0000-0000-0000-000000000001";

export type PlanSlug = "basic" | "pro";

export type CurrentPlan = {
  slug: PlanSlug;
  name: string;
  status: string;
};

/**
 * Gets the current subscription plan for the demo salon.
 * Returns the plan slug and name, or defaults to "basic" if no subscription found.
 */
export async function getCurrentPlan(): Promise<CurrentPlan> {
  try {
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
          eq(salonSubscriptions.salonId, DEMO_SALON_ID),
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
 * Checks if the current salon has a Pro plan subscription.
 * Returns true if the plan is "pro", false otherwise.
 */
export async function isProPlan(): Promise<boolean> {
  const plan = await getCurrentPlan();
  return plan.slug === "pro";
}
