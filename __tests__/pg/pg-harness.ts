/**
 * Połączenie z PRAWDZIWYM Postgresem dla testów `__tests__/pg/*` (T3).
 *
 * - Adres wyłącznie z `INTEGRATION_POSTGRES_URL` — nigdy z `POSTGRES_URL`
 *   (ten na maszynie dewelopera bywa Neonem, a `.env.local` ładują narzędzia).
 * - Ta sama ochrona co seed (#56, `scripts/seed-host-guard.ts`): tylko
 *   localhost/127.0.0.1 (lokalny Docker albo service container w CI), odmowa
 *   dla Neon i `VERCEL_ENV=preview/production`; sprawdzany napis URL i hosty
 *   wyliczone przez postgres.js, ZANIM padnie pierwsze zapytanie, a potem
 *   tożsamość serwera (baza `pos_dev`, brak ustawień `neon.*`), ZANIM test
 *   cokolwiek zapisze. Ostatni krok łapie tunel `localhost:<port>` → zdalna baza.
 * - Brak adresu: poza CI testy są pomijane, przy `CI=true` — błąd (nie cichy skip).
 *
 * Komunikaty nie zawierają URL ani poświadczeń.
 *
 * Sprzątanie po przerwaniu (Ctrl+C, zabity proces): `afterAll` się wtedy nie
 * wykona i w bazie mogą zostać wiersze testu z prefiksem `it-t3-` (użytkownik,
 * salon „IT T3 …”, plan o slugu `it-t3-…`). W CI to bez znaczenia (kontener jest
 * efemeryczny). Lokalnie, WYŁĄCZNIE na lokalnym Dockerze (`-h localhost`, baza
 * `pos_dev`; przed uruchomieniem sprawdź host), usuń je jedną transakcją:
 *
 *   psql -h localhost -U dev_user -d pos_dev -v ON_ERROR_STOP=1 -c "
 *     BEGIN;
 *     DELETE FROM salons WHERE owner_id LIKE 'it-t3-%';
 *     DELETE FROM subscription_plans WHERE slug LIKE 'it-t3-%';
 *     DELETE FROM \"user\" WHERE id LIKE 'it-t3-%';
 *     COMMIT;"
 *
 * Kolejność ma znaczenie: usunięcie salonu kaskadą zabiera subskrypcje i płatności,
 * dopiero potem plan (`onDelete: restrict`) i użytkownika (właściciel salonu).
 */
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/lib/schema";
import {
  checkSeedClientOptions,
  checkSeedServerIdentity,
  checkSeedTarget,
  SEED_SERVER_PROBE_SQL,
  type SeedGuardContext,
} from "../../scripts/seed-host-guard";

export const INTEGRATION_URL = process.env.INTEGRATION_POSTGRES_URL?.trim() || undefined;

/** Komunikaty guardu mówią o tym teście i o tej zmiennej, nie o seedzie i `POSTGRES_URL`. */
export const HARNESS_GUARD_CONTEXT: SeedGuardContext = {
  subject: "test integracyjny",
  varName: "INTEGRATION_POSTGRES_URL",
};

if (!INTEGRATION_URL && process.env.CI) {
  throw new Error(
    "[pg-harness] CI=true bez INTEGRATION_POSTGRES_URL — test integracyjny nie może być pominięty w CI"
  );
}

function guardedClient(url: string, max: number) {
  const target = checkSeedTarget(url, { VERCEL_ENV: process.env.VERCEL_ENV }, HARNESS_GUARD_CONTEXT);
  if (!target.ok) throw new Error(`[pg-harness] Odmowa: ${target.reason}`);
  const client = postgres(url, { prepare: false, max, connect_timeout: 5, onnotice: () => {} });
  const clientTarget = checkSeedClientOptions(client.options, HARNESS_GUARD_CONTEXT);
  if (!clientTarget.ok) {
    void client.end({ timeout: 0 });
    throw new Error(`[pg-harness] Odmowa: ${clientTarget.reason}`);
  }
  return client;
}

/** Pula dla kodu aplikacji (podmienia `@/lib/db`) i osobny obserwator `pg_locks`. */
export async function createIntegrationDb() {
  if (!INTEGRATION_URL) return null;
  const appClient = guardedClient(INTEGRATION_URL, 12);
  const observer = guardedClient(INTEGRATION_URL, 2);
  const end = async () => {
    await Promise.all([appClient.end({ timeout: 5 }), observer.end({ timeout: 5 })]);
  };

  // Etap 3 na obu pulach: obie trafiają pod ten sam adres, ale sprawdzamy każdą,
  // z której test faktycznie korzysta. Pierwsze zapytania w ogóle; zapisów jeszcze nie ma.
  for (const client of [appClient, observer]) {
    const [identity] = await client.unsafe(SEED_SERVER_PROBE_SQL);
    const server = checkSeedServerIdentity(identity, HARNESS_GUARD_CONTEXT);
    if (!server.ok) {
      await Promise.all([appClient.end({ timeout: 0 }), observer.end({ timeout: 0 })]);
      throw new Error(`[pg-harness] Odmowa: ${server.reason}`);
    }
  }

  return { db: drizzle(appClient, { schema }), observer, end };
}
