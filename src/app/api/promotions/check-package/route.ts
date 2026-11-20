import { NextResponse } from "next/server";
import { eq, and, inArray } from "drizzle-orm";
import { isValidUuid } from "@/lib/api-validation";
import { logger } from "@/lib/logger";
import { toErrorIdentity } from "@/lib/safe-error";
import { promotions, services } from "@/lib/schema";
import { frozenModuleResponse } from "@/lib/server/frozen-guard";
// Publiczna trasa bez sesji: wszystkie odczyty w jednej transakcji
// forSalon(salonId z zapytania). Kontekst RLS ustawia wołający, więc RLS nie
// ogranicza, który salon da się odczytać — zawęża tylko wiersze do salonu
// z zapytania. Zakres trzymają jawne listy kolumn i jawne eq(salonId).
import { forSalon } from "@/lib/server/repository";

/**
 * GET /api/promotions/check-package
 * Get active package promotions for a salon with service details
 *
 * Query params:
 *   salonId - ID of the salon
 */
export async function GET(request: Request) {
  // Druga linia obrony zamrożenia (pierwsza: src/proxy.ts).
  const frozen = frozenModuleResponse("complexPromotions");
  if (frozen) return frozen;

  try {
    const { searchParams } = new URL(request.url);
    const salonId = searchParams.get("salonId");

    // Format sprawdzany PRZED forSalon: polityka RLS rzutuje kontekst na
    // ::uuid — zły format dałby 500 z bazy. Odpowiedź w kształcie kontraktu
    // trasy (jak przy brakującym salonId): pusta lista pakietów.
    if (!salonId || !isValidUuid(salonId)) {
      return NextResponse.json({
        success: true,
        data: [],
      });
    }

    const now = new Date();

    const packagesWithDetails = await forSalon(salonId).raw(async (tx) => {
      // Find active package promotions for this salon
      const activePackages = await tx
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
            eq(promotions.type, "package"),
            eq(promotions.isActive, true)
          )
        );

      // Filter by date range and enrich with service details
      const result = [];

      for (const promo of activePackages) {
        // Check date range
        if (promo.startDate && new Date(promo.startDate) > now) continue;
        if (promo.endDate && new Date(promo.endDate) < now) continue;

        const conditions = (promo.conditionsJson as Record<string, unknown>) || {};
        const packageServiceIds = (conditions.packageServiceIds as string[]) || [];

        if (packageServiceIds.length < 2) continue;

        // Fetch service details
        const packageServices = await tx
          .select({
            id: services.id,
            name: services.name,
            basePrice: services.basePrice,
            baseDuration: services.baseDuration,
          })
          .from(services)
          // Zwiazanie z salonem z requestu — usluga innego salonu nie wejdzie do wyliczenia promocji.
          .where(and(inArray(services.id, packageServiceIds), eq(services.salonId, salonId)));

        // Keep the original order
        const orderedServices = packageServiceIds
          .map((id) => packageServices.find((s) => s.id === id))
          .filter((s): s is typeof packageServices[0] => s !== undefined);

        const totalIndividualPrice = orderedServices.reduce(
          (sum, svc) => sum + parseFloat(svc.basePrice),
          0
        );
        const totalDuration = orderedServices.reduce(
          (sum, svc) => sum + svc.baseDuration,
          0
        );
        const packagePrice = parseFloat(promo.value);

        result.push({
          id: promo.id,
          name: promo.name,
          packagePrice,
          totalIndividualPrice: Math.round(totalIndividualPrice * 100) / 100,
          savings: Math.round((totalIndividualPrice - packagePrice) * 100) / 100,
          totalDuration,
          services: orderedServices.map((s) => ({
            id: s.id,
            name: s.name,
            basePrice: s.basePrice,
            baseDuration: s.baseDuration,
          })),
        });
      }

      return result;
    });

    return NextResponse.json({
      success: true,
      data: packagesWithDetails,
    });
  } catch (error) {
    // Sama tożsamość błędu: treść błędu bazy niesie parametry zapytania.
    logger.error("[Package Check API] Error", { ...toErrorIdentity(error) });
    return NextResponse.json(
      { success: false, error: "Failed to check packages" },
      { status: 500 }
    );
  }
}
