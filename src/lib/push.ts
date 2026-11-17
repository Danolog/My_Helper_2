import webpush from "web-push";
import { isModuleFrozen } from "@/lib/features";
import { logger } from "@/lib/logger";
import {
  PUSH_SEND_CONCURRENCY,
  PUSH_SEND_TIMEOUT_MS,
  isValidPushSubscription,
  runWithConcurrency,
  withPushDeadline,
} from "@/lib/push-subscription";
import { notifications } from "@/lib/schema";
import { forSalon } from "@/lib/server/repository";
import { deleteUndeliverablePushSubscriptions, getPushSubscriptionsForUser } from "@/lib/server/system";

// Configure web-push with VAPID details
const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "";
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY || "";
const vapidSubject = process.env.VAPID_SUBJECT || "mailto:admin@myhelper.pl";

if (vapidPublicKey && vapidPrivateKey) {
  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
}

/** PushResult.error, gdy użytkownik nie ma żadnej subskrypcji. */
export const NO_SUBSCRIPTIONS_ERROR = "No subscriptions";

export interface PushMessage {
  title: string;
  body: string;
  icon?: string | undefined;
  badge?: string | undefined;
  tag?: string | undefined;
  data?: Record<string, unknown> | undefined;
  /**
   * Salon rekordu `notifications`. `null` = bez rekordu (np. test push z konta
   * bez salonu) — salonu nie zgadujemy.
   */
  salonId: string | null;
  clientId?: string | null | undefined;
}

export interface PushResult {
  success: boolean;
  sent: number;
  failed: number;
  notificationId?: string | undefined;
  error?: string | undefined;
}

/**
 * Kasuje niedostarczalne subskrypcje użytkownika (#193 P5a-1). Błąd kasowania
 * jest logowany (tylko id subskrypcji) i NIE przerywa wysyłki.
 */
async function removeUndeliverable(userId: string, subscriptionIds: string[], reason: string): Promise<void> {
  if (subscriptionIds.length === 0) return;
  try {
    await deleteUndeliverablePushSubscriptions(userId, subscriptionIds);
  } catch (err) {
    logger.error("Failed to remove undeliverable push subscriptions", {
      subscriptionIds,
      reason,
      error: err,
    });
  }
}

/** Zapis notyfikacji przez bramę salonu wiadomości (#193). */
async function saveNotification(
  msg: PushMessage & { salonId: string },
  status: "sent" | "failed",
  sentAt?: Date
): Promise<string | undefined> {
  const [notification] = await forSalon(msg.salonId).raw((tx) =>
    tx
      .insert(notifications)
      .values({
        salonId: msg.salonId,
        clientId: msg.clientId || null,
        type: "push",
        message: `${msg.title}: ${msg.body}`,
        status,
        ...(sentAt ? { sentAt } : {}),
      })
      .returning()
  );
  return notification?.id;
}

/**
 * Send a push notification to all devices registered by a specific user.
 *
 * In development mode, push notifications are logged to the console.
 * The notification is saved to the notifications table for audit trail
 * (only when msg.salonId is set).
 *
 * #193 P5a-1: subskrypcje przez wyjścia rejestru systemowego (należą do
 * użytkownika, nie do salonu), zapis notyfikacji przez `forSalon(salonId)`.
 */
