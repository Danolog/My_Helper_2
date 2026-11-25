/**
 * #193: strażnik uprawnień roli aplikacji do tabel.
 *
 * Część uprawnień (blokująca, biegnie w test:pg):
 * - niezmiennik: każda tabela w `public` (relkind r, p), do której
 *   `myhelper_app` albo — gdy istnieje — `myhelper_app_login` ma JAKIEKOLWIEK uprawnienie
 *   tabelowe (7) albo kolumnowe (4), ma `relrowsecurity` i co najmniej jedną politykę ALBO jest
 *   na liście GLOBAL_TABLES / DEBT_TABLES;
 * - lista „bez dostępu puli żądań” (NO_ACCESS_TABLES, kierunek odwrotny): żadnego uprawnienia
 *   tabelowego ani kolumnowego, a tabela bez uprawnień roli aplikacji spoza tej listy → czerwony;
 * - listy w formacie #230 (`exception-list.ts`), bez martwych i zbędnych pozycji;
 * - `pg_default_acl` roli wykonującej migracje (`current_user` testu) równe dokładnie
 *   DEFAULT_ACL — bez wpisów typu f.
 * `has_table_privilege` / `has_any_column_privilege` liczą wszystkie drogi (wprost, PUBLIC,
 * członkostwo).
 *
 * Reguła dla migracji: tabela, która ma być bez dostępu puli żądań, dostaje w tej samej migracji
 * jawne `REVOKE ALL ON <tabela> FROM myhelper_app, PUBLIC` i pozycję w NO_ACCESS_TABLES.
 *
 * Część atrybutów roli („Strażnik roli (stan po #193 P6, tylko z P6_ROLE_GUARD=1)”) biegnie tylko z `P6_ROLE_GUARD=1`;
 * bez flagi jest pominięta (dotyczy stanu po #193 P6).
 *
 * Sondy powstają w transakcji, która jest wycofywana — test niczego trwale nie zmienia.
 *
 *   INTEGRATION_POSTGRES_URL=postgresql://…@localhost:5432/pos_dev pnpm exec vitest run --config vitest.pg.config.ts __tests__/pg/app-role-tables.pg.test.ts
 *   P6_ROLE_GUARD=1 INTEGRATION_POSTGRES_URL=… (to samo) — część atrybutów roli
 *
 * Wymaga bazy po `pnpm db:migrate`.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { type ExceptionEntry, exceptionFormatViolations } from "./exception-list";

const h = await vi.hoisted(async () => (await import("./pg-harness")).createIntegrationDb());
const suite = h ? describe : describe.skip;
const roleSuite = h && process.env.P6_ROLE_GUARD === "1" ? describe : describe.skip;

type QueryRunner = { unsafe: (query: string) => PromiseLike<readonly unknown[]> };

const APP_ROLE = "myhelper_app";
const LOGIN_ROLE = "myhelper_app_login";
const ROLES_SQL = `(SELECT rolname FROM pg_roles WHERE rolname IN ('${APP_ROLE}', '${LOGIN_ROLE}'))`;
const TABLE_PRIVS = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"];
const COLUMN_PRIVS = ["SELECT", "INSERT", "UPDATE", "REFERENCES"];
const lit = (xs: readonly string[]) => xs.map((x) => `'${x}'`).join(", ");

/** Numer PR, w którym pozycje trafiają na listy. */
const THIS_PR = 242;
/** PR tabeli liczników limitu prób logowania. */
const AUTH_RATE_LIMIT_PR = 248;
const BOTH = ["CTO", "CRCO"];

/** Tabele wspólne dla wszystkich salonów, z uprawnieniami roli aplikacji, bez RLS. */
const GLOBAL_TABLES: ExceptionEntry[] = [
  { name: "user", reason: "Konta użytkowników wspólne dla wszystkich salonów; dostęp puli żądań zamyka #193 P6.", acceptedBy: BOTH, pr: THIS_PR },
  { name: "subscription_plans", reason: "Globalny katalog planów bez kolumny salonu; pula żądań ma wyłącznie odczyt.", acceptedBy: BOTH, pr: THIS_PR },
];

/** Dług przejściowy: tabele z uprawnieniami bez RLS, z partią zamykającą w uzasadnieniu. */
const DEBT_TABLES: ExceptionEntry[] = [
  { name: "temporary_access", reason: "Dostęp czasowy bez RLS do partii P2, która przenosi go za bramę salonu.", acceptedBy: BOTH, pr: THIS_PR },
  { name: "push_subscriptions", reason: "Subskrypcje push bez RLS do partii P4, która przenosi je za bramę salonu.", acceptedBy: BOTH, pr: THIS_PR },
];

