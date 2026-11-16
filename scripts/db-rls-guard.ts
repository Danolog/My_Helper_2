/**
 * Strażnik RLS z migracji 0005 (#190): baza zbudowana migracjami MA
 * `relrowsecurity = true` i właściwą politykę na każdej tabeli z
 * `drizzle/0005_rls_tenant_isolation.sql`.
 *
 * `drizzle-kit push` po migracjach traktuje polityki z 0005 jako dryf (nie ma ich
 * w `src/lib/schema.ts`): wyłącza RLS i usuwa polityki na 39 tabelach (pomiar
 * #188/#190). Zostaje wtedy samo filtrowanie w kodzie, a nic tego nie zgłasza.
 *
 * Podstawa: parser 0005 Maxa (#188, `scripts/db-schema-guard.ts` w jego drzewie) —
 * te same nazwy eksportów i kształt `RlsRequirement`/`RlsRow`, żeby #188 importował
 * ten moduł zamiast własnej kopii. Zmiany względem tamtej wersji (D3, Oliver):
 * - nazwa polityki dla tabel z bloków DO wyprowadzona z TEGO bloku
 *   (`CREATE POLICY <nazwa> ON %I`), nie wpisana w kod;
 * - liczba tabel z `relrowsecurity` w bazie nie mniejsza niż liczba tabel z pliku;
 * - jawne `CREATE POLICY` musi mieć w pliku `ALTER TABLE … ENABLE ROW LEVEL SECURITY`.
 * Zmiana formatu pliku albo pusta lista = głośny błąd, nie „OK”.
 *
 * Gdzie działa: krok „RLS guard” po `pnpm db:migrate` w obu jobach z Postgresem
 * w `.github/workflows/quality-gate.yml`; test `__tests__/pg/rls-guard.pg.test.ts`.
 *
 * Tylko odczyt katalogu (`pg_class`, `pg_policies`), bez parametrów od użytkownika.
 * Komunikaty bez adresu bazy i danych logowania.
 *
 * Użycie: `pnpm exec tsx scripts/db-rls-guard.ts` z POSTGRES_URL bazy.
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import postgres from "postgres";

/** Plik migracji, z którego wyprowadzana jest lista tabel z RLS. */
export const RLS_MIGRATION_FILE = "drizzle/0005_rls_tenant_isolation.sql";

/** Tabela z RLS i nazwa polityki, której wymaga migracja 0005. */
export interface RlsRequirement {
  table: string;
  policy: string;
}

/** Wiersz katalogu: tabela schematu public, flaga RLS, nazwy polityk. */
export interface RlsRow {
  table: string;
  rls: boolean;
  policies: string[];
}

const IDENT = /^[a-z_][a-z0-9_]*$/;
const fail = (what: string): never => {
  throw new Error(`${RLS_MIGRATION_FILE}: ${what} — zmieniony format migracji, popraw parser strażnika`);
};

/** Polecenie (między `--> statement-breakpoint`) zawierające deklarację tablicy. */
function blockWith(statements: string[], decl: RegExp, name: string): string {
  const hits = statements.filter((s) => decl.test(s));
  if (hits.length !== 1) fail(`${name}: ${hits.length} bloków zamiast 1`);
  return hits[0]!;
}

