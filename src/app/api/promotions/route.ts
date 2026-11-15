import { NextResponse } from "next/server";
import { eq, desc } from "drizzle-orm";
import { validateBody, createPromotionSchema } from "@/lib/api-validation";
import { isPromotionTypeFrozen } from "@/lib/features";
import { logger } from "@/lib/logger";
import { apiRateLimit, getClientIp } from "@/lib/rate-limit";
import { requireSalonStaff } from "@/lib/salon-context";
import { promotions } from "@/lib/schema";
import { frozenPromotionTypeResponse } from "@/lib/server/frozen-guard";
import { forSalon } from "@/lib/server/repository";
// GET /api/promotions - List promotions of the session salon
export async function GET(request: Request) {
  try {
    // Faza 3 (role) + P0 (przegląd Ryana): promocje tylko owner albo czasowy
    // grant "promotions", ZAWSZE salon z sesji. Wcześniej właściciel czytał
    // salon z query (dowolny), a bez salonId — promocje wszystkich salonów.
    const { searchParams } = new URL(request.url);
    const guard = await requireSalonStaff({
      feature: "promotions",
      requestedSalonId: searchParams.get("salonId"),
    });
    if (guard.error) return guard.error;
    const salonId = guard.ctx.salonId;

    // Select only the columns needed by the promotions UI
    const promotionColumns = {
      id: promotions.id,
      salonId: promotions.salonId,
      name: promotions.name,
      type: promotions.type,
      value: promotions.value,
      startDate: promotions.startDate,
      endDate: promotions.endDate,
      conditionsJson: promotions.conditionsJson,
      isActive: promotions.isActive,
      createdAt: promotions.createdAt,
    };

    // forSalon: RLS + jawny eq(salonId), obowiązek raw().
    const rows = await forSalon(salonId).raw((tx) =>
      tx
        .select(promotionColumns)
        .from(promotions)
        .where(eq(promotions.salonId, salonId))
        .orderBy(desc(promotions.createdAt))
    );
    // Promocje typów zamrożonych (FROZEN_PROMOTION_TYPES) zostają w bazie,
    // ale panel ich nie dostaje — nie da się ich podejrzeć ani włączyć.
    const result = rows.filter((promo) => !isPromotionTypeFrozen(promo.type));

    return NextResponse.json({
      success: true,
      data: result,
      count: result.length,
    });
  } catch (error) {
    logger.error("[Promotions API] Database error", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to fetch promotions" },
      { status: 500 }
    );
  }
}

