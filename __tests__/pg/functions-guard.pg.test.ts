/**
 * #193: strażnik funkcji i rozszerzeń w bazie.
 *
 * - (a) zbiór rozszerzeń, porównywany jako para (nazwa, schemat) bez wersji, jest równy
 *   EXPECTED_EXTENSIONS;
 * - (b) każda funkcja w `public`, która nie należy do rozszerzenia (przynależność wyłącznie
 *   z `pg_depend`, `deptype = 'e'`), jest na zamkniętej liście FUNCTION_EXCEPTIONS (dziś pusta);
 * - (c) żadna funkcja ani procedura SECURITY DEFINER poza `pg_catalog` i `information_schema`
 *   (także należąca do rozszerzenia) nie jest wykonywalna przez `myhelper_app` ani, gdy rola
 *   istnieje, `myhelper_app_login`. `has_function_privilege` liczy wszystkie drogi (PUBLIC,
 *   grant wprost, członkostwo). Wyjątków brak;
 * - (d) każda funkcja wołana w politykach RLS schematu `public` (wywołania funkcji i operatorów
 *   w drzewach USING / WITH CHECK z `pg_policy`) ma EXECUTE dla `myhelper_app`.
 *
 * Dlaczego nie `ALTER DEFAULT PRIVILEGES … REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC`
 * (sonda 16.11, PG 18, wycofane transakcje): wariant `IN SCHEMA public` nic nie zmienia —
 * EXECUTE dla PUBLIC to wbudowane uprawnienie globalne, a REVOKE per schemat cofa tylko to,
 * co nadał GRANT per schemat. Wariant globalny działa, ale obejmuje wszystkie schematy
 * i wszystkie przyszłe obiekty roli tworzącej, w tym funkcje z CREATE / ALTER EXTENSION
 * (btree_gist, od którego zależy EXCLUDE z 0009), a wpis zależy od roli tworzącej. Ochronę
 * daje więc ten test stanu bazy.
 *
 * Reguła dla przyszłych migracji: migracja z CREATE FUNCTION w `public` albo
 * z CREATE / ALTER EXTENSION zmienia odpowiednią listę w tym pliku, z akceptacją CTO i CRCO
 * w recenzji.
 *
 * Sondy powstają w transakcji, która jest wycofywana — test niczego trwale nie zmienia.
 *
 *   INTEGRATION_POSTGRES_URL=postgresql://…@localhost:5432/pos_dev pnpm exec vitest run --config vitest.pg.config.ts __tests__/pg/functions-guard.pg.test.ts
 *
 * Wymaga bazy po `pnpm db:migrate`.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { type ExceptionEntry, exceptionFormatViolations } from "./exception-list";

const h = await vi.hoisted(async () => (await import("./pg-harness")).createIntegrationDb());
const suite = h ? describe : describe.skip;

type QueryRunner = { unsafe: (query: string) => PromiseLike<readonly unknown[]> };

const APP_ROLE = "myhelper_app";
const LOGIN_ROLE = "myhelper_app_login";

/**
 * (a) Rozszerzenia jako `nazwa@schemat`, posortowane. Zmiana = recenzja CTO i CRCO
 * (stan po db:migrate, odczyt katalogu 16.11).
 */
const EXPECTED_EXTENSIONS: readonly string[] = ["btree_gist@public", "plpgsql@pg_catalog"];
const NEW_EXTENSION_MSG = "nowe rozszerzenie akceptują CTO i CRCO (#193)";

/** (b) Pozycja: `name` = sygnatura `schemat.funkcja(typy argumentów)`, jak w SIG niżej. */
type FunctionException = ExceptionEntry;

/**
 * (b) ZAMKNIĘTA lista funkcji własnych w `public` (format #230). Dopisanie pozycji = recenzja
 * CTO i CRCO w tym PR.
 */
const FUNCTION_EXCEPTIONS: FunctionException[] = [];

const SIGNATURE_NAME = {
  pattern: /^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*\([^()]*\)$/,
  rule: "nazwa spoza formatu sygnatury schemat.funkcja(typy argumentów)",
};

/** Sygnatura funkcji `p` w schemacie `n`: `public.f(uuid, text)` (typy wejściowe, jak regprocedure). */
const SIG = "quote_ident(n.nspname) || '.' || quote_ident(p.proname) || '(' || oidvectortypes(p.proargtypes) || ')'";

