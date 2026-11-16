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
 *   INTEGRATION_POSTGRES_URL=postgresql://…@localhost:5432/pos_dev pnpm test:pg -- __tests__/pg/views-privileges.pg.test.ts
 *
 * Wymaga bazy po `pnpm db:migrate` (rola `myhelper_app` z migracji 0005).
 */
import { afterAll, describe, expect, it, vi } from "vitest";

const h = await vi.hoisted(async () => (await import("./pg-harness")).createIntegrationDb());
const suite = h ? describe : describe.skip;

/** Role, których dotyczy zasada; rola logowania — tylko gdy istnieje. */
const APP_ROLES = ["myhelper_app", "myhelper_app_login"];
const WRITE_PRIVS = ["INSERT", "UPDATE", "DELETE", "TRUNCATE"];

type Sql = NonNullable<typeof h>["observer"];
type Tx = Parameters<Parameters<Sql["begin"]>[0]>[0];

/** Istniejące role z APP_ROLES. */
async function appRoles(sql: Sql | Tx): Promise<string[]> {
  const rows = await sql<{ rolname: string }[]>`
    SELECT rolname FROM pg_roles WHERE rolname = ANY(${APP_ROLES}) ORDER BY rolname`;
  return rows.map((r) => r.rolname);
}

/**
 * Naruszenia zasady „widoki w public: tylko SELECT”: `widok (v|m): rola PRAWO`.
 * Pusta lista = zasada spełniona.
 */
async function viewWriteGrants(sql: Sql | Tx): Promise<string[]> {
  const rows = await sql<{ relname: string; relkind: string; rolname: string; priv: string }[]>`
    SELECT c.relname, c.relkind::text AS relkind, r.rolname, p.priv
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN (SELECT rolname FROM pg_roles WHERE rolname = ANY(${APP_ROLES})) r
    CROSS JOIN unnest(${WRITE_PRIVS}::text[]) AS p(priv)
    WHERE n.nspname = 'public'
      AND c.relkind IN ('v', 'm')
      AND has_table_privilege(r.rolname, c.oid, p.priv)
    ORDER BY c.relname, r.rolname, p.priv`;
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

  it.each([
    ["widok z GRANT INSERT dla myhelper_app", `CREATE VIEW public.${PROBE} AS SELECT 1 AS x; GRANT INSERT ON public.${PROBE} TO myhelper_app`, `${PROBE} (v): myhelper_app INSERT`],
    ["widok z GRANT UPDATE dla PUBLIC (droga pośrednia)", `CREATE VIEW public.${PROBE} AS SELECT 1 AS x; GRANT UPDATE ON public.${PROBE} TO PUBLIC`, `${PROBE} (v): myhelper_app UPDATE`],
    ["widok zmaterializowany z GRANT TRUNCATE", `CREATE MATERIALIZED VIEW public.${PROBE} AS SELECT 1 AS x; GRANT TRUNCATE ON public.${PROBE} TO myhelper_app`, `${PROBE} (m): myhelper_app TRUNCATE`],
  ])("sonda w transakcji: %s → naruszenie nazwane", async (_n, ddl, expected) => {
    expect(await inRolledBackTx(ddl)).toContain(expected);
  });

  it("widok z samym GRANT SELECT (w transakcji) → bez naruszeń", async () => {
    expect(await inRolledBackTx(`CREATE VIEW public.${PROBE} AS SELECT 1 AS x; GRANT SELECT ON public.${PROBE} TO myhelper_app`)).toEqual([]);
  });

  it("po wycofaniu sondy widoku nie ma (test nie zostawia śladu)", async () => {
    const rows = await h!.observer`SELECT 1 FROM pg_class WHERE relname = ${PROBE}`;
    expect(rows).toHaveLength(0);
  });
});
