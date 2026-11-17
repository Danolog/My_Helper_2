/**
 * Przełącznik magazynu limitu prób logowania: zmienna `AUTH_RATE_LIMIT_STORE`.
 *
 * - brak zmiennej → `memory` (konfiguracja biblioteki bez zmian),
 * - dokładnie `memory` albo `database`,
 * - każda inna wartość (także pusty napis, inna wielkość liter, spacje) → błąd.
 *   Nigdy cichy powrót do trybu domyślnego: literówka w konfiguracji ma
 *   zatrzymać start, a nie wyłączyć magazyn w bazie.
 *
 * Start serwera sprawdza konfigurację w `register()` (src/instrumentation.ts)
 * przez `enforceAuthRateLimitStore` — błąd kończy proces, zanim serwer obsłuży
 * pierwsze żądanie. Ładowanie modułu auth zgłasza ten sam błąd niezależnie.
 *
 * Czyste funkcje — środowisko, wyjście i log podaje wołający.
 */
export type AuthRateLimitStore = "memory" | "database";

const ALLOWED: readonly AuthRateLimitStore[] = ["memory", "database"];

export function getAuthRateLimitStore(env: Readonly<Record<string, string | undefined>>): AuthRateLimitStore {
  const value = env.AUTH_RATE_LIMIT_STORE;
  if (value === undefined) return "memory";
  if ((ALLOWED as readonly string[]).includes(value)) return value as AuthRateLimitStore;
  // Bez podanej wartości w komunikacie — zmienne środowiska bywają wrażliwe.
  throw new Error(`AUTH_RATE_LIMIT_STORE: niedozwolona wartość; dozwolone: ${ALLOWED.join(", ")} albo brak zmiennej`);
}

export const AUTH_RATE_LIMIT_SECRET_MESSAGE = "AUTH_RATE_LIMIT_STORE=database wymaga BETTER_AUTH_SECRET";

export const AUTH_RATE_LIMIT_ACTIVE_MESSAGE = "Limit prób logowania: aktywny tryb magazynu";

/**
 * Sprawdzenie konfiguracji limitu logowania przy starcie serwera. Ten sam
 * warunek co fabryka opcji: wartość przełącznika dozwolona, a tryb `database`
 * wymaga niepustego `BETTER_AUTH_SECRET`. Błąd → `logError` (bez wartości
 * zmiennych) i `exit(1)`, bez wpisu informacyjnego. Sukces → dokładnie jeden
 * `logInfo` z kontekstem zawierającym wyłącznie nazwę aktywnego trybu.
 * @returns true, jeśli start dozwolony
 */
export function enforceAuthRateLimitStore(
  env: Readonly<Record<string, string | undefined>>,
  exit: (code: number) => void,
  logError: (message: string, context: { variable: string }) => void,
  logInfo: (message: string, context: { store: AuthRateLimitStore }) => void,
): boolean {
  let message: string;
  let variable: string;
  try {
    const store = getAuthRateLimitStore(env);
    if (store !== "database" || env.BETTER_AUTH_SECRET) {
      logInfo(AUTH_RATE_LIMIT_ACTIVE_MESSAGE, { store });
      return true;
    }
    message = AUTH_RATE_LIMIT_SECRET_MESSAGE;
    variable = "BETTER_AUTH_SECRET";
  } catch (e) {
    message = e instanceof Error ? e.message : "AUTH_RATE_LIMIT_STORE: niedozwolona wartość";
    variable = "AUTH_RATE_LIMIT_STORE";
  }
  logError(message, { variable });
  exit(1);
  return false;
}
