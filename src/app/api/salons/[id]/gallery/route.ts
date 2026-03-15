import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { galleryPhotos, employees, services } from "@/lib/schema";
import { eq, desc, and, isNotNull } from "drizzle-orm";

import { logger } from "@/lib/logger";
// GET /api/salons/[id]/gallery - Public gallery for clients (no auth required)
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: salonId } = await params;
    const { searchParams } = new URL(request.url);
    const employeeId = searchParams.get("employeeId");
    const serviceId = searchParams.get("serviceId");
    const pairsOnly = searchParams.get("pairsOnly") === "true";

    // Build filter conditions
    const conditions = [eq(galleryPhotos.salonId, salonId)];
    if (employeeId) {
      conditions.push(eq(galleryPhotos.employeeId, employeeId));
    }
    if (serviceId) {
      conditions.push(eq(galleryPhotos.serviceId, serviceId));
    }
    if (pairsOnly) {
      conditions.push(isNotNull(galleryPhotos.beforePhotoUrl));
      conditions.push(isNotNull(galleryPhotos.afterPhotoUrl));
    }

    const photos = await db
      .select({
        id: galleryPhotos.id,
        salonId: galleryPhotos.salonId,
        employeeId: galleryPhotos.employeeId,
        serviceId: galleryPhotos.serviceId,
        beforePhotoUrl: galleryPhotos.beforePhotoUrl,
        afterPhotoUrl: galleryPhotos.afterPhotoUrl,
        description: galleryPhotos.description,
        productsUsed: galleryPhotos.productsUsed,
        techniques: galleryPhotos.techniques,
        duration: galleryPhotos.duration,
        showProductsToClients: galleryPhotos.showProductsToClients,
        createdAt: galleryPhotos.createdAt,
        employeeFirstName: employees.firstName,
        employeeLastName: employees.lastName,
        serviceName: services.name,
      })
      .from(galleryPhotos)
      .leftJoin(employees, eq(galleryPhotos.employeeId, employees.id))
      .leftJoin(services, eq(galleryPhotos.serviceId, services.id))
      .where(and(...conditions))
      .orderBy(desc(galleryPhotos.createdAt));

    // For client-facing: hide products when showProductsToClients is false
    const clientPhotos = photos.map((photo) => ({
      ...photo,
      productsUsed: photo.showProductsToClients ? photo.productsUsed : null,
    }));

    // Also fetch distinct services and employees for filter options
    const availableEmployees = await db
      .select({
        id: employees.id,
        firstName: employees.firstName,
        lastName: employees.lastName,
      })
      .from(galleryPhotos)
      .innerJoin(employees, eq(galleryPhotos.employeeId, employees.id))
      .where(eq(galleryPhotos.salonId, salonId))
      .groupBy(employees.id, employees.firstName, employees.lastName);

    const availableServices = await db
      .select({
        id: services.id,
        name: services.name,
      })
      .from(galleryPhotos)
      .innerJoin(services, eq(galleryPhotos.serviceId, services.id))
      .where(eq(galleryPhotos.salonId, salonId))
      .groupBy(services.id, services.name);

    return NextResponse.json({
      success: true,
      data: clientPhotos,
      count: clientPhotos.length,
      filters: {
        employees: availableEmployees,
        services: availableServices,
      },
    });
  } catch (error) {
    logger.error("[Salon Gallery API] Database error", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to fetch gallery photos" },
      { status: 500 }
    );
  }
}
