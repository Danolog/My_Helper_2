import webpush from "web-push";

/**
 * Initialize web-push with VAPID details.
 * Must be called before sending any push notifications.
 */
function getWebPush() {
  const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
  const vapidSubject = process.env.VAPID_SUBJECT || "mailto:admin@myhelper.pl";

  if (!vapidPublicKey || !vapidPrivateKey) {
    console.warn("[WebPush] VAPID keys not configured. Push notifications disabled.");
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
): Promise<{ success: boolean; error?: string | undefined; statusCode?: number | undefined }> {
  const wp = getWebPush();
  if (!wp) {
    return { success: false, error: "VAPID keys not configured" };
  }

  try {
    const result = await wp.sendNotification(
      subscription,
      JSON.stringify(payload),
      {
        TTL: 86400, // 24 hours in seconds
        urgency: "high",
      }
    );

    console.log(`[WebPush] Notification sent to ${subscription.endpoint.slice(0, 50)}... Status: ${result.statusCode}`);
    return { success: true, statusCode: result.statusCode };
  } catch (error: unknown) {
    const err = error as { statusCode?: number; message?: string; body?: string };
    console.error(`[WebPush] Failed to send notification:`, err.message || error);

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
