/**
 * #193: rola aplikacji (`myhelper_app`) bez dostępu do tabel sesji, kont
 * i weryfikacji (migracja 0011).
 *
 * - `has_table_privilege` = false dla SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES,
 *   TRIGGER; `has_any_column_privilege` = false dla SELECT, INSERT, UPDATE, REFERENCES;
 * - pod `SET LOCAL ROLE myhelper_app` SELECT z `account` → 42501;
 * - mutanty w wycofywanej transakcji: grant tabelowy i grant kolumnowy → naruszenie.
 * Ta sama migracja zostawia roli aplikacji na `subscription_plans` wyłącznie SELECT:
 * INSERT pod rolą aplikacji → 42501; mutanty GRANT INSERT i GRANT UPDATE → naruszenie.
 * Funkcje `has_*_privilege` liczą wszystkie drogi (wprost, PUBLIC, członkostwo).
 *
 *   INTEGRATION_POSTGRES_URL=postgresql://…@localhost:5432/pos_dev pnpm exec vitest run --config vitest.pg.config.ts __tests__/pg/auth-tables-privileges.pg.test.ts
 *
 * Wymaga bazy po `pnpm db:migrate` (z migracją 0011). Test niczego trwale nie zmienia.
 */
import { afterAll, describe, expect, it, vi } from "vitest";

const h = await vi.hoisted(async () => (await import("./pg-harness")).createIntegrationDb());
const suite = h ? describe : describe.skip;

type QueryRunner = { unsafe: (query: string) => PromiseLike<readonly unknown[]> };

const AUTH_TABLES = ["session", "account", "verification"] as const;
const TABLE_PRIVS = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"];
const COLUMN_PRIVS = ["SELECT", "INSERT", "UPDATE", "REFERENCES"];
const lit = (xs: readonly string[]) => xs.map((x) => `'${x}'`).join(", ");

