/**
 * Guard bazy docelowej dla `scripts/seed-test.ts` i `__tests__/pg/pg-harness.ts`.
 *
 * Seed i testy integracyjne zapisują dane testowe. Mogą działać wyłącznie na
 * lokalnej bazie albo na kontenerze Postgresa w CI (`.github/workflows/quality-gate.yml`
 * łączy się przez `localhost:5432`, baza `pos_dev`). Każdy inny host, a jawnie Neon
 * (`*.neon.tech`) i środowiska Vercel `preview`/`production`, kończy się odmową.
 *
 * Trzy niezależne etapy:
 * 1. `checkSeedTarget(url)` sprawdza sam napis URL, zanim powstanie klient.
 *    Odrzuca m.in. authority z więcej niż jednym `@`, z przecinkiem albo z `#`
 *    (także po `decodeURIComponent`). WHATWG URL i postgres.js wyliczają host
 *    inaczej, więc taki URL może wskazywać różne hosty w zależności od parsera.
 * 2. `checkSeedClientOptions(sql.options)` sprawdza hosty, które postgres.js
 *    faktycznie wyliczył (`postgres(url).options`, bez łączenia się). Każdy
 *    musi być na allowliście, żaden nie może być Neonem, gniazdo unix
 *    (`options.path`) jest odrzucane.
 * 3. `checkSeedServerIdentity(wynik SEED_SERVER_PROBE_SQL)` sprawdza po połączeniu,
 *    ale przed pierwszym zapisem, co mówi o sobie serwer: nazwa bazy musi być na
 *    allowliście (`pos_dev`), a serwer nie może mieć ustawień `neon.*`. To jest
 *    obrona przed tunelem (`localhost:5433` → zdalna baza), którego etapy 1–2 nie
 *    widzą, bo host w URL naprawdę jest `localhost`.
 *
 * Funkcje są czyste: bez połączenia z bazą, bez `process.exit`. Zapytanie z etapu 3
 * wykonuje wywołujący. Komunikaty nigdy nie zawierają URL, użytkownika ani hasła,
 * najwyżej nazwy hostów i nazwę bazy.
 */

/**
 * Hosty, na których seed może działać. CI używa `localhost` (service container).
 * Bez `::1`: postgres.js 3.4.8 nie obsługuje literału IPv6 w URL (`[::1]` daje host `"["`).
 */
export const SEED_ALLOWED_HOSTS: readonly string[] = ["localhost", "127.0.0.1"];

/** Bazy, na których seed może pisać: `docker-compose.yml` i oba joby CI używają `pos_dev`. */
export const SEED_ALLOWED_DATABASES: readonly string[] = ["pos_dev"];

/**
 * Zapytanie tylko do odczytu dla etapu 3. Bez parametrów i bez danych wejściowych.
 * `neon_settings` > 0 oznacza serwer Neon (rozszerzenie Neon rejestruje ustawienia `neon.*`).
 */
export const SEED_SERVER_PROBE_SQL =
  "select current_database() as database, " +
  "(select count(*) from pg_settings where name like 'neon.%')::int as neon_settings";

/** Środowiska Vercel, w których seed nigdy nie działa, niezależnie od hosta. */
const FORBIDDEN_VERCEL_ENVS = new Set(["preview", "production"]);

export type SeedRejectCode =
  | "vercel_env"
  | "missing_url"
  | "not_a_postgres_url"
  | "ambiguous_authority"
  | "invalid_url"
  | "bad_scheme"
  | "no_host"
  | "ipv6"
  | "neon"
  | "host_not_allowed"
  | "unix_socket"
  | "client_no_host"
  | "database_not_allowed"
  | "server_unknown";

/** Co dokładnie było niejednoznaczne w authority (kod `ambiguous_authority`). */
export type AmbiguousPart = "multiple_at" | "comma" | "hash" | "bad_percent_encoding";

export type SeedReject = {
  ok: false;
  code: SeedRejectCode;
  reason: string;
  ambiguous?: AmbiguousPart[];
};

export type SeedTargetCheck = { ok: true; host: string } | SeedReject;
export type SeedClientCheck = { ok: true; hosts: string[] } | SeedReject;
export type SeedServerCheck = { ok: true; database: string } | SeedReject;

/** Kontekst komunikatów: który skrypt sprawdza i z której zmiennej wziął adres. */
export type SeedGuardContext = { subject?: string; varName?: string };

function ctxOf(ctx: SeedGuardContext = {}) {
  return { subject: ctx.subject ?? "seed", varName: ctx.varName ?? "POSTGRES_URL" };
}