export async function sendPushNotification(
  userId: string,
  msg: PushMessage
): Promise<PushResult> {
  // Push to modul z rejestru (src/lib/features.ts). Zamrozony: nic nie
  // wysylamy — sprawdzenie u zrodla, wiec obejmuje kazdego wywolujacego
  // (lista oczekujacych, przypomnienia, trasy push), takze przyszlego.
  if (isModuleFrozen("pushNotifications")) {
    return { success: false, sent: 0, failed: 0, error: "Push notifications are disabled" };
  }

  try {
    // Get all push subscriptions for this user
    const subs = await getPushSubscriptionsForUser(userId);

    if (subs.length === 0) {
      logger.debug("No push subscriptions found for user", { userId });
      return { success: false, sent: 0, failed: 0, error: NO_SUBSCRIPTIONS_ERROR };
    }

    const payload = JSON.stringify({
      title: msg.title,
      body: msg.body,
      icon: msg.icon || "/icon-192.png",
      badge: msg.badge || "/icon-192.png",
      tag: msg.tag || "myhelper-notification",
      data: msg.data || {},
    });

    logger.info("Sending push notification", {
      userId,
      title: msg.title,
      devices: subs.length,
    });

    let sent = 0;
    let failed = 0;

    // Obrona w głębi: wiersze zapisane przed allowlistą (lub z obejściem
    // walidacji) nie dostają żądania. Usuwamy je jak wygasłe (410) — do usługi
    // push spoza allowlisty i tak nie dostarczymy.
    const deliverable: typeof subs = [];
    const invalidIds: string[] = [];
    for (const sub of subs) {
      if (isValidPushSubscription(sub)) {
        deliverable.push(sub);
        continue;
      }
      failed++;
      logger.warn("Removing push subscription with invalid endpoint or keys", {
        subscriptionId: sub.id,
      });
      invalidIds.push(sub.id);
    }
    await removeUndeliverable(userId, invalidIds, "invalid");

    const expiredIds: string[] = [];

    // Równolegle z limitem i twardym terminem na każdą wysyłkę: jeden wiszący
    // endpoint nie blokuje pozostałych ani crona push-reminders*.
    await runWithConcurrency(deliverable, PUSH_SEND_CONCURRENCY, async (sub) => {
      try {
        await withPushDeadline(
          webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: {
                p256dh: sub.p256dh,
                auth: sub.auth,
              },
            },
            payload,
            { timeout: PUSH_SEND_TIMEOUT_MS }
          )
        );
        sent++;
      } catch (err: unknown) {
        failed++;
        const statusCode = (err as { statusCode?: number })?.statusCode;
        logger.error("Push delivery failed for endpoint", {
          subscriptionId: sub.id,
          statusCode: statusCode || "unknown",
        });

        // If subscription is expired/invalid (410 Gone or 404), remove it
        if (statusCode === 410 || statusCode === 404) {
          logger.info("Removing expired push subscription", { subscriptionId: sub.id });
          expiredIds.push(sub.id);
        }
      }
    });
    await removeUndeliverable(userId, expiredIds, "expired");

    if (!msg.salonId) {
      return { success: sent > 0, sent, failed };
    }

    // Save notification to database
    const notifId = await saveNotification(
      { ...msg, salonId: msg.salonId },
      sent > 0 ? "sent" : "failed",
      new Date()
    );
    logger.info("Push notification saved", { notificationId: notifId, sent, failed });

    return {
      success: sent > 0,
      sent,
      failed,
      ...(notifId ? { notificationId: notifId } : {}),
    };
  } catch (error) {
    logger.error("Failed to send push notification", { error });

    // Try to save notification with failed status
    if (msg.salonId) {
      try {
        await saveNotification({ ...msg, salonId: msg.salonId }, "failed");
      } catch {
        // Ignore save failure
      }
    }

    return {
      success: false,
      sent: 0,
      failed: 0,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Send an appointment reminder push notification 1 hour before the appointment.
 */
export async function sendAppointmentReminderPush(params: {
  userId: string;
  clientName: string;
  serviceName: string;
  employeeName: string;
  appointmentDate: Date;
  salonName: string;
  salonId: string;
  clientId?: string | undefined;
  appointmentId?: string | undefined;
}): Promise<PushResult> {
  const formattedTime = params.appointmentDate.toLocaleTimeString("pl-PL", {
    hour: "2-digit",
    minute: "2-digit",
  });

  return sendPushNotification(params.userId, {
    title: `Przypomnienie o wizycie`,
    body: `${params.clientName}, za godzine masz wizyte "${params.serviceName}" u ${params.employeeName} w ${params.salonName} o ${formattedTime}. Do zobaczenia!`,
    tag: `appointment-reminder-${params.appointmentId || "unknown"}`,
    data: {
      type: "appointment_reminder",
      appointmentId: params.appointmentId,
      url: params.appointmentId ? `/appointments/${params.appointmentId}` : "/appointments",
      bookingUrl: `/salons/${params.salonId}/book`,
    },
    salonId: params.salonId,
    clientId: params.clientId ?? null,
  });
}

/**
 * Send an appointment reminder push notification 24 hours before the appointment.
 */
export async function sendAppointmentReminder24hPush(params: {
  userId: string;
  clientName: string;
  serviceName: string;
  employeeName: string;
  appointmentDate: Date;
  salonName: string;
  salonId: string;
  clientId?: string | undefined;
  appointmentId?: string | undefined;
}): Promise<PushResult> {
  const formattedDate = params.appointmentDate.toLocaleDateString("pl-PL", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const formattedTime = params.appointmentDate.toLocaleTimeString("pl-PL", {
    hour: "2-digit",
    minute: "2-digit",
  });

  return sendPushNotification(params.userId, {
    title: `Przypomnienie: wizyta jutro`,
    body: `${params.clientName}, jutro masz wizyte "${params.serviceName}" u ${params.employeeName} w ${params.salonName} - ${formattedDate} o ${formattedTime}. Do zobaczenia!`,
    tag: `appointment-reminder-24h-${params.appointmentId || "unknown"}`,
    data: {
      type: "appointment_reminder_24h",
      appointmentId: params.appointmentId,
      url: params.appointmentId ? `/appointments/${params.appointmentId}` : "/appointments",
      bookingUrl: `/salons/${params.salonId}/book`,
    },
    salonId: params.salonId,
    clientId: params.clientId ?? null,
  });
}
