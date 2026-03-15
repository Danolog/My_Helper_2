import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { subscriptionPlans } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { PLANS } from "@/lib/constants";

// Subscription plans rarely change — revalidate every hour to reduce DB queries
export const revalidate = 3600;

/**
 * Default plan data - used to seed the database if no plans exist.
 * Prices are in PLN.
 */
const DEFAULT_PLANS = [
  {
    name: PLANS.basic.name,
    slug: PLANS.basic.slug,
    priceMonthly: PLANS.basic.priceMonthly.toFixed(2),
    featuresJson: [
      "Pelne zarzadzanie salonem",
      "Kalendarz i grafiki pracownikow",
      "Kartoteka klientow",
      "System rezerwacji online",
      "Portal klienta z rezerwacja",
      "Powiadomienia SMS i email",
      "Zarzadzanie uslugami i wariantami",
      "Magazyn produktow",
      "System opinii i ocen",
      "Raporty podstawowe",
      "Platnosci zadatkow (Stripe + Blik)",
      "Integracja z drukarka fiskalna",
      "Galeria zdjec salonu",
      "Promocje i programy lojalnosciowe",
    ],
  },
  {
    name: PLANS.pro.name,
    slug: PLANS.pro.slug,
    priceMonthly: PLANS.pro.priceMonthly.toFixed(2),
    featuresJson: [
      "Wszystko z planu Basic",
      "Asystent AI glosowy (odbieranie polaczen)",
      "Asystent AI biznesowy (analiza danych)",
      "Asystent AI content (generowanie tresci)",
      "Rekomendacje AI na dashboardzie",
      "Analiza trendow i konkurencji",
      "Generowanie postow na social media",
      "Generowanie opisow uslug",
      "Tworzenie i wysylka newsletterow",
      "Widget planowania marketingowego",
      "Proaktywne sugestie biznesowe",
      "Priorytetowe wsparcie techniczne",
    ],
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
        features: plan.featuresJson as string[],
        isActive: plan.isActive,
      })),
    });
  } catch (error) {
    console.error("[Subscription Plans API] Error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch subscription plans" },
      { status: 500 }
    );
  }
}
