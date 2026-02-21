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
    // Verify cron secret via Authorization header (Bearer token)
    const authHeader = request.headers.get("authorization");
    const expectedSecret = process.env.CRON_SECRET;

    // In production, verify the cron secret. In dev, allow without secret.
    if (expectedSecret && authHeader !== `Bearer ${expectedSecret}`) {
      return NextResponse.json(
        { success: false, error: "Brak autoryzacji" },
        { status: 401 }
      );
    }

    const removedCount = await cleanupExpiredTemporaryAccess();

    return NextResponse.json({
      success: true,
      message: `Wyczyszczono ${removedCount} wygaslych uprawnien tymczasowych`,
      removedCount,
    });
  } catch (error) {
    console.error("[Cron] Cleanup temporary access error:", error);
    return NextResponse.json(
      { success: false, error: "Nie udało się wyczyścić uprawnień tymczasowych" },
      { status: 500 }
    );
  }
}
