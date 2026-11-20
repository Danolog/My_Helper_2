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
 * Kolejność wyników txRows w jednej transakcji: [wizyta], [płatności], [update].
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

  type Tx = Parameters<Parameters<typeof m.db.transaction>[0]>[0];
  type Chain = Record<string, (...args: unknown[]) => unknown>;
  const db = {
    transaction: (fn: (tx: Tx) => unknown) => {
      state.transactions += 1;
      if (state.failDb) return Promise.reject(new Error("connection refused params: Anna,+48500600700"));
      return m.db.transaction((tx) =>
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
  vi.clearAllMocks();
  m.hasTemporaryAccess.mockResolvedValue(false);
});

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
  });

  it("POST receptionist → 200, changed=true", async () => {
    m.asStaffOf(SALON_A, "receptionist");
    givenAppointment();

    const res = await call(POST);

    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ appointmentId: APPT_ID, depositPaid: true, changed: true });
    expect(h.setArgs[0]!.depositPaid).toBe(true);
  });

  it("DELETE owner → depositPaid=false, changed=true", async () => {
    m.asOwnerOf(SALON_A);
    givenAppointment(appt({ depositPaid: true }));

    const res = await call(DELETE);

    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ appointmentId: APPT_ID, depositPaid: false, changed: true });
    expect(h.setArgs).toHaveLength(1);
    expect(h.setArgs[0]!.depositPaid).toBe(false);
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
  });

  it.each([false, null])("idempotencja: drugi DELETE (depositPaid=%s) → 200, changed=false, bez UPDATE", async (paid) => {
    m.asOwnerOf(SALON_A);
    givenAppointment(appt({ depositPaid: paid }));

    const res = await call(DELETE);

    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ appointmentId: APPT_ID, depositPaid: false, changed: false });
    expect(updates()).toEqual([]);
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
  });

  it.each([null, "0", "0.00", "-10.00"])("wizyta bez zadatku (depositAmount=%j) → 400, bez UPDATE", async (amount) => {
    m.asOwnerOf(SALON_A);
    givenAppointment(appt({ depositAmount: amount }));

    const res = await call(POST);

    expect(res.status).toBe(400);
    expect((await res.json()).success).toBe(false);
    expect(updates()).toEqual([]);
  });

  it.each(["cancelled", "completed", "no_show"])("wizyta %s → 400, bez UPDATE (POST i DELETE)", async (status) => {
    m.asOwnerOf(SALON_A);
    givenAppointment(appt({ status }));
    expect((await call(POST)).status).toBe(400);

    m.asOwnerOf(SALON_A);
    givenAppointment(appt({ status, depositPaid: true }));
    expect((await call(DELETE)).status).toBe(400);

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
  ] as const)("403 employee (%s), bez transakcji", async (_label, handler) => {
    m.asStaffOf(SALON_A, "employee");
    givenAppointment();
    expect((await call(handler)).status).toBe(403);
    expect(h.state.transactions).toBe(0);
    expect(updates()).toEqual([]);
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
  });
});

describe("409 DEPOSIT_ONLINE_PAYMENT", () => {
  it.each(["pending", "succeeded", "failed", "expired", "refunded"])(
    "wizyta z wierszem deposit_payments (%s) → 409, bez UPDATE",
    async () => {
      m.asOwnerOf(SALON_A);
      // Status płatności nie ma znaczenia — trasa pyta o istnienie wiersza.
      m.txRows.push([appt()], [{ id: "pay-1" }]);

      const res = await call(POST);

      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({
        success: false,
        code: "DEPOSIT_ONLINE_PAYMENT",
        error: "Zadatek tej wizyty obsługuje płatność online",
      });
      expect(updates()).toEqual([]);
    }
  );

  it("409 także dla DELETE i recepcji", async () => {
    m.asStaffOf(SALON_A, "receptionist");
    m.txRows.push([appt({ depositPaid: true })], [{ id: "pay-1" }]);
    expect((await call(DELETE)).status).toBe(409);
    expect(updates()).toEqual([]);
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