/** (a) Naruszenia zbioru rozszerzeń względem `expected`. */
async function extensionViolations(sql: QueryRunner, expected: readonly string[] = EXPECTED_EXTENSIONS): Promise<string[]> {
  const rows = (await sql.unsafe(`
    SELECT e.extname || '@' || n.nspname AS v
    FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
    ORDER BY 1`)) as Array<{ v: string }>;
  const actual = rows.map((r) => r.v);
  return [
    ...actual.filter((x) => !expected.includes(x)).map((x) => `rozszerzenie spoza listy: ${x} — ${NEW_EXTENSION_MSG}`),
    ...expected.filter((x) => !actual.includes(x)).map((x) => `brak rozszerzenia z listy: ${x} — ${NEW_EXTENSION_MSG}`),
  ];
}

/** (b) Sygnatury funkcji w `public` spoza rozszerzeń (wszystkie rodzaje prokind). */
async function ownPublicFunctions(sql: QueryRunner): Promise<string[]> {
  const rows = (await sql.unsafe(`
    SELECT ${SIG} AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND NOT EXISTS (
        SELECT 1 FROM pg_depend d
        WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
    ORDER BY 1`)) as Array<{ sig: string }>;
  return rows.map((r) => r.sig);
}

/** (b) Naruszenia: funkcja własna spoza listy; pozycja listy bez funkcji w bazie. */
async function ownFunctionViolations(sql: QueryRunner, exceptions: readonly FunctionException[] = FUNCTION_EXCEPTIONS): Promise<string[]> {
  const own = await ownPublicFunctions(sql);
  const listed = exceptions.map((e) => e.name);
  return [
    ...own.filter((s) => !listed.includes(s)).map((s) => `${s}: funkcja w public spoza rozszerzeń i spoza FUNCTION_EXCEPTIONS`),
    ...listed.filter((s) => !own.includes(s)).map((s) => `${s}: pozycja FUNCTION_EXCEPTIONS bez funkcji w bazie`),
  ];
}

/**
 * (c) SECURITY DEFINER (prokind f i p) poza pg_catalog i information_schema wykonywalne przez
 * rolę aplikacji: `sygnatura: rola EXECUTE`. Istnienie ról czytane z pg_roles w tym samym
 * zapytaniu (w transakcji sondy widać rolę założoną w tej transakcji).
 */
async function securityDefinerViolations(sql: QueryRunner): Promise<string[]> {
  const rows = (await sql.unsafe(`
    SELECT ${SIG} || ': ' || r.rolname || ' EXECUTE' || coalesce(' (należy do rozszerzenia ' || (
        SELECT e.extname FROM pg_depend d JOIN pg_extension e ON e.oid = d.refobjid
        WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid
          AND d.refclassid = 'pg_extension'::regclass AND d.deptype = 'e'
        LIMIT 1) || ')', '') AS v
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN (SELECT rolname FROM pg_roles WHERE rolname IN ('${APP_ROLE}', '${LOGIN_ROLE}')) r
    WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
      AND p.prosecdef
      AND p.prokind IN ('f', 'p')
      AND has_function_privilege(r.rolname, p.oid, 'EXECUTE')
    ORDER BY 1`)) as Array<{ v: string }>;
  return rows.map((r) => r.v);
}

/**
 * (d) Funkcje wołane w politykach `public`: identyfikatory z drzew `pg_policy.polqual`
 * i `polwithcheck` (`:funcid` wywołań funkcji, `:opno` operatorów → `pg_operator.oprcode`),
 * z informacją, czy myhelper_app ma EXECUTE.
 */
async function policyFunctions(sql: QueryRunner): Promise<Array<{ sig: string; ok: boolean }>> {
  return (await sql.unsafe(`
    WITH trees AS (
      SELECT coalesce(pol.polqual::text, '') || ' ' || coalesce(pol.polwithcheck::text, '') AS t
      FROM pg_policy pol
      JOIN pg_class c ON c.oid = pol.polrelid
      JOIN pg_namespace pn ON pn.oid = c.relnamespace
      WHERE pn.nspname = 'public'),
    fids AS (
      SELECT (m.arr[1])::oid AS fid FROM trees, LATERAL regexp_matches(trees.t, ':funcid (\\d+)', 'g') AS m(arr)
      UNION
      SELECT o.oprcode::oid FROM trees, LATERAL regexp_matches(trees.t, ':opno (\\d+)', 'g') AS m(arr)
        JOIN pg_operator o ON o.oid = (m.arr[1])::oid)
    SELECT ${SIG} AS sig, has_function_privilege('${APP_ROLE}', p.oid, 'EXECUTE') AS ok
    FROM fids
    JOIN pg_proc p ON p.oid = fids.fid
    JOIN pg_namespace n ON n.oid = p.pronamespace
    ORDER BY 1`)) as Array<{ sig: string; ok: boolean }>;
}