function reject(code: SeedRejectCode, reason: string, ambiguous?: AmbiguousPart[]): SeedReject {
  return ambiguous ? { ok: false, code, reason, ambiguous } : { ok: false, code, reason };
}

function isNeon(host: string): boolean {
  return host === "neon.tech" || host.endsWith(".neon.tech");
}

/** Nazwa hosta do komunikatu. Wszystko, co nie wygląda na zwykły host, jest maskowane. */
function displayHost(host: string): string {
  return /^[a-z0-9.-]{1,253}$/.test(host) ? host : "<nieprawidłowy host>";
}

/** Nazwa bazy do komunikatu, z tą samą zasadą maskowania. */
function displayDatabase(name: string): string {
  return /^[A-Za-z0-9_.-]{1,63}$/.test(name) ? name : "<nieprawidłowa nazwa>";
}

/**
 * Część authority dokładnie tak, jak wycina ją postgres.js 3.4.8 (`parseUrl`):
 * od `://` do pierwszego `/` lub `?`. Bez cięcia na `#`, bo postgres.js na `#` nie tnie.
 * `null`, gdy w napisie nie ma `://`.
 */
function rawAuthority(connectionString: string): string | null {
  const start = connectionString.indexOf("://");
  if (start === -1) return null;
  return connectionString.slice(start + 3).split(/[?/]/)[0] ?? "";
}

/**
 * Zwraca niejednoznaczne elementy authority (pusta lista = OK). `#` też jest
 * niejednoznaczny: WHATWG URL zaczyna od niego fragment, a postgres.js traktuje
 * go jako część hosta.
 */
function ambiguousParts(authority: string): AmbiguousPart[] {
  let decoded: string | null;
  try {
    decoded = decodeURIComponent(authority);
  } catch {
    decoded = null;
  }
  const forms = decoded === null ? [authority] : [authority, decoded];
  const parts: AmbiguousPart[] = [];
  if (forms.some((s) => (s.match(/@/g)?.length ?? 0) > 1)) parts.push("multiple_at");
  if (forms.some((s) => s.includes(","))) parts.push("comma");
  if (forms.some((s) => s.includes("#"))) parts.push("hash");
  // Zepsute kodowanie procentowe: nie da się ustalić, co zobaczy postgres.js.
  if (decoded === null) parts.push("bad_percent_encoding");
  return parts;
}

const AMBIGUOUS_LABEL: Record<AmbiguousPart, string> = {
  multiple_at: "więcej niż jeden znak małpy",
  comma: "przecinek (lista hostów)",
  hash: "znak krzyżyka",
  bad_percent_encoding: "zepsute kodowanie procentowe",
};

export function checkSeedTarget(
  connectionString: string | undefined,
  env: { VERCEL_ENV?: string | undefined } = {},
  context?: SeedGuardContext,
): SeedTargetCheck {
  const { subject, varName } = ctxOf(context);
  const vercelEnv = env.VERCEL_ENV?.trim().toLowerCase();
  if (vercelEnv && FORBIDDEN_VERCEL_ENVS.has(vercelEnv)) {
    return reject("vercel_env", `${subject} jest zablokowany dla VERCEL_ENV=${vercelEnv}`);
  }

  if (!connectionString || !connectionString.trim()) {
    return reject("missing_url", `${varName} jest wymagany`);
  }
  const url = connectionString.trim();

  const authority = rawAuthority(url);
  if (authority === null) {
    return reject("not_a_postgres_url", `${varName} musi mieć postać postgres(ql)://...`);
  }
  const ambiguous = ambiguousParts(authority);
  if (ambiguous.length > 0) {
    // Oba parsery (WHATWG i postgres.js) muszą widzieć ten sam host. Sprawdzane też po dekodowaniu.
    return reject(
      "ambiguous_authority",
      `${varName} ma w części host: ${ambiguous.map((p) => AMBIGUOUS_LABEL[p]).join(", ")}`,
      ambiguous,
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // Bez echa wejścia: nieparsowalny URL może zawierać hasło.
    return reject("invalid_url", `${varName} nie jest poprawnym URL`);
  }

  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    return reject("bad_scheme", `${varName} musi mieć schemat postgres:// lub postgresql://`);
  }

  // Dla schematów niespecjalnych WHATWG URL nie zmienia wielkości liter hosta.
  const host = parsed.hostname.toLowerCase();

  if (!host) {
    // postgres.js przy pustym hoście sięga po PGHOST z env, więc pusty host też jest odmową.
    return reject("no_host", `${varName} nie zawiera hosta`);
  }

  if (host.startsWith("[")) {
    return reject("ipv6", "postgres.js nie obsługuje adresu IPv6 w URL, użyj localhost albo 127.0.0.1");
  }

  if (isNeon(host)) {
    return reject("neon", `${subject} jest zablokowany dla bazy Neon (host ${displayHost(host)})`);
  }

  if (!SEED_ALLOWED_HOSTS.includes(host)) {
    return reject(
      "host_not_allowed",
      `host ${displayHost(host)} spoza allowlisty (${SEED_ALLOWED_HOSTS.join(", ")})`,
    );
  }

  return { ok: true, host };
}

