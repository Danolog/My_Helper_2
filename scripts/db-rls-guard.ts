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
 * Lista tabel = lista z 0005 + jawne polityki z migracji w `RLS_EXTRA_MIGRATION_FILES`.
 *
 * Gdzie działa: krok „RLS guard” po `pnpm db:migrate` w obu jobach z Postgresem
 * w `.github/workflows/quality-gate.yml`; test `__tests__/pg/rls-guard.pg.test.ts`.
 *
 * #193: dodatkowo atrybuty ról aplikacji, treść polityk względem migawki
 * `scripts/rls-policies.snapshot.json` i semantyka polityk tenant_* (`runPolicyGuard`).
 * Migawkę generuje `scripts/rls-policies-snapshot.ts` z bazy zbudowanej migracjami.
 *
 * Tylko odczyt katalogu (`pg_class`, `pg_policies`, `pg_roles`), bez parametrów od użytkownika.
 * Komunikaty bez adresu bazy i danych logowania.
 *
 * Użycie: `pnpm exec tsx scripts/db-rls-guard.ts` z POSTGRES_URL bazy.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import postgres from "postgres";

/** Plik migracji 0005, z którego wyprowadzana jest bazowa lista tabel z RLS (kolejne pliki: RLS_EXTRA_MIGRATION_FILES). */
export const RLS_MIGRATION_FILE = "drizzle/0005_rls_tenant_isolation.sql";

/** Tabela z RLS i nazwa polityki, której wymaga migracja 0005 albo plik z RLS_EXTRA_MIGRATION_FILES. */
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

/**
 * Migracje po 0005, które zakładają RLS nowej tabeli jawnym `CREATE POLICY`.
 * Plik dopisuje się tu w tym samym PR co migrację.
 */
export const RLS_EXTRA_MIGRATION_FILES: readonly string[] = ["drizzle/0014_deposit_status_events.sql"];

const failIn = (file: string, what: string): never => {
  throw new Error(`${file}: ${what} — zmieniony format migracji, popraw parser strażnika`);
};

/**
 * Wymagania RLS z migracji po 0005: jawne `CREATE POLICY <nazwa> ON <tabela>` od
 * początku linii (nazwy bez cudzysłowów — ten sam wzorzec co dla 0005), każda tabela
 * z `ALTER TABLE <tabela> ENABLE ROW LEVEL SECURITY`, nazwa polityki `tenant_*`
 * (inaczej semantyka polityk w `checkPolicySemantics` by jej nie objęła).
 * Pada głośno, gdy w pliku nie ma żadnej polityki — plik z listy bez polityki to błąd listy.
 */
