/**
 * Lightweight structured logging wrapper for server-side code.
 *
 * - **Development**: human-readable output with level prefix and optional context
 * - **Production**: JSON structured logs compatible with Vercel's log drain
 *   and any JSON-based log aggregation tool (Datadog, Grafana, etc.)
 *
 * Usage:
 *   import { logger } from "@/lib/logger";
 *   logger.info("Appointment completed", { appointmentId, employeeId });
 *   logger.error("Database error", { error: err.message, route: "/api/..." });
 *
 * The logger intentionally uses console methods internally (the single place
 * in the codebase that should have eslint-disable for no-console).
 */

import { toSafeErrorMeta } from "@/lib/safe-error";

type LogLevel = "debug" | "info" | "warn" | "error";

interface LogContext {
  [key: string]: unknown;
}

const isProduction = process.env.NODE_ENV === "production";

/** Redakcja parametrów zapytania i `detail` — wspólny helper `@/lib/safe-error`. */
const serializeError = toSafeErrorMeta;

/** Wartość zastępująca dane osobowe w kontekście logu. */
export const REDACTED = "[redacted]";

/**
 * Klucze, których WARTOŚĆ nigdy nie trafia do logu. Porównanie bez wielkości liter,
 * na każdym poziomie zagnieżdżenia, także w tablicach, w każdym środowisku.
 * `message` i `name` celowo NIE są na liście — wycięłyby treść i nazwę
 * każdego błędu (`toSafeErrorMeta`). Osobę z kluczem `name` poprawia się
 * w miejscu wywołania, nie tutaj.
 */
export const PII_LOG_KEYS: readonly string[] = [
  "notes",
  "note",
  "phone",
  "phoneNumber",
  "email",
  "firstName",
  "lastName",
  "fullName",
  "clientName",
  "customerName",
  "employeeName",
  "comment",
  "content",
  "address",
  "nip",
  "pesel",
  "body",
  // Z inwentaryzacji: surowa odpowiedź modelu AI o kliencie/wizycie
  // (personalize, categorize, insights, auto-summary).
  "rawText",
  "responseText",
];

/**
 * Fragmenty nazw kluczy kontaktowych: klucz, którego nazwa zawiera fragment
 * (bez wielkości liter, np. `guestPhone`, `clientEmail`), ma zamienianą na
 * `[redacted]` wartość: napis (także `URL` i obiekt `String`), liczbę całkowitą
 * (także obiekt `Number`) o co najmniej 7 cyfrach albo
 * `bigint` (numer telefonu zapisany liczbą) oraz tablicę, w której choć jeden
 * element jest napisem, `URL` albo taką liczbą, także w tablicy zagnieżdżonej (bez
 * wchodzenia w obiekty) — cała tablica. Pozostałe wartości
 * zostają: liczniki i małe liczby (`emailCount: 3`), `boolean`, `null`, pusta
 * tablica; obiekt (`emailData`) i tablica samych obiektów są redagowane
 * rekurencyjnie wg tych samych reguł.
 * Granica reguły: napis pod kluczem bez fragmentu (np. `value`) w obiekcie
 * wewnątrz tablicy pod kluczem z fragmentem (`phones: [{ value: "…" }]`) NIE
 * jest objęty — dane kontaktowe maskuje się w miejscu wywołania. Liczba
 * niecałkowita i liczba poniżej 7 cyfr zostają;
 * liczbowy znacznik czasu pod takim kluczem jest redagowany.
 */
export const PII_LOG_KEY_FRAGMENTS: readonly string[] = ["phone", "email"];

const PII_KEY_SET = new Set(PII_LOG_KEYS.map((k) => k.toLowerCase()));

/** Najmniejsza wartość bezwzględna liczby traktowanej jak numer telefonu (7 cyfr). */
const PHONE_LIKE_NUMBER_MIN = 1_000_000;

function isContactScalar(value: unknown): boolean {
  const v = value instanceof String || value instanceof Number ? value.valueOf() : value;
  if (typeof v === "string" || typeof v === "bigint" || v instanceof URL) return true;
  return typeof v === "number" && Number.isInteger(v) && Math.abs(v) >= PHONE_LIKE_NUMBER_MIN;
}

/** Granica zagnieżdżenia — głębiej logujemy znacznik, nie wartość. */
const MAX_REDACTION_DEPTH = 8;

