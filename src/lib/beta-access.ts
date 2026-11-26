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
 * Jedyna bramka zakładania salonu w becie. Wszystkie warunki naraz:
 *  1. e-mail konta z sesji jest na liście BETA_ALLOWED_OWNER_EMAILS,
 *  2. na serwerze działa poczta (`emailConfigured` = `isEmailConfigured()`
 *     z @/lib/email; przekazywane z trasy, bo ten moduł czyta też UI),
 *  3. e-mail jest potwierdzony (`emailVerified === true`).
 *
 * Warunki 2 i 3 chronią zaproszenie: bez poczty Better Auth nie wymaga
 * potwierdzenia e-maila i ktoś mógłby zarejestrować się na cudzy adres z listy
 * przed zaproszoną osobą. Bramka nie polega na tym, że ktoś pamiętał o
 * RESEND_API_KEY: brak poczty = odmowa (domyślnie zamknięte).
 *
 * Jedyny wyjątek od 2 i 3 (nigdy od 1): BETA_ALLOW_UNVERIFIED_OWNER=1 poza
 * hostingiem — serwer E2E w CI i lokalny dev bez poczty.
 */
export function canCreateSalon(
  user: BetaOwner,
  emailConfigured: boolean,
  env: BetaEnv = process.env
): boolean {
  return salonGateDenial(user, emailConfigured, env) === null;
}

type BetaOwner = { email?: string | null | undefined; emailVerified?: boolean | null | undefined };

/**
 * Powód odmowy bramki do logu (bez danych osobowych): `list` — adresu nie ma na
 * liście (albo lista pusta), `mail` — serwer bez poczty, `verified` — e-mail
 * niepotwierdzony. `null` = bramka otwarta. Kolejność i warunki jak w
 * `canCreateSalon`. Odpowiedź HTTP jest dla wszystkich powodów ta sama.
 */
export type SalonGateDenial = "list" | "mail" | "verified";

export function salonGateDenial(
  user: BetaOwner,
  emailConfigured: boolean,
  env: BetaEnv = process.env
): SalonGateDenial | null {
  if (!isBetaOwnerAllowed(user.email, env.BETA_ALLOWED_OWNER_EMAILS)) return "list";
  if (unverifiedOwnerAllowed(env)) return null;
  if (!emailConfigured) return "mail";
  return user.emailVerified === true ? null : "verified";
}
