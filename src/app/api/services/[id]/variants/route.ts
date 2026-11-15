import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { withApiHandler } from "@/lib/api-handler";
import { validateBody, createServiceVariantSchema } from "@/lib/api-validation";
import { logger } from "@/lib/logger";
import { requireSalonStaff } from "@/lib/salon-context";
import { serviceVariants, services } from "@/lib/schema";
import { forSalon } from "@/lib/server/repository";
import { isValidUuid } from "@/lib/validations";

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
    // #104: salon z sesji przez requireSalonStaff (domyślne role: właściciel,
    // recepcja, pracownik) — lista wariantów jest częścią dialogów wizyty, a
    // dawne getUserSalonId() znało tylko właściciela (personel dostawał 404).
    const guard = await requireSalonStaff();
    if (guard.error) return guard.error;
    const salonId = guard.ctx.salonId;

    // Segment [id] zawsze obecny w tej trasie (noUncheckedIndexedAccess).
    // #104: zły UUID => 400 (wcześniej 500 z Postgresa, 22P02).
    const id = params.id!;
    if (!isValidUuid(id)) {
      return NextResponse.json(
        { success: false, error: "Invalid service ID format" },
        { status: 400 }
      );
    }

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
    // Zapis tylko właściciel (roles: []) — personel 403 (#104).
    const guard = await requireSalonStaff({ roles: [] });
    if (guard.error) return guard.error;
    const salonId = guard.ctx.salonId;

    // Segment [id] zawsze obecny w tej trasie (noUncheckedIndexedAccess).
    const id = params.id!;
    if (!isValidUuid(id)) {
      return NextResponse.json(
        { success: false, error: "Invalid service ID format" },
        { status: 400 }
      );
    }
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
