import { eq } from "drizzle-orm";
import { logger } from "@/lib/logger";
import { salons } from "@/lib/schema";
import { forSalon } from "@/lib/server/repository";

export interface NotificationTypeSettings {
  smsReminders: boolean;
  pushReminders: boolean;
  birthdayNotifications: boolean;
  weMissYouNotifications: boolean;
  paymentConfirmations: boolean;
}

export const DEFAULT_NOTIFICATION_TYPE_SETTINGS: NotificationTypeSettings = {
  smsReminders: true,
  pushReminders: true,
  birthdayNotifications: true,
  weMissYouNotifications: true,
  paymentConfirmations: true,
};

/**
 * Get notification type settings for a salon from the database.
 * Returns defaults (all enabled) if no custom settings exist.
 */
export async function getNotificationTypeSettings(
  salonId: string
): Promise<NotificationTypeSettings> {
  try {
    // Odczyt przez bramę tego salonu (#193).
    const [salon] = await forSalon(salonId).raw((tx) =>
      tx
        .select({ settingsJson: salons.settingsJson })
        .from(salons)
        .where(eq(salons.id, salonId))
        .limit(1)
    );

    if (!salon) {
      return { ...DEFAULT_NOTIFICATION_TYPE_SETTINGS };
    }

    const settings = salon.settingsJson as Record<string, unknown> | null;
    return {
      ...DEFAULT_NOTIFICATION_TYPE_SETTINGS,
      ...((settings?.notificationTypes as Partial<NotificationTypeSettings>) || {}),
    };
  } catch (error) {
    logger.error("Error fetching notification settings", { salonId, error });
    // Return defaults on error - don't block notifications due to settings fetch failure
    return { ...DEFAULT_NOTIFICATION_TYPE_SETTINGS };
  }
}
