import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { salons, services, employees, reviews } from "@/lib/schema";
import { eq, and, avg } from "drizzle-orm";

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
        services: salonServices,
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
