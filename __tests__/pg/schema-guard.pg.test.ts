/**
 * Strażnik schematu (`checkSchemaMigrations`, system/health.ts) na PRAWDZIWYM Postgresie.
 *
 * Sprawdza:
 *   - po `pnpm db:migrate` (krok CI przed testami pg) liczba wpisów
 *     `drizzle.__drizzle_migrations` równa się liczbie wpisów
 *     `drizzle/meta/_journal.json` → `ready: true`; zapytanie zwraca liczbę
 *     całkowitą (rzutowanie `count(*)::int`), nie napis;
 *   - pod rolą aplikacji bez prawa do schematu `drizzle` (`SET LOCAL ROLE
 *     myhelper_app`) wynik to `ready: false` z kodem z prawdziwego SQLSTATE
 *     (`42501` → MIGRATIONS_TABLE_DENIED); gdy rola ma prawo — `ready: true`.
 *
 * Test tylko czyta; drugi przypadek działa w transakcji wycofywanej na końcu.
 */
import fs from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";
import { checkSchemaMigrations } from "@/lib/server/system/health";

const h = await vi.hoisted(async () => (await import("./pg-harness")).createIntegrationDb());

// Pula podmieniana na transakcję w drugim przypadku (rola aplikacji).
const current = vi.hoisted(() => ({ executor: null as unknown }));

vi.mock("@/lib/db", () => ({
  get db() {
    if (!h) throw new Error("INTEGRATION_POSTGRES_URL not set");
    return h.db;
  },
}));
vi.mock("@/lib/server/system/db-system", () => ({
  get dbSystem() {
    if (!h) throw new Error("INTEGRATION_POSTGRES_URL not set");
    return current.executor ?? h.db;
  },
}));
vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const JOURNAL = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "../../drizzle/meta/_journal.json"), "utf8")
) as { entries: unknown[] };

class Rollback extends Error {}

const suite = h ? describe : describe.skip;

suite("checkSchemaMigrations — strażnik schematu, prawdziwy Postgres", () => {
  afterAll(async () => {
    current.executor = null;
    if (h) await h.end();
  });

  it("baza po migracjach CI: liczba migracji = liczba wpisów dziennika → ready", async () => {
    const [row] = Array.from(
      await h!.db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`)
    );
    expect(row?.n).toBe(JOURNAL.entries.length);

    await expect(checkSchemaMigrations()).resolves.toEqual({
      ready: true,
      applied: JOURNAL.entries.length,
      expected: JOURNAL.entries.length,
    });
  });

  it("rola aplikacji myhelper_app: wynik zgodny z jej prawem do dziennika migracji", async () => {
    const [priv] = Array.from(
      await h!.db.execute<{ can_use: boolean; can_select: boolean }>(sql`
        SELECT has_schema_privilege('myhelper_app', 'drizzle', 'USAGE') AS can_use,
               has_table_privilege('myhelper_app', 'drizzle.__drizzle_migrations', 'SELECT') AS can_select
      `)
    );
    let result: unknown;
    await expect(
      h!.db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL ROLE myhelper_app`);
        current.executor = tx;
        try {
          result = await checkSchemaMigrations();
        } finally {
          current.executor = null;
        }
        throw new Rollback();
      })
    ).rejects.toBeInstanceOf(Rollback);

    if (priv?.can_use && priv.can_select) {
      expect(result).toMatchObject({ ready: true, expected: JOURNAL.entries.length });
    } else {
      expect(result).toEqual({
        ready: false,
        reason: "MIGRATIONS_TABLE_DENIED",
        expected: JOURNAL.entries.length,
        sqlstate: "42501",
      });
    }
  });
});
