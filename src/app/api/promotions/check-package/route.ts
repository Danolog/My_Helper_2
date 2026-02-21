import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { promotions, services } from "@/lib/schema";
import { eq, and, inArray } from "drizzle-orm";

/**
 * GET /api/promotions/check-package
 * Get active package promotions for a salon with service details
 *
 * Query params:
 *   salonId - ID of the salon
 */
export async function GET(request: Request) {
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
        .where(inArray(services.id, packageServiceIds));

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
    console.error("[Package Check API] Error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to check packages" },
      { status: 500 }
    );
  }
}
