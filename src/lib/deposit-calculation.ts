import { and, eq, inArray, sql } from "drizzle-orm";
import { DEFAULT_DEPOSIT_PERCENTAGE } from "@/lib/constants";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  appointments,
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
 *   bestDiscount       = max(happyHours, firstVisit) — Math.round(base*pct)/100
 *   effectivePrice     = baseEffectivePrice - bestDiscount
 *   deposit:
 *     - client settings (requireDeposit) override service settings
 *       - fixed      -> depositValue PLN
 *       - percentage -> Math.ceil(effectivePrice * depositValue / 100)
 *     - else service.depositRequired -> Math.ceil(effectivePrice * pct / 100)
 *
 * Promo eligibility mirrors /api/promotions/check-happy-hours and
 * /api/promotions/check-first-visit.
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
 */
async function getHappyHoursDiscountPercent(
  salonId: string,
  startTime: Date
): Promise<number> {
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

/**
 * Best first-visit discount percent for a client identified by email
 * (0 when not eligible). Mirrors /api/promotions/check-first-visit.
 */
async function getFirstVisitDiscountPercent(
  salonId: string,
  email: string
): Promise<number> {
  const activePromotions = await db
    .select()
    .from(promotions)
    .where(
      and(
        eq(promotions.salonId, salonId),
        eq(promotions.type, "first_visit"),
        eq(promotions.isActive, true)
      )
    );

  const now = new Date();
  const validPromotions = activePromotions.filter((promo) => {
    if (promo.startDate && new Date(promo.startDate) > now) return false;
    if (promo.endDate && new Date(promo.endDate) < now) return false;
    return true;
  });

  if (validPromotions.length === 0) return 0;

  // Existing appointments via client records (by email in this salon)
  const clientRecords = await db
    .select({ id: clients.id })
    .from(clients)
    .where(and(eq(clients.salonId, salonId), eq(clients.email, email)));

  let totalAppointments = 0;
  if (clientRecords.length > 0) {
    const clientIds = clientRecords.map((c) => c.id);
    const countResult = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(appointments)
      .where(
        and(
          eq(appointments.salonId, salonId),
          inArray(appointments.clientId, clientIds),
          sql`${appointments.status} != 'cancelled'`
        )
      );
    totalAppointments += countResult[0]?.count || 0;
  }

  // Also appointments booked via the client portal (bookedByUserId by email)
  const portalCountResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(appointments)
    .where(
      and(
        eq(appointments.salonId, salonId),
        sql`${appointments.bookedByUserId} IN (SELECT id FROM "user" WHERE email = ${email})`,
        sql`${appointments.status} != 'cancelled'`
      )
    );
  totalAppointments += portalCountResult[0]?.count || 0;

  if (totalAppointments > 0) return 0;

  return validPromotions.reduce(
    (best, promo) => Math.max(best, parseFloat(promo.value)),
    0
  );
}

export async function calculateExpectedDeposit(params: {
  salonId: string;
  serviceId: string;
  variantId?: string | null;
  startTime: Date;
  /** Logged-in user's email — used for client deposit settings + first visit. */
  sessionEmail?: string | null;
  /** Guest email — used for the first-visit promo only (mirrors frontend). */
  guestEmail?: string | null;
}): Promise<ExpectedDeposit> {
  const { salonId, serviceId, variantId, startTime, sessionEmail, guestEmail } = params;

  // 1. Service (price + deposit settings)
  const [service] = await db
    .select({
      id: services.id,
      name: services.name,
      basePrice: services.basePrice,
      depositRequired: services.depositRequired,
      depositPercentage: services.depositPercentage,
    })
    .from(services)
    .where(and(eq(services.id, serviceId), eq(services.salonId, salonId)));

  if (!service) return { ok: false, error: "service_not_found" };

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

  const emailForFirstVisit = sessionEmail || guestEmail || null;
  const firstVisitPercent = emailForFirstVisit
    ? await getFirstVisitDiscountPercent(salonId, emailForFirstVisit)
    : 0;

  // Frontend rounding: Math.round(base * pct) / 100
  const happyHoursDiscount =
    happyHoursPercent > 0 ? Math.round(baseEffectivePrice * happyHoursPercent) / 100 : 0;
  const firstVisitDiscount =
    firstVisitPercent > 0 ? Math.round(baseEffectivePrice * firstVisitPercent) / 100 : 0;

  const bestDiscount = Math.max(happyHoursDiscount, firstVisitDiscount);
  const effectivePrice = baseEffectivePrice - bestDiscount;

  // 4. Client-level deposit settings (only for logged-in users — mirrors the
  // frontend, which fetches /api/clients/deposit-settings by session email)
  let clientRequiresDeposit = false;
  let clientDepositType = "percentage";
  let clientDepositValue = 0;

  if (sessionEmail) {
    const [clientRecord] = await db
      .select({
        requireDeposit: clients.requireDeposit,
        depositType: clients.depositType,
        depositValue: clients.depositValue,
      })
      .from(clients)
      .where(and(eq(clients.salonId, salonId), eq(clients.email, sessionEmail)))
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
    bestDiscount,
    ...result,
  });

  return result;
}
