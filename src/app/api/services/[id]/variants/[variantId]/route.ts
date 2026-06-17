import { NextResponse } from "next/server";
import { serviceVariants, services } from "@/lib/schema";
import { eq, and } from "drizzle-orm";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";
import { getUserSalonId } from "@/lib/get-user-salon";
import { validateBody, updateServiceVariantSchema } from "@/lib/api-validation";
import { forSalon } from "@/lib/server/repository";

/** Verify the service belongs to the caller's salon. */
async function serviceBelongsToSalon(serviceId: string, salonId: string): Promise<boolean> {
  const service = await forSalon(salonId).findOne(services, serviceId);
  return !!service;
}

import { logger } from "@/lib/logger";
// PUT /api/services/[id]/variants/[variantId] - Update a variant
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string; variantId: string }> }
) {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

    const salonId = await getUserSalonId();
    if (!salonId) {
      return NextResponse.json(
        { success: false, error: "Salon not found" },
        { status: 404 }
      );
    }

    const { id, variantId } = await params;
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
  } catch (error) {
    logger.error("[Variants API] Error updating variant", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to update variant" },
      { status: 500 }
    );
  }
}

// DELETE /api/services/[id]/variants/[variantId] - Delete a variant
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; variantId: string }> }
) {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

    const salonId = await getUserSalonId();
    if (!salonId) {
      return NextResponse.json(
        { success: false, error: "Salon not found" },
        { status: 404 }
      );
    }

    const { id, variantId } = await params;

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
  } catch (error) {
    logger.error("[Variants API] Error deleting variant", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to delete variant" },
      { status: 500 }
    );
  }
}
