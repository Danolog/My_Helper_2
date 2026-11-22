/**
 * Wpisy logu Better Auth przez nasz `logger` (format Cloud Logging, redakcja).
 *
 * Bez opcji `logger` biblioteka pisze `console.error` zwykłym tekstem: bez pola
 * `severity` i bez redakcji, z treścią nagłówków i zapytania w komunikacie.
 * Część jej wpisów `error` wywoła każde anonimowe żądanie (zły origin,
 * nieznany dostawca, callback OAuth bez `state`). Na poziomie ERROR trzymałyby
 * alert błędów (filtr severity>=ERROR) stale otwarty i zasłaniały prawdziwe
 * błędy — dlatego te komunikaty idą jako `warn`, z samym bezpiecznym kontekstem.
 */

import { logger } from "@/lib/logger";

/** Poziom wpisu w opcji `logger` Better Auth (bez `success`, który biblioteka mapuje na `info`). */
export type BetterAuthLogLevel = "debug" | "info" | "warn" | "error";

type LogContext = Record<string, unknown>;

export interface MappedAuthLog {
  level: BetterAuthLogLevel;
  message: string;
  context?: LogContext;
}

/** Długość origin w logu. Origin z nagłówka jest dowolnie długi; do diagnozy wystarcza początek. */
export const AUTH_LOG_ORIGIN_MAX_LENGTH = 120;

/** Długość identyfikatora dostawcy w logu. */
const PROVIDER_ID_MAX_LENGTH = 40;

/** Znacznik wartości, której nie da się sprowadzić do origin http(s). */
export const AUTH_LOG_UNPARSEABLE = "[unparseable]";

/**
 * Kody `StateError` (better-auth/dist/state.mjs) wywoływalne z zewnątrz:
 * brak, fałszywy albo przeterminowany `state` w callbacku OAuth. Inny błąd
 * przy parsowaniu stanu (np. bazy) zostaje `error`.
 */
const CLIENT_STATE_ERROR_CODES: ReadonlySet<string> = new Set([
  "state_not_found",
  "state_mismatch",
  "state_invalid",
  "state_security_mismatch",
]);

/**
 * Origin adresu (schemat + host + port) bez ścieżki, zapytania i danych
 * logowania, obcięty do `AUTH_LOG_ORIGIN_MAX_LENGTH`. Ścieżka i zapytanie
 * adresu z żądania mogą nieść tokeny albo dane osobowe, a origin wystarcza,
 * żeby dopisać brakujący wpis do trustedOrigins. Parser WHATWG usuwa znaki
 * nowej linii i tabulacji; pozostałe znaki sterujące wycinamy dodatkowo.
 */
export function safeOriginForLog(raw: unknown): string {
  if (typeof raw !== "string") return AUTH_LOG_UNPARSEABLE;
  let origin: string;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return AUTH_LOG_UNPARSEABLE;
    origin = url.origin;
  } catch {
    return AUTH_LOG_UNPARSEABLE;
  }
  const printable = origin.replace(/[\u0000-\u001f\u007f]/g, "");
  return printable.slice(0, AUTH_LOG_ORIGIN_MAX_LENGTH);
}

/** Identyfikator dostawcy z żądania: tylko znaki identyfikatora, ograniczona długość. */
function safeProviderId(raw: unknown): string {
  if (typeof raw !== "string") return AUTH_LOG_UNPARSEABLE;
  return raw.replace(/[^A-Za-z0-9_-]/g, "").slice(0, PROVIDER_ID_MAX_LENGTH);
}

/** Wartość pola `key` z pierwszego argumentu-obiektu, np. `{ provider: "x" }`. */
function firstArgField(args: readonly unknown[], key: string): unknown {
  const first = args[0];
  return first !== null && typeof first === "object" ? (first as Record<string, unknown>)[key] : undefined;
}

/**
 * Komunikat Better Auth wywoływalny anonimowo. `prefix` to stały początek
 * komunikatu; `message` — stały tekst zapisywany do logu (bez danych z
 * żądania wklejonych do komunikatu); `context` buduje kontekst wyłącznie
 * z bezpiecznych pól, a `null` oznacza „to nie ten przypadek” (wpis idzie
 * ścieżką ogólną).
 */
interface AnonymousAuthLogRule {
  prefix: string;
  message: string;
  context: (message: string, args: readonly unknown[]) => LogContext | undefined | null;
}

const noContext = (): undefined => undefined;

