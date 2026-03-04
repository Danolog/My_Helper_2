import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
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

// PUT /api/salons/[id] - Update salon basic data
const ALLOWED_INDUSTRY_TYPES = [
  "hair_salon",
  "beauty_salon",
  "nails",
  "barbershop",
  "spa",
  "medical",
];

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      return NextResponse.json(
        { success: false, error: "Wymagane logowanie" },
        { status: 401 }
      );
    }

    const { id } = await params;

    // Verify ownership
    const [salon] = await db
      .select({ id: salons.id, ownerId: salons.ownerId })
      .from(salons)
      .where(eq(salons.id, id));

    if (!salon) {
      return NextResponse.json(
        { success: false, error: "Salon nie znaleziony" },
        { status: 404 }
      );
    }

    if (salon.ownerId !== session.user.id) {
      return NextResponse.json(
        { success: false, error: "Brak uprawnien" },
        { status: 403 }
      );
    }

    const body = await request.json();

    // Validate name (required)
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name || name.length > 100) {
      return NextResponse.json(
        { success: false, error: "Nazwa salonu jest wymagana (maks. 100 znakow)" },
        { status: 400 }
      );
    }

    // Sanitize optional fields
    const phone = typeof body.phone === "string" ? body.phone.trim().slice(0, 20) : null;
    const email = typeof body.email === "string" ? body.email.trim().slice(0, 100) : null;
    const address = typeof body.address === "string" ? body.address.trim().slice(0, 200) : null;
    const industryType =
      typeof body.industryType === "string" && ALLOWED_INDUSTRY_TYPES.includes(body.industryType)
        ? body.industryType
        : null;

    const [updated] = await db
      .update(salons)
      .set({ name, phone, email, address, industryType })
      .where(eq(salons.id, id))
      .returning();

    return NextResponse.json({
      success: true,
      message: "Dane salonu zaktualizowane",
      data: {
        id: updated!.id,
        name: updated!.name,
        phone: updated!.phone,
        email: updated!.email,
        address: updated!.address,
        industryType: updated!.industryType,
      },
    });
  } catch (error) {
    console.error("[Salon Update API] Error:", error);
    return NextResponse.json(
      { success: false, error: "Nie udalo sie zaktualizowac danych salonu" },
      { status: 500 }
    );
  }
}
