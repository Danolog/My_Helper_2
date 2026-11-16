/**
 * Strażnik schematu bazy (#180, #188): baza zbudowana migracjami MA
 * - ograniczenia z migracji 0009 (EXCLUDE kolizji wizyt i dwa CHECK),
 * - RLS z migracji 0005: `relrowsecurity = true` i właściwą politykę na każdej
 *   tabeli z tej migracji (lista wyprowadzona z pliku SQL, nie wpisana tu).
 *
 * Drizzle nie wyraża EXCLUDE ani polityk w `src/lib/schema.ts`, więc baza
 * zbudowana samym `drizzle-kit push` ich nie ma, a push PO migracjach zdejmuje
 * RLS (pomiar #188: 39× DISABLE ROW LEVEL SECURITY i DROP POLICY). Ten skrypt
 * pada z czytelnym komunikatem, gdy czegoś brak.
 *
 * Gdzie działa: koniec `pnpm db:reset` i `init.sh`, oraz test
 * `__tests__/pg/schema-constraints.pg.test.ts` (`pnpm test:pg`).
 *
 * Tylko odczyt (`pg_constraint`, `pg_class`, `pg_policies`), bez parametrów od
 * użytkownika. Komunikaty bez adresu bazy i danych logowania.
 *
 * Użycie: `pnpm exec tsx scripts/db-schema-guard.ts` z POSTGRES_URL bazy.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

/** Ograniczenia z migracji 0009 (#171); pierwsze to sedno #180. */
export const REQUIRED_CONSTRAINTS = [
  "appointments_no_overlap",
  "appointments_end_after_start",
  "time_blocks_end_after_start",
] as const;

/** Plik migracji, z którego wyprowadzana jest lista tabel z RLS. */
export const RLS_MIGRATION_FILE = "drizzle/0005_rls_tenant_isolation.sql";

/** Tabela z RLS i nazwa polityki, której wymaga migracja 0005. */
export interface RlsRequirement {
  table: string;
  policy: string;
}

const IDENT = /^[a-z_][a-z0-9_]*$/;

/** Nazwy w apostrofach z fragmentu SQL (np. ARRAY['a','b']). */
function quotedNames(fragment: string): string[] {
  return [...fragment.matchAll(/'([a-z_][a-z0-9_]*)'/g)].map((m) => m[1]!);
}

/**
 * Wymagania RLS z treści migracji 0005:
 * - `direct_tables text[] := ARRAY[...]` → polityka `tenant_isolation`;
 * - `indirect_map text[][] := ARRAY[['dziecko', ...], ...]` → pierwsza kolumna,
 *   polityka `tenant_isolation`;
 * - jawne `CREATE POLICY <nazwa> ON <tabela>` (np. `tenant_self` na `salons`).
 * Pada głośno, gdy któregoś fragmentu nie ma — zmiana formatu 0005 nie może dać
 * pustej listy (cichy strażnik).
 */
