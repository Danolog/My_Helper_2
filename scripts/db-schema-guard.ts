/**
 * Strażnik schematu bazy (#180, #188): baza zbudowana migracjami MA
 * - ograniczenia z migracji 0009 (EXCLUDE kolizji wizyt i dwa CHECK),
 * - RLS z migracji 0005: `relrowsecurity = true` i właściwą politykę na każdej
 *   tabeli z tej migracji. Parser pliku, zapytanie i decyzja RLS pochodzą ze
 *   wspólnego modułu `scripts/db-rls-guard.ts` (#194); tu tylko je składamy
 *   z ograniczeniami 0009.
 *
 * Drizzle nie wyraża EXCLUDE ani polityk w `src/lib/schema.ts`, więc baza
 * zbudowana samym `drizzle-kit push` ich nie ma, a push PO migracjach zdejmuje
 * RLS (pomiar #188: 39× DISABLE ROW LEVEL SECURITY i DROP POLICY). Ten skrypt
 * pada z czytelnym komunikatem, gdy czegoś brak.
 *
 * Gdzie działa: koniec `pnpm db:reset` i `init.sh`, oraz test
 * `__tests__/pg/schema-constraints.pg.test.ts` (`pnpm test:pg`).
 *
 * Tylko odczyt katalogu (ograniczenia tu, RLS w `db-rls-guard`), bez parametrów od
 * użytkownika. Komunikaty bez adresu bazy i danych logowania.
 *
 * Użycie: `pnpm exec tsx scripts/db-schema-guard.ts` z POSTGRES_URL bazy.
 */
import postgres from "postgres";
import {
  checkRls,
  loadRlsRequirements,
  runRlsGuard,
  type RlsGuardResult,
  type RlsQueryRunner,
  type RlsRequirement,
  type RlsRow,
} from "./db-rls-guard";

/** Ograniczenia z migracji 0009 (#171); pierwsze to sedno #180. */
export const REQUIRED_CONSTRAINTS = [
  "appointments_no_overlap",
  "appointments_end_after_start",
  "time_blocks_end_after_start",
] as const;

/** Zapytanie o ograniczenia 0009; nazwy to stałe z kodu, nie wejście. */
export const SCHEMA_GUARD_SQL =
  "select conname from pg_constraint where conname in (" +
  REQUIRED_CONSTRAINTS.map((n) => `'${n}'`).join(", ") +
  ")";

export type SchemaGuardResult = { ok: true } | { ok: false; missing: string[]; message: string };

const REBUILD = "Odbuduj: pnpm db:reset (lokalnie) albo pnpm db:migrate na pustej bazie.";

/** Złożenie: braki ograniczeń 0009 + wynik strażnika RLS z `db-rls-guard`. */
function combine(presentConstraints: readonly string[], rls: RlsGuardResult): SchemaGuardResult {
  const have = new Set(presentConstraints);
  const missingConstraints = REQUIRED_CONSTRAINTS.filter((n) => !have.has(n));
  if (missingConstraints.length === 0 && rls.ok) return { ok: true };
  const brak = missingConstraints.length > 0 ? `Brak ${missingConstraints.join(", ")}` : "";
  if (rls.ok) {
    return {
      ok: false,
      missing: [...missingConstraints],
      message: `${brak} — baza zbudowana bez db:migrate albo po nim nadpisana przez db:push. ${REBUILD}`,
    };
  }
  return {
    ok: false,
    missing: [...missingConstraints, ...rls.missing],
    message: `${brak ? `${brak}; ` : ""}${rls.message} ${REBUILD}`,
  };
}

/** Czysta decyzja: ograniczenia 0009 + RLS 0005 (`checkRls`). */
export function checkSchema(
  presentConstraints: readonly string[],
  rlsRows: readonly RlsRow[],
  rlsRequired: readonly RlsRequirement[],
): SchemaGuardResult {
  return combine(presentConstraints, checkRls(rlsRows, rlsRequired));
}

/** Odczyt katalogu przez podanego klienta (postgres.js) i decyzja. */
export async function runSchemaGuard(
  sql: RlsQueryRunner,
  rlsRequired: readonly RlsRequirement[] = loadRlsRequirements(),
): Promise<SchemaGuardResult> {
  const constraints = (await sql.unsafe(SCHEMA_GUARD_SQL)) as Array<{ conname: string }>;
  const rls = await runRlsGuard(sql, rlsRequired);
  return combine(
    constraints.map((r) => r.conname),
    rls,
  );
}

async function main(): Promise<number> {
  const url = process.env.POSTGRES_URL?.trim();
  if (!url) {
    console.error("[db-schema-guard] POSTGRES_URL jest wymagany");
    return 1;
  }
  let required: RlsRequirement[];
  try {
    required = loadRlsRequirements();
  } catch (error) {
    // Błąd parsowania pliku z repo — bez danych bazy, można pokazać.
    console.error(`[db-schema-guard] ${(error as Error).message}`);
    return 1;
  }
  const sql = postgres(url, { max: 1, prepare: false, connect_timeout: 5, onnotice: () => {} });
  try {
    const result = await runSchemaGuard(sql, required);
    if (!result.ok) {
      console.error(`[db-schema-guard] ${result.message}`);
      return 1;
    }
    console.log(`[db-schema-guard] OK: ${REQUIRED_CONSTRAINTS.join(", ")}; RLS na ${required.length} tabelach z 0005`);
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
