import { NextResponse } from "next/server";
import { eq, desc, and, isNotNull } from "drizzle-orm";
import { isValidUuid } from "@/lib/api-validation";
import { logger } from "@/lib/logger";
import { galleryPhotos, employees, services } from "@/lib/schema";
// Publiczna galeria salonu (bez sesji): wszystkie odczyty w jednej transakcji
// forSalon(id z URL). RLS przy salonId z URL niczego nie chroni (kontekst
// ustawia wołający) — ochroną są jawne listy kolumn i jawne eq(salonId), także
// po stronie złączeń z pracownikami i usługami.
import { forSalon } from "@/lib/server/repository";

/** Treść 400 dla parametru o złym formacie (nazwa parametru w komunikacie). */
const invalidIdResponse = (param: string) =>
  NextResponse.json({ success: false, error: `Invalid ${param}` }, { status: 400 });

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

    // Format sprawdzany PRZED forSalon: polityka RLS rzutuje kontekst na
    // ::uuid, a kolumny id są typu uuid — zły format dałby 500 z bazy.
    if (!isValidUuid(salonId)) return invalidIdResponse("salon id");
    if (employeeId && !isValidUuid(employeeId)) return invalidIdResponse("employee id");
    if (serviceId && !isValidUuid(serviceId)) return invalidIdResponse("service id");

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

    const { photos, availableEmployees, availableServices } = await forSalon(salonId).raw(
      async (tx) => {
        // eq(salonId) także w warunku złączeń: zdjęcie z odwołaniem do
        // pracownika lub usługi innego salonu nie ujawnia ich imienia ani nazwy.
        const photos = await tx
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
          .leftJoin(
            employees,
            and(eq(galleryPhotos.employeeId, employees.id), eq(employees.salonId, salonId))
          )
          .leftJoin(
            services,
            and(eq(galleryPhotos.serviceId, services.id), eq(services.salonId, salonId))
          )
          .where(and(...conditions))
          .orderBy(desc(galleryPhotos.createdAt));

        // Also fetch distinct services and employees for filter options
        const availableEmployees = await tx
          .select({
            id: employees.id,
            firstName: employees.firstName,
            lastName: employees.lastName,
          })
          .from(galleryPhotos)
          .innerJoin(employees, eq(galleryPhotos.employeeId, employees.id))
          .where(and(eq(galleryPhotos.salonId, salonId), eq(employees.salonId, salonId)))
          .groupBy(employees.id, employees.firstName, employees.lastName);

        const availableServices = await tx
          .select({
            id: services.id,
            name: services.name,
          })
          .from(galleryPhotos)
          .innerJoin(services, eq(galleryPhotos.serviceId, services.id))
          .where(and(eq(galleryPhotos.salonId, salonId), eq(services.salonId, salonId)))
          .groupBy(services.id, services.name);

        return { photos, availableEmployees, availableServices };
      }
    );

    // For client-facing: hide products when showProductsToClients is false
    const clientPhotos = photos.map((photo) => ({
      ...photo,
      productsUsed: photo.showProductsToClients ? photo.productsUsed : null,
    }));

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
