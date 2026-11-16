/**
 * Czasowy dostęp do funkcji (temporary_access).
 *
 * Zapytania żyją w wyjściach systemowych (#193): granty sprawdzane przy
 * ustalaniu kontekstu salonu — `system/session.ts`; sprzątanie wygasłych —
 * `system/cron.ts`. Ten moduł zachowuje dotychczasową ścieżkę importu dla tras.
 */
export {
  getActiveTemporaryAccess,
  hasTemporaryAccess,
  revokeSalonGrantsForUser,
  cleanupExpiredTemporaryAccess,
} from "@/lib/server/system";
