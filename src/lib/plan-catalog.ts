/**
 * Katalog planów: trzy stałe i trzy czyste funkcje. PLANS_ON_SALE to lista
 * slugów, dla których isPlanOnSale zwraca true, SOLD_PLAN_SLUG to jej
 * pierwszy element, AI_PLAN_SLUGS to lista slugów, dla których
 * planIncludesAI przy mode "full" zwraca true. Moduł nie ma importów.
 * Przynależność do listy to dokładne porównanie napisu (bez przycinania
 * i bez zmiany wielkości liter). Moduł odpowiada tylko na pytanie dla
 * podanych danych i niczego sam nie wymusza.
 */

/** Slugi, dla których isPlanOnSale zwraca true. */
export const PLANS_ON_SALE = ["basic"] as const;

type PlanOnSale = (typeof PLANS_ON_SALE)[number];

/** Pierwszy element PLANS_ON_SALE. */
export const SOLD_PLAN_SLUG: PlanOnSale = PLANS_ON_SALE[0];

/** Slugi planów, dla których planIncludesAI przy mode "full" zwraca true. */
export const AI_PLAN_SLUGS = ["basic", "pro"] as const;

function isListed(list: readonly string[], value: unknown): boolean {
  return typeof value === "string" && list.includes(value);
}

/** true tylko dla napisu będącego elementem PLANS_ON_SALE, np. "basic" → true, "Basic" → false. */
export function isPlanOnSale(slug: unknown): boolean {
  return isListed(PLANS_ON_SALE, slug);
}

/** Slug, jeśli jest elementem PLANS_ON_SALE, w przeciwnym razie SOLD_PLAN_SLUG, np. "pro" → "basic". */
export function planOnSaleOr(slug: unknown): PlanOnSale {
  return isPlanOnSale(slug) ? (slug as PlanOnSale) : SOLD_PLAN_SLUG;
}

/**
 * true wtedy i tylko wtedy, gdy mode === "full" i planSlug jest elementem
 * AI_PLAN_SLUGS; brak danych → false.
 */
export function planIncludesAI(
  access?: { mode: string; planSlug: string | null } | null
): boolean {
  if (!access) {
    return false;
  }
  return access.mode === "full" && isListed(AI_PLAN_SLUGS, access.planSlug);
}