const policyFunctionViolations = async (sql: QueryRunner): Promise<string[]> =>
  (await policyFunctions(sql)).filter((f) => !f.ok).map((f) => `${f.sig}: funkcja polityki bez EXECUTE dla ${APP_ROLE}`);

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

/** Rola logowania dochodzi w P6 — sondy bez roli logowania porównują naruszenia bez niej. */
const noLogin = (v: string[]) => v.filter((x) => !x.endsWith(`: ${LOGIN_ROLE} EXECUTE`));

const PROBE_SCHEMA = "it_fn_probe";
const PROBE_FN = `${PROBE_SCHEMA}.f()`;
const SECDEF_FN = [`CREATE SCHEMA ${PROBE_SCHEMA}`, `CREATE FUNCTION ${PROBE_FN} RETURNS int LANGUAGE sql SECURITY DEFINER AS 'SELECT 1'`];
const REVOKE_PUBLIC = `REVOKE EXECUTE ON FUNCTION ${PROBE_FN} FROM PUBLIC`;
/** Kandydaci do sondy (a): rozszerzenia z obrazu Postgresa, dziś niezainstalowane. */
const EXTENSION_CANDIDATES = ["pg_trgm", "citext", "hstore", "vector"];

describe("lista FUNCTION_EXCEPTIONS: format (#193)", () => {
  const OK: FunctionException = {
    name: "public.f(uuid, text)",
    reason: "Funkcja pomocnicza polityki, bez SECURITY DEFINER.",
    acceptedBy: ["CTO", "CRCO"],
    pr: 1,
  };
  const noAccepted = Object.fromEntries(Object.entries(OK).filter(([k]) => k !== "acceptedBy")) as unknown as FunctionException;

  it("FUNCTION_EXCEPTIONS: pełna sygnatura, jednozdaniowe uzasadnienie, akceptacja CTO i CRCO, numer PR", () => {
    expect(exceptionFormatViolations(FUNCTION_EXCEPTIONS, SIGNATURE_NAME)).toEqual([]);
  });

  it.each([
    ["bez acceptedBy", noAccepted, /brak akceptacji roli CTO/],
    ["sama nazwa bez sygnatury", { ...OK, name: "f" }, /nazwa spoza formatu sygnatury/],
    ["sygnatura bez schematu", { ...OK, name: "f(uuid, text)" }, /nazwa spoza formatu sygnatury/],
    ["uzasadnienie z dwóch zdań", { ...OK, reason: "Pomocnicza polityki. Bez SECURITY DEFINER." }, /brak jednozdaniowego uzasadnienia/],
    ["bez numeru PR", { ...OK, pr: 0 }, /brak numeru PR dodającego wyjątek/],
  ] as Array<[string, FunctionException, RegExp]>)("pozycja %s → naruszenie formatu", (_n, e, re) => {
    expect(exceptionFormatViolations([e], SIGNATURE_NAME).join("\n")).toMatch(re);
  });

  it("pozycja kompletna → bez naruszeń formatu", () => {
    expect(exceptionFormatViolations([OK], SIGNATURE_NAME)).toEqual([]);
  });
});

/** Liczba ról logowania przed sondami (0 przed P6, 1 po P6) — po sondach ma być taka sama. */
const loginRoleCount = async (): Promise<number> =>
  (await h!.observer.unsafe(`SELECT 1 FROM pg_roles WHERE rolname = '${LOGIN_ROLE}'`)).length;