/** Uprawnienia myhelper_app do tabel auth: `tabela tabelowe PRAWO` / `tabela kolumnowe PRAWO`. */
async function authPrivileges(sql: QueryRunner): Promise<string[]> {
  const rows = (await sql.unsafe(`
    SELECT t || ' tabelowe ' || p AS v FROM unnest(ARRAY[${lit(AUTH_TABLES)}]) t
      CROSS JOIN unnest(ARRAY[${lit(TABLE_PRIVS)}]) p
      WHERE has_table_privilege('myhelper_app', 'public.' || t, p)
    UNION ALL
    SELECT t || ' kolumnowe ' || p FROM unnest(ARRAY[${lit(AUTH_TABLES)}]) t
      CROSS JOIN unnest(ARRAY[${lit(COLUMN_PRIVS)}]) p
      WHERE has_any_column_privilege('myhelper_app', 'public.' || t, p)
    ORDER BY 1`)) as Array<{ v: string }>;
  return rows.map((r) => r.v);
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

/** Jedno zamknięcie puli dla obu części (afterAll w pierwszym describe zamknąłby ją przed drugim). */
afterAll(async () => {
  await h?.end();
});

suite("tabele sesji, kont i weryfikacji bez dostępu roli aplikacji (#193)", () => {
  it("rola myhelper_app i trzy tabele istnieją (sprawdzenie nie przechodzi pusto)", async () => {
    const roles = await h!.observer.unsafe("SELECT 1 FROM pg_roles WHERE rolname = 'myhelper_app'");
    expect(roles).toHaveLength(1);
    const tables = (await h!.observer.unsafe(
      `SELECT relname::text AS t FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r' AND relname IN (${lit(AUTH_TABLES)}) ORDER BY 1`,
    )) as Array<{ t: string }>;
    expect(tables.map((r) => r.t)).toEqual(["account", "session", "verification"]);
  });

  it("baza po db:migrate: żadnego uprawnienia tabelowego (7) ani kolumnowego (4) myhelper_app", async () => {
    expect(await authPrivileges(h!.observer)).toEqual([]);
  });

  it("SELECT z account pod SET LOCAL ROLE myhelper_app → 42501", async () => {
    const code = await inRolledBackTx(["SET LOCAL ROLE myhelper_app"], async (tx) => {
      try {
        await tx.unsafe("SELECT 1 FROM account LIMIT 1");
        return "odczyt przeszedł";
      } catch (e) {
        return (e as { code?: unknown }).code;
      }
    });
    expect(code).toBe("42501");
  });

  it.each([
    ["GRANT SELECT ON account TO myhelper_app", ["account kolumnowe SELECT", "account tabelowe SELECT"]],
    ["GRANT SELECT (password) ON account TO myhelper_app", ["account kolumnowe SELECT"]],
    ["GRANT TRUNCATE ON session TO PUBLIC", ["session tabelowe TRUNCATE"]],
  ])("mutant (w transakcji): %s → naruszenie", async (grant, expected) => {
    expect(await inRolledBackTx([grant], authPrivileges)).toEqual(expected);
  });

  it("tabela user poza zakresem tego PR: uprawnienia jak po 0005 (zmiana w #193 P6)", async () => {
    const rows = (await h!.observer.unsafe(
      `SELECT p FROM unnest(ARRAY[${lit(TABLE_PRIVS)}]) p WHERE has_table_privilege('myhelper_app', 'public."user"', p) ORDER BY 1`,
    )) as Array<{ p: string }>;
    expect(rows.map((r) => r.p)).toEqual(["DELETE", "INSERT", "SELECT", "UPDATE"]);
  });

  it("po wycofaniu mutantów uprawnień nadal brak", async () => {
    expect(await authPrivileges(h!.observer)).toEqual([]);
  });
});

/** Uprawnienia myhelper_app do subscription_plans: `tabelowe PRAWO` / `kolumnowe PRAWO`. */
async function plansPrivileges(sql: QueryRunner): Promise<string[]> {
  const rows = (await sql.unsafe(`
    SELECT 'tabelowe ' || p AS v FROM unnest(ARRAY[${lit(TABLE_PRIVS)}]) p
      WHERE has_table_privilege('myhelper_app', 'public.subscription_plans', p)
    UNION ALL
    SELECT 'kolumnowe ' || p FROM unnest(ARRAY['INSERT', 'UPDATE', 'REFERENCES']) p
      WHERE has_any_column_privilege('myhelper_app', 'public.subscription_plans', p)
    ORDER BY 1`)) as Array<{ v: string }>;
  return rows.map((r) => r.v);
}

suite("subscription_plans: rola aplikacji wyłącznie z SELECT (#193)", () => {
  it("baza po db:migrate: SELECT tak; INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER i kolumnowe INSERT, UPDATE, REFERENCES nie", async () => {
    expect(await plansPrivileges(h!.observer)).toEqual(["tabelowe SELECT"]);
  });

  it("INSERT pod SET LOCAL ROLE myhelper_app → 42501", async () => {
    const code = await inRolledBackTx(["SET LOCAL ROLE myhelper_app"], async (tx) => {
      try {
        await tx.unsafe("INSERT INTO subscription_plans (name, slug, price_monthly) VALUES ('it', 'it-plans-probe', 0)");
        return "zapis przeszedł";
      } catch (e) {
        return (e as { code?: unknown }).code;
      }
    });
    expect(code).toBe("42501");
  });

  it.each([
    ["GRANT INSERT ON subscription_plans TO myhelper_app", ["kolumnowe INSERT", "tabelowe INSERT", "tabelowe SELECT"]],
    ["GRANT UPDATE ON subscription_plans TO myhelper_app", ["kolumnowe UPDATE", "tabelowe SELECT", "tabelowe UPDATE"]],
  ])("mutant (w transakcji): %s → naruszenie", async (grant, expected) => {
    expect(await inRolledBackTx([grant], plansPrivileges)).toEqual(expected);
  });

  it("po wycofaniu mutantów nadal wyłącznie SELECT", async () => {
    expect(await plansPrivileges(h!.observer)).toEqual(["tabelowe SELECT"]);
  });
});
