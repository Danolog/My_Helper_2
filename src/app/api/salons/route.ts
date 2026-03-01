import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { salons, services, reviews } from "@/lib/schema";
import { eq, and, isNotNull, ne, inArray, count, avg } from "drizzle-orm";

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
    console.error("[Salons API] Database error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch salons" },
      { status: 500 }
    );
  }
}

// POST /api/salons - Create a new salon
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, phone, email, address, industryType, ownerId } = body;

    if (!name) {
      return NextResponse.json(
        { success: false, error: "Salon name is required" },
        { status: 400 }
      );
    }

    console.log(`[Salons API] Executing: INSERT INTO salons (name, phone, email, address, industry_type, owner_id)`);
    const [newSalon] = await db
      .insert(salons)
      .values({
        name,
        phone: phone || null,
        email: email || null,
        address: address || null,
        industryType: industryType || null,
        ownerId: ownerId || null,
      })
      .returning();

    console.log(`[Salons API] INSERT successful, created salon with id: ${newSalon?.id}`);

    return NextResponse.json({
      success: true,
      data: newSalon,
    }, { status: 201 });
  } catch (error) {
    console.error("[Salons API] Database error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to create salon" },
      { status: 500 }
    );
  }
}

// DELETE /api/salons?id=<uuid> - Delete a salon by ID
export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json(
        { success: false, error: "Salon ID is required" },
        { status: 400 }
      );
    }

    console.log(`[Salons API] Executing: DELETE FROM salons WHERE id = '${id}'`);
    const [deleted] = await db
      .delete(salons)
      .where(eq(salons.id, id))
      .returning();

    if (!deleted) {
      return NextResponse.json(
        { success: false, error: "Salon not found" },
        { status: 404 }
      );
    }

    console.log(`[Salons API] DELETE successful, removed salon: ${deleted.name}`);

    return NextResponse.json({
      success: true,
      data: deleted,
    });
  } catch (error) {
    console.error("[Salons API] Database error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to delete salon" },
      { status: 500 }
    );
  }
}