/**
 * Wartość kontaktowa albo tablica, która ją zawiera — także w tablicy zagnieżdżonej (bez wchodzenia w obiekty).
 * Tablica już odwiedzona w tym przeglądzie nie jest przeglądana ponownie.
 */
function isContactValue(value: unknown, depth = 0, seen: WeakSet<object> = new WeakSet()): boolean {
  if (isContactScalar(value)) return true;
  if (!Array.isArray(value) || depth >= MAX_REDACTION_DEPTH || seen.has(value)) return false;
  seen.add(value);
  return value.some((item) => isContactValue(item, depth + 1, seen));
}

function isRedactedEntry(key: string, value: unknown): boolean {
  const lower = key.toLowerCase();
  if (PII_KEY_SET.has(lower)) return true;
  return PII_LOG_KEY_FRAGMENTS.some((f) => lower.includes(f)) && isContactValue(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Napis adresu bez nazwy użytkownika i hasła, po tej samej redakcji co inne napisy. */
function urlWithoutCredentials(url: URL): unknown {
  const copy = new URL(url.href);
  copy.username = "";
  copy.password = "";
  return serializeError(copy.href);
}

/**
 * Siatka na dane osobowe: kopia wartości z wartościami kluczy z
 * `PII_LOG_KEYS` oraz wartościami kontaktowymi pod kluczami z
 * `PII_LOG_KEY_FRAGMENTS` (reguła przy tej stałej) zamienionymi na `[redacted]`. Błędy (`Error`) przechodzą
 * przez `toSafeErrorMeta` (message, name, stack zostają), napisy — przez
 * redakcję parametrów zapytania, `URL` — na napis adresu bez nazwy
 * użytkownika i hasła. Inne obiekty niebędące zwykłymi obiektami (Date,
 * instancje klas itp.) zostają bez zmian; w produkcji ich pola redaguje
 * druga linia przy serializacji (`logReplacer`). Wejście nie jest modyfikowane.
 */
export function redactLogContext(value: unknown, depth = 0, seen: WeakSet<object> = new WeakSet()): unknown {
  if (value instanceof Error || typeof value === "string") return serializeError(value);
  if (value instanceof URL) return urlWithoutCredentials(value);
  if (value === null || typeof value !== "object") return value;
  if (!Array.isArray(value) && !isPlainObject(value)) return value;
  if (seen.has(value)) return "[circular]";
  if (depth >= MAX_REDACTION_DEPTH) return "[depth-limit]";
  seen.add(value);
  const out = Array.isArray(value)
    ? value.map((item) => redactLogContext(item, depth + 1, seen))
    : Object.fromEntries(
        Object.entries(value).map(([k, v]) => [
          k,
          isRedactedEntry(k, v) ? REDACTED : redactLogContext(v, depth + 1, seen),
        ]),
      );
  seen.delete(value);
  return out;
}

/**
 * Replacer `JSON.stringify` — druga linia redakcji przy serializacji, na
 * każdym poziomie, także w polach obiektów niebędących zwykłymi obiektami
 * (instancje klas). Kolejność: wartość pod kluczem z `PII_LOG_KEYS` →
 * `[redacted]` niezależnie od typu; `Error` → `toSafeErrorMeta`; `Date`
 * zostaje datą (także pod kluczem z fragmentem; liczbowy znacznik czasu pod
 * takim kluczem nadal jest redagowany — reguła przy `PII_LOG_KEY_FRAGMENTS`);
 * `URL` → napis adresu bez nazwy użytkownika i hasła; wartość kontaktowa
 * (także ten napis adresu) pod kluczem z `PII_LOG_KEY_FRAGMENTS` →
 * `[redacted]`; `bigint` → napis dziesiętny.
 * Dla wyniku `redactLogContext` na zwykłych obiektach replacer może jedynie
 * zredagować więcej: tablicę pod kluczem z fragmentem, w której pierwsza
 * linia zostawiła napis (znacznik cyklu albo znacznik głębokości).
 */
function logReplacer(this: unknown, key: string, value: unknown): unknown {
  const source = (this as Record<string, unknown>)[key];
  if (key !== "" && PII_KEY_SET.has(key.toLowerCase())) return REDACTED;
  if (source instanceof Error) return serializeError(source);
  if (source instanceof Date) return value;
  const out = source instanceof URL ? urlWithoutCredentials(source) : value;
  if (key !== "" && isRedactedEntry(key, out)) return REDACTED;
  return typeof out === "bigint" ? out.toString() : out;
}

/**
 * Format and output a log entry.
 *
 * In production, emits a single-line JSON object so log aggregation services
 * can parse structured fields (level, msg, timestamp, and any extra context).
 *
 * In development, uses a human-readable format with a [LEVEL] prefix and
 * optional context printed as a plain object for readability in the terminal.
 */
function formatLog(level: LogLevel, message: string, context?: LogContext) {
  // Normalize error objects in context so they serialize properly
  // Błędy serializowane (message/name/stack), dane osobowe zredagowane po
  // nazwie klucza na każdym poziomie (redactLogContext). Gdy redakcja rzuci
  // (getter rzucający wyjątek, Proxy), kontekst wpisu to sam znacznik —
  // logger nie rzuca do wywołującego.
  let normalizedContext: LogContext | undefined;
  try {
    normalizedContext = context ? (redactLogContext(context) as LogContext) : undefined;
  } catch {
    normalizedContext = { contextError: "unserializable" };
  }

  if (isProduction) {
    const timestamp = new Date().toISOString();

    let json: string;
    try {
      const entry = {
        level,
        msg: message,
        timestamp,
        ...normalizedContext,
      };
      json = JSON.stringify(entry, logReplacer);
    } catch {
      // Kontekst nieserializowalny (np. cykl w obiekcie niebędącym zwykłym
      // obiektem): wpis zastępczy z polami prostymi pierwszego poziomu
      // kontekstu (napis, liczba, boolean), bez obiektów, tablic i treści
      // wyjątku; level, msg i timestamp wpisu wygrywają z polami kontekstu.
      // Gdy i on rzuci (np. getter rzucający wyjątek w kontekście niebędącym
      // zwykłym obiektem) — wpis ostateczny z samych napisów, bez kontekstu.
      try {
        const simpleFields = Object.fromEntries(
          Object.entries(normalizedContext ?? {}).filter(
            ([, v]) => typeof v === "string" || typeof v === "number" || typeof v === "boolean",
          ),
        );
        json = JSON.stringify(
          { ...simpleFields, level, msg: message, timestamp, contextError: "unserializable" },
          logReplacer,
        );
      } catch {
        json = JSON.stringify({
          level,
          msg: typeof message === "string" ? message : "[unserializable]",
          timestamp,
          contextError: "unserializable",
        });
      }
    }

    // Route to the correct console method so Vercel and cloud providers
    // can distinguish severity in their log viewer.
    switch (level) {
      case "error":
        console.error(json);
        break;
      case "warn":
        console.warn(json);
        break;
      default:
        // eslint-disable-next-line no-console
        console.log(json);
        break;
    }
  } else {
    // Human-readable format for local development
    const prefix = `[${level.toUpperCase()}]`;

    switch (level) {
      case "error":
        if (normalizedContext && Object.keys(normalizedContext).length > 0) {
          console.error(prefix, message, normalizedContext);
        } else {
          console.error(prefix, message);
        }
        break;
      case "warn":
        if (normalizedContext && Object.keys(normalizedContext).length > 0) {
          console.warn(prefix, message, normalizedContext);
        } else {
          console.warn(prefix, message);
        }
        break;
      default:
        if (normalizedContext && Object.keys(normalizedContext).length > 0) {
          // eslint-disable-next-line no-console
          console.log(prefix, message, normalizedContext);
        } else {
          // eslint-disable-next-line no-console
          console.log(prefix, message);
        }
        break;
    }
  }
}

export const logger = {
  /** Verbose diagnostics, typically suppressed in production log drains. */
  debug: (msg: string, ctx?: LogContext) => formatLog("debug", msg, ctx),
  /** Standard operational events (request handled, job completed, etc.). */
  info: (msg: string, ctx?: LogContext) => formatLog("info", msg, ctx),
  /** Recoverable issues that deserve attention but are not failures. */
  warn: (msg: string, ctx?: LogContext) => formatLog("warn", msg, ctx),
  /** Failures that require investigation. */
  error: (msg: string, ctx?: LogContext) => formatLog("error", msg, ctx),
};
