/**
 * #221: źródło wpisu na liście oczekujących i potwierdzenie prośby klienta — ograniczenia w bazie.
 *
 * - `waiting_list_source_valid`: `source` ∈ {client_portal, staff, legacy}; domyślnie `legacy`;
 * - `waiting_list_client_request_confirmed`: każde źródło poza `legacy` wymaga
 *   `client_request_confirmed_at`;
 * - `created_by_user_id`: klucz obcy do `user.id` z ON DELETE SET NULL; żadne ograniczenie
 *   nie zależy od tej kolumny.
 * Klucz obcy sprawdzany pod `SET LOCAL ROLE myhelper_app` z odebranymi w transakcji uprawnieniami
 * roli aplikacji do tabeli `user`: sprawdzenie klucza obcego nie wymaga dostępu do tej tabeli.
 *
 * Dane: jedna transakcja na jednym połączeniu, rolą migracji; każdy przypadek w SAVEPOINT /
 * ROLLBACK TO; transakcja wycofana w ostatnim teście. Nic nie jest zatwierdzane.
 *
 *   INTEGRATION_POSTGRES_URL=postgresql://…@localhost:5432/pos_dev pnpm exec vitest run --config vitest.pg.config.ts __tests__/pg/waiting-list-source.pg.test.ts
 *
 * Wymaga bazy po `pnpm db:migrate`; seed niepotrzebny.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi, describe } from "vitest";
import { APP_ROLE, SALON_CONTEXT_VAR } from "../../scripts/db-rls-guard";

const h = await vi.hoisted(async () => (await import("./pg-harness")).createIntegrationDb());
const suite = h ? describe : describe.skip;

type Conn = { unsafe: (query: string, params?: unknown[]) => PromiseLike<readonly unknown[]> };
type Reserved = Conn & { release: () => void };

const PREFIX = "it-t3-wl";
const CONFIRMED = "2030-01-07T10:00:00";
const TABLE_PRIVS = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"];
const COLUMN_PRIVS = ["SELECT", "INSERT", "UPDATE", "REFERENCES"];
const lit = (xs: readonly string[]) => xs.map((x) => `'${x}'`).join(", ");

/** Uprawnienia roli aplikacji do `user`: `tabelowe PRAWO` / `kolumnowe PRAWO`. */
async function userPrivileges(sql: { unsafe: (query: string) => PromiseLike<readonly unknown[]> }): Promise<string[]> {
  const rows = (await sql.unsafe(`
    SELECT 'tabelowe ' || p AS v FROM unnest(ARRAY[${lit(TABLE_PRIVS)}]) p
      WHERE has_table_privilege('${APP_ROLE}', 'public."user"', p)
    UNION ALL
    SELECT 'kolumnowe ' || p FROM unnest(ARRAY[${lit(COLUMN_PRIVS)}]) p
      WHERE has_any_column_privilege('${APP_ROLE}', 'public."user"', p)
    ORDER BY 1`)) as Array<{ v: string }>;
  return rows.map((r) => r.v);
}

type Entry = {
  source?: string;
  confirmedAt?: string | null;
  createdBy?: string | null;
};

type Outcome = { id: string; source: string; createdBy: string | null } | { code: unknown; constraint: unknown };

