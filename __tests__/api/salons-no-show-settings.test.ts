/**
 * GET/PUT /api/salons/[id]/no-show-settings — próg automatycznej blokady
 * rezerwacji online (`settingsJson.noShowAutoBlockThreshold`).
 *
 * Prawdziwa sesja → kontekst salonu → forSalon; mockowane krawędzie z
 * salon-staff-harness. Zapis sprawdzany po wyrenderowanym SQL (jsonb_set).
 */
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET, PUT } from "@/app/api/salons/[id]/no-show-settings/route";
import { SALON_A, SALON_B } from "./salon-staff-harness";
import type { SQL } from "drizzle-orm";

const h = await vi.hoisted(async () => {
  const m = (await import("./salon-staff-harness")).createSalonStaffMocks();
  const setArgs: Record<string, unknown>[] = [];
  const selectWheres: unknown[] = [];
  const state = { failDb: false, transactions: 0 };

  type Tx = Parameters<Parameters<typeof m.db.transaction>[0]>[0];
  type Chain = Record<string, (...args: unknown[]) => unknown>;
  const db = {
    transaction: (fn: (tx: Tx) => unknown) => {
      state.transactions += 1;
      if (state.failDb) return Promise.reject(new Error("connection refused"));
      return Promise.resolve(
        m.db.transaction((tx) =>
          fn({
            ...tx,
            select: () => {
              const chain = tx.select() as Chain;
              chain.where = (w: unknown) => {
                selectWheres.push(w);
                return chain;
              };
              return chain;
            },
            update: () => {
              const chain = tx.update() as Chain;
              chain.set = (v: unknown) => {
                setArgs.push(v as Record<string, unknown>);
                return chain;
              };
              return chain;
            },
          })
        )
      );
    },
  };

  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { m, setArgs, selectWheres, state, db, logger };
});

vi.mock("next/headers", () => ({ headers: vi.fn().mockResolvedValue(new Headers()) }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: h.m.getSession } } }));
vi.mock("@/lib/db", () => ({ db: h.db }));
vi.mock("@/lib/server/system/db-system", () => ({ dbSystem: h.m.dbSystem }));
vi.mock("@/lib/temporary-access", () => ({ hasTemporaryAccess: h.m.hasTemporaryAccess }));
vi.mock("@/lib/logger", () => ({ logger: h.logger }));

const { m } = h;
const dialect = new PgDialect();

function get(id: string = SALON_A) {
  return GET(new Request(`http://localhost/api/salons/${id}/no-show-settings`), { params: Promise.resolve({ id }) });
}