suite("funkcje i rozszerzenia w bazie (#193)", () => {
  let loginRolesBefore = -1;
  beforeAll(async () => {
    loginRolesBefore = await loginRoleCount();
  });
  afterAll(async () => {
    await h?.end();
  });

  it("warunek wstępny: rola myhelper_app istnieje, w public są funkcje rozszerzeń (wykluczenie z pg_depend nie jest puste)", async () => {
    expect(await h!.observer.unsafe(`SELECT 1 FROM pg_roles WHERE rolname = '${APP_ROLE}'`)).toHaveLength(1);
    const [row] = (await h!.observer.unsafe(`
      SELECT count(*)::int AS n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      JOIN pg_depend d ON d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e'
      WHERE n.nspname = 'public'`)) as Array<{ n: number }>;
    expect(row!.n).toBeGreaterThan(0);
  });

  describe("sonda kontrolna: baza po db:migrate", () => {
    it("(a) rozszerzenia równe liście", async () => {
      expect(await extensionViolations(h!.observer)).toEqual([]);
    });
    it("(b) brak funkcji własnych w public spoza listy", async () => {
      expect(await ownFunctionViolations(h!.observer)).toEqual([]);
    });
    it("(c) żadna funkcja SECURITY DEFINER nie jest wykonywalna przez role aplikacji", async () => {
      expect(await securityDefinerViolations(h!.observer)).toEqual([]);
    });
    it("(d) funkcje polityk obejmują wywołanie (current_setting) i operatory (= na uuid, NULLIF na text); wszystkie mają EXECUTE dla myhelper_app", async () => {
      const sigs = (await policyFunctions(h!.observer)).map((f) => f.sig);
      expect(sigs).toEqual(
        expect.arrayContaining([
          "pg_catalog.current_setting(text, boolean)",
          "pg_catalog.uuid_eq(uuid, uuid)",
          "pg_catalog.texteq(text, text)",
        ]),
      );
      expect(await policyFunctionViolations(h!.observer)).toEqual([]);
    });
  });

  describe("(a) rozszerzenia", () => {
    it("mutant: CREATE EXTENSION dostępnego rozszerzenia spoza listy → naruszenie; jego funkcje nie trafiają do (b)", async () => {
      const free = (await h!.observer.unsafe(`
        SELECT name FROM pg_available_extensions
        WHERE installed_version IS NULL AND name IN (${EXTENSION_CANDIDATES.map((x) => `'${x}'`).join(", ")})
        ORDER BY array_position(ARRAY[${EXTENSION_CANDIDATES.map((x) => `'${x}'`).join(", ")}], name::text)
        LIMIT 1`)) as Array<{ name: string }>;
      if (free.length === 0) {
        // Brak wolnego rozszerzenia w obrazie: mutant na wartości oczekiwanej.
        const v = await extensionViolations(h!.observer, [...EXPECTED_EXTENSIONS, "pg_trgm@public"]);
        expect(v).toEqual([`brak rozszerzenia z listy: pg_trgm@public — ${NEW_EXTENSION_MSG}`]);
        return;
      }
      const ext = free[0]!.name;
      const [v, own] = await inRolledBackTx([`CREATE EXTENSION ${ext} SCHEMA public`], async (tx) => [
        await extensionViolations(tx),
        await ownFunctionViolations(tx),
      ]);
      expect(v).toEqual([`rozszerzenie spoza listy: ${ext}@public — ${NEW_EXTENSION_MSG}`]);
      expect(own).toEqual([]);
    });

    it("mutant: dopisana nazwa w wartości oczekiwanej → naruszenie", async () => {
      const v = await extensionViolations(h!.observer, [...EXPECTED_EXTENSIONS, "pg_trgm@public"]);
      expect(v).toEqual([`brak rozszerzenia z listy: pg_trgm@public — ${NEW_EXTENSION_MSG}`]);
    });

    it("mutant: ta sama nazwa w innym schemacie → naruszenie w obie strony (porównanie pary)", async () => {
      const v = await extensionViolations(h!.observer, ["btree_gist@pg_catalog", "plpgsql@pg_catalog"]);
      expect(v).toEqual([
        `rozszerzenie spoza listy: btree_gist@public — ${NEW_EXTENSION_MSG}`,
        `brak rozszerzenia z listy: btree_gist@pg_catalog — ${NEW_EXTENSION_MSG}`,
      ]);
    });
  });

  describe("(b) funkcje własne w public", () => {
    const CREATE_PUBLIC = "CREATE FUNCTION public.it_probe_fn(uuid, text) RETURNS int LANGUAGE sql SECURITY INVOKER AS 'SELECT 1'";
    const SIGNATURE = "public.it_probe_fn(uuid, text)";

    it("mutant: CREATE FUNCTION public.x() SECURITY INVOKER → naruszenie (niezależnie od uprawnień)", async () => {
      expect(await inRolledBackTx([CREATE_PUBLIC], (tx) => ownFunctionViolations(tx))).toEqual([
        `${SIGNATURE}: funkcja w public spoza rozszerzeń i spoza FUNCTION_EXCEPTIONS`,
      ]);
    });

    it("mutant: CREATE PROCEDURE w public → naruszenie", async () => {
      const ddl = ["CREATE PROCEDURE public.it_probe_proc() LANGUAGE sql AS 'SELECT 1'"];
      expect(await inRolledBackTx(ddl, (tx) => ownFunctionViolations(tx))).toEqual([
        "public.it_probe_proc(): funkcja w public spoza rozszerzeń i spoza FUNCTION_EXCEPTIONS",
      ]);
    });

    it("pozycja listy z pełną sygnaturą zwalnia funkcję", async () => {
      const exc: FunctionException[] = [
        { name: SIGNATURE, reason: "Sonda testu, wycofywana razem z transakcją.", acceptedBy: ["CTO", "CRCO"], pr: 1 },
      ];
      expect(await inRolledBackTx([CREATE_PUBLIC], (tx) => ownFunctionViolations(tx, exc))).toEqual([]);
    });

    it("pozycja listy bez funkcji w bazie → naruszenie (lista nie trzyma martwych wpisów)", async () => {
      const exc: FunctionException[] = [
        { name: SIGNATURE, reason: "Sonda testu, wycofywana razem z transakcją.", acceptedBy: ["CTO", "CRCO"], pr: 1 },
      ];
      expect(await ownFunctionViolations(h!.observer, exc)).toEqual([`${SIGNATURE}: pozycja FUNCTION_EXCEPTIONS bez funkcji w bazie`]);
    });
  });

  describe("(c) SECURITY DEFINER", () => {
    it("mutant: funkcja SECURITY DEFINER w innym schemacie z EXECUTE dla PUBLIC → naruszenie", async () => {
      expect(noLogin(await inRolledBackTx(SECDEF_FN, securityDefinerViolations))).toEqual([`${PROBE_FN}: ${APP_ROLE} EXECUTE`]);
    });

    it("mutant: procedura SECURITY DEFINER (prokind p) z EXECUTE dla PUBLIC → naruszenie", async () => {
      const ddl = [`CREATE SCHEMA ${PROBE_SCHEMA}`, `CREATE PROCEDURE ${PROBE_SCHEMA}.pr() LANGUAGE sql SECURITY DEFINER AS 'SELECT 1'`];
      expect(noLogin(await inRolledBackTx(ddl, securityDefinerViolations))).toEqual([`${PROBE_SCHEMA}.pr(): ${APP_ROLE} EXECUTE`]);
    });

    it("mutant: odebrane EXECUTE dla PUBLIC, ale GRANT EXECUTE dla myhelper_app → naruszenie", async () => {
      const ddl = [...SECDEF_FN, REVOKE_PUBLIC, `GRANT EXECUTE ON FUNCTION ${PROBE_FN} TO ${APP_ROLE}`];
      expect(noLogin(await inRolledBackTx(ddl, securityDefinerViolations))).toEqual([`${PROBE_FN}: ${APP_ROLE} EXECUTE`]);
    });

    it("kontrola: odebrane EXECUTE dla PUBLIC i bez grantów dla ról aplikacji → bez naruszeń", async () => {
      expect(await inRolledBackTx([...SECDEF_FN, REVOKE_PUBLIC], securityDefinerViolations)).toEqual([]);
    });

    describe("funkcja dołączona do rozszerzenia ((c) bez wyjątku dla rozszerzeń)", () => {
      const EXT_FN = "public.it_ext_fn()";
      const CREATE_EXT_FN = `CREATE FUNCTION ${EXT_FN} RETURNS int LANGUAGE sql SECURITY DEFINER AS 'SELECT 1'`;
      const ADD_TO_EXT = `ALTER EXTENSION btree_gist ADD FUNCTION ${EXT_FN}`;

      it("mutant: SECURITY DEFINER z GRANT EXECUTE dla myhelper_app, dołączona do btree_gist → naruszenie wskazuje rozszerzenie", async () => {
        const ddl = [CREATE_EXT_FN, `GRANT EXECUTE ON FUNCTION ${EXT_FN} TO ${APP_ROLE}`, ADD_TO_EXT];
        expect(noLogin(await inRolledBackTx(ddl, securityDefinerViolations))).toEqual([
          `${EXT_FN}: ${APP_ROLE} EXECUTE (należy do rozszerzenia btree_gist)`,
        ]);
      });

      it("kontrola: ta sama funkcja w rozszerzeniu, REVOKE dla PUBLIC, bez grantów → (c) bez naruszeń, (b) jej nie zgłasza (pg_depend 'e')", async () => {
        const [secdef, own] = await inRolledBackTx([CREATE_EXT_FN, `REVOKE EXECUTE ON FUNCTION ${EXT_FN} FROM PUBLIC`, ADD_TO_EXT], async (tx) => [
          await securityDefinerViolations(tx),
          await ownFunctionViolations(tx),
        ]);
        expect(secdef).toEqual([]);
        expect(own).toEqual([]);
      });

      it("kontrast: ta sama funkcja bez dołączenia do rozszerzenia → (b) ją zgłasza", async () => {
        const own = await inRolledBackTx([CREATE_EXT_FN, `REVOKE EXECUTE ON FUNCTION ${EXT_FN} FROM PUBLIC`], (tx) => ownFunctionViolations(tx));
        expect(own).toEqual([`${EXT_FN}: funkcja w public spoza rozszerzeń i spoza FUNCTION_EXCEPTIONS`]);
      });
    });

    describe("rola logowania (sonda z rolą zakładaną w wycofywanej transakcji)", () => {
      /** Rola zakładana tylko, gdy jej nie ma (po P6 istnieje naprawdę). Brak CREATEROLE → błąd testu, nie obejście. */
      async function withLoginRole(extra: readonly string[]): Promise<string[]> {
        const exists = (await h!.observer.unsafe(`SELECT 1 FROM pg_roles WHERE rolname = '${LOGIN_ROLE}'`)).length > 0;
        const create = exists ? [] : [`CREATE ROLE ${LOGIN_ROLE} NOLOGIN IN ROLE ${APP_ROLE}`];
        return inRolledBackTx([...create, ...SECDEF_FN, REVOKE_PUBLIC, ...extra], securityDefinerViolations);
      }

      it("GRANT EXECUTE wyłącznie dla roli logowania → naruszenie wskazuje rolę logowania", async () => {
        expect(await withLoginRole([`GRANT EXECUTE ON FUNCTION ${PROBE_FN} TO ${LOGIN_ROLE}`])).toEqual([`${PROBE_FN}: ${LOGIN_ROLE} EXECUTE`]);
      });

      it("GRANT EXECUTE wyłącznie dla myhelper_app → naruszenie dla obu ról (członkostwo)", async () => {
        expect(await withLoginRole([`GRANT EXECUTE ON FUNCTION ${PROBE_FN} TO ${APP_ROLE}`])).toEqual([
          `${PROBE_FN}: ${APP_ROLE} EXECUTE`,
          `${PROBE_FN}: ${LOGIN_ROLE} EXECUTE`,
        ]);
      });

      it("kontrola: rola istnieje, funkcja bez grantów dla ról aplikacji → bez naruszeń", async () => {
        expect(await withLoginRole([])).toEqual([]);
      });
    });
  });

  describe("(d) W5: funkcje polityk", () => {
    it("mutant: REVOKE EXECUTE na current_setting(text, boolean) dla PUBLIC → naruszenie", async () => {
      const ddl = ["REVOKE EXECUTE ON FUNCTION pg_catalog.current_setting(text, boolean) FROM PUBLIC"];
      expect(await inRolledBackTx(ddl, policyFunctionViolations)).toEqual([
        `pg_catalog.current_setting(text, boolean): funkcja polityki bez EXECUTE dla ${APP_ROLE}`,
      ]);
    });
  });

  it("po wycofaniu sond: schematu, funkcji i roli sondy nie ma", async () => {
    expect(await h!.observer.unsafe(`SELECT 1 FROM pg_namespace WHERE nspname = '${PROBE_SCHEMA}'`)).toHaveLength(0);
    expect(await h!.observer.unsafe("SELECT 1 FROM pg_proc WHERE proname IN ('it_probe_fn', 'it_probe_proc', 'it_ext_fn')")).toHaveLength(0);
    expect(await securityDefinerViolations(h!.observer)).toEqual([]);
    expect(await policyFunctionViolations(h!.observer)).toEqual([]);
    expect(loginRolesBefore).toBeGreaterThanOrEqual(0);
    expect(await loginRoleCount()).toBe(loginRolesBefore);
  });
});
