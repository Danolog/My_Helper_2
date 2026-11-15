// Rabat z kodu promocyjnego liczony po stronie serwera.
//
// Kwoty rabatu nigdy nie bierzemy z zadania klienta: zapisany discountAmount
// obniza punkty lojalnosciowe przy zakonczeniu wizyty i statystyki przychodu.
// Logika odpowiada temu, co panel pokazuje klientowi przed rezerwacja
// (src/app/dashboard/booking/_hooks/use-service-booking.ts):
// - "percentage" i typy inne niz "fixed": value traktowane jako procent ceny,
// - "fixed": kwota stala,
// - wynik zawsze w przedziale [0, cena uslugi], zaokraglony do groszy.
// - promocja typu zamrozonego (FROZEN_PROMOTION_TYPES, src/lib/features.ts)
//   nie daje rabatu: kod z nia powiazany jest odrzucany ("type_frozen").

import { isPromotionTypeFrozen } from "@/lib/features";

export interface PromoDiscountPromotion {
  type: string;
  value: string | number;
  isActive: boolean;
  startDate: Date | string | null;
  endDate: Date | string | null;
  conditionsJson: unknown;
}

export type PromotionRejection =
  | "type_frozen"
  | "inactive"
  | "not_started"
  | "ended"
  | "service_not_applicable";

/** Sprawdza, czy promocje mozna zastosowac teraz do danej uslugi. */
export function checkPromotionApplicable(
  promotion: PromoDiscountPromotion,
  serviceId: string,
  now: Date = new Date()
): PromotionRejection | null {
  if (isPromotionTypeFrozen(promotion.type)) return "type_frozen";
  if (!promotion.isActive) return "inactive";
  if (promotion.startDate && new Date(promotion.startDate) > now) return "not_started";
  if (promotion.endDate && new Date(promotion.endDate) < now) return "ended";

  const conditions = promotion.conditionsJson as { applicableServiceIds?: unknown } | null;
  const applicable = conditions?.applicableServiceIds;
  if (Array.isArray(applicable) && applicable.length > 0 && !applicable.includes(serviceId)) {
    return "service_not_applicable";
  }
  return null;
}

/** Kwota rabatu w PLN (2 miejsca po przecinku), nigdy ujemna ani wieksza niz cena. */
export function computePromoDiscount(
  basePrice: string | number,
  promotion: Pick<PromoDiscountPromotion, "type" | "value">
): number {
  if (isPromotionTypeFrozen(promotion.type)) return 0;

  const price = Number(basePrice);
  const value = Number(promotion.value);
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(value) || value <= 0) {
    return 0;
  }

  const raw = promotion.type === "fixed" ? value : price * (value / 100);
  const capped = Math.min(Math.max(raw, 0), price);
  return Math.round(capped * 100) / 100;
}