function put(body: string, id: string = SALON_A) {
  return PUT(
    new Request(`http://localhost/api/salons/${id}/no-show-settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body,
    }),
    { params: Promise.resolve({ id }) }
  );
}

beforeEach(() => {
  m.reset();
  h.setArgs.length = 0;
  h.selectWheres.length = 0;
  h.state.failDb = false;
  h.state.transactions = 0;
  vi.clearAllMocks();
  m.hasTemporaryAccess.mockResolvedValue(false);
});

describe("GET 200", () => {
  it.each([
    [2, 2],
    [null, null],
    [undefined, null],
    [7, null],
    ["2", null],
  ])("zapisane %j → odpowiedź %j", async (stored, expected) => {
    m.asOwnerOf(SALON_A);
    m.txRows.push([{ threshold: stored }]);

    const res = await get();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { noShowAutoBlockThreshold: expected } });
    const where = dialect.sqlToQuery(h.selectWheres[0] as SQL);
    expect(where.sql).toBe('"salons"."id" = $1');
    expect(where.params).toEqual([SALON_A]);
    expect(m.rlsSalonIds()).toEqual([SALON_A]);
  });
});

describe("PUT 200", () => {
  it.each([1, 2, 3, null])("próg %j → zapis jsonb_set tylko tego klucza", async (threshold) => {
    m.asOwnerOf(SALON_A);
    m.txRows.push([{ id: SALON_A }]);

    const res = await put(JSON.stringify({ noShowAutoBlockThreshold: threshold }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { noShowAutoBlockThreshold: threshold } });
    const written = dialect.sqlToQuery(h.setArgs[0]!.settingsJson as SQL);
    expect(written.sql).toMatch(/^jsonb_set\(coalesce\(("salons"\.)?"settings_json", '\{\}'::jsonb\), /);
    expect(written.sql).toContain(`'{noShowAutoBlockThreshold}', $1::jsonb)`);
    expect(written.params).toEqual([JSON.stringify(threshold)]);
    const [update] = m.writes.filter((w) => w.op === "update");
    expect(dialect.sqlToQuery(update!.where as SQL).params).toEqual([SALON_A]);
  });
});

describe("400", () => {
  it("zły UUID salonu → 400, bez transakcji", async () => {
    m.asOwnerOf(SALON_A);
    expect((await get("nie-uuid")).status).toBe(400);
    expect((await put("{}", "nie-uuid")).status).toBe(400);
    expect(h.state.transactions).toBe(0);
  });

  it.each([
    ["brak pola", "{}"],
    ["zero", JSON.stringify({ noShowAutoBlockThreshold: 0 })],
    ["cztery", JSON.stringify({ noShowAutoBlockThreshold: 4 })],
    ["ułamek", JSON.stringify({ noShowAutoBlockThreshold: 1.5 })],
    ["tekst", JSON.stringify({ noShowAutoBlockThreshold: "2" })],
    ["nieznane pole", JSON.stringify({ noShowAutoBlockThreshold: 2, extra: true })],
    ["niepoprawny JSON", "{"],
  ])("%s → 400, bez zapisu", async (_label, body) => {
    m.asOwnerOf(SALON_A);
    const res = await put(body);
    expect(res.status).toBe(400);
    expect(h.setArgs).toEqual([]);
  });
});

describe("401 / 403 / 404", () => {
  it("401 bez sesji", async () => {
    m.getSession.mockResolvedValue(null);
    expect((await get()).status).toBe(401);
    expect((await put("{}")).status).toBe(401);
  });

  it.each(["receptionist", "employee"] as const)("403 %s (GET i PUT)", async (role) => {
    m.asStaffOf(SALON_A, role);
    expect((await get()).status).toBe(403);
    m.asStaffOf(SALON_A, role);
    expect((await put(JSON.stringify({ noShowAutoBlockThreshold: 1 }))).status).toBe(403);
    expect(h.state.transactions).toBe(0);
  });

  it("403 właściciel innego salonu", async () => {
    m.asOwnerOf(SALON_B);
    expect((await put(JSON.stringify({ noShowAutoBlockThreshold: 1 }))).status).toBe(403);
    expect(h.state.transactions).toBe(0);
  });

  it("404 konto bez salonu", async () => {
    m.signIn("client-1");
    m.ctxRows.push([], []);
    expect((await get()).status).toBe(404);
  });

  it("404 salon nie istnieje przy odczycie i zapisie", async () => {
    m.asOwnerOf(SALON_A);
    m.txRows.push([]);
    expect((await get()).status).toBe(404);
    m.asOwnerOf(SALON_A);
    m.txRows.push([]);
    expect((await put(JSON.stringify({ noShowAutoBlockThreshold: 2 }))).status).toBe(404);
  });
});

describe("500", () => {
  it("błąd bazy → 500 (GET i PUT), log z samą tożsamością błędu", async () => {
    m.asOwnerOf(SALON_A);
    h.state.failDb = true;
    expect((await get()).status).toBe(500);
    m.asOwnerOf(SALON_A);
    expect((await put(JSON.stringify({ noShowAutoBlockThreshold: 2 }))).status).toBe(500);
    for (const [, meta] of h.logger.error.mock.calls) {
      expect(meta).toEqual({ salonId: SALON_A, errorName: "Error" });
    }
  });
});
