import { SUPPORT_CONTACT } from "@/lib/support-contact";

/**
 * Beta na zaproszenie: salon zakłada tylko właściciel, którego e-mail jest na
 * liście w zmiennej BETA_ALLOWED_OWNER_EMAILS (adresy po przecinku, bez
 * rozróżniania wielkości liter, spacje wokół adresów pomijane).
 *
 * Domyślnie zamknięte: pusta albo nieustawiona lista = nikt. Bez wyjątku dla
 * NODE_ENV — dev i E2E ustawiają listę jawnie (.env.local, workflow CI).
 *
 * E-mail pochodzi z sesji (konto zalogowane), nigdy z treści żądania. Lista
 * nie trafia do logów ani do odpowiedzi.
 *
 * Moduł bez zależności serwerowych: kod i komunikat błędu czyta też UI.
 */

export const BETA_INVITE_ONLY_CODE = "BETA_INVITE_ONLY";

export const BETA_INVITE_ONLY_MESSAGE =
  `Zakładanie salonów w becie MyHelper jest dostępne tylko na zaproszenie. ` +
  `Jeśli chcesz dołączyć, napisz do nas: ${SUPPORT_CONTACT}.`;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Lista dozwolonych adresów ze zmiennej; pusta tablica, gdy zmiennej brak. */
export function betaAllowedOwnerEmails(
  raw: string | undefined = process.env.BETA_ALLOWED_OWNER_EMAILS
): string[] {
  return (raw ?? "").split(",").map(normalizeEmail).filter(Boolean);
}

/**
 * Czy konto o tym e-mailu może założyć salon. Pusty e-mail albo pusta lista →
 * false (domyślnie zamknięte).
 */
export function isBetaOwnerAllowed(
  email: string | null | undefined,
  raw: string | undefined = process.env.BETA_ALLOWED_OWNER_EMAILS
): boolean {
  if (!email) return false;
  const normalized = normalizeEmail(email);
  if (!normalized) return false;
  return betaAllowedOwnerEmails(raw).includes(normalized);
}
