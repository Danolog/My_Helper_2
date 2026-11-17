/**
 * Wyjście systemowe (#193): liczniki limitu prób logowania w tabeli
 * `auth_rate_limit`, wspólne dla wszystkich instancji aplikacji. Używane tylko
 * w trybie `AUTH_RATE_LIMIT_STORE=database` (fabryka `@/lib/auth-rate-limit-options`).
 *
 * Dwa liczniki w jednej tabeli, rozdzielone kluczem (`@/lib/auth-throttle-keys`,
 * HMAC z osobnymi etykietami; w tabeli nie ma adresu IP ani e-maila):
 *
 * 1. Licznik adresu (`consumeAuthRateLimit`) — magazyn limitu Better Auth
 *    (`rateLimit.customStorage`). Domyślnie liczy baza jednym atomowym UPSERT
 *    (okno stałe liczone od pierwszego żądania w oknie). Pamięć procesu liczy
 *    wyłącznie zamkniętą listę ścieżek `@/lib/auth-rate-limit-paths` (m.in. odczyt
 *    sesji) — bez zapytań do bazy przy każdym takim żądaniu. Każda inna ścieżka,
 *    także nieznana, idzie do bazy.
 *
 * 2. Licznik konta (`reserveAccountSignInAttempt`, `clearSignInFailures`) —
 *    każda próba logowania e-mailem rezerwuje miejsce PRZED sprawdzeniem hasła
 *    jednym atomowym UPSERT; ponad próg w oknie → blokada stała. Zerowanie
 *    (usunięcie wiersza) tylko po udanym logowaniu, po odmowie „e-mail
 *    niezweryfikowany" (hasło było poprawne) i po resecie hasła.
 *
 *    Rezerwacja, po której nie przyszło zerowanie (wyjątek, przerwane żądanie,
 *    padnięty proces), zostaje w liczniku jak porażka. To zamierzone — nie
 *    zmieniać na fail-open.
 *
 * Fail-closed: błąd bazy przy liczeniu = odmowa. Logi zawierają wyłącznie
 * ścieżkę albo nazwę operacji i nazwę błędu — nigdy adres, e-mail ani klucz.
 */
import { DrizzleQueryError, sql } from "drizzle-orm";
import { isMemoryCountedPath } from "@/lib/auth-rate-limit-paths";
import { accountThrottleKey, ipThrottleKey } from "@/lib/auth-throttle-keys";
import { logger } from "@/lib/logger";
import { dbSystem } from "./db-system";

const ACCOUNT_WINDOW_SEC = 15 * 60;
const ACCOUNT_MAX_ATTEMPTS = 10;
const ACCOUNT_BLOCK_SEC = 15 * 60;

const RETENTION_DELETE_LIMIT = 100;
const MEMORY_MAX_ENTRIES = 100_000;
/** Pełne sprzątanie mapy co tyle wywołań (albo po przekroczeniu MEMORY_MAX_ENTRIES). */
const MEMORY_SWEEP_EVERY = 1_000;

let cachedSecret: string | undefined;

/** Sekret auth czytany raz; brak → wyjątek (łapany niżej jako odmowa). */
function getSecret(): string {
  if (cachedSecret === undefined) {
    const secret = process.env.BETTER_AUTH_SECRET;
    if (!secret) throw new Error("BETTER_AUTH_SECRET is not set");
    cachedSecret = secret;
  }
  return cachedSecret;
}

/**
 * Sama nazwa klasy błędu do logu — nigdy message, params ani cause (message
 * DrizzleQueryError zawiera parametry zapytania). DrizzleQueryError nie ustawia
 * `name` (dziedziczy "Error"), więc rozpoznawany jawnie — nazwa konstruktora
 * nie przetrwałaby minifikacji; inne klasy bez własnego `name` → nazwa konstruktora.
 */
function errorName(err: unknown): string {
  if (!(err instanceof Error)) return "UnknownError";
  if (err instanceof DrizzleQueryError) return "DrizzleQueryError";
  return err.name === "Error" && err.constructor?.name ? err.constructor.name : err.name;
}

/**
 * Ścieżka z klucza biblioteki `<adres>|<ścieżka>` — po PIERWSZYM „|” (adres, także
 * IPv6 i „no-trusted-ip”, nie zawiera „|”; ścieżka może). Kształt klucza przypięty
 * testem na prawdziwej instancji Better Auth.
 */
function pathOfLibraryKey(libraryKey: string): string {
  return libraryKey.slice(libraryKey.indexOf("|") + 1);
}

/** Ścieżka do logu: trasa z tokenem w adresie (`/reset-password/:token`) jako szablon. */
function logPathOf(path: string): string {
  return path.startsWith("/reset-password/") ? "/reset-password/:token" : path;
}

