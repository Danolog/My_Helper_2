/**
 * Ścieżki Better Auth, które licznik adresu w trybie `database` liczy w pamięci
 * procesu (`src/lib/server/system/auth-throttle.ts`). Zamknięta lista: każda inna
 * ścieżka, także nieznana, idzie do licznika w bazie.
 *
 * Pozycja `/x/*` obejmuje każdą ścieżkę zaczynającą się od `/x/` (z niepustą resztą);
 * pozostałe pozycje — dokładnie tę ścieżkę.
 */
export const MEMORY_COUNTED_PATHS: readonly string[] = Object.freeze([
  "/get-session",
  "/sign-out",
  "/list-sessions",
  "/callback/*",
  "/ok",
]);

export function isMemoryCountedPath(path: string): boolean {
  return MEMORY_COUNTED_PATHS.some((entry) => {
    if (!entry.endsWith("/*")) return path === entry;
    const prefix = entry.slice(0, -1);
    return path.startsWith(prefix) && path.length > prefix.length;
  });
}
