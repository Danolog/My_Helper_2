/**
 * Maskowanie wpisów logów Cloud Run (wyjście `gcloud logging read --format=json`).
 *
 * Czyste funkcje, bez I/O. Zasada: biała lista pól wyjścia. Z wpisu bierzemy
 * tylko pola z SafeLogEntry, każde zwalidowane albo zamaskowane. Wszystko inne
 * (IP, user agent, referer, trace, labels, insertId, pełny jsonPayload czy
 * protoPayload) nigdy nie trafia na wyjście, bo nie jest nigdzie kopiowane.
 *
 * Pole `message` jest domyślnie wyłączone: pojawia się tylko z opcją
 * `message: true` (flaga `--message` w read.ts). To wolny tekst i maskowanie
 * nie wyłapie w nim imion, nazwisk ani adresów.
 *
 * Wpis, którego nie da się bezpiecznie odczytać, daje SKIPPED_LINE, nigdy
 * surowy tekst.
 */
import { isIPv6 } from 'node:net';

export const SKIPPED_LINE = '[pominięty wpis]';
export const MAX_MESSAGE_LENGTH = 300;
const MAX_PATH_LENGTH = 200;
// Górna granica długości tekstu przed maskowaniem — ogranicza koszt wyrażeń regularnych.
const MAX_RAW_LENGTH = 4000;
const EMPTY_FIELD = '-';

export interface SafeLogEntry {
  timestamp: string;
  severity: string | null;
  revision: string | null;
  status: number | null;
  method: string | null;
  path: string | null;
  latencyMs: number | null;
  /** Obecne tylko przy opcji `message: true`. */
  message?: string | null;
}

export interface OutputOptions {
  /** Dołącz zamaskowane pole `message`. Domyślnie false. */
  message?: boolean;
}

/** Kolejność pól na wyjściu bez `message` (tryb domyślny). */
export const BASE_FIELDS = [
  'timestamp',
  'severity',
  'revision',
  'status',
  'method',
  'path',
  'latencyMs',
] as const satisfies readonly (keyof SafeLogEntry)[];

/** Kolejność pól na wyjściu z `message` (opcja `message: true`). */
export const OUTPUT_FIELDS = [...BASE_FIELDS, 'message'] as const satisfies readonly (keyof SafeLogEntry)[];

export function outputFields(options: OutputOptions = {}): readonly (keyof SafeLogEntry)[] {
  return options.message === true ? OUTPUT_FIELDS : BASE_FIELDS;
}

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

// Kolejność reguł w maskText ma znaczenie: najpierw całe konstrukcje z sekretem
// (dane logowania w URI, query, nagłówki, klucze z prefiksem, pary klucz=wartość),
// potem e-mail i identyfikatory, na końcu IP, telefony i liczby. Dzięki temu
// reguła IP nie zostawi hasła z URI, a reguła liczb nie zostawi prefiksu klucza.

