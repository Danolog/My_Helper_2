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
import { toSafeErrorMeta } from "@/lib/safe-error";

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

/**
 * Identyfikator dostawcy z żądania: tylko znaki identyfikatora, ograniczona
 * długość. Nic nie zostało po oczyszczeniu → znacznik, nie pusty napis
 * (pusty `provider` w logu wygląda jak brak pola, a nie jak śmieciowe wejście).
 */
function safeProviderId(raw: unknown): string {
  if (typeof raw !== "string") return AUTH_LOG_UNPARSEABLE;
  const cleaned = raw.replace(/[^A-Za-z0-9_-]/g, "").slice(0, PROVIDER_ID_MAX_LENGTH);
  return cleaned === "" ? AUTH_LOG_UNPARSEABLE : cleaned;
}

/**
 * Treść wpisu spoza `ANONYMOUS_AUTH_LOG_RULES` — ta sama redakcja napisów co
 * argumenty w kontekście (`toSafeErrorMeta`: parametry zapytania, wycinek
 * wejścia JSON). Logger redaguje tylko kontekst, a treść zapisuje dosłownie.
 */
function redactMessageText(message: string): string {
  const redacted = toSafeErrorMeta(message);
  return typeof redacted === "string" ? redacted : AUTH_LOG_UNPARSEABLE;
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
 *
 * Domyślnie reguła działa tylko na wpis `error` i obniża go do `warn`.
 * `keepLevel: true` — reguła działa na każdym poziomie wejściowym i go nie
 * zmienia; służy wpisom niższego poziomu z danymi z żądania w treści, które
 * dziś chroni przed zapisem tylko domyślny próg `warn` biblioteki.
 */
interface AnonymousAuthLogRule {
  prefix: string;
  message: string;
  context: (message: string, args: readonly unknown[]) => LogContext | undefined | null;
  keepLevel?: true;
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

const UNTRUSTED_URL_PREFIX = "If it's a valid URL, please add ";
const UNTRUSTED_URL_SUFFIX = " to trustedOrigins";

/**
 * Komunikat `If it's a valid URL, please add <adres> to trustedOrigins …` →
 * sam origin adresu. Adres kończy ostatnie wystąpienie stałego dalszego ciągu
 * (adres z żądania może sam zawierać ten tekst); bez niego — reszta treści.
 */
const untrustedUrlContext = (message: string): LogContext => {
  const rest = message.slice(UNTRUSTED_URL_PREFIX.length);
  const end = rest.lastIndexOf(UNTRUSTED_URL_SUFFIX);
  return { origin: safeOriginForLog(end === -1 ? rest : rest.slice(0, end)) };
};

/**
 * Jedyna lista komunikatów anonimowych przerabianych przed zapisem (przypięta
 * testami `__tests__/lib/auth-log.test.ts` oraz
 * `__tests__/lib/auth-log-dist-source.test.ts`, który sprawdza, że każdy
 * prefiks nadal występuje w źródle w dist biblioteki). Źródła w better-auth
 * 1.7.25 (dist), wpisy `error` → `warn`:
 * - api/routes/sign-in.mjs — nieznany dostawca, dostawca bez id tokenu;
 * - api/routes/callback.mjs — zły kształt callbacku, brak `state`;
 * - oauth2/state.mjs — `state` nieznany, fałszywy albo przeterminowany;
 * - api/middlewares/origin-check.mjs — zły origin / callbackURL / redirectURL /
 *   errorCallbackURL / newUserCallbackURL, blokada CSRF nawigacji cross-site;
 * - better-call 1.4.5 dist/utils.mjs — APIError 415 z nagłówkiem Content-Type
 *   w treści. Handler błędów API (api/index.mjs, `onError`) zapisuje treść
 *   błędu jako `error`, gdy zawiera m.in. „table” albo „column”, a treść
 *   składa wartość nagłówka od klienta (np. `Content-Type: text/table`).
 *
 * Wpisy `info` z danymi z żądania w treści (`keepLevel`, poziom bez zmian):
 * - api/routes/sign-up.mjs — e-mail istniejącego konta;
 * - api/middlewares/origin-check.mjs — pełny odrzucony adres.
 *
 * Celowo poza listą: „Failed to validate authorization code”
 * (oauth2/callback.mjs). Da się go wywołać anonimowo (`state` z
 * `/sign-in/social` i dowolny `code`), ale tylko dla zarejestrowanego dostawcy.
 * Bez skonfigurowanego Google dostawca nie istnieje, więc ścieżka jest
 * nieosiągalna; po włączeniu Google ten wpis oznacza awarię logowania Google
 * (np. zły sekret klienta) i ma zostać `error`, żeby budził alert.
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
  // Treść niesie wartość nagłówka Content-Type od klienta.
  { prefix: 'Content-Type "', message: "Content-Type is not allowed", context: noContext },
  { prefix: "Content-Type is required", message: "Content-Type is required", context: noContext },
  // Treść niesie e-mail z żądania rejestracji.
  {
    prefix: "Sign-up attempt for existing email",
    message: "Sign-up attempt for existing email",
    context: noContext,
    keepLevel: true,
  },
  // Treść niesie pełny odrzucony adres (ścieżka i zapytanie), argument — listę trustedOrigins.
  {
    prefix: UNTRUSTED_URL_PREFIX,
    message: "Untrusted URL, add to trustedOrigins if valid",
    context: untrustedUrlContext,
    keepLevel: true,
  },
];

/**
 * Wpis Better Auth → poziom, komunikat i kontekst naszego loggera. Znane
 * komunikaty anonimowe (`ANONYMOUS_AUTH_LOG_RULES`) dostają stały tekst
 * i bezpieczny kontekst: wpis `error` → `warn`, a reguła `keepLevel` działa
 * na każdym poziomie i go zachowuje. Pozostałe wpisy zostają na swoim
 * poziomie; treść przechodzi przez redakcję napisów (`redactMessageText`),
 * a argumenty trafiają do kontekstu `args`, który logger redaguje
 * (`redactLogContext`).
 */
export function mapBetterAuthLog(
  level: BetterAuthLogLevel,
  message: string,
  args: readonly unknown[],
): MappedAuthLog {
  for (const rule of ANONYMOUS_AUTH_LOG_RULES) {
    if (!rule.keepLevel && level !== "error") continue;
    if (!message.startsWith(rule.prefix)) continue;
    const context = rule.context(message, args);
    if (context === null) break;
    const outputLevel: BetterAuthLogLevel = rule.keepLevel ? level : "warn";
    return context
      ? { level: outputLevel, message: rule.message, context }
      : { level: outputLevel, message: rule.message };
  }
  const safeMessage = redactMessageText(message);
  return args.length > 0
    ? { level, message: safeMessage, context: { args: [...args] } }
    : { level, message: safeMessage };
}

/**
 * Opcja `logger` dla `betterAuth`. Bez pola `level`: biblioteka przyjmuje
 * wtedy `warn`, więc wpisy `info`/`debug` (m.in. „If it's a valid URL, please
 * add … Current list of trustedOrigins”) nie trafiają do logu. Jawne `level`
 * (`warn`, `error`, `debug`) włącza w handlerze błędów API (better-auth
 * dist/api/index.mjs, `onError`) dodatkowy wpis `error` z komunikatem
 * każdego błędu API zgłoszonego przed endpointem (sprawdzenie origin i CSRF,
 * parsowanie ciała: 400/403/415), wypisywany domyślnym loggerem biblioteki
 * przez `console.error`, z pominięciem tej opcji; błędy z samych endpointów
 * handler zamienia w odpowiedź bez tego wpisu.
 */
export const betterAuthLoggerOptions: { log: (level: BetterAuthLogLevel, message: string, ...args: unknown[]) => void } = {
  log: (level: BetterAuthLogLevel, message: string, ...args: unknown[]): void => {
    const mapped = mapBetterAuthLog(level, typeof message === "string" ? message : String(message), args);
    logger[mapped.level](mapped.message, mapped.context);
  },
};