export function parseExplicitRlsRequirements(sql: string, file: string): RlsRequirement[] {
  const explicit = [...sql.matchAll(/^CREATE POLICY\s+([a-z_][a-z0-9_]*)\s+ON\s+([a-z_][a-z0-9_]*)/gim)].map(
    (m) => ({ table: m[2]!, policy: m[1]! }),
  );
  if (explicit.length === 0) failIn(file, "brak jawnego CREATE POLICY");
  const seen = new Set<string>();
  for (const { table, policy } of explicit) {
    if (!IDENT.test(table) || !IDENT.test(policy) || seen.has(table)) {
      failIn(file, `nieoczekiwana albo zdublowana tabela ${table}`);
    }
    seen.add(table);
    if (!policy.startsWith("tenant_")) failIn(file, `polityka ${policy} na ${table} bez przedrostka tenant_`);
    if (!new RegExp(`^ALTER TABLE\\s+${table}\\s+ENABLE ROW LEVEL SECURITY`, "m").test(sql)) {
      failIn(file, `CREATE POLICY na ${table} bez ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
    }
  }
  return explicit;
}

/**
 * Wymagania z 0005 + z kolejnych migracji. Tabela powtórzona (względem 0005 albo
 * między plikami) = błąd z nazwą pliku i tabeli: druga polityka na tej samej tabeli
 * oznacza zmianę istniejącej izolacji, nie nową tabelę.
 */
export function mergeRlsRequirements(
  base: RlsRequirement[],
  extra: Array<{ file: string; requirements: RlsRequirement[] }>,
): RlsRequirement[] {
  const seen = new Set(base.map((r) => r.table));
  const out = [...base];
  for (const { file, requirements } of extra) {
    for (const r of requirements) {
      if (seen.has(r.table)) failIn(file, `tabela ${r.table} ma już wymaganie RLS`);
      seen.add(r.table);
      out.push(r);
    }
  }
  return out;
}

/** Wymagania RLS z plików migracji w repozytorium (0005 + `RLS_EXTRA_MIGRATION_FILES`). */
export function loadRlsRequirements(root = process.cwd()): RlsRequirement[] {
  const read = (f: string) => readFileSync(join(root, f), "utf8");
  return mergeRlsRequirements(
    parseRlsRequirements(read(RLS_MIGRATION_FILE)),
    RLS_EXTRA_MIGRATION_FILES.map((f) => ({ file: f, requirements: parseExplicitRlsRequirements(read(f), f) })),
  );
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
 * Czysta decyzja: każda tabela z listy (0005 + RLS_EXTRA_MIGRATION_FILES) istnieje, ma RLS i politykę o nazwie z pliku;
 * tabel z RLS w bazie co najmniej tyle, ile tabel na liście. Pusta lista wymagań = odmowa.
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
  if (rlsTables < required.length) missing.push(`tabel z RLS w bazie ${rlsTables} < ${required.length} z migracji`);
  if (missing.length === 0) return { ok: true, checked: required.length, rlsTables };
  const shown = missing.slice(0, 5).join(", ");
  const more = missing.length > 5 ? ` i ${missing.length - 5} więcej` : "";
  return {
    ok: false,
    missing,
    message:
      `RLS z migracji niekompletne (${missing.length}): ${shown}${more} — baza zbudowana bez db:migrate ` +
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

// ---------------------------------------------------------------------------
// #193: rola aplikacji i TREŚĆ polityk, nie tylko nazwa.
// (a) myhelper_app (i myhelper_app_login, gdy istnieje) bez SUPERUSER i BYPASSRLS;
// (b) migawka polityk z repo == polityki w bazie (każda różnica = odmowa);
// (c) semantyka niezależna od migawki: polityka tenant_* odwołuje się do
//     app.current_salon_id w USING i w WITH CHECK (dla poleceń z zapisem).
// ---------------------------------------------------------------------------

/** Rola, na którą forSalon przełącza transakcję (0005). */
export const APP_ROLE = "myhelper_app";
/** Rola logowania puli żądań (od P6); przed P6 jej brak nie jest błędem. */
export const LOGIN_ROLE = "myhelper_app_login";
/** Plik migawki polityk w repo, generowany z bazy zbudowanej wyłącznie migracjami. */
export const POLICY_SNAPSHOT_FILE = "scripts/rls-policies.snapshot.json";
/** Zmienna kontekstu salonu ustawiana przez forSalon. */
export const SALON_CONTEXT_VAR = "app.current_salon_id";

/** Atrybuty ról aplikacji (tylko odczyt katalogu). */
export const ROLE_GUARD_SQL =
  'select rolname::text as "role", rolsuper as "super", rolbypassrls as "bypass" ' +
  `from pg_roles where rolname in ('${APP_ROLE}', '${LOGIN_ROLE}') order by rolname`;

/** Polityki schematu public z treścią wyrażeń (pg_policies = pg_get_expr). */
export const POLICY_GUARD_SQL =
  'select tablename::text as "table", policyname::text as "name", cmd::text as "cmd", ' +
  'permissive::text as "permissive", roles::text[] as "roles", qual as "qual", with_check as "withCheck" ' +
  "from pg_policies where schemaname = 'public' order by tablename, policyname";

export interface RoleRow {
  role: string;
  super: boolean;
  bypass: boolean;
}

/** Polityka po normalizacji białych znaków (bez skrótu). */
export interface PolicyRow {
  table: string;
  name: string;
  cmd: string;
  permissive: string;
  roles: string[];
  qual: string | null;
  withCheck: string | null;
}

/** Pozycja migawki: polityka + skrót jej pól. */
export interface PolicySnapshotEntry extends PolicyRow {
  sha256: string;
}

const ws = (s: string | null): string | null => (s === null ? null : s.replace(/\s+/g, " ").trim());

/** Normalizacja wiersza katalogu: białe znaki w wyrażeniach, role posortowane. */
export function normalizePolicy(r: PolicyRow): PolicyRow {
  return {
    table: r.table,
    name: r.name,
    cmd: r.cmd,
    permissive: r.permissive,
    roles: [...r.roles].sort(),
    qual: ws(r.qual),
    withCheck: ws(r.withCheck),
  };
}

/** Skrót pól polityki (stała kolejność pól). */
export function policyHash(r: PolicyRow): string {
  const n = normalizePolicy(r);
  return createHash("sha256")
    .update(JSON.stringify([n.table, n.name, n.cmd, n.permissive, n.roles, n.qual, n.withCheck]))
    .digest("hex");
}

/** Migawka z wierszy katalogu: posortowana po tabeli i nazwie, każda pozycja ze skrótem. */
export function toPolicySnapshot(rows: readonly PolicyRow[]): PolicySnapshotEntry[] {
  return rows
    .map((r) => normalizePolicy(r))
    .sort((a, b) => (a.table === b.table ? a.name.localeCompare(b.name) : a.table.localeCompare(b.table)))
    .map((r) => ({ ...r, sha256: policyHash(r) }));
}

/** (a) Atrybuty ról: myhelper_app musi istnieć; żadna z ról bez SUPERUSER/BYPASSRLS. */
export function checkRoles(rows: readonly RoleRow[]): string[] {
  const out: string[] = [];
  if (!rows.some((r) => r.role === APP_ROLE)) out.push(`brak roli ${APP_ROLE}`);
  for (const r of rows) {
    if (r.super !== false) out.push(`rola ${r.role} ma SUPERUSER`);
    if (r.bypass !== false) out.push(`rola ${r.role} ma BYPASSRLS`);
  }
  return out;
}

const WRITE_CMDS = new Set(["ALL", "INSERT", "UPDATE"]);
const READ_CMDS = new Set(["ALL", "SELECT", "UPDATE", "DELETE"]);
const refsContext = (e: string | null): boolean => e !== null && e.includes(`'${SALON_CONTEXT_VAR}'`);
const isConstTrue = (e: string | null): boolean => e !== null && /^\(*\s*true\s*\)*$/i.test(e.trim());
/**
 * #193: każde odczytanie kontekstu jest w nullif(…, ''). Bez tego `''::uuid` na
 * połączeniu po transakcji forSalon rzuca 22P02 zamiast dać 0 wierszy.
 */
const CONTEXT_READ = `current_setting('${SALON_CONTEXT_VAR}'`;
const withoutNullif = (e: string | null): boolean =>
  e !== null && e.replace(/nullif\(current_setting\('app\.current_salon_id'/gi, "").includes(CONTEXT_READ);

/**
 * (c) Semantyka polityk tenant_* (niezależna od migawki):
 * - USING (polecenia z odczytem) odwołuje się do app.current_salon_id, bezpośrednio
 *   albo przez rodzica w EXISTS, i nie jest stałą true;
 * - WITH CHECK (polecenia z zapisem) odwołuje się do kontekstu i nie jest stałą true;
 * - każde odczytanie kontekstu w USING i WITH CHECK jest w nullif(…, '').
 * Kontrola tekstowa: wyrażenie złożone (np. `true OR …`) przechodzi semantykę, ale nie
 * migawkę — dlatego obie kontrole działają razem.
 */
export function checkPolicySemantics(rows: readonly PolicyRow[]): string[] {
  const out: string[] = [];
  for (const raw of rows) {
    if (!raw.name.startsWith("tenant_")) continue;
    const r = normalizePolicy(raw);
    const id = `${r.table}.${r.name}`;
    if (READ_CMDS.has(r.cmd)) {
      if (isConstTrue(r.qual)) out.push(`${id}: USING jest stałą true`);
      else if (!refsContext(r.qual)) out.push(`${id}: USING bez odwołania do ${SALON_CONTEXT_VAR}`);
    }
    if (WRITE_CMDS.has(r.cmd)) {
      if (isConstTrue(r.withCheck)) out.push(`${id}: WITH CHECK jest stałą true`);
      // WITH CHECK równy poprawnemu USING też zawiera odwołanie, więc wystarcza jeden warunek.
      else if (!refsContext(r.withCheck)) out.push(`${id}: WITH CHECK bez odwołania do ${SALON_CONTEXT_VAR}`);
    }
    if (withoutNullif(r.qual)) out.push(`${id}: USING czyta ${SALON_CONTEXT_VAR} bez nullif`);
    if (withoutNullif(r.withCheck)) out.push(`${id}: WITH CHECK czyta ${SALON_CONTEXT_VAR} bez nullif`);
  }
  return out;
}

/** (b) Baza == migawka: brak, nadmiar albo zmiana któregokolwiek pola = odmowa. */
export function checkPolicySnapshot(rows: readonly PolicyRow[], snapshot: readonly PolicySnapshotEntry[]): string[] {
  if (snapshot.length === 0) return [`pusta migawka ${POLICY_SNAPSHOT_FILE}`];
  const out: string[] = [];
  const key = (r: { table: string; name: string }) => `${r.table}.${r.name}`;
  const current = new Map(toPolicySnapshot(rows).map((r) => [key(r), r]));
  const expected = new Map(snapshot.map((r) => [key(r), r]));
  for (const [k, want] of expected) {
    const got = current.get(k);
    if (!got) out.push(`${k}: polityka z migawki nie istnieje w bazie`);
    else if (got.sha256 !== want.sha256 || policyHash(want) !== want.sha256) {
      out.push(`${k}: treść polityki różni się od migawki`);
    }
  }
  for (const k of current.keys()) if (!expected.has(k)) out.push(`${k}: polityka spoza migawki`);
  return out;
}

/** Migawka z pliku w repozytorium. */
export function loadPolicySnapshot(root = process.cwd()): PolicySnapshotEntry[] {
  return JSON.parse(readFileSync(join(root, POLICY_SNAPSHOT_FILE), "utf8")) as PolicySnapshotEntry[];
}

type PolicyDbRow = Omit<PolicyRow, "roles"> & { roles: string[] | null };

/** Odczyt polityk z katalogu przez podanego klienta. */
export async function readPolicies(sql: RlsQueryRunner): Promise<PolicyRow[]> {
  const rows = (await sql.unsafe(POLICY_GUARD_SQL)) as PolicyDbRow[];
  return rows.map((r) => ({ ...r, roles: [...(r.roles ?? [])] }));
}

export type PolicyGuardResult = { ok: true; policies: number } | { ok: false; problems: string[]; message: string };

/** Role + migawka + semantyka. Nie zamyka połączenia. */
export async function runPolicyGuard(
  sql: RlsQueryRunner,
  snapshot: readonly PolicySnapshotEntry[] = loadPolicySnapshot(),
): Promise<PolicyGuardResult> {
  const roles = (await sql.unsafe(ROLE_GUARD_SQL)) as Array<{ role: string; super: unknown; bypass: unknown }>;
  const policies = await readPolicies(sql);
  const problems = [
    // Wartość inna niż dosłowne false liczy się jako atrybut nadany (fail-closed).
    ...checkRoles(roles.map((r) => ({ role: r.role, super: r.super !== false, bypass: r.bypass !== false }))),
    ...checkPolicySnapshot(policies, snapshot),
    ...checkPolicySemantics(policies),
  ];
  if (problems.length === 0) return { ok: true, policies: policies.length };
  const shown = problems.slice(0, 5).join("; ");
  const more = problems.length > 5 ? ` i ${problems.length - 5} więcej` : "";
  return {
    ok: false,
    problems,
    message:
      `Rola aplikacji albo treść polityk niezgodna (${problems.length}): ${shown}${more} — ` +
      `zmiana polityk w migracji wymaga aktualizacji ${POLICY_SNAPSHOT_FILE} w tym samym PR.`,
  };
}

async function main(): Promise<number> {
  const url = process.env.POSTGRES_URL?.trim();
  if (!url) {
    console.error("[db-rls-guard] POSTGRES_URL jest wymagany");
    return 1;
  }
  let required: RlsRequirement[];
  let snapshot: PolicySnapshotEntry[];
  try {
    required = loadRlsRequirements();
    snapshot = loadPolicySnapshot();
  } catch (error) {
    // Błąd odczytu plików z repo — bez danych bazy, można pokazać.
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
    const policies = await runPolicyGuard(sql, snapshot);
    if (!policies.ok) {
      console.error(`[db-rls-guard] ${policies.message}`);
      return 1;
    }
    console.log(
      `[db-rls-guard] OK: RLS i polityki z migracji na ${result.checked} tabelach; tabel z RLS w bazie: ${result.rlsTables}; ` +
        `polityk zgodnych z migawką: ${policies.policies}; role aplikacji bez SUPERUSER/BYPASSRLS`,
    );
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
