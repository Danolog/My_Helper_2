/**
 * Maskowanie wpisów logów Cloud Run (wyjście `gcloud logging read --format=json`).
 *
 * Czyste funkcje, bez I/O. Zasada: biała lista pól wyjścia. Z wpisu bierzemy
 * tylko pola z SafeLogEntry, każde zwalidowane albo zamaskowane. Wszystko inne
 * (IP, user agent, referer, trace, labels, insertId, pełny jsonPayload czy
 * protoPayload) nigdy nie trafia na wyjście, bo nie jest nigdzie kopiowane.
 *
 * Wpis, którego nie da się bezpiecznie odczytać, daje SKIPPED_LINE, nigdy
 * surowy tekst.
 */

export const SKIPPED_LINE = '[pominięty wpis]';
export const MAX_MESSAGE_LENGTH = 300;
const MAX_PATH_LENGTH = 200;
const EMPTY_FIELD = '-';

export interface SafeLogEntry {
  timestamp: string;
  severity: string | null;
  revision: string | null;
  status: number | null;
  method: string | null;
  path: string | null;
  latencyMs: number | null;
  message: string | null;
}

/** Kolejność pól na wyjściu (tekst i JSON). */
export const OUTPUT_FIELDS = [
  'timestamp',
  'severity',
  'revision',
  'status',
  'method',
  'path',
  'latencyMs',
  'message',
] as const satisfies readonly (keyof SafeLogEntry)[];

const SEVERITIES = new Set([
  'DEFAULT',
  'DEBUG',
  'INFO',
  'NOTICE',
  'WARNING',
  'ERROR',
  'CRITICAL',
  'ALERT',
  'EMERGENCY',
]);

const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const REVISION_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE_SEGMENT_RE = /^[A-Za-z0-9._~-]+$/;

// --- Maskowanie treści komunikatu -------------------------------------------

