import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { withApiHandler } from "@/lib/api-handler";
import { validateBody, updateServiceSchema } from "@/lib/api-validation";
import { getUserSalonId } from "@/lib/get-user-salon";
import { logger } from "@/lib/logger";
import { services, serviceCategories, serviceVariants } from "@/lib/schema";
import { forSalon } from "@/lib/server/repository";
import { isValidUuid } from "@/lib/validations";

// GET /api/services/[id] - Get a single service with its variants
export const GET = withApiHandler(
  {
    auth: "user",
    logLabel: "[Services API] GET",
    errorMessage: "Failed to fetch service",
  },
  async ({ params }) => {
    const salonId = await getUserSalonId();
    if (!salonId) {
      return NextResponse.json(
        { success: false, error: "Salon not found" },
        { status: 404 }
      );
    }

    const id = params.id!; // segment [id] zawsze obecny (noUncheckedIndexedAccess)

    if (!isValidUuid(id)) {
      return NextResponse.json(
        { success: false, error: "Invalid service ID format" },
        { status: 400 }
      );
    }

    const [serviceRow] = await forSalon(salonId).raw((tx) =>
      tx
        .select({
          service: services,
          category: serviceCategories,
        })
        .from(services)
        .leftJoin(serviceCategories, eq(services.categoryId, serviceCategories.id))
        .where(and(eq(services.id, id), eq(services.salonId, salonId)))
    );

    if (!serviceRow) {
      return NextResponse.json(
        { success: false, error: "Service not found" },
        { status: 404 }
      );
    }

    // Fetch variants for this service (serviceVariants salon-scoped posrednio — RLS w kontekscie)
    const variants = await forSalon(salonId).raw((tx) =>
      tx
        .select()
        .from(serviceVariants)
        .where(eq(serviceVariants.serviceId, id))
    );

    return NextResponse.json({
      success: true,
      data: {
        ...serviceRow.service,
        category: serviceRow.category,
        variants,
      },
    });
  }
);

// PUT /api/services/[id] - Update a service
export const PUT = withApiHandler(
  {
    auth: "user",
    logLabel: "[Services API] PUT",
    errorMessage: "Failed to update service",
  },
  async ({ request, params }) => {
    const salonId = await getUserSalonId();
    if (!salonId) {
      return NextResponse.json(
        { success: false, error: "Salon not found" },
        { status: 404 }
      );
    }

    const id = params.id!; // segment [id] zawsze obecny (noUncheckedIndexedAccess)

    if (!isValidUuid(id)) {
      return NextResponse.json(
        { success: false, error: "Invalid service ID format" },
        { status: 400 }
      );
    }

    const body = await request.json();

    // Server-side validation with Zod schema
    // (walidacja celowo w handlerze, po sprawdzeniu salonu i UUID — jak dotąd)
    const validationError = validateBody(updateServiceSchema, body);
    if (validationError) {
      return NextResponse.json(validationError, { status: 400 });
    }

    const { name, description, basePrice, baseDuration, isActive, categoryId, depositRequired, depositPercentage } = body;

    const updateData: Record<string, unknown> = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (basePrice !== undefined) updateData.basePrice = basePrice.toString();
    if (baseDuration !== undefined) updateData.baseDuration = parseInt(baseDuration, 10);
    if (isActive !== undefined) updateData.isActive = isActive;
    if (categoryId !== undefined) updateData.categoryId = categoryId;
    if (depositRequired !== undefined) updateData.depositRequired = depositRequired;
    if (depositPercentage !== undefined) updateData.depositPercentage = parseInt(depositPercentage, 10);

    const updated = await forSalon(salonId).updateOwned(services, id, updateData);

    if (!updated) {
      return NextResponse.json(
        { success: false, error: "Service not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: updated,
    });
  }
);

// DELETE /api/services/[id] - Delete a service
// Related records are handled by database cascade rules:
// - service_variants: CASCADE (deleted)
// - employee_services: CASCADE (deleted)
// - employee_service_prices: CASCADE (deleted)
// - appointments.serviceId: SET NULL (appointments preserved, serviceId nullified)
export const DELETE = withApiHandler(
  {
    auth: "user",
    logLabel: "[Services API] DELETE",
    errorMessage: "Failed to delete service",
  },
  async ({ params }) => {
    const salonId = await getUserSalonId();
    if (!salonId) {
      return NextResponse.json(
        { success: false, error: "Salon not found" },
        { status: 404 }
      );
    }

    const id = params.id!; // segment [id] zawsze obecny (noUncheckedIndexedAccess)

    if (!isValidUuid(id)) {
      return NextResponse.json(
        { success: false, error: "Invalid service ID format" },
        { status: 400 }
      );
    }

    const deleted = await forSalon(salonId).deleteOwned(services, id);

    if (!deleted) {
      return NextResponse.json(
        { success: false, error: "Service not found" },
        { status: 404 }
      );
    }

    logger.info(`[Services API] Deleted service: ${deleted.name} (${deleted.id})`);

    return NextResponse.json({
      success: true,
      data: deleted,
    });
  }
);
