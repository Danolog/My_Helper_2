import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { validateBody, updatePromoCodeSchema } from "@/lib/api-validation";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";
import { isPromotionTypeFrozen } from "@/lib/features";
import { getUserSalonId } from "@/lib/get-user-salon";
import { logger } from "@/lib/logger";
import { promoCodes, promotions } from "@/lib/schema";
import { forSalon } from "@/lib/server/repository";
// GET /api/promo-codes/:id - Get a single promo code with joined promotion data
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
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

    const { id } = await params;

    const [result] = await forSalon(salonId).raw((tx) =>
      tx
        .select({
          promoCode: promoCodes,
          promotion: promotions,
        })
        .from(promoCodes)
        .leftJoin(promotions, eq(promoCodes.promotionId, promotions.id))
        .where(and(eq(promoCodes.id, id), eq(promoCodes.salonId, salonId)))
        .limit(1)
    );

    if (!result) {
      return NextResponse.json(
        { success: false, error: "Promo code not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        ...result.promoCode,
        promotion: result.promotion,
      },
    });
  } catch (error) {
    logger.error("[PromoCodes API] Database error", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to fetch promo code" },
      { status: 500 }
    );
  }
}

// PUT /api/promo-codes/:id - Update a promo code
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
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

    const { id } = await params;
    const body = await request.json();
    const validationError = validateBody(updatePromoCodeSchema, body);
    if (validationError) {
      return NextResponse.json(validationError, { status: 400 });
    }
    const { code, promotionId, usageLimit, expiresAt } = body;

    // Check that the promo code exists in the caller's salon
    const existing = await forSalon(salonId).findOne(promoCodes, id);

    if (!existing) {
      return NextResponse.json(
        { success: false, error: "Promo code not found" },
        { status: 404 }
      );
    }

    // Build update object with only provided fields
    const updateData: Record<string, unknown> = {};

    if (code !== undefined) {
      const normalizedCode = code.toUpperCase().trim();

      if (normalizedCode.length === 0) {
        return NextResponse.json(
          { success: false, error: "Code cannot be empty" },
          { status: 400 }
        );
      }

      // Check uniqueness within the salon (excluding the current record)
      if (normalizedCode !== existing.code) {
        const [duplicate] = await forSalon(salonId).raw((tx) =>
          tx
            .select()
            .from(promoCodes)
            .where(
              and(
                eq(promoCodes.salonId, existing.salonId),
                eq(promoCodes.code, normalizedCode)
              )
            )
            .limit(1)
        );

        if (duplicate && duplicate.id !== id) {
          return NextResponse.json(
            { success: false, error: "A promo code with this code already exists for this salon" },
            { status: 409 }
          );
        }
      }

      updateData.code = normalizedCode;
    }

    if (promotionId !== undefined) {
      if (promotionId === null) {
        // Allow unlinking a promotion
        updateData.promotionId = null;
      } else {
        // Validate that the promotion exists and belongs to the same salon
        const [promotion] = await forSalon(salonId).raw((tx) =>
          tx
            .select()
            .from(promotions)
            .where(
              and(
                eq(promotions.id, promotionId),
                eq(promotions.salonId, existing.salonId)
              )
            )
            .limit(1)
        );

        // Promocja zamrożonego typu nie istnieje dla panelu (B2.1, audyt bezpieczeństwa N1):
        // nowego powiązania nie ma — 404 jak brak promocji. Wyjątek: kod już
        // z nią powiązany (formularz edycji odsyła promotionId zawsze) — bez
        // tego właściciel nie zmieniłby limitu ani daty takiego kodu.
        const frozenNewLink =
          promotion != null &&
          isPromotionTypeFrozen(promotion.type) &&
          promotionId !== existing.promotionId;
        if (!promotion || frozenNewLink) {
          return NextResponse.json(
            { success: false, error: "Promotion not found or does not belong to this salon" },
            { status: 404 }
          );
        }

        updateData.promotionId = promotionId;
      }
    }

    if (usageLimit !== undefined) {
      updateData.usageLimit = usageLimit;
    }

    if (expiresAt !== undefined) {
      updateData.expiresAt = expiresAt ? new Date(expiresAt) : null;
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json(
        { success: false, error: "No fields to update" },
        { status: 400 }
      );
    }

    const updated = await forSalon(salonId).updateOwned(promoCodes, id, updateData);

    if (!updated) {
      return NextResponse.json(
        { success: false, error: "Failed to update promo code" },
        { status: 500 }
      );
    }

    logger.info(`[PromoCodes API] Updated promo code: ${updated.code} (${updated.id})`);

    return NextResponse.json({
      success: true,
      data: updated,
    });
  } catch (error) {
    logger.error("[PromoCodes API] Database error", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to update promo code" },
      { status: 500 }
    );
  }
}

// DELETE /api/promo-codes/:id - Delete a promo code
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
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

    const { id } = await params;

    const deleted = await forSalon(salonId).deleteOwned(promoCodes, id);

    if (!deleted) {
      return NextResponse.json(
        { success: false, error: "Promo code not found" },
        { status: 404 }
      );
    }

    logger.info(`[PromoCodes API] Deleted promo code: ${deleted.code} (${deleted.id})`);

    return NextResponse.json({
      success: true,
      data: deleted,
    });
  } catch (error) {
    logger.error("[PromoCodes API] Database error", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to delete promo code" },
      { status: 500 }
    );
  }
}
