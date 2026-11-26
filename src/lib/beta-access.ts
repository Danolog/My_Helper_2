import { hostingPlatform } from "@/lib/hosting";
import { SUPPORT_CONTACT } from "@/lib/support-contact";

/**
 * Beta na zaproszenie: salon zakłada tylko właściciel, którego e-mail jest na
 * liście w zmiennej BETA_ALLOWED_OWNER_EMAILS (adresy po przecinku, bez
 * rozróżniania wielkości liter, spacje wokół adresów pomijane).
 *
 * Domyślnie zamknięte: pusta albo nieustawiona lista = nikt. Bez wyjątku dla
 * NODE_ENV — dev i E2E ustawiają listę jawnie (.env.local, workflow CI).
 * Dodatkowo wymagany potwierdzony e-mail (`canCreateSalon`).
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
 * Czy e-mail jest na liście bety. Pusty e-mail albo pusta lista → false
 * (domyślnie zamknięte). Sam w sobie NIE wystarcza do założenia salonu — patrz
 * `canCreateSalon`.
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

type BetaEnv = Readonly<Record<string, string | undefined>>;

/**
 * Przełącznik TYLKO dla serwera E2E w CI i lokalnego dev bez dostawcy poczty:
 * `BETA_ALLOW_UNVERIFIED_OWNER=1` dopuszcza konto z listy z niepotwierdzonym
 * e-mailem. Na każdym hostingu (Vercel, Cloud Run) ignorowany — tam
 * potwierdzony e-mail jest wymagany zawsze. Nie zależy od NODE_ENV.
 */
function unverifiedOwnerAllowed(env: BetaEnv): boolean {
  return env.BETA_ALLOW_UNVERIFIED_OWNER === "1" && hostingPlatform(env) === null;
}

/**
 * Jedyna bramka zakładania salonu w becie. Oba warunki naraz:
 *  1. e-mail konta z sesji jest na liście BETA_ALLOWED_OWNER_EMAILS,
 *  2. e-mail jest potwierdzony (`emailVerified === true`).
 *
 * Warunek 2 chroni zaproszenie: bez niego, gdy potwierdzanie e-maila jest
 * wyłączone (brak dostawcy poczty), ktoś mógłby zarejestrować się na cudzy
 * adres z listy przed zaproszoną osobą. Brak poczty na serwerze = nikt nie
 * potwierdzi adresu = nikt nie założy salonu (domyślnie zamknięte).
 */
export function canCreateSalon(
  user: { email?: string | null | undefined; emailVerified?: boolean | null | undefined },
  env: BetaEnv = process.env
): boolean {
  if (!isBetaOwnerAllowed(user.email, env.BETA_ALLOWED_OWNER_EMAILS)) return false;
  if (user.emailVerified === true) return true;
  return unverifiedOwnerAllowed(env);
}
