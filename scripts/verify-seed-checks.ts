/**
 * Kontrola wyniku seeda testowego (#193 P5b) — czyste funkcje, bez bazy.
 *
 * Zakres przeniesiony z kroku „Verify seed data” w `.github/workflows/quality-gate.yml`
 * (użytkownicy testowi i ich konta z hasłem) i rozszerzony o plany subskrypcji
 * z `./seed-plans`. Przebieg (`runVerifySeed`) dostaje klienta bazy i wyjście
 * z zewnątrz — `scripts/verify-seed.ts` podpina postgres.js i konsolę.
 *
 * Komunikaty zawierają wyłącznie nazwę kontroli i liczby: bez adresów e-mail,
 * identyfikatorów, wartości z bazy i adresu bazy. Z tabeli `account` czytany jest
 * wyłącznie znacznik, czy hasło jest ustawione.
 */
import {
  checkSeedClientOptions,
  checkSeedTarget,
  verifySeedServerIdentities,
  type SeedProbeClient,
} from "./seed-host-guard";
import { SEED_PLANS } from "./seed-plans";

/** Użytkownicy z `scripts/seed-test.ts` (te same stałe; zgodność pilnuje test). */
export const EXPECTED_SEED_USERS = [
  { id: "test-owner-user-id-00001", email: "owner@test.com", role: "owner" },
  { id: "test-client-user-id-00001", email: "client@test.com", role: "client" },
] as const;

export type SeedUserRow = { id: string; email: string; email_verified: boolean; role: string | null };
export type SeedAccountRow = { user_id: string; provider_id: string; has_password: boolean };
export type SeedPlanRow = { slug: string; name: string; price_monthly: string; is_active: boolean; features_json: unknown };

export type SeedRows = {
  users: readonly SeedUserRow[];
  accounts: readonly SeedAccountRow[];
  plans: readonly SeedPlanRow[];
};

export const VERIFY_SEED_USERS_SQL =
  'select id, email, email_verified, role from "user" where email in (\'owner@test.com\', \'client@test.com\')';
export const VERIFY_SEED_ACCOUNTS_SQL =
  "select user_id, provider_id, (password is not null) as has_password from account " +
  "where user_id in ('test-owner-user-id-00001', 'test-client-user-id-00001')";
export const VERIFY_SEED_PLANS_SQL = "select slug, name, price_monthly::text as price_monthly, is_active, features_json from subscription_plans";

/**
 * Lista funkcji dokładnie jak w kodzie: te same pozycje, ta sama kolejność, bez dodatkowych.
 * Seed wstawia plany z ON CONFLICT DO NOTHING, więc ponowny seed nie wyrówna listy po zmianie
 * `PLAN_FEATURES` — rozjazd wykrywa tylko ta kontrola.
 */
function sameFeatures(stored: unknown, expected: readonly string[]): boolean {
  return (
    Array.isArray(stored) &&
    stored.length === expected.length &&
    stored.every((f, i) => f === expected[i])
  );
}

