import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { withApiHandler } from "@/lib/api-handler";
import { validateBody, createServiceVariantSchema } from "@/lib/api-validation";
import { getUserSalonId } from "@/lib/get-user-salon";
import { logger } from "@/lib/logger";
import { serviceVariants, services } from "@/lib/schema";
import { forSalon } from "@/lib/server/repository";

/** Verify the service belongs to the caller's salon. */
async function serviceBelongsToSalon(serviceId: string, salonId: string): Promise<boolean> {
  const service = await forSalon(salonId).findOne(services, serviceId);
  return !!service;
}

// GET /api/services/[id]/variants - List all variants for a service
export const GET = withApiHandler(
  {
    auth: "user",
    logLabel: "[Variants API] GET",
    errorMessage: "Failed to fetch variants",
  },
  async ({ params }) => {
    const salonId = await getUserSalonId();
    if (!salonId) {
      return NextResponse.json(
        { success: false, error: "Salon not found" },
        { status: 404 }
      );
    }

    // Segment [id] zawsze obecny w tej trasie (noUncheckedIndexedAccess)
    const id = params.id!;

    // Verify service exists in the caller's salon
    if (!(await serviceBelongsToSalon(id, salonId))) {
      return NextResponse.json(
        { success: false, error: "Service not found" },
        { status: 404 }
      );
    }

    // serviceVariants nie ma salonId — scope przez zweryfikowany wyżej serwis.
    const variants = await forSalon(salonId).raw((tx) =>
      tx
        .select()
        .from(serviceVariants)
        .where(eq(serviceVariants.serviceId, id))
    );

    return NextResponse.json({
      success: true,
      data: variants,
      count: variants.length,
    });
  }
);

// POST /api/services/[id]/variants - Create a new variant
export const POST = withApiHandler(
  {
    auth: "user",
    logLabel: "[Variants API] POST",
    errorMessage: "Failed to create variant",
  },
  async ({ request, params }) => {
    const salonId = await getUserSalonId();
    if (!salonId) {
      return NextResponse.json(
        { success: false, error: "Salon not found" },
        { status: 404 }
      );
    }

    // Segment [id] zawsze obecny w tej trasie (noUncheckedIndexedAccess)
    const id = params.id!;
    // Walidacja celowo w handlerze (po sprawdzeniu salonu) — jak dotąd.
    const body = await request.json();
    const validationError = validateBody(createServiceVariantSchema, body);
    if (validationError) {
      return NextResponse.json(validationError, { status: 400 });
    }
    const { name, priceModifier, durationModifier } = body;

    // Verify service exists in the caller's salon
    if (!(await serviceBelongsToSalon(id, salonId))) {
      return NextResponse.json(
        { success: false, error: "Service not found" },
        { status: 404 }
      );
    }

    // serviceVariants nie ma salonId — scope przez zweryfikowany wyżej serwis.
    const [newVariant] = await forSalon(salonId).raw((tx) =>
      tx
        .insert(serviceVariants)
        .values({
          serviceId: id,
          name: name.trim(),
          priceModifier: (priceModifier ?? 0).toString(),
          durationModifier: parseInt(durationModifier ?? "0", 10),
        })
        .returning()
    );

    logger.info(`[Variants API] Created variant "${name}" for service ${id}`);

    return NextResponse.json(
      {
        success: true,
        data: newVariant,
      },
      { status: 201 }
    );
  }
);
