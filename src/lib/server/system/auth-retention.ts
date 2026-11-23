/**
 * Wyjście systemowe (#193): retencja tabel Better Auth — kasuje wygasłe sesje
 * (`session`) i wygasłe rekordy weryfikacji (`verification`) wszystkich kont.
 * Cron z sekretem, bez sesji użytkownika, więc pula systemowa, nie `forSalon`.
 *
 * Reguła: wiersz jest usuwany, gdy `expires_at < chwila przebiegu` (ostro).
 * Wiersz z `expires_at` równym tej chwili zostaje — Better Auth uznaje sesję za
 * wygasłą tak samo, warunkiem `expiresAt < new Date()`, więc sesja, którą Better
 * Auth jeszcze wpuszcza, nigdy nie jest kasowana. Odświeżanie sesji
 * (`updateAge: 0`) przesuwa `expires_at` tylko sesjom jeszcze ważnym; wygasłej
 * Better Auth nie odświeża, tylko ją odrzuca (i sam kasuje przy odczycie).
 *
 * Zegar: chwila przebiegu z zegara aplikacji (`new Date()`), jak w Better Auth,
 * który tym zegarem ustawia i sprawdza `expiresAt`. Kolumny to `timestamp` bez
 * strefy z wartościami w UTC; parametr przechodzi przez mapowanie kolumny
 * Drizzle (UTC), więc wynik nie zależy od ustawienia `TimeZone` sesji bazy
 * (inaczej niż porównanie z `now()`).
 *
 * Kasowanie partiami po `DELETE_BATCH_SIZE` wierszy, każda partia we własnej
 * krótkiej transakcji, z limitem partii na przebieg. Wiersze zablokowane przez
 * równoległe żądanie (np. wylogowanie) są pomijane (`SKIP LOCKED`) i wpadną do
 * następnego przebiegu. `lock_timeout` zamyka czekanie na blokadę tabeli
 * (np. migrację) w kilka sekund zamiast do limitu czasu funkcji.
 *
 * Log zawiera wyłącznie liczniki — bez tokenów, identyfikatorów i e-maili.
 */
import { inArray, lt, sql } from "drizzle-orm";
import { logger } from "@/lib/logger";
import { session, verification } from "@/lib/schema";
import { dbSystem } from "./db-system";

const DELETE_BATCH_SIZE = 1000;
/** Górna granica jednego przebiegu: 50 partii × 1000 = 50 000 wierszy na tabelę. */
const MAX_BATCHES_PER_TABLE = 50;
const LOCK_TIMEOUT = "5s";

export type ExpiredAuthCleanupResult = {
  /** Usunięte wygasłe sesje (RETURNING). */
  deletedSessions: number;
  /** Usunięte wygasłe rekordy weryfikacji (RETURNING). */
  deletedVerifications: number;
  /**
   * `false`, gdy któraś tabela doszła do limitu partii: wygasłe wiersze mogły
   * zostać i dokończy je następny przebieg.
   */
  complete: boolean;
};

type DrainResult = { deleted: number; complete: boolean };

async function deleteExpiredSessionsBatch(cutoff: Date): Promise<number> {
  return dbSystem.transaction(async (tx) => {
    await tx.execute(sql.raw(`set local lock_timeout = '${LOCK_TIMEOUT}'`));
    const rows = await tx
      .delete(session)
      .where(
        inArray(
          session.id,
          tx
            .select({ id: session.id })
            .from(session)
            .where(lt(session.expiresAt, cutoff))
            .limit(DELETE_BATCH_SIZE)
            .for("update", { skipLocked: true })
        )
      )
      .returning({ id: session.id });
    return rows.length;
  });
}

async function deleteExpiredVerificationsBatch(cutoff: Date): Promise<number> {
  return dbSystem.transaction(async (tx) => {
    await tx.execute(sql.raw(`set local lock_timeout = '${LOCK_TIMEOUT}'`));
    const rows = await tx
      .delete(verification)
      .where(
        inArray(
          verification.id,
          tx
            .select({ id: verification.id })
            .from(verification)
            .where(lt(verification.expiresAt, cutoff))
            .limit(DELETE_BATCH_SIZE)
            .for("update", { skipLocked: true })
        )
      )
      .returning({ id: verification.id });
    return rows.length;
  });
}

/**
 * Powtarza partię, aż wróci niepełna (nic więcej do skasowania albo reszta
 * zablokowana) albo skończy się limit partii.
 */
async function drain(deleteBatch: (cutoff: Date) => Promise<number>, cutoff: Date): Promise<DrainResult> {
  let deleted = 0;
  for (let batch = 0; batch < MAX_BATCHES_PER_TABLE; batch += 1) {
    const count = await deleteBatch(cutoff);
    deleted += count;
    if (count < DELETE_BATCH_SIZE) return { deleted, complete: true };
  }
  return { deleted, complete: false };
}

/**
 * Kasuje wygasłe sesje i rekordy weryfikacji (wszystkie konta). Jedna chwila
 * odcięcia na cały przebieg. Idempotentne: drugi przebieg bez nowych wygasłych
 * wierszy zwraca zera.
 */
export async function cleanupExpiredAuthRecords(): Promise<ExpiredAuthCleanupResult> {
  const cutoff = new Date();

  const sessions = await drain(deleteExpiredSessionsBatch, cutoff);
  const verifications = await drain(deleteExpiredVerificationsBatch, cutoff);

  const result: ExpiredAuthCleanupResult = {
    deletedSessions: sessions.deleted,
    deletedVerifications: verifications.deleted,
    complete: sessions.complete && verifications.complete,
  };

  if (result.deletedSessions > 0 || result.deletedVerifications > 0 || !result.complete) {
    logger.info("[Cron] Deleted expired auth records", result);
  }

  return result;
}
