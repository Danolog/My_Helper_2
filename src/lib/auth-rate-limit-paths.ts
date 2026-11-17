/**
 * Zamknięte listy ścieżek licznika adresu w trybie `database`
 * (`src/lib/server/system/auth-throttle.ts`).
 */

/**
 * Trasy HTTP Better Auth w konfiguracji aplikacji (e-mail i hasło, weryfikacja
 * e-maila, logowanie Google); segment `:nazwa` to parametr trasy. Listę porównuje
 * z trasami prawdziwej instancji biblioteki test `__tests__/lib/auth-rate-limit-paths.test.ts`.
 */
export const COUNTER_KEY_PATHS: readonly string[] = Object.freeze([
  "/account-info",
  "/callback/:id",
  "/change-email",
  "/change-password",
  "/delete-user",
  "/delete-user/callback",
  "/error",
  "/get-access-token",
  "/get-session",
  "/link-social",
  "/list-accounts",
  "/list-sessions",
  "/ok",
  "/refresh-token",
  "/request-password-reset",
  "/reset-password",
  "/reset-password/:token",
  "/revoke-other-sessions",
  "/revoke-session",
  "/revoke-sessions",
  "/send-verification-email",
  "/sign-in/email",
  "/sign-in/social",
  "/sign-out",
  "/sign-up/email",
  "/unlink-account",
  "/update-session",
  "/update-user",
  "/verify-email",
  "/verify-password",
]);

/** Wspólny klucz ścieżek spoza listy tras (jeden licznik na adres). */
export const OTHER_PATHS_KEY = "other";

const COUNTER_KEY_ROUTES = COUNTER_KEY_PATHS.map((route) => ({ route, segments: route.split("/") }));

/**
 * Ścieżka do klucza licznika i do logu: trasa z listy → ta trasa (trasa z parametrem
 * w adresie → jej szablon, np. `/reset-password/:token`); każda inna ścieżka → `OTHER_PATHS_KEY`.
 * Parametr trasy pasuje do jednego niepustego segmentu.
 */
export function counterKeyPathOf(path: string): string {
  const segments = path.split("/");
  for (const { route, segments: pattern } of COUNTER_KEY_ROUTES) {
    if (pattern.length !== segments.length) continue;
    const matches = pattern.every((p, i) => (p.startsWith(":") ? segments[i] !== "" : p === segments[i]));
    if (matches) return route;
  }
  return OTHER_PATHS_KEY;
}

/**
 * Ścieżki Better Auth, które licznik adresu liczy w pamięci procesu. Zamknięta lista:
 * każda inna ścieżka, także nieznana, idzie do licznika w bazie.
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
