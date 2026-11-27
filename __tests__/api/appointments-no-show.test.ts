/**
 * POST/DELETE /api/appointments/[id]/no-show — oznaczenie „Nie przyszedł” i cofnięcie.
 *
 * Przez prawdziwą sesję → kontekst salonu (getSalonContext) i prawdziwe
 * forSalon — mockowane tylko krawędzie z salon-staff-harness (sesja, pule
 * bazy, granty). Warunki `where` odczytu wizyty i UPDATE są renderowane
 * dialektem Postgresa: tak sprawdzamy jawne `eq(salonId)` salonu z sesji.
 *
 * Kolejność wyników txRows w jednej transakcji: [wizyta], [update].
 *
 * Zegar: udawany sam `Date` (timery zostają prawdziwe). „Teraz” = 27.11.2026
 * 13:00 w Warszawie — dzień wizyty liczy się w strefie salonu, nie UTC.
 */
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DELETE, POST } from "@/app/api/appointments/[id]/no-show/route";
import { SALON_A } from "./salon-staff-harness";
import type { SQL } from "drizzle-orm";

const h = await vi.hoisted(async () => {
  const m = (await import("./salon-staff-harness")).createSalonStaffMocks();
  /** Warunki where każdego tx.select(...) w kolejności wywołań. */
  const selectWheres: unknown[] = [];
  /** Lista kolumn każdego tx.select(...). */
  const selectColumns: (Record<string, unknown> | undefined)[] = [];
  /** Argumenty każdego tx.update(...).set(x). */
  const setArgs: Record<string, unknown>[] = [];
  /** Tryby blokady odczytu (`for update`). */
  const forUpdate: string[] = [];
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
            select: (columns?: Record<string, unknown>) => {
              selectColumns.push(columns);
              const chain = tx.select() as Chain;
              chain.where = (w: unknown) => {
                selectWheres.push(w);
                return chain;
              };
              chain.for = (mode: unknown) => {
                forUpdate.push(String(mode));
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
  return { m, selectWheres, selectColumns, setArgs, forUpdate, state, db, logger };
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
const NOW = new Date("2026-11-27T12:00:00.000Z"); // 13:00 w Warszawie
const GUEST_PHONE = "+48500600700";

/** Dzisiaj 19:00 w Warszawie — później niż „teraz”, ale ten sam dzień. */
const TODAY_LATER = new Date("2026-11-27T18:00:00.000Z");
/** Wczoraj 11:00 w Warszawie. */
const YESTERDAY = new Date("2026-11-26T10:00:00.000Z");
/** 23:30 UTC 27.11 = 00:30 w Warszawie 28.11 — jutro w strefie salonu, choć „dziś” w UTC. */
const TOMORROW_IN_WARSAW = new Date("2026-11-27T23:30:00.000Z");

type Handler = typeof POST;

function call(handler: Handler, id = APPT_ID) {
  return handler(new Request(`http://localhost/api/appointments/${id}/no-show`, { method: "POST" }), {
    params: Promise.resolve({ id }),
  });
}

function appt(over: Partial<{ status: string; startTime: Date }> = {}) {
  return { id: APPT_ID, status: "scheduled", startTime: YESTERDAY, ...over };
}

function givenAppointment(row = appt()) {
  m.txRows.push([row]);
}

function rendered(where: unknown) {
  return dialect.sqlToQuery(where as SQL);
}

function updates() {
  return m.writes.filter((w) => w.op === "update");
}

function loggedText(): string {
  return JSON.stringify(
    [h.logger.info, h.logger.warn, h.logger.error, h.logger.debug].flatMap((fn) => fn.mock.calls)
  );
}

beforeEach(() => {
  m.reset();
  h.selectWheres.length = 0;
  h.selectColumns.length = 0;
  h.setArgs.length = 0;
  h.forUpdate.length = 0;
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

describe("200: oznaczenie „Nie przyszedł”", () => {
  it("POST owner, wizyta wczorajsza → status no_show, jeden UPDATE w transakcji salonu z sesji", async () => {
    m.asOwnerOf(SALON_A);
    givenAppointment();

    const res = await call(POST);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      data: { appointmentId: APPT_ID, noShow: true, changed: true },
    });
    expect(h.setArgs).toHaveLength(1);
    expect(h.setArgs[0]!.status).toBe("no_show");
    expect(Object.keys(h.setArgs[0]!).sort()).toEqual(["status", "updatedAt"]);
    expect(h.state.transactions).toBe(1);
    expect(m.rlsSalonIds()).toEqual([SALON_A]);
  });

  it("POST receptionist → 200", async () => {
    m.asStaffOf(SALON_A, "receptionist");
    givenAppointment();

    const res = await call(POST);

    expect(res.status).toBe(200);
    expect(h.setArgs[0]!.status).toBe("no_show");
  });

  it("wizyta dzisiejsza o późniejszej godzinie → 200 (cały dzień wizyty)", async () => {
    m.asOwnerOf(SALON_A);
    givenAppointment(appt({ startTime: TODAY_LATER }));

    expect((await call(POST)).status).toBe(200);
    expect(h.setArgs).toHaveLength(1);
  });

  it("wizyta potwierdzona też → 200", async () => {
    m.asOwnerOf(SALON_A);
    givenAppointment(appt({ status: "confirmed" }));

    expect((await call(POST)).status).toBe(200);
    expect(h.setArgs[0]!.status).toBe("no_show");
  });

  it("idempotencja: drugi POST (już no_show) → 200, changed=false, bez UPDATE", async () => {
    m.asOwnerOf(SALON_A);
    givenAppointment(appt({ status: "no_show" }));

    const res = await call(POST);

    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ appointmentId: APPT_ID, noShow: true, changed: false });
    expect(updates()).toEqual([]);
    expect(h.setArgs).toEqual([]);
  });
});

describe("200: cofnięcie", () => {
  it("DELETE owner → status scheduled, changed=true", async () => {
    m.asOwnerOf(SALON_A);
    givenAppointment(appt({ status: "no_show" }));

    const res = await call(DELETE);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      data: { appointmentId: APPT_ID, noShow: false, changed: true },
    });
    expect(h.setArgs).toHaveLength(1);
    expect(h.setArgs[0]!.status).toBe("scheduled");
  });

  it("DELETE receptionist → 200", async () => {
    m.asStaffOf(SALON_A, "receptionist");
    givenAppointment(appt({ status: "no_show" }));
    expect((await call(DELETE)).status).toBe(200);
    expect(h.setArgs[0]!.status).toBe("scheduled");
  });

  it("cofnięcie działa także dla wizyty z przyszłości (stary zapis no_show)", async () => {
    m.asOwnerOf(SALON_A);
    givenAppointment(appt({ status: "no_show", startTime: TOMORROW_IN_WARSAW }));
    expect((await call(DELETE)).status).toBe(200);
    expect(h.setArgs[0]!.status).toBe("scheduled");
  });

  it.each(["scheduled", "confirmed"])("idempotencja: DELETE przy statusie %s → 200, changed=false, bez UPDATE", async (status) => {
    m.asOwnerOf(SALON_A);
    givenAppointment(appt({ status }));

    const res = await call(DELETE);

    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ appointmentId: APPT_ID, noShow: false, changed: false });
    expect(updates()).toEqual([]);
  });
});