const providerContext = (_message: string, args: readonly unknown[]): LogContext => ({
  provider: safeProviderId(firstArgField(args, "provider")),
});

/** Komunikat `Invalid <label>: <adres>` → sam origin adresu. */
const urlOriginContext =
  (prefix: string) =>
  (message: string): LogContext => ({ origin: safeOriginForLog(message.slice(prefix.length)) });

function invalidUrlRule(label: string): AnonymousAuthLogRule {
  const prefix = `Invalid ${label}: `;
  return { prefix, message: `Invalid ${label}`, context: urlOriginContext(prefix) };
}

/**
 * Jedyna lista komunikatów obniżanych z `error` do `warn` (przypięta testem
 * `__tests__/lib/auth-log.test.ts`). Źródła w better-auth 1.7.25 (dist):
 * - api/routes/sign-in.mjs — nieznany dostawca, dostawca bez id tokenu;
 * - api/routes/callback.mjs — zły kształt callbacku, brak `state`;
 * - oauth2/state.mjs — `state` nieznany, fałszywy albo przeterminowany;
 * - api/middlewares/origin-check.mjs — zły origin / callbackURL / redirectURL /
 *   errorCallbackURL / newUserCallbackURL, blokada CSRF nawigacji cross-site.
 */
export const ANONYMOUS_AUTH_LOG_RULES: readonly AnonymousAuthLogRule[] = [
  {
    prefix: "Provider not found. Make sure to add the provider in your auth config",
    message: "Provider not found",
    context: providerContext,
  },
  {
    prefix: "Provider does not support id token verification",
    message: "Provider does not support id token verification",
    context: providerContext,
  },
  // Argument to błąd walidacji zapytania — niesie wartości z żądania.
  { prefix: "INVALID_CALLBACK_REQUEST", message: "INVALID_CALLBACK_REQUEST", context: noContext },
  // Argument to parametr `error` z zapytania — dowolny tekst od klienta.
  { prefix: "State not found", message: "State not found", context: noContext },
  {
    prefix: "Failed to parse state",
    message: "Failed to parse state",
    context: (_message, args) => {
      const code = firstArgField(args, "code");
      return typeof code === "string" && CLIENT_STATE_ERROR_CODES.has(code) ? { stateErrorCode: code } : null;
    },
  },
  invalidUrlRule("origin"),
  invalidUrlRule("callbackURL"),
  invalidUrlRule("redirectURL"),
  invalidUrlRule("errorCallbackURL"),
  invalidUrlRule("newUserCallbackURL"),
  // Argument to wartości nagłówków Sec-Fetch-* — od klienta.
  {
    prefix: "Blocked cross-site navigation login attempt",
    message: "Blocked cross-site navigation login attempt (CSRF protection)",
    context: noContext,
  },
];

/**
 * Wpis Better Auth → poziom, komunikat i kontekst naszego loggera. Znane
 * komunikaty anonimowe (`ANONYMOUS_AUTH_LOG_RULES`) na poziomie `error` →
 * `warn` ze stałym tekstem i bezpiecznym kontekstem. Pozostałe wpisy zostają
 * na swoim poziomie; argumenty trafiają do kontekstu `args`, który logger
 * redaguje (`redactLogContext`).
 */
export function mapBetterAuthLog(
  level: BetterAuthLogLevel,
  message: string,
  args: readonly unknown[],
): MappedAuthLog {
  if (level === "error") {
    for (const rule of ANONYMOUS_AUTH_LOG_RULES) {
      if (!message.startsWith(rule.prefix)) continue;
      const context = rule.context(message, args);
      if (context === null) break;
      return context ? { level: "warn", message: rule.message, context } : { level: "warn", message: rule.message };
    }
  }
  return args.length > 0 ? { level, message, context: { args: [...args] } } : { level, message };
}

/**
 * Opcja `logger` dla `betterAuth`. Poziom `warn` (domyślny w bibliotece)
 * ustawiony jawnie: wpisy `info`/`debug` (m.in. „If it's a valid URL, please
 * add … Current list of trustedOrigins”) nie trafiają do logu w żadnym
 * środowisku.
 */
export const betterAuthLoggerOptions = {
  level: "warn" as const,
  log: (level: BetterAuthLogLevel, message: string, ...args: unknown[]): void => {
    const mapped = mapBetterAuthLog(level, typeof message === "string" ? message : String(message), args);
    logger[mapped.level](mapped.message, mapped.context);
  },
};
