// @vitest-environment node
/**
 * #190: strażnik RLS z migracji 0005 (`scripts/db-rls-guard.ts`) — parser pliku
 * migracji, decyzja na wierszach katalogu, odczyt przez klienta i wywołanie z
 * wiersza poleceń (bez bazy). Bloki „lista RLS” i „decyzja” odpowiadają blokom
 * z testu #188 (Max), żeby #188 mógł je przenieść na ten moduł.
 * Na prawdziwym Postgresie: `__tests__/pg/rls-guard.pg.test.ts`.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  RLS_GUARD_SQL,
  RLS_MIGRATION_FILE,
  checkRls,
  loadRlsRequirements,
  parseRlsRequirements,
  runRlsGuard,
  type RlsRequirement,
  type RlsRow,
} from "../../scripts/db-rls-guard";

const ROOT = process.cwd();
const SQL = readFileSync(join(ROOT, "drizzle/0005_rls_tenant_isolation.sql"), "utf8");
const RLS = loadRlsRequirements();
const fullRls = (): RlsRow[] => RLS.map((r) => ({ table: r.table, rls: true, policies: [r.policy] }));

describe("strażnik — lista RLS z migracji 0005", () => {
  it("plik migracji: drizzle/0005_rls_tenant_isolation.sql", () => {
    expect(RLS_MIGRATION_FILE).toBe("drizzle/0005_rls_tenant_isolation.sql");
    expect(loadRlsRequirements(ROOT)).toEqual(parseRlsRequirements(SQL));
  });

  it("39 tabel: 26 bezpośrednich + 12 pośrednich z tenant_isolation, salons z tenant_self", () => {
    expect(RLS).toHaveLength(39);
    expect(RLS.filter((r) => r.policy === "tenant_isolation")).toHaveLength(38);
    expect(RLS.filter((r) => r.policy === "tenant_self")).toEqual([{ table: "salons", policy: "tenant_self" }]);
    for (const t of ["appointments", "deposit_payments", "clients", "ai_generated_media", "time_blocks", "loyalty_transactions"]) {
      expect(RLS).toContainEqual({ table: t, policy: "tenant_isolation" });
    }
    expect(new Set(RLS.map((r) => r.table)).size).toBe(39);
  });

  it("tabela dopisana do direct_tables w pliku → jest na liście (nic na sztywno)", () => {
    const sql = SQL.replace("'ai_generated_media'", "'ai_generated_media','nowa_tabela'");
    expect(parseRlsRequirements(sql)).toContainEqual({ table: "nowa_tabela", policy: "tenant_isolation" });
  });

  it("zakomentowane CREATE POLICY / ALTER TABLE nie tworzą wymagań", () => {
    const commented = `${SQL}\n-- CREATE POLICY stara ON clients USING (true);\n-- ALTER TABLE x ENABLE ROW LEVEL SECURITY;\n`;
    expect(parseRlsRequirements(commented)).toEqual(RLS);
  });

  it("D3: nazwa polityki z bloku DO, nie z kodu (zmiana w bloku → zmiana wymagania)", () => {
    const d = parseRlsRequirements(SQL.replace("'CREATE POLICY tenant_isolation ON %I '", "'CREATE POLICY tenant_direct ON %I '"));
    expect(d).toContainEqual({ table: "clients", policy: "tenant_direct" });
    expect(d).toContainEqual({ table: "time_blocks", policy: "tenant_isolation" });
    const i = parseRlsRequirements(SQL.replace("'CREATE POLICY tenant_isolation ON %I USING", "'CREATE POLICY tenant_child ON %I USING"));
    expect(i).toContainEqual({ table: "time_blocks", policy: "tenant_child" });
    expect(i).toContainEqual({ table: "clients", policy: "tenant_isolation" });
  });

  it.each([
    ["bez direct_tables", (s: string) => s.replace("direct_tables text[]", "tabele text[]")],
    ["bez indirect_map", (s: string) => s.replace("indirect_map text[][]", "mapa text[][]")],
    ["bez jawnego CREATE POLICY", (s: string) => s.replace(/^CREATE POLICY tenant_self ON salons/m, "-- usunięte")],
    ["jawna polityka bez ENABLE", (s: string) => s.replace(/^ALTER TABLE salons ENABLE ROW LEVEL SECURITY;/m, "-- usunięte")],
    ["ENABLE jawnej polityki tylko w komentarzu", (s: string) => s.replace(/^ALTER TABLE salons ENABLE ROW LEVEL SECURITY;/m, "-- ALTER TABLE salons ENABLE ROW LEVEL SECURITY;")],
    ["blok DO bez nazwy polityki", (s: string) => s.replace("'CREATE POLICY tenant_isolation ON %I '", "'CREATE POLICY ON %I '")],
    ["blok DO bez ENABLE", (s: string) => s.replace("format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t)", "format('SELECT %I', t)")],
    ["pusta tablica direct_tables", (s: string) => s.replace(/(direct_tables text\[\] := ARRAY\[)[\s\S]*?(\];)/, "$1$2")],
    ["zdublowana tabela", (s: string) => s.replace("'ai_generated_media'", "'ai_generated_media','clients'")],
    ["dwa bloki direct_tables", (s: string) => `${s}\n--> statement-breakpoint\nDO $$ DECLARE direct_tables text[] := ARRAY['x']; BEGIN END $$;`],
  ])("zmieniony format pliku (%s) → głośny błąd z nazwą pliku, nie pusta lista", (_n, mutate) => {
    expect(() => parseRlsRequirements(mutate(SQL))).toThrow(/0005.*zmieniony format migracji/);
  });

  it.each([[""], ["CREATE TABLE x (id int);"]])("plik bez RLS %j → błąd", (text) => {
    expect(() => parseRlsRequirements(text)).toThrow(/0005/);
  });
});

describe("strażnik — decyzja", () => {
  it("komplet RLS 0005 → ok z liczbami; tabele spoza 0005 bez znaczenia", () => {
    expect(checkRls([...fullRls(), { table: "inna", rls: false, policies: [] }], RLS)).toEqual({ ok: true, checked: 39, rlsTables: 39 });
  });

  it("push po migracjach (RLS zdjęte na wszystkich 39) → odmowa z liczbą tabel", () => {
    const rows = RLS.map((r) => ({ table: r.table, rls: false, policies: [] }));
    const r = checkRls(rows, RLS);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.missing).toHaveLength(40);
    expect(r.missing).toContain("tabel z RLS w bazie 0 < 39 z 0005");
    expect(r.message).toMatch(/^RLS z 0005 niekompletne \(40\): .* i 35 więcej — .*pnpm db:migrate\.$/);
  });

  it.each([
    ["RLS wyłączone na appointments", (rows: RlsRow[]) => rows.map((x) => (x.table === "appointments" ? { ...x, rls: false } : x)), ["appointments (RLS wyłączone)", "tabel z RLS w bazie 38 < 39 z 0005"]],
    ["brak polityki na deposit_payments", (rows: RlsRow[]) => rows.map((x) => (x.table === "deposit_payments" ? { ...x, policies: [] } : x)), ["deposit_payments (brak polityki tenant_isolation)"]],
    ["salons z tenant_isolation zamiast tenant_self", (rows: RlsRow[]) => rows.map((x) => (x.table === "salons" ? { ...x, policies: ["tenant_isolation"] } : x)), ["salons (brak polityki tenant_self)"]],
    ["brak tabeli clients", (rows: RlsRow[]) => rows.filter((x) => x.table !== "clients"), ["clients (brak tabeli)", "tabel z RLS w bazie 38 < 39 z 0005"]],
  ])("%s → odmowa wskazująca tabelę", (_n, mutate, expected) => {
    const r = checkRls(mutate(fullRls()), RLS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.missing).toEqual(expected);
  });

  it("D3: liczba tabel z RLS w bazie < liczba z pliku → osobna pozycja odmowy z obiema liczbami", () => {
    const req: RlsRequirement[] = [{ table: "a", policy: "p" }, { table: "b", policy: "p" }];
    const rows: RlsRow[] = [{ table: "a", rls: true, policies: ["p"] }, { table: "b", rls: true, policies: ["p"] }];
    expect(checkRls(rows, req)).toEqual({ ok: true, checked: 2, rlsTables: 2 });
    const r = checkRls([{ table: "b", rls: true, policies: ["p"] }, { table: "a", rls: false, policies: ["p"] }], req);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.missing).toContain("tabel z RLS w bazie 1 < 2 z 0005");
  });

  it("pusta lista wymagań → odmowa (nic nie sprawdzono to nie sukces)", () => {
    expect(checkRls(fullRls(), []).ok).toBe(false);
  });

  it("zapytanie tylko do odczytu katalogu", () => {
    expect(RLS_GUARD_SQL).toMatch(/^select /);
    expect(RLS_GUARD_SQL).not.toMatch(/;|\b(insert|update|delete|drop|alter|create|truncate|grant)\b/i);
    expect(RLS_GUARD_SQL).toContain("relrowsecurity");
    expect(RLS_GUARD_SQL).toContain("pg_policies");
    expect(RLS_GUARD_SQL).toContain("n.nspname = 'public'");
  });

  it("runRlsGuard: jedno zapytanie → decyzja; rls inne niż true i policies null obsłużone", async () => {
    const req: RlsRequirement[] = [{ table: "appointments", policy: "tenant_isolation" }];
    const unsafe = vi.fn(async (_q: string) => [{ table: "appointments", rls: true, policies: ["tenant_isolation"] }]);
    expect(await runRlsGuard({ unsafe }, req)).toEqual({ ok: true, checked: 1, rlsTables: 1 });
    expect(unsafe.mock.calls).toEqual([[RLS_GUARD_SQL]]);
    const odd = vi.fn(async () => [{ table: "appointments", rls: "t", policies: null }]);
    const r = await runRlsGuard({ unsafe: odd }, req);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.missing[0]).toBe("appointments (RLS wyłączone)");
  });
});

describe("db-rls-guard z wiersza poleceń (bez bazy)", () => {
  const TSX = join(ROOT, "node_modules/.bin/tsx");
  const run = (env: Record<string, string>) =>
    spawnSync(TSX, ["scripts/db-rls-guard.ts"], {
      cwd: ROOT,
      encoding: "utf8",
      timeout: 60_000,
      env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...env },
    });

  it("bez POSTGRES_URL → kod 1 i komunikat", () => {
    const r = run({});
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("[db-rls-guard] POSTGRES_URL jest wymagany");
  }, 60_000);

  it("baza nieosiągalna → kod 1, komunikat bez adresu, użytkownika i hasła", () => {
    const r = run({ POSTGRES_URL: "postgresql://uzytkownik-190:haslo-190@127.0.0.1:1/baza190" });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("[db-rls-guard] Nie udało się sprawdzić RLS");
    for (const s of ["uzytkownik-190", "haslo-190", "baza190", "postgresql://", "127.0.0.1"]) {
      expect(r.stdout + r.stderr).not.toContain(s);
    }
  }, 60_000);
});
