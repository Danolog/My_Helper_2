/**
 * Kontrola wyniku seeda testowego (#193 P5b): `pnpm exec tsx scripts/verify-seed.ts`.
 *
 * Tylko odczyt. Ten sam strażnik bazy docelowej co `scripts/seed-test.ts`
 * (`./seed-host-guard`: URL, hosty klienta, tożsamość serwera), żeby skrypt
 * nie łączył się z żadną bazą poza lokalną i CI. Reguły kontroli:
 * `./verify-seed-checks.ts`. Niezgodność → lista problemów i kod wyjścia 1.
 * Wyjście: tylko nazwy kontroli i liczby (bez e-maili, identyfikatorów i adresu bazy).
 */
import postgres from "postgres";
import {
  checkSeedClientOptions,
  checkSeedServerIdentity,
  checkSeedTarget,
  SEED_SERVER_PROBE_SQL,
} from "./seed-host-guard";
import {
  checkSeedRows,
  VERIFY_SEED_ACCOUNTS_SQL,
  VERIFY_SEED_PLANS_SQL,
  VERIFY_SEED_USERS_SQL,
  type SeedAccountRow,
  type SeedPlanRow,
  type SeedUserRow,
} from "./verify-seed-checks";

async function main(): Promise<number> {
  const connectionString = process.env.POSTGRES_URL;
  const target = checkSeedTarget(connectionString, { VERCEL_ENV: process.env.VERCEL_ENV });
  if (!target.ok || !connectionString) {
    console.error(`[verify-seed] Odmowa: ${target.ok ? "POSTGRES_URL jest wymagany" : target.code}`);
    return 1;
  }
  const sql = postgres(connectionString);
  try {
    const clientTarget = checkSeedClientOptions(sql.options);
    if (!clientTarget.ok) {
      console.error(`[verify-seed] Odmowa: ${clientTarget.code}`);
      return 1;
    }
    const [identity] = await sql.unsafe(SEED_SERVER_PROBE_SQL);
    const server = checkSeedServerIdentity(identity);
    if (!server.ok) {
      console.error(`[verify-seed] Odmowa: ${server.code}`);
      return 1;
    }

    const users = (await sql.unsafe(VERIFY_SEED_USERS_SQL)) as unknown as SeedUserRow[];
    const accounts = (await sql.unsafe(VERIFY_SEED_ACCOUNTS_SQL)) as unknown as SeedAccountRow[];
    const plans = (await sql.unsafe(VERIFY_SEED_PLANS_SQL)) as unknown as SeedPlanRow[];
    const result = checkSeedRows({ users, accounts, plans });
    if (!result.ok) {
      for (const p of result.problems) console.error(`[verify-seed] ${p}`);
      return 1;
    }
    console.log(`[verify-seed] OK: użytkownicy testowi ${users.length}, konta credential ${accounts.length}, plany ${plans.length}`);
    return 0;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(`[verify-seed] Błąd: ${err instanceof Error ? err.name : "UnknownError"}`);
    process.exit(1);
  },
);