/** Bez dostępu puli żądań (kierunek odwrotny): migracja z jawnym REVOKE ALL dla roli aplikacji i PUBLIC. */
const NO_ACCESS_TABLES: ExceptionEntry[] = [
  { name: "session", reason: "Sesje logowania czyta wyłącznie adapter auth na puli systemowej.", acceptedBy: BOTH, pr: THIS_PR },
  { name: "account", reason: "Konta logowania z hasłami czyta wyłącznie adapter auth na puli systemowej.", acceptedBy: BOTH, pr: THIS_PR },
  { name: "verification", reason: "Tokeny weryfikacji czyta wyłącznie adapter auth na puli systemowej.", acceptedBy: BOTH, pr: THIS_PR },
  { name: "auth_rate_limit", reason: "Liczniki limitu prób logowania czyta i zapisuje wyłącznie wyjście systemowe na puli systemowej.", acceptedBy: BOTH, pr: AUTH_RATE_LIMIT_PR },
];

type Lists = { global: readonly ExceptionEntry[]; debt: readonly ExceptionEntry[]; noAccess: readonly ExceptionEntry[] };
const LISTS: Lists = { global: GLOBAL_TABLES, debt: DEBT_TABLES, noAccess: NO_ACCESS_TABLES };

/** pg_default_acl roli migracji: `schemat typ odbiorca PRAWO` (`*` = wpis globalny), posortowane. */
const DEFAULT_ACL: readonly string[] = [
  "public S myhelper_app SELECT",
  "public S myhelper_app USAGE",
  "public r myhelper_app DELETE",
  "public r myhelper_app INSERT",
  "public r myhelper_app SELECT",
  "public r myhelper_app UPDATE",
];
const DEFAULT_ACL_MSG = "zmianę uprawnień domyślnych akceptują CTO i CRCO (#193)";

type TableRow = { t: string; rls: boolean; policies: number };
type PrivRow = { t: string; role: string; priv: string };

async function tables(sql: QueryRunner): Promise<TableRow[]> {
  return (await sql.unsafe(`
    SELECT c.relname::text AS t, c.relrowsecurity AS rls,
      (SELECT count(*)::int FROM pg_policy pol WHERE pol.polrelid = c.oid) AS policies
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
    ORDER BY 1`)) as TableRow[];
}

/** Uprawnienia ról aplikacji (rola logowania, gdy istnieje) do tabel w public. */
async function privileges(sql: QueryRunner): Promise<PrivRow[]> {
  return (await sql.unsafe(`
    SELECT c.relname::text AS t, r.rolname::text AS role, 'tabelowe ' || p AS priv
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN ${ROLES_SQL} r
    CROSS JOIN unnest(ARRAY[${lit(TABLE_PRIVS)}]) p
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND has_table_privilege(r.rolname, c.oid, p)
    UNION ALL
    SELECT c.relname::text, r.rolname::text, 'kolumnowe ' || p
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN ${ROLES_SQL} r
    CROSS JOIN unnest(ARRAY[${lit(COLUMN_PRIVS)}]) p
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND has_any_column_privilege(r.rolname, c.oid, p)`)) as PrivRow[];
}

