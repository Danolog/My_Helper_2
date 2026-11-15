/**
 * Bezpieczna postać błędu do logów (N3, Ryan; #65/#67).
 *
 * DrizzleQueryError ma w `message` (a przez to w pierwszej linii `stack`)
 * parametry zapytania — "Failed query: insert ...\nparams: Anna,
 * +48123456789,anna@x.pl". To dane osobowe w logach Vercela. Tekst zapytania
 * zostaje (same placeholdery $1, $2), parametry nie.
 *
 * Czysty moduł bez zależności: używa go `logger` (każde `logger.*({ error })`
 * jest redagowane automatycznie) i może go wołać kod, który buduje metadane
 * błędu sam (np. catch webhooka Stripe — T3b).
 */

export const QUERY_PARAMS_MARKER = "\nparams: ";
export const REDACTED = "[redacted]";

/** Napis bez parametrów zapytania: wszystko od znacznika do końca → [redacted]. */
export function redactQueryParamsText(text: string): string {
  const idx = text.indexOf(QUERY_PARAMS_MARKER);
  return idx === -1 ? text : `${text.slice(0, idx)}${QUERY_PARAMS_MARKER}${REDACTED}`;
}

/**
 * message/stack bez parametrów. Stack składany z bezpiecznego message i ramek
 * z oryginału — bez wyrażenia regularnego: wartość parametru może zawierać
 * "\n    at ..." i nie może skrócić wycięcia.
 */
function redactError(error: Error): { message: string; stack: string | undefined } {
  const message = redactQueryParamsText(error.message);
  if (message === error.message) return { message, stack: error.stack };
  const head = `${error.name}: ${error.message}`;
  const frames = error.stack?.startsWith(head) ? error.stack.slice(head.length) : "";
  return { message, stack: `${error.name}: ${message}${frames}` };
}

export interface SafeErrorMeta {
  message: string;
  name: string;
  stack: string | undefined;
  /** Kod błędu bazy z `cause` (np. "23505") — do diagnozy, bez wartości. */
  causeCode?: string;
}

/**
 * Metadane błędu do logu: message, name, stack (bez parametrów zapytania)
 * i `causeCode`. `detail` Postgresa i samo `cause` NIE trafiają do logu
 * (zawierają wartości: "Key (email)=(...)"). Napis z parametrami (np. ktoś
 * zalogował `error.message`) też jest redagowany. Inne wartości bez zmian.
 */
export function toSafeErrorMeta(value: unknown): unknown {
  if (value instanceof Error) {
    const cause = (value as { cause?: unknown }).cause;
    const causeCode =
      cause && typeof cause === "object" && "code" in cause
        ? String((cause as { code: unknown }).code)
        : undefined;
    const { message, stack } = redactError(value);
    const meta: SafeErrorMeta = { message, name: value.name, stack };
    if (causeCode) meta.causeCode = causeCode;
    return meta;
  }
  if (typeof value === "string") return redactQueryParamsText(value);
  return value;
}

export interface ErrorIdentity {
  errorName: string;
  /** Kod własny błędu albo z `cause` (np. "23505", "40P01", "StripeAPIError"). */
  errorCode?: string;
}

/**
 * Sama tożsamość błędu — nazwa i kod, BEZ message, stack i treści zapytania
 * (N1, Ryan, przegląd #62). Dla `catch`, który obsługuje wiele ścieżek naraz
 * (webhook Stripe: subskrypcje i zadatki z danymi gości) — tam nawet tekst
 * zapytania z placeholderami nie jest potrzebny do diagnozy.
 */
export function toErrorIdentity(value: unknown): ErrorIdentity {
  const pickCode = (v: unknown): string | undefined => {
    if (!v || typeof v !== "object") return undefined;
    const { code, type } = v as { code?: unknown; type?: unknown };
    if (typeof code === "string" || typeof code === "number") return String(code);
    if (typeof type === "string") return type;
    return undefined;
  };
  if (value instanceof Error) {
    const errorCode = pickCode(value) ?? pickCode((value as { cause?: unknown }).cause);
    // DrizzleQueryError nie ustawia `name` ("Error") — wtedy nazwa klasy.
    const errorName = value.name === "Error" && value.constructor?.name ? value.constructor.name : value.name;
    return errorCode ? { errorName, errorCode } : { errorName };
  }
  return { errorName: typeof value };
}