/**
 * Sprawdza hosty wyliczone przez postgres.js (`postgres(url).options`), czyli te,
 * z którymi klient naprawdę się połączy. Gniazdo unix (`path`) jest zawsze odmową:
 * lokalny Docker i CI łączą się po TCP, więc żadna ścieżka nie jest dopuszczona.
 */
export function checkSeedClientOptions(
  options: {
    host?: readonly string[] | string | undefined;
    path?: string | false | null | undefined;
  },
  context?: SeedGuardContext,
): SeedClientCheck {
  const { subject } = ctxOf(context);
  if (options.path) {
    return reject("unix_socket", `${subject} nie łączy się przez gniazdo unix (options.path)`);
  }

  const raw = options.host;
  const hosts = (Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : []).map((h) =>
    h.trim().toLowerCase(),
  );
  if (hosts.length === 0) {
    return reject("client_no_host", "klient postgres nie ma hosta");
  }

  const neon = hosts.filter(isNeon);
  if (neon.length > 0) {
    return reject(
      "neon",
      `${subject} jest zablokowany dla bazy Neon (host ${neon.map(displayHost).join(", ")})`,
    );
  }

  const outside = hosts.filter((h) => !SEED_ALLOWED_HOSTS.includes(h));
  if (outside.length > 0) {
    return reject(
      "host_not_allowed",
      `host ${outside.map(displayHost).join(", ")} spoza allowlisty (${SEED_ALLOWED_HOSTS.join(", ")})`,
    );
  }

  return { ok: true, hosts };
}

/**
 * Etap 3: wynik `SEED_SERVER_PROBE_SQL` z tego samego klienta, który potem pisze.
 * Wywołać po połączeniu, przed pierwszym zapisem. Brak wiersza albo nieoczekiwany
 * kształt wyniku to odmowa (fail closed).
 */
export function checkSeedServerIdentity(row: unknown, context?: SeedGuardContext): SeedServerCheck {
  const { subject } = ctxOf(context);
  const fields = typeof row === "object" && row !== null ? (row as Record<string, unknown>) : {};
  const database = fields.database;
  const neonSettings = fields.neon_settings;
  if (typeof database !== "string" || typeof neonSettings !== "number" || !Number.isInteger(neonSettings)) {
    return reject("server_unknown", `${subject}: nie udało się potwierdzić tożsamości serwera bazy`);
  }

  if (neonSettings > 0) {
    return reject(
      "neon",
      `${subject} jest zablokowany: serwer ma ustawienia neon.* (Neon za tunelem lub proxy)`,
    );
  }

  if (!SEED_ALLOWED_DATABASES.includes(database)) {
    return reject(
      "database_not_allowed",
      `${subject} jest zablokowany: baza ${displayDatabase(database)} spoza allowlisty (${SEED_ALLOWED_DATABASES.join(", ")})`,
    );
  }

  return { ok: true, database };
}

/** Minimalny kształt klienta postgres.js potrzebny do etapu 3 (pozwala testować bez bazy). */
export interface SeedProbeClient {
  unsafe(query: string): PromiseLike<readonly unknown[]>;
  end(options?: { timeout?: number }): PromiseLike<unknown>;
}

/**
 * Etap 3 na KAŻDEJ podanej puli, po kolei, przed pierwszym zapisem. Przy odmowie
 * albo błędzie sondy (timeout, zerwane połączenie) zamyka wszystkie pule
 * (`timeout: 0`) i dopiero wtedy zwraca odmowę albo rzuca dalej oryginalny błąd.
 * Błąd zamykania nie zasłania przyczyny.
 */
export async function verifySeedServerIdentities(
  clients: readonly SeedProbeClient[],
  context?: SeedGuardContext,
): Promise<{ ok: true; databases: string[] } | SeedReject> {
  const closeAll = () => Promise.allSettled(clients.map((c) => c.end({ timeout: 0 })));
  const databases: string[] = [];
  try {
    for (const client of clients) {
      const rows = await client.unsafe(SEED_SERVER_PROBE_SQL);
      const server = checkSeedServerIdentity(rows[0], context);
      if (!server.ok) {
        await closeAll();
        return server;
      }
      databases.push(server.database);
    }
  } catch (error) {
    await closeAll();
    throw error;
  }
  return { ok: true, databases };
}
