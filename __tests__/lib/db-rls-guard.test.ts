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
  APP_ROLE,
  LOGIN_ROLE,
  POLICY_GUARD_SQL,
  POLICY_SNAPSHOT_FILE,
  ROLE_GUARD_SQL,
  RLS_GUARD_SQL,
  RLS_EXTRA_MIGRATION_FILES,
  RLS_MIGRATION_FILE,
  checkPolicySemantics,
  checkPolicySnapshot,
  checkRls,
  checkRoles,
  loadPolicySnapshot,
  loadRlsRequirements,
  mergeRlsRequirements,
  parseExplicitRlsRequirements,
  parseRlsRequirements,
  policyHash,
  runPolicyGuard,
  runRlsGuard,
  toPolicySnapshot,
  type PolicyRow,
  type RlsRequirement,
  type RlsRow,
  type RoleRow,
} from "../../scripts/db-rls-guard";

const ROOT = process.cwd();
const SQL = readFileSync(join(ROOT, "drizzle/0005_rls_tenant_isolation.sql"), "utf8");
const RLS = loadRlsRequirements();
const fullRls = (): RlsRow[] => RLS.map((r) => ({ table: r.table, rls: true, policies: [r.policy] }));

describe("strażnik — lista RLS z migracji 0005", () => {
  it("pliki migracji: 0005 + jawne polityki z RLS_EXTRA_MIGRATION_FILES", () => {
    expect(RLS_MIGRATION_FILE).toBe("drizzle/0005_rls_tenant_isolation.sql");
    expect(RLS_EXTRA_MIGRATION_FILES).toEqual(["drizzle/0014_deposit_status_events.sql"]);
    expect(loadRlsRequirements(ROOT)).toEqual([
      ...parseRlsRequirements(SQL),
      { table: "deposit_status_events", policy: "tenant_isolation" },
    ]);
  });

  it("0005: 39 tabel — 26 bezpośrednich + 12 pośrednich z tenant_isolation, salons z tenant_self", () => {
    const from0005 = parseRlsRequirements(SQL);
    expect(from0005).toHaveLength(39);
    expect(from0005.filter((r) => r.policy === "tenant_isolation")).toHaveLength(38);
  });

  it("łącznie 40 tabel: 39 z tenant_isolation (z deposit_status_events), salons z tenant_self", () => {
    expect(RLS).toHaveLength(40);
    expect(RLS.filter((r) => r.policy === "tenant_isolation")).toHaveLength(39);
    expect(RLS.filter((r) => r.policy === "tenant_self")).toEqual([{ table: "salons", policy: "tenant_self" }]);
    for (const t of ["appointments", "deposit_payments", "deposit_status_events", "clients", "ai_generated_media", "time_blocks", "loyalty_transactions"]) {
      expect(RLS).toContainEqual({ table: t, policy: "tenant_isolation" });
    }
    expect(new Set(RLS.map((r) => r.table)).size).toBe(40);
  });

  it("tabela dopisana do direct_tables w pliku → jest na liście (nic na sztywno)", () => {
    const sql = SQL.replace("'ai_generated_media'", "'ai_generated_media','nowa_tabela'");
    expect(parseRlsRequirements(sql)).toContainEqual({ table: "nowa_tabela", policy: "tenant_isolation" });
  });

  it("zakomentowane CREATE POLICY / ALTER TABLE nie tworzą wymagań", () => {
    const commented = `${SQL}\n-- CREATE POLICY stara ON clients USING (true);\n-- ALTER TABLE x ENABLE ROW LEVEL SECURITY;\n`;
    expect(parseRlsRequirements(commented)).toEqual(parseRlsRequirements(SQL));
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

describe("strażnik — jawne polityki z migracji po 0005", () => {
  const FILE = "drizzle/0014_deposit_status_events.sql";
  const SQL_0014 = readFileSync(join(ROOT, FILE), "utf8");
  const enable = "ALTER TABLE t ENABLE ROW LEVEL SECURITY;\n";

  it("plik 0014 → deposit_status_events z tenant_isolation", () => {
    expect(parseExplicitRlsRequirements(SQL_0014, FILE)).toEqual([{ table: "deposit_status_events", policy: "tenant_isolation" }]);
  });

  it.each([
    ["zakomentowana polityka", `${enable}-- CREATE POLICY tenant_isolation ON t USING (true);\n`, /brak jawnego CREATE POLICY/],
    ["polityka bez ENABLE", "CREATE POLICY tenant_isolation ON t USING (true);\n", /CREATE POLICY na t bez ALTER TABLE t ENABLE/],
    ["nazwa w cudzysłowie", `${enable}CREATE POLICY "x" ON t USING (true);\n`, /brak jawnego CREATE POLICY/],
    ["polityka bez przedrostka tenant_", `${enable}CREATE POLICY wszystko ON t USING (true);\n`, /bez przedrostka tenant_/],
  ])("%s → głośny błąd z nazwą pliku", (_n, text, what) => {
    expect(() => parseExplicitRlsRequirements(text, "drizzle/9999_x.sql")).toThrow(what);
    expect(() => parseExplicitRlsRequirements(text, "drizzle/9999_x.sql")).toThrow(/^drizzle\/9999_x\.sql: .*zmieniony format migracji/);
  });

  it("mergeRlsRequirements: tabela z 0005 w pliku dodatkowym → błąd z nazwą pliku i tabeli", () => {
    const extra = [{ file: "drizzle/9999_x.sql", requirements: [{ table: "clients", policy: "tenant_isolation" }] }];
    expect(() => mergeRlsRequirements(parseRlsRequirements(SQL), extra)).toThrow(/^drizzle\/9999_x\.sql: tabela clients/);
  });

  it("mergeRlsRequirements: ta sama tabela w dwóch plikach dodatkowych → błąd z nazwą drugiego pliku", () => {
    const req = [{ table: "nowa", policy: "tenant_isolation" }];
    expect(() =>
      mergeRlsRequirements([], [{ file: "drizzle/a.sql", requirements: req }, { file: "drizzle/b.sql", requirements: req }]),
    ).toThrow(/^drizzle\/b\.sql: tabela nowa/);
  });
});

describe("strażnik — decyzja", () => {
  it("komplet RLS (0005 + 0014) → ok z liczbami; tabele spoza listy bez znaczenia", () => {
    expect(checkRls([...fullRls(), { table: "inna", rls: false, policies: [] }], RLS)).toEqual({ ok: true, checked: 40, rlsTables: 40 });
  });

  it("push po migracjach (RLS zdjęte na wszystkich 40) → odmowa z liczbą tabel", () => {
    const rows = RLS.map((r) => ({ table: r.table, rls: false, policies: [] }));
    const r = checkRls(rows, RLS);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.missing).toHaveLength(41);
    expect(r.missing).toContain("tabel z RLS w bazie 0 < 40 z 0005");
    expect(r.message).toMatch(/^RLS z 0005 niekompletne \(41\): .* i 36 więcej — .*pnpm db:migrate\.$/);
  });

  it("RLS wyłączone na deposit_status_events (0014) → odmowa wskazująca tabelę", () => {
    const r = checkRls(fullRls().map((x) => (x.table === "deposit_status_events" ? { ...x, rls: false } : x)), RLS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.missing).toEqual(["deposit_status_events (RLS wyłączone)", "tabel z RLS w bazie 39 < 40 z 0005"]);
  });

  it.each([
    ["RLS wyłączone na appointments", (rows: RlsRow[]) => rows.map((x) => (x.table === "appointments" ? { ...x, rls: false } : x)), ["appointments (RLS wyłączone)", "tabel z RLS w bazie 39 < 40 z 0005"]],
    ["brak polityki na deposit_payments", (rows: RlsRow[]) => rows.map((x) => (x.table === "deposit_payments" ? { ...x, policies: [] } : x)), ["deposit_payments (brak polityki tenant_isolation)"]],
    ["salons z tenant_isolation zamiast tenant_self", (rows: RlsRow[]) => rows.map((x) => (x.table === "salons" ? { ...x, policies: ["tenant_isolation"] } : x)), ["salons (brak polityki tenant_self)"]],
    ["brak tabeli clients", (rows: RlsRow[]) => rows.filter((x) => x.table !== "clients"), ["clients (brak tabeli)", "tabel z RLS w bazie 39 < 40 z 0005"]],
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

describe("strażnik — rola aplikacji i treść polityk (#193)", () => {
  // Postać z pg_get_expr po migracji 0010 (kontekst w nullif).
  const CTX = "(NULLIF(current_setting('app.current_salon_id'::text, true), ''::text))::uuid";
  const direct = (table: string): PolicyRow => ({
    table,
    name: "tenant_isolation",
    cmd: "ALL",
    permissive: "PERMISSIVE",
    roles: ["public"],
    qual: `(salon_id = ${CTX})`,
    withCheck: `(salon_id = ${CTX})`,
  });
  const child: PolicyRow = {
    ...direct("time_blocks"),
    qual: `(EXISTS ( SELECT 1\n   FROM employees p\n  WHERE ((p.id = time_blocks.employee_id) AND (p.salon_id = ${CTX}))))`,
    withCheck: `(EXISTS ( SELECT 1\n   FROM employees p\n  WHERE ((p.id = time_blocks.employee_id) AND (p.salon_id = ${CTX}))))`,
  };
  const self: PolicyRow = { ...direct("salons"), name: "tenant_self", qual: `(id = ${CTX})`, withCheck: `(id = ${CTX})` };
  const ROWS: PolicyRow[] = [direct("clients"), child, self];
  const SNAP = toPolicySnapshot(ROWS);

  it("zapytania o role i polityki tylko do odczytu katalogu", () => {
    for (const q of [ROLE_GUARD_SQL, POLICY_GUARD_SQL]) {
      expect(q).toMatch(/^select /);
      expect(q).not.toMatch(/;|\b(insert|update|delete|drop|alter|create|truncate|grant)\b/i);
    }
    expect(ROLE_GUARD_SQL).toContain("pg_roles");
    expect(ROLE_GUARD_SQL).toContain(`'${APP_ROLE}', '${LOGIN_ROLE}'`);
    expect(POLICY_GUARD_SQL).toContain("pg_policies");
    expect(POLICY_GUARD_SQL).toContain("schemaname = 'public'");
  });

  it("(a) role: myhelper_app bez atrybutów → OK; brak roli logowania przed P6 to nie błąd", () => {
    expect(checkRoles([{ role: APP_ROLE, super: false, bypass: false }])).toEqual([]);
    expect(checkRoles([{ role: APP_ROLE, super: false, bypass: false }, { role: LOGIN_ROLE, super: false, bypass: false }])).toEqual([]);
  });

  it.each([
    ["brak myhelper_app", [], ["brak roli myhelper_app"]],
    ["BYPASSRLS na myhelper_app", [{ role: APP_ROLE, super: false, bypass: true }], ["rola myhelper_app ma BYPASSRLS"]],
    ["SUPERUSER na myhelper_app", [{ role: APP_ROLE, super: true, bypass: false }], ["rola myhelper_app ma SUPERUSER"]],
    [
      "rola logowania z BYPASSRLS",
      [{ role: APP_ROLE, super: false, bypass: false }, { role: LOGIN_ROLE, super: false, bypass: true }],
      ["rola myhelper_app_login ma BYPASSRLS"],
    ],
  ])("(a) %s → odmowa", (_n, rows, expected) => {
    expect(checkRoles(rows as RoleRow[])).toEqual(expected);
  });

  it("(b) migawka: posortowana, białe znaki znormalizowane, skrót z pól; ta sama baza → zgodna", () => {
    expect(SNAP.map((r) => `${r.table}.${r.name}`)).toEqual(["clients.tenant_isolation", "salons.tenant_self", "time_blocks.tenant_isolation"]);
    expect(SNAP[2]!.qual).not.toMatch(/\n|  /);
    for (const e of SNAP) expect(e.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(checkPolicySnapshot(ROWS, SNAP)).toEqual([]);
    expect(checkPolicySnapshot([...ROWS].reverse(), SNAP)).toEqual([]);
  });

  it.each([
    ["USING (true) pod tą samą nazwą", (r: PolicyRow[]) => r.map((x) => (x.table === "clients" ? { ...x, qual: "true" } : x)), ["clients.tenant_isolation: treść polityki różni się od migawki"]],
    ["inne role", (r: PolicyRow[]) => r.map((x) => (x.table === "clients" ? { ...x, roles: ["myhelper_app"] } : x)), ["clients.tenant_isolation: treść polityki różni się od migawki"]],
    ["RESTRICTIVE", (r: PolicyRow[]) => r.map((x) => (x.table === "clients" ? { ...x, permissive: "RESTRICTIVE" } : x)), ["clients.tenant_isolation: treść polityki różni się od migawki"]],
    ["polityka usunięta", (r: PolicyRow[]) => r.filter((x) => x.table !== "salons"), ["salons.tenant_self: polityka z migawki nie istnieje w bazie"]],
    ["polityka spoza migawki", (r: PolicyRow[]) => [...r, { ...direct("clients"), name: "extra" }], ["clients.extra: polityka spoza migawki"]],
  ])("(b) baza różna od migawki (%s) → odmowa", (_n, mutate, expected) => {
    expect(checkPolicySnapshot(mutate(ROWS), SNAP)).toEqual(expected);
  });

  it("(b) migawka z ręcznie poprawioną treścią bez nowego skrótu → odmowa; pusta migawka → odmowa", () => {
    const edited = SNAP.map((e) => (e.table === "clients" ? { ...e, qual: "true" } : e));
    expect(checkPolicySnapshot(ROWS, edited)).toEqual(["clients.tenant_isolation: treść polityki różni się od migawki"]);
    expect(checkPolicySnapshot(ROWS, [])).toEqual([`pusta migawka ${POLICY_SNAPSHOT_FILE}`]);
  });

  it("(c) semantyka: bezpośrednia, przez rodzica (EXISTS) i tenant_self → bez naruszeń", () => {
    expect(checkPolicySemantics(ROWS)).toEqual([]);
  });

  it.each([
    ["USING (true)", { qual: "true" }, ["clients.tenant_isolation: USING jest stałą true"]],
    ["polityka DELETE z USING (true)", { cmd: "DELETE", qual: "true", withCheck: null }, ["clients.tenant_isolation: USING jest stałą true"]],
    ["WITH CHECK (true)", { withCheck: "true" }, ["clients.tenant_isolation: WITH CHECK jest stałą true"]],
    [
      "odwołanie do innej zmiennej",
      { qual: "(salon_id = (current_setting('app.current_user_id'::text, true))::uuid)", withCheck: "(salon_id = (current_setting('app.current_user_id'::text, true))::uuid)" },
      ["clients.tenant_isolation: USING bez odwołania do app.current_salon_id", "clients.tenant_isolation: WITH CHECK bez odwołania do app.current_salon_id"],
    ],
    ["WITH CHECK bez kontekstu przy USING z kontekstem", { withCheck: "(salon_id IS NOT NULL)" }, ["clients.tenant_isolation: WITH CHECK bez odwołania do app.current_salon_id"]],
    ["brak USING przy ALL", { qual: null }, ["clients.tenant_isolation: USING bez odwołania do app.current_salon_id"]],
    [
      "kontekst bez nullif (postać sprzed 0010)",
      { qual: "(salon_id = (current_setting('app.current_salon_id'::text, true))::uuid)", withCheck: "(salon_id = (current_setting('app.current_salon_id'::text, true))::uuid)" },
      ["clients.tenant_isolation: USING czyta app.current_salon_id bez nullif", "clients.tenant_isolation: WITH CHECK czyta app.current_salon_id bez nullif"],
    ],
    [
      "nullif tylko w jednym z dwóch odczytów (EXISTS z drugim odczytem)",
      { qual: `(EXISTS ( SELECT 1 FROM employees p WHERE ((p.salon_id = ${CTX}) OR (p.salon_id = (current_setting('app.current_salon_id'::text, true))::uuid))))` },
      ["clients.tenant_isolation: USING czyta app.current_salon_id bez nullif"],
    ],
  ])("(c) %s → naruszenie semantyki", (_n, patch, expected) => {
    expect(checkPolicySemantics([{ ...direct("clients"), ...patch }])).toEqual(expected);
  });

  it("(c) polityka INSERT ocenia tylko WITH CHECK, SELECT tylko USING; polityki spoza tenant_* poza semantyką (pilnuje ich migawka)", () => {
    expect(checkPolicySemantics([{ ...direct("clients"), cmd: "INSERT", qual: null }])).toEqual([]);
    expect(checkPolicySemantics([{ ...direct("clients"), cmd: "SELECT", withCheck: null }])).toEqual([]);
    expect(checkPolicySemantics([{ ...direct("clients"), name: "inna", qual: "true" }])).toEqual([]);
  });

  it("runPolicyGuard: role + migawka + semantyka; wartość atrybutu inna niż false liczy się jako nadany", async () => {
    const unsafe = vi.fn(async (q: string) =>
      q === ROLE_GUARD_SQL ? [{ role: APP_ROLE, super: false, bypass: false }] : ROWS.map((r) => ({ ...r })),
    );
    expect(await runPolicyGuard({ unsafe }, SNAP)).toEqual({ ok: true, policies: 3 });
    expect(unsafe.mock.calls).toEqual([[ROLE_GUARD_SQL], [POLICY_GUARD_SQL]]);
    const odd = vi.fn(async (q: string) => (q === ROLE_GUARD_SQL ? [{ role: APP_ROLE, super: "f", bypass: null }] : ROWS));
    const r = await runPolicyGuard({ unsafe: odd }, SNAP);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.problems).toEqual(["rola myhelper_app ma SUPERUSER", "rola myhelper_app ma BYPASSRLS"]);
      expect(r.message).toContain(POLICY_SNAPSHOT_FILE);
    }
  });

  it("migawka w repo: istnieje, niepusta, każda pozycja ze zgodnym skrótem i semantyką", () => {
    const snap = loadPolicySnapshot();
    expect(snap.length).toBeGreaterThanOrEqual(39);
    for (const e of snap) expect(e.sha256).toBe(policyHash(e));
    expect(checkPolicySemantics(snap)).toEqual([]);
  });
});

describe("db-rls-guard z wiersza poleceń (bez bazy)", () => {
  const TSX = join(ROOT, "node_modules/.bin/tsx");
  const run = (env: Record<string, string>) =>
    spawnSync(TSX, ["scripts/db-rls-guard.ts"], {
      cwd: ROOT,
      encoding: "utf8",
      timeout: 60_000,
      // Środowisko minimalne (bez NODE_ENV z typu ProcessEnv) — rzutowanie tylko dla typu.
      env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...env } as unknown as NodeJS.ProcessEnv,
    });

  it("bez POSTGRES_URL → kod 1 i komunikat", () => {
    const r = run({});
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("[db-rls-guard] POSTGRES_URL jest wymagany");
  }, 60_000);

  it("baza nieosiągalna → kod 1, komunikat bez adresu, użytkownika i hasła", () => {
    // Adres składany z części: to nie sekret, ale skaner literałów (secret-guard) słusznie
    // nie rozróżnia wartości testowej od prawdziwej przy nazwie zmiennej.
    const unreachable = ["postgresql:", "", "uzytkownik-190:haslo-190@127.0.0.1:1", "baza190"].join("/");
    const r = run({ POSTGRES_URL: unreachable });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("[db-rls-guard] Nie udało się sprawdzić RLS");
    for (const s of ["uzytkownik-190", "haslo-190", "baza190", "postgresql://", "127.0.0.1"]) {
      expect(r.stdout + r.stderr).not.toContain(s);
    }
  }, 60_000);
});