const URL_WITH_QUERY_RE = /\bhttps?:\/\/[^\s"'<>`]*\?[^\s"'<>`]*/gi;
const BARE_QUERY_RE = /\?[^\s"'<>`=&?]+=[^\s"'<>`]*/g;
const BEARER_RE = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const SECRET_KEY_RE = /\b(?:sk|whsec)_[A-Za-z0-9_]+/g;
const JWT_RE = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const UUID_IN_TEXT_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
// Kandydat na IPv6: co najmniej dwa dwukropki, opcjonalny ogon IPv4 (::ffff:a.b.c.d).
const IPV6_CANDIDATE_RE =
  /(?<![\w:.])(?:[0-9a-f]{0,4}:){2,7}(?:\d{1,3}(?:\.\d{1,3}){3}|[0-9a-f]{1,4})?(?![\w:])/gi;
const IPV4_RE = /(?<![\w.])(?:\d{1,3}\.){3}\d{1,3}(?!\w|\.\d)/g;
// E.164: +, cyfra 1-9, łącznie 7-15 cyfr (spacje i myślniki między grupami dopuszczone).
const PHONE_E164_RE = /(?<![\w+])\+[1-9](?:[\s-]?\d){6,14}(?!\w)/g;
// PL komórkowy: 9 cyfr w grupach 3-3-3, z opcjonalnym 48 / 0048.
const PHONE_PL_MOBILE_RE = /(?<![\w+])(?:(?:00)?48[\s-]?)?\d{3}[\s-]?\d{3}[\s-]?\d{3}(?!\w)/g;
// PL stacjonarny: 2-3-2-2.
const PHONE_PL_LANDLINE_RE = /(?<![\w+])(?:(?:00)?48[\s-]?)?\d{2}[\s-]\d{3}[\s-]\d{2}[\s-]\d{2}(?!\w)/g;
const LONG_DIGITS_RE = /\d{9,}/g;

function maskIpv6Candidate(match: string): string {
  const groups = match.split(':').length;
  const looksLikeIp = match.includes('::') || groups >= 8 || /[a-f]/i.test(match);
  return looksLikeIp ? '[ip]' : match;
}

/** Zamienia znaki sterujące (w tym tab i nową linię) na spację — jedna linia na wpis. */
function flattenControlChars(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    out += code < 0x20 || code === 0x7f ? ' ' : ch;
  }
  return out;
}

/** Maskuje dane wrażliwe w tekście, bez obcinania. */
export function maskText(text: string): string {
  return flattenControlChars(text)
    .replace(URL_WITH_QUERY_RE, '[url]')
    .replace(BARE_QUERY_RE, '?[query]')
    .replace(BEARER_RE, 'Bearer [token]')
    .replace(SECRET_KEY_RE, '[token]')
    .replace(JWT_RE, '[token]')
    .replace(EMAIL_RE, '[email]')
    .replace(UUID_IN_TEXT_RE, '[uuid]')
    .replace(IPV6_CANDIDATE_RE, maskIpv6Candidate)
    .replace(IPV4_RE, '[ip]')
    .replace(PHONE_E164_RE, '[telefon]')
    .replace(PHONE_PL_LANDLINE_RE, '[telefon]')
    .replace(PHONE_PL_MOBILE_RE, '[telefon]')
    .replace(LONG_DIGITS_RE, '[liczba]');
}

/** Obcina do `max` znaków (łącznie ze znakiem „…”). */
export function truncate(text: string, max: number = MAX_MESSAGE_LENGTH): string {
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  return chars.slice(0, max - 1).join('') + '…';
}

/** Maskowanie i obcięcie komunikatu. Maskujemy przed obcięciem, żeby nie zostawić połówki sekretu. */
export function maskMessage(text: string): string {
  return truncate(maskText(text).trim());
}

// --- Ścieżka -----------------------------------------------------------------

function safeDecode(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

function maskSegment(segment: string): string {
  if (segment === '') return segment;
  const decoded = safeDecode(segment);
  if (decoded === null) return ':id';
  if (UUID_RE.test(decoded) || /^\d+$/.test(decoded)) return ':id';
  // Znaki spoza zwykłego sluga (np. @, spacje) albo długi ciąg z cyframi
  // wyglądający na token — też :id, żeby e-mail czy token w ścieżce nie wyciekł.
  if (!SAFE_SEGMENT_RE.test(decoded)) return ':id';
  if (decoded.length >= 20 && /\d/.test(decoded)) return ':id';
  return decoded;
}

/** Ścieżka z requestUrl: bez schematu, hosta, query i fragmentu; UUID i liczby → :id. */
export function sanitizePath(requestUrl: string): string | null {
  const withoutHost = requestUrl.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i, '');
  const pathOnly = withoutHost.split(/[?#]/, 1)[0] ?? '';
  if (!pathOnly.startsWith('/')) return pathOnly === '' ? '/' : null;
  const masked = pathOnly.split('/').map(maskSegment).join('/');
  return truncate(masked, MAX_PATH_LENGTH);
}

// --- Wpis ------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseLatencyMs(latency: unknown): number | null {
  if (typeof latency === 'string') {
    const m = /^(\d+(?:\.\d+)?)s$/.exec(latency);
    return m?.[1] ? Math.round(Number(m[1]) * 1000) : null;
  }
  if (isRecord(latency)) {
    const seconds = Number(latency.seconds ?? 0);
    const nanos = Number(latency.nanos ?? 0);
    if (Number.isFinite(seconds) && Number.isFinite(nanos)) {
      return Math.round(seconds * 1000 + nanos / 1e6);
    }
  }
  return null;
}

function pickMessage(raw: Record<string, unknown>): string | null {
  if (typeof raw.textPayload === 'string') return maskMessage(raw.textPayload);
  if (isRecord(raw.jsonPayload) && typeof raw.jsonPayload.message === 'string') {
    return maskMessage(raw.jsonPayload.message);
  }
  return null;
}

/**
 * Buduje bezpieczny wpis z surowego wpisu gcloud. Zwraca null, gdy wpis nie
 * jest obiektem albo nie ma poprawnego znacznika czasu.
 */
export function toSafeEntry(raw: unknown): SafeLogEntry | null {
  try {
    if (!isRecord(raw)) return null;
    if (typeof raw.timestamp !== 'string' || !TIMESTAMP_RE.test(raw.timestamp)) return null;

    const http = isRecord(raw.httpRequest) ? raw.httpRequest : {};
    const resource = isRecord(raw.resource) ? raw.resource : {};
    const resourceLabels = isRecord(resource.labels) ? resource.labels : {};

    const severity =
      typeof raw.severity === 'string' && SEVERITIES.has(raw.severity) ? raw.severity : null;
    const revision =
      typeof resourceLabels.revision_name === 'string' &&
      REVISION_RE.test(resourceLabels.revision_name)
        ? resourceLabels.revision_name
        : null;
    const statusNum = Number(http.status);
    const status =
      http.status !== undefined && Number.isInteger(statusNum) && statusNum >= 100 && statusNum <= 599
        ? statusNum
        : null;
    const method =
      typeof http.requestMethod === 'string' && METHODS.has(http.requestMethod)
        ? http.requestMethod
        : null;
    const path = typeof http.requestUrl === 'string' ? sanitizePath(http.requestUrl) : null;

    return {
      timestamp: raw.timestamp,
      severity,
      revision,
      status,
      method,
      path,
      latencyMs: parseLatencyMs(http.latency),
      message: pickMessage(raw),
    };
  } catch {
    return null;
  }
}

// --- Formatowanie --------------------------------------------------------------

export function formatText(entry: SafeLogEntry | null): string {
  if (entry === null) return SKIPPED_LINE;
  return OUTPUT_FIELDS.map((field) => {
    const value = entry[field];
    return value === null || value === '' ? EMPTY_FIELD : String(value);
  }).join('\t');
}

export function formatJson(entry: SafeLogEntry | null): string {
  if (entry === null) return JSON.stringify({ skipped: true, message: SKIPPED_LINE });
  const ordered: Record<string, unknown> = {};
  for (const field of OUTPUT_FIELDS) ordered[field] = entry[field];
  return JSON.stringify(ordered);
}

export class LogInputError extends Error {}

/**
 * Całe wejście (tekst JSON z gcloud) → linie wyjścia. Puste wejście albo
 * pusta tablica → brak linii. Wejście, które nie jest tablicą JSON, rzuca
 * LogInputError z ogólnym komunikatem (bez fragmentu surowego tekstu).
 */
export function processLogInput(input: string, options: { json: boolean }): string[] {
  if (input.trim() === '') return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    throw new LogInputError('Wejście nie jest poprawnym JSON-em (oczekiwano --format=json).');
  }
  if (!Array.isArray(parsed)) {
    throw new LogInputError('Wejście nie jest tablicą JSON (oczekiwano --format=json).');
  }
  const format = options.json ? formatJson : formatText;
  return parsed.map((raw) => format(toSafeEntry(raw)));
}
