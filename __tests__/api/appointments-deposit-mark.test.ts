/**
 * POST/DELETE /api/appointments/[id]/deposit — ręczne „zadatek wpłacony / cofnij”
 * dla zadatków rozliczanych poza MyHelper (BLIK na telefon salonu).
 *
 * Przez prawdziwą sesję → kontekst salonu (getSalonContext) i prawdziwe
 * forSalon — mockowane tylko krawędzie z salon-staff-harness (sesja, pule
 * bazy, granty). Warunki `where` odczytu wizyty, odczytu płatności i UPDATE są
 * przechwytywane i renderowane dialektem Postgresa: tak sprawdzamy jawne
 * `eq(salonId)` salonu z sesji w każdym zapytaniu.
 *
 * Kolejność wyników txRows w jednej transakcji: [wizyta], [płatności], [update], [insert].
 *
 * Wpis dziennika zmian zadatku: prawdziwy `recordDepositStatusEvent` na atrapie
 * `tx` (wartości INSERT w `m.insertedValues`), opakowany w `h.record`, żeby
 * wstrzyknąć błąd wpisu. Kolejność „UPDATE przed wpisem” sprawdzamy przez
 * `invocationCallOrder` szpiega `h.setSpy` (wołanego w `tx.update().set`)
 * względem `h.record`.
 *
 * SMS po oznaczeniu: moduł `@/lib/deposit-marked-sms` podmieniony atrapą `h.notify`; kolejność względem końca transakcji przez `h.txEnd`.
 */
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { DELETE, POST } from "@/app/api/appointments/[id]/deposit/route";
import { SALON_A } from "./salon-staff-harness";
import type { SQL } from "drizzle-orm";

const h = await vi.hoisted(async () => {
  const m = (await import("./salon-staff-harness")).createSalonStaffMocks();
  /** Warunki where każdego tx.select(...) w kolejności wywołań. */
  const selectWheres: unknown[] = [];
  /** Lista kolumn każdego tx.select(...) (undefined = select *). */
  const selectColumns: (Record<string, unknown> | undefined)[] = [];
  /** Argumenty każdego tx.update(...).set(x). */
  const setArgs: Record<string, unknown>[] = [];
  /** Czy odczyt wizyty blokował wiersz (`for update`). */
  const forUpdate: string[] = [];
  const state = { failDb: false, transactions: 0 };
  /** Obiekt `tx`, który dostał callback każdej transakcji. */
  const txObjects: unknown[] = [];
  /** Szpieg `tx.update().set(...)` — do kolejności względem wpisu dziennika. */
  const setSpy = vi.fn();
  /** Wołany, gdy obietnica transakcji się rozstrzygnie — wpis musi paść przed nim. */
  const txEnd = vi.fn();
  const events = await vi.importActual<typeof import("@/lib/deposit-status-events")>(
    "@/lib/deposit-status-events"
  );
  const record = vi.fn<typeof events.recordDepositStatusEvent>();
  /** Atrapa `notifyDepositMarkedPaid` (SMS do klienta po oznaczeniu). */
  const notify = vi.fn();

  type Tx = Parameters<Parameters<typeof m.db.transaction>[0]>[0];
  type Chain = Record<string, (...args: unknown[]) => unknown>;
  const db = {
    transaction: (fn: (tx: Tx) => unknown) => {
      state.transactions += 1;
      if (state.failDb) return Promise.reject(new Error("connection refused params: Anna,+48500600700"));
      return Promise.resolve(m.db.transaction((tx) => {
        const wrapped = {
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
              setSpy(v);
              return chain;
            };
            return chain;
          },
        };
        txObjects.push(wrapped);
        return fn(wrapped);
      })).finally(() => txEnd());
    },
  };

  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return {
    m, selectWheres, selectColumns, setArgs, forUpdate, state, db, logger,
    txObjects, setSpy, txEnd, record, notify,
    actualRecord: events.recordDepositStatusEvent,
    DepositStatusEventError: events.DepositStatusEventError,
  };
});