// POST /api/promotions - Create a new promotion
export async function POST(request: Request) {
  try {
    const ip = getClientIp(request);
    const rateLimitResult = apiRateLimit.check(ip);
    if (!rateLimitResult.success) {
      return NextResponse.json(
        { success: false, error: "Zbyt wiele żądań. Spróbuj ponownie później." },
        { status: 429, headers: { "Retry-After": String(Math.ceil(rateLimitResult.reset / 1000)) } }
      );
    }

    const body = await request.json();

    // Faza 3 (role) + P0 (przegląd Ryana): tworzenie promocji tylko owner albo
    // czasowy grant "promotions", ZAWSZE w salonie z sesji. Wcześniej właściciel
    // był zwolniony z porównania salonId — owner salonu A tworzył promocję w B.
    const guard = await requireSalonStaff({
      feature: "promotions",
      requestedSalonId: typeof body?.salonId === "string" ? body.salonId : null,
    });
    if (guard.error) return guard.error;
    const salonId = guard.ctx.salonId;

    // Server-side validation with Zod schema
    const validationError = validateBody(createPromotionSchema, body);
    if (validationError) {
      return NextResponse.json(validationError, { status: 400 });
    }
    const { name, type, value, startDate, endDate, conditionsJson, isActive } = body;

    // Typ zamrożony (happy hours, pakiet, 2+1, pierwsza wizyta) → 400, bez zapisu.
    const frozenType = frozenPromotionTypeResponse(type);
    if (frozenType) return frozenType;

    // Validate percentage value (0-100)
    if (type === "percentage") {
      const numValue = parseFloat(value);
      if (isNaN(numValue) || numValue <= 0 || numValue > 100) {
        return NextResponse.json(
          { success: false, error: "Percentage discount must be between 1 and 100" },
          { status: 400 }
        );
      }
    }

    // Validate fixed value
    if (type === "fixed") {
      const numValue = parseFloat(value);
      if (isNaN(numValue) || numValue <= 0) {
        return NextResponse.json(
          { success: false, error: "Fixed discount must be greater than 0" },
          { status: 400 }
        );
      }
    }

    // For buy2get1, value represents the discount percentage on the free item (100 = fully free)
    if (type === "buy2get1") {
      const numValue = parseFloat(value);
      if (isNaN(numValue) || numValue <= 0 || numValue > 100) {
        return NextResponse.json(
          { success: false, error: "Buy 2 Get 1 discount must be between 1 and 100 percent" },
          { status: 400 }
        );
      }
    }

    // First visit: percentage discount for new clients
    if (type === "first_visit") {
      const numValue = parseFloat(value);
      if (isNaN(numValue) || numValue <= 0 || numValue > 100) {
        return NextResponse.json(
          { success: false, error: "First visit discount must be between 1 and 100 percent" },
          { status: 400 }
        );
      }
    }

    // Package: value is the total package price, conditionsJson must include packageServiceIds
    if (type === "package") {
      const numValue = parseFloat(value);
      if (isNaN(numValue) || numValue <= 0) {
        return NextResponse.json(
          { success: false, error: "Package price must be greater than 0" },
          { status: 400 }
        );
      }
      const cond = conditionsJson || {};
      if (!cond.packageServiceIds || !Array.isArray(cond.packageServiceIds) || cond.packageServiceIds.length < 2) {
        return NextResponse.json(
          { success: false, error: "Package must include at least 2 services" },
          { status: 400 }
        );
      }
    }

    // Happy hours: value is percentage discount, conditions must include hours and days
    if (type === "happy_hours") {
      const numValue = parseFloat(value);
      if (isNaN(numValue) || numValue <= 0 || numValue > 100) {
        return NextResponse.json(
          { success: false, error: "Happy hours discount must be between 1 and 100 percent" },
          { status: 400 }
        );
      }
      // Validate that happy hours conditions are provided
      const cond = conditionsJson || body.conditionsJson || {};
      if (!cond.startTime || !cond.endTime) {
        return NextResponse.json(
          { success: false, error: "Happy hours require startTime and endTime in conditions" },
          { status: 400 }
        );
      }
      if (!cond.daysOfWeek || !Array.isArray(cond.daysOfWeek) || cond.daysOfWeek.length === 0) {
        return NextResponse.json(
          { success: false, error: "Happy hours require at least one day of the week" },
          { status: 400 }
        );
      }
    }

    // Build conditions JSON - include applicable service IDs if provided
    const conditions = conditionsJson || {};
    if (body.applicableServiceIds && Array.isArray(body.applicableServiceIds)) {
      conditions.applicableServiceIds = body.applicableServiceIds;
    }

    const [newPromotion] = await forSalon(salonId).raw((tx) =>
      tx
      .insert(promotions)
      .values({
        salonId,
        name,
        type,
        value: value.toString(),
        startDate: startDate ? new Date(startDate) : null,
        endDate: endDate ? new Date(endDate) : null,
        conditionsJson: conditions,
        isActive: isActive !== undefined ? isActive : true,
      })
      .returning()
    );

    if (!newPromotion) {
      return NextResponse.json(
        { success: false, error: "Failed to create promotion" },
        { status: 500 }
      );
    }

    logger.info(`[Promotions API] Created promotion: ${newPromotion.name} (${newPromotion.id}) - type: ${newPromotion.type}, value: ${newPromotion.value}`);

    return NextResponse.json({
      success: true,
      data: newPromotion,
    }, { status: 201 });
  } catch (error) {
    logger.error("[Promotions API] Database error", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to create promotion" },
      { status: 500 }
    );
  }
}
