/**
 * Wyjście systemowe (#193 P5b): globalny cennik planów subskrypcji dla
 * `GET /api/subscription-plans`. Tabela `subscription_plans` nie należy do
 * żadnego salonu (bez sesji, bez danych najemcy), więc odczyt i dosiewanie
 * idą przez pulę systemową, nie przez `forSalon`.
 *
 * Dosiewanie przy pustej liście aktywnych planów: wstawiane wartości pochodzą
 * wyłącznie z kodu (`PLANS`, `PLAN_FEATURES`), bez danych z żądania. Konflikt
 * po unikalnym `slug` jest ignorowany (`ON CONFLICT (slug) DO NOTHING`), więc
 * równoległe pierwsze żądania nie kończą się naruszeniem unikalności.
 */
import { eq } from "drizzle-orm";
import { PLANS } from "@/lib/constants";
import { PLAN_FEATURES } from "@/lib/plan-features";
import { subscriptionPlans } from "@/lib/schema";
import { dbSystem } from "./db-system";

/**
 * Plany domyślne wstawiane, gdy w bazie nie ma aktywnych planów.
 * Ceny w PLN. Listy funkcji: `src/lib/plan-features.ts`.
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
 * Zwraca aktywne plany. Gdy nie ma żadnego, wstawia plany domyślne
 * (konflikt po `slug` pomijany) i zwraca wynik ponownego odczytu.
 * Błąd bazy propaguje do wołającego.
 */
export async function ensurePlansExist() {
  const existingPlans = await dbSystem
    .select()
    .from(subscriptionPlans)
    .where(eq(subscriptionPlans.isActive, true));

  if (existingPlans.length === 0) {
    for (const plan of DEFAULT_PLANS) {
      await dbSystem
        .insert(subscriptionPlans)
        .values({
          name: plan.name,
          slug: plan.slug,
          priceMonthly: plan.priceMonthly,
          featuresJson: plan.featuresJson,
          isActive: true,
        })
        .onConflictDoNothing({ target: subscriptionPlans.slug });
    }

    return dbSystem
      .select()
      .from(subscriptionPlans)
      .where(eq(subscriptionPlans.isActive, true));
  }

  return existingPlans;
}
