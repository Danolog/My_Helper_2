/**
 * POST/DELETE /api/clients/[id]/block — ręczna blokada rezerwacji online.
 *
 * Prawdziwa sesja → kontekst salonu → forSalon; mockowane krawędzie z
 * salon-staff-harness. Warunki `where` renderowane dialektem Postgresa.
 *
 * Kolejność txRows w transakcji: [UPDATE … RETURNING], a gdy pusty — [odczyt karty].
 */
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DELETE, POST } from "@/app/api/clients/[id]/block/route";
import { SALON_A } from "./salon-staff-harness";
import type { SQL } from "drizzle-orm";

const h = await vi.hoisted(async () => {
  const m = (await import("./salon-staff-harness")).createSalonStaffMocks();
  const setArgs: Record<string, unknown>[] = [];
  const selectWheres: unknown[] = [];
  const state = { failDb: false, failWith: null as unknown, transactions: 0 };

  type Tx = Parameters<Parameters<typeof m.db.transaction>[0]>[0];
  type Chain = Record<string, (...args: unknown[]) => unknown>;
  const db = {
    transaction: (fn: (tx: Tx) => unknown) => {
      state.transactions += 1;
      if (state.failDb) return Promise.reject(new Error("connection refused params: Anna,+48500600700"));
      if (state.failWith) return Promise.reject(state.failWith);
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
const CLIENT_ID = "33333333-3333-4333-8333-333333333333";
const NOW = new Date("2026-11-27T12:00:00.000Z");
const EARLIER = new Date("2026-11-20T09:00:00.000Z");

function call(handler: typeof POST, opts: { id?: string; body?: string } = {}) {
  const id = opts.id ?? CLIENT_ID;
  const init: RequestInit = { method: handler === POST ? "POST" : "DELETE" };
  if (opts.body !== undefined) {
    init.body = opts.body;
    init.headers = { "Content-Type": "application/json" };
  }
  return handler(new Request(`http://localhost/api/clients/${id}/block`, init), {
    params: Promise.resolve({ id }),
  });
}

function updateWhere() {
  const [update] = m.writes.filter((w) => w.op === "update");
  return dialect.sqlToQuery(update!.where as SQL);
}

beforeEach(() => {
  m.reset();
  h.setArgs.length = 0;
  h.selectWheres.length = 0;
  h.state.failDb = false;
  h.state.failWith = null;
  h.state.transactions = 0;
  vi.clearAllMocks();
  m.hasTemporaryAccess.mockResolvedValue(false);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("200: blokada", () => {
  it("właściciel z notatką → blokada z autorem z sesji, notatka przycięta", async () => {
    m.asOwnerOf(SALON_A, "owner-a");
    m.txRows.push([{ blockedAt: NOW, blockedBy: "owner-a", blockNote: "Trzy razy bez odwołania" }]);

    const res = await call(POST, { body: JSON.stringify({ note: "  Trzy razy bez odwołania  " }) });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      data: {
        clientId: CLIENT_ID,
        blocked: true,
        blockedAt: NOW.toISOString(),
        blockedBy: "owner-a",
        automatic: false,
        note: "Trzy razy bez odwołania",
        changed: true,
      },
    });
    expect(h.setArgs).toEqual([
      { blockedAt: NOW, blockedBy: "owner-a", blockNote: "Trzy razy bez odwołania", updatedAt: NOW },
    ]);
    expect(m.rlsSalonIds()).toEqual([SALON_A]);
  });

  it("UPDATE zawężony do karty salonu z sesji i bez istniejącej blokady", async () => {
    m.asOwnerOf(SALON_A);
    m.txRows.push([{ blockedAt: NOW, blockedBy: "owner-a", blockNote: null }]);

    expect((await call(POST)).status).toBe(200);

    const where = updateWhere();
    expect(where.sql).toBe('(("clients"."id" = $1 and "clients"."salon_id" = $2) and "clients"."blocked_at" is null)');
    expect(where.params).toEqual([CLIENT_ID, SALON_A]);
  });

  it.each([
    ["bez ciała", undefined],
    ["puste ciało", ""],
    ["pusty obiekt", "{}"],
    ["notatka null", JSON.stringify({ note: null })],
    ["notatka z samych spacji", JSON.stringify({ note: "   " })],
  ])("%s → blokada bez notatki", async (_label, body) => {
    m.asOwnerOf(SALON_A);
    m.txRows.push([{ blockedAt: NOW, blockedBy: "owner-a", blockNote: null }]);

    expect((await call(POST, body === undefined ? {} : { body })).status).toBe(200);
    expect(h.setArgs[0]!.blockNote).toBeNull();
  });

  it("notatka dokładnie 500 znaków → 200", async () => {
    m.asOwnerOf(SALON_A);
    m.txRows.push([{ blockedAt: NOW, blockedBy: "owner-a", blockNote: "x".repeat(500) }]);
    expect((await call(POST, { body: JSON.stringify({ note: "x".repeat(500) }) })).status).toBe(200);
  });

  it("karta już zablokowana (np. automatycznie) → 200, changed=false, pierwotna blokada zostaje", async () => {
    m.asOwnerOf(SALON_A);
    m.txRows.push([], [{ blockedAt: EARLIER, blockedBy: "auto", blockNote: null }]);

    const res = await call(POST, { body: JSON.stringify({ note: "nowa" }) });

    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({
      clientId: CLIENT_ID,
      blocked: true,
      blockedAt: EARLIER.toISOString(),
      blockedBy: "auto",
      automatic: true,
      note: null,
      changed: false,
    });
    const read = dialect.sqlToQuery(h.selectWheres[0] as SQL);
    expect(read.sql).toBe('("clients"."id" = $1 and "clients"."salon_id" = $2)');
    expect(read.params).toEqual([CLIENT_ID, SALON_A]);
  });
});

describe("200: odblokowanie", () => {
  it("DELETE zdejmuje blokadę automatyczną — czyści czas, autora i notatkę", async () => {
    m.asOwnerOf(SALON_A);
    m.txRows.push([{ blockedAt: null, blockedBy: null, blockNote: null }]);

    const res = await call(DELETE);

    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({
      clientId: CLIENT_ID,
      blocked: false,
      blockedAt: null,
      blockedBy: null,
      automatic: false,
      note: null,
      changed: true,
    });
    expect(h.setArgs).toEqual([{ blockedAt: null, blockedBy: null, blockNote: null, updatedAt: NOW }]);
    const where = updateWhere();
    expect(where.sql).toBe('(("clients"."id" = $1 and "clients"."salon_id" = $2) and "clients"."blocked_at" is not null)');
    expect(where.params).toEqual([CLIENT_ID, SALON_A]);
  });

  it("DELETE bez blokady → 200, changed=false", async () => {
    m.asOwnerOf(SALON_A);
    m.txRows.push([], [{ blockedAt: null, blockedBy: null, blockNote: null }]);

    const res = await call(DELETE);
    expect(res.status).toBe(200);
    expect((await res.json()).data.changed).toBe(false);
  });

  it("DELETE ignoruje ciało żądania", async () => {
    m.asOwnerOf(SALON_A);
    m.txRows.push([{ blockedAt: null, blockedBy: null, blockNote: null }]);
    expect((await call(DELETE, { body: "nie-json" })).status).toBe(200);
  });
});

describe("400", () => {
  it.each(["not-a-uuid", "123"])("zły UUID %j → 400, bez transakcji", async (id) => {
    m.asOwnerOf(SALON_A);
    const res = await call(POST, { id });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ success: false, error: "Nieprawidłowy identyfikator klienta" });
    expect(h.state.transactions).toBe(0);
  });

  it("niepoprawny JSON → 400, bez transakcji", async () => {
    m.asOwnerOf(SALON_A);
    const res = await call(POST, { body: "{note:" });
    expect(res.status).toBe(400);
    expect(h.state.transactions).toBe(0);
  });

  it("notatka 501 znaków → 400 z komunikatem pola", async () => {
    m.asOwnerOf(SALON_A);
    const res = await call(POST, { body: JSON.stringify({ note: "x".repeat(501) }) });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Notatka może mieć maks. 500 znaków");
    expect(h.state.transactions).toBe(0);
  });

  it.each([
    ["nieznane pole", { note: "a", blockedBy: "auto" }],
    ["notatka nie-tekst", { note: 5 }],
  ])("%s → 400", async (_label, body) => {
    m.asOwnerOf(SALON_A);
    expect((await call(POST, { body: JSON.stringify(body) })).status).toBe(400);
    expect(h.state.transactions).toBe(0);
  });
});

describe("401 / 403 / 404", () => {
  it.each([
    ["POST", POST],
    ["DELETE", DELETE],
  ] as const)("401 bez sesji (%s)", async (_label, handler) => {
    m.getSession.mockResolvedValue(null);
    expect((await call(handler)).status).toBe(401);
    expect(h.state.transactions).toBe(0);
  });

  it.each([
    ["receptionist", "POST", POST],
    ["receptionist", "DELETE", DELETE],
    ["employee", "POST", POST],
    ["employee", "DELETE", DELETE],
  ] as const)("403 %s (%s), bez transakcji", async (role, _label, handler) => {
    m.asStaffOf(SALON_A, role);
    const res = await call(handler);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ success: false, error: "Brak uprawnień" });
    expect(h.state.transactions).toBe(0);
  });

  it("403 recepcja także z grantem temporary_access", async () => {
    m.asStaffOf(SALON_A, "receptionist");
    m.hasTemporaryAccess.mockResolvedValue(true);
    expect((await call(POST)).status).toBe(403);
  });

  it("404 konto bez salonu", async () => {
    m.signIn("client-1");
    m.ctxRows.push([], []);
    const res = await call(POST);
    expect(res.status).toBe(404);
    expect(h.state.transactions).toBe(0);
  });

  it.each([
    ["POST", POST],
    ["DELETE", DELETE],
  ] as const)("404 karta spoza salonu (%s): UPDATE i odczyt nic nie zwracają", async (_label, handler) => {
    m.asOwnerOf(SALON_A);
    m.txRows.push([], []);
    const res = await call(handler);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, error: "Nie znaleziono klienta" });
    expect(updateWhere().params).toEqual([CLIENT_ID, SALON_A]);
  });
});

