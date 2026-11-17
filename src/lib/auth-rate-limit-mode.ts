/**
 * Przełącznik magazynu limitu prób logowania: zmienna `AUTH_RATE_LIMIT_STORE`.
 *
 * - brak zmiennej → `memory` (konfiguracja biblioteki bez zmian),
 * - dokładnie `memory` albo `database`,
 * - każda inna wartość (także pusty napis, inna wielkość liter, spacje) → błąd
 *   przy starcie modułu auth. Nigdy cichy powrót do trybu domyślnego: literówka
 *   w konfiguracji ma zatrzymać start, a nie wyłączyć magazyn w bazie.
 *
 * Czysta funkcja — środowisko podaje wołający.
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
