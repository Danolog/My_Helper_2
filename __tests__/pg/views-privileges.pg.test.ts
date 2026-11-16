/**
 * #193 P0c-1 (pkt 5): widoki w `public` — dla ról aplikacji wyłącznie SELECT.
 *
 * Widok (także zmaterializowany) omija RLS tabel bazowych, jeśli działa z prawami właściciela,
 * więc rola żądań (`myhelper_app`) i rola logowania (`myhelper_app_login`, jeśli istnieje)
 * nie mogą mieć na nim INSERT/UPDATE/DELETE/TRUNCATE — ani wprost, ani przez PUBLIC
 * albo członkostwo w roli (`has_table_privilege` liczy wszystkie drogi).
 *
 * Test tylko CZYTA katalog. Sonda (widok z grantem) powstaje w transakcji, która jest
 * wycofywana — test niczego trwale nie zmienia i nie uruchamia `db:*` ani seeda.
 *
 * Sam ten plik (`pnpm test:pg -- <plik>` nie zawęża przebiegu — biegną wszystkie testy pg):
 *
 *   INTEGRATION_POSTGRES_URL=postgresql://…@localhost:5432/pos_dev pnpm exec vitest run --config vitest.pg.config.ts __tests__/pg/views-privileges.pg.test.ts
 *
 * Wymaga bazy po `pnpm db:migrate` (rola `myhelper_app` z migracji 0005).
 */
import { afterAll, describe, expect, it, vi } from "vitest";

const h = await vi.hoisted(async () => (await import("./pg-harness")).createIntegrationDb());
const suite = h ? describe : describe.skip;

/** Role, których dotyczy zasada; rola logowania — tylko gdy istnieje. */
const APP_ROLES = ["myhelper_app", "myhelper_app_login"];
const WRITE_PRIVS = ["INSERT", "UPDATE", "DELETE", "TRUNCATE"];

/** Klient albo transakcja postgres.js — wystarczy `unsafe` (wzór z `scripts/db-rls-guard.ts`). */
type QueryRunner = { unsafe: (query: string) => PromiseLike<readonly unknown[]> };

/** Stałe testu jako lista literałów SQL; tylko identyfikatory/słowa ze znaków [a-z_A-Z] (bez danych z zewnątrz). */
const sqlList = (xs: readonly string[]) =>
  xs
    .map((x) => {
      if (!/^[A-Za-z_]+$/.test(x)) throw new Error(`nieoczekiwana stała SQL: ${x}`);
      return `'${x}'`;
    })
    .join(", ");

/** Istniejące role z APP_ROLES. */
async function appRoles(sql: QueryRunner): Promise<string[]> {
  const rows = (await sql.unsafe(`SELECT rolname FROM pg_roles WHERE rolname IN (${sqlList(APP_ROLES)}) ORDER BY rolname`)) as Array<{
    rolname: string;
  }>;
  return rows.map((r) => r.rolname);
}

/**
 * Naruszenia zasady „widoki w public: tylko SELECT”: `widok (v|m): rola PRAWO`.
 * Pusta lista = zasada spełniona.
 */
async function viewWriteGrants(sql: QueryRunner): Promise<string[]> {
  const rows = (await sql.unsafe(`
    SELECT c.relname::text AS relname, c.relkind::text AS relkind, r.rolname::text AS rolname, p.priv
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN (SELECT rolname FROM pg_roles WHERE rolname IN (${sqlList(APP_ROLES)})) r
    CROSS JOIN unnest(ARRAY[${sqlList(WRITE_PRIVS)}]::text[]) AS p(priv)
    WHERE n.nspname = 'public'
      AND c.relkind IN ('v', 'm')
      AND has_table_privilege(r.rolname, c.oid, p.priv)
    ORDER BY c.relname, r.rolname, p.priv`)) as Array<{ relname: string; relkind: string; rolname: string; priv: string }>;
  return rows.map((x) => `${x.relname} (${x.relkind}): ${x.rolname} ${x.priv}`);
}

class Rollback extends Error {}

