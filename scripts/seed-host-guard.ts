/**
 * Guard hosta dla `scripts/seed-test.ts`.
 *
 * Seed nadpisuje dane testowe (użytkownicy, salon, plany). Może działać
 * wyłącznie na lokalnej bazie albo na kontenerze Postgresa w CI
 * (`.github/workflows/quality-gate.yml` łączy się przez `localhost:5432`).
 * Każdy inny host, a jawnie Neon (`*.neon.tech`) i środowiska Vercel
 * `preview`/`production`, kończy się odmową.
 *
 * Moduł jest czysty: bez połączenia z bazą, bez `process.exit`, żeby dało się
 * go testować jednostkowo. Komunikaty nigdy nie zawierają URL ani hasła,
 * najwyżej nazwę hosta.
 */

/** Hosty, na których seed może działać. CI używa `localhost` (service container). */
export const SEED_ALLOWED_HOSTS: readonly string[] = ["localhost", "127.0.0.1", "::1"];

/** Środowiska Vercel, w których seed nigdy nie działa, niezależnie od hosta. */
const FORBIDDEN_VERCEL_ENVS = new Set(["preview", "production"]);

export type SeedTargetCheck =
  | { ok: true; host: string }
  | { ok: false; reason: string };

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

  let parsed: URL;
  try {
    parsed = new URL(connectionString.trim());
  } catch {
    // Bez echa wejścia: nieparsowalny URL może zawierać hasło.
    // Ten przypadek obejmuje też multi-host (`h1:5432,h2:5432`), który postgres.js obsługuje.
    return { ok: false, reason: "POSTGRES_URL nie jest poprawnym URL" };
  }

  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    return { ok: false, reason: "POSTGRES_URL musi mieć schemat postgres:// lub postgresql://" };
  }

  // Dla schematów niespecjalnych WHATWG URL nie zmienia wielkości liter hosta, a IPv6 zostawia w nawiasach.
  const host = parsed.hostname.toLowerCase().replace(/^\[(.*)\]$/, "$1");

  if (!host) {
    // postgres.js przy pustym hoście sięga po PGHOST z env, więc pusty host też jest odmową.
    return { ok: false, reason: "POSTGRES_URL nie zawiera hosta" };
  }

  if (host === "neon.tech" || host.endsWith(".neon.tech")) {
    return { ok: false, reason: `seed jest zablokowany dla bazy Neon (host ${host})` };
  }

  if (!SEED_ALLOWED_HOSTS.includes(host)) {
    return {
      ok: false,
      reason: `host ${host} spoza allowlisty (${SEED_ALLOWED_HOSTS.join(", ")})`,
    };
  }

  return { ok: true, host };
}
