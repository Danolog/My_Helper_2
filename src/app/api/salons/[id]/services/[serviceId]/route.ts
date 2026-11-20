import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { isValidUuid } from "@/lib/api-validation";
import { logger } from "@/lib/logger";
import {
  services,
  serviceVariants,
  employeeServices,
  employees,
  employeeServicePrices,
  serviceCategories,
} from "@/lib/schema";
// Publiczny szczegół usługi (bez sesji): wszystkie odczyty w jednej
// transakcji forSalon(salonId z URL). RLS przy salonId z URL niczego nie
// chroni (kontekst ustawia wołający) — ochroną są jawne listy kolumn i jawne
// eq(salonId); tabele bez salon_id filtrujemy po sprawdzonej usłudze.
import { forSalon } from "@/lib/server/repository";

// GET /api/salons/[id]/services/[serviceId] - Get service details with variants and assigned employees
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; serviceId: string }> }
) {
  try {
    const { id: salonId, serviceId } = await params;

    // Format sprawdzany PRZED forSalon: polityka RLS rzutuje kontekst na
    // ::uuid, a kolumny id są typu uuid — zły format dałby 500 z bazy.
    if (!isValidUuid(salonId)) {
      return NextResponse.json(
        { success: false, error: "Invalid salon id" },
        { status: 400 }
      );
    }
    if (!isValidUuid(serviceId)) {
      return NextResponse.json(
        { success: false, error: "Invalid service id" },
        { status: 400 }
      );
    }

    const result = await forSalon(salonId).raw(async (tx) => {
      // Fetch the service and verify it belongs to the salon
      const [service] = await tx
        .select({
          id: services.id,
          name: services.name,
          description: services.description,
          basePrice: services.basePrice,
          baseDuration: services.baseDuration,
          isActive: services.isActive,
          salonId: services.salonId,
          categoryId: services.categoryId,
        })
        .from(services)
        .where(and(eq(services.id, serviceId), eq(services.salonId, salonId)));
      if (!service) return null;

      // Fetch category info if available
      let category: { id: string; name: string } | null = null;
      if (service.categoryId) {
        const [cat] = await tx
          .select({ id: serviceCategories.id, name: serviceCategories.name })
          .from(serviceCategories)
          .where(
            and(
              eq(serviceCategories.id, service.categoryId),
              eq(serviceCategories.salonId, salonId)
            )
          );
        category = cat || null;
      }

      // Fetch all variants for this service (service_variants nie ma
      // salon_id — usługa sprawdzona wyżej jako należąca do salonu)
      const variants = await tx
        .select({
          id: serviceVariants.id,
          name: serviceVariants.name,
          priceModifier: serviceVariants.priceModifier,
          durationModifier: serviceVariants.durationModifier,
        })
        .from(serviceVariants)
        .where(eq(serviceVariants.serviceId, serviceId));

      // Fetch assigned employees with their custom prices
      const assignments = await tx
        .select({
          id: employees.id,
          firstName: employees.firstName,
          lastName: employees.lastName,
          role: employees.role,
          color: employees.color,
          photoUrl: employees.photoUrl,
        })
        .from(employeeServices)
        .innerJoin(employees, eq(employeeServices.employeeId, employees.id))
        .where(
          and(
            eq(employeeServices.serviceId, serviceId),
            eq(employees.salonId, salonId),
            eq(employees.isActive, true)
          )
        );

      // Fetch custom prices for assigned employees
      let customPrices: { employeeId: string; customPrice: string }[] = [];
      if (assignments.length > 0) {
        customPrices = await tx
          .select({
            employeeId: employeeServicePrices.employeeId,
            customPrice: employeeServicePrices.customPrice,
          })
          .from(employeeServicePrices)
          .where(eq(employeeServicePrices.serviceId, serviceId));
      }

      return { service, category, variants, assignments, customPrices };
    });

    if (!result) {
      return NextResponse.json(
        { success: false, error: "Service not found" },
        { status: 404 }
      );
    }

    const { service, category, variants, assignments, customPrices } = result;

    // Build employee list with optional custom prices
    const employeeList = assignments.map((emp) => {
      const priceEntry = customPrices.find((p) => p.employeeId === emp.id);
      return {
        id: emp.id,
        firstName: emp.firstName,
        lastName: emp.lastName,
        role: emp.role,
        color: emp.color,
        photoUrl: emp.photoUrl,
        customPrice: priceEntry?.customPrice || null,
      };
    });

    return NextResponse.json({
      success: true,
      data: {
        id: service.id,
        name: service.name,
        description: service.description,
        basePrice: service.basePrice,
        baseDuration: service.baseDuration,
        isActive: service.isActive,
        salonId: service.salonId,
        categoryId: service.categoryId,
        category: category
          ? { id: category.id, name: category.name }
          : null,
        variants: variants.map((v) => ({
          id: v.id,
          name: v.name,
          priceModifier: v.priceModifier,
          durationModifier: v.durationModifier,
        })),
        employees: employeeList,
      },
    });
  } catch (error) {
    logger.error("[Salon Service Detail API] Error", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to fetch service details" },
      { status: 500 }
    );
  }
}
