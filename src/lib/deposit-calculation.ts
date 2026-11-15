import { and, eq } from "drizzle-orm";
import { verifiedClientMatchEmail, type SessionUserLike } from "@/lib/client-match";
import { DEFAULT_DEPOSIT_PERCENTAGE } from "@/lib/constants";
import { db } from "@/lib/db";
import { isPromotionTypeFrozen } from "@/lib/features";
import { logger } from "@/lib/logger";
import {
  clients,
  promotions,
  services,
  serviceVariants,
} from "@/lib/schema";

/**
 * Server-side deposit amount calculation.
 *
 * SECURITY: the deposit amount must NEVER be trusted from the request body —
 * otherwise the client could "pay" a 0.01 PLN deposit. This module recomputes
 * the amount on the server, mirroring the frontend derivation in
 * src/app/(client)/salons/[id]/book/_hooks/use-booking-data.ts:
 *
 *   baseEffectivePrice = service.basePrice + variant.priceModifier
 *   discount           = happyHours — Math.round(base*pct)/100
 *                        (0 while happy hours are in FROZEN_PROMOTION_TYPES;
 *                        the first-visit promotion is frozen, never applied)
 *   effectivePrice     = baseEffectivePrice - discount
 *   deposit:
 *     - client settings (requireDeposit) override service settings
 *       - fixed      -> depositValue PLN
 *       - percentage -> Math.ceil(effectivePrice * depositValue / 100)
 *     - else service.depositRequired -> Math.ceil(effectivePrice * pct / 100)
 *
 * Promo eligibility mirrors /api/promotions/check-happy-hours.
 */

export type ExpectedDeposit =
  | {
      ok: true;
      required: boolean;
      /** Expected deposit amount in PLN (2 decimal places). */
      amount: number;
      serviceName: string;
    }
  | { ok: false; error: "service_not_found" | "variant_not_found" };

/**
 * Derive the wall-clock day-of-week and minutes-from-midnight of a Date in
 * the salon's timezone. The product is Poland-only (PLN, SMSAPI), so the
 * salon timezone is fixed to Europe/Warsaw — the booking UI builds slot
 * times from local wall-clock strings, and happy-hours windows are defined
 * in that same local time.
 */
function getWarsawWallClock(date: Date): { dayOfWeek: number; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Warsaw",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const dayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  // Some ICU versions format midnight as "24" with hour12: false
  const hour = parseInt(get("hour"), 10) % 24;
  const minute = parseInt(get("minute"), 10);
  return { dayOfWeek: dayMap[get("weekday")] ?? 0, minutes: hour * 60 + minute };
}

/**
 * Best happy-hours discount percent for a booking start time
 * (0 when no promotion applies). Mirrors /api/promotions/check-happy-hours.
 *
 * Happy hours are frozen (`FROZEN_PROMOTION_TYPES`, src/lib/features.ts): the
 * booking portal no longer asks for the discount, so the deposit must be
 * computed from the full price — no database lookup at all.
 */
async function getHappyHoursDiscountPercent(
  salonId: string,
  startTime: Date
): Promise<number> {
  if (isPromotionTypeFrozen("happy_hours")) return 0;

  const activePromotions = await db
    .select()
    .from(promotions)
    .where(
      and(
        eq(promotions.salonId, salonId),
        eq(promotions.type, "happy_hours"),
        eq(promotions.isActive, true)
      )
    );

  if (activePromotions.length === 0) return 0;

  const now = new Date();
  const { dayOfWeek, minutes: bookingTimeMinutes } = getWarsawWallClock(startTime);

  let best = 0;
  for (const promo of activePromotions) {
    // Promotion validity period
    if (promo.startDate && new Date(promo.startDate) > now) continue;
    if (promo.endDate && new Date(promo.endDate) < now) continue;

    const conditions = (promo.conditionsJson as Record<string, unknown>) || {};

    const daysOfWeek = (conditions.daysOfWeek as number[]) || [];
    if (daysOfWeek.length > 0 && !daysOfWeek.includes(dayOfWeek)) continue;

    const windowStart = conditions.startTime as string;
    const windowEnd = conditions.endTime as string;
    if (!windowStart || !windowEnd) continue;

    const [startHour, startMinute] = windowStart.split(":").map(Number);
    const [endHour, endMinute] = windowEnd.split(":").map(Number);
    const startMinutes = (startHour ?? 0) * 60 + (startMinute ?? 0);
    const endMinutes = (endHour ?? 0) * 60 + (endMinute ?? 0);

    if (bookingTimeMinutes < startMinutes || bookingTimeMinutes >= endMinutes) continue;

    best = Math.max(best, parseFloat(promo.value));
  }
  return best;
}