vi.mock("@/lib/deposit-status-events", async (orig) => {
  const actual = await orig<typeof import("@/lib/deposit-status-events")>();
  return { ...actual, recordDepositStatusEvent: h.record };
});
vi.mock("next/headers", () => ({ headers: vi.fn().mockResolvedValue(new Headers()) }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: h.m.getSession } } }));
vi.mock("@/lib/db", () => ({ db: h.db }));
vi.mock("@/lib/server/system/db-system", () => ({ dbSystem: h.m.dbSystem }));
vi.mock("@/lib/temporary-access", () => ({ hasTemporaryAccess: h.m.hasTemporaryAccess }));
vi.mock("@/lib/logger", () => ({ logger: h.logger }));
vi.mock("@/lib/deposit-marked-sms", () => ({ notifyDepositMarkedPaid: h.notify }));

const { m } = h;
const dialect = new PgDialect();

const APPT_ID = "11111111-1111-4111-8111-111111111111";
const GUEST_NAME = "Anna Testowa";
const GUEST_PHONE = "+48500600700";

type Handler = typeof POST;

function call(handler: Handler, id = APPT_ID) {
  return handler(new Request(`http://localhost/api/appointments/${id}/deposit`, { method: "POST" }), {
    params: Promise.resolve({ id }),
  });
}

/** Wiersz wizyty, jaki zwraca odczyt z jawnymi kolumnami. */
function appt(over: Partial<{ status: string; depositAmount: string | null; depositPaid: boolean | null }> = {}) {
  return { id: APPT_ID, status: "scheduled", depositAmount: "50.00", depositPaid: false, ...over };
}

/** Wizyta istnieje, zero płatności online. */
function givenAppointment(row = appt()) {
  m.txRows.push([row], []);
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
  h.state.transactions = 0;
  h.txObjects.length = 0;
  vi.clearAllMocks();
  m.hasTemporaryAccess.mockResolvedValue(false);
  h.record.mockReset();
  h.record.mockImplementation(h.actualRecord);
  h.notify.mockReset();
  h.notify.mockResolvedValue(undefined);
});

/** SMS wołany dokładnie raz, po zakończeniu transakcji, a wpis dziennika przed jej końcem. */
function expectNotifiedAfterCommit() {
  expect(h.notify).toHaveBeenCalledTimes(1);
  expect(h.notify.mock.calls[0]).toEqual([{ salonId: SALON_A, appointmentId: APPT_ID }]);
  expect(h.txEnd).toHaveBeenCalledTimes(1);
  expect(h.record.mock.invocationCallOrder[0]!).toBeLessThan(h.txEnd.mock.invocationCallOrder[0]!);
  expect(h.txEnd.mock.invocationCallOrder[0]!).toBeLessThan(h.notify.mock.invocationCallOrder[0]!);
}

/** Wpis dziennika, jaki prawdziwy pomocnik przekazuje do INSERT. */
function event(over: Record<string, unknown> = {}) {
  return {
    salonId: SALON_A,
    appointmentId: APPT_ID,
    depositPaid: true,
    previousDepositPaid: false,
    source: "manual_mark",
    actorUserId: "owner-a",
    actorRole: "owner",
    ...over,
  };
}