export function parseRlsRequirements(sql: string): RlsRequirement[] {
  const direct = /direct_tables\s+text\[\]\s*:=\s*ARRAY\[([\s\S]*?)\];/.exec(sql);
  const indirect = /indirect_map\s+text\[\]\[\]\s*:=\s*ARRAY\[([\s\S]*?)\]\s*;/.exec(sql);
  if (!direct || !indirect) {
    throw new Error(`${RLS_MIGRATION_FILE}: nie znaleziono direct_tables albo indirect_map — zmieniony format migracji`);
  }
  const directTables = quotedNames(direct[1]!);
  const indirectTables = [...indirect[1]!.matchAll(/\[\s*'([a-z_][a-z0-9_]*)'/g)].map((m) => m[1]!);
  const explicit = [...sql.matchAll(/^CREATE POLICY\s+([a-z_][a-z0-9_]*)\s+ON\s+([a-z_][a-z0-9_]*)/gim)].map(
    (m) => ({ table: m[2]!, policy: m[1]! }),
  );
  if (directTables.length === 0 || indirectTables.length === 0 || explicit.length === 0) {
    throw new Error(`${RLS_MIGRATION_FILE}: pusta lista tabel z RLS — zmieniony format migracji`);
  }
  const out: RlsRequirement[] = [
    ...directTables.map((table) => ({ table, policy: "tenant_isolation" })),
    ...indirectTables.map((table) => ({ table, policy: "tenant_isolation" })),
    ...explicit,
  ];
  const seen = new Set<string>();
  for (const r of out) {
    if (!IDENT.test(r.table) || !IDENT.test(r.policy) || seen.has(r.table)) {
      throw new Error(`${RLS_MIGRATION_FILE}: nieoczekiwana albo zdublowana tabela ${r.table}`);
    }
    seen.add(r.table);
  }
  return out;
}

/** Wymagania RLS z pliku migracji w repozytorium. */
export function loadRlsRequirements(root = process.cwd()): RlsRequirement[] {
  return parseRlsRequirements(readFileSync(join(root, RLS_MIGRATION_FILE), "utf8"));
}

/** Zapytanie o ograniczenia 0009; nazwy to stałe z kodu, nie wejście. */
export const SCHEMA_GUARD_SQL =
  "select conname from pg_constraint where conname in (" +
  REQUIRED_CONSTRAINTS.map((n) => `'${n}'`).join(", ") +
  ")";

/** RLS i polityki w schemacie public (tylko odczyt katalogu). */
export const RLS_GUARD_SQL =
  'select c.relname::text as "table", c.relrowsecurity as rls, ' +
  "coalesce(array_agg(p.policyname::text) filter (where p.policyname is not null), '{}'::text[]) as policies " +
  "from pg_class c join pg_namespace n on n.oid = c.relnamespace " +
  "left join pg_policies p on p.schemaname = n.nspname and p.tablename = c.relname " +
  "where n.nspname = 'public' and c.relkind = 'r' group by c.relname, c.relrowsecurity";

export interface RlsRow {
  table: string;
  rls: boolean;
  policies: string[];
}

export type SchemaGuardResult = { ok: true } | { ok: false; missing: string[]; message: string };

/** Czysta decyzja: ograniczenia 0009 + RLS 0005. */
export function checkSchema(
  presentConstraints: readonly string[],
  rlsRows: readonly RlsRow[],
  rlsRequired: readonly RlsRequirement[],
): SchemaGuardResult {
  const have = new Set(presentConstraints);
  const missingConstraints = REQUIRED_CONSTRAINTS.filter((n) => !have.has(n));
  const byTable = new Map(rlsRows.map((r) => [r.table, r]));
  const missingRls: string[] = [];
  for (const req of rlsRequired) {
    const row = byTable.get(req.table);
    if (!row) missingRls.push(`${req.table} (brak tabeli)`);
    else if (row.rls !== true) missingRls.push(`${req.table} (RLS wyłączone)`);
    else if (!row.policies.includes(req.policy)) missingRls.push(`${req.table} (brak polityki ${req.policy})`);
  }
  // D3 (Oliver): niezależnie od listy — tabel z włączonym RLS w bazie nie mniej niż w pliku.
  const rlsOn = rlsRows.filter((r) => r.rls === true).length;
  const countIssue =
    rlsOn < rlsRequired.length ? [`RLS włączone na ${rlsOn} tabelach, plik migracji wymaga ${rlsRequired.length}`] : [];
  if (missingConstraints.length === 0 && missingRls.length === 0 && countIssue.length === 0) return { ok: true };
  const parts: string[] = [];
  if (missingConstraints.length > 0) parts.push(`Brak ${missingConstraints.join(", ")}`);
  if (missingRls.length > 0) {
    const shown = missingRls.slice(0, 5).join(", ");
    const more = missingRls.length > 5 ? ` i ${missingRls.length - 5} więcej` : "";
    parts.push(`RLS z 0005 niekompletne na ${missingRls.length} tabelach: ${shown}${more}`);
  }
  parts.push(...countIssue);
  return {
    ok: false,
    missing: [...missingConstraints, ...missingRls, ...countIssue],
    message:
      `${parts.join("; ")} — baza zbudowana bez db:migrate albo po nim nadpisana przez db:push. ` +
      "Odbuduj: pnpm db:reset (lokalnie) albo pnpm db:migrate na pustej bazie.",
  };
}

/** Odczyt katalogu przez podanego klienta (postgres.js) i decyzja. */
export async function runSchemaGuard(
  sql: postgres.Sql,
  rlsRequired: readonly RlsRequirement[] = loadRlsRequirements(),
): Promise<SchemaGuardResult> {
  const constraints = await sql.unsafe<{ conname: string }[]>(SCHEMA_GUARD_SQL);
  const rls = await sql.unsafe<RlsRow[]>(RLS_GUARD_SQL);
  return checkSchema(
    constraints.map((r) => r.conname),
    rls.map((r) => ({ table: r.table, rls: r.rls === true, policies: [...(r.policies ?? [])] })),
    rlsRequired,
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
