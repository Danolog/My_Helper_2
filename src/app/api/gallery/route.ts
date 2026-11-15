import { NextResponse } from "next/server";
import { eq, desc, and } from "drizzle-orm";
import { withApiHandler } from "@/lib/api-handler";
import { createGalleryPhotoSchema } from "@/lib/api-validation";
import { hasGalleryUrlConflict } from "@/lib/gallery-files";
import { logger } from "@/lib/logger";
import { getSalonContext, hasFeatureAccess } from "@/lib/salon-context";
import { galleryPhotos, employees, services } from "@/lib/schema";
import { forSalon } from "@/lib/server/repository";
import { isValidUuid } from "@/lib/validations";
// GET /api/gallery - List gallery photos (panel salonu)
// Salon WYŁĄCZNIE z sesji. salonId z query (wysyła go dashboard) jest tylko
// porównywany z salonem sesji: inny = 403. Publiczna galeria salonu to
// GET /api/salons/[id]/gallery (ukrywa productsUsed wg showProductsToClients).
export const GET = withApiHandler(
  {
    auth: "user",
    logLabel: "[Gallery API] GET",
    errorMessage: "Failed to fetch gallery photos",
  },
  async ({ request }) => {
    const { searchParams } = new URL(request.url);
    const requestedSalonId = searchParams.get("salonId");
    const employeeId = searchParams.get("employeeId");
    const serviceId = searchParams.get("serviceId");

    const ctx = await getSalonContext();
    if (!ctx) {
      return NextResponse.json(
        { success: false, error: "Salon not found" },
        { status: 404 }
      );
    }
    if (requestedSalonId && requestedSalonId !== ctx.salonId) {
      return NextResponse.json(
        { success: false, error: "Brak dostepu do tego salonu" },
        { status: 403 }
      );
    }
    const salonId = ctx.salonId;

    // Filtry trafiają do kolumn uuid — śmieć dałby 500 z Postgresa.
    if ((employeeId && !isValidUuid(employeeId)) || (serviceId && !isValidUuid(serviceId))) {
      return NextResponse.json(
        { success: false, error: "Nieprawidlowy filtr" },
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
    schema: createGalleryPhotoSchema,
    logLabel: "[Gallery API] POST",
    errorMessage: "Failed to create gallery photo",
  },
  async ({ body }) => {
    // Faza 3 (role): zdjęcia dodaje owner i employee (spec); receptionist
    // tylko z czasowym grantem "gallery-manage". KAŻDA rola (także owner)
    // wyłącznie do WŁASNEGO salonu: salonId z body musi zgadzać się z sesją,
    // zapis idzie przez forSalon(ctx.salonId).
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
      body.salonId !== ctx.salonId
    ) {
      return NextResponse.json(
        { success: false, error: "Brak uprawnien" },
        { status: 403 }
      );
    }

    const salonId = ctx.salonId;
    const {
      employeeId,
      serviceId,
      beforePhotoUrl,
      afterPhotoUrl,
      description,
      productsUsed,
      techniques,
      duration,
    } = body;

    const result = await forSalon(salonId).raw(async (tx) => {
      // Pracownik i usługa muszą należeć do tego salonu — inaczej wpis
      // galerii wskazywałby rekord innego salonu.
      if (employeeId) {
        const [emp] = await tx
          .select({ id: employees.id })
          .from(employees)
          .where(and(eq(employees.id, employeeId), eq(employees.salonId, salonId)))
          .limit(1);
        if (!emp) return { error: "Pracownik nie nalezy do salonu" } as const;
      }
      if (serviceId) {
        const [svc] = await tx
          .select({ id: services.id })
          .from(services)
          .where(and(eq(services.id, serviceId), eq(services.salonId, salonId)))
          .limit(1);
        if (!svc) return { error: "Usluga nie nalezy do salonu" } as const;
      }
      // Plik przypięty już do innego wpisu tego salonu — DELETE jednego
      // kasowałby zdjęcie drugiego (kontekst salonu, RLS).
      if (await hasGalleryUrlConflict(tx, salonId, [beforePhotoUrl, afterPhotoUrl])) {
        return { error: "Ten plik zdjecia jest juz uzyty w innym wpisie galerii" } as const;
      }

      const [photo] = await tx
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
          duration: duration ?? null,
        })
        .returning();
      return { photo } as const;
    });

    if ("error" in result) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 400 }
      );
    }
    const newPhoto = result.photo;

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