describe("200: oznaczenie i cofnięcie", () => {
  it("POST owner → depositPaid=true, changed=true, jeden UPDATE w jednej transakcji salonu z sesji", async () => {
    m.asOwnerOf(SALON_A);
    givenAppointment();

    const res = await call(POST);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ success: true, data: { appointmentId: APPT_ID, depositPaid: true, changed: true } });
    expect(h.setArgs).toHaveLength(1);
    expect(h.setArgs[0]!.depositPaid).toBe(true);
    expect(h.state.transactions).toBe(1);
    expect(new Set(m.rlsSalonIds())).toEqual(new Set([SALON_A]));
    expect(m.insertedValues).toEqual([event()]);
    expectNotifiedAfterCommit();
  });

  it("POST receptionist → 200, changed=true", async () => {
    m.asStaffOf(SALON_A, "receptionist");
    givenAppointment();

    const res = await call(POST);

    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ appointmentId: APPT_ID, depositPaid: true, changed: true });
    expect(h.setArgs[0]!.depositPaid).toBe(true);
    expect(m.insertedValues).toEqual([event({ actorUserId: "staff-a", actorRole: "receptionist" })]);
    expectNotifiedAfterCommit();
  });

  it("DELETE owner → depositPaid=false, changed=true", async () => {
    m.asOwnerOf(SALON_A);
    givenAppointment(appt({ depositPaid: true }));

    const res = await call(DELETE);

    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ appointmentId: APPT_ID, depositPaid: false, changed: true });
    expect(h.setArgs).toHaveLength(1);
    expect(h.setArgs[0]!.depositPaid).toBe(false);
    expect(m.insertedValues).toEqual([
      event({ source: "manual_unmark", previousDepositPaid: true, depositPaid: false }),
    ]);
    // Cofnięcie nie wysyła SMS.
    expect(h.notify).not.toHaveBeenCalled();
  });

  it("DELETE receptionist → wpis manual_unmark z rolą recepcji", async () => {
    m.asStaffOf(SALON_A, "receptionist");
    givenAppointment(appt({ depositPaid: true }));

    const res = await call(DELETE);

    expect(res.status).toBe(200);
    expect(m.insertedValues).toEqual([
      event({
        source: "manual_unmark",
        previousDepositPaid: true,
        depositPaid: false,
        actorUserId: "staff-a",
        actorRole: "receptionist",
      }),
    ]);
    expect(h.notify).not.toHaveBeenCalled();
  });

  it("POST przy depositPaid=null (stary wiersz) → wpis z previousDepositPaid=false", async () => {
    m.asOwnerOf(SALON_A);
    givenAppointment(appt({ depositPaid: null }));

    const res = await call(POST);

    expect(res.status).toBe(200);
    expect((await res.json()).data.changed).toBe(true);
    expect(m.insertedValues).toEqual([event({ previousDepositPaid: false })]);
    expectNotifiedAfterCommit();
  });

  it("status confirmed też można oznaczyć", async () => {
    m.asOwnerOf(SALON_A);
    givenAppointment(appt({ status: "confirmed" }));
    expect((await call(POST)).status).toBe(200);
    expect(h.setArgs).toHaveLength(1);
  });

  it("idempotencja: drugi POST (już wpłacony) → 200, changed=false, bez UPDATE", async () => {
    m.asOwnerOf(SALON_A);
    givenAppointment(appt({ depositPaid: true }));

    const res = await call(POST);

    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ appointmentId: APPT_ID, depositPaid: true, changed: false });
    expect(updates()).toEqual([]);
    expect(h.setArgs).toEqual([]);
    expect(m.insertedValues).toEqual([]);
    expect(h.record).not.toHaveBeenCalled();
    // changed=false: bez SMS (klient dostał go przy pierwszym oznaczeniu).
    expect(h.notify).not.toHaveBeenCalled();
  });

  it.each([false, null])("idempotencja: drugi DELETE (depositPaid=%s) → 200, changed=false, bez UPDATE", async (paid) => {
    m.asOwnerOf(SALON_A);
    givenAppointment(appt({ depositPaid: paid }));

    const res = await call(DELETE);

    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ appointmentId: APPT_ID, depositPaid: false, changed: false });
    expect(updates()).toEqual([]);
    expect(m.insertedValues).toEqual([]);
    expect(h.record).not.toHaveBeenCalled();
    expect(h.notify).not.toHaveBeenCalled();
  });
});

