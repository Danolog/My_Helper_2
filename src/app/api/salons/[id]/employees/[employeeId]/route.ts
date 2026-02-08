import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  employees,
  services,
  employeeServices,
  reviews,
  galleryPhotos,
  salons,
} from "@/lib/schema";
import { eq, and, avg, count } from "drizzle-orm";

// GET /api/salons/[id]/employees/[employeeId] - Get employee profile details
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; employeeId: string }> }
) {
  try {
    const { id: salonId, employeeId } = await params;

    // Verify salon exists
    const [salon] = await db
      .select({ id: salons.id, name: salons.name })
      .from(salons)
      .where(eq(salons.id, salonId));

    if (!salon) {
      return NextResponse.json(
        { success: false, error: "Salon not found" },
        { status: 404 }
      );
    }

    // Get employee
    const [employee] = await db
      .select()
      .from(employees)
      .where(
        and(eq(employees.id, employeeId), eq(employees.salonId, salonId))
      );

    if (!employee) {
      return NextResponse.json(
        { success: false, error: "Employee not found" },
        { status: 404 }
      );
    }

    // Get specialties (services assigned to this employee)
    const empServices = await db
      .select({
        serviceId: employeeServices.serviceId,
        serviceName: services.name,
        basePrice: services.basePrice,
        baseDuration: services.baseDuration,
      })
      .from(employeeServices)
      .innerJoin(services, eq(employeeServices.serviceId, services.id))
      .where(eq(employeeServices.employeeId, employeeId));

    // Get rating stats
    const [ratingStats] = await db
      .select({
        avgRating: avg(reviews.rating),
        reviewCount: count(reviews.id),
      })
      .from(reviews)
      .where(
        and(
          eq(reviews.employeeId, employeeId),
          eq(reviews.status, "approved")
        )
      );

    // Get recent reviews
    const recentReviews = await db
      .select({
        id: reviews.id,
        rating: reviews.rating,
        comment: reviews.comment,
        createdAt: reviews.createdAt,
      })
      .from(reviews)
      .where(
        and(
          eq(reviews.employeeId, employeeId),
          eq(reviews.status, "approved")
        )
      )
      .orderBy(reviews.createdAt)
      .limit(5);

    // Get gallery photos for this employee
    const photos = await db
      .select({
        id: galleryPhotos.id,
        beforePhotoUrl: galleryPhotos.beforePhotoUrl,
        afterPhotoUrl: galleryPhotos.afterPhotoUrl,
        description: galleryPhotos.description,
        createdAt: galleryPhotos.createdAt,
      })
      .from(galleryPhotos)
      .where(
        and(
          eq(galleryPhotos.employeeId, employeeId),
          eq(galleryPhotos.salonId, salonId)
        )
      )
      .orderBy(galleryPhotos.createdAt)
      .limit(10);

    return NextResponse.json({
      success: true,
      data: {
        id: employee.id,
        firstName: employee.firstName,
        lastName: employee.lastName,
        role: employee.role,
        photoUrl: employee.photoUrl,
        color: employee.color,
        phone: employee.phone,
        email: employee.email,
        salon: {
          id: salon.id,
          name: salon.name,
        },
        specialties: empServices.map((s) => ({
          id: s.serviceId,
          name: s.serviceName,
          basePrice: s.basePrice,
          baseDuration: s.baseDuration,
        })),
        averageRating: ratingStats?.avgRating
          ? parseFloat(String(ratingStats.avgRating))
          : null,
        reviewCount: Number(ratingStats?.reviewCount || 0),
        recentReviews: recentReviews.map((r) => ({
          id: r.id,
          rating: r.rating,
          comment: r.comment,
          createdAt: r.createdAt,
        })),
        galleryPhotos: photos,
        galleryCount: photos.length,
      },
    });
  } catch (error) {
    console.error("[Employee Profile API] Error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch employee profile" },
      { status: 500 }
    );
  }
}
