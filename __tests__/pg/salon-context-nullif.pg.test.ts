/**
 * #193: brak kontekstu salonu daje ten sam wynik niezależnie od historii połączenia.
 *
 * Po transakcji z `set_config('app.current_salon_id', …, true)` zmienna na tym połączeniu
 * wraca do '' (nie do NULL). Przed migracją 0010 `''::uuid` rzucał 22P02; po niej
 * `nullif(…, '')::uuid` = NULL, więc pod rolą aplikacji bez kontekstu:
 * - odczyt z tabeli z RLS → 0 wierszy (bez błędu),
 * - zapis → 42501 (WITH CHECK),
 * na świeżym połączeniu i na połączeniu po transakcji jak w forSalon.
 *
 * Jedno połączenie przez `reserve()`; polecenia po kolei (BEGIN … COMMIT/ROLLBACK). Zapisów
 * trwałych brak: transakcja forSalon tylko czyta, transakcje z zapisem kończą się ROLLBACK.
 *
 *   INTEGRATION_POSTGRES_URL=postgresql://…@localhost:5432/pos_dev pnpm exec vitest run --config vitest.pg.config.ts __tests__/pg/salon-context-nullif.pg.test.ts
 *
 * Wymaga bazy po `pnpm db:migrate` (z migracją 0010).
 */
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";

const h = await vi.hoisted(async () => (await import("./pg-harness")).createIntegrationDb());
const suite = h ? describe : describe.skip;

type Conn = { unsafe: (query: string) => PromiseLike<readonly unknown[]> };
type Reserved = Conn & { release: () => void };

/** Tabele z RLS po jednej z każdego rodzaju polityki: bezpośrednia, przez rodzica, korzeń. */
const READ_TABLES = ["clients", "time_blocks", "salons"] as const;
const SALON_A = randomUUID();

const codeOf = (e: unknown) => (e as { code?: unknown } | null)?.code;

/** Wynik polecenia albo kod błędu Postgresa (bez treści błędu). */
async function attempt(c: Conn, query: string): Promise<{ rows: readonly unknown[] } | { code: unknown }> {
  try {
    return { rows: await c.unsafe(query) };
  } catch (e) {
    return { code: codeOf(e) };
  }
}

/** Transakcja jak forSalon: rola aplikacji + kontekst salonu A (LOCAL), odczyt, zatwierdzenie. */
async function forSalonTx(c: Conn): Promise<void> {
  await c.unsafe("BEGIN");
  await c.unsafe("SET LOCAL ROLE myhelper_app");
  await c.unsafe(`SELECT set_config('app.current_salon_id', '${SALON_A}', true)`);
  await c.unsafe("SELECT count(*) FROM clients");
  await c.unsafe("COMMIT");
}

/** Pod rolą aplikacji BEZ kontekstu: liczba wierszy z każdej tabeli albo kod błędu; każda w swojej tx z ROLLBACK. */
async function readWithoutContext(c: Conn, ddl: readonly string[] = []): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const t of READ_TABLES) {
    await c.unsafe("BEGIN");
    for (const stmt of ddl) await c.unsafe(stmt);
    await c.unsafe("SET LOCAL ROLE myhelper_app");
    const r = await attempt(c, `SELECT count(*)::int AS n FROM ${t}`);
    out[t] = "rows" in r ? (r.rows[0] as { n: number }).n : r.code;
    await c.unsafe("ROLLBACK");
  }
  return out;
}

/** Pod rolą aplikacji BEZ kontekstu: INSERT do tabeli z RLS → kod błędu (oczekiwany 42501); ROLLBACK. */
async function insertWithoutContext(c: Conn): Promise<unknown> {
  await c.unsafe("BEGIN");
  await c.unsafe("SET LOCAL ROLE myhelper_app");
  const r = await attempt(c, `INSERT INTO service_categories (salon_id, name) VALUES ('${SALON_A}', 'it-nullif')`);
  await c.unsafe("ROLLBACK");
  return "rows" in r ? "zapis przeszedł" : r.code;
}

const currentSetting = async (c: Conn) =>
  ((await c.unsafe("SELECT current_setting('app.current_salon_id', true) AS v")) as Array<{ v: string | null }>)[0]!.v;

const ZERO = Object.fromEntries(READ_TABLES.map((t) => [t, 0]));

suite("brak kontekstu salonu: 0 wierszy i 42501 na każdym połączeniu (#193)", () => {
  afterAll(async () => {
    await h?.end();
  });

  it("połączenie po transakcji forSalon: zmienna = '' (warunek scenariusza), odczyt → 0 wierszy, zapis → 42501", async () => {
    const c = (await h!.observer.reserve()) as unknown as Reserved;
    try {
      await forSalonTx(c);
      expect(await currentSetting(c)).toBe("");
      expect(await readWithoutContext(c)).toEqual(ZERO);
      expect(await insertWithoutContext(c)).toBe("42501");
    } finally {
      c.release();
    }
  });

  it("świeże połączenie (nowa pula): zmienna nieustawiona, odczyt → 0 wierszy, zapis → 42501", async () => {
    const db = (await (await import("./pg-harness")).createIntegrationDb())!;
    try {
      const c = (await db.observer.reserve()) as unknown as Reserved;
      try {
        expect(await currentSetting(c)).toBeNull();
        expect(await readWithoutContext(c)).toEqual(ZERO);
        expect(await insertWithoutContext(c)).toBe("42501");
      } finally {
        c.release();
      }
    } finally {
      await db.end();
    }
  });

  it("sonda: polityka clients bez nullif (w transakcji) na połączeniu po forSalon → 22P02, czyli test rozróżnia", async () => {
    const c = (await h!.observer.reserve()) as unknown as Reserved;
    try {
      await forSalonTx(c);
      const bare = "current_setting('app.current_salon_id', true)::uuid";
      const r = await readWithoutContext(c, [
        "DROP POLICY tenant_isolation ON clients",
        `CREATE POLICY tenant_isolation ON clients USING (salon_id = ${bare}) WITH CHECK (salon_id = ${bare})`,
      ]);
      expect(r.clients).toBe("22P02");
    } finally {
      c.release();
    }
  });

  it("kontrola fałszywej zieleni: z kontekstem salonu odczyt przechodzi bez błędu (0 nie maskuje błędu)", async () => {
    const c = (await h!.observer.reserve()) as unknown as Reserved;
    try {
      await c.unsafe("BEGIN");
      await c.unsafe("SET LOCAL ROLE myhelper_app");
      await c.unsafe(`SELECT set_config('app.current_salon_id', '${SALON_A}', true)`);
      const r = await attempt(c, "SELECT count(*)::int AS n FROM clients");
      await c.unsafe("ROLLBACK");
      expect("rows" in r).toBe(true);
    } finally {
      c.release();
    }
  });
});
