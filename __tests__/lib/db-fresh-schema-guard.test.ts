// @vitest-environment node
/**
 * #180/#188: świeża baza tylko przez `db:migrate`; strażnik ograniczeń z 0009
 * i RLS z 0005.
 *
 * - strażnik (`scripts/db-schema-guard.ts`): decyzja, zapytania tylko do odczytu,
 *   lista tabel z RLS wyprowadzona z pliku migracji 0005;
 * - `db:reset` (`scripts/db-reset-local.ts`): baza z twardej listy, host lokalny,
 *   bez parametrów zapytania poza sslmode (B2), kroki migrate → strażnik, BEZ push
 *   i bez `drizzle-kit drop`; odmowa po sondzie neon.* (L8);
 * - bramka `db:push`: tylko pusta baza; ta sama odmowa parametrów zapytania co
 *   w resecie (`scripts/db-url-guard.ts`), przed połączeniem;
 * - `package.json`: nie ma martwego `setup`, każdy `scripts/*.ts` istnieje;
 * - `init.sh`: migrate + strażnik, bez push, bez wyciszania błędów;
 * - CI (`quality-gate.yml`): każdy job z bazą robi `db:migrate` (a `db:push`,
 *   jeśli jeszcze jest, stoi po nim) z lokalnym POSTGRES_URL;
 * - README: zdanie o budowaniu bazy, bez fałszywego „drop all tables”.
 * Bez połączenia z bazą (prawdziwa baza: `__tests__/pg/schema-constraints.pg.test.ts`).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PUSH_GATE_SQL,
  PUSH_PROTOTYPE_WARNING,
  PUSH_REFUSED_MIGRATED,
  PUSH_REFUSED_NOT_EMPTY,
  decidePush,
  pushGateMain,
  runPushGate,
} from "../../scripts/db-push-gate";
import {
  RESET_ALLOWED_DATABASES,
  RESET_ALLOWED_QUERY_PARAMS,
  RESET_DEFAULT_DATABASE,
  RESET_STEPS,
  planReset,
  resetMain,
  type ResetDeps,
  type ResetEnv,
} from "../../scripts/db-reset-local";
import {
  RLS_GUARD_SQL,
  loadRlsRequirements,
  parseRlsRequirements,
  type RlsRequirement,
  type RlsRow,
} from "../../scripts/db-rls-guard";
import {
  REQUIRED_CONSTRAINTS,
  SCHEMA_GUARD_SQL,
  checkSchema,
  runSchemaGuard,
} from "../../scripts/db-schema-guard";
import { DB_URL_ALLOWED_QUERY_PARAMS } from "../../scripts/db-url-guard";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8").replace(/\r\n/g, "\n");
const PKG = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
const INIT = read("init.sh");
const QG = read(".github/workflows/quality-gate.yml");
const README = read("README.md");
const LOCAL = "postgresql://dev_user:pw-x9@localhost:5432/pos_dev";

const RLS = loadRlsRequirements();
const fullRls = (): RlsRow[] => RLS.map((r) => ({ table: r.table, rls: true, policies: [r.policy] }));

describe("strażnik — lista RLS z migracji (0005 + RLS_EXTRA_MIGRATION_FILES)", () => {
  it("41 tabel: 38 z 0005, deposit_status_events z 0014 i legal_acceptances z 0015 z tenant_isolation, salons z tenant_self", () => {
    expect(RLS).toHaveLength(41);
    expect(RLS.filter((r) => r.policy === "tenant_isolation")).toHaveLength(40);
    expect(RLS).toContainEqual({ table: "salons", policy: "tenant_self" });
    for (const t of ["appointments", "deposit_payments", "clients", "ai_generated_media", "time_blocks", "loyalty_transactions", "legal_acceptances"]) {
      expect(RLS).toContainEqual({ table: t, policy: "tenant_isolation" });
    }
  });

  it("tabela dopisana do direct_tables w pliku → jest na liście (nic na sztywno)", () => {
    const sql = read("drizzle/0005_rls_tenant_isolation.sql").replace("'ai_generated_media'", "'ai_generated_media','nowa_tabela'");
    expect(parseRlsRequirements(sql)).toContainEqual({ table: "nowa_tabela", policy: "tenant_isolation" });
  });

  it.each([
    ["bez direct_tables", (s: string) => s.replace("direct_tables text[]", "tabele text[]")],
    ["bez indirect_map", (s: string) => s.replace("indirect_map text[][]", "mapa text[][]")],
    ["bez jawnego CREATE POLICY", (s: string) => s.replace(/^CREATE POLICY tenant_self ON salons/m, "-- usunięte")],
  ])("zmieniony format pliku (%s) → głośny błąd, nie pusta lista", (_n, mutate) => {
    expect(() => parseRlsRequirements(mutate(read("drizzle/0005_rls_tenant_isolation.sql")))).toThrow(/0005/);
  });
});

describe("strażnik — decyzja", () => {
  it("komplet ograniczeń 0009 i RLS 0005 → ok", () => {
    expect(REQUIRED_CONSTRAINTS).toEqual([
      "appointments_no_overlap",
      "appointments_end_after_start",
      "time_blocks_end_after_start",
    ]);
    expect(checkSchema([...REQUIRED_CONSTRAINTS, "inne"], fullRls(), RLS)).toEqual({ ok: true });
  });

  it("brak EXCLUDE (baza zbudowana pushem) → odmowa z nazwą i instrukcją", () => {
    const r = checkSchema(["appointments_end_after_start", "time_blocks_end_after_start"], fullRls(), RLS);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.missing).toEqual(["appointments_no_overlap"]);
    expect(r.message).toBe(
      "Brak appointments_no_overlap — baza zbudowana bez db:migrate albo po nim nadpisana przez db:push. " +
        "Odbuduj: pnpm db:reset (lokalnie) albo pnpm db:migrate na pustej bazie."
    );
  });

  it.each([
    ["brak CHECK wizyt", ["appointments_no_overlap", "time_blocks_end_after_start"], ["appointments_end_after_start"]],
    ["brak CHECK blokad", ["appointments_no_overlap", "appointments_end_after_start"], ["time_blocks_end_after_start"]],
    ["pusta baza", [], [...REQUIRED_CONSTRAINTS]],
  ])("%s → odmowa z listą braków", (_n, present, missing) => {
    const r = checkSchema(present, fullRls(), RLS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.missing).toEqual(missing);
  });

  it("nazwa podobna (prefiks) nie zastępuje ograniczenia", () => {
    const r = checkSchema(["appointments_no_overlap_old", "appointments_end_after_start", "time_blocks_end_after_start"], fullRls(), RLS);
    expect(r.ok).toBe(false);
  });

  it("push po migracjach (RLS zdjęte na wszystkich 41) → odmowa z liczbą tabel", () => {
    const rows = RLS.map((r) => ({ table: r.table, rls: false, policies: [] }));
    const r = checkSchema([...REQUIRED_CONSTRAINTS], rows, RLS);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.missing).toHaveLength(42);
    expect(r.missing).toContain("tabel z RLS w bazie 0 < 41 z migracji");
    expect(r.message).toMatch(
      /^RLS z migracji niekompletne \(42\): .* i 37 więcej — baza zbudowana bez db:migrate albo po nim nadpisana przez db:push\. .* Odbuduj: pnpm db:reset \(lokalnie\) albo pnpm db:migrate na pustej bazie\.$/
    );
  });

  it("brak EXCLUDE i RLS naraz → oba w missing i w komunikacie", () => {
    const rows = fullRls().map((x) => (x.table === "appointments" ? { ...x, rls: false } : x));
    const r = checkSchema(["appointments_end_after_start", "time_blocks_end_after_start"], rows, RLS);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.missing.slice(0, 2)).toEqual(["appointments_no_overlap", "appointments (RLS wyłączone)"]);
    expect(r.message).toMatch(/^Brak appointments_no_overlap; RLS z migracji niekompletne \(2\): /);
    expect(r.message).toMatch(/ Odbuduj: pnpm db:reset/);
  });

  it("D3: liczba tabel z włączonym RLS mniejsza niż w pliku → osobny wpis z liczbami", () => {
    const rows = fullRls().map((x) => (x.table === "appointments" ? { ...x, rls: false } : x));
    const r = checkSchema([...REQUIRED_CONSTRAINTS], rows, RLS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.missing).toContain("tabel z RLS w bazie 40 < 41 z migracji");
  });

  it("D3: liczba tabel z RLS w bazie mniejsza mimo kompletu wymagań → odmowa (osobna gałąź)", () => {
    const req = RLS.slice(0, 2);
    const rows = [{ table: req[0]!.table, rls: true, policies: [req[0]!.policy] }, { table: req[1]!.table, rls: true, policies: [req[1]!.policy] }];
    expect(checkSchema([...REQUIRED_CONSTRAINTS], rows, req)).toEqual({ ok: true });
    const r = checkSchema([...REQUIRED_CONSTRAINTS], rows, [...req, req[0]!]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.missing).toEqual(["tabel z RLS w bazie 2 < 3 z migracji"]);
  });

  it("schemat korzysta ze wspólnego strażnika RLS (#194), bez własnego parsera", () => {
    const src = read("scripts/db-schema-guard.ts");
    expect(src).toMatch(/from "\.\/db-rls-guard"/);
    expect(src).not.toMatch(/function parseRlsRequirements|direct_tables|indirect_map|pg_policies/);
  });

  it("D3: dodatkowe tabele z RLS spoza pliku nie przeszkadzają", () => {
    const rows = [...fullRls(), { table: "extra", rls: true, policies: [] }];
    expect(checkSchema([...REQUIRED_CONSTRAINTS], rows, RLS)).toEqual({ ok: true });
  });

  it.each([
    ["RLS wyłączone na appointments", (rows: RlsRow[]) => rows.map((x) => (x.table === "appointments" ? { ...x, rls: false } : x)), "appointments (RLS wyłączone)"],
    ["brak polityki na deposit_payments", (rows: RlsRow[]) => rows.map((x) => (x.table === "deposit_payments" ? { ...x, policies: [] } : x)), "deposit_payments (brak polityki tenant_isolation)"],
    ["salons z tenant_isolation zamiast tenant_self", (rows: RlsRow[]) => rows.map((x) => (x.table === "salons" ? { ...x, policies: ["tenant_isolation"] } : x)), "salons (brak polityki tenant_self)"],
    ["brak tabeli clients", (rows: RlsRow[]) => rows.filter((x) => x.table !== "clients"), "clients (brak tabeli)"],
  ])("%s → odmowa wskazująca tabelę", (_n, mutate, expected) => {
    const r = checkSchema([...REQUIRED_CONSTRAINTS], mutate(fullRls()), RLS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.missing[0]).toBe(expected);
  });

  it("zapytania tylko do odczytu katalogu", () => {
    for (const q of [SCHEMA_GUARD_SQL, RLS_GUARD_SQL]) {
      expect(q).toMatch(/^select /);
      expect(q).not.toMatch(/;|\b(insert|update|delete|drop|alter|create|truncate|grant)\b/i);
    }
    for (const n of REQUIRED_CONSTRAINTS) expect(SCHEMA_GUARD_SQL).toContain(`'${n}'`);
    expect(RLS_GUARD_SQL).toContain("relrowsecurity");
    expect(RLS_GUARD_SQL).toContain("pg_policies");
  });

  it("runSchemaGuard: oba zapytania → decyzja", async () => {
    const req: RlsRequirement[] = [{ table: "appointments", policy: "tenant_isolation" }];
    const unsafe = vi.fn(async (q: string) =>
      q === SCHEMA_GUARD_SQL
        ? REQUIRED_CONSTRAINTS.map((conname) => ({ conname }))
        : [{ table: "appointments", rls: true, policies: ["tenant_isolation"] }]
    );
    expect(await runSchemaGuard({ unsafe } as never, req)).toEqual({ ok: true });
    expect(unsafe).toHaveBeenCalledWith(SCHEMA_GUARD_SQL);
    expect(unsafe).toHaveBeenCalledWith(RLS_GUARD_SQL);
  });
});

describe("db:reset — plan (bez połączenia)", () => {
  it("domyślnie pos_dev; lista twarda: pos_dev, pos_reset_test", () => {
    expect(RESET_DEFAULT_DATABASE).toBe("pos_dev");
    expect(RESET_ALLOWED_DATABASES).toEqual(["pos_dev", "pos_reset_test"]);
    expect(planReset([], LOCAL)).toMatchObject({ ok: true, database: "pos_dev" });
  });

  it("pos_reset_test: kroki dostają adres TEJ bazy, admin łączy się z bazą postgres", () => {
    const p = planReset(["pos_reset_test"], LOCAL);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.targetUrl).toBe("postgresql://dev_user:pw-x9@localhost:5432/pos_reset_test");
    expect(p.adminUrl).toBe("postgresql://dev_user:pw-x9@localhost:5432/postgres");
  });

  it.each([["pos_prod"], ["postgres"], ["pos_dev2"], ["POS_DEV"], ['pos_dev"; drop database x; --'], [""]])(
    "baza %j spoza listy → odmowa, bez adresu w komunikacie",
    (name) => {
      const p = planReset([name], LOCAL);
      expect(p.ok).toBe(false);
      if (p.ok) return;
      expect(p.reason).toContain("spoza listy (pos_dev, pos_reset_test)");
      expect(p.reason).not.toContain("pw-x9");
      expect(p.reason).not.toContain("drop database");
    }
  );

  it.each([
    ["Neon", "postgresql://u:p@ep-x.eu-central-1.aws.neon.tech/pos_dev"],
    ["zdalny host", "postgresql://u:p@db.example.com:5432/pos_dev"],
    ["brak adresu", undefined],
  ])("%s → odmowa", (_n, url) => {
    const p = planReset(["pos_dev"], url);
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.reason).toMatch(/^db:reset odmawia: /);
  });

  it("VERCEL_ENV=production → odmowa", () => {
    expect(planReset([], LOCAL, { VERCEL_ENV: "production" }).ok).toBe(false);
  });

  // B2 (Ethan): sterownik pg w drizzle-kit bierze host z `?host=`, a
  // bezpieczniki oceniają adres jak postgres.js — localhost przeszedłby, pg
  // połączyłby się z Neonem.
  it.each([
    ["host Neona w ?host=", `${LOCAL}?host=ep-x.eu-central-1.aws.neon.tech`, "host"],
    ["HOST wielkimi literami", `${LOCAL}?HOST=db.example.com`, "HOST"],
    ["hostaddr", `${LOCAL}?hostaddr=10.0.0.5`, "hostaddr"],
    ["options", `${LOCAL}?options=-c%20role%3Dx`, "options"],
    ["sslmode + host", `${LOCAL}?sslmode=disable&host=db.example.com`, "host"],
  ])("%s → odmowa z nazwą parametru, bez wartości", (_n, url, name) => {
    const p = planReset(["pos_dev"], url);
    expect(p.ok).toBe(false);
    if (p.ok) return;
    expect(p.reason).toContain(`parametry zapytania spoza listy (${name})`);
    expect(p.reason).not.toMatch(/neon\.tech|example\.com|10\.0\.0\.5|pw-x9/);
  });

  it("sam sslmode dopuszczony; adresy dla kroków i admina BEZ zapytania", () => {
    const p = planReset(["pos_reset_test"], `${LOCAL}?sslmode=disable`);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.targetUrl).toBe("postgresql://dev_user:pw-x9@localhost:5432/pos_reset_test");
    expect(p.adminUrl).toBe("postgresql://dev_user:pw-x9@localhost:5432/postgres");
  });

  it("kroki po założeniu bazy: migrate → strażnik; bez push i bez drizzle-kit drop", () => {
    expect(RESET_STEPS.map((s) => s.join(" "))).toEqual([
      "pnpm exec drizzle-kit migrate",
      "pnpm exec tsx scripts/db-schema-guard.ts",
    ]);
  });

  it("skrypt resetu nie używa WITH (FORCE) i sprawdza inne połączenia", () => {
    const code = read("scripts/db-reset-local.ts")
      .split("\n")
      .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
      .join("\n");
    expect(code).not.toMatch(/FORCE/i);
    expect(code).toContain("pg_stat_activity");
  });
});

describe("db:reset — przebieg (L1, Leo): każdy krok na resetowanej bazie", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Klient postgres.js na niby: localhost, serwer bez neon.* (domyślnie), `busy` innych połączeń. */
  function fakeAdmin(
    busy = 0,
    probeRows: unknown[] = [{ database: "postgres", neon_settings: 0 }],
    options: { host: string[]; path: string | undefined } = { host: ["localhost"], path: undefined },
  ) {
    const unsafe = vi.fn(async (q: string) => (q.includes("neon") ? probeRows : []));
    const tag = vi.fn(async () => [{ n: busy }]);
    const sql = Object.assign(tag, { unsafe, end: vi.fn(async () => {}), options });
    return { sql, unsafe, tag };
  }

  function deps(admin = fakeAdmin(), status = 0) {
    const spawn = vi.fn((_c: string, _a: readonly string[], _e: ResetEnv) => ({ status }));
    const connect = vi.fn((_u: string) => admin.sql as never);
    return { d: { connect, spawn } as ResetDeps, spawn, connect, admin };
  }

  it("pos_reset_test przy POSTGRES_URL na pos_dev: DROP/CREATE pos_reset_test, migrate i strażnik na pos_reset_test", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { d, spawn, connect, admin } = deps();
    const rc = await resetMain(["pos_reset_test"], { POSTGRES_URL: LOCAL, PATH: "/bin" }, d);
    expect(rc).toBe(0);
    expect(connect).toHaveBeenCalledWith("postgresql://dev_user:pw-x9@localhost:5432/postgres");
    expect(admin.unsafe).toHaveBeenCalledWith('DROP DATABASE IF EXISTS "pos_reset_test"');
    expect(admin.unsafe).toHaveBeenCalledWith('CREATE DATABASE "pos_reset_test"');
    expect(spawn).toHaveBeenCalledTimes(2);
    for (const [cmd, args, env] of spawn.mock.calls) {
      expect(env.POSTGRES_URL, `${cmd} ${args.join(" ")}`).toBe("postgresql://dev_user:pw-x9@localhost:5432/pos_reset_test");
      expect(env.PATH).toBe("/bin");
    }
    expect(spawn.mock.calls.map(([c, a]) => [c, ...a].join(" "))).toEqual(RESET_STEPS.map((s) => s.join(" ")));
  });

  it("?host= w adresie: odmowa przed połączeniem i bez kroków", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { d, spawn, connect } = deps();
    const rc = await resetMain(["pos_reset_test"], { POSTGRES_URL: `${LOCAL}?host=ep-x.neon.tech` }, d);
    expect(rc).toBe(1);
    expect(connect).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
  });

  // L8 (Leo): druga warstwa po kontroli hosta — serwer z ustawieniami neon.*
  // albo sonda bez wyniku → odmowa przed DROP.
  it.each([
    ["serwer z ustawieniami neon.*", [{ database: "postgres", neon_settings: 1 }]],
    ["sonda bez wiersza", []],
  ])("%s: odmowa, bez DROP i bez kroków", async (_n, probeRows) => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { d, spawn, admin } = deps(fakeAdmin(0, probeRows));
    expect(await resetMain(["pos_reset_test"], { POSTGRES_URL: LOCAL }, d)).toBe(1);
    expect(admin.unsafe).toHaveBeenCalledWith(expect.stringContaining("neon"));
    expect(admin.unsafe).not.toHaveBeenCalledWith(expect.stringMatching(/^(DROP|CREATE)/));
    expect(admin.tag).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
    expect(err.mock.calls.flat().join(" ")).toContain("serwer ma ustawienia neon.*");
  });

  // Ethan do c16a7fd: checkSeedClientOptions na kliencie admina stoi przed sondą i DROP.
  it.each([
    ["host Neon w opcjach klienta", { host: ["ep-x.eu-central-1.aws.neon.tech"], path: undefined }],
    ["host spoza localhost", { host: ["db.example.com"], path: undefined }],
    ["localhost obok obcego hosta", { host: ["localhost", "db.example.com"], path: undefined }],
    ["gniazdo unix (options.path)", { host: ["localhost"], path: "/tmp/.s.PGSQL.5432" }],
  ])("klient admina: %s → rc 1, bez sondy, DROP/CREATE i kroków", async (_n, options) => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { d, spawn, admin } = deps(fakeAdmin(0, undefined, options));
    expect(await resetMain(["pos_reset_test"], { POSTGRES_URL: LOCAL }, d)).toBe(1);
    expect(admin.unsafe).not.toHaveBeenCalled();
    expect(admin.tag).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
    expect(admin.sql.end).toHaveBeenCalled();
    const out = err.mock.calls.flat().join(" ");
    expect(out).toContain("[db-reset] db:reset odmawia:");
    expect(out).not.toMatch(/pw-x9|dev_user/);
  });

  it("inne połączenia z bazą: odmowa, bez DROP i bez kroków", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { d, spawn, admin } = deps(fakeAdmin(2));
    expect(await resetMain([], { POSTGRES_URL: LOCAL }, d)).toBe(1);
    expect(admin.unsafe).not.toHaveBeenCalledWith(expect.stringMatching(/^DROP/));
    expect(spawn).not.toHaveBeenCalled();
  });

  it("nieudany migrate: przerwanie, strażnik nie startuje, kod 1", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { d, spawn } = deps(fakeAdmin(), 1);
    expect(await resetMain([], { POSTGRES_URL: LOCAL }, d)).toBe(1);
    expect(spawn).toHaveBeenCalledTimes(1);
  });
});

