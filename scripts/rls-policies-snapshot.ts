/**
 * #193: generator migawki polityk RLS (`scripts/rls-policies.snapshot.json`).
 *
 * Czyta `pg_policies` schematu public i zapisuje migawkę: tabela, nazwa, polecenie,
 * PERMISSIVE/RESTRICTIVE, role, USING i WITH CHECK po normalizacji białych znaków
 * oraz skrót tych pól, posortowane po tabeli i nazwie (wynik deterministyczny).
 * Strażnik (`scripts/db-rls-guard.ts`) porównuje bazę z tym plikiem; zmiana polityk
 * w migracji wymaga nowej migawki w tym samym PR.
 *
 * Źródło: WYŁĄCZNIE baza zbudowana migracjami (`pnpm db:migrate`, bez `db:push`),
 * adres tylko z jawnego POSTGRES_URL. Tylko lokalny Postgres: host localhost/127.0.0.1
 * (w napisie URL i w opcjach klienta), serwer bez ustawień neon.*, baza z listy
 * `SNAPSHOT_ALLOWED_DATABASES` (te same co reset lokalny). Tylko odczyt katalogu.
 * Na początku wypisuje nazwę bazy i liczbę wpisów dziennika migracji.
 *
 *   POSTGRES_URL=postgresql://…@localhost:5432/pos_reset_test pnpm exec tsx scripts/rls-policies-snapshot.ts
 *
 * Komunikaty bez adresu bazy i danych logowania.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { POLICY_SNAPSHOT_FILE, readPolicies, toPolicySnapshot } from "./db-rls-guard";
import { checkSeedClientOptions, checkSeedTarget, SEED_SERVER_PROBE_SQL, type SeedGuardContext } from "./seed-host-guard";

/** Bazy, z których wolno zbudować migawkę (lista resetu lokalnego, `scripts/db-reset-local.ts`). */
const SNAPSHOT_ALLOWED_DATABASES: readonly string[] = ["pos_dev", "pos_reset_test"];

const CONTEXT: SeedGuardContext = { subject: "generator migawki polityk", varName: "POSTGRES_URL" };
const fail = (why: string): number => {
  console.error(`[rls-policies-snapshot] Odmowa: ${why}`);
  return 1;
};

async function main(): Promise<number> {
  const target = checkSeedTarget(process.env.POSTGRES_URL, { VERCEL_ENV: process.env.VERCEL_ENV }, CONTEXT);
  if (!target.ok) return fail(target.reason);
  const sql = postgres(process.env.POSTGRES_URL!.trim(), { max: 1, prepare: false, connect_timeout: 10, onnotice: () => {} });
  try {
    const client = checkSeedClientOptions(sql.options, CONTEXT);
    if (!client.ok) return fail(client.reason);
    const [server] = (await sql.unsafe(SEED_SERVER_PROBE_SQL)) as Array<{ database?: unknown; neon_settings?: unknown }>;
    if (typeof server?.database !== "string" || server.neon_settings !== 0) {
      return fail("nie udało się potwierdzić lokalnego serwera bazy");
    }
    if (!SNAPSHOT_ALLOWED_DATABASES.includes(server.database)) {
      return fail(`baza spoza listy (${SNAPSHOT_ALLOWED_DATABASES.join(", ")})`);
    }
    const [journal] = (await sql.unsafe(
      "select count(*)::int as n from drizzle.__drizzle_migrations",
    )) as Array<{ n: number }>;
    console.log(`[rls-policies-snapshot] baza: ${server.database}; wpisów dziennika migracji: ${journal?.n ?? "?"}`);
    const snapshot = toPolicySnapshot(await readPolicies(sql));
    if (snapshot.length === 0) {
      console.error("[rls-policies-snapshot] Brak polityk w schemacie public — baza bez migracji?");
      return 1;
    }
    writeFileSync(join(process.cwd(), POLICY_SNAPSHOT_FILE), `${JSON.stringify(snapshot, null, 2)}\n`);
    console.log(`[rls-policies-snapshot] Zapisano ${snapshot.length} polityk do ${POLICY_SNAPSHOT_FILE}`);
    return 0;
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    console.error(`[rls-policies-snapshot] Nie udało się odczytać polityk${typeof code === "string" ? ` (${code})` : ""}`);
    return 1;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

void main().then((code) => process.exit(code));
