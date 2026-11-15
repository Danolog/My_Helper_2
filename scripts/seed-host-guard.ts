/**
 * Guard hosta dla `scripts/seed-test.ts`.
 *
 * Seed nadpisuje dane testowe (użytkownicy, salon, plany). Może działać
 * wyłącznie na lokalnej bazie albo na kontenerze Postgresa w CI
 * (`.github/workflows/quality-gate.yml` łączy się przez `localhost:5432`).
 * Każdy inny host, a jawnie Neon (`*.neon.tech`) i środowiska Vercel
 * `preview`/`production`, kończy się odmową.
 *
 * Dwa niezależne etapy:
 * 1. `checkSeedTarget(url)` sprawdza sam napis URL, zanim powstanie klient.
 *    Odrzuca m.in. authority z więcej niż jednym `@` albo z przecinkiem
 *    (także po `decodeURIComponent`). WHATWG URL bierze host po ostatnim `@`,
 *    a postgres.js po pierwszym i dzieli go po `,`, więc taki URL może
 *    wskazywać różne hosty w zależności od parsera.
 * 2. `checkSeedClientOptions(sql.options)` sprawdza hosty, które postgres.js
 *    faktycznie wyliczył (`postgres(url).options`, bez łączenia się). Każdy
 *    musi być na allowliście, żaden nie może być Neonem, gniazdo unix
 *    (`options.path`) jest odrzucane.
 *
 * Moduł jest czysty: bez połączenia z bazą, bez `process.exit`. Komunikaty
 * nigdy nie zawierają URL, użytkownika ani hasła, najwyżej nazwy hostów.
 */

/**
 * Hosty, na których seed może działać. CI używa `localhost` (service container).
 * Bez `::1`: postgres.js 3.4.8 nie obsługuje literału IPv6 w URL (`[::1]` daje host `"["`).
 */
export const SEED_ALLOWED_HOSTS: readonly string[] = ["localhost", "127.0.0.1"];

/** Środowiska Vercel, w których seed nigdy nie działa, niezależnie od hosta. */
const FORBIDDEN_VERCEL_ENVS = new Set(["preview", "production"]);

export type SeedTargetCheck =
  | { ok: true; host: string }
  | { ok: false; reason: string };

export type SeedClientCheck =
  | { ok: true; hosts: string[] }
  | { ok: false; reason: string };

function isNeon(host: string): boolean {
  return host === "neon.tech" || host.endsWith(".neon.tech");
}

/** Nazwa hosta do komunikatu. Wszystko, co nie wygląda na zwykły host, jest maskowane. */
function displayHost(host: string): string {
  return /^[a-z0-9.-]{1,253}$/.test(host) ? host : "<nieprawidłowy host>";
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
 * `#` w authority też jest niejednoznaczny: WHATWG URL zaczyna od niego fragment,
 * a postgres.js traktuje go jako część hosta.
 */
function hasAmbiguousAuthority(authority: string): boolean {
  const ambiguous = (s: string) =>
    (s.match(/@/g)?.length ?? 0) > 1 || s.includes(",") || s.includes("#");
  if (ambiguous(authority)) return true;
  try {
    return ambiguous(decodeURIComponent(authority));
  } catch {
    // Zepsute kodowanie procentowe: nie da się ustalić, co zobaczy postgres.js.
    return true;
  }
}

export function checkSeedTarget(
  connectionString: string | undefined,
  env: { VERCEL_ENV?: string | undefined } = {},
): SeedTargetCheck {
  const vercelEnv = env.VERCEL_ENV?.trim().toLowerCase();
  if (vercelEnv && FORBIDDEN_VERCEL_ENVS.has(vercelEnv)) {
    return { ok: false, reason: `seed jest zablokowany dla VERCEL_ENV=${vercelEnv}` };
  }

  if (!connectionString || !connectionString.trim()) {
    return { ok: false, reason: "POSTGRES_URL jest wymagany" };
  }
  const url = connectionString.trim();

  const authority = rawAuthority(url);
  if (authority === null) {
    return { ok: false, reason: "POSTGRES_URL musi mieć postać postgres(ql)://..." };
  }
  if (hasAmbiguousAuthority(authority)) {
    // Obejmuje multi-host (`h1,h2`), hasło z `@`/`%40` i `#`/`%23`: oba parsery muszą widzieć ten sam host.
    return {
      ok: false,
      reason:
        "POSTGRES_URL ma w części host więcej niż jeden @, przecinek albo # (także zakodowane %40/%2C/%23)",
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // Bez echa wejścia: nieparsowalny URL może zawierać hasło.
    return { ok: false, reason: "POSTGRES_URL nie jest poprawnym URL" };
  }

  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    return { ok: false, reason: "POSTGRES_URL musi mieć schemat postgres:// lub postgresql://" };
  }

  // Dla schematów niespecjalnych WHATWG URL nie zmienia wielkości liter hosta.
  const host = parsed.hostname.toLowerCase();

  if (!host) {
    // postgres.js przy pustym hoście sięga po PGHOST z env, więc pusty host też jest odmową.
    return { ok: false, reason: "POSTGRES_URL nie zawiera hosta" };
  }

  if (host.startsWith("[")) {
    return {
      ok: false,
      reason: "postgres.js nie obsługuje adresu IPv6 w URL, użyj localhost albo 127.0.0.1",
    };
  }

  if (isNeon(host)) {
    return { ok: false, reason: `seed jest zablokowany dla bazy Neon (host ${displayHost(host)})` };
  }

  if (!SEED_ALLOWED_HOSTS.includes(host)) {
    return {
      ok: false,
      reason: `host ${displayHost(host)} spoza allowlisty (${SEED_ALLOWED_HOSTS.join(", ")})`,
    };
  }

  return { ok: true, host };
}

/**
 * Sprawdza hosty wyliczone przez postgres.js (`postgres(url).options`), czyli te,
 * z którymi klient naprawdę się połączy. Gniazdo unix (`path`) jest zawsze odmową:
 * lokalny Docker i CI łączą się po TCP, więc żadna ścieżka nie jest dopuszczona.
 */
export function checkSeedClientOptions(options: {
  host?: readonly string[] | string | undefined;
  path?: string | false | null | undefined;
}): SeedClientCheck {
  if (options.path) {
    return { ok: false, reason: "seed nie łączy się przez gniazdo unix (options.path)" };
  }

  const raw = options.host;
  const hosts = (Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : []).map((h) =>
    h.trim().toLowerCase(),
  );
  if (hosts.length === 0) {
    return { ok: false, reason: "klient postgres nie ma hosta" };
  }

  const neon = hosts.filter(isNeon);
  if (neon.length > 0) {
    return {
      ok: false,
      reason: `seed jest zablokowany dla bazy Neon (host ${neon.map(displayHost).join(", ")})`,
    };
  }

  const outside = hosts.filter((h) => !SEED_ALLOWED_HOSTS.includes(h));
  if (outside.length > 0) {
    return {
      ok: false,
      reason: `host ${outside.map(displayHost).join(", ")} spoza allowlisty (${SEED_ALLOWED_HOSTS.join(", ")})`,
    };
  }

  return { ok: true, hosts };
}