describe("500 i logi", () => {
  it.each([
    ["POST", POST, "Nie udało się zablokować rezerwacji online"],
    ["DELETE", DELETE, "Nie udało się odblokować rezerwacji online"],
  ] as const)("500 (%s) — log z samą tożsamością błędu", async (_label, handler, message) => {
    m.asOwnerOf(SALON_A);
    h.state.failDb = true;

    const res = await call(handler);

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ success: false, error: message });
    const [, meta] = h.logger.error.mock.calls[0]!;
    expect(meta).toEqual({ salonId: SALON_A, clientId: CLIENT_ID, errorName: "Error" });
    expect(JSON.stringify(h.logger.error.mock.calls)).not.toContain("connection refused");
  });

  it.each([
    ["POST", "40P01", POST],
    ["POST", "40001", POST],
    ["DELETE", "40P01", DELETE],
    ["DELETE", "40001", DELETE],
  ] as const)("%s: %s z bazy (opakowany jak w Drizzle) → 409 RETRY, bez logu error", async (_label, code, handler) => {
    m.asOwnerOf(SALON_A);
    h.state.failWith = new Error("Failed query params: Anna,+48500600700", {
      cause: Object.assign(new Error("deadlock detected"), { code }),
    });

    const res = await call(handler);

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      success: false,
      code: "RETRY",
      error: "Wystąpił konflikt zapisu. Spróbuj ponownie.",
    });
    expect(h.logger.error).not.toHaveBeenCalled();
    expect(h.logger.warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(h.logger.warn.mock.calls)).not.toContain("+48500600700");
  });

  it("inny kod bazy (23503) → nadal 500", async () => {
    m.asOwnerOf(SALON_A);
    h.state.failWith = Object.assign(new Error("fk"), { code: "23503" });
    expect((await call(POST)).status).toBe(500);
  });

  it("log info bez notatki", async () => {
    m.asOwnerOf(SALON_A, "owner-a");
    m.txRows.push([{ blockedAt: NOW, blockedBy: "owner-a", blockNote: "prywatna notatka" }]);

    expect((await call(POST, { body: JSON.stringify({ note: "prywatna notatka" }) })).status).toBe(200);

    expect(h.logger.info).toHaveBeenCalledWith("[ClientBlock API] Online booking blocked", {
      salonId: SALON_A,
      clientId: CLIENT_ID,
      userId: "owner-a",
      changed: true,
    });
    expect(JSON.stringify(h.logger.info.mock.calls)).not.toContain("prywatna");
  });
});
