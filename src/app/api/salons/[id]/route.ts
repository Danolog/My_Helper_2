import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { salons, services, employees, reviews, serviceCategories, serviceVariants, employeeServices, galleryPhotos } from "@/lib/schema";
import { eq, and, avg, asc, inArray, count, sql } from "drizzle-orm";

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

    // Get employee IDs for enrichment
    const employeeIds = salonEmployees.map((e) => e.id);

    // Get specialties (services assigned to each employee)
    let employeeServiceMap: Record<string, string[]> = {};
    if (employeeIds.length > 0) {
      const empServices = await db
        .select({
          employeeId: employeeServices.employeeId,
          serviceName: services.name,
        })
        .from(employeeServices)
        .innerJoin(services, eq(employeeServices.serviceId, services.id))
        .where(inArray(employeeServices.employeeId, employeeIds));

      for (const es of empServices) {
        if (!employeeServiceMap[es.employeeId]) {
          employeeServiceMap[es.employeeId] = [];
        }
        employeeServiceMap[es.employeeId]!.push(es.serviceName);
      }
    }

    // Get individual employee ratings
    let employeeRatingMap: Record<string, { avgRating: number; reviewCount: number }> = {};
    if (employeeIds.length > 0) {
      const empRatings = await db
        .select({
          employeeId: reviews.employeeId,
          avgRating: avg(reviews.rating),
          reviewCount: count(reviews.id),
        })
        .from(reviews)
        .where(
          and(
            inArray(reviews.employeeId, employeeIds),
            eq(reviews.status, "approved")
          )
        )
        .groupBy(reviews.employeeId);

      for (const er of empRatings) {
        if (er.employeeId) {
          employeeRatingMap[er.employeeId] = {
            avgRating: er.avgRating ? parseFloat(String(er.avgRating)) : 0,
            reviewCount: Number(er.reviewCount),
          };
        }
      }
    }

    // Get gallery photo counts per employee
    let employeeGalleryCountMap: Record<string, number> = {};
    if (employeeIds.length > 0) {
      const galleryCounts = await db
        .select({
          employeeId: galleryPhotos.employeeId,
          photoCount: count(galleryPhotos.id),
        })
        .from(galleryPhotos)
        .where(
          and(
            eq(galleryPhotos.salonId, id),
            sql`${galleryPhotos.employeeId} IS NOT NULL`,
            inArray(galleryPhotos.employeeId, employeeIds)
          )
        )
        .groupBy(galleryPhotos.employeeId);

      for (const gc of galleryCounts) {
        if (gc.employeeId) {
          employeeGalleryCountMap[gc.employeeId] = Number(gc.photoCount);
        }
      }
    }

    // Enrich employees with specialties, ratings, gallery counts
    const enrichedEmployees = salonEmployees.map((emp) => ({
      id: emp.id,
      firstName: emp.firstName,
      lastName: emp.lastName,
      role: emp.role,
      photoUrl: emp.photoUrl,
      color: emp.color,
      specialties: employeeServiceMap[emp.id] || [],
      averageRating: employeeRatingMap[emp.id]?.avgRating || null,
      reviewCount: employeeRatingMap[emp.id]?.reviewCount || 0,
      galleryCount: employeeGalleryCountMap[emp.id] || 0,
    }));

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
        employees: enrichedEmployees,
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
