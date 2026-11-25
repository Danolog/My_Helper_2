import { NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/auth-middleware";
import { logger } from "@/lib/logger";
// #193: trasa systemowa (requireCronSecret, wszystkie konta) — wyjście z rejestru system/
import { cleanupExpiredAuthRecords } from "@/lib/server/system";

/**
 * POST /api/cron/cleanup-expired-auth
 *
 * Retention for Better Auth tables: deletes sessions and verification records
 * whose `expires_at` is already in the past. Better Auth rejects such rows
 * anyway, so this only removes dead data (IP address, user agent, one-time
 * tokens) that would otherwise stay in the database indefinitely.
 *
 * Active sessions (`expires_at` not in the past) are never touched, so running
 * this during the day does not sign anyone out.
 *
 * System path — the queries run in `system/auth-retention.ts` (#193).
 */
async function handleCleanup(request: Request) {
  try {
    const cronError = await requireCronSecret(request);
    if (cronError) return cronError;

    const { deletedSessions, deletedVerifications, complete } = await cleanupExpiredAuthRecords();

    return NextResponse.json({
      success: true,
      message: `Usunieto ${deletedSessions} wygaslych sesji i ${deletedVerifications} wygaslych rekordow weryfikacji`,
      deletedSessions,
      deletedVerifications,
      complete,
    });
  } catch (error) {
    logger.error("[Cron] Cleanup expired auth records error", { error });
    return NextResponse.json(
      { success: false, error: "Nie udalo sie usunac wygaslych sesji" },
      { status: 500 }
    );
  }
}

// GET for schedulers that call the path with GET (Authorization: Bearer CRON_SECRET);
// POST for external schedulers. Both go through requireCronSecret.
export async function GET(request: Request) {
  return handleCleanup(request);
}

export async function POST(request: Request) {
  return handleCleanup(request);
}
