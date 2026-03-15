import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { galleryPhotos, employees, services } from "@/lib/schema";
import { eq, desc, and } from "drizzle-orm";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";
import { validateBody, createGalleryPhotoSchema } from "@/lib/api-validation";

import { logger } from "@/lib/logger";
// GET /api/gallery - List gallery photos
export async function GET(request: Request) {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;
    const { searchParams } = new URL(request.url);
    const salonId = searchParams.get("salonId");
    const employeeId = searchParams.get("employeeId");
    const serviceId = searchParams.get("serviceId");

    if (!salonId) {
      return NextResponse.json(
        { success: false, error: "salonId is required" },
        { status: 400 }
      );
    }

    // Build filter conditions
    const conditions = [eq(galleryPhotos.salonId, salonId)];
    if (employeeId) {
      conditions.push(eq(galleryPhotos.employeeId, employeeId));
    }
    if (serviceId) {
      conditions.push(eq(galleryPhotos.serviceId, serviceId));
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

    logger.info(`[Gallery API] GET: ${photos.length} photos found (filters: employeeId=${employeeId || 'none'}, serviceId=${serviceId || 'none'})`);

    return NextResponse.json({
      success: true,
      data: photos,
      count: photos.length,
    });
  } catch (error) {
    logger.error("[Gallery API] Database error", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to fetch gallery photos" },
      { status: 500 }
    );
  }
}

// POST /api/gallery - Create a gallery photo entry
export async function POST(request: Request) {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;
    const body = await request.json();
    const validationError = validateBody(createGalleryPhotoSchema, body);
    if (validationError) {
      return NextResponse.json(validationError, { status: 400 });
    }
    const {
      salonId,
      employeeId,
      serviceId,
      beforePhotoUrl,
      afterPhotoUrl,
      description,
      productsUsed,
      techniques,
      duration,
    } = body;

    const [newPhoto] = await db
      .insert(galleryPhotos)
      .values({
        salonId,
        employeeId: employeeId || null,
        serviceId: serviceId || null,
        beforePhotoUrl: beforePhotoUrl || null,
        afterPhotoUrl: afterPhotoUrl || null,
        description: description || null,
        productsUsed: productsUsed || null,
        techniques: techniques || null,
        duration: duration ? parseInt(duration, 10) : null,
      })
      .returning();

    logger.info(`[Gallery API] Created photo: ${newPhoto?.id}`);

    return NextResponse.json(
      {
        success: true,
        data: newPhoto,
      },
      { status: 201 }
    );
  } catch (error) {
    logger.error("[Gallery API] Database error", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to create gallery photo" },
      { status: 500 }
    );
  }
}