export async function calculateExpectedDeposit(params: {
  salonId: string;
  serviceId: string;
  variantId?: string | null;
  startTime: Date;
  /**
   * Logged-in user — their client deposit settings apply only when the
   * session email is VERIFIED (src/lib/client-match.ts); otherwise the
   * account is not matched to any client record.
   */
  sessionUser?: SessionUserLike | null;
  /**
   * Guest email. Unused since the first-visit promotion is frozen (it was
   * only needed for that lookup); kept so callers need no change.
   */
  guestEmail?: string | null;
  /**
   * Rekord klienta salonu znany serwerowi (np. wpis listy oczekujących,
   * ustawiony przez salon). Gdy podany, ustawienia zadatku klienta czytamy
   * po id (w obrębie salonu), a nie po e-mailu sesji. Nigdy z body żądania.
   */
  clientId?: string | null;
}): Promise<ExpectedDeposit> {
  const { salonId, serviceId, variantId, startTime, sessionUser, clientId } = params;
  const sessionEmail = verifiedClientMatchEmail(sessionUser);

  // 1. Service (price + deposit settings)
  const [service] = await db
    .select({
      id: services.id,
      name: services.name,
      basePrice: services.basePrice,
      depositRequired: services.depositRequired,
      depositPercentage: services.depositPercentage,
      isActive: services.isActive,
    })
    .from(services)
    .where(and(eq(services.id, serviceId), eq(services.salonId, salonId)));

  // #69: usługa wyłączona (isActive=false) jest dla rezerwacji jak usunięta —
  // portal z nieaktualnej pamięci podręcznej nie zarezerwuje jej ani wariantu.
  if (!service || service.isActive === false) return { ok: false, error: "service_not_found" };

  // 2. Variant price modifier
  let priceModifier = 0;
  if (variantId) {
    const [variant] = await db
      .select({ id: serviceVariants.id, priceModifier: serviceVariants.priceModifier })
      .from(serviceVariants)
      .where(and(eq(serviceVariants.id, variantId), eq(serviceVariants.serviceId, serviceId)));
    if (!variant) return { ok: false, error: "variant_not_found" };
    priceModifier = variant.priceModifier ? parseFloat(variant.priceModifier) : 0;
  }

  const baseEffectivePrice = parseFloat(service.basePrice) + priceModifier;

  // 3. Promotions (best single discount, no stacking — same as frontend)
  const happyHoursPercent = await getHappyHoursDiscountPercent(salonId, startTime);

  // The first-visit promotion is frozen: /api/promotions/check-first-visit
  // answers "not eligible" for everyone, so the booking UI never shows that
  // discount — and the deposit computed here must match the price the client
  // saw. No first-visit lookup (promotions, client records, visit counts).

  // Frontend rounding: Math.round(base * pct) / 100
  const happyHoursDiscount =
    happyHoursPercent > 0 ? Math.round(baseEffectivePrice * happyHoursPercent) / 100 : 0;

  const effectivePrice = baseEffectivePrice - happyHoursDiscount;

  // 4. Client-level deposit settings (only for logged-in users — mirrors the
  // frontend, which fetches /api/clients/deposit-settings by session email)
  let clientRequiresDeposit = false;
  let clientDepositType = "percentage";
  let clientDepositValue = 0;

  if (clientId || sessionEmail) {
    const [clientRecord] = await db
      .select({
        requireDeposit: clients.requireDeposit,
        depositType: clients.depositType,
        depositValue: clients.depositValue,
      })
      .from(clients)
      .where(
        and(
          eq(clients.salonId, salonId),
          clientId ? eq(clients.id, clientId) : eq(clients.email, sessionEmail ?? "")
        )
      )
      .limit(1);

    if (clientRecord) {
      clientRequiresDeposit = clientRecord.requireDeposit ?? false;
      clientDepositType = clientRecord.depositType || "percentage";
      clientDepositValue = clientRecord.depositValue
        ? parseFloat(clientRecord.depositValue)
        : 0;
    }
  }

  // 5. Deposit amount (client settings take priority — same as frontend)
  const serviceDepositRequired = service.depositRequired ?? false;
  const serviceDepositPercentage =
    service.depositPercentage ?? DEFAULT_DEPOSIT_PERCENTAGE;

  const required = serviceDepositRequired || clientRequiresDeposit;

  let amount = 0;
  if (clientRequiresDeposit && clientDepositValue > 0) {
    amount =
      clientDepositType === "fixed"
        ? clientDepositValue
        : Math.ceil(effectivePrice * (clientDepositValue / 100));
  } else if (serviceDepositRequired) {
    amount = Math.ceil(effectivePrice * (serviceDepositPercentage / 100));
  }

  const result = {
    ok: true as const,
    required,
    amount: Math.round(amount * 100) / 100,
    serviceName: service.name,
  };

  logger.debug("Expected deposit calculated", {
    salonId,
    serviceId,
    baseEffectivePrice,
    discount: happyHoursDiscount,
    ...result,
  });

  return result;
}
