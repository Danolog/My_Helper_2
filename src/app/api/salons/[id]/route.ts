import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { salons, services, employees, reviews, serviceCategories, serviceVariants } from "@/lib/schema";
import { eq, and, avg, asc, inArray } from "drizzle-orm";

// GET /api/salons/[id] - Get salon details with services, employees, and rating
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const [salon] = await db.select().from(salons).where(eq(salons.id, id));

    if (!salon) {
      return NextResponse.json(
        { success: false, error: "Salon not found" },
        { status: 404 }
      );
    }

    // Get active services
    const salonServices = await db
      .select()
      .from(services)
      .where(and(eq(services.salonId, id), eq(services.isActive, true)));

    // Get service categories for this salon
    const categories = await db
      .select()
      .from(serviceCategories)
      .where(eq(serviceCategories.salonId, id))
      .orderBy(asc(serviceCategories.sortOrder));

    // Get variants for all active services
    const serviceIds = salonServices.map((s) => s.id);
    let variants: { id: string; serviceId: string; name: string; priceModifier: string | null; durationModifier: number | null }[] = [];
    if (serviceIds.length > 0) {
      variants = await db
        .select()
        .from(serviceVariants)
        .where(inArray(serviceVariants.serviceId, serviceIds));
    }

    // Attach variants to each service
    const servicesWithVariants = salonServices.map((service) => ({
      ...service,
      categoryName: categories.find((c) => c.id === service.categoryId)?.name || null,
      variants: variants.filter((v) => v.serviceId === service.id),
    }));

    // Get active employees
    const salonEmployees = await db
      .select()
      .from(employees)
      .where(and(eq(employees.salonId, id), eq(employees.isActive, true)));

    // Get average rating
    const [ratingResult] = await db
      .select({ avgRating: avg(reviews.rating) })
      .from(reviews)
      .where(and(eq(reviews.salonId, id), eq(reviews.status, "approved")));

    return NextResponse.json({
      success: true,
      data: {
        ...salon,
        services: servicesWithVariants,
        categories,
        employees: salonEmployees,
        averageRating: ratingResult?.avgRating
          ? parseFloat(String(ratingResult.avgRating))
          : null,
      },
    });
  } catch (error) {
    console.error("[Salon Detail API] Error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch salon details" },
      { status: 500 }
    );
  }
}
