import { NextResponse } from "next/server";
import { cleanupExpiredTemporaryAccess } from "@/lib/temporary-access";
import { requireCronSecret } from "@/lib/auth-middleware";

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
    const cronError = await requireCronSecret(request);
    if (cronError) return cronError;

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
