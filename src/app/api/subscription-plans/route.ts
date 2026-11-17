import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { featuresFor } from "@/lib/plan-features";
// ADR-001: globalny cennik bez danych najemcy — wyjście systemowe #193
import { ensurePlansExist } from "@/lib/server/system";
// Subscription plans rarely change — revalidate every hour to reduce DB queries
export const revalidate = 3600;

/**
 * GET /api/subscription-plans
 *
 * Returns all active subscription plans with their features and prices.
 * Auto-seeds Basic and Pro plans if the table is empty.
 */
export async function GET() {
  try {
    const plans = await ensurePlansExist();

    // Sort so Basic comes first, Pro second
    const sortedPlans = plans.sort((a, b) => {
      if (a.slug === "basic") return -1;
      if (b.slug === "basic") return 1;
      return 0;
    });

    return NextResponse.json({
      success: true,
      data: sortedPlans.map((plan) => ({
        id: plan.id,
        name: plan.name,
        slug: plan.slug,
        priceMonthly: plan.priceMonthly,
        features: featuresFor(plan.slug, plan.featuresJson),
        isActive: plan.isActive,
      })),
    });
  } catch (error) {
    logger.error("[Subscription Plans API] Error", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to fetch subscription plans" },
      { status: 500 }
    );
  }
}
