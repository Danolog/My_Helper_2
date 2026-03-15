import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { salons } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";

export interface WeMissYouSettings {
  enabled: boolean;
  inactiveDays: number; // Number of days since last visit to consider inactive (default 30)
  customMessage: string; // Message template with {imie}, {nazwisko}, {salon}, {dni} placeholders
  includeBookingLink: boolean; // Whether to include booking link in notification
  autoSend: boolean; // Whether to auto-send on cron
}

const DEFAULT_WE_MISS_YOU_SETTINGS: WeMissYouSettings = {
  enabled: false,
  inactiveDays: 30,
  customMessage:
    "Czesć {imie}! Dawno Cię u nas nie widzieliśmy w {salon}. Minęło już {dni} dni od Twojej ostatniej wizyty. Tęsknimy! Zarezerwuj wizytę i wróć do nas.",
  includeBookingLink: true,
  autoSend: false,
};

/**
 * GET /api/salons/[id]/we-miss-you-settings
 *
 * Returns the "we miss you" re-engagement configuration for a salon.
 * Reads from the salon's settingsJson field.
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

    // Extract "we miss you" settings from settingsJson, merge with defaults
    const settings = salon.settingsJson as Record<string, unknown> | null;
    const weMissYouSettings: WeMissYouSettings = {
      ...DEFAULT_WE_MISS_YOU_SETTINGS,
      ...((settings?.weMissYou as Partial<WeMissYouSettings>) || {}),
    };

    return NextResponse.json({
      success: true,
      data: weMissYouSettings,
    });
  } catch (error) {
    console.error("[We Miss You Settings API] GET Error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch we-miss-you settings" },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/salons/[id]/we-miss-you-settings
 *
 * Updates the "we miss you" re-engagement configuration for a salon.
 * Saves into the salon's settingsJson field under the "weMissYou" key.
 *
 * Body: Partial<WeMissYouSettings>
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
      inactiveDays,
      customMessage,
      includeBookingLink,
      autoSend,
    } = body;

    // Build validated settings
    const newWeMissYouSettings: WeMissYouSettings = {
      enabled:
        typeof enabled === "boolean"
          ? enabled
          : DEFAULT_WE_MISS_YOU_SETTINGS.enabled,
      inactiveDays:
        typeof inactiveDays === "number" &&
        inactiveDays >= 1 &&
        inactiveDays <= 365
          ? inactiveDays
          : DEFAULT_WE_MISS_YOU_SETTINGS.inactiveDays,
      customMessage:
        typeof customMessage === "string" && customMessage.trim().length > 0
          ? customMessage.trim()
          : DEFAULT_WE_MISS_YOU_SETTINGS.customMessage,
      includeBookingLink:
        typeof includeBookingLink === "boolean"
          ? includeBookingLink
          : DEFAULT_WE_MISS_YOU_SETTINGS.includeBookingLink,
      autoSend:
        typeof autoSend === "boolean"
          ? autoSend
          : DEFAULT_WE_MISS_YOU_SETTINGS.autoSend,
    };

    // Merge into existing settingsJson
    const existingSettings =
      (salon.settingsJson as Record<string, unknown>) || {};
    const updatedSettings = {
      ...existingSettings,
      weMissYou: newWeMissYouSettings,
    };

    // Save to database
    const [_updated] = await db
      .update(salons)
      .set({ settingsJson: updatedSettings })
      .where(eq(salons.id, id))
      .returning();

    console.log(
      `[We Miss You Settings API] Updated we-miss-you settings for salon ${id}:`,
      newWeMissYouSettings
    );

    return NextResponse.json({
      success: true,
      data: newWeMissYouSettings,
      message: "Ustawienia re-engagement zostaly zapisane",
    });
  } catch (error) {
    console.error("[We Miss You Settings API] PUT Error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to update we-miss-you settings" },
      { status: 500 }
    );
  }
}