describe("zakres salonu i blokada wiersza", () => {
  it("odczyt i UPDATE mają jawne eq(salonId) salonu z sesji; odczyt z for update", async () => {
    m.asOwnerOf(SALON_A);
    givenAppointment();

    expect((await call(POST)).status).toBe(200);

    // [wizyta], [próg automatycznej blokady] — próg pusty, więc bez kart.
    expect(h.selectWheres).toHaveLength(2);
    const apptWhere = rendered(h.selectWheres[0]);
    expect(apptWhere.sql).toBe('("appointments"."id" = $1 and "appointments"."salon_id" = $2)');
    expect(apptWhere.params).toEqual([APPT_ID, SALON_A]);

    const [update] = updates();
    const updateWhere = rendered(update!.where);
    expect(updateWhere.sql).toBe('("appointments"."id" = $1 and "appointments"."salon_id" = $2)');
    expect(updateWhere.params).toEqual([APPT_ID, SALON_A]);

    expect(h.forUpdate).toEqual(["update"]);
  });

  it("odczyt z jawną listą kolumn — bez danych klienta (samo id karty do progu blokady)", async () => {
    m.asOwnerOf(SALON_A);
    givenAppointment();
    expect((await call(POST)).status).toBe(200);
    expect(Object.keys(h.selectColumns[0] ?? {}).sort()).toEqual(["clientId", "id", "startTime", "status"]);
  });
});

