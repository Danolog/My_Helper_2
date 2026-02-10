import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { sendPushNotification } from "@/lib/push";

/**
 * POST /api/push/test
 *
 * Send a test push notification to the authenticated user.
 * Used for verifying push notification setup.
 */
export async function POST() {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

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

    const result = await sendPushNotification(session.user.id, {
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
    console.error("[Push Test] Error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to send test push" },
      { status: 500 }
    );
  }
}