// ── Licznik w pamięci procesu dla zamkniętej listy ścieżek (semantyka jak magazyn
//    pamięciowy biblioteki: okno od ostatniego dozwolonego żądania). ──────────

const memory = new Map<string, { count: number; lastRequest: number; expiresAt: number }>();
let callsSinceSweep = 0;

/**
 * Sprzątanie zamortyzowane: wygasły wpis jest pomijany przy odczycie (consumeInMemory),
 * a pełny przebieg mapy idzie co MEMORY_SWEEP_EVERY wywołań albo gdy mapa przekroczy
 * MEMORY_MAX_ENTRIES — nie przy każdym żądaniu (odczyt sesji to najczęstsze żądanie).
 *
 * Po przekroczeniu limitu wypierane są najdawniej dodane klucze. Zalew żądań z wielu
 * różnych adresów może więc wyzerować czyjś licznik — dotyczy to WYŁĄCZNIE ścieżek
 * z zamkniętej listy pamięci (np. odczyt sesji); pozostałe ścieżki i licznik konta liczy baza.
 * Ocena, czy to wystarcza: CTO (przegląd tego PR).
 */
function pruneMemory(now: number): void {
  if (++callsSinceSweep < MEMORY_SWEEP_EVERY && memory.size <= MEMORY_MAX_ENTRIES) return;
  callsSinceSweep = 0;
  for (const [k, e] of memory) if (now >= e.expiresAt) memory.delete(k);
  if (memory.size <= MEMORY_MAX_ENTRIES) return;
  let overflow = memory.size - MEMORY_MAX_ENTRIES;
  for (const k of memory.keys()) {
    memory.delete(k);
    if (--overflow <= 0) break;
  }
}

function consumeInMemory(libraryKey: string, rule: { window: number; max: number }) {
  const now = Date.now();
  pruneMemory(now);
  const windowMs = rule.window * 1000;
  const entry = memory.get(libraryKey);
  const data = entry && now < entry.expiresAt ? entry : undefined;
  if (data && now - data.lastRequest < windowMs && data.count >= rule.max) {
    return { allowed: false, retryAfter: Math.ceil((data.lastRequest + windowMs - now) / 1000) };
  }
  const count = !data || now - data.lastRequest >= windowMs ? 1 : data.count + 1;
  memory.set(libraryKey, { count, lastRequest: now, expiresAt: now + windowMs });
  return { allowed: true, retryAfter: null };
}

/**
 * Wiersz z UPSERT … RETURNING. Decyzję o blokadzie (`blocked`) i czas do końca
 * blokady albo okna (`retry_after`, w sekundach, co najmniej 1) liczy SQL —
 * czas blokady liczony zegarem bazy; aplikacja tylko je czyta.
 */
type CounterRow = { count: number; blocked?: boolean | null; retry_after: number | string | null };

function firstRow(result: unknown): CounterRow | undefined {
  return (result as ArrayLike<CounterRow> | undefined)?.[0];
}

/** `retry_after` z wiersza; brak albo wartość nieliczbowa → `fallback`. */
function retryAfterOf(r: CounterRow, fallback: number): number {
  const n = Number(r.retry_after);
  return r.retry_after !== null && Number.isFinite(n) && n >= 1 ? n : fallback;
}

/**
 * Magazyn limitu adresu dla Better Auth (`rateLimit.customStorage.consume`).
 * Ścieżka spoza listy pamięci → atomowy UPSERT w bazie, potem ograniczone kasowanie
 * wierszy starszych niż 24 h (osobna instrukcja; jej błąd nie zmienia wyniku).
 */
export async function consumeAuthRateLimit(
  key: string,
  rule: { window: number; max: number },
): Promise<{ allowed: boolean; retryAfter: number | null }> {
  const path = pathOfLibraryKey(key);
  if (isMemoryCountedPath(path)) return consumeInMemory(key, rule);

  let row: CounterRow | undefined;
  try {
    const hashed = ipThrottleKey(key, getSecret());
    const result = await dbSystem.execute(sql`
      INSERT INTO auth_rate_limit (key, count, window_start, updated_at)
      VALUES (${hashed}, 1, now(), now())
      ON CONFLICT (key) DO UPDATE SET
        count = CASE WHEN auth_rate_limit.window_start <= now() - make_interval(secs => ${rule.window})
                     THEN 1 ELSE auth_rate_limit.count + 1 END,
        window_start = CASE WHEN auth_rate_limit.window_start <= now() - make_interval(secs => ${rule.window})
                     THEN now() ELSE auth_rate_limit.window_start END,
        updated_at = now()
      RETURNING count,
        GREATEST(1, CEIL(EXTRACT(EPOCH FROM window_start + make_interval(secs => ${rule.window}) - now())))::int AS retry_after`);
    row = firstRow(result);
    if (!row) throw new Error("auth rate limit upsert returned no row");
  } catch (err) {
    logger.error("auth rate limit store error", { path: logPathOf(path), error: errorName(err) });
    return { allowed: false, retryAfter: rule.window };
  }

  try {
    await dbSystem.execute(sql`
      DELETE FROM auth_rate_limit WHERE ctid IN (
        SELECT ctid FROM auth_rate_limit
        WHERE updated_at < now() - interval '24 hours'
        LIMIT ${sql.raw(String(RETENTION_DELETE_LIMIT))} FOR UPDATE SKIP LOCKED)`);
  } catch (err) {
    logger.error("auth rate limit retention error", { error: errorName(err) });
  }

  if (Number(row.count) <= rule.max) return { allowed: true, retryAfter: null };
  return { allowed: false, retryAfter: retryAfterOf(row, rule.window) };
}

