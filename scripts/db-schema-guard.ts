/**
 * Strażnik schematu bazy (#180): ograniczenia z migracji 0009 MUSZĄ istnieć.
 *
 * Drizzle nie wyraża EXCLUDE w `src/lib/schema.ts`, więc baza zbudowana od zera
 * SAMYM `drizzle-kit push` nie ma `appointments_no_overlap` — wyścig dwóch
 * rezerwacji znów przechodzi, a nic tego nie zgłasza. Ten skrypt pada z czytelnym
 * komunikatem, gdy ograniczeń brak. Pomiar #180 (main `cf191da`): push na bazie
 * PO migracjach niczego nie zdejmuje — problemem jest tylko budowanie bazy pushem.
 *
 * Gdzie działa:
 * - ostatni krok `pnpm db:push`, `pnpm db:dev` i `pnpm db:reset` (package.json)
 *   oraz `init.sh`;
 * - test `__tests__/pg/schema-constraints.pg.test.ts` (CI: `pnpm test:pg` po
 *   krokach migrate + push w `quality-gate.yml`).
 *
 * Tylko odczyt (`pg_constraint`), bez parametrów od użytkownika. Komunikaty bez
 * URL, użytkownika i hasła.
 *
 *   POSTGRES_URL=postgresql://… pnpm exec tsx scripts/db-schema-guard.ts
 */
import postgres from "postgres";

/** Ograniczenia z migracji 0009 (#171); pierwsze to sedno #180. */
export const REQUIRED_CONSTRAINTS = [
  "appointments_no_overlap",
  "appointments_end_after_start",
  "time_blocks_end_after_start",
] as const;

/** Zapytanie tylko do odczytu; nazwy to stałe z kodu, nie wejście. */
export const SCHEMA_GUARD_SQL =
  "select conname from pg_constraint where conname in (" +
  REQUIRED_CONSTRAINTS.map((n) => `'${n}'`).join(", ") +
  ")";

export type SchemaGuardResult = { ok: true } | { ok: false; missing: string[]; message: string };

/** Czysta decyzja na podstawie nazw ograniczeń obecnych w bazie. */
export function checkSchemaConstraints(present: readonly string[]): SchemaGuardResult {
  const have = new Set(present);
  const missing = REQUIRED_CONSTRAINTS.filter((n) => !have.has(n));
  if (missing.length === 0) return { ok: true };
  return {
    ok: false,
    missing,
    message:
      `Brak ${missing.join(", ")} — baza zbudowana bez db:migrate. ` +
      "Uruchom pnpm db:migrate (nie samo db:push); od zera: pnpm db:reset.",
  };
}

/** Odczyt ograniczeń przez podanego klienta (postgres.js) i decyzja. */
export async function runSchemaGuard(sql: postgres.Sql): Promise<SchemaGuardResult> {
  const rows = await sql.unsafe<{ conname: string }[]>(SCHEMA_GUARD_SQL);
  return checkSchemaConstraints(rows.map((r) => r.conname));
}

async function main(): Promise<number> {
  const url = process.env.POSTGRES_URL?.trim();
  if (!url) {
    console.error("[db-schema-guard] POSTGRES_URL jest wymagany");
    return 1;
  }
  const sql = postgres(url, { max: 1, prepare: false, connect_timeout: 5, onnotice: () => {} });
  try {
    const result = await runSchemaGuard(sql);
    if (!result.ok) {
      console.error(`[db-schema-guard] ${result.message}`);
      return 1;
    }
    console.log(`[db-schema-guard] OK: ${REQUIRED_CONSTRAINTS.join(", ")}`);
    return 0;
  } catch (error) {
    // Bez echa błędu połączenia — może zawierać adres bazy.
    const code = (error as { code?: unknown })?.code;
    console.error(`[db-schema-guard] Nie udało się sprawdzić schematu${typeof code === "string" ? ` (${code})` : ""}`);
    return 1;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (process.argv[1]?.endsWith("db-schema-guard.ts")) {
  void main().then((code) => process.exit(code));
}