describe("zakres salonu i jedna transakcja", () => {
  it("odczyt wizyty, odczyt płatności i UPDATE mają jawne eq(salonId) salonu z sesji", async () => {
    m.asOwnerOf(SALON_A);
    givenAppointment();

    expect((await call(POST)).status).toBe(200);

    expect(h.selectWheres).toHaveLength(2);
    const [apptWhere, paymentsWhere] = h.selectWheres.map(rendered);
    expect(apptWhere!.sql).toBe('("appointments"."id" = $1 and "appointments"."salon_id" = $2)');
    expect(apptWhere!.params).toEqual([APPT_ID, SALON_A]);
    expect(paymentsWhere!.sql).toBe(
      '("deposit_payments"."appointment_id" = $1 and "deposit_payments"."salon_id" = $2)'
    );
    expect(paymentsWhere!.params).toEqual([APPT_ID, SALON_A]);

    const [update] = updates();
    const updateWhere = rendered(update!.where);
    expect(updateWhere.sql).toBe('("appointments"."id" = $1 and "appointments"."salon_id" = $2)');
    expect(updateWhere.params).toEqual([APPT_ID, SALON_A]);

    expect(h.forUpdate).toEqual(["update"]);
    expect(h.state.transactions).toBe(1);
    expect(m.rlsSalonIds()).toEqual([SALON_A]);
  });

  it("odczyty z jawną listą kolumn — bez danych klienta w zapytaniu", async () => {
    m.asOwnerOf(SALON_A);
    givenAppointment();
    expect((await call(POST)).status).toBe(200);

    expect(h.selectColumns).toHaveLength(2);
    expect(Object.keys(h.selectColumns[0] ?? {}).sort()).toEqual(
      ["depositAmount", "depositPaid", "id", "status"]
    );
    expect(Object.keys(h.selectColumns[1] ?? {})).toEqual(["id"]);
    // UPDATE zmienia tylko stan zadatku (i znacznik czasu).
    expect(Object.keys(h.setArgs[0]!).sort()).toEqual(["depositPaid", "updatedAt"]);
  });
});

describe("400", () => {
  it.each(["not-a-uuid", "123", "11111111-1111-4111-8111-11111111111"])("zły UUID %j → 400, bez transakcji", async (id) => {
    m.asOwnerOf(SALON_A);
    const res = await call(POST, id);
    expect(res.status).toBe(400);
    expect(h.state.transactions).toBe(0);
    expect(m.insertedValues).toEqual([]);
    expect(h.notify).not.toHaveBeenCalled();
  });

  it.each([null, "0", "0.00", "-10.00"])("wizyta bez zadatku (depositAmount=%j) → 400, bez UPDATE", async (amount) => {
    m.asOwnerOf(SALON_A);
    givenAppointment(appt({ depositAmount: amount }));

    const res = await call(POST);

    expect(res.status).toBe(400);
    expect((await res.json()).success).toBe(false);
    expect(updates()).toEqual([]);
    expect(m.insertedValues).toEqual([]);
    expect(h.notify).not.toHaveBeenCalled();
  });

  it.each(["cancelled", "completed", "no_show"])("wizyta %s → 400, bez UPDATE (POST i DELETE)", async (status) => {
    m.asOwnerOf(SALON_A);
    givenAppointment(appt({ status }));
    expect((await call(POST)).status).toBe(400);

    m.asOwnerOf(SALON_A);
    givenAppointment(appt({ status, depositPaid: true }));
    expect((await call(DELETE)).status).toBe(400);

    expect(updates()).toEqual([]);
    expect(m.insertedValues).toEqual([]);
    expect(h.notify).not.toHaveBeenCalled();
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
    expect(m.insertedValues).toEqual([]);
    expect(h.notify).not.toHaveBeenCalled();
  });

  it.each([
    ["POST", POST],
    ["DELETE", DELETE],
  ] as const)("403 employee (%s), bez transakcji", async (_label, handler) => {
    m.asStaffOf(SALON_A, "employee");
    givenAppointment();
    expect((await call(handler)).status).toBe(403);
    expect(h.state.transactions).toBe(0);
    expect(updates()).toEqual([]);
    expect(m.insertedValues).toEqual([]);
    expect(h.record).not.toHaveBeenCalled();
    expect(h.notify).not.toHaveBeenCalled();
  });

  it("403 employee także z grantem temporary_access", async () => {
    m.asStaffOf(SALON_A, "employee");
    m.hasTemporaryAccess.mockResolvedValue(true);
    expect((await call(POST)).status).toBe(403);
  });

  it("404 konto bez salonu", async () => {
    m.signIn("client-1");
    m.ctxRows.push([], []);
    expect((await call(POST)).status).toBe(404);
    expect(h.state.transactions).toBe(0);
  });

  it("404 obca wizyta: odczyt z eq(salonId) nic nie zwraca → bez odczytu płatności i bez UPDATE", async () => {
    m.asOwnerOf(SALON_A);
    m.txRows.push([]);

    const res = await call(POST);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, error: "Appointment not found" });
    expect(h.selectWheres).toHaveLength(1);
    expect(rendered(h.selectWheres[0]).params).toEqual([APPT_ID, SALON_A]);
    expect(updates()).toEqual([]);
    expect(m.insertedValues).toEqual([]);
    expect(h.notify).not.toHaveBeenCalled();
  });
});