const PERCENT_RUN_RE = /(?:%[0-9A-Fa-f]{2})+/g;
// schemat://user:hasło@ → schemat://[dane]@ (do ostatniego @ przed /, ? lub #).
const URI_CREDENTIALS_RE = /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/?#]+@/gi;
const URL_WITH_QUERY_RE = /\bhttps?:\/\/[^\s"'<>`]*\?[^\s"'<>`]*/gi;
const BARE_QUERY_RE = /\?[^\s"'<>`=&?]+=[^\s"'<>`]*/g;
const COOKIE_HEADER_RE = /\b((?:set-)?cookie)(\s*[:=]\s*)[^\s;]+(?:;\s*[^\s;]+)*/gi;
const BEARER_RE = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const AUTHORIZATION_BASIC_RE = /\b(authorization\s*[:=]\s*)Basic\s+\S+/gi;
// Samo „Basic <base64>” — tylko gdy wartość ma cyfrę, +, / lub =, żeby nie
// maskować zwykłych zdań w rodzaju „Basic plan”.
const BASIC_RE = /\bBasic\s+(?=[A-Za-z0-9+/]*[0-9+/=])[A-Za-z0-9+/]{4,}=*/g;
const JWT_RE = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g;
// Klucze dostawców: znany prefiks plus ciąg znaków klucza.
const PROVIDER_KEY_RE =
  /(?<![A-Za-z0-9])(?:(?:sk|rk|pk|whsec|gh[pousr]|github_pat|glpat|xox[abprs])[_-][A-Za-z0-9_-]+|re_(?=[A-Za-z_-]*\d)[A-Za-z0-9_-]{8,}|AIza[0-9A-Za-z_-]{20,}|ya29\.[0-9A-Za-z_-]+|AKIA[0-9A-Z]{16})/g;
// klucz=wartość / klucz: wartość; wartość maskowana, gdy nazwa klucza wskazuje na sekret.
const KEY_VALUE_RE =
  /(?<![\w.-])([\w.-]+)("?\s*[=:]\s*)("[^"]*"|'[^']*'|(?!Bearer\b|Basic\b|\[)[^\s,;&"'<>]+)/g;
const SECRET_KEY_NAME_RE =
  /session|token(?!s)|passw(?:or)?d|pwd|secret|api[_-]?key|authorization|cookie|credential|(?:^|[_.-])sid$/i;
const EMAIL_RE =
  /(?<![\p{L}\p{N}._%+-])[\p{L}\p{N}_.%+-]+(?:@|%40)[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.(?:\p{L}{2,}|xn--[\p{L}\p{N}-]+)/giu;
const UUID_IN_TEXT_RE =
  /(?<![0-9a-f])[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?![0-9a-f])/gi;
const UUID_COMPACT_RE = /(?<![0-9a-z])[0-9a-f]{32}(?![0-9a-z])/gi;
// Ciąg alfanumeryczny ≥ 20 znaków; maskowany, gdy ma i cyfry, i litery.
const LONG_ALNUM_RE = /(?<![A-Za-z0-9])[A-Za-z0-9]{20,}(?![A-Za-z0-9])/g;
// Ciąg znaków, z których składa się IPv6; dalej sprawdza go isIPv6.
const IPV6_RUN_RE = /(?<![0-9a-f.:])[0-9a-f.:]+/gi;
const IPV4_RE = /(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?!\d|\.\d)/g;
// Telefon: 9-15 cyfr przedzielanych tylko spacją, myślnikiem, kropką lub nawiasem.
// Nie zaczyna się na dacie (2026-11-27, 27.11.2026), żeby „data godzina” nie była telefonem.
const PHONE_RE =
  /(?<![\d+])(?!\d{4}-\d{2}-\d{2}(?!\d)|\d{2}[.-]\d{2}[.-]\d{4}(?!\d))(?:\+|\(\+?)?\d(?:[\s().-]{0,3}\d){8,14}(?!\d)/g;
const LONG_DIGITS_RE = /\d{9,}/g;

/** Przycina bardzo długi tekst przed maskowaniem, bez niepełnego ostatniego słowa. */
function capRawLength(text: string): string {
  if (text.length <= MAX_RAW_LENGTH) return text;
  let end = MAX_RAW_LENGTH;
  while (end > 0 && !/\s/.test(text[end - 1] ?? ' ')) end--;
  return text.slice(0, end) + '…';
}

/** Dekoduje sekwencje %XX (do trzech przebiegów), bez wyjątku przy błędnym kodowaniu. */
function decodePercent(text: string): string {
  let out = text;
  for (let pass = 0; pass < 3; pass++) {
    const next = out.replace(PERCENT_RUN_RE, (run) => {
      try {
        return decodeURIComponent(run);
      } catch {
        // Błędna sekwencja UTF-8 — dekodujemy przynajmniej znaki ASCII (np. %40).
        return run.replace(/%([0-7][0-9A-Fa-f])/g, (_m, hex: string) =>
          String.fromCharCode(parseInt(hex, 16)),
        );
      }
    });
    if (next === out) break;
    out = next;
  }
  return out;
}

function isControlChar(code: number): boolean {
  return (
    code < 0x20 ||
    (code >= 0x7f && code <= 0x9f) || // DEL i cały zakres C1 (w tym U+0085)
    code === 0x2028 ||
    code === 0x2029 ||
    (code >= 0x202a && code <= 0x202e) || // znaki kierunku tekstu
    (code >= 0x2066 && code <= 0x2069)
  );
}

/** Zamienia znaki sterujące (C0, DEL, C1, separatory linii) na spację — jedna linia na wpis. */
function flattenControlChars(text: string): string {
  let out = '';
  for (const ch of text) {
    out += isControlChar(ch.codePointAt(0) ?? 0) ? ' ' : ch;
  }
  return out;
}

function maskKeyValue(_match: string, key: string, sep: string, value: string): string {
  if (SECRET_KEY_NAME_RE.test(key)) return `${key}${sep}[token]`;
  // Klucz zwykły — wartość może zawierać kolejną parę (a=token=x).
  return key + sep + value.replace(KEY_VALUE_RE, maskKeyValue);
}

function maskLongAlnum(match: string): string {
  return /\d/.test(match) && /[A-Za-z]/.test(match) ? '[id]' : match;
}

function maskIpv6Run(run: string, offset: number, whole: string): string {
  if (!run.includes(':')) return run;
  const next = whole[offset + run.length];
  // Ciąg dalej przechodzi w słowo (np. „std::cout”) — to nie adres.
  if (next !== undefined && /[\p{L}\p{N}_]/u.test(next)) return run;
  const prev = offset > 0 ? whole[offset - 1] : undefined;
  const glued = prev !== undefined && /[\p{L}\p{N}]/u.test(prev);
  let end = run.length;
  while (end > 0 && run[end - 1] === '.') end--;
  const core = run.slice(0, end);
  const tail = run.slice(end);
  for (let start = 0; start < core.length; start++) {
    if (start > 0 && core[start - 1] !== ':') continue;
    // Ciąg przyklejony do słowa (np. „Cache::add”): adres może zaczynać się tylko po dwukropku.
    if (start === 0 && glued && core[0] !== ':') continue;
    let candidate = core.slice(start);
    if (candidate.endsWith(':') && !candidate.endsWith('::')) candidate = candidate.slice(0, -1);
    if (isIPv6(candidate) && candidate.split(':').filter(Boolean).length >= 2) {
      return core.slice(0, start) + '[ip]' + core.slice(start + candidate.length) + tail;
    }
  }
  return run;
}

function maskPhone(match: string): string {
  const separated = /[\s().-]/.test(match) || match.startsWith('+');
  const digits = match.replace(/\D/g, '');
  // Ciągły ciąg cyfr, który nie wygląda na numer PL, zostaje dla reguły [liczba].
  if (!separated && digits.length !== 9 && !/^(?:00)?48\d{9}$/.test(digits)) return match;
  return '[telefon]';
}

/** Maskuje dane wrażliwe w tekście, bez obcinania do limitu wyjścia. */
export function maskText(text: string): string {
  return flattenControlChars(decodePercent(capRawLength(text)))
    .replace(URI_CREDENTIALS_RE, '$1[dane]@')
    .replace(URL_WITH_QUERY_RE, '[url]')
    .replace(BARE_QUERY_RE, '?[query]')
    .replace(COOKIE_HEADER_RE, '$1$2[cookie]')
    .replace(BEARER_RE, 'Bearer [token]')
    .replace(AUTHORIZATION_BASIC_RE, '$1Basic [token]')
    .replace(BASIC_RE, 'Basic [token]')
    .replace(JWT_RE, '[token]')
    .replace(PROVIDER_KEY_RE, '[token]')
    .replace(KEY_VALUE_RE, maskKeyValue)
    .replace(EMAIL_RE, '[email]')
    .replace(UUID_IN_TEXT_RE, '[uuid]')
    .replace(UUID_COMPACT_RE, '[uuid]')
    .replace(LONG_ALNUM_RE, maskLongAlnum)
    .replace(IPV6_RUN_RE, maskIpv6Run)
    .replace(IPV4_RE, '[ip]')
    .replace(PHONE_RE, maskPhone)
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
  // Telefon, IP albo inny numer: co najmniej 6 cyfr, cyfry rozdzielone myślnikami
  // lub kropkami, albo cokolwiek, co zmieniłoby maskowanie tekstu.
  if ((decoded.match(/\d/g)?.length ?? 0) >= 6) return ':id';
  if (/\d+(?:[.-]\d+){2,}/.test(decoded)) return ':id';
  if (maskText(decoded) !== decoded) return ':id';
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
 * jest obiektem albo nie ma poprawnego znacznika czasu. Pole `message` jest
 * dodawane tylko przy `options.message === true`.
 */
export function toSafeEntry(raw: unknown, options: OutputOptions = {}): SafeLogEntry | null {
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

    const entry: SafeLogEntry = {
      timestamp: raw.timestamp,
      severity,
      revision,
      status,
      method,
      path,
      latencyMs: parseLatencyMs(http.latency),
    };
    if (options.message === true) entry.message = pickMessage(raw);
    return entry;
  } catch {
    return null;
  }
}

// --- Formatowanie --------------------------------------------------------------

export function formatText(entry: SafeLogEntry | null, options: OutputOptions = {}): string {
  if (entry === null) return SKIPPED_LINE;
  return outputFields(options)
    .map((field) => {
      const value = entry[field];
      return value === null || value === undefined || value === '' ? EMPTY_FIELD : String(value);
    })
    .join('\t');
}

export function formatJson(entry: SafeLogEntry | null, options: OutputOptions = {}): string {
  if (entry === null) return JSON.stringify({ skipped: true, message: SKIPPED_LINE });
  const ordered: Record<string, unknown> = {};
  for (const field of outputFields(options)) ordered[field] = entry[field] ?? null;
  return JSON.stringify(ordered);
}

export class LogInputError extends Error {}

/**
 * Całe wejście (tekst JSON z gcloud) → linie wyjścia. Puste wejście albo
 * pusta tablica → brak linii. Wejście, które nie jest tablicą JSON, rzuca
 * LogInputError z ogólnym komunikatem (bez fragmentu surowego tekstu).
 */
export function processLogInput(
  input: string,
  options: { json: boolean; message?: boolean },
): string[] {
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
  const outputOptions: OutputOptions = { message: options.message === true };
  const format = options.json ? formatJson : formatText;
  return parsed.map((raw) => format(toSafeEntry(raw, outputOptions), outputOptions));
}
