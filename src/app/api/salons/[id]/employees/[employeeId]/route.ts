import { NextResponse } from "next/server";
import { eq, and, avg, count, desc } from "drizzle-orm";
import { isValidUuid } from "@/lib/api-validation";
import { logger } from "@/lib/logger";
import {
  employees,
  services,
  employeeServices,
  reviews,
  galleryPhotos,
  salons,
  clients,
} from "@/lib/schema";
// Publiczny profil pracownika (bez sesji): wszystkie odczyty w jednej
// transakcji forSalon(salonId z URL). RLS przy salonId z URL niczego nie
// chroni (kontekst ustawia wołający) — ochroną są jawne listy kolumn, jawne
// eq(salonId) i wspólna 404 dla pracownika nieistniejącego i obcego.
import { forSalon } from "@/lib/server/repository";

// Ta sama odpowiedź dla pracownika nieistniejącego i pracownika z obcego
// salonu — inaczej trasa byłaby wyrocznią do wyliczania pracowników.
const EMPLOYEE_NOT_FOUND_BODY = { success: false, error: "Employee not found" } as const;

// GET /api/salons/[id]/employees/[employeeId] - Get employee profile details
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; employeeId: string }> }
) {
  try {
    const { id: salonId, employeeId } = await params;

    // Format sprawdzany PRZED forSalon: polityka RLS rzutuje kontekst na
    // ::uuid, a kolumny id są typu uuid — zły format dałby 500 z bazy.
    if (!isValidUuid(salonId)) {
      return NextResponse.json(
        { success: false, error: "Invalid salon id" },
        { status: 400 }
      );
    }
    if (!isValidUuid(employeeId)) {
      return NextResponse.json(
        { success: false, error: "Invalid employee id" },
        { status: 400 }
      );
    }

    const result = await forSalon(salonId).raw(async (tx) => {
      // Verify salon exists
      const [salon] = await tx
        .select({ id: salons.id, name: salons.name })
        .from(salons)
        .where(eq(salons.id, salonId));
      if (!salon) return { kind: "salon-not-found" as const };

      // Tylko pola z odpowiedzi — telefon i e-mail pracownika nie są czytane.
      const [employee] = await tx
        .select({
          id: employees.id,
          firstName: employees.firstName,
          lastName: employees.lastName,
          role: employees.role,
          photoUrl: employees.photoUrl,
          color: employees.color,
        })
        .from(employees)
        .where(
          and(eq(employees.id, employeeId), eq(employees.salonId, salonId))
        );
      if (!employee) return { kind: "employee-not-found" as const };

      // Get specialties (services assigned to this employee)
      const empServices = await tx
        .select({
          serviceId: employeeServices.serviceId,
          serviceName: services.name,
          basePrice: services.basePrice,
          baseDuration: services.baseDuration,
        })
        .from(employeeServices)
        .innerJoin(services, eq(employeeServices.serviceId, services.id))
        .where(
          and(
            eq(employeeServices.employeeId, employeeId),
            eq(services.salonId, salonId)
          )
        );

      // Get rating stats
      const [ratingStats] = await tx
        .select({
          avgRating: avg(reviews.rating),
          reviewCount: count(reviews.id),
        })
        .from(reviews)
        .where(
          and(
            eq(reviews.employeeId, employeeId),
            eq(reviews.salonId, salonId),
            eq(reviews.status, "approved")
          )
        );

      // Get recent reviews with client names
      const recentReviews = await tx
        .select({
          id: reviews.id,
          rating: reviews.rating,
          comment: reviews.comment,
          createdAt: reviews.createdAt,
          clientFirstName: clients.firstName,
          clientLastName: clients.lastName,
        })
        .from(reviews)
        .leftJoin(clients, eq(reviews.clientId, clients.id))
        .where(
          and(
            eq(reviews.employeeId, employeeId),
            eq(reviews.salonId, salonId),
            eq(reviews.status, "approved")
          )
        )
        .orderBy(desc(reviews.createdAt))
        .limit(5);

      // Get gallery photos for this employee
      const photos = await tx
        .select({
          id: galleryPhotos.id,
          beforePhotoUrl: galleryPhotos.beforePhotoUrl,
          afterPhotoUrl: galleryPhotos.afterPhotoUrl,
          description: galleryPhotos.description,
          productsUsed: galleryPhotos.productsUsed,
          showProductsToClients: galleryPhotos.showProductsToClients,
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

      return {
        kind: "ok" as const,
        salon,
        employee,
        empServices,
        ratingStats,
        recentReviews,
        photos,
      };
    });

    if (result.kind === "salon-not-found") {
      return NextResponse.json(
        { success: false, error: "Salon not found" },
        { status: 404 }
      );
    }

    if (result.kind === "employee-not-found") {
      return NextResponse.json(EMPLOYEE_NOT_FOUND_BODY, { status: 404 });
    }

    const { salon, employee, empServices, ratingStats, recentReviews, photos } = result;

    return NextResponse.json({
      success: true,
      data: {
        id: employee.id,
        firstName: employee.firstName,
        lastName: employee.lastName,
        role: employee.role,
        photoUrl: employee.photoUrl,
        color: employee.color,
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
          clientName: r.clientFirstName && r.clientLastName
            ? `${r.clientFirstName} ${r.clientLastName.charAt(0)}.`
            : "Anonim",
        })),
        galleryPhotos: photos.map((p) => ({
          id: p.id,
          beforePhotoUrl: p.beforePhotoUrl,
          afterPhotoUrl: p.afterPhotoUrl,
          description: p.description,
          productsUsed: p.showProductsToClients ? p.productsUsed : null,
          showProductsToClients: p.showProductsToClients,
          createdAt: p.createdAt,
        })),
        galleryCount: photos.length,
      },
    });
  } catch (error) {
    logger.error("[Employee Profile API] Error", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to fetch employee profile" },
      { status: 500 }
    );
  }
}