describe("409 DEPOSIT_ONLINE_PAYMENT", () => {
  it.each(["pending", "succeeded", "failed", "expired", "refunded"])(
    "wizyta z wierszem deposit_payments (%s) → 409, bez UPDATE",
    async (status) => {
      m.asOwnerOf(SALON_A);
      // Status płatności nie ma znaczenia — trasa pyta o istnienie wiersza.
      m.txRows.push([appt()], [{ id: "pay-1", status }]);

      const res = await call(POST);

      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({
        success: false,
        code: "DEPOSIT_ONLINE_PAYMENT",
        error: "Zadatek tej wizyty obsługuje płatność online",
      });
      expect(updates()).toEqual([]);
      expect(m.insertedValues).toEqual([]);
      expect(h.notify).not.toHaveBeenCalled();
    }
  );

  it("409 także dla DELETE i recepcji", async () => {
    m.asStaffOf(SALON_A, "receptionist");
    m.txRows.push([appt({ depositPaid: true })], [{ id: "pay-1" }]);
    expect((await call(DELETE)).status).toBe(409);
    expect(updates()).toEqual([]);
    expect(m.insertedValues).toEqual([]);
    expect(h.notify).not.toHaveBeenCalled();
  });
});

describe("500 i logi", () => {
  it("500 przy błędzie bazy — log z samą tożsamością błędu, bez obiektu błędu i jego treści", async () => {
    m.asOwnerOf(SALON_A);
    h.state.failDb = true;

    const res = await call(POST);

    expect(res.status).toBe(500);
    expect((await res.json()).success).toBe(false);
    expect(h.logger.error).toHaveBeenCalledTimes(1);
    const [, meta] = h.logger.error.mock.calls[0]!;
    expect(meta).toEqual({ salonId: SALON_A, appointmentId: APPT_ID, errorName: "Error" });
    expect(loggedText()).not.toContain("connection refused");
    expect(loggedText()).not.toContain(GUEST_PHONE);
    expect(h.notify).not.toHaveBeenCalled();
  });

  it("błąd wpisu dziennika → 500, wpis wołany raz po UPDATE w tym samym tx (rzut cofa transakcję)", async () => {
    m.asOwnerOf(SALON_A);
    givenAppointment();
    h.record.mockRejectedValueOnce(new Error("insert failed params: +48500600700"));

    const res = await call(POST);

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ success: false, error: "Nie udalo sie zmienic stanu zadatku" });
    expect(h.state.transactions).toBe(1);
    expect(h.record).toHaveBeenCalledTimes(1);
    expect(h.record.mock.calls[0]![0]).toBe(h.txObjects[0]);
    expect(h.setSpy).toHaveBeenCalledTimes(1);
    expect(h.setSpy.mock.invocationCallOrder[0]!).toBeLessThan(h.record.mock.invocationCallOrder[0]!);
    // Wpis wewnątrz callbacku transakcji, nie po jej zakończeniu.
    expect(h.txEnd).toHaveBeenCalledTimes(1);
    expect(h.record.mock.invocationCallOrder[0]!).toBeLessThan(h.txEnd.mock.invocationCallOrder[0]!);
    expect(h.logger.info).not.toHaveBeenCalled();
    expect(h.logger.error).toHaveBeenCalledTimes(1);
    const [, meta] = h.logger.error.mock.calls[0]!;
    expect(meta).toEqual({ salonId: SALON_A, appointmentId: APPT_ID, errorName: "Error" });
    expect(loggedText()).not.toContain(GUEST_PHONE);
    expect(h.notify).not.toHaveBeenCalled();
  });

  it("DepositStatusEventError z pomocnika → 500, errorName DepositStatusEventError", async () => {
    m.asOwnerOf(SALON_A);
    givenAppointment();
    h.record.mockRejectedValueOnce(new h.DepositStatusEventError("actor"));

    const res = await call(POST);

    expect(res.status).toBe(500);
    expect((await res.json()).success).toBe(false);
    expect(h.logger.info).not.toHaveBeenCalled();
    const [, meta] = h.logger.error.mock.calls[0]!;
    // toErrorIdentity dokłada własny `code` błędu (stały kod reguły, bez wartości).
    expect(meta).toEqual({
      salonId: SALON_A,
      appointmentId: APPT_ID,
      errorName: "DepositStatusEventError",
      errorCode: "actor",
    });
    expect(h.notify).not.toHaveBeenCalled();
  });

  it("log info: salonId, appointmentId, userId, rola, nowy stan i changed — nic więcej", async () => {
    m.asStaffOf(SALON_A, "receptionist", "recep-1");
    m.txRows.push([{ ...appt(), guestName: GUEST_NAME, guestPhone: GUEST_PHONE }], []);

    expect((await call(POST)).status).toBe(200);

    expect(h.logger.info).toHaveBeenCalledTimes(1);
    expect(h.logger.info).toHaveBeenCalledWith(expect.any(String), {
      salonId: SALON_A,
      appointmentId: APPT_ID,
      userId: "recep-1",
      role: "receptionist",
      depositPaid: true,
      changed: true,
    });
    expect(loggedText()).not.toContain(GUEST_NAME);
    expect(loggedText()).not.toContain(GUEST_PHONE);
  });

  it("log info przy idempotentnym DELETE ma changed=false", async () => {
    m.asOwnerOf(SALON_A);
    givenAppointment();
    expect((await call(DELETE)).status).toBe(200);
    expect(h.logger.info).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ role: "owner", depositPaid: false, changed: false })
    );
  });
});

