import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { promotions, appointments, services } from "@/lib/schema";
import { eq, and, not, sql } from "drizzle-orm";

import { logger } from "@/lib/logger";
// GET /api/promotions/check - Check if a client qualifies for any buy2get1 promotion
// Query params: salonId, clientId, serviceId
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const salonId = searchParams.get("salonId");
    const clientId = searchParams.get("clientId");
    const serviceId = searchParams.get("serviceId");

    if (!salonId || !clientId || !serviceId) {
      return NextResponse.json({
        success: true,
        data: { eligible: false, reason: "Missing required parameters" },
      });
    }

    const now = new Date();

    // Find active buy2get1 promotions for this salon
    const activePromotions = await db
      .select()
      .from(promotions)
      .where(
        and(
          eq(promotions.salonId, salonId),
          eq(promotions.type, "buy2get1"),
          eq(promotions.isActive, true)
        )
      );

    // Filter by date range and check if service is applicable
    const applicablePromotions = activePromotions.filter((promo) => {
      // Check date range
      if (promo.startDate && new Date(promo.startDate) > now) return false;
      if (promo.endDate && new Date(promo.endDate) < now) return false;

      // Check if service is in the applicable list
      const conditions = (promo.conditionsJson as Record<string, unknown>) || {};
      const applicableServiceIds = (conditions.applicableServiceIds as string[]) || [];

      // If no service restriction, applies to all
      if (applicableServiceIds.length === 0) return true;

      return applicableServiceIds.includes(serviceId);
    });

    if (applicablePromotions.length === 0) {
      return NextResponse.json({
        success: true,
        data: { eligible: false, reason: "No applicable buy2get1 promotions" },
      });
    }

    // Count completed or scheduled appointments for this client + service combo
    const completedAppointments = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(appointments)
      .where(
        and(
          eq(appointments.salonId, salonId),
          eq(appointments.clientId, clientId),
          eq(appointments.serviceId, serviceId),
          not(eq(appointments.status, "cancelled"))
        )
      );

    const appointmentCount = completedAppointments[0]?.count || 0;

    // Check if this is the 3rd appointment (i.e., client already has 2 non-cancelled)
    // The discount applies to every 3rd appointment (3rd, 6th, 9th, etc.)
    const isThirdAppointment = appointmentCount >= 2 && appointmentCount % 3 === 2;

    if (!isThirdAppointment) {
      const remaining = 2 - (appointmentCount % 3);
      return NextResponse.json({
        success: true,
        data: {
          eligible: false,
          appointmentCount,
          remainingForPromo: remaining,
          reason: `Potrzeba jeszcze ${remaining} wizyt(y) do promocji 2+1`,
          promotionName: applicablePromotions[0]?.name,
        },
      });
    }

    // Client qualifies!
    const bestPromo = applicablePromotions[0]!;
    const discountPercent = parseFloat(bestPromo.value);

    // Get service price for discount calculation
    const [service] = await db
      .select()
      .from(services)
      .where(eq(services.id, serviceId))
      .limit(1);

    const servicePrice = service ? parseFloat(service.basePrice) : 0;
    const discountAmount = (servicePrice * discountPercent) / 100;
    const finalPrice = servicePrice - discountAmount;

    return NextResponse.json({
      success: true,
      data: {
        eligible: true,
        appointmentCount,
        promotionId: bestPromo.id,
        promotionName: bestPromo.name,
        discountPercent,
        originalPrice: servicePrice,
        discountAmount: Math.round(discountAmount * 100) / 100,
        finalPrice: Math.round(finalPrice * 100) / 100,
        reason: `Promocja 2+1: ${discountPercent}% znizki na 3. wizyte!`,
      },
    });
  } catch (error) {
    logger.error("[Promotions Check API] Error", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to check promotions" },
      { status: 500 }
    );
  }
}
