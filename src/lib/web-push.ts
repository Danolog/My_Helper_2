import webpush from "web-push";
import { logger } from "@/lib/logger";
import {
  PUSH_SEND_TIMEOUT_MS,
  isValidPushSubscription,
  withPushDeadline,
} from "@/lib/push-subscription";

/**
 * Initialize web-push with VAPID details.
 * Must be called before sending any push notifications.
 */
function getWebPush() {
  const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
  const vapidSubject = process.env.VAPID_SUBJECT || "mailto:admin@myhelper.pl";

  if (!vapidPublicKey || !vapidPrivateKey) {
    logger.warn("VAPID keys not configured, push notifications disabled");
    return null;
  }

  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
  return webpush;
}

/**
 * Check if push notifications are configured.
 */
export function isPushConfigured(): boolean {
  return !!(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

/**
 * Send a push notification to a specific subscription.
 *
 * Subskrypcja spoza allowlisty usług push (lib/push-subscription.ts) nie
 * dostaje żądania: wynik `invalidSubscription: true` — wywołujący powinien
 * usunąć ją z bazy, tak jak przy 404/410.
 */
export async function sendPushNotification(
  subscription: {
    endpoint: string;
    keys: {
      p256dh: string;
      auth: string;
    };
  },
  payload: {
    title: string;
    body: string;
    icon?: string;
    badge?: string;
    tag?: string;
    data?: Record<string, unknown>;
  }
): Promise<{
  success: boolean;
  error?: string | undefined;
  statusCode?: number | undefined;
  invalidSubscription?: boolean | undefined;
}> {
  if (
    !isValidPushSubscription({
      endpoint: subscription?.endpoint,
      p256dh: subscription?.keys?.p256dh,
      auth: subscription?.keys?.auth,
    })
  ) {
    logger.warn("Skipping web push to invalid subscription endpoint or keys");
    return { success: false, error: "Invalid push subscription", invalidSubscription: true };
  }

  const wp = getWebPush();
  if (!wp) {
    return { success: false, error: "VAPID keys not configured" };
  }

  try {
    const result = await withPushDeadline(
      wp.sendNotification(subscription, JSON.stringify(payload), {
        TTL: 86400, // 24 hours in seconds
        urgency: "high",
        timeout: PUSH_SEND_TIMEOUT_MS,
      })
    );

    logger.info("Web push notification sent", { endpoint: subscription.endpoint.slice(0, 50), statusCode: result.statusCode });
    return { success: true, statusCode: result.statusCode };
  } catch (error: unknown) {
    const err = error as { statusCode?: number; message?: string; body?: string };
    logger.error("Failed to send web push notification", { error: err.message || error, statusCode: err.statusCode });

    // If the subscription is expired or invalid (410 Gone or 404 Not Found),
    // the caller should remove it from the database
    if (err.statusCode === 410 || err.statusCode === 404) {
      return {
        success: false,
        error: "Subscription expired or invalid",
        statusCode: err.statusCode,
      };
    }

    return {
      success: false,
      error: err.message || "Unknown error",
      ...(err.statusCode != null ? { statusCode: err.statusCode } : {}),
    };
  }
}