describe("400", () => {
  it.each(["not-a-uuid", "123", "11111111-1111-4111-8111-11111111111"])("zły UUID %j → 400, bez transakcji", async (id) => {
    m.asOwnerOf(SALON_A);
    const res = await call(POST, id);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ success: false, error: "Nieprawidłowy identyfikator wizyty" });
    expect(h.state.transactions).toBe(0);
  });

  it.each(["completed", "cancelled"])("POST przy wizycie %s → 400, bez UPDATE", async (status) => {
    m.asOwnerOf(SALON_A);
    givenAppointment(appt({ status }));

    const res = await call(POST);

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/zaplanowanej lub potwierdzonej/);
    expect(updates()).toEqual([]);
  });

  it("POST przy wizycie jutrzejszej w strefie salonu (dziś w UTC) → 400, bez UPDATE", async () => {
    m.asOwnerOf(SALON_A);
    givenAppointment(appt({ startTime: TOMORROW_IN_WARSAW }));

    const res = await call(POST);

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/dopiero w dniu wizyty/);
    expect(updates()).toEqual([]);
  });

  it.each(["completed", "cancelled"])("DELETE przy wizycie %s → 400, bez UPDATE", async (status) => {
    m.asOwnerOf(SALON_A);
    givenAppointment(appt({ status }));

    const res = await call(DELETE);

    expect(res.status).toBe(400);
    expect(updates()).toEqual([]);
  });
});

describe("401 / 403 / 404", () => {
  it.each([
    ["POST", POST],
    ["DELETE", DELETE],
  ] as const)("401 bez sesji (%s), bez transakcji", async (_label, handler) => {
    m.getSession.mockResolvedValue(null);
    expect((await call(handler)).status).toBe(401);
    expect(h.state.transactions).toBe(0);
  });

  it.each([
    ["POST", POST],
    ["DELETE", DELETE],
  ] as const)("403 pracownik (%s), bez transakcji", async (_label, handler) => {
    m.asStaffOf(SALON_A, "employee");
    givenAppointment();
    const res = await call(handler);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ success: false, error: "Brak uprawnień" });
    expect(h.state.transactions).toBe(0);
    expect(updates()).toEqual([]);
  });

  it("403 pracownik także z grantem temporary_access", async () => {
    m.asStaffOf(SALON_A, "employee");
    m.hasTemporaryAccess.mockResolvedValue(true);
    expect((await call(POST)).status).toBe(403);
  });

  it("404 konto bez salonu", async () => {
    m.signIn("client-1");
    m.ctxRows.push([], []);
    const res = await call(POST);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, error: "Nie znaleziono salonu" });
    expect(h.state.transactions).toBe(0);
  });

  it("404 obca wizyta: odczyt z eq(salonId) nic nie zwraca → bez UPDATE", async () => {
    m.asOwnerOf(SALON_A);
    m.txRows.push([]);

    const res = await call(POST);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, error: "Nie znaleziono wizyty" });
    expect(rendered(h.selectWheres[0]).params).toEqual([APPT_ID, SALON_A]);
    expect(updates()).toEqual([]);
  });
});

describe("500 i logi", () => {
  it("500 przy błędzie bazy — log z samą tożsamością błędu", async () => {
    m.asOwnerOf(SALON_A);
    h.state.failDb = true;

    const res = await call(POST);

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ success: false, error: "Nie udało się zmienić oznaczenia wizyty" });
    expect(h.logger.error).toHaveBeenCalledTimes(1);
    const [, meta] = h.logger.error.mock.calls[0]!;
    expect(meta).toEqual({ salonId: SALON_A, appointmentId: APPT_ID, errorName: "Error" });
    expect(loggedText()).not.toContain("connection refused");
    expect(loggedText()).not.toContain(GUEST_PHONE);
  });

  it.each([
    ["POST", "40P01", POST],
    ["POST", "40001", POST],
    ["DELETE", "40P01", DELETE],
    ["DELETE", "40001", DELETE],
  ] as const)("%s: %s z bazy (opakowany jak w Drizzle) → 409 RETRY, bez logu error", async (_label, code, handler) => {
    m.asOwnerOf(SALON_A);
    h.state.failWith = new Error(`Failed query params: Anna,${GUEST_PHONE}`, {
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
    const [, meta] = h.logger.warn.mock.calls[0]!;
    expect(meta).toEqual({ salonId: SALON_A, appointmentId: APPT_ID, errorName: "Error", errorCode: code });
    expect(loggedText()).not.toContain(GUEST_PHONE);
  });

  it("inny kod bazy (23503) → nadal 500", async () => {
    m.asOwnerOf(SALON_A);
    h.state.failWith = Object.assign(new Error("fk"), { code: "23503" });
    expect((await call(POST)).status).toBe(500);
  });

  it("log info: salonId, appointmentId, userId, rola, noShow i changed — nic więcej", async () => {
    m.asStaffOf(SALON_A, "receptionist", "recep-1");
    givenAppointment();

    expect((await call(POST)).status).toBe(200);

    expect(h.logger.info).toHaveBeenCalledTimes(1);
    expect(h.logger.info).toHaveBeenCalledWith(expect.any(String), {
      salonId: SALON_A,
      appointmentId: APPT_ID,
      userId: "recep-1",
      role: "receptionist",
      noShow: true,
      changed: true,
    });
  });
});
