import { NextResponse } from "next/server";
import { cleanupExpiredTemporaryAccess } from "@/lib/temporary-access";

/**
 * POST /api/cron/cleanup-temporary-access
 *
 * Triggered periodically (e.g., every hour by a cron job or Vercel cron).
 * Removes expired temporary access entries from the database.
 *
 * This ensures that temporary access is properly revoked when it expires.
 * The hasTemporaryAccess() utility also checks expiration in real-time,
 * so this cron is a cleanup mechanism rather than the primary enforcement.
 */
export async function POST(request: Request) {
  try {
    // Optional: verify cron secret for production security
    const { searchParams } = new URL(request.url);
    const cronSecret = searchParams.get("secret");
    const expectedSecret = process.env.CRON_SECRET;

    // In production, verify the cron secret. In dev, allow without secret.
    if (expectedSecret && cronSecret !== expectedSecret) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const removedCount = await cleanupExpiredTemporaryAccess();

    return NextResponse.json({
      success: true,
      message: `Cleaned up ${removedCount} expired temporary access entries`,
      removedCount,
    });
  } catch (error) {
    console.error("[Cron] Cleanup temporary access error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to clean up temporary access" },
      { status: 500 }
    );
  }
}
