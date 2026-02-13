import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { salons } from "@/lib/schema";
import { eq } from "drizzle-orm";

export interface BirthdaySettings {
  enabled: boolean;
  giftType: "discount" | "product"; // discount percentage or free product
  discountPercentage: number; // e.g., 10, 15, 20
  productName: string; // e.g., "Darmowy zabieg pielegnacyjny"
  customMessage: string; // Custom birthday message template
  autoSend: boolean; // Whether to auto-send on the day
}

const DEFAULT_BIRTHDAY_SETTINGS: BirthdaySettings = {
  enabled: false,
  giftType: "discount",
  discountPercentage: 10,
  productName: "",
  customMessage:
    "Wszystkiego najlepszego z okazji urodzin, {imie}! {salon} zyczy Ci wspanialego dnia!",
  autoSend: false,
};

/**
 * GET /api/salons/[id]/birthday-settings
 *
 * Returns the birthday gift configuration for a salon.
 * Reads from the salon's settingsJson field.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
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

    // Extract birthday settings from settingsJson, merge with defaults
    const settings = salon.settingsJson as Record<string, unknown> | null;
    const birthdaySettings: BirthdaySettings = {
      ...DEFAULT_BIRTHDAY_SETTINGS,
      ...((settings?.birthdayGift as Partial<BirthdaySettings>) || {}),
    };

    return NextResponse.json({
      success: true,
      data: birthdaySettings,
    });
  } catch (error) {
    console.error("[Birthday Settings API] GET Error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch birthday settings" },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/salons/[id]/birthday-settings
 *
 * Updates the birthday gift configuration for a salon.
 * Saves into the salon's settingsJson field under the "birthdayGift" key.
 *
 * Body: Partial<BirthdaySettings>
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

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
      giftType,
      discountPercentage,
      productName,
      customMessage,
      autoSend,
    } = body;

    // Build validated settings
    const newBirthdaySettings: BirthdaySettings = {
      enabled: typeof enabled === "boolean" ? enabled : DEFAULT_BIRTHDAY_SETTINGS.enabled,
      giftType:
        giftType === "discount" || giftType === "product"
          ? giftType
          : DEFAULT_BIRTHDAY_SETTINGS.giftType,
      discountPercentage:
        typeof discountPercentage === "number" &&
        discountPercentage >= 0 &&
        discountPercentage <= 100
          ? discountPercentage
          : DEFAULT_BIRTHDAY_SETTINGS.discountPercentage,
      productName:
        typeof productName === "string"
          ? productName.trim()
          : DEFAULT_BIRTHDAY_SETTINGS.productName,
      customMessage:
        typeof customMessage === "string" && customMessage.trim().length > 0
          ? customMessage.trim()
          : DEFAULT_BIRTHDAY_SETTINGS.customMessage,
      autoSend:
        typeof autoSend === "boolean"
          ? autoSend
          : DEFAULT_BIRTHDAY_SETTINGS.autoSend,
    };

    // Merge into existing settingsJson
    const existingSettings = (salon.settingsJson as Record<string, unknown>) || {};
    const updatedSettings = {
      ...existingSettings,
      birthdayGift: newBirthdaySettings,
    };

    // Save to database
    const [_updated] = await db
      .update(salons)
      .set({ settingsJson: updatedSettings })
      .where(eq(salons.id, id))
      .returning();

    console.log(
      `[Birthday Settings API] Updated birthday settings for salon ${id}:`,
      newBirthdaySettings
    );

    return NextResponse.json({
      success: true,
      data: newBirthdaySettings,
      message: "Ustawienia urodzinowe zostaly zapisane",
    });
  } catch (error) {
    console.error("[Birthday Settings API] PUT Error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to update birthday settings" },
      { status: 500 }
    );
  }
}