describe("db:push — tylko pusta baza (#188 pkt 2, decyzja D2)", () => {
  it("pusta baza (0 tabel w public, brak schematu drizzle) → push dozwolony z ostrzeżeniem", () => {
    expect(decidePush({ public_tables: 0, drizzle_schema: false })).toEqual({ ok: true, warning: PUSH_PROTOTYPE_WARNING });
    expect(PUSH_PROTOTYPE_WARNING).toMatch(/^baza prototypowa: bez EXCLUDE z 0009 i bez RLS z 0005/);
  });

  it("baza z dziennikiem migracji → odmowa z instrukcją db:generate + db:migrate", () => {
    expect(decidePush({ public_tables: 45, drizzle_schema: true })).toEqual({ ok: false, message: PUSH_REFUSED_MIGRATED });
    expect(PUSH_REFUSED_MIGRATED).toContain("baza zarządzana migracjami — użyj `db:generate` + `db:migrate`");
  });

  it("sam schemat drizzle bez tabel w public → odmowa", () => {
    expect(decidePush({ public_tables: 0, drizzle_schema: true }).ok).toBe(false);
  });

  it.each([[1], [45]])("%i tabel bez dziennika migracji → odmowa", (n) => {
    expect(decidePush({ public_tables: n, drizzle_schema: false })).toEqual({ ok: false, message: PUSH_REFUSED_NOT_EMPTY });
  });

  it.each([[undefined], [{}], [{ public_tables: "0", drizzle_schema: false }], [{ public_tables: 0, drizzle_schema: null }], [{ public_tables: 0.5, drizzle_schema: false }]])(
    "nieczytelny wynik %j → odmowa (fail closed)",
    (row) => {
      expect(decidePush(row).ok).toBe(false);
    }
  );

  it("zapytanie tylko do odczytu katalogu: tabele public i schemat drizzle", async () => {
    expect(PUSH_GATE_SQL).toMatch(/^select /);
    expect(PUSH_GATE_SQL).not.toMatch(/;|\b(insert|update|delete|drop|alter|create|truncate|grant)\b/i);
    expect(PUSH_GATE_SQL).toContain("n.nspname = 'public'");
    expect(PUSH_GATE_SQL).toContain("nspname = 'drizzle'");
    const unsafe = vi.fn(async () => [{ public_tables: 0, drizzle_schema: false }]);
    expect((await runPushGate({ unsafe } as never)).ok).toBe(true);
    expect(unsafe).toHaveBeenCalledWith(PUSH_GATE_SQL);
  });

  describe("adres bramki = adres pusha (uwaga Leo do ff8d306: ?host= w sterowniku pg)", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    function fakeGateSql(row: unknown = { public_tables: 0, drizzle_schema: false }) {
      return { unsafe: vi.fn(async () => [row]), end: vi.fn(async () => {}) };
    }

    it.each([
      ["host w ?host=", `${LOCAL}?host=ep-x.eu-central-1.aws.neon.tech`, "host"],
      ["HOST wielkimi literami", `${LOCAL}?HOST=db.example.com`, "HOST"],
      ["hostaddr", `${LOCAL}?hostaddr=10.0.0.5`, "hostaddr"],
      ["sslmode + host", `${LOCAL}?sslmode=disable&host=db.example.com`, "host"],
    ])("%s → odmowa PRZED połączeniem, nazwa parametru bez wartości", async (_n, url, name) => {
      const err = vi.spyOn(console, "error").mockImplementation(() => {});
      const connect = vi.fn((_u: string) => fakeGateSql() as never);
      expect(await pushGateMain({ POSTGRES_URL: url }, connect)).toBe(1);
      expect(connect).not.toHaveBeenCalled();
      const out = err.mock.calls.flat().join(" ");
      expect(out).toContain(`db:push odmawia: POSTGRES_URL ma parametry zapytania spoza listy (${name})`);
      expect(out).not.toMatch(/neon\.tech|example\.com|10\.0\.0\.5|pw-x9/);
    });

    it("sam sslmode na pustej bazie → bramka łączy się z tym adresem i przepuszcza", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const sql = fakeGateSql();
      const connect = vi.fn((_u: string) => sql as never);
      expect(await pushGateMain({ POSTGRES_URL: `${LOCAL}?sslmode=disable` }, connect)).toBe(0);
      expect(connect).toHaveBeenCalledWith(`${LOCAL}?sslmode=disable`);
      expect(sql.end).toHaveBeenCalled();
    });

    it("zmigrowana baza → rc 1 (bramka przez pushGateMain)", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const connect = vi.fn((_u: string) => fakeGateSql({ public_tables: 45, drizzle_schema: true }) as never);
      expect(await pushGateMain({ POSTGRES_URL: LOCAL }, connect)).toBe(1);
    });

    // Ethan do c16a7fd: gałąź błędu — zapytanie odrzucone (np. brak połączenia).
    it.each([
      ["błąd z kodem", "ECONNREFUSED", " (ECONNREFUSED)"],
      ["błąd bez kodu", undefined, ""],
    ])("zapytanie bramki odrzuca (%s) → rc 1, end wywołane, stderr bez adresu i danych logowania", async (_n, code, suffix) => {
      const err = vi.spyOn(console, "error").mockImplementation(() => {});
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      // Treść błędu jak z sterownika: z adresem, użytkownikiem i hasłem — nie może trafić na stderr.
      const leak = new Error(`connect failed for ${LOCAL} (user dev_user)`);
      const sql = { unsafe: vi.fn(async () => Promise.reject(Object.assign(leak, code ? { code } : {}))), end: vi.fn(async () => {}) };
      const connect = vi.fn((_u: string) => sql as never);
      expect(await pushGateMain({ POSTGRES_URL: LOCAL }, connect)).toBe(1);
      expect(sql.unsafe).toHaveBeenCalledWith(PUSH_GATE_SQL);
      expect(sql.end).toHaveBeenCalledTimes(1);
      expect(warn).not.toHaveBeenCalled();
      const out = err.mock.calls.flat().join(" ");
      expect(out).toBe(`[db-push-gate] db:push odmawia: nie udało się sprawdzić bazy${suffix}`);
      expect(out).not.toMatch(/pw-x9|dev_user|localhost|5432|connect failed/);
    });

    it("niepoprawny adres → odmowa bez połączenia", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const connect = vi.fn((_u: string) => fakeGateSql() as never);
      // Adres w zmiennej: literał przy kluczu POSTGRES_URL łapie secret-guard.test.
      const notAUrl = ["nie", "adres"].join("-");
      expect(await pushGateMain({ POSTGRES_URL: notAUrl }, connect)).toBe(1);
      expect(connect).not.toHaveBeenCalled();
    });

    it("reset i bramka używają tej samej funkcji z db-url-guard (nie kopii)", () => {
      for (const f of ["scripts/db-reset-local.ts", "scripts/db-push-gate.ts"]) {
        const src = read(f);
        expect(src, f).toMatch(/import \{[^}]*queryParamsRefusal[^}]*\} from "\.\/db-url-guard"/);
        expect(src, f).not.toMatch(/searchParams/);
      }
      expect(RESET_ALLOWED_QUERY_PARAMS).toBe(DB_URL_ALLOWED_QUERY_PARAMS);
      expect(DB_URL_ALLOWED_QUERY_PARAMS).toEqual(["sslmode"]);
    });
  });

  it("db:push i db:dev: najpierw bramka, potem push; strażnik schematu NIE stoi po pushu", () => {
    for (const s of ["db:push", "db:dev"]) {
      expect(PKG.scripts[s], s).toBe("tsx scripts/db-push-gate.ts && drizzle-kit push");
    }
  });

  it("żaden inny skrypt package.json nie woła drizzle-kit push z pominięciem bramki", () => {
    for (const [name, cmd] of Object.entries(PKG.scripts)) {
      if (!/drizzle-kit\s+push/.test(cmd)) continue;
      expect(cmd, name).toMatch(/^tsx scripts\/db-push-gate\.ts && drizzle-kit push$/);
    }
  });
});

