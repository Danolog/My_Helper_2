import { NextResponse } from "next/server";
import { eq, and, desc } from "drizzle-orm";
import { withApiHandler } from "@/lib/api-handler";
import { createPromoCodeSchema } from "@/lib/api-validation";
import { isPromotionTypeFrozen } from "@/lib/features";
import { logger } from "@/lib/logger";
import { apiRateLimit } from "@/lib/rate-limit";
import { requireSalonStaff } from "@/lib/salon-context";
import { promoCodes, promotions } from "@/lib/schema";
import { forSalon } from "@/lib/server/repository";
import type { z } from "zod";
/**
 * Generate a random 8-character alphanumeric uppercase code.
 * Uses crypto.getRandomValues for better randomness than Math.random.
 */
function generatePromoCode(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => chars[byte % chars.length]).join("");
}

// GET /api/promo-codes - List promo codes of the session salon
export const GET = withApiHandler(
  {
    auth: "user",
    logLabel: "[PromoCodes API] GET",
    errorMessage: "Failed to fetch promo codes",
  },
  async ({ request }) => {
    const { searchParams } = new URL(request.url);
    // P0 (przeglad Ryana): salon z sesji, query salonId tylko porownywany;
    // kody rabatowe jak promocje — wlasciciel albo grant "promotions".
    const guard = await requireSalonStaff({
      feature: "promotions",
      requestedSalonId: searchParams.get("salonId"),
    });
    if (guard.error) return guard.error;
    const salonId = guard.ctx.salonId;

    const result = await forSalon(salonId).raw((tx) =>
      tx
      .select({
        promoCode: promoCodes,
        promotion: promotions,
      })
      .from(promoCodes)
      .leftJoin(promotions, eq(promoCodes.promotionId, promotions.id))
      .where(eq(promoCodes.salonId, salonId))
      .orderBy(desc(promoCodes.createdAt))
    );

    // Flatten the join result to embed promotion data directly
    const formattedCodes = result.map((row) => ({
      ...row.promoCode,
      promotion: row.promotion,
    }));

    return NextResponse.json({
      success: true,
      data: formattedCodes,
      count: formattedCodes.length,
    });
  }
);

// POST /api/promo-codes - Create a new promo code
export const POST = withApiHandler(
  {
    auth: "user",
    rateLimit: apiRateLimit,
    schema: createPromoCodeSchema as z.ZodType<{
      salonId: string;
      code?: string;
      promotionId?: string | null;
      usageLimit?: number | null;
      expiresAt?: string | null;
    }>,
    logLabel: "[PromoCodes API] POST",
    errorMessage: "Failed to create promo code",
  },
  async ({ body }) => {
    // P0 (przeglad Ryana): kod powstaje WYLACZNIE w salonie z sesji —
    // body.salonId tylko porownywany (inny => 403, zero zapisu).
    const guard = await requireSalonStaff({
      feature: "promotions",
      requestedSalonId: body.salonId,
    });
    if (guard.error) return guard.error;
    const salonId = guard.ctx.salonId;
    const { code, promotionId, usageLimit, expiresAt } = body;

    // Generate code if not provided
    const promoCode = code
      ? code.toUpperCase().trim()
      : generatePromoCode();

    if (promoCode.length === 0) {
      return NextResponse.json(
        { success: false, error: "Code cannot be empty" },
        { status: 400 }
      );
    }

    // Validate that the code is unique within this salon
    const [existingCode] = await forSalon(salonId).raw((tx) =>
      tx
      .select()
      .from(promoCodes)
      .where(
        and(
          eq(promoCodes.salonId, salonId),
          eq(promoCodes.code, promoCode)
        )
      )
      .limit(1)
    );

    if (existingCode) {
      return NextResponse.json(
        { success: false, error: "A promo code with this code already exists for this salon" },
        { status: 409 }
      );
    }

    // Validate that promotionId exists and belongs to the same salon (if provided)
    if (promotionId) {
      const [promotion] = await forSalon(salonId).raw((tx) =>
        tx
        .select()
        .from(promotions)
        .where(
          and(
            eq(promotions.id, promotionId),
            eq(promotions.salonId, salonId)
          )
        )
        .limit(1)
      );

      // Promocja zamrożonego typu nie istnieje dla panelu (B2.1, Ryan N1):
      // ta sama odpowiedź co brak promocji — kod nie dawałby rabatu.
      if (!promotion || isPromotionTypeFrozen(promotion.type)) {
        return NextResponse.json(
          { success: false, error: "Promotion not found or does not belong to this salon" },
          { status: 404 }
        );
      }
    }

    const [newPromoCode] = await forSalon(salonId).raw((tx) =>
      tx
      .insert(promoCodes)
      .values({
        salonId,
        code: promoCode,
        promotionId: promotionId || null,
        usageLimit: usageLimit != null ? usageLimit : null,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
      })
      .returning()
    );

    if (!newPromoCode) {
      return NextResponse.json(
        { success: false, error: "Failed to create promo code" },
        { status: 500 }
      );
    }

    logger.info(`[PromoCodes API] Created promo code: ${newPromoCode.code} (${newPromoCode.id}) for salon ${newPromoCode.salonId}`);

    return NextResponse.json(
      {
        success: true,
        data: newPromoCode,
      },
      { status: 201 }
    );
  }
);
