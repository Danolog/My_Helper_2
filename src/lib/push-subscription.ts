/**
 * Walidacja subskrypcji Web Push (endpoint + klucze) — wspólna dla zapisu
 * (POST /api/push/subscribe) i wysyłki (lib/push.ts, lib/web-push.ts).
 *
 * Po co: `web-push` wysyła POST na host i port wzięte z `endpoint`
 * (url.parse + https.request). Bez allowlisty dowolne konto mogło zapisać
 * `endpoint` wskazujący na sieć wewnętrzną albo obcy serwer, a nasz serwer
 * robił tam żądanie przy każdej wysyłce: wyrocznia skanowania portów przez
 * POST /api/push/test, wieszanie cronów na blackhole IP, przekaźnik POST.
 *
 * Dlatego allowlista hostów usług push przeglądarek, nie denylista:
 *  - Chrome / Chromium (Opera, Samsung Internet, Brave, Vivaldi): FCM
 *    `fcm.googleapis.com`,
 *  - Firefox: `updates.push.services.mozilla.com`,
 *  - Safari (macOS 13+, iOS 16.4+): `web.push.apple.com` => sufiks `.push.apple.com`,
 *  - Edge: WNS `wns2-<region>.notify.windows.com` => sufiks `.notify.windows.com`.
 * Stary GCM (`android.googleapis.com/gcm/send`) wyłączony przez Google — poza listą.
 *
 * Adres musi być w postaci kanonicznej (jak isOwnBlobUrl z #46): tylko
 * `https://`, host złożony z małych liter ASCII, cyfr, `-` i `.` (bez
 * userinfo, portu, IP w nawiasach, trailing dot, IDN w Unicode), bez `\`
 * i fragmentu, a `new URL(endpoint).href === endpoint`. Wtedy url.parse
 * w web-push i WHATWG URL widzą ten sam host — nie ma różnicy parserów.
 * Query jest dozwolone (WNS ma `?token=`).
 */

/** Najdłuższy przyjmowany endpoint. WNS/APNs bywają dłuższe niż 200 znaków. */
export const PUSH_ENDPOINT_MAX_LENGTH = 2048;

/** Timeout gniazda dla web-push (opcja `timeout`, ms). */
export const PUSH_SEND_TIMEOUT_MS = 10_000;

/**
 * Twardy limit całej wysyłki (ms). Opcja `timeout` web-push to timeout
 * bezczynności gniazda — serwer sączący bajty mógłby go przeciągać. Ten limit
 * zwalnia pętlę wysyłki niezależnie od tego, co robi gniazdo.
 */
export const PUSH_SEND_DEADLINE_MS = 15_000;

/** Ile wysyłek naraz na jednego użytkownika (lib/push.ts). */
export const PUSH_SEND_CONCURRENCY = 5;

const EXACT_HOSTS: ReadonlySet<string> = new Set([
  "fcm.googleapis.com",
  "updates.push.services.mozilla.com",
]);

/** Sufiksy z wiodącą kropką: dopasowanie tylko całych etykiet DNS. */
const SUFFIX_HOSTS: readonly string[] = [".push.apple.com", ".notify.windows.com"];

const LABEL = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
// Host = co najmniej 2 etykiety, zaraz po nim ścieżka `/`. Brak `:`, `@`, `[`
// i wielkich liter w hoście; ścieżka z drukowalnego ASCII.
const ENDPOINT_SHAPE_RE = new RegExp(`^https://(${LABEL}(?:\\.${LABEL})+)/[\\x21-\\x7e]*$`);

const BASE64URL_RE = /^[A-Za-z0-9_-]+={0,2}$/;

export function isAllowedPushHost(hostname: string): boolean {
  if (EXACT_HOSTS.has(hostname)) return true;
  return SUFFIX_HOSTS.some(
    (suffix) => hostname.endsWith(suffix) && hostname.length > suffix.length
  );
}

export function isValidPushEndpoint(endpoint: unknown): endpoint is string {
  if (typeof endpoint !== "string") return false;
  if (endpoint.length === 0 || endpoint.length > PUSH_ENDPOINT_MAX_LENGTH) return false;
  if (endpoint.includes("\\") || endpoint.includes("#")) return false;

  const shape = ENDPOINT_SHAPE_RE.exec(endpoint);
  if (!shape) return false;
  const host = shape[1] ?? "";

  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    return false;
  }

  return (
    parsed.protocol === "https:" &&
    parsed.username === "" &&
    parsed.password === "" &&
    parsed.port === "" &&
    parsed.hash === "" &&
    // host z regexu i z parsera WHATWG muszą się zgadzać, a wejście być kanoniczne
    parsed.hostname === host &&
    parsed.href === endpoint &&
    isAllowedPushHost(parsed.hostname)
  );
}

function decodeBase64Url(value: unknown, maxLength: number): Buffer | null {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) return null;
  if (!BASE64URL_RE.test(value)) return null;
  return Buffer.from(value, "base64url");
}

/** p256dh: nieskompresowany punkt P-256 (65 bajtów, prefiks 0x04), RFC 8291. */
export function isValidP256dh(value: unknown): value is string {
  const buf = decodeBase64Url(value, 128);
  return buf !== null && buf.length === 65 && buf[0] === 0x04;
}

/** auth: sekret uwierzytelniający, 16 bajtów wg RFC 8291 (web-push wymaga >= 16). */
export function isValidPushAuth(value: unknown): value is string {
  const buf = decodeBase64Url(value, 128);
  return buf !== null && buf.length >= 16 && buf.length <= 64;
}

export function isValidPushSubscription(sub: {
  endpoint: unknown;
  p256dh: unknown;
  auth: unknown;
}): boolean {
  return isValidPushEndpoint(sub.endpoint) && isValidP256dh(sub.p256dh) && isValidPushAuth(sub.auth);
}

/**
 * Obietnica z twardym limitem czasu. Po przekroczeniu odrzuca błędem
 * `PushDeadlineError`; samego żądania nie przerywa (robi to `timeout` gniazda),
 * ale pętla wysyłki już na nie nie czeka.
 */
export class PushDeadlineError extends Error {
  constructor(ms: number) {
    super(`Push send exceeded ${ms} ms`);
    this.name = "PushDeadlineError";
  }
}

export function withPushDeadline<T>(promise: Promise<T>, ms: number = PUSH_SEND_DEADLINE_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new PushDeadlineError(ms)), ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

/** Uruchamia `worker` dla każdego elementu, najwyżej `limit` naraz. */
export async function runWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  let next = 0;
  const runners = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++] as T;
      await worker(item);
    }
  });
  await Promise.all(runners);
}