/** Uprawnienia pogrupowane: `tabela|rola` → posortowana lista praw. */
function grouped(rows: readonly PrivRow[]): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const r of rows) m.set(`${r.t}|${r.role}`, [...(m.get(`${r.t}|${r.role}`) ?? []), r.priv]);
  for (const v of m.values()) v.sort();
  return new Map([...m.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** Naruszenia części uprawnień (pusta lista = strażnik zielony). */
async function tableViolations(sql: QueryRunner, lists: Lists = LISTS): Promise<string[]> {
  const out: string[] = [];
  const all = await tables(sql);
  const byName = new Map(all.map((r) => [r.t, r]));
  const privs = grouped(await privileges(sql));
  const excepted = new Set([...lists.global, ...lists.debt].map((e) => e.name));
  const noAccess = new Set(lists.noAccess.map((e) => e.name));

  // Pozycje list: ta sama tabela na dwóch listach, martwe pozycje, pozycje zbędne.
  const named: Array<[string, readonly ExceptionEntry[]]> = [
    ["GLOBAL_TABLES", lists.global],
    ["DEBT_TABLES", lists.debt],
    ["NO_ACCESS_TABLES", lists.noAccess],
  ];
  const seen = new Map<string, string>();
  for (const [list, entries] of named) {
    for (const e of entries) {
      const prev = seen.get(e.name);
      if (prev !== undefined && prev !== list) out.push(`${e.name}: na dwóch listach (${prev}, ${list})`);
      seen.set(e.name, list);
      const row = byName.get(e.name);
      if (!row) out.push(`${e.name}: pozycja ${list} bez tabeli w bazie`);
      else if (list !== "NO_ACCESS_TABLES" && row.rls && row.policies > 0) out.push(`${e.name}: pozycja ${list} zbędna — tabela ma RLS i politykę`);
    }
  }

  // Niezmiennik: uprawnienie roli aplikacji ⇒ RLS i polityka albo wyjątek.
  for (const [key, p] of privs) {
    const [t, role] = key.split("|") as [string, string];
    const row = byName.get(t)!;
    if (noAccess.has(t)) out.push(`${t}: ${role} ma uprawnienia (${p.join(", ")}) — tabela z listy „bez dostępu”`);
    else if (excepted.has(t)) continue;
    else if (!row.rls) out.push(`${t}: ${role} ma uprawnienia (${p.join(", ")}) — brak RLS`);
    else if (row.policies === 0) out.push(`${t}: ${role} ma uprawnienia (${p.join(", ")}) — RLS bez polityki`);
  }

  // Kierunek odwrotny: tabela bez uprawnień roli aplikacji tylko z listy „bez dostępu”.
  const withAppPrivs = new Set([...privs.keys()].filter((k) => k.endsWith(`|${APP_ROLE}`)).map((k) => k.split("|")[0]));
  for (const r of all) {
    if (!withAppPrivs.has(r.t) && !noAccess.has(r.t)) out.push(`${r.t}: bez uprawnień ${APP_ROLE}, spoza listy „bez dostępu” (NO_ACCESS_TABLES)`);
  }
  return out;
}

/** pg_default_acl roli bieżącej (rola migracji), jak w DEFAULT_ACL. */
async function defaultAcl(sql: QueryRunner): Promise<string[]> {
  const rows = (await sql.unsafe(`
    SELECT coalesce(n.nspname, '*') || ' ' || d.defaclobjtype::text || ' ' || coalesce(g.rolname, 'PUBLIC') || ' ' || a.privilege_type AS v
    FROM pg_default_acl d
    LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
    CROSS JOIN LATERAL aclexplode(d.defaclacl) a
    LEFT JOIN pg_roles g ON g.oid = a.grantee
    WHERE d.defaclrole = (SELECT oid FROM pg_roles WHERE rolname = current_user)`)) as Array<{ v: string }>;
  return rows.map((r) => r.v).sort();
}

async function defaultAclViolations(sql: QueryRunner): Promise<string[]> {
  const actual = await defaultAcl(sql);
  return [
    ...actual.filter((x) => x.split(" ")[1] === "f").map((x) => `wpis typu f: ${x} — ${DEFAULT_ACL_MSG}`),
    ...actual.filter((x) => !DEFAULT_ACL.includes(x)).map((x) => `wpis spoza DEFAULT_ACL: ${x} — ${DEFAULT_ACL_MSG}`),
    ...DEFAULT_ACL.filter((x) => !actual.includes(x)).map((x) => `brak wpisu z DEFAULT_ACL: ${x} — ${DEFAULT_ACL_MSG}`),
  ];
}

/**
 * Część atrybutów roli: rola aplikacji i rola logowania (gdy istnieje) oraz role, do których
 * należą (rekurencyjnie) — bez rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, bez
 * własności obiektów w public, bez CREATE na public; brak roli logowania puli żądań
 * (powstaje w #193 P6) = naruszenie.
 */
async function roleViolations(sql: QueryRunner): Promise<string[]> {
  const out: string[] = [];
  const login = await sql.unsafe(`SELECT 1 FROM pg_roles WHERE rolname = '${LOGIN_ROLE}'`);
  if (login.length === 0) out.push(`${LOGIN_ROLE}: brak roli logowania puli żądań (powstaje w #193 P6)`);
  const rows = (await sql.unsafe(`
    WITH RECURSIVE app AS (SELECT oid, rolname FROM pg_roles WHERE rolname IN ('${APP_ROLE}', '${LOGIN_ROLE}')),
    mem(root, roleid) AS (
      SELECT a.oid, a.oid FROM app a
      UNION
      SELECT mem.root, m.roleid FROM mem JOIN pg_auth_members m ON m.member = mem.roleid)
    SELECT ra.rolname::text AS root, rv.rolname::text AS via,
      rv.rolsuper AS super, rv.rolbypassrls AS bypass, rv.rolcreaterole AS createrole, rv.rolcreatedb AS createdb,
      (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relowner = rv.oid) AS owned,
      has_schema_privilege(ra.rolname, 'public', 'CREATE') AS create_public
    FROM mem JOIN pg_roles ra ON ra.oid = mem.root JOIN pg_roles rv ON rv.oid = mem.roleid
    ORDER BY 1, 2`)) as Array<{
    root: string; via: string; super: boolean; bypass: boolean; createrole: boolean; createdb: boolean; owned: number; create_public: boolean;
  }>;
  for (const r of rows) {
    const who = r.root === r.via ? r.root : `${r.root} przez ${r.via}`;
    if (r.super) out.push(`${who}: rolsuper`);
    if (r.bypass) out.push(`${who}: rolbypassrls`);
    if (r.createrole) out.push(`${who}: rolcreaterole`);
    if (r.createdb) out.push(`${who}: rolcreatedb`);
    if (r.owned > 0) out.push(`${who}: właściciel ${r.owned} obiektów w public`);
  }
  for (const root of [...new Set(rows.filter((r) => r.create_public).map((r) => r.root))]) out.push(`${root}: CREATE na schemacie public`);
  const secdef = (await sql.unsafe(`
    SELECT r.rolname::text || ': wykonuje SECURITY DEFINER ' || p.oid::regprocedure::text AS v
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace CROSS JOIN ${ROLES_SQL} r
    WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND p.prosecdef AND p.prokind IN ('f', 'p')
      AND has_function_privilege(r.rolname, p.oid, 'EXECUTE')
    ORDER BY 1`)) as Array<{ v: string }>;
  return [...out, ...secdef.map((r) => r.v)];
}

class Rollback extends Error {}

/** Polecenia po kolei w jednej transakcji, potem `read` w tej samej transakcji, potem wycofanie. */
async function inRolledBackTx<T>(ddl: readonly string[], read: (tx: QueryRunner) => Promise<T>): Promise<T> {
  let result: { v: T } | undefined;
  await h!.observer
    .begin(async (tx) => {
      for (const stmt of ddl) await tx.unsafe(stmt);
      result = { v: await read(tx) };
      throw new Rollback();
    })
    .catch((e: unknown) => {
      if (!(e instanceof Rollback)) throw e;
    });
  if (!result) throw new Error("sonda nie zwróciła wyniku");
  return result.v;
}

const PROBE = "it_tables_probe";
const CREATE_PROBE = `CREATE TABLE public.${PROBE} (id int, secret text)`;
const REVOKE_PROBE = `REVOKE ALL ON TABLE public.${PROBE} FROM ${APP_ROLE}, PUBLIC`;
const entry = (name: string): ExceptionEntry => ({ name, reason: "Sonda testu, wycofywana razem z transakcją.", acceptedBy: BOTH, pr: 1 });
const withNoAccess = (name: string): Lists => ({ ...LISTS, noAccess: [...NO_ACCESS_TABLES, entry(name)] });
/** Rola logowania dochodzi w P6 — sondy porównują naruszenia bez niej. */
const noLogin = (v: string[]) => v.filter((x) => !x.includes(`: ${LOGIN_ROLE} `));

describe("listy wyjątków tabel: format #230 (#193)", () => {
  it.each([
    ["GLOBAL_TABLES", GLOBAL_TABLES],
    ["DEBT_TABLES", DEBT_TABLES],
    ["NO_ACCESS_TABLES", NO_ACCESS_TABLES],
  ] as Array<[string, ExceptionEntry[]]>)("%s: nazwa, jednozdaniowe uzasadnienie, obie role akceptujące w acceptedBy, numer PR", (_n, list) => {
    expect(exceptionFormatViolations(list)).toEqual([]);
  });

  const OK = entry("x_table");
  const noAccepted = Object.fromEntries(Object.entries(OK).filter(([k]) => k !== "acceptedBy")) as unknown as ExceptionEntry;
  it.each([
    ["bez acceptedBy", noAccepted, /brak akceptacji roli CTO/],
    ["z pr = 0", { ...OK, pr: 0 }, /brak numeru PR dodającego wyjątek/],
    ["z dwoma zdaniami w reason", { ...OK, reason: "Sonda testu. Wycofywana razem z transakcją." }, /brak jednozdaniowego uzasadnienia/],
  ] as Array<[string, ExceptionEntry, RegExp]>)("pozycja %s → naruszenie formatu", (_n, e, re) => {
    expect(exceptionFormatViolations([e]).join("\n")).toMatch(re);
  });
});

/** Jedno zamknięcie puli dla obu części (osobne afterAll w każdym describe zamknęłyby ją za wcześnie). */
afterAll(async () => {
  await h?.end();
});

suite("strażnik uprawnień roli aplikacji do tabel (#193)", () => {
  it("warunek wstępny: rola myhelper_app istnieje, tabel w public jest więcej niż pozycji list", async () => {
    expect(await h!.observer.unsafe(`SELECT 1 FROM pg_roles WHERE rolname = '${APP_ROLE}'`)).toHaveLength(1);
    expect((await tables(h!.observer)).length).toBeGreaterThan(GLOBAL_TABLES.length + DEBT_TABLES.length + NO_ACCESS_TABLES.length);
  });

  describe("sonda kontrolna: baza po db:migrate", () => {
    it("niezmiennik, lista „bez dostępu”, kierunek odwrotny: bez naruszeń", async () => {
      expect(await tableViolations(h!.observer)).toEqual([]);
    });
    it("inwentarz: tabele z uprawnieniami myhelper_app bez RLS lub bez polityki = GLOBAL_TABLES ∪ DEBT_TABLES", async () => {
      const all = new Map((await tables(h!.observer)).map((r) => [r.t, r]));
      const inv = [...grouped(await privileges(h!.observer)).keys()]
        .filter((k) => k.endsWith(`|${APP_ROLE}`))
        .map((k) => k.split("|")[0]!)
        .filter((t) => !all.get(t)!.rls || all.get(t)!.policies === 0)
        .sort();
      expect(inv).toEqual([...GLOBAL_TABLES, ...DEBT_TABLES].map((e) => e.name).sort());
    });
    it("pg_default_acl roli migracji równe DEFAULT_ACL, bez wpisów typu f", async () => {
      expect(await defaultAclViolations(h!.observer)).toEqual([]);
    });
  });

  describe("mutanty (wycofywana transakcja)", () => {
    it("nowa tabela bez RLS i bez REVOKE, spoza list → naruszenie", async () => {
      const v = noLogin(await inRolledBackTx([CREATE_PROBE], (tx) => tableViolations(tx)));
      expect(v).toEqual([expect.stringMatching(new RegExp(`^${PROBE}: ${APP_ROLE} ma uprawnienia \\(.*tabelowe SELECT.*\\) — brak RLS$`))]);
    });

    it("ta sama tabela dopisana do listy „bez dostępu” bez REVOKE → naruszenie", async () => {
      const v = noLogin(await inRolledBackTx([CREATE_PROBE], (tx) => tableViolations(tx, withNoAccess(PROBE))));
      expect(v).toEqual([expect.stringMatching(new RegExp(`^${PROBE}: ${APP_ROLE} ma uprawnienia \\(.*\\) — tabela z listy „bez dostępu”$`))]);
    });

    it("kontrola: tabela z REVOKE na liście „bez dostępu” → bez naruszeń", async () => {
      expect(await inRolledBackTx([CREATE_PROBE, REVOKE_PROBE], (tx) => tableViolations(tx, withNoAccess(PROBE)))).toEqual([]);
    });

    it("tabela z REVOKE spoza listy „bez dostępu” → naruszenie (kierunek odwrotny)", async () => {
      expect(await inRolledBackTx([CREATE_PROBE, REVOKE_PROBE], (tx) => tableViolations(tx))).toEqual([
        `${PROBE}: bez uprawnień ${APP_ROLE}, spoza listy „bez dostępu” (NO_ACCESS_TABLES)`,
      ]);
    });

    it("tabela z RLS bez polityki → naruszenie", async () => {
      const ddl = [CREATE_PROBE, `ALTER TABLE public.${PROBE} ENABLE ROW LEVEL SECURITY`];
      const v = noLogin(await inRolledBackTx(ddl, (tx) => tableViolations(tx)));
      expect(v).toEqual([expect.stringMatching(new RegExp(`^${PROBE}: ${APP_ROLE} ma uprawnienia \\(.*\\) — RLS bez polityki$`))]);
    });

    it("kontrola: tabela z RLS i polityką, z grantem domyślnym → bez naruszeń", async () => {
      const ddl = [
        CREATE_PROBE,
        `ALTER TABLE public.${PROBE} ENABLE ROW LEVEL SECURITY`,
        `CREATE POLICY ${PROBE}_p ON public.${PROBE} USING (id = 1)`,
      ];
      expect(await inRolledBackTx(ddl, (tx) => tableViolations(tx))).toEqual([]);
    });

    it("GRANT SELECT (password) ON account (lista „bez dostępu”) → naruszenie", async () => {
      const v = noLogin(await inRolledBackTx([`GRANT SELECT (password) ON account TO ${APP_ROLE}`], (tx) => tableViolations(tx)));
      expect(v).toEqual([`account: ${APP_ROLE} ma uprawnienia (kolumnowe SELECT) — tabela z listy „bez dostępu”`]);
    });

    it("grant kolumnowy na tabelę-sondę bez RLS spoza list, po REVOKE ALL → naruszenie", async () => {
      const ddl = [CREATE_PROBE, REVOKE_PROBE, `GRANT SELECT (secret) ON public.${PROBE} TO ${APP_ROLE}`];
      expect(noLogin(await inRolledBackTx(ddl, (tx) => tableViolations(tx)))).toEqual([
        `${PROBE}: ${APP_ROLE} ma uprawnienia (kolumnowe SELECT) — brak RLS`,
      ]);
    });

    it("GRANT TRUNCATE na tabelę-sondę spoza list, po REVOKE ALL → naruszenie", async () => {
      const ddl = [CREATE_PROBE, REVOKE_PROBE, `GRANT TRUNCATE ON public.${PROBE} TO ${APP_ROLE}`];
      expect(noLogin(await inRolledBackTx(ddl, (tx) => tableViolations(tx)))).toEqual([
        `${PROBE}: ${APP_ROLE} ma uprawnienia (tabelowe TRUNCATE) — brak RLS`,
      ]);
    });

    it("pozycja listy wyjątków dla tabeli z RLS i polityką → naruszenie (pozycja zbędna)", async () => {
      expect(await tableViolations(h!.observer, { ...LISTS, debt: [...DEBT_TABLES, entry("clients")] })).toEqual([
        "clients: pozycja DEBT_TABLES zbędna — tabela ma RLS i politykę",
      ]);
    });

    it("pozycja listy bez tabeli w bazie → naruszenie", async () => {
      expect(await tableViolations(h!.observer, withNoAccess(PROBE))).toEqual([`${PROBE}: pozycja NO_ACCESS_TABLES bez tabeli w bazie`]);
    });

    it("ALTER DEFAULT PRIVILEGES … GRANT TRUNCATE ON TABLES TO myhelper_app → naruszenie", async () => {
      const ddl = [`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT TRUNCATE ON TABLES TO ${APP_ROLE}`];
      expect(await inRolledBackTx(ddl, defaultAclViolations)).toEqual([`wpis spoza DEFAULT_ACL: public r ${APP_ROLE} TRUNCATE — ${DEFAULT_ACL_MSG}`]);
    });

    it("globalny ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC → wpis typu f", async () => {
      const v = await inRolledBackTx(["ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC"], defaultAclViolations);
      expect(v.join("\n")).toMatch(/^wpis typu f: \* f /m);
    });
  });

  it("po wycofaniu sond tabeli-sondy nie ma, strażnik zielony", async () => {
    expect(await h!.observer.unsafe(`SELECT 1 FROM pg_class WHERE relname = '${PROBE}'`)).toHaveLength(0);
    expect(await tableViolations(h!.observer)).toEqual([]);
    expect(await defaultAclViolations(h!.observer)).toEqual([]);
  });
});

roleSuite("Strażnik roli (stan po #193 P6, tylko z P6_ROLE_GUARD=1)", () => {
  it("rola aplikacji i rola logowania: bez super, bypassrls, createrole, createdb, własności, CREATE na public i SECURITY DEFINER", async () => {
    expect(await roleViolations(h!.observer)).toEqual([]);
  });
});
