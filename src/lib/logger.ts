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

/** N3: redakcja parametrów zapytania i `detail` — wspólny helper `@/lib/safe-error`. */
const serializeError = toSafeErrorMeta;

/** Wartość zastępująca dane osobowe w kontekście logu. */
export const REDACTED = "[redacted]";

/**
 * Klucze, których WARTOŚĆ nigdy nie trafia do logu (hotfix P1, dane osobowe
 * w logach; lista: decyzja Olivera 16:30). Porównanie bez wielkości liter,
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
 * (bez wielkości liter, np. `guestPhone`, `clientEmail`), ma wartość-napis
 * zamienianą na `[redacted]`; wartości nienapisowe (`emailSent: true`,
 * obiekt `emailData`) zostają i są redagowane rekurencyjnie wg tych samych reguł.
 */
export const PII_LOG_KEY_FRAGMENTS: readonly string[] = ["phone", "email"];

const PII_KEY_SET = new Set(PII_LOG_KEYS.map((k) => k.toLowerCase()));

function isRedactedEntry(key: string, value: unknown): boolean {
  const lower = key.toLowerCase();
  if (PII_KEY_SET.has(lower)) return true;
  return typeof value === "string" && PII_LOG_KEY_FRAGMENTS.some((f) => lower.includes(f));
}

/** Granica zagnieżdżenia — głębiej logujemy znacznik, nie wartość. */
const MAX_REDACTION_DEPTH = 8;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Siatka na dane osobowe: kopia wartości z wartościami kluczy z
 * `PII_LOG_KEYS` oraz napisami pod kluczami z `PII_LOG_KEY_FRAGMENTS`
 * zamienionymi na `[redacted]`. Błędy (`Error`) przechodzą
 * przez `toSafeErrorMeta` (message, name, stack zostają), napisy — przez
 * redakcję parametrów zapytania. Obiekty niebędące zwykłymi obiektami
 * (Date itp.) zostają bez zmian. Wejście nie jest modyfikowane.
 */
export function redactLogContext(value: unknown, depth = 0, seen: WeakSet<object> = new WeakSet()): unknown {
  if (value instanceof Error || typeof value === "string") return serializeError(value);
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
  // nazwie klucza na każdym poziomie (redactLogContext).
  const normalizedContext = context
    ? (redactLogContext(context) as LogContext)
    : undefined;

  if (isProduction) {
    const entry = {
      level,
      msg: message,
      timestamp: new Date().toISOString(),
      ...normalizedContext,
    };

    const json = JSON.stringify(entry);

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
