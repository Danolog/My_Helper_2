import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { salons } from "@/lib/schema";
import { eq } from "drizzle-orm";

export interface NotificationTypeSettings {
  smsReminders: boolean; // SMS appointment reminders (1h before)
  pushReminders: boolean; // Push appointment reminders (1h and 24h before)
  birthdayNotifications: boolean; // Birthday greetings
  weMissYouNotifications: boolean; // Re-engagement notifications
  paymentConfirmations: boolean; // Payment confirmation SMS
}

export const DEFAULT_NOTIFICATION_TYPE_SETTINGS: NotificationTypeSettings = {
  smsReminders: true,
  pushReminders: true,
  birthdayNotifications: true,
  weMissYouNotifications: true,
  paymentConfirmations: true,
};

/**
 * GET /api/salons/[id]/notification-type-settings
 *
 * Returns the notification type configuration for a salon.
 * Each notification type can be individually enabled/disabled.
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

    // Extract notification type settings from settingsJson, merge with defaults
    const settings = salon.settingsJson as Record<string, unknown> | null;
    const notificationTypeSettings: NotificationTypeSettings = {
      ...DEFAULT_NOTIFICATION_TYPE_SETTINGS,
      ...((settings?.notificationTypes as Partial<NotificationTypeSettings>) || {}),
    };

    return NextResponse.json({
      success: true,
      data: notificationTypeSettings,
    });
  } catch (error) {
    console.error("[Notification Type Settings API] GET Error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch notification type settings" },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/salons/[id]/notification-type-settings
 *
 * Updates the notification type configuration for a salon.
 * Saves into the salon's settingsJson field under the "notificationTypes" key.
 *
 * Body: Partial<NotificationTypeSettings>
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

    const {
      smsReminders,
      pushReminders,
      birthdayNotifications,
      weMissYouNotifications,
      paymentConfirmations,
    } = body;

    // Build validated settings - only override if explicitly set as boolean
    const newSettings: NotificationTypeSettings = {
      smsReminders:
        typeof smsReminders === "boolean"
          ? smsReminders
          : DEFAULT_NOTIFICATION_TYPE_SETTINGS.smsReminders,
      pushReminders:
        typeof pushReminders === "boolean"
          ? pushReminders
          : DEFAULT_NOTIFICATION_TYPE_SETTINGS.pushReminders,
      birthdayNotifications:
        typeof birthdayNotifications === "boolean"
          ? birthdayNotifications
          : DEFAULT_NOTIFICATION_TYPE_SETTINGS.birthdayNotifications,
      weMissYouNotifications:
        typeof weMissYouNotifications === "boolean"
          ? weMissYouNotifications
          : DEFAULT_NOTIFICATION_TYPE_SETTINGS.weMissYouNotifications,
      paymentConfirmations:
        typeof paymentConfirmations === "boolean"
          ? paymentConfirmations
          : DEFAULT_NOTIFICATION_TYPE_SETTINGS.paymentConfirmations,
    };

    // Merge into existing settingsJson
    const existingSettings = (salon.settingsJson as Record<string, unknown>) || {};
    const updatedSettings = {
      ...existingSettings,
      notificationTypes: newSettings,
    };

    // Save to database
    await db
      .update(salons)
      .set({ settingsJson: updatedSettings })
      .where(eq(salons.id, id));

    console.log(
      `[Notification Type Settings API] Updated notification type settings for salon ${id}:`,
      newSettings
    );

    return NextResponse.json({
      success: true,
      data: newSettings,
      message: "Ustawienia typow powiadomien zostaly zapisane",
    });
  } catch (error) {
    console.error("[Notification Type Settings API] PUT Error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to update notification type settings" },
      { status: 500 }
    );
  }
}
