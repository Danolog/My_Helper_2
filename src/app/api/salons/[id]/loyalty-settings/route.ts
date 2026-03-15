import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { salons } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { validateBody, loyaltySettingsSchema } from "@/lib/api-validation";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";

import { logger } from "@/lib/logger";
export interface RewardTier {
  id: string;
  name: string;
  pointsRequired: number;
  rewardType: "discount" | "free_service" | "product";
  rewardValue: number; // discount percentage or free service/product value
  description: string;
}

export interface LoyaltySettings {
  enabled: boolean;
  pointsPerCurrencyUnit: number; // e.g., 1 point per 1 PLN spent
  currencyUnit: number; // e.g., per 1 PLN, per 10 PLN
  pointsExpiryDays: number | null; // null means no expiry
  rewardTiers: RewardTier[];
}

const DEFAULT_LOYALTY_SETTINGS: LoyaltySettings = {
  enabled: false,
  pointsPerCurrencyUnit: 1,
  currencyUnit: 1,
  pointsExpiryDays: null,
  rewardTiers: [],
};

/**
 * GET /api/salons/[id]/loyalty-settings
 *
 * Returns the loyalty program configuration for a salon.
 * Reads from the salon's settingsJson field under the "loyalty" key.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

    const { id } = await params;

    const [salon] = await db
      .select({ id: salons.id, settingsJson: salons.settingsJson })
      .from(salons)
      .where(eq(salons.id, id))
      .limit(1);

    if (!salon) {
      return NextResponse.json(
        { success: false, error: "Salon not found" },
        { status: 404 }
      );
    }

    // Extract loyalty settings from settingsJson, merge with defaults
    const settings = salon.settingsJson as Record<string, unknown> | null;
    const loyaltySettings: LoyaltySettings = {
      ...DEFAULT_LOYALTY_SETTINGS,
      ...((settings?.loyalty as Partial<LoyaltySettings>) || {}),
    };

    return NextResponse.json({
      success: true,
      data: loyaltySettings,
    });
  } catch (error) {
    logger.error("[Loyalty Settings API] GET Error", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to fetch loyalty settings" },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/salons/[id]/loyalty-settings
 *
 * Updates the loyalty program configuration for a salon.
 * Saves into the salon's settingsJson field under the "loyalty" key.
 *
 * Body: Partial<LoyaltySettings>
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

    const { id } = await params;
    const body = await request.json();

    // Server-side validation with Zod schema
    const validationError = validateBody(loyaltySettingsSchema, body);
    if (validationError) {
      return NextResponse.json(validationError, { status: 400 });
    }

    // Fetch current salon
    const [salon] = await db
      .select({ id: salons.id, settingsJson: salons.settingsJson })
      .from(salons)
      .where(eq(salons.id, id))
      .limit(1);

    if (!salon) {
      return NextResponse.json(
        { success: false, error: "Salon not found" },
        { status: 404 }
      );
    }

    // Validate the input
    const {
      enabled,
      pointsPerCurrencyUnit,
      currencyUnit,
      pointsExpiryDays,
      rewardTiers,
    } = body;

    // Validate reward tiers
    let validatedTiers: RewardTier[] = DEFAULT_LOYALTY_SETTINGS.rewardTiers;
    if (Array.isArray(rewardTiers)) {
      validatedTiers = rewardTiers
        .filter(
          (tier: RewardTier) =>
            typeof tier.name === "string" &&
            tier.name.trim().length > 0 &&
            typeof tier.pointsRequired === "number" &&
            tier.pointsRequired > 0 &&
            ["discount", "free_service", "product"].includes(tier.rewardType) &&
            typeof tier.rewardValue === "number" &&
            tier.rewardValue > 0
        )
        .map((tier: RewardTier) => ({
          id: tier.id || crypto.randomUUID(),
          name: tier.name.trim(),
          pointsRequired: Math.round(tier.pointsRequired),
          rewardType: tier.rewardType,
          rewardValue: tier.rewardValue,
          description:
            typeof tier.description === "string"
              ? tier.description.trim()
              : "",
        }));
    }

    // Build validated settings
    const newLoyaltySettings: LoyaltySettings = {
      enabled:
        typeof enabled === "boolean"
          ? enabled
          : DEFAULT_LOYALTY_SETTINGS.enabled,
      pointsPerCurrencyUnit:
        typeof pointsPerCurrencyUnit === "number" &&
        pointsPerCurrencyUnit >= 1 &&
        pointsPerCurrencyUnit <= 100
          ? Math.round(pointsPerCurrencyUnit)
          : DEFAULT_LOYALTY_SETTINGS.pointsPerCurrencyUnit,
      currencyUnit:
        typeof currencyUnit === "number" &&
        currencyUnit >= 1 &&
        currencyUnit <= 100
          ? Math.round(currencyUnit)
          : DEFAULT_LOYALTY_SETTINGS.currencyUnit,
      pointsExpiryDays:
        pointsExpiryDays === null
          ? null
          : typeof pointsExpiryDays === "number" &&
              pointsExpiryDays >= 30 &&
              pointsExpiryDays <= 3650
            ? Math.round(pointsExpiryDays)
            : DEFAULT_LOYALTY_SETTINGS.pointsExpiryDays,
      rewardTiers: validatedTiers,
    };

    // Merge into existing settingsJson
    const existingSettings =
      (salon.settingsJson as Record<string, unknown>) || {};
    const updatedSettings = {
      ...existingSettings,
      loyalty: newLoyaltySettings,
    };

    // Save to database
    await db
      .update(salons)
      .set({ settingsJson: updatedSettings })
      .where(eq(salons.id, id))
      .returning();

    logger.info(`[Loyalty Settings API] Updated loyalty settings for salon ${id}`,
      { settings: newLoyaltySettings as unknown as Record<string, unknown> });

    return NextResponse.json({
      success: true,
      data: newLoyaltySettings,
      message: "Ustawienia programu lojalnosciowego zostaly zapisane",
    });
  } catch (error) {
    logger.error("[Loyalty Settings API] PUT Error", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to update loyalty settings" },
      { status: 500 }
    );
  }
}