describe("SMS po oznaczeniu: best-effort", () => {
  it("atrapa SMS się rozstrzyga (np. brak telefonu obsłużony w module) → 200, bez warn", async () => {
    m.asOwnerOf(SALON_A);
    givenAppointment();

    const res = await call(POST);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      data: { appointmentId: APPT_ID, depositPaid: true, changed: true },
    });
    expect(h.notify).toHaveBeenCalledTimes(1);
    expect(h.logger.warn).not.toHaveBeenCalled();
  });

  it("błąd SMS → 200, oznaczenie zostaje, warn z samą tożsamością błędu", async () => {
    m.asOwnerOf(SALON_A);
    givenAppointment();
    h.notify.mockRejectedValueOnce(new Error("sms params: +48500600700"));

    const res = await call(POST);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      data: { appointmentId: APPT_ID, depositPaid: true, changed: true },
    });
    expect(h.state.transactions).toBe(1);
    expect(m.insertedValues).toEqual([event()]);
    expect(h.logger.warn).toHaveBeenCalledTimes(1);
    const [, warnMeta] = h.logger.warn.mock.calls[0]!;
    expect(warnMeta).toEqual({ appointmentId: APPT_ID, errorName: "Error" });
    expect(h.logger.info).toHaveBeenCalledTimes(1);
    expect(h.logger.info).toHaveBeenCalledWith(expect.any(String), {
      salonId: SALON_A,
      appointmentId: APPT_ID,
      userId: "owner-a",
      role: "owner",
      depositPaid: true,
      changed: true,
    });
    expect(h.logger.error).not.toHaveBeenCalled();
    expect(loggedText()).not.toContain(GUEST_PHONE);
  });
});
