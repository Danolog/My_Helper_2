/**
 * Połączenie z PRAWDZIWYM Postgresem dla testów `__tests__/pg/*` (T3).
 *
 * - Adres wyłącznie z `INTEGRATION_POSTGRES_URL` — nigdy z `POSTGRES_URL`
 *   (ten na maszynie dewelopera bywa Neonem, a `.env.local` ładują narzędzia).
 * - Ta sama ochrona hosta co seed (#56, `scripts/seed-host-guard.ts`): tylko
 *   localhost/127.0.0.1 (lokalny Docker albo service container w CI), odmowa
 *   dla Neon i `VERCEL_ENV=preview/production`; sprawdzany napis URL i hosty
 *   wyliczone przez postgres.js, ZANIM padnie pierwsze zapytanie.
 * - Brak adresu: poza CI testy są pomijane, przy `CI=true` — błąd (nie cichy skip).
 *
 * Komunikaty nie zawierają URL ani poświadczeń.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/lib/schema";
import { checkSeedClientOptions, checkSeedTarget } from "../../scripts/seed-host-guard";

export const INTEGRATION_URL = process.env.INTEGRATION_POSTGRES_URL?.trim() || undefined;

if (!INTEGRATION_URL && process.env.CI) {
  throw new Error(
    "[pg-harness] CI=true bez INTEGRATION_POSTGRES_URL — test integracyjny nie może być pominięty w CI"
  );
}

function guardedClient(url: string, max: number) {
  const target = checkSeedTarget(url, { VERCEL_ENV: process.env.VERCEL_ENV });
  if (!target.ok) throw new Error(`[pg-harness] Odmowa: ${target.reason}`);
  const client = postgres(url, { prepare: false, max, connect_timeout: 5, onnotice: () => {} });
  const clientTarget = checkSeedClientOptions(client.options);
  if (!clientTarget.ok) {
    void client.end({ timeout: 0 });
    throw new Error(`[pg-harness] Odmowa: ${clientTarget.reason}`);
  }
  return client;
}

/** Pula dla kodu aplikacji (podmienia `@/lib/db`) i osobny obserwator `pg_locks`. */
export function createIntegrationDb() {
  if (!INTEGRATION_URL) return null;
  const appClient = guardedClient(INTEGRATION_URL, 12);
  const observer = guardedClient(INTEGRATION_URL, 2);
  return {
    db: drizzle(appClient, { schema }),
    observer,
    async end() {
      await Promise.all([appClient.end({ timeout: 5 }), observer.end({ timeout: 5 })]);
    },
  };
}
