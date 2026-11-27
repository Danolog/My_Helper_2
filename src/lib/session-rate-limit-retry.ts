/**
 * Łagodna obsługa 429 na GET /api/auth/get-session po stronie klienta.
 *
 * Better Auth 1.7.x przy błędzie innym niż 401 zachowuje już wczytaną sesję
 * w useSession(), ale przy PIERWSZYM pobraniu (data === null) 429 daje
 * `data: null, isPending: false`. Strony biorą to za brak logowania:
 * portal klienta robi router.push na /portal/login (a logowanie po stronie serwera
 * widzi ważną sesję i odsyła dalej), panel się nie renderuje.
 *
 * Ta nakładka na fetch (fetchOptions.customFetchImpl w auth-client) przy 429
 * na GET get-session czeka X-Retry-After (1–10 s) i ponawia, maks. 2 razy.
 * Przez ten czas useSession() zostaje w stanie isPending (ładowanie), więc
 * nikt nie jest wylogowywany. Odrzucone żądania nie przesuwają okna limitu
 * Better Auth (decideConsume nie zmienia lastRequest przy odmowie), więc
 * ponowienie po X-Retry-After przechodzi.
 *
 * Celowo NIE ponawia niczego innego: logowanie/rejestracja z 429 muszą trafić
 * do formularza (inaczej ukrylibyśmy limit prób), POST get-session
 * (odświeżenie) nie jest idempotentny w sensie skutków ubocznych.
 */

const SESSION_PATH = "/get-session";
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_DELAY_MS = 1_000;
const MAX_DELAY_MS = 10_000;

type Sleep = (ms: number, signal?: AbortSignal | null) => Promise<void>;

const defaultSleep: Sleep = (ms, signal) =>
  new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const id = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(id);
        resolve();
      },
      { once: true }
    );
  });

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  const method = init?.method ?? (input instanceof Request ? input.method : "GET");
  return method.toUpperCase();
}

function isSessionGet(input: RequestInfo | URL, init?: RequestInit): boolean {
  if (requestMethod(input, init) !== "GET") return false;
  try {
    const { pathname } = new URL(requestUrl(input), "http://localhost");
    return pathname.endsWith(SESSION_PATH);
  } catch {
    return false;
  }
}

/** X-Retry-After w sekundach → ms, z ograniczeniem do 1–10 s. */
export function retryDelayMs(response: Response): number {
  const raw = response.headers.get("x-retry-after") ?? response.headers.get("retry-after");
  const seconds = raw === null ? Number.NaN : Number(raw);
  if (!Number.isFinite(seconds) || seconds <= 0) return DEFAULT_DELAY_MS;
  return Math.min(Math.ceil(seconds * 1000), MAX_DELAY_MS);
}

export function createSessionRateLimitRetryFetch(options?: {
  baseFetch?: typeof fetch;
  sleep?: Sleep;
  maxRetries?: number;
}): typeof fetch {
  const sleep = options?.sleep ?? defaultSleep;
  const maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES;

  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const baseFetch = options?.baseFetch ?? fetch;
    let response = await baseFetch(input, init);
    if (!isSessionGet(input, init)) return response;

    const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    for (let attempt = 0; attempt < maxRetries && response.status === 429; attempt++) {
      await sleep(retryDelayMs(response), signal);
      if (signal?.aborted) return response;
      response = await baseFetch(input, init);
    }
    return response;
  };
}
