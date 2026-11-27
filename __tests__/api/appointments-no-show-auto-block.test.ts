/**
 * Automatyczna blokada rezerwacji online w POST /api/appointments/[id]/no-show.
 *
 * Próg z `salons.settingsJson.noShowAutoBlockThreshold` (1, 2, 3, null = wyłączony).
 * Blokada zapisuje się w tej samej transakcji co oznaczenie „Nie przyszedł”.
 * Cofnięcie (DELETE) blokady nie zdejmuje.
 *
 * Kolejność wyników txRows w transakcji POST z kartą klienta:
 *   [wizyta], [update wizyty], [próg salonu], [karta klienta FOR NO KEY UPDATE],
 *   [licznik no_show], [update karty RETURNING].
 *
 * Mockowane tylko krawędzie z salon-staff-harness; forSalon prawdziwe.
 */
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DELETE, POST } from "@/app/api/appointments/[id]/no-show/route";
import { SALON_A } from "./salon-staff-harness";
import type { SQL } from "drizzle-orm";

const h = await vi.hoisted(async () => {
  const m = (await import("./salon-staff-harness")).createSalonStaffMocks();
  const selectWheres: unknown[] = [];
  const setArgs: Record<string, unknown>[] = [];
  const lockModes: string[] = [];
  /** failSelectNo: numer odczytu w transakcji (od 1), który odrzuca baza. */
  const state = { transactions: 0, failSelectNo: 0 };

  type Tx = Parameters<Parameters<typeof m.db.transaction>[0]>[0];
  type Chain = Record<string, (...args: unknown[]) => unknown>;
  const db = {
    transaction: (fn: (tx: Tx) => unknown) => {
      state.transactions += 1;
      let selects = 0;
      return Promise.resolve(
        m.db.transaction((tx) =>
          fn({
            ...tx,
            select: () => {
              selects += 1;
              const chain = tx.select() as Chain;
              if (selects === state.failSelectNo) {
                chain.then = (_resolve: unknown, reject: unknown) =>
                  Promise.reject(new Error("deadlock detected")).catch(reject as (e: unknown) => unknown);
              }
              chain.where = (w: unknown) => {
                selectWheres.push(w);
                return chain;
              };
              chain.for = (mode: unknown) => {
                lockModes.push(String(mode));
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
  return { m, selectWheres, setArgs, lockModes, state, db, logger };
});

vi.mock("next/headers", () => ({ headers: vi.fn().mockResolvedValue(new Headers()) }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: h.m.getSession } } }));
vi.mock("@/lib/db", () => ({ db: h.db }));
vi.mock("@/lib/server/system/db-system", () => ({ dbSystem: h.m.dbSystem }));
vi.mock("@/lib/temporary-access", () => ({ hasTemporaryAccess: h.m.hasTemporaryAccess }));
vi.mock("@/lib/logger", () => ({ logger: h.logger }));

const { m } = h;
const dialect = new PgDialect();

const APPT_ID = "11111111-1111-4111-8111-111111111111";
const CLIENT_ID = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-11-27T12:00:00.000Z");
const YESTERDAY = new Date("2026-11-26T10:00:00.000Z");

function call(handler: typeof POST) {
  return handler(new Request(`http://localhost/api/appointments/${APPT_ID}/no-show`, { method: "POST" }), {
    params: Promise.resolve({ id: APPT_ID }),
  });
}

/** Wizyta z kartą klienta i odpowiedzi bazy na ścieżce progu. */
function givenMarkable(opts: { threshold: unknown; noShowCount?: number; blockedNow?: boolean; clientMissing?: boolean }) {
  m.txRows.push(
    [{ id: APPT_ID, status: "scheduled", startTime: YESTERDAY, clientId: CLIENT_ID }],
    [], // update wizyty
    [{ threshold: opts.threshold }]
  );
  if (opts.threshold === null || ![1, 2, 3].includes(opts.threshold as number)) return;
  m.txRows.push(opts.clientMissing ? [] : [{ id: CLIENT_ID }]);
  if (opts.clientMissing) return;
  m.txRows.push([{ noShowCount: opts.noShowCount ?? 0 }]);
  if ((opts.noShowCount ?? 0) >= (opts.threshold as number)) {
    m.txRows.push(opts.blockedNow === false ? [] : [{ id: CLIENT_ID }]);
  }
}

function clientUpdates() {
  return h.setArgs.filter((s) => "blockedAt" in s);
}

beforeEach(() => {
  m.reset();
  h.selectWheres.length = 0;
  h.setArgs.length = 0;
  h.lockModes.length = 0;
  h.state.transactions = 0;
  h.state.failSelectNo = 0;
  vi.clearAllMocks();
  m.hasTemporaryAccess.mockResolvedValue(false);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("próg osiągnięty → blokada 'auto' w tej samej transakcji", () => {
  it.each([
    [1, 1],
    [2, 2],
    [3, 3],
    [2, 5],
  ])("próg %i, licznik %i → blokada", async (threshold, noShowCount) => {
    m.asOwnerOf(SALON_A);
    givenMarkable({ threshold, noShowCount });

    const res = await call(POST);

    expect(res.status).toBe(200);
    // Odpowiedź trasy bez zmian.
    expect((await res.json()).data).toEqual({ appointmentId: APPT_ID, noShow: true, changed: true });
    expect(h.state.transactions).toBe(1);
    const [block] = clientUpdates();
    expect(block).toMatchObject({ blockedBy: "auto", blockNote: null });
    expect(block!.blockedAt).toEqual(NOW);
    expect(h.lockModes).toEqual(["update", "no key update"]);
    expect(h.logger.info).toHaveBeenCalledWith("[AppointmentNoShow API] Online booking auto-blocked", {
      salonId: SALON_A,
      appointmentId: APPT_ID,
      clientId: CLIENT_ID,
      threshold,
      noShowCount,
    });
  });

  it("UPDATE karty tylko bez istniejącej blokady, z jawnym eq(salonId)", async () => {
    m.asOwnerOf(SALON_A);
    givenMarkable({ threshold: 1, noShowCount: 1 });

    expect((await call(POST)).status).toBe(200);

    const clientWrite = m.writes.filter((w) => w.op === "update")[1]!;
    const where = dialect.sqlToQuery(clientWrite.where as SQL);
    expect(where.sql).toBe(
      '("clients"."id" = $1 and "clients"."salon_id" = $2 and "clients"."blocked_at" is null)'
    );
    expect(where.params).toEqual([CLIENT_ID, SALON_A]);
  });

  it("licznik liczy tylko no_show tej karty w salonie z sesji", async () => {
    m.asOwnerOf(SALON_A);
    givenMarkable({ threshold: 2, noShowCount: 2 });

    expect((await call(POST)).status).toBe(200);

    // [wizyta], [próg], [karta], [licznik]
    const salonWhere = dialect.sqlToQuery(h.selectWheres[1] as SQL);
    expect(salonWhere.sql).toBe('"salons"."id" = $1');
    expect(salonWhere.params).toEqual([SALON_A]);
    const countWhere = dialect.sqlToQuery(h.selectWheres[3] as SQL);
    expect(countWhere.sql).toBe(
      '("appointments"."salon_id" = $1 and "appointments"."client_id" = $2 and "appointments"."status" = $3)'
    );
    expect(countWhere.params).toEqual([SALON_A, CLIENT_ID, "no_show"]);
  });

  it("karta już zablokowana (UPDATE bez wiersza) → 200, bez logu blokady", async () => {
    m.asOwnerOf(SALON_A);
    givenMarkable({ threshold: 1, noShowCount: 3, blockedNow: false });

    expect((await call(POST)).status).toBe(200);
    expect(clientUpdates()).toHaveLength(1);
    expect(h.logger.info).toHaveBeenCalledTimes(1);
  });
});

describe("bez blokady", () => {
  it.each([
    [2, 1],
    [3, 2],
  ])("próg %i, licznik %i → bez blokady", async (threshold, noShowCount) => {
    m.asOwnerOf(SALON_A);
    givenMarkable({ threshold, noShowCount });

    expect((await call(POST)).status).toBe(200);
    expect(clientUpdates()).toEqual([]);
    expect(h.logger.info).toHaveBeenCalledTimes(1);
  });

  it.each([null, 0, 4, "2", true, { n: 1 }])("próg wyłączony albo niepoprawny (%j) → bez blokady i bez blokady wiersza karty", async (threshold) => {
    m.asOwnerOf(SALON_A);
    givenMarkable({ threshold });

    expect((await call(POST)).status).toBe(200);
    expect(clientUpdates()).toEqual([]);
    expect(h.lockModes).toEqual(["update"]);
  });

  it("brak ustawień salonu (SQL NULL) → bez blokady", async () => {
    m.asOwnerOf(SALON_A);
    m.txRows.push([{ id: APPT_ID, status: "scheduled", startTime: YESTERDAY, clientId: CLIENT_ID }], [], []);

    expect((await call(POST)).status).toBe(200);
    expect(clientUpdates()).toEqual([]);
  });

  it("wizyta gościa bez karty → próg nieczytany", async () => {
    m.asOwnerOf(SALON_A);
    m.txRows.push([{ id: APPT_ID, status: "scheduled", startTime: YESTERDAY, clientId: null }]);

    expect((await call(POST)).status).toBe(200);
    expect(h.selectWheres).toHaveLength(1);
    expect(clientUpdates()).toEqual([]);
  });

  it("karta usunięta w międzyczasie → 200, bez blokady", async () => {
    m.asOwnerOf(SALON_A);
    givenMarkable({ threshold: 1, clientMissing: true });

    expect((await call(POST)).status).toBe(200);
    expect(clientUpdates()).toEqual([]);
  });

  it("powtórne oznaczenie (już no_show) → bez progu i bez blokady", async () => {
    m.asOwnerOf(SALON_A);
    m.txRows.push([{ id: APPT_ID, status: "no_show", startTime: YESTERDAY, clientId: CLIENT_ID }]);

    expect((await call(POST)).status).toBe(200);
    expect(h.selectWheres).toHaveLength(1);
    expect(h.setArgs).toEqual([]);
  });
});

describe("cofnięcie nie zdejmuje blokady", () => {
  it("DELETE → status scheduled, karta klienta nietknięta", async () => {
    m.asOwnerOf(SALON_A);
    m.txRows.push([{ id: APPT_ID, status: "no_show", startTime: YESTERDAY, clientId: CLIENT_ID }]);

    const res = await call(DELETE);

    expect(res.status).toBe(200);
    expect(h.setArgs).toHaveLength(1);
    expect(h.setArgs[0]!.status).toBe("scheduled");
    expect(clientUpdates()).toEqual([]);
    expect(h.selectWheres).toHaveLength(1);
  });
});

describe("500", () => {
  it("błąd przy liczeniu → 500, cała transakcja (z oznaczeniem) się wycofuje", async () => {
    m.asOwnerOf(SALON_A);
    m.txRows.push(
      [{ id: APPT_ID, status: "scheduled", startTime: YESTERDAY, clientId: CLIENT_ID }],
      [],
      [{ threshold: 1 }],
      [{ id: CLIENT_ID }]
    );
    // Czwarty odczyt (licznik) odrzucony — jak zakleszczenie albo zerwane połączenie.
    h.state.failSelectNo = 4;

    const res = await call(POST);

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ success: false, error: "Nie udało się zmienić oznaczenia wizyty" });
    expect(clientUpdates()).toEqual([]);
    expect(h.logger.error).toHaveBeenCalledTimes(1);
  });
});
