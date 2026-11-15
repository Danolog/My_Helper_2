/**
 * Numery testowe (E2E, seed, ręczne testy). SMS na nie nigdy nie wychodzi —
 * `sendSms` blokuje je przed dostawcą, także z ustawionym SMSAPI_TOKEN.
 *
 * +48 000 … — numer krajowy zaczynający się od 0 nie jest przydzielany
 * abonentom w PL, więc nawet bez blokady nie trafi do realnej osoby
 * (potwierdzenie: Ryan, review PR cleanup E2E).
 *
 * Czysty moduł bez zależności serwerowych — importują go testy Playwright.
 */

// Ścieżka względna (nie "@/"), żeby moduł ładował się też w Playwright.
import { normalizePolishPhoneNumber } from "./phone";

/** Numer do wpisywania w formularzach E2E (format jak z UI). */
export const TEST_PHONE = "+48 000 600 700";

/**
 * Lista numerów testowych w E.164. Blokada SMS działa dla każdego z nich.
 * Każdy telefon w seedach (`scripts/seed-test.ts`, `src/app/api/seed/route.ts`)
 * i w testach E2E (`tests/`) musi być na tej liście — pilnuje tego
 * `__tests__/lib/test-phone-literals.test.ts` (#75).
 *
 *   700 — formularze E2E (TEST_PHONE)
 *   701, 702 — klientki seeda (Maria, Joanna); 703 — trzecia klientka seeda API
 *   704 — telefon salonu w seedach; 705 — pracownik dodawany w E2E
 */
export const TEST_PHONE_NUMBERS: readonly string[] = Object.freeze([
  "+48000600700",
  "+48000600701",
  "+48000600702",
  "+48000600703",
  "+48000600704",
  "+48000600705",
]);

/** Czy numer (w dowolnym formacie akceptowanym przez normalizację) jest testowy. */
export function isTestPhoneNumber(raw: string | null | undefined): boolean {
  if (!raw) return false;
  const normalized = normalizePolishPhoneNumber(raw);
  return normalized !== null && TEST_PHONE_NUMBERS.includes(normalized);
}
