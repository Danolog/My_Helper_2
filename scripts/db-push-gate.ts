/**
 * Bramka przed `drizzle-kit push` (`pnpm db:push`, `pnpm db:dev`; #188, decyzja produktowa D2).
 *
 * `src/lib/schema.ts` nie zna polityk RLS z migracji 0005 ani EXCLUDE z 0009.
 * Push na bazie zbudowanej migracjami „wyrównuje” ją do schema.ts: zmierzone
 * 39× DISABLE ROW LEVEL SECURITY i DROP POLICY (38× tenant_isolation,
 * 1× tenant_self). Dlatego push przechodzi WYŁĄCZNIE na pustej bazie:
 * - 0 tabel w schemacie public i brak schematu `drizzle` → push dozwolony, z
 *   ostrzeżeniem, że to baza prototypowa bez EXCLUDE i RLS;
 * - cokolwiek innego (dziennik migracji, tabele bez dziennika) → odmowa:
 *   zmiany schematu idą przez `db:generate` + `db:migrate`.
 * Błąd połączenia albo nieczytelny wynik → odmowa (fail closed).
 *
 * Strażnik `scripts/db-schema-guard.ts` NIE stoi po pushu — na bazie
 * prototypowej z definicji by padł; pilnuje baz z migracji (db:reset, init.sh,
 * test:pg).
 *
 * Tylko odczyt katalogu. Komunikaty bez adresu bazy i danych logowania.
 */
import postgres from "postgres";
import { queryParamsRefusal } from "./db-url-guard";

/** Stan bazy: liczba tabel w public i obecność schematu `drizzle` (dziennik migracji drizzle-kit). */
export const PUSH_GATE_SQL =
  "select (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace " +
  "where n.nspname = 'public' and c.relkind in ('r', 'p')) as public_tables, " +
  "exists (select 1 from pg_namespace where nspname = 'drizzle') as drizzle_schema";

export const PUSH_PROTOTYPE_WARNING =
  "baza prototypowa: bez EXCLUDE z 0009 i bez RLS z 0005 — nie do testów pg, E2E ani danych gości " +
  "(do tego: pnpm db:reset albo pnpm db:migrate).";

export const PUSH_REFUSED_MIGRATED =
  "db:push odmawia: baza zarządzana migracjami — użyj `db:generate` + `db:migrate` " +
  "(push zdjąłby RLS z 0005 na 39 tabelach).";

export const PUSH_REFUSED_NOT_EMPTY =
  "db:push odmawia: baza nie jest pusta (tabele bez dziennika migracji) — zbuduj ją od zera: " +
  "pnpm db:reset (lokalnie) albo pnpm db:migrate na pustej bazie.";

export type PushGateResult = { ok: true; warning: string } | { ok: false; message: string };

/** Czysta decyzja na podstawie wiersza `PUSH_GATE_SQL`. */
export function decidePush(row: unknown): PushGateResult {
  const r = (row ?? {}) as { public_tables?: unknown; drizzle_schema?: unknown };
  if (typeof r.public_tables !== "number" || !Number.isInteger(r.public_tables) || typeof r.drizzle_schema !== "boolean") {
    return { ok: false, message: "db:push odmawia: nie udało się ustalić stanu bazy" };
  }
  if (r.drizzle_schema) return { ok: false, message: PUSH_REFUSED_MIGRATED };
  if (r.public_tables > 0) return { ok: false, message: PUSH_REFUSED_NOT_EMPTY };
  return { ok: true, warning: PUSH_PROTOTYPE_WARNING };
}

/** Odczyt przez podanego klienta (postgres.js) i decyzja. */
export async function runPushGate(sql: Pick<postgres.Sql, "unsafe">): Promise<PushGateResult> {
  const rows = await sql.unsafe<{ public_tables: number; drizzle_schema: boolean }[]>(PUSH_GATE_SQL);
  return decidePush(rows[0]);
}

type GateSql = Pick<postgres.Sql, "unsafe" | "end">;

const defaultConnect = (url: string): GateSql =>
  postgres(url, { max: 1, prepare: false, connect_timeout: 5, onnotice: () => {} });

/**
 * Cała bramka. Przed połączeniem ta sama odmowa parametrów zapytania co w
 * db:reset (`db-url-guard`): bramka łączy się przez postgres.js, a push przez
 * sterownik pg, który bierze host z `?host=` — bez tej odmowy bramka mogłaby
 * ocenić pustą bazę A, a push zdjąć RLS z bazy B (uwaga z recenzji do ff8d306).
 */
export async function pushGateMain(
  env: Record<string, string | undefined>,
  connect: (url: string) => GateSql = defaultConnect,
): Promise<number> {
  const url = env.POSTGRES_URL?.trim();
  if (!url) {
    console.error("[db-push-gate] POSTGRES_URL jest wymagany");
    return 1;
  }
  let refusal: string | null;
  try {
    refusal = queryParamsRefusal(url, "db:push");
  } catch {
    refusal = "db:push odmawia: POSTGRES_URL nie jest poprawnym adresem";
  }
  if (refusal) {
    console.error(`[db-push-gate] ${refusal}`);
    return 1;
  }
  const sql = connect(url);
  try {
    const result = await runPushGate(sql);
    if (!result.ok) {
      console.error(`[db-push-gate] ${result.message}`);
      return 1;
    }
    console.warn(`[db-push-gate] ${result.warning}`);
    return 0;
  } catch (error) {
    // Bez echa błędu połączenia — może zawierać adres bazy.
    const code = (error as { code?: unknown })?.code;
    console.error(`[db-push-gate] db:push odmawia: nie udało się sprawdzić bazy${typeof code === "string" ? ` (${code})` : ""}`);
    return 1;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (process.argv[1]?.endsWith("db-push-gate.ts")) {
  void pushGateMain(process.env).then((code) => process.exit(code));
}
