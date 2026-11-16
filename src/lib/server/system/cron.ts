/**
 * Wyjście systemowe (#193): zadania okresowe działające ponad salonami.
 * Każda nowa funkcja tutaj zmienia migawkę `system/` (R-Z1), więc jest
 * widoczna w diffie i w recenzji Ryana.
 */
import { lt } from "drizzle-orm";
import { logger } from "@/lib/logger";
import { temporaryAccess } from "@/lib/schema";
import { dbSystem } from "./db-system";

/**
 * Kasuje wszystkie wygasłe granty czasowego dostępu (wszystkie salony).
 * Wołane okresowo (cron) albo przy dostępie do API.
 *
 * @returns liczba skasowanych wpisów
 */
export async function cleanupExpiredTemporaryAccess(): Promise<number> {
  const now = new Date();

  const expired = await dbSystem
    .delete(temporaryAccess)
    .where(lt(temporaryAccess.expiresAt, now))
    .returning({ id: temporaryAccess.id });

  if (expired.length > 0) {
    logger.info("Cleaned up expired temporary access entries", { count: expired.length });
  }

  return expired.length;
}
