import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { PLANS } from "@/lib/constants";
// ADR-001: ścieżka publiczna (globalny cennik, bez tenant) — świadomie surowe db
// eslint-disable-next-line no-restricted-imports
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { PLAN_FEATURES, featuresFor } from "@/lib/plan-features";
import { subscriptionPlans } from "@/lib/schema";
// Subscription plans rarely change — revalidate every hour to reduce DB queries
export const revalidate = 3600;

/**
 * Default plan data - used to seed the database if no plans exist.
 * Prices are in PLN. Feature lists live in `src/lib/plan-features.ts`.
 */
const DEFAULT_PLANS = [
  {
    name: PLANS.basic.name,
    slug: PLANS.basic.slug,
    priceMonthly: PLANS.basic.priceMonthly.toFixed(2),
    featuresJson: [...PLAN_FEATURES.basic],
  },
  {
    name: PLANS.pro.name,
    slug: PLANS.pro.slug,
    priceMonthly: PLANS.pro.priceMonthly.toFixed(2),
    featuresJson: [...PLAN_FEATURES.pro],
  },
];

/**
 * Seed plans into database if they don't exist.
 */
async function ensurePlansExist() {
  const existingPlans = await db
    .select()
    .from(subscriptionPlans)
    .where(eq(subscriptionPlans.isActive, true));

  if (existingPlans.length === 0) {
    // Seed the default plans
    for (const plan of DEFAULT_PLANS) {
      await db.insert(subscriptionPlans).values({
        name: plan.name,
        slug: plan.slug,
        priceMonthly: plan.priceMonthly,
        featuresJson: plan.featuresJson,
        isActive: true,
      });
    }

    // Re-fetch after seeding
    return db
      .select()
      .from(subscriptionPlans)
      .where(eq(subscriptionPlans.isActive, true));
  }

  return existingPlans;
}

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
