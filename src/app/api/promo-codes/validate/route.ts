import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { promoCodes, promotions } from "@/lib/schema";
import { eq, and } from "drizzle-orm";

// POST /api/promo-codes/validate - Validate a promo code and return discount info
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { code, salonId } = body;

    if (!code || !salonId) {
      return NextResponse.json(
        { success: false, error: "code and salonId are required" },
        { status: 400 }
      );
    }

    const normalizedCode = code.toUpperCase().trim();

    // Look up the promo code by code + salonId, with joined promotion data
    const [result] = await db
      .select({
        promoCode: promoCodes,
        promotion: promotions,
      })
      .from(promoCodes)
      .leftJoin(promotions, eq(promoCodes.promotionId, promotions.id))
      .where(
        and(
          eq(promoCodes.code, normalizedCode),
          eq(promoCodes.salonId, salonId)
        )
      )
      .limit(1);

    if (!result) {
      return NextResponse.json({
        success: true,
        data: {
          valid: false,
          reason: "Promo code not found",
        },
      });
    }

    const { promoCode, promotion } = result;
    const now = new Date();

    // Check if the code has expired
    if (promoCode.expiresAt && new Date(promoCode.expiresAt) < now) {
      return NextResponse.json({
        success: true,
        data: {
          valid: false,
          reason: "Promo code has expired",
          code: promoCode.code,
        },
      });
    }

    // Check if usage limit has been reached
    if (
      promoCode.usageLimit != null &&
      promoCode.usedCount != null &&
      promoCode.usedCount >= promoCode.usageLimit
    ) {
      return NextResponse.json({
        success: true,
        data: {
          valid: false,
          reason: "Promo code usage limit has been reached",
          code: promoCode.code,
        },
      });
    }

    // If linked to a promotion, check that the promotion is active and within date range
    if (promotion) {
      if (!promotion.isActive) {
        return NextResponse.json({
          success: true,
          data: {
            valid: false,
            reason: "The linked promotion is no longer active",
            code: promoCode.code,
          },
        });
      }

      if (promotion.startDate && new Date(promotion.startDate) > now) {
        return NextResponse.json({
          success: true,
          data: {
            valid: false,
            reason: "The linked promotion has not started yet",
            code: promoCode.code,
          },
        });
      }

      if (promotion.endDate && new Date(promotion.endDate) < now) {
        return NextResponse.json({
          success: true,
          data: {
            valid: false,
            reason: "The linked promotion has ended",
            code: promoCode.code,
          },
        });
      }
    }

    // Code is valid -- build the response with discount info
    const response: Record<string, unknown> = {
      valid: true,
      code: promoCode.code,
      promoCodeId: promoCode.id,
      usedCount: promoCode.usedCount,
      usageLimit: promoCode.usageLimit,
      expiresAt: promoCode.expiresAt,
    };

    // Include discount details from the linked promotion
    if (promotion) {
      response.promotionId = promotion.id;
      response.promotionName = promotion.name;
      response.discountType = promotion.type;
      response.discountValue = parseFloat(promotion.value);
      response.conditionsJson = promotion.conditionsJson;
    }

    return NextResponse.json({
      success: true,
      data: response,
    });
  } catch (error) {
    console.error("[PromoCodes Validate API] Database error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to validate promo code" },
      { status: 500 }
    );
  }
}
