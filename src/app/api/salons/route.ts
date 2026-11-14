import { NextResponse } from "next/server";
import { eq, and, isNotNull, ne, inArray, count, avg } from "drizzle-orm";
import { validateBody, createSalonSchema } from "@/lib/api-validation";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";
// ADR-001: operacje na korzeniu najemcy (salons) — GET to publiczny katalog (bez
// sesji salonu), POST tworzy salon zanim istnieje salonId — poza modelem forSalon,
// świadomie surowe db.
// eslint-disable-next-line no-restricted-imports
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { apiRateLimit, getClientIp } from "@/lib/rate-limit";
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

// POST /api/salons - Create a new salon
export async function POST(request: Request) {
  try {
    const ip = getClientIp(request);
    const rateLimitResult = apiRateLimit.check(ip);
    if (!rateLimitResult.success) {
      return NextResponse.json(
        { success: false, error: "Zbyt wiele żądań. Spróbuj ponownie później." },
        { status: 429, headers: { "Retry-After": String(Math.ceil(rateLimitResult.reset / 1000)) } }
      );
    }

    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

    const body = await request.json();

    // Server-side validation with Zod schema
    const validationError = validateBody(createSalonSchema, body);
    if (validationError) {
      return NextResponse.json(validationError, { status: 400 });
    }

    // Właściciel wyłącznie z sesji — `ownerId` z body jest ignorowany (inaczej
    // salon na cudze konto albo bez właściciela).
    const { name, phone, email, address, industryType } = body;
    const ownerId = authResult.user.id;

    // Jedno konto = jeden salon: salon-context i get-user-salon rozwiązują
    // salon po ownerId z limit(1) bez ORDER BY — drugi salon robi kontekst
    // właściciela niedeterministycznym.
    const [existing] = await db
      .select({ id: salons.id })
      .from(salons)
      .where(eq(salons.ownerId, ownerId))
      .limit(1);
    if (existing) {
      return NextResponse.json(
        { success: false, error: "To konto ma już salon" },
        { status: 409 }
      );
    }

    const [newSalon] = await db
      .insert(salons)
      .values({
        name,
        phone: phone || null,
        email: email || null,
        address: address || null,
        industryType: industryType || null,
        ownerId,
      })
      .returning();

    logger.info(`[Salons API] INSERT successful, created salon with id: ${newSalon?.id}`);

    return NextResponse.json({
      success: true,
      data: newSalon,
    }, { status: 201 });
  } catch (error) {
    logger.error("[Salons API] Database error", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to create salon" },
      { status: 500 }
    );
  }
}

// DELETE /api/salons — świadomie brak (P0, Ryan): trasa bez wołającego w UI
// kasowała dowolny salon po id dla każdego zalogowanego konta, a 26 FK do
// salons.id ma ON DELETE CASCADE (klienci, wizyty, subskrypcje). Usunięcie
// salonu wymaga osobnego przepływu (potwierdzenie, Stripe, RODO, audyt) —
// do tego czasu Next.js odpowiada 405.
