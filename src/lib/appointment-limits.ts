/**
 * Limity pól wizyty wspólne dla API i panelu. Osobny moduł (nie `constants.ts`),
 * bo `api-validation.ts` importuje go przy ładowaniu, a testy mockują
 * `@/lib/constants` częściowo.
 */

/** Limit notatek wizyty: schematy API (POST i PUT) i pola w dialogach panelu. */
export const APPOINTMENT_NOTES_MAX_LENGTH = 1000;
