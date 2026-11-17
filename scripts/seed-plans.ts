/**
 * Plany Basic i Pro w seedzie testowym (#193 P5b).
 *
 * Nazwa, slug i cena pochodzą z `PLANS` (`src/lib/constants.ts`), lista funkcji
 * z `PLAN_FEATURES` (`src/lib/plan-features.ts`) — bez wartości wpisanych ręcznie.
 *
 * Wstawianie jest idempotentne po `slug` (UNIQUE): `ON CONFLICT (slug) DO NOTHING`.
 * Istniejący wiersz planu (np. dosiany wcześniej przez `GET /api/subscription-plans`)
 * zostaje bez zmian; ponowny seed niczego w nim nie nadpisuje.
 *
 * Moduł bez efektów ubocznych (bez połączenia z bazą przy imporcie), więc
 * testy jednostkowe mogą go importować; `seed-test.ts` i `verify-seed.ts` tak.
 */
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { PLANS } from "../src/lib/constants";
import { PLAN_FEATURES } from "../src/lib/plan-features";
import { subscriptionPlans } from "../src/lib/schema";

export type SeedPlan = {
  id: string;
  name: string;
  slug: "basic" | "pro";
  priceMonthly: string;
  featuresJson: string[];
  isActive: true;
};

/** Stałe identyfikatory: te same co we wcześniejszych wersjach seeda. */
const SEED_PLAN_IDS = {
  basic: "00000000-0000-4000-8000-a10000000001",
  pro: "00000000-0000-4000-8000-a10000000002",
} as const;

export const SEED_PLANS: readonly SeedPlan[] = (["basic", "pro"] as const).map((slug) => ({
  id: SEED_PLAN_IDS[slug],
  name: PLANS[slug].name,
  slug: PLANS[slug].slug,
  priceMonthly: PLANS[slug].priceMonthly.toFixed(2),
  featuresJson: [...PLAN_FEATURES[slug]],
  isActive: true,
}));

/** Jedno polecenie dla obu planów; konflikt po `slug` = pominięcie wiersza. */
export function seedPlansQuery(db: Pick<PostgresJsDatabase, "insert">) {
  return db
    .insert(subscriptionPlans)
    .values(SEED_PLANS.map((p) => ({ ...p, featuresJson: [...p.featuresJson] })))
    .onConflictDoNothing({ target: subscriptionPlans.slug });
}

export async function seedPlans(db: Pick<PostgresJsDatabase, "insert">): Promise<void> {
  await seedPlansQuery(db);
}
