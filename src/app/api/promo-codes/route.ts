import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { promoCodes, promotions } from "@/lib/schema";
import { eq, and, desc } from "drizzle-orm";
import { validateBody, createPromoCodeSchema } from "@/lib/api-validation";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";
import { apiRateLimit, getClientIp } from "@/lib/rate-limit";

import { logger } from "@/lib/logger";
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

// GET /api/promo-codes - List promo codes with optional salonId filter
export async function GET(request: Request) {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;
    const { searchParams } = new URL(request.url);
    const salonId = searchParams.get("salonId");

    if (!salonId) {
      return NextResponse.json(
        { success: false, error: "salonId query parameter is required" },
        { status: 400 }
      );
    }

    const result = await db
      .select({
        promoCode: promoCodes,
        promotion: promotions,
      })
      .from(promoCodes)
      .leftJoin(promotions, eq(promoCodes.promotionId, promotions.id))
      .where(eq(promoCodes.salonId, salonId))
      .orderBy(desc(promoCodes.createdAt));

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
  } catch (error) {
    logger.error("[PromoCodes API] Database error", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to fetch promo codes" },
      { status: 500 }
    );
  }
}

// POST /api/promo-codes - Create a new promo code
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

    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;
    const body = await request.json();

    // Server-side validation with Zod schema
    const validationError = validateBody(createPromoCodeSchema, body);
    if (validationError) {
      return NextResponse.json(validationError, { status: 400 });
    }

    const { salonId, code, promotionId, usageLimit, expiresAt } = body;

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
    const [existingCode] = await db
      .select()
      .from(promoCodes)
      .where(
        and(
          eq(promoCodes.salonId, salonId),
          eq(promoCodes.code, promoCode)
        )
      )
      .limit(1);

    if (existingCode) {
      return NextResponse.json(
        { success: false, error: "A promo code with this code already exists for this salon" },
        { status: 409 }
      );
    }

    // Validate that promotionId exists and belongs to the same salon (if provided)
    if (promotionId) {
      const [promotion] = await db
        .select()
        .from(promotions)
        .where(
          and(
            eq(promotions.id, promotionId),
            eq(promotions.salonId, salonId)
          )
        )
        .limit(1);

      if (!promotion) {
        return NextResponse.json(
          { success: false, error: "Promotion not found or does not belong to this salon" },
          { status: 404 }
        );
      }
    }

    const [newPromoCode] = await db
      .insert(promoCodes)
      .values({
        salonId,
        code: promoCode,
        promotionId: promotionId || null,
        usageLimit: usageLimit != null ? usageLimit : null,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
      })
      .returning();

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
  } catch (error) {
    logger.error("[PromoCodes API] Database error", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to create promo code" },
      { status: 500 }
    );
  }
}