export function checkSeedRows(rows: SeedRows): { ok: boolean; problems: string[] } {
  const problems: string[] = [];

  // Komunikaty: tylko nazwa kontroli (rola użytkownika testowego, slug planu) i liczby —
  // bez adresów e-mail, identyfikatorów i wartości odczytanych z bazy.
  for (const exp of EXPECTED_SEED_USERS) {
    const label = `użytkownik ${exp.role}`;
    const u = rows.users.find((r) => r.email === exp.email);
    if (!u) {
      problems.push(`${label}: brak`);
      continue;
    }
    if (u.id !== exp.id) problems.push(`${label}: identyfikator niezgodny`);
    if (u.email_verified !== true) problems.push(`${label}: e-mail niezweryfikowany`);
    if (u.role !== exp.role) problems.push(`${label}: rola niezgodna`);

    const credential = rows.accounts.filter((a) => a.user_id === exp.id && a.provider_id === "credential");
    if (credential.length !== 1) problems.push(`${label}: kont credential ${credential.length}, oczekiwane 1`);
    else if (credential[0]!.has_password !== true) problems.push(`${label}: konto credential bez hasła`);
  }

  if (rows.plans.length !== SEED_PLANS.length) {
    problems.push(`planów w tabeli ${rows.plans.length}, oczekiwane dokładnie ${SEED_PLANS.length}`);
  }
  for (const exp of SEED_PLANS) {
    const p = rows.plans.find((r) => r.slug === exp.slug);
    if (!p) {
      problems.push(`plan ${exp.slug}: brak`);
      continue;
    }
    if (p.is_active !== true) problems.push(`plan ${exp.slug}: nieaktywny`);
    if (p.name !== exp.name) problems.push(`plan ${exp.slug}: nazwa niezgodna`);
    if (Number(p.price_monthly) !== Number(exp.priceMonthly)) problems.push(`plan ${exp.slug}: cena niezgodna`);
    if (!sameFeatures(p.features_json, exp.featuresJson)) problems.push(`plan ${exp.slug}: funkcje niezgodne`);
  }

  return { ok: problems.length === 0, problems };
}

/** Klient bazy w kształcie postgres.js: opcje do etapu 2 strażnika, zapytania, zamknięcie. */
export interface VerifySeedClient extends SeedProbeClient {
  options: { host?: readonly string[] | string | undefined; path?: string | false | null | undefined };
}

export type VerifySeedDeps = {
  env: { POSTGRES_URL?: string | undefined; VERCEL_ENV?: string | undefined };
  /** Tworzy klienta bez łączenia się (postgres.js łączy przy pierwszym zapytaniu). */
  connect: (url: string) => VerifySeedClient;
  log: (line: string) => void;
  error: (line: string) => void;
};

/**
 * Przebieg kontroli: trzy etapy strażnika bazy seeda (napis URL → hosty klienta →
 * tożsamość serwera), dopiero potem zapytania o dane. Odmowa na każdym etapie kończy
 * przebieg kodem 1 przed zapytaniami o dane. Wyjście: kod odmowy (nigdy `reason` —
 * zawiera host i nazwę bazy), nazwy kontroli i liczby, przy błędzie tylko nazwa klasy.
 */
export async function runVerifySeed(deps: VerifySeedDeps): Promise<number> {
  const url = deps.env.POSTGRES_URL;
  const target = checkSeedTarget(url, { VERCEL_ENV: deps.env.VERCEL_ENV });
  if (!target.ok || !url) {
    deps.error(`[verify-seed] Odmowa: ${target.ok ? "missing_url" : target.code}`);
    return 1;
  }
  const sql = deps.connect(url);
  try {
    const clientTarget = checkSeedClientOptions(sql.options);
    if (!clientTarget.ok) {
      deps.error(`[verify-seed] Odmowa: ${clientTarget.code}`);
      return 1;
    }
    const server = await verifySeedServerIdentities([sql]);
    if (!server.ok) {
      deps.error(`[verify-seed] Odmowa: ${server.code}`);
      return 1;
    }

    const users = (await sql.unsafe(VERIFY_SEED_USERS_SQL)) as unknown as SeedUserRow[];
    const accounts = (await sql.unsafe(VERIFY_SEED_ACCOUNTS_SQL)) as unknown as SeedAccountRow[];
    const plans = (await sql.unsafe(VERIFY_SEED_PLANS_SQL)) as unknown as SeedPlanRow[];
    const result = checkSeedRows({ users, accounts, plans });
    if (!result.ok) {
      for (const p of result.problems) deps.error(`[verify-seed] ${p}`);
      return 1;
    }
    deps.log(`[verify-seed] OK: użytkownicy testowi ${users.length}, konta credential ${accounts.length}, plany ${plans.length}`);
    return 0;
  } catch (err) {
    deps.error(`[verify-seed] Błąd: ${err instanceof Error ? err.name : "UnknownError"}`);
    return 1;
  } finally {
    await sql.end({ timeout: 5 });
  }
}
