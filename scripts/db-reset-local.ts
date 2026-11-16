/**
 * `pnpm db:reset [baza]` (#180): lokalna baza od zera — WYŁĄCZNIE przez migracje.
 *
 * Wcześniej `db:reset` = `drizzle-kit drop && drizzle-kit push`. `drizzle-kit drop`
 * nie kasuje tabel, tylko usuwa wybrany PLIK migracji z `drizzle/` (i wpis w
 * journalu), a sam push nie zakłada EXCLUDE z 0009 ani roli i polityk RLS z 0005.
 *
 * Teraz, w tej kolejności (jak CI w `quality-gate.yml`):
 * 1. `DROP DATABASE` + `CREATE DATABASE` przez bazę serwisową `postgres` — ta sama
 *    świeża baza, na której startuje CI;
 * 2. `drizzle-kit migrate`; 3. `drizzle-kit push` (domyka dryf, po migracjach
 *    nic nie zmienia — pomiar #180); 4. strażnik `scripts/db-schema-guard.ts`.
 *
 * Bezpieczniki:
 * - nazwa bazy wyłącznie z twardej listy `RESET_ALLOWED_DATABASES` (domyślnie
 *   `pos_dev`); kroki 2–4 dostają POSTGRES_URL wskazujący TĘ bazę;
 * - host z `POSTGRES_URL` przez `checkSeedTarget` + `checkSeedClientOptions`
 *   (tylko localhost/127.0.0.1, nigdy Neon), serwer bez ustawień `neon.*`;
 * - inne połączenia z bazą (np. `pnpm dev`) → odmowa, bez `WITH (FORCE)`.
 * Komunikaty bez URL, użytkownika i hasła.
 *
 *   POSTGRES_URL=postgresql://<user>:<hasło>@localhost:5432/pos_dev pnpm db:reset [pos_dev|pos_reset_test]
 */
import { spawnSync } from "node:child_process";
import postgres from "postgres";
import { SEED_SERVER_PROBE_SQL, checkSeedClientOptions, checkSeedTarget } from "./seed-host-guard";

/** Jedyne bazy, które `db:reset` może skasować i założyć od nowa. */
export const RESET_ALLOWED_DATABASES = ["pos_dev", "pos_reset_test"] as const;
export const RESET_DEFAULT_DATABASE = "pos_dev";

/** Kroki po założeniu pustej bazy — kolejność jest sednem #180 (migrate PRZED push). */
export const RESET_STEPS: readonly (readonly string[])[] = [
  ["pnpm", "exec", "drizzle-kit", "migrate"],
  ["pnpm", "exec", "drizzle-kit", "push"],
  ["pnpm", "exec", "tsx", "scripts/db-schema-guard.ts"],
];

export type ResetPlan =
  | { ok: true; database: string; targetUrl: string; adminUrl: string }
  | { ok: false; reason: string };

/** Ten sam serwer i dane logowania, inna baza (ścieżka URL). */
function withDatabase(url: string, database: string): string {
  const u = new URL(url);
  u.pathname = `/${database}`;
  return u.toString();
}

/** Czysta decyzja: którą bazę i pod jakim adresem resetujemy (bez łączenia się). */
export function planReset(
  args: readonly string[],
  connectionString: string | undefined,
  env: { VERCEL_ENV?: string | undefined } = {},
): ResetPlan {
  const database = args[0] ?? RESET_DEFAULT_DATABASE;
  if (!(RESET_ALLOWED_DATABASES as readonly string[]).includes(database)) {
    const shown = /^[A-Za-z0-9_.-]{1,63}$/.test(database) ? database : "<nieprawidłowa nazwa>";
    return {
      ok: false,
      reason: `db:reset odmawia: baza ${shown} spoza listy (${RESET_ALLOWED_DATABASES.join(", ")})`,
    };
  }
  const target = checkSeedTarget(connectionString, env, { subject: "db:reset" });
  if (!target.ok) return { ok: false, reason: `db:reset odmawia: ${target.reason}` };
  const url = connectionString!.trim();
  return { ok: true, database, targetUrl: withDatabase(url, database), adminUrl: withDatabase(url, "postgres") };
}

async function main(): Promise<number> {
  const plan = planReset(process.argv.slice(2), process.env.POSTGRES_URL, { VERCEL_ENV: process.env.VERCEL_ENV });
  if (!plan.ok) {
    console.error(`[db-reset] ${plan.reason}`);
    return 1;
  }
  const admin = postgres(plan.adminUrl, { max: 1, prepare: false, connect_timeout: 5, onnotice: () => {} });
  try {
    const client = checkSeedClientOptions(admin.options, { subject: "db:reset" });
    if (!client.ok) {
      console.error(`[db-reset] db:reset odmawia: ${client.reason}`);
      return 1;
    }
    const [probe] = await admin.unsafe<{ neon_settings: number }[]>(SEED_SERVER_PROBE_SQL);
    if (!probe || probe.neon_settings !== 0) {
      console.error("[db-reset] db:reset odmawia: serwer ma ustawienia neon.* albo nie da się go potwierdzić");
      return 1;
    }
    const [busy] = await admin<{ n: number }[]>`
      select count(*)::int as n from pg_stat_activity
      where datname = ${plan.database} and pid <> pg_backend_pid()`;
    if ((busy?.n ?? 0) > 0) {
      console.error(
        `[db-reset] Baza ${plan.database} ma ${busy!.n} innych połączeń — zatrzymaj pnpm dev / Drizzle Studio i spróbuj ponownie`,
      );
      return 1;
    }
    // Nazwa z twardej listy (planReset), cytowana jako identyfikator.
    await admin.unsafe(`DROP DATABASE IF EXISTS "${plan.database}"`);
    await admin.unsafe(`CREATE DATABASE "${plan.database}"`);
    console.log(`[db-reset] Baza ${plan.database} założona od nowa`);
  } catch (error) {
    const code = (error as { code?: unknown })?.code;
    console.error(`[db-reset] Reset nieudany${typeof code === "string" ? ` (${code})` : ""}`);
    return 1;
  } finally {
    await admin.end({ timeout: 5 });
  }

  for (const [cmd, ...rest] of RESET_STEPS) {
    console.log(`[db-reset] ${[cmd, ...rest].join(" ")}`);
    const r = spawnSync(cmd!, rest, { stdio: "inherit", env: { ...process.env, POSTGRES_URL: plan.targetUrl } });
    if (r.status !== 0) {
      console.error(`[db-reset] Krok nieudany: ${rest.join(" ")} (kod ${r.status ?? "?"})`);
      return 1;
    }
  }
  return 0;
}

if (process.argv[1]?.endsWith("db-reset-local.ts")) {
  void main().then((code) => process.exit(code));
}
