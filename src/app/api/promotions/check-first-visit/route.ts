import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { promotions, appointments, clients, services } from "@/lib/schema";
import { eq, and, sql } from "drizzle-orm";

import { logger } from "@/lib/logger";
/**
 * GET /api/promotions/check-first-visit
 * Check if a client qualifies for a first-visit discount at a salon.
 *
 * A client is considered a "first visit" if they have zero completed or scheduled
 * appointments at the salon (by email lookup in the clients table, or by bookedByUserId).
 *
 * Query params:
 *   salonId - ID of the salon
 *   email - Email of the logged-in client
 *   serviceId - (optional) Service being booked, to calculate discount amount
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const salonId = searchParams.get("salonId");
    const email = searchParams.get("email");
    const serviceId = searchParams.get("serviceId");

    if (!salonId || !email) {
      return NextResponse.json({
        success: true,
        data: { eligible: false, reason: "Missing required parameters (salonId, email)" },
      });
    }

    const now = new Date();

    // Find active first_visit promotions for this salon
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

    // Filter by date range
    const validPromotions = activePromotions.filter((promo) => {
      if (promo.startDate && new Date(promo.startDate) > now) return false;
      if (promo.endDate && new Date(promo.endDate) < now) return false;
      return true;
    });

    if (validPromotions.length === 0) {
      return NextResponse.json({
        success: true,
        data: { eligible: false, reason: "No active first visit promotions" },
      });
    }

    // Check if the client has any previous appointments at this salon
    // First, find client records by email in this salon
    const clientRecords = await db
      .select({ id: clients.id })
      .from(clients)
      .where(
        and(
          eq(clients.salonId, salonId),
          eq(clients.email, email)
        )
      );

    let totalAppointments = 0;

    if (clientRecords.length > 0) {
      // Count non-cancelled appointments for any of these client records
      const clientIds = clientRecords.map((c) => c.id);

      for (const cId of clientIds) {
        const countResult = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(appointments)
          .where(
            and(
              eq(appointments.salonId, salonId),
              eq(appointments.clientId, cId),
              sql`${appointments.status} != 'cancelled'`
            )
          );
        totalAppointments += countResult[0]?.count || 0;
      }
    }

    // Also check by bookedByUserId if email matches a user account
    // This catches appointments booked via the client portal without a client record
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

    // If client already has appointments, they're not a first-time visitor
    if (totalAppointments > 0) {
      return NextResponse.json({
        success: true,
        data: {
          eligible: false,
          appointmentCount: totalAppointments,
          reason: "Klient ma juz wizyty w tym salonie",
        },
      });
    }

    // Client qualifies! Use the best (highest discount) promotion
    const bestPromo = validPromotions.reduce((best, current) => {
      return parseFloat(current.value) > parseFloat(best.value) ? current : best;
    });

    const discountPercent = parseFloat(bestPromo.value);

    // If serviceId provided, calculate the discount amount
    let originalPrice = 0;
    let discountAmount = 0;
    let finalPrice = 0;

    if (serviceId) {
      const [service] = await db
        .select()
        .from(services)
        .where(eq(services.id, serviceId))
        .limit(1);

      if (service) {
        originalPrice = parseFloat(service.basePrice);
        discountAmount = Math.round(originalPrice * discountPercent) / 100;
        finalPrice = originalPrice - discountAmount;
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        eligible: true,
        promotionId: bestPromo.id,
        promotionName: bestPromo.name,
        discountPercent,
        originalPrice: originalPrice || undefined,
        discountAmount: discountAmount ? Math.round(discountAmount * 100) / 100 : undefined,
        finalPrice: finalPrice ? Math.round(finalPrice * 100) / 100 : undefined,
        reason: `Znizka ${discountPercent}% na pierwsza wizyte!`,
      },
    });
  } catch (error) {
    logger.error("[Promotions First Visit Check] Error", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to check first visit promotion" },
      { status: 500 }
    );
  }
}
