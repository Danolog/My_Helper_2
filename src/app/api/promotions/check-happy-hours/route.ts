import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { promotions } from "@/lib/schema";
import { eq, and } from "drizzle-orm";

import { logger } from "@/lib/logger";
/**
 * GET /api/promotions/check-happy-hours
 * Check if a booking time slot qualifies for a happy hours promotion
 *
 * Query params:
 *   salonId - ID of the salon
 *   date - Booking date (YYYY-MM-DD)
 *   time - Booking start time (HH:MM)
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const salonId = searchParams.get("salonId");
    const date = searchParams.get("date");
    const time = searchParams.get("time");

    if (!salonId || !date || !time) {
      return NextResponse.json({
        success: true,
        data: { eligible: false, reason: "Missing required parameters (salonId, date, time)" },
      });
    }

    const now = new Date();

    // Get the day of week for the booking date (0=Sunday, 1=Monday, ..., 6=Saturday)
    const bookingDate = new Date(date + "T12:00:00");
    const dayOfWeek = bookingDate.getDay();

    // Parse the booking time as minutes from midnight for comparison
    const [bookingHour, bookingMinute] = time.split(":").map(Number);
    const bookingTimeMinutes = (bookingHour ?? 0) * 60 + (bookingMinute ?? 0);

    // Find active happy_hours promotions for this salon
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

    // Filter by date range and check if time/day matches
    const applicablePromotions = activePromotions.filter((promo) => {
      // Check date range (promotion validity period)
      if (promo.startDate && new Date(promo.startDate) > now) return false;
      if (promo.endDate && new Date(promo.endDate) < now) return false;

      const conditions = (promo.conditionsJson as Record<string, unknown>) || {};

      // Check day of week
      const daysOfWeek = (conditions.daysOfWeek as number[]) || [];
      if (daysOfWeek.length > 0 && !daysOfWeek.includes(dayOfWeek)) {
        return false;
      }

      // Check time range
      const startTime = conditions.startTime as string;
      const endTime = conditions.endTime as string;
      if (!startTime || !endTime) return false;

      const [startHour, startMinute] = startTime.split(":").map(Number);
      const [endHour, endMinute] = endTime.split(":").map(Number);
      const startMinutes = (startHour ?? 0) * 60 + (startMinute ?? 0);
      const endMinutes = (endHour ?? 0) * 60 + (endMinute ?? 0);

      // Booking time must fall within the happy hours window
      return bookingTimeMinutes >= startMinutes && bookingTimeMinutes < endMinutes;
    });

    if (applicablePromotions.length === 0) {
      return NextResponse.json({
        success: true,
        data: { eligible: false, reason: "No applicable happy hours promotions for this time slot" },
      });
    }

    // Use the best (highest discount) promotion
    const bestPromo = applicablePromotions.reduce((best, current) => {
      return parseFloat(current.value) > parseFloat(best.value) ? current : best;
    });

    const discountPercent = parseFloat(bestPromo.value);
    const conditions = (bestPromo.conditionsJson as Record<string, unknown>) || {};

    return NextResponse.json({
      success: true,
      data: {
        eligible: true,
        promotionId: bestPromo.id,
        promotionName: bestPromo.name,
        discountPercent,
        startTime: conditions.startTime,
        endTime: conditions.endTime,
        daysOfWeek: conditions.daysOfWeek,
        reason: `Happy Hours: -${discountPercent}% (${conditions.startTime}-${conditions.endTime})`,
      },
    });
  } catch (error) {
    logger.error("[Promotions Happy Hours Check] Error", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to check happy hours promotions" },
      { status: 500 }
    );
  }
}
