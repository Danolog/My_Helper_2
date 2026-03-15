import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";
import { sendPushNotification } from "@/lib/push";
import { strictRateLimit, getClientIp } from "@/lib/rate-limit";

import { logger } from "@/lib/logger";
/**
 * POST /api/push/test
 *
 * Send a test push notification to the authenticated user.
 * Used for verifying push notification setup.
 */
export async function POST(request: Request) {
  // Rate limit: push notification testing is a sensitive operation
  const ip = getClientIp(request);
  const rateLimitResult = strictRateLimit.check(ip);
  if (!rateLimitResult.success) {
    return NextResponse.json(
      { success: false, error: "Zbyt wiele żądań. Spróbuj ponownie później." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rateLimitResult.reset / 1000)) } }
    );
  }

  const authResult = await requireAuth();
  if (isAuthError(authResult)) return authResult;
  const { user } = authResult;

  try {
    // We need a salonId for the notification record.
    // For test notifications, use a placeholder or find the user's salon.
    const { db } = await import("@/lib/db");
    const { salons } = await import("@/lib/schema");
    const allSalons = await db.select({ id: salons.id }).from(salons).limit(1);
    const salonId = allSalons[0]?.id;

    if (!salonId) {
      return NextResponse.json(
        { success: false, error: "No salon found for notification record" },
        { status: 400 }
      );
    }

    const result = await sendPushNotification(user.id, {
      title: "Test powiadomienia push",
      body: "To jest testowe powiadomienie push z MyHelper. Dzialasz! 🎉",
      tag: "test-notification",
      data: { type: "test", url: "/dashboard/notifications" },
      salonId,
    });

    return NextResponse.json({
      success: result.success,
      data: result,
    });
  } catch (error) {
    logger.error("[Push Test] Error", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to send test push" },
      { status: 500 }
    );
  }
}
