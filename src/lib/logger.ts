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

type LogLevel = "debug" | "info" | "warn" | "error";

interface LogContext {
  [key: string]: unknown;
}

const isProduction = process.env.NODE_ENV === "production";

/**
 * N3 (Ryan): DrizzleQueryError ma w `message` (a przez to w pierwszej linii
 * `stack`) parametry zapytania — "Failed query: insert ...\nparams: Anna,
 * +48123456789,anna@x.pl". To dane osobowe gościa w logach Vercela. Tekst
 * zapytania zostaje (same placeholdery $1, $2), parametry nie.
 */
const PARAMS_MARKER = "\nparams: ";

/**
 * message/stack bez parametrów zapytania. Wszystko od znacznika "params:"
 * do końca message jest wycinane; stack składany z bezpiecznego message
 * i ramek z oryginału (bez wyrażenia regularnego — wartość parametru może
 * zawierać "\n    at ..." i nie może skrócić wycięcia).
 */
function redactQueryParams(error: Error): { message: string; stack: string | undefined } {
  const idx = error.message.indexOf(PARAMS_MARKER);
  if (idx === -1) return { message: error.message, stack: error.stack };

  const message = `${error.message.slice(0, idx)}${PARAMS_MARKER}[redacted]`;
  const head = `${error.name}: ${error.message}`;
  const frames = error.stack?.startsWith(head) ? error.stack.slice(head.length) : "";
  return { message, stack: `${error.name}: ${message}${frames}` };
}

/**
 * Serialize an error object into a plain object suitable for structured logging.
 * Captures message, name, and stack trace — without query parameters (N3).
 * Kod błędu bazy z `cause` (np. "23505") zostaje do diagnozy; `detail`
 * Postgresa nie, bo zawiera wartości ("Key (email)=(...)").
 */
function serializeError(value: unknown): unknown {
  if (value instanceof Error) {
    const cause = (value as { cause?: unknown }).cause;
    const causeCode =
      cause && typeof cause === "object" && "code" in cause
        ? String((cause as { code: unknown }).code)
        : undefined;
    const { message, stack } = redactQueryParams(value);
    return {
      message,
      name: value.name,
      stack,
      ...(causeCode ? { causeCode } : {}),
    };
  }
  return value;
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
  const normalizedContext = context
    ? Object.fromEntries(
        Object.entries(context).map(([k, v]) => [k, serializeError(v)]),
      )
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
