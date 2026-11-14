import { and, eq, gt, lt } from "drizzle-orm";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { salons, temporaryAccess } from "@/lib/schema";

/**
 * Czy użytkownik ma aktywny (niewygasły) czasowy dostęp do funkcji W DANYM SALONIE?
 *
 * Grant jest uznawany tylko, gdy nadał go właściciel salonu z kontekstu sesji
 * (temporary_access.granted_by = salons.owner_id AND salons.id = salonId).
 * Bez tego grant nadany w salonie A otwierał funkcję w salonie B, jeśli konto
 * pracuje (lub zostało przepięte) do innego salonu.
 *
 * Tabela nie ma kolumny salon_id — zawężenie po granted_by to rozwiązanie
 * przejściowe; docelowo kolumna salon_id (migracja, osobne zadanie).
 *
 * @param userId - konto, dla którego sprawdzamy grant
 * @param featureName - nazwa funkcji
 * @param salonId - salon z kontekstu sesji (NIGDY z żądania)
 */
export async function hasTemporaryAccess(
  userId: string,
  featureName: string,
  salonId: string
): Promise<boolean> {
  const now = new Date();

  const [grant] = await db
    .select({ id: temporaryAccess.id })
    .from(temporaryAccess)
    .innerJoin(salons, eq(salons.ownerId, temporaryAccess.grantedBy))
    .where(
      and(
        eq(temporaryAccess.userId, userId),
        eq(temporaryAccess.featureName, featureName),
        eq(salons.id, salonId),
        gt(temporaryAccess.expiresAt, now)
      )
    )
    .limit(1);

  return !!grant;
}

/**
 * Aktywne granty użytkownika nadane przez właściciela salonu `salonId`
 * (to samo zawężenie co hasTemporaryAccess).
 *
 * @param userId - konto, dla którego listujemy granty
 * @param salonId - salon z kontekstu sesji
 */
export async function getActiveTemporaryAccess(userId: string, salonId: string) {
  const now = new Date();

  return db
    .select({
      id: temporaryAccess.id,
      userId: temporaryAccess.userId,
      featureName: temporaryAccess.featureName,
      grantedBy: temporaryAccess.grantedBy,
      expiresAt: temporaryAccess.expiresAt,
      createdAt: temporaryAccess.createdAt,
    })
    .from(temporaryAccess)
    .innerJoin(salons, eq(salons.ownerId, temporaryAccess.grantedBy))
    .where(
      and(
        eq(temporaryAccess.userId, userId),
        eq(salons.id, salonId),
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
    logger.info("Cleaned up expired temporary access entries", { count: expired.length });
  }

  return expired.length;
}
