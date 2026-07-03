import { NextResponse } from "next/server";
import { eq, desc, and } from "drizzle-orm";
import { withApiHandler } from "@/lib/api-handler";
import { createGalleryPhotoSchema } from "@/lib/api-validation";
import { logger } from "@/lib/logger";
import { getSalonContext, hasFeatureAccess } from "@/lib/salon-context";
import { galleryPhotos, employees, services } from "@/lib/schema";
import { forSalon } from "@/lib/server/repository";
import type { z } from "zod";
// GET /api/gallery - List gallery photos
export const GET = withApiHandler(
  {
    auth: "user",
    logLabel: "[Gallery API] GET",
    errorMessage: "Failed to fetch gallery photos",
  },
  async ({ request }) => {
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

    const photos = await forSalon(salonId).raw((tx) =>
      tx
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
      .orderBy(desc(galleryPhotos.createdAt))
    );

    logger.info(`[Gallery API] GET: ${photos.length} photos found (filters: employeeId=${employeeId || 'none'}, serviceId=${serviceId || 'none'})`);

    return NextResponse.json({
      success: true,
      data: photos,
      count: photos.length,
    });
  }
);

// POST /api/gallery - Create a gallery photo entry
export const POST = withApiHandler(
  {
    auth: "user",
    schema: createGalleryPhotoSchema as z.ZodType<{
      salonId: string;
      employeeId?: string | null;
      serviceId?: string | null;
      beforePhotoUrl?: string | null;
      afterPhotoUrl?: string | null;
      description?: string | null;
      productsUsed?: string | null;
      techniques?: string | null;
      duration?: string | null;
    }>,
    logLabel: "[Gallery API] POST",
    errorMessage: "Failed to create gallery photo",
  },
  async ({ body }) => {
    // Faza 3 (role): zdjęcia dodaje owner i employee (spec); receptionist
    // tylko z czasowym grantem "gallery-manage". Nie-owner wyłącznie do
    // WŁASNEGO salonu (salonId z body musi zgadzać się z sesją).
    const ctx = await getSalonContext();
    if (!ctx) {
      return NextResponse.json(
        { success: false, error: "Salon not found" },
        { status: 404 }
      );
    }
    if (
      (ctx.role === "receptionist" &&
        !(await hasFeatureAccess(ctx, "gallery-manage"))) ||
      (ctx.role !== "owner" && body.salonId !== ctx.salonId)
    ) {
      return NextResponse.json(
        { success: false, error: "Brak uprawnien" },
        { status: 403 }
      );
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

    const [newPhoto] = await forSalon(salonId).raw((tx) =>
      tx
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
      .returning()
    );

    logger.info(`[Gallery API] Created photo: ${newPhoto?.id}`);

    return NextResponse.json(
      {
        success: true,
        data: newPhoto,
      },
      { status: 201 }
    );
  }
);