describe("package.json", () => {
  it("db:reset przez db-reset-local; żaden skrypt nie woła drizzle-kit drop", () => {
    expect(PKG.scripts["db:reset"]).toBe("tsx scripts/db-reset-local.ts");
    for (const [name, cmd] of Object.entries(PKG.scripts)) {
      expect(cmd, name).not.toMatch(/drizzle-kit\s+drop/);
    }
  });

  it("martwy skrypt setup usunięty; każdy scripts/*.ts wołany z package.json istnieje", () => {
    expect(PKG.scripts).not.toHaveProperty("setup");
    const referenced = Object.values(PKG.scripts).flatMap((c) => c.match(/scripts\/[\w./-]+\.ts/g) ?? []);
    expect(referenced.length).toBeGreaterThan(0);
    for (const f of referenced) expect(existsSync(join(ROOT, f)), f).toBe(true);
  });

  it("db:migrate bez zmian (drizzle-kit migrate)", () => {
    expect(PKG.scripts["db:migrate"]).toBe("drizzle-kit migrate");
  });
});

describe("init.sh", () => {
  it("schemat przez migracje i strażnika; bez push", () => {
    expect(INIT).toContain("pnpm db:migrate && pnpm exec tsx scripts/db-schema-guard.ts");
    expect(INIT).not.toMatch(/drizzle-kit push|db:push|db:dev/);
  });

  it("błąd bazy nie jest wyciszany i przerywa skrypt", () => {
    const dbLines = INIT.split("\n").filter((l) => /db:migrate|db-schema-guard|drizzle-kit/.test(l));
    for (const l of dbLines) expect(l, l).not.toContain("2>/dev/null");
    expect(INIT).toMatch(/if ! \{ pnpm db:migrate && pnpm exec tsx scripts\/db-schema-guard\.ts; \}; then\n[^\n]*\n\s+exit 1/);
  });
});

describe("CI (quality-gate.yml): baza testów z migracji", () => {
  const jobs = QG.split(/\n {2}(?=[\w-]+:\n)/).filter((j) => /run: pnpm (db:push|db:migrate|test:pg)/.test(j));

  it("są joby z bazą", () => {
    expect(jobs.length).toBeGreaterThanOrEqual(2);
  });

  it.each(jobs.map((j, i) => [i, j] as const))("job %i: db:migrate, a db:push (jeśli jest) po nim; lokalny POSTGRES_URL", (_i, job) => {
    const migrate = job.indexOf("run: pnpm db:migrate");
    const push = job.indexOf("run: pnpm db:push");
    expect(migrate).toBeGreaterThan(-1);
    if (push > -1) expect(migrate).toBeLessThan(push);
    expect(job).toMatch(/POSTGRES_URL: postgresql:\/\/[^\n]*@localhost:5432\/pos_dev/);
  });
});

describe("README", () => {
  it("zdanie o budowaniu bazy od zera, bez fałszywego „drop all tables”", () => {
    expect(README).toContain("Bazę od zera buduje `pnpm db:migrate`");
    expect(README).not.toMatch(/drop all tables/i);
  });
});
