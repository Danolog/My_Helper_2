import { NextResponse } from "next/server";
import { eq, and, isNotNull, ne, inArray, count, avg } from "drizzle-orm";
// ADR-001: korzeń najemcy (salons) — GET to publiczny katalog (bez sesji
// salonu), poza modelem forSalon, świadomie surowe db.
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { salons, services, reviews } from "@/lib/schema";

// Revalidate salon list every 60 seconds (ISR)
export const revalidate = 60;

// GET /api/salons - List all salons (filtered to exclude test/incomplete salons)
export async function GET() {
  try {
    // Only return salons that have both address and phone set (filters out test salons)
    const allSalons = await db
      .select()
      .from(salons)
      .where(
        and(
          isNotNull(salons.address),
          ne(salons.address, ""),
          isNotNull(salons.phone),
          ne(salons.phone, ""),
          isNotNull(salons.industryType),
          ne(salons.industryType, "")
        )
      );

    if (allSalons.length === 0) {
      return NextResponse.json({
        success: true,
        data: [],
        count: 0,
      });
    }

    const salonIds = allSalons.map((s) => s.id);

    // Count active services per salon
    const serviceCounts = await db
      .select({
        salonId: services.salonId,
        serviceCount: count(services.id),
      })
      .from(services)
      .where(
        and(
          inArray(services.salonId, salonIds),
          eq(services.isActive, true)
        )
      )
      .groupBy(services.salonId);

    // Get average rating and review count per salon (only approved reviews)
    const reviewStats = await db
      .select({
        salonId: reviews.salonId,
        averageRating: avg(reviews.rating),
        reviewCount: count(reviews.id),
      })
      .from(reviews)
      .where(
        and(
          inArray(reviews.salonId, salonIds),
          eq(reviews.status, "approved")
        )
      )
      .groupBy(reviews.salonId);

    // Build lookup maps for efficient merging
    const serviceCountMap = new Map(
      serviceCounts.map((sc) => [sc.salonId, Number(sc.serviceCount)])
    );
    const reviewStatsMap = new Map(
      reviewStats.map((rs) => [
        rs.salonId,
        {
          averageRating: rs.averageRating
            ? Math.round(parseFloat(String(rs.averageRating)) * 10) / 10
            : null,
          reviewCount: Number(rs.reviewCount),
        },
      ])
    );

    // Merge aggregate data - show all salons, sorted with services first
    const enrichedSalons = allSalons
      .map((salon) => ({
        id: salon.id,
        name: salon.name,
        phone: salon.phone,
        email: salon.email,
        address: salon.address,
        industryType: salon.industryType,
        serviceCount: serviceCountMap.get(salon.id) ?? 0,
        averageRating: reviewStatsMap.get(salon.id)?.averageRating ?? null,
        reviewCount: reviewStatsMap.get(salon.id)?.reviewCount ?? 0,
      }))
      .sort((a, b) => (b.serviceCount > 0 ? 1 : 0) - (a.serviceCount > 0 ? 1 : 0));

    return NextResponse.json({
      success: true,
      data: enrichedSalons,
      count: enrichedSalons.length,
    });
  } catch (error) {
    logger.error("[Salons API] Database error", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to fetch salons" },
      { status: 500 }
    );
  }
}

// POST /api/salons — świadomie brak (#86, Leo z recenzji #76): trasa bez
// wołającego w src/ i tests/ tworzyła salon BEZ wiersza subskrypcji, co łamie
// niezmiennik „każdy salon ma subskrypcję” (Ethan §3). Salon powstaje wyłącznie
// przez POST /api/register-subscription (salon + subskrypcja razem); tutaj
// Next.js odpowiada 405.

// DELETE /api/salons — świadomie brak (P0, Ryan): trasa bez wołającego w UI
// kasowała dowolny salon po id dla każdego zalogowanego konta, a 26 FK do
// salons.id ma ON DELETE CASCADE (klienci, wizyty, subskrypcje). Usunięcie
// salonu wymaga osobnego przepływu (potwierdzenie, Stripe, RODO, audyt) —
// do tego czasu Next.js odpowiada 405.