/** Nazwa polityki zakładanej w bloku DO (`CREATE POLICY <nazwa> ON %I`) — dokładnie jedna. */
function blockPolicy(block: string, name: string): string {
  const names = new Set([...block.matchAll(/'CREATE POLICY\s+([a-z_][a-z0-9_]*)\s+ON\s+%I/g)].map((m) => m[1]!));
  if (names.size !== 1) fail(`${name}: ${names.size} nazw polityk w bloku zamiast 1`);
  if (!/format\(\s*'ALTER TABLE %I ENABLE ROW LEVEL SECURITY/.test(block)) fail(`${name}: blok bez ENABLE ROW LEVEL SECURITY`);
  return [...names][0]!;
}

/**
 * Wymagania RLS z treści migracji 0005:
 * - blok DO z `direct_tables text[] := ARRAY[...]` → każda tabela z polityką z tego bloku;
 * - blok DO z `indirect_map text[][] := ARRAY[['dziecko', ...], ...]` → pierwsza
 *   kolumna z polityką z tego bloku;
 * - jawne `CREATE POLICY <nazwa> ON <tabela>` na początku linii (np. `tenant_self`
 *   na `salons`), z wymaganym `ALTER TABLE <tabela> ENABLE ROW LEVEL SECURITY`.
 * Pada głośno, gdy któregoś fragmentu nie ma, gdy lista wyjdzie pusta albo gdy
 * tabela się powtarza.
 */
export function parseRlsRequirements(sql: string): RlsRequirement[] {
  const statements = sql.split("--> statement-breakpoint");
  const directBlock = blockWith(statements, /\bdirect_tables\s+text\[\]\s*:=\s*ARRAY\[/, "direct_tables");
  const indirectBlock = blockWith(statements, /\bindirect_map\s+text\[\]\[\]\s*:=\s*ARRAY\[/, "indirect_map");
  const direct = /direct_tables\s+text\[\]\s*:=\s*ARRAY\[([\s\S]*?)\]\s*;/.exec(directBlock);
  const indirect = /indirect_map\s+text\[\]\[\]\s*:=\s*ARRAY\[([\s\S]*?)\]\s*;/.exec(indirectBlock);
  if (!direct || !indirect) fail("nie znaleziono tablicy direct_tables albo indirect_map");
  const directPolicy = blockPolicy(directBlock, "direct_tables");
  const indirectPolicy = blockPolicy(indirectBlock, "indirect_map");
  const directTables = [...direct![1]!.matchAll(/'([a-z_][a-z0-9_]*)'/g)].map((m) => m[1]!);
  const indirectTables = [...indirect![1]!.matchAll(/\[\s*'([a-z_][a-z0-9_]*)'/g)].map((m) => m[1]!);
  const explicit = [...sql.matchAll(/^CREATE POLICY\s+([a-z_][a-z0-9_]*)\s+ON\s+([a-z_][a-z0-9_]*)/gim)].map(
    (m) => ({ table: m[2]!, policy: m[1]! }),
  );
  if (directTables.length === 0 || indirectTables.length === 0 || explicit.length === 0) {
    fail("pusta lista tabel z RLS");
  }
  for (const { table } of explicit) {
    if (!new RegExp(`^ALTER TABLE\\s+${table}\\s+ENABLE ROW LEVEL SECURITY`, "m").test(sql)) {
      fail(`CREATE POLICY na ${table} bez ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
    }
  }
  const out: RlsRequirement[] = [
    ...directTables.map((table) => ({ table, policy: directPolicy })),
    ...indirectTables.map((table) => ({ table, policy: indirectPolicy })),
    ...explicit,
  ];
  const seen = new Set<string>();
  for (const r of out) {
    if (!IDENT.test(r.table) || !IDENT.test(r.policy) || seen.has(r.table)) {
      fail(`nieoczekiwana albo zdublowana tabela ${r.table}`);
    }
    seen.add(r.table);
  }
  return out;
}

/** Wymagania RLS z pliku migracji w repozytorium. */
export function loadRlsRequirements(root = process.cwd()): RlsRequirement[] {
  return parseRlsRequirements(readFileSync(join(root, RLS_MIGRATION_FILE), "utf8"));
}

/** RLS i polityki w schemacie public (tylko odczyt katalogu). */
export const RLS_GUARD_SQL =
  'select c.relname::text as "table", c.relrowsecurity as rls, ' +
  "coalesce(array_agg(p.policyname::text) filter (where p.policyname is not null), '{}'::text[]) as policies " +
  "from pg_class c join pg_namespace n on n.oid = c.relnamespace " +
  "left join pg_policies p on p.schemaname = n.nspname and p.tablename = c.relname " +
  "where n.nspname = 'public' and c.relkind = 'r' group by c.relname, c.relrowsecurity";

export type RlsGuardResult =
  | { ok: true; checked: number; rlsTables: number }
  | { ok: false; missing: string[]; message: string };

/**
 * Czysta decyzja: każda tabela z 0005 istnieje, ma RLS i politykę o nazwie z pliku;
 * tabel z RLS w bazie co najmniej tyle, ile tabel w pliku. Pusta lista wymagań = odmowa.
 */
export function checkRls(rows: readonly RlsRow[], required: readonly RlsRequirement[]): RlsGuardResult {
  if (required.length === 0) {
    return { ok: false, missing: ["pusta lista wymagań"], message: `Pusta lista tabel z ${RLS_MIGRATION_FILE} — nic nie sprawdzono.` };
  }
  const byTable = new Map(rows.map((r) => [r.table, r]));
  const missing: string[] = [];
  for (const req of required) {
    const row = byTable.get(req.table);
    if (!row) missing.push(`${req.table} (brak tabeli)`);
    else if (row.rls !== true) missing.push(`${req.table} (RLS wyłączone)`);
    else if (!row.policies.includes(req.policy)) missing.push(`${req.table} (brak polityki ${req.policy})`);
  }
  const rlsTables = rows.filter((r) => r.rls === true).length;
  if (rlsTables < required.length) missing.push(`tabel z RLS w bazie ${rlsTables} < ${required.length} z 0005`);
  if (missing.length === 0) return { ok: true, checked: required.length, rlsTables };
  const shown = missing.slice(0, 5).join(", ");
  const more = missing.length > 5 ? ` i ${missing.length - 5} więcej` : "";
  return {
    ok: false,
    missing,
    message:
      `RLS z 0005 niekompletne (${missing.length}): ${shown}${more} — baza zbudowana bez db:migrate ` +
      "albo po nim nadpisana przez db:push. Schemat tylko przez pnpm db:migrate.",
  };
}

/** Klient albo transakcja postgres.js — wystarczy `unsafe`. */
export type RlsQueryRunner = { unsafe: (query: string) => PromiseLike<readonly unknown[]> };

/** Odczyt katalogu przez podanego klienta i decyzja. Nie zamyka połączenia. */
export async function runRlsGuard(
  sql: RlsQueryRunner,
  required: readonly RlsRequirement[] = loadRlsRequirements(),
): Promise<RlsGuardResult> {
  const rows = (await sql.unsafe(RLS_GUARD_SQL)) as Array<{ table: string; rls: unknown; policies: string[] | null }>;
  return checkRls(
    rows.map((r) => ({ table: r.table, rls: r.rls === true, policies: [...(r.policies ?? [])] })),
    required,
  );
}

async function main(): Promise<number> {
  const url = process.env.POSTGRES_URL?.trim();
  if (!url) {
    console.error("[db-rls-guard] POSTGRES_URL jest wymagany");
    return 1;
  }
  let required: RlsRequirement[];
  try {
    required = loadRlsRequirements();
  } catch (error) {
    // Błąd parsowania pliku z repo — bez danych bazy, można pokazać.
    console.error(`[db-rls-guard] ${(error as Error).message}`);
    return 1;
  }
  const sql = postgres(url, { max: 1, prepare: false, connect_timeout: 10, onnotice: () => {} });
  try {
    const result = await runRlsGuard(sql, required);
    if (!result.ok) {
      console.error(`[db-rls-guard] ${result.message}`);
      return 1;
    }
    console.log(`[db-rls-guard] OK: RLS i polityki z 0005 na ${result.checked} tabelach; tabel z RLS w bazie: ${result.rlsTables}`);
    return 0;
  } catch (error) {
    // Bez echa błędu połączenia — może zawierać adres bazy albo użytkownika.
    const code = (error as { code?: unknown } | null)?.code;
    console.error(`[db-rls-guard] Nie udało się sprawdzić RLS${typeof code === "string" ? ` (${code})` : ""}`);
    return 1;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void main().then((code) => process.exit(code));
}
