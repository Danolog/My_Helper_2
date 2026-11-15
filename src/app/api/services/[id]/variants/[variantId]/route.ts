import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { withApiHandler } from "@/lib/api-handler";
import { validateBody, updateServiceVariantSchema } from "@/lib/api-validation";
import { requireSalonStaff } from "@/lib/salon-context";
import { serviceVariants, services } from "@/lib/schema";
import { forSalon } from "@/lib/server/repository";
import { isValidUuid } from "@/lib/validations";

/** Verify the service belongs to the caller's salon. */
async function serviceBelongsToSalon(serviceId: string, salonId: string): Promise<boolean> {
  const service = await forSalon(salonId).findOne(services, serviceId);
  return !!service;
}

// PUT /api/services/[id]/variants/[variantId] - Update a variant
export const PUT = withApiHandler(
  {
    auth: "user",
    logLabel: "[Variants API] PUT",
    errorMessage: "Failed to update variant",
  },
  async ({ request, params }) => {
    // Zapis tylko właściciel (roles: []) — personel 403 (#104).
    const guard = await requireSalonStaff({ roles: [] });
    if (guard.error) return guard.error;
    const salonId = guard.ctx.salonId;

    const id = params.id!, variantId = params.variantId!; // segmenty trasy zawsze obecne (noUncheckedIndexedAccess)
    // #104: zły UUID => 400 (wcześniej 500 z Postgresa, 22P02).
    if (!isValidUuid(id) || !isValidUuid(variantId)) {
      return NextResponse.json(
        { success: false, error: "Invalid ID format" },
        { status: 400 }
      );
    }
    // Walidacja celowo w handlerze (po sprawdzeniu salonu) — jak dotąd.
    const body = await request.json();
    const validationError = validateBody(updateServiceVariantSchema, body);
    if (validationError) {
      return NextResponse.json(validationError, { status: 400 });
    }
    const { name, priceModifier, durationModifier } = body;

    if (!(await serviceBelongsToSalon(id, salonId))) {
      return NextResponse.json(
        { success: false, error: "Variant not found" },
        { status: 404 }
      );
    }

    const updateData: Record<string, unknown> = {};
    if (name !== undefined) updateData.name = name.trim();
    if (priceModifier !== undefined) updateData.priceModifier = priceModifier.toString();
    if (durationModifier !== undefined) updateData.durationModifier = parseInt(durationModifier, 10);

    const [updated] = await forSalon(salonId).raw((tx) =>
      tx
        .update(serviceVariants)
        .set(updateData)
        .where(
          and(
            eq(serviceVariants.id, variantId),
            eq(serviceVariants.serviceId, id)
          )
        )
        .returning()
    );

    if (!updated) {
      return NextResponse.json(
        { success: false, error: "Variant not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: updated,
    });
  }
);

// DELETE /api/services/[id]/variants/[variantId] - Delete a variant
export const DELETE = withApiHandler(
  {
    auth: "user",
    logLabel: "[Variants API] DELETE",
    errorMessage: "Failed to delete variant",
  },
  async ({ params }) => {
    // Zapis tylko właściciel (roles: []) — personel 403 (#104).
    const guard = await requireSalonStaff({ roles: [] });
    if (guard.error) return guard.error;
    const salonId = guard.ctx.salonId;

    const id = params.id!, variantId = params.variantId!; // segmenty trasy zawsze obecne (noUncheckedIndexedAccess)
    // #104: zły UUID => 400 (wcześniej 500 z Postgresa, 22P02).
    if (!isValidUuid(id) || !isValidUuid(variantId)) {
      return NextResponse.json(
        { success: false, error: "Invalid ID format" },
        { status: 400 }
      );
    }

    if (!(await serviceBelongsToSalon(id, salonId))) {
      return NextResponse.json(
        { success: false, error: "Variant not found" },
        { status: 404 }
      );
    }

    const [deleted] = await forSalon(salonId).raw((tx) =>
      tx
        .delete(serviceVariants)
        .where(
          and(
            eq(serviceVariants.id, variantId),
            eq(serviceVariants.serviceId, id)
          )
        )
        .returning()
    );

    if (!deleted) {
      return NextResponse.json(
        { success: false, error: "Variant not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: deleted,
    });
  }
);
