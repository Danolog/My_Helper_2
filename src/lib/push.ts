import webpush from "web-push";
import { db } from "@/lib/db";
import { notifications, pushSubscriptions } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { logger } from "@/lib/logger";

// Configure web-push with VAPID details
const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "";
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY || "";
const vapidSubject = process.env.VAPID_SUBJECT || "mailto:admin@myhelper.pl";

if (vapidPublicKey && vapidPrivateKey) {
  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
}

export interface PushMessage {
  title: string;
  body: string;
  icon?: string | undefined;
  badge?: string | undefined;
  tag?: string | undefined;
  data?: Record<string, unknown> | undefined;
  salonId: string;
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
 * Send a push notification to all devices registered by a specific user.
 *
 * In development mode, push notifications are logged to the console.
 * The notification is always saved to the notifications table for audit trail.
 */
export async function sendPushNotification(
  userId: string,
  msg: PushMessage
): Promise<PushResult> {
  try {
    // Get all push subscriptions for this user
    const subs = await db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, userId));

    if (subs.length === 0) {
      logger.debug("No push subscriptions found for user", { userId });
      return { success: false, sent: 0, failed: 0, error: "No subscriptions" };
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

    for (const sub of subs) {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: {
              p256dh: sub.p256dh,
              auth: sub.auth,
            },
          },
          payload
        );
        sent++;
      } catch (err: unknown) {
        failed++;
        const statusCode = (err as { statusCode?: number })?.statusCode;
        logger.error("Push delivery failed for endpoint", {
          endpoint: sub.endpoint.slice(0, 50),
          statusCode: statusCode || "unknown",
        });

        // If subscription is expired/invalid (410 Gone or 404), remove it
        if (statusCode === 410 || statusCode === 404) {
          logger.info("Removing expired push subscription", { subscriptionId: sub.id });
          await db
            .delete(pushSubscriptions)
            .where(eq(pushSubscriptions.id, sub.id));
        }
      }
    }

    // Save notification to database
    const [notification] = await db
      .insert(notifications)
      .values({
        salonId: msg.salonId,
        clientId: msg.clientId || null,
        type: "push",
        message: `${msg.title}: ${msg.body}`,
        status: sent > 0 ? "sent" : "failed",
        sentAt: new Date(),
      })
      .returning();

    const notifId = notification?.id;
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
    try {
      await db.insert(notifications).values({
        salonId: msg.salonId,
        clientId: msg.clientId || null,
        type: "push",
        message: `${msg.title}: ${msg.body}`,
        status: "failed",
      });
    } catch {
      // Ignore save failure
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
