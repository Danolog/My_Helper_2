import { and, eq, gt, lt } from "drizzle-orm";

import { db } from "@/lib/db";
import { temporaryAccess } from "@/lib/schema";

/**
 * Check if a user has active (non-expired) temporary access to a specific feature.
 *
 * This function is the enforcement point for temporary access expiration (Feature #25).
 * It only returns true if the grant exists AND has not expired. Expired grants are
 * automatically cleaned up on API calls, but this function also performs a real-time
 * check against the current timestamp.
 *
 * @param userId - The user ID to check
 * @param featureName - The feature name to check access for
 * @returns true if the user has active temporary access, false otherwise
 */
export async function hasTemporaryAccess(
  userId: string,
  featureName: string
): Promise<boolean> {
  const now = new Date();

  const [grant] = await db
    .select({ id: temporaryAccess.id })
    .from(temporaryAccess)
    .where(
      and(
        eq(temporaryAccess.userId, userId),
        eq(temporaryAccess.featureName, featureName),
        gt(temporaryAccess.expiresAt, now)
      )
    )
    .limit(1);

  return !!grant;
}

/**
 * Get all active temporary access grants for a user.
 * Only returns grants that have not expired.
 *
 * @param userId - The user ID to check
 * @returns Array of active temporary access grants
 */
export async function getActiveTemporaryAccess(userId: string) {
  const now = new Date();

  return db
    .select()
    .from(temporaryAccess)
    .where(
      and(
        eq(temporaryAccess.userId, userId),
        gt(temporaryAccess.expiresAt, now)
      )
    );
}

/**
 * Clean up all expired temporary access entries from the database.
 * Should be called periodically (e.g., via cron) or on API access.
 *
 * @returns Number of expired entries removed
 */
export async function cleanupExpiredTemporaryAccess(): Promise<number> {
  const now = new Date();

  const expired = await db
    .delete(temporaryAccess)
    .where(lt(temporaryAccess.expiresAt, now))
    .returning({ id: temporaryAccess.id });

  if (expired.length > 0) {
    console.warn(
      `[Temporary Access Cleanup] Removed ${expired.length} expired entries`
    );
  }

  return expired.length;
}