/**
 * Rezerwacja próby logowania na konto — jeden atomowy UPSERT przed sprawdzeniem hasła:
 * - trwająca blokada → bez zmiany licznika, odmowa;
 * - blokada minęła albo okno wygasło → nowe okno od tej próby;
 * - inaczej licznik +1; przekroczenie progu ustawia blokadę stałą, odmowa.
 * Decyzja i czas do końca blokady przychodzą z RETURNING (czas blokady liczony zegarem bazy).
 * Błąd albo brak wiersza → odmowa (fail-closed).
 */
export async function reserveAccountSignInAttempt(
  email: string,
): Promise<{ allowed: boolean; retryAfter: number | null }> {
  try {
    const hashed = accountThrottleKey(email, getSecret());
    const result = await dbSystem.execute(sql`
      INSERT INTO auth_rate_limit (key, count, window_start, blocked_until, updated_at)
      VALUES (${hashed}, 1, now(), NULL, now())
      ON CONFLICT (key) DO UPDATE SET
        count = CASE
          WHEN auth_rate_limit.blocked_until > now() THEN auth_rate_limit.count
          WHEN auth_rate_limit.blocked_until IS NOT NULL
            OR auth_rate_limit.window_start <= now() - make_interval(secs => ${ACCOUNT_WINDOW_SEC}) THEN 1
          ELSE auth_rate_limit.count + 1 END,
        window_start = CASE
          WHEN auth_rate_limit.blocked_until > now() THEN auth_rate_limit.window_start
          WHEN auth_rate_limit.blocked_until IS NOT NULL
            OR auth_rate_limit.window_start <= now() - make_interval(secs => ${ACCOUNT_WINDOW_SEC}) THEN now()
          ELSE auth_rate_limit.window_start END,
        blocked_until = CASE
          WHEN auth_rate_limit.blocked_until > now() THEN auth_rate_limit.blocked_until
          WHEN auth_rate_limit.blocked_until IS NOT NULL
            OR auth_rate_limit.window_start <= now() - make_interval(secs => ${ACCOUNT_WINDOW_SEC}) THEN NULL
          WHEN auth_rate_limit.count + 1 > ${ACCOUNT_MAX_ATTEMPTS}
            THEN now() + make_interval(secs => ${ACCOUNT_BLOCK_SEC})
          ELSE NULL END,
        updated_at = now()
      RETURNING count,
        (blocked_until > now()) AS blocked,
        GREATEST(1, CEIL(EXTRACT(EPOCH FROM blocked_until - now())))::int AS retry_after`);
    const row = firstRow(result);
    if (!row) throw new Error("account throttle upsert returned no row");
    if (row.blocked === true) return { allowed: false, retryAfter: retryAfterOf(row, ACCOUNT_BLOCK_SEC) };
    return { allowed: true, retryAfter: null };
  } catch (err) {
    logger.error("auth rate limit store error", { path: "/sign-in/email", error: errorName(err) });
    return { allowed: false, retryAfter: ACCOUNT_BLOCK_SEC };
  }
}

/**
 * Zerowanie licznika konta (usunięcie wiersza). Wyjście kasujące dane (L7).
 * Błąd → log nazwy błędu; nie blokuje udanego logowania ani resetu hasła.
 */
export async function clearSignInFailures(email: string): Promise<{ cleared: boolean }> {
  try {
    const hashed = accountThrottleKey(email, getSecret());
    await dbSystem.execute(sql`DELETE FROM auth_rate_limit WHERE key = ${hashed}`);
    return { cleared: true };
  } catch (err) {
    logger.error("auth rate limit clear error", { error: errorName(err) });
    return { cleared: false };
  }
}