/** DDL sondy w transakcji, odczyt naruszeń w tej samej transakcji, potem wycofanie. */
async function inRolledBackTx(ddl: string): Promise<string[]> {
  let result: string[] | undefined;
  await h!.observer
    .begin(async (tx) => {
      // Po jednym poleceniu (protokół rozszerzony nie przyjmuje kilku naraz).
      for (const stmt of ddl.split(";").map((s) => s.trim()).filter(Boolean)) await tx.unsafe(stmt);
      result = await viewWriteGrants(tx);
      throw new Rollback();
    })
    .catch((e: unknown) => {
      if (!(e instanceof Rollback)) throw e;
    });
  if (!result) throw new Error("sonda nie zwróciła wyniku");
  return result;
}

const PROBE = "p0c1_view_probe";

suite("widoki w public: tylko SELECT dla ról aplikacji (#193 P0c-1)", () => {
  afterAll(async () => {
    await h?.end();
  });

  it("rola myhelper_app istnieje (zasada nie przechodzi pusto przez literówkę w nazwie roli)", async () => {
    expect(await appRoles(h!.observer)).toContain("myhelper_app");
  });

  it("baza po db:migrate: żaden widok ani widok zmaterializowany w public nie daje rolom aplikacji INSERT/UPDATE/DELETE/TRUNCATE", async () => {
    expect(await viewWriteGrants(h!.observer)).toEqual([]);
  });

  // Sondy uwzględniają domyślne uprawnienia schematu: nowy widok może dostać prawa z automatu,
  // więc sondy z jawnym grantem i sonda kontrolna zaczynają od REVOKE ALL (decyzja Ethana 16.11).
  const VIEW = `CREATE VIEW public.${PROBE} AS SELECT 1 AS x`;
  const MVIEW = `CREATE MATERIALIZED VIEW public.${PROBE} AS SELECT 1 AS x`;
  const REVOKE = `REVOKE ALL ON public.${PROBE} FROM myhelper_app, PUBLIC`;
  /** Naruszenia tylko dla myhelper_app (rola logowania dochodzi w P6). */
  const forApp = (v: string[]) => v.filter((x) => x.includes(": myhelper_app "));

  it("sonda w transakcji: goły CREATE VIEW bez grantów → naruszenia INSERT/UPDATE/DELETE (domyślne uprawnienia schematu)", async () => {
    expect(forApp(await inRolledBackTx(VIEW))).toEqual([
      `${PROBE} (v): myhelper_app DELETE`,
      `${PROBE} (v): myhelper_app INSERT`,
      `${PROBE} (v): myhelper_app UPDATE`,
    ]);
  });

  it.each([
    ["REVOKE ALL, potem GRANT INSERT dla myhelper_app", `${VIEW}; ${REVOKE}; GRANT INSERT ON public.${PROBE} TO myhelper_app`, [`${PROBE} (v): myhelper_app INSERT`]],
    ["REVOKE ALL, potem GRANT UPDATE dla PUBLIC (droga pośrednia)", `${VIEW}; ${REVOKE}; GRANT UPDATE ON public.${PROBE} TO PUBLIC`, [`${PROBE} (v): myhelper_app UPDATE`]],
    ["widok zmaterializowany: REVOKE ALL, potem GRANT TRUNCATE", `${MVIEW}; ${REVOKE}; GRANT TRUNCATE ON public.${PROBE} TO myhelper_app`, [`${PROBE} (m): myhelper_app TRUNCATE`]],
  ])("sonda w transakcji: %s → dokładnie jawne naruszenie", async (_n, ddl, expected) => {
    expect(forApp(await inRolledBackTx(ddl))).toEqual(expected);
  });

  it("sonda kontrolna w transakcji: CREATE VIEW, REVOKE ALL, GRANT SELECT → bez naruszeń", async () => {
    expect(await inRolledBackTx(`${VIEW}; ${REVOKE}; GRANT SELECT ON public.${PROBE} TO myhelper_app`)).toEqual([]);
  });

  it("po wycofaniu sondy widoku nie ma (test nie zostawia śladu)", async () => {
    const rows = await h!.observer`SELECT 1 FROM pg_class WHERE relname = ${PROBE}`;
    expect(rows).toHaveLength(0);
  });
});
