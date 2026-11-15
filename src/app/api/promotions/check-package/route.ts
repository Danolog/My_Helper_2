import { NextResponse } from "next/server";
import { eq, and, inArray } from "drizzle-orm";
// ADR-001: ścieżka publiczna (bez sesji salonu) — świadomie surowe db
// eslint-disable-next-line no-restricted-imports
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { promotions, services } from "@/lib/schema";
import { frozenModuleResponse } from "@/lib/server/frozen-guard";

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

    if (!salonId) {
      return NextResponse.json({
        success: true,
        data: [],
      });
    }

    const now = new Date();

    // Find active package promotions for this salon
    const activePackages = await db
      .select()
      .from(promotions)
      .where(
        and(
          eq(promotions.salonId, salonId),
          eq(promotions.type, "package"),
          eq(promotions.isActive, true)
        )
      );

    // Filter by date range and enrich with service details
    const packagesWithDetails = [];

    for (const promo of activePackages) {
      // Check date range
      if (promo.startDate && new Date(promo.startDate) > now) continue;
      if (promo.endDate && new Date(promo.endDate) < now) continue;

      const conditions = (promo.conditionsJson as Record<string, unknown>) || {};
      const packageServiceIds = (conditions.packageServiceIds as string[]) || [];

      if (packageServiceIds.length < 2) continue;

      // Fetch service details
      const packageServices = await db
        .select()
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

      packagesWithDetails.push({
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

    return NextResponse.json({
      success: true,
      data: packagesWithDetails,
    });
  } catch (error) {
    logger.error("[Package Check API] Error", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to check packages" },
      { status: 500 }
    );
  }
}
