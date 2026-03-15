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
 * Serialize an error object into a plain object suitable for structured logging.
 * Captures message, name, and stack trace without losing information.
 */
function serializeError(value: unknown): unknown {
  if (value instanceof Error) {
    return {
      message: value.message,
      name: value.name,
      stack: value.stack,
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