suite("lista oczekujących: źródło wpisu i potwierdzenie prośby klienta (#221)", () => {
  const SALON = randomUUID();
  let c: Reserved | null = null;
  let clientId = "";

  const conn = (): Reserved => {
    if (!c) throw new Error("brak połączenia transakcji testu");
    return c;
  };

  const newUser = async (): Promise<string> => {
    const id = `${PREFIX}-${randomUUID()}`;
    await conn().unsafe(`INSERT INTO "user" (id, name, email) VALUES ($1, 'IT T3 WL', $2)`, [id, `${id}@example.invalid`]);
    return id;
  };

  /** INSERT wpisu salonu testu; `source` pominięte w obiekcie = kolumna pominięta w INSERT. */
  const insertEntry = async (e: Entry): Promise<Outcome> => {
    const cols = ["salon_id", "client_id", "client_request_confirmed_at", "created_by_user_id"];
    const vals = ["$1::uuid", "$2::uuid", "$3::timestamp", "$4"];
    const params: unknown[] = [SALON, clientId, e.confirmedAt ?? null, e.createdBy ?? null];
    if (e.source !== undefined) {
      cols.push("source");
      vals.push("$5");
      params.push(e.source);
    }
    try {
      const rows = (await conn().unsafe(
        `INSERT INTO waiting_list (${cols.join(", ")}) VALUES (${vals.join(", ")})
         RETURNING id::text AS id, source, created_by_user_id AS "createdBy"`,
        params,
      )) as Array<{ id: string; source: string; createdBy: string | null }>;
      return rows[0]!;
    } catch (err) {
      const x = err as { code?: unknown; constraint_name?: unknown } | null;
      return { code: x?.code, constraint: x?.constraint_name };
    }
  };

  /** Przypadek w SAVEPOINT; efekty zawsze wycofane, rola i kontekst salonu też. */
  const step = async <T>(fn: () => Promise<T>): Promise<T> => {
    await conn().unsafe("SAVEPOINT wl_step");
    try {
      return await fn();
    } finally {
      await conn().unsafe("ROLLBACK TO SAVEPOINT wl_step");
    }
  };

  /** Odbiera roli aplikacji uprawnienia do `user` (w transakcji) i przechodzi na nią z kontekstem salonu testu. */
  const asAppWithoutUserPrivileges = async (): Promise<string[]> => {
    await conn().unsafe(`REVOKE ALL ON "user" FROM ${APP_ROLE}`);
    const left = await userPrivileges(conn());
    await conn().unsafe(`SET LOCAL ROLE ${APP_ROLE}`);
    await conn().unsafe(`SELECT set_config('${SALON_CONTEXT_VAR}', $1, true)`, [SALON]);
    return left;
  };

  let privilegesBefore: string[] = [];

  beforeAll(async () => {
    privilegesBefore = await userPrivileges(h!.observer);
    c = (await h!.observer.reserve()) as unknown as Reserved;
    await c.unsafe("BEGIN");
    const owner = await newUser();
    await c.unsafe(`INSERT INTO salons (id, name, owner_id) VALUES ($1::uuid, 'IT T3 WL', $2)`, [SALON, owner]);
    const [client] = (await c.unsafe(
      `INSERT INTO clients (salon_id, first_name, last_name) VALUES ($1::uuid, 'IT', 'WL') RETURNING id::text AS id`,
      [SALON],
    )) as Array<{ id: string }>;
    clientId = client!.id;
  });

  afterAll(async () => {
    if (c) {
      await c.unsafe("ROLLBACK");
      c.release();
      c = null;
    }
    await h?.end();
  });

  it("w bazie: oba CHECK, klucz obcy z ON DELETE SET NULL i indeks na created_by_user_id", async () => {
    const constraints = (await conn().unsafe(
      `SELECT conname::text AS name, contype::text AS type, confdeltype::text AS "onDelete"
       FROM pg_constraint WHERE conrelid = 'public.waiting_list'::regclass
         AND conname IN ('waiting_list_source_valid', 'waiting_list_client_request_confirmed',
                         'waiting_list_created_by_user_id_user_id_fk')
       ORDER BY 1`,
    )) as Array<{ name: string; type: string; onDelete: string }>;
    expect(constraints).toEqual([
      { name: "waiting_list_client_request_confirmed", type: "c", onDelete: " " },
      { name: "waiting_list_created_by_user_id_user_id_fk", type: "f", onDelete: "n" },
      { name: "waiting_list_source_valid", type: "c", onDelete: " " },
    ]);
    const idx = await conn().unsafe(
      `SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'waiting_list'
         AND indexname = 'waiting_list_created_by_user_id_idx'`,
    );
    expect(idx).toHaveLength(1);
  });

  it.each(["staff", "client_portal"])("%s bez potwierdzenia → 23514", async (source) => {
    expect(await step(() => insertEntry({ source }))).toEqual({
      code: "23514",
      constraint: "waiting_list_client_request_confirmed",
    });
  });

  it("legacy bez potwierdzenia → wstawienie przechodzi", async () => {
    const r = await step(() => insertEntry({ source: "legacy" }));
    expect(r).toMatchObject({ source: "legacy", createdBy: null });
  });

  it("bez podania source → wiersz ma legacy", async () => {
    const r = await step(() => insertEntry({}));
    expect(r).toMatchObject({ source: "legacy" });
  });

  it("wartość spoza listy (z potwierdzeniem) → 23514", async () => {
    expect(await step(() => insertEntry({ source: "import", confirmedAt: CONFIRMED }))).toEqual({
      code: "23514",
      constraint: "waiting_list_source_valid",
    });
  });

  it.each(["staff", "client_portal"])("%s z potwierdzeniem i created_by_user_id = NULL → przechodzi", async (source) => {
    const r = await step(() => insertEntry({ source, confirmedAt: CONFIRMED, createdBy: null }));
    expect(r).toMatchObject({ source, createdBy: null });
  });

  it("rola aplikacji bez uprawnień do user: istniejące id konta → wstawienie przechodzi", async () => {
    const result = await step(async () => {
      const author = await newUser();
      const left = await asAppWithoutUserPrivileges();
      return { left, row: await insertEntry({ source: "staff", confirmedAt: CONFIRMED, createdBy: author }), author };
    });
    expect(result.left).toEqual([]);
    expect(result.row).toMatchObject({ source: "staff", createdBy: result.author });
  });

  it("rola aplikacji bez uprawnień do user: nieistniejące id konta → 23503", async () => {
    const result = await step(async () => {
      const left = await asAppWithoutUserPrivileges();
      return { left, row: await insertEntry({ source: "staff", confirmedAt: CONFIRMED, createdBy: `${PREFIX}-${randomUUID()}` }) };
    });
    expect(result.left).toEqual([]);
    expect(result.row).toEqual({ code: "23503", constraint: "waiting_list_created_by_user_id_user_id_fk" });
  });

  it("usunięcie konta autora (rolą migracji) → wpis zostaje, created_by_user_id = NULL", async () => {
    const result = await step(async () => {
      const author = await newUser();
      const left = await asAppWithoutUserPrivileges();
      const row = await insertEntry({ source: "staff", confirmedAt: CONFIRMED, createdBy: author });
      await conn().unsafe("SET LOCAL ROLE NONE");
      const deleted = await conn().unsafe(`DELETE FROM "user" WHERE id = $1 RETURNING 1`, [author]);
      const after = "id" in row
        ? ((await conn().unsafe(
            `SELECT source, created_by_user_id AS "createdBy" FROM waiting_list WHERE id = $1::uuid`,
            [row.id],
          )) as Array<{ source: string; createdBy: string | null }>)
        : [];
      return { left, row, author, deleted: deleted.length, after };
    });
    expect(result.left).toEqual([]);
    expect(result.row).toMatchObject({ createdBy: result.author });
    expect(result.deleted).toBe(1);
    expect(result.after).toEqual([{ source: "staff", createdBy: null }]);
  });

  it("po wycofaniu transakcji: wierszy testu nie ma, uprawnienia roli aplikacji do user bez zmian", async () => {
    await conn().unsafe("ROLLBACK");
    conn().release();
    c = null;
    const [left] = (await h!.observer.unsafe(
      `SELECT (SELECT count(*)::int FROM salons WHERE id = '${SALON}'::uuid)
            + (SELECT count(*)::int FROM "user" WHERE id LIKE '${PREFIX}-%') AS n`,
    )) as Array<{ n: number }>;
    expect(left!.n).toBe(0);
    expect(await userPrivileges(h!.observer)).toEqual(privilegesBefore);
  });
});
