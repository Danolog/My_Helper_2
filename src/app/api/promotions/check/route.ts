import { NextResponse } from "next/server";
import { eq, and, not, sql } from "drizzle-orm";
import { isValidUuid } from "@/lib/api-validation";
import { logger } from "@/lib/logger";
import { toErrorIdentity } from "@/lib/safe-error";
import { promotions, appointments, services } from "@/lib/schema";
import { frozenModuleResponse } from "@/lib/server/frozen-guard";
// Publiczna trasa bez sesji: wszystkie odczyty w jednej transakcji
// forSalon(salonId z zapytania). Kontekst RLS ustawia wołający, więc RLS nie
// ogranicza, który salon da się odczytać — zawęża tylko wiersze do salonu
// z zapytania. Zakres trzymają jawne listy kolumn i jawne eq(salonId).
import { forSalon } from "@/lib/server/repository";

// GET /api/promotions/check - Check if a client qualifies for any buy2get1 promotion
// Query params: salonId, clientId, serviceId
export async function GET(request: Request) {
  // Druga linia obrony zamrożenia (pierwsza: src/proxy.ts).
  const frozen = frozenModuleResponse("complexPromotions");
  if (frozen) return frozen;

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

    // Format sprawdzany PRZED forSalon: polityka RLS rzutuje kontekst na
    // ::uuid, a kolumny id są typu uuid — zły format dałby 500 z bazy.
    // Odpowiedź w kształcie kontraktu trasy (jak przy brakujących parametrach).
    if (!isValidUuid(salonId) || !isValidUuid(clientId) || !isValidUuid(serviceId)) {
      return NextResponse.json({
        success: true,
        data: { eligible: false, reason: "Invalid parameters" },
      });
    }

    const now = new Date();

    const data = await forSalon(salonId).raw(async (tx) => {
      // Find active buy2get1 promotions for this salon
      const activePromotions = await tx
        .select({
          id: promotions.id,
          name: promotions.name,
          value: promotions.value,
          startDate: promotions.startDate,
          endDate: promotions.endDate,
          conditionsJson: promotions.conditionsJson,
        })
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
        return { eligible: false, reason: "No applicable buy2get1 promotions" };
      }

      // Count completed or scheduled appointments for this client + service combo
      const completedAppointments = await tx
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
        return {
          eligible: false,
          appointmentCount,
          remainingForPromo: remaining,
          reason: `Potrzeba jeszcze ${remaining} wizyt(y) do promocji 2+1`,
          promotionName: applicablePromotions[0]?.name,
        };
      }

      // Client qualifies!
      const bestPromo = applicablePromotions[0]!;
      const discountPercent = parseFloat(bestPromo.value);

      // Get service price for discount calculation
      const [service] = await tx
        .select({ basePrice: services.basePrice })
        .from(services)
        // Zwiazanie z salonem z requestu — usluga innego salonu nie wejdzie do wyliczenia promocji.
        .where(and(eq(services.id, serviceId), eq(services.salonId, salonId)))
        .limit(1);

      const servicePrice = service ? parseFloat(service.basePrice) : 0;
      const discountAmount = (servicePrice * discountPercent) / 100;
      const finalPrice = servicePrice - discountAmount;

      return {
        eligible: true,
        appointmentCount,
        promotionId: bestPromo.id,
        promotionName: bestPromo.name,
        discountPercent,
        originalPrice: servicePrice,
        discountAmount: Math.round(discountAmount * 100) / 100,
        finalPrice: Math.round(finalPrice * 100) / 100,
        reason: `Promocja 2+1: ${discountPercent}% znizki na 3. wizyte!`,
      };
    });

    return NextResponse.json({ success: true, data });
  } catch (error) {
    // Sama tożsamość błędu: treść błędu bazy niesie parametry zapytania (id klienta).
    logger.error("[Promotions Check API] Error", { ...toErrorIdentity(error) });
    return NextResponse.json(
      { success: false, error: "Failed to check promotions" },
      { status: 500 }
    );
  }
}
