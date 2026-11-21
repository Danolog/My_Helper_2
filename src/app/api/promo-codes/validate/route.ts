import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { withApiHandler } from "@/lib/api-handler";
import { validatePromoCodeSchema } from "@/lib/api-validation";
import { isPromotionTypeFrozen } from "@/lib/features";
import { requireSalonStaff } from "@/lib/salon-context";
import { promoCodes, promotions } from "@/lib/schema";
import { forSalon } from "@/lib/server/repository";
import type { z } from "zod";
// POST /api/promo-codes/validate - Validate a promo code and return discount info
export const POST = withApiHandler(
  {
    auth: "user",
    schema: validatePromoCodeSchema as z.ZodType<{
      code: string;
      salonId?: string | null;
      serviceId?: string;
    }>,
    logLabel: "[PromoCodes Validate API] POST",
    errorMessage: "Failed to validate promo code",
  },
  async ({ body }) => {
    // Salon WYŁĄCZNIE z sesji. Wcześniej forSalon(body.salonId) pozwalał
    // każdemu zalogowanemu kontu sprawdzać (i zgadywać) kody dowolnego salonu.
    // body.salonId tylko porównywany (inny => 403). Kod sprawdza się przy
    // rezerwacji z panelu, do której ma dostęp właściciel i recepcja.
    const guard = await requireSalonStaff({
      requestedSalonId: body.salonId ?? null,
      roles: ["receptionist"],
    });
    if (guard.error) return guard.error;
    const salonId = guard.ctx.salonId;

    const { code } = body;

    const normalizedCode = code.toUpperCase().trim();

    // Look up the promo code by code + salonId, with joined promotion data
    const [result] = await forSalon(salonId).raw((tx) =>
      tx
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
      .limit(1)
    );

    if (!result) {
      return NextResponse.json({
        success: true,
        data: {
          valid: false,
          errorType: "not_found",
          reason: "Kod promocyjny nie istnieje. Sprawdz, czy wpisales go poprawnie.",
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
          errorType: "expired",
          reason: "Ten kod promocyjny stracil waznosc i nie moze byc juz uzywany.",
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
          errorType: "usage_limit",
          reason: `Limit uzycia tego kodu zostal wyczerpany (${promoCode.usedCount}/${promoCode.usageLimit}).`,
          code: promoCode.code,
        },
      });
    }

    // If linked to a promotion, check that the promotion is active and within date range
    if (promotion) {
      // Promocja typu zamrozonego (FROZEN_PROMOTION_TYPES) nie daje rabatu —
      // tak samo odrzuca ja tworzenie wizyty (checkPromotionApplicable).
      if (isPromotionTypeFrozen(promotion.type)) {
        return NextResponse.json({
          success: true,
          data: {
            valid: false,
            errorType: "promotion_inactive",
            reason: "Powiazana promocja jest obecnie niedostepna.",
            code: promoCode.code,
          },
        });
      }

      if (!promotion.isActive) {
        return NextResponse.json({
          success: true,
          data: {
            valid: false,
            errorType: "promotion_inactive",
            reason: "Powiazana promocja nie jest juz aktywna.",
            code: promoCode.code,
          },
        });
      }

      if (promotion.startDate && new Date(promotion.startDate) > now) {
        return NextResponse.json({
          success: true,
          data: {
            valid: false,
            errorType: "promotion_not_started",
            reason: "Powiazana promocja jeszcze sie nie rozpoczela.",
            code: promoCode.code,
          },
        });
      }

      if (promotion.endDate && new Date(promotion.endDate) < now) {
        return NextResponse.json({
          success: true,
          data: {
            valid: false,
            errorType: "promotion_ended",
            reason: "Powiazana promocja juz sie zakonczyla.",
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
  }
);
