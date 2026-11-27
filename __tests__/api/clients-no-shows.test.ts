/**
 * GET /api/clients/[id]/no-shows — licznik „Nie przyszedł” na karcie klienta.
 *
 * Prawdziwa sesja → kontekst salonu → forSalon; mockowane krawędzie z
 * salon-staff-harness. Warunki `where` renderowane dialektem Postgresa —
 * jawne `eq(salonId)` salonu z sesji przy karcie i przy liczeniu.
 *
 * Kolejność txRows w transakcji: [karta klienta], [licznik].
 */
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "@/app/api/clients/[id]/no-shows/route";
import { SALON_A } from "./salon-staff-harness";
import type { SQL } from "drizzle-orm";

const h = await vi.hoisted(async () => {
  const m = (await import("./salon-staff-harness")).createSalonStaffMocks();
  const selectWheres: unknown[] = [];
  const state = { failDb: false, transactions: 0 };

  type Tx = Parameters<Parameters<typeof m.db.transaction>[0]>[0];
  type Chain = Record<string, (...args: unknown[]) => unknown>;
  const db = {
    transaction: (fn: (tx: Tx) => unknown) => {
      state.transactions += 1;
      if (state.failDb) return Promise.reject(new Error("connection refused params: Anna"));
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
          })
        )
      );
    },
  };

  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { m, selectWheres, state, db, logger };
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

function call(id = CLIENT_ID) {
  return GET(new Request(`http://localhost/api/clients/${id}/no-shows`), {
    params: Promise.resolve({ id }),
  });
}

function rendered(where: unknown) {
  return dialect.sqlToQuery(where as SQL);
}

beforeEach(() => {
  m.reset();
  h.selectWheres.length = 0;
  h.state.failDb = false;
  h.state.transactions = 0;
  vi.clearAllMocks();
  m.hasTemporaryAccess.mockResolvedValue(false);
});

describe("200", () => {
  it("właściciel: liczba wizyt no_show klienta", async () => {
    m.asOwnerOf(SALON_A);
    m.txRows.push([{ id: CLIENT_ID }], [{ noShowCount: 2 }]);

    const res = await call();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { clientId: CLIENT_ID, noShowCount: 2 } });
    expect(m.rlsSalonIds()).toEqual([SALON_A]);
  });

  it("recepcja → 200; licznik z bazy jako napis (bigint) zamieniony na liczbę", async () => {
    m.asStaffOf(SALON_A, "receptionist");
    m.txRows.push([{ id: CLIENT_ID }], [{ noShowCount: "3" }]);

    const res = await call();

    expect(res.status).toBe(200);
    expect((await res.json()).data.noShowCount).toBe(3);
  });

  it("klient bez nieobecności → 0", async () => {
    m.asOwnerOf(SALON_A);
    m.txRows.push([{ id: CLIENT_ID }], [{ noShowCount: 0 }]);
    expect((await (await call()).json()).data.noShowCount).toBe(0);
  });

  it("karta i licznik z jawnym eq(salonId); licznik tylko status no_show", async () => {
    m.asOwnerOf(SALON_A);
    m.txRows.push([{ id: CLIENT_ID }], [{ noShowCount: 1 }]);

    expect((await call()).status).toBe(200);

    expect(h.selectWheres).toHaveLength(2);
    const clientWhere = rendered(h.selectWheres[0]);
    expect(clientWhere.sql).toBe('("clients"."id" = $1 and "clients"."salon_id" = $2)');
    expect(clientWhere.params).toEqual([CLIENT_ID, SALON_A]);

    // Ten sam licznik co przy automatycznej blokadzie (countCardNoShows):
    // wizyty karty plus wizyty online tego samego klienta. Pełny kształt
    // zapytania sprawdza appointments-no-show-auto-block.test.ts.
    const countWhere = rendered(h.selectWheres[1]);
    expect(countWhere.sql.startsWith(
      '("appointments"."salon_id" = $1 and "appointments"."status" = $2 and ("appointments"."client_id" = $3 or ' +
        '("appointments"."client_id" is null and exists (select 1 from "clients" "no_show_card" where ' +
        '("no_show_card"."id" = $4 and "no_show_card"."salon_id" = $5 and '
    )).toBe(true);
    expect(countWhere.sql).toContain('"booking_account"."id" = "appointments"."booked_by_user_id"');
    expect(countWhere.params).toEqual([SALON_A, "no_show", CLIENT_ID, CLIENT_ID, SALON_A, true]);
  });
});

describe("400 / 401 / 403 / 404", () => {
  it("zły UUID → 400, bez transakcji", async () => {
    m.asOwnerOf(SALON_A);
    expect((await call("nie-uuid")).status).toBe(400);
    expect(h.state.transactions).toBe(0);
  });

  it("bez sesji → 401", async () => {
    m.getSession.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
    expect(h.state.transactions).toBe(0);
  });

  it("pracownik → 403, bez transakcji", async () => {
    m.asStaffOf(SALON_A, "employee");
    const res = await call();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ success: false, error: "Brak uprawnień" });
    expect(h.state.transactions).toBe(0);
  });

  it("konto bez salonu → 404", async () => {
    m.signIn("client-1");
    m.ctxRows.push([], []);
    const res = await call();
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, error: "Nie znaleziono salonu" });
    expect(h.state.transactions).toBe(0);
  });

  it("klient z innego salonu (karta z eq(salonId) pusta) → 404, bez liczenia", async () => {
    m.asOwnerOf(SALON_A);
    m.txRows.push([]);

    const res = await call();

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, error: "Nie znaleziono klienta" });
    expect(h.selectWheres).toHaveLength(1);
  });
});

describe("500", () => {
  it("błąd bazy → 500, log z samą tożsamością błędu", async () => {
    m.asOwnerOf(SALON_A);
    h.state.failDb = true;

    const res = await call();

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ success: false, error: "Nie udało się pobrać liczby nieobecności" });
    const [, meta] = h.logger.error.mock.calls[0]!;
    expect(meta).toEqual({ salonId: SALON_A, clientId: CLIENT_ID, errorName: "Error" });
    expect(JSON.stringify(h.logger.error.mock.calls)).not.toContain("connection refused");
  });
});
