/**
 * Zgoda klienta na zapis informacji o zdrowiu (`clients.allergies`).
 *
 * Reguła (trasy POST /api/clients i PUT /api/clients/[id], druga tama: CHECK
 * `clients_allergies_require_consent` w bazie):
 *   - niepuste `allergies` wymaga zgody przysłanej w żądaniu albo zapisanej wcześniej;
 *   - czas i konto zgody nadaje serwer, nigdy body żądania;
 *   - cofnięcie zgody zeruje `allergies` w tym samym UPDATE.
 *
 * Pusty albo biały napis nie jest informacją o zdrowiu: zapisujemy go jako NULL
 * i nie wymagamy dla niego zgody.
 */

/** Kod błędu w odpowiedzi 400, po którym UI rozpozna brak zgody. */
export const HEALTH_DATA_CONSENT_REQUIRED = "HEALTH_DATA_CONSENT_REQUIRED";

/** Komunikat dla personelu salonu (bez danych klienta). */
export const HEALTH_DATA_CONSENT_REQUIRED_MESSAGE =
  "Informacje o zdrowiu (alergie) można zapisać tylko po zaznaczeniu, że klient wyraził wyraźną zgodę na ich zapis.";

/** Treść odpowiedzi 400 przy próbie zapisu informacji o zdrowiu bez zgody. */
export function healthDataConsentRequiredBody() {
  return {
    success: false as const,
    error: HEALTH_DATA_CONSENT_REQUIRED_MESSAGE,
    code: HEALTH_DATA_CONSENT_REQUIRED,
  };
}

/**
 * Wartość `allergies` do zapisu: `null` dla braku, pustego lub białego napisu,
 * inaczej napis bez zmian. `undefined` zostaje `undefined` (pole nieprzysłane).
 */
export function normalizeAllergies(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value.trim() === "") return null;
  return value;
}
