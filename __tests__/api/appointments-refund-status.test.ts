/**
 * GET /api/appointments/[id]/refund-status — status zadatku w oknie wizyty.
 *
 * Prawdziwe forSalon; mockowane krawędzie: sesja, salon użytkownika, pula bazy.
 * Warunki `where` obu odczytów (wizyta, płatność) są przechwytywane
 * i renderowane dialektem Postgresa — tak sprawdzamy eq(salonId) salonu z sesji.
 *
 * Kolejność wyników txRows: [wizyta], [płatność].
 */
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "@/app/api/appointments/[id]/refund-status/route";
import { SALON_A } from "./salon-staff-harness";
import type { SQL } from "drizzle-orm";

const h = await vi.hoisted(async () => {
  const m = (await import("./salon-staff-harness")).createSalonStaffMocks();
  const selectWheres: unknown[] = [];
  const state = { failDb: false };
  const getUserSalonId = vi.fn();

  type Tx = Parameters<Parameters<typeof m.db.transaction>[0]>[0];
  type Chain = Record<string, (...args: unknown[]) => unknown>;
  const db = {
    transaction: (fn: (tx: Tx) => unknown) => {
      if (state.failDb) return Promise.reject(new Error("connection refused"));
      return m.db.transaction((tx) =>
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
      );
    },
  };

  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { m, selectWheres, state, getUserSalonId, db, logger };
});

vi.mock("next/headers", () => ({ headers: vi.fn().mockResolvedValue(new Headers()) }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: h.m.getSession } } }));
vi.mock("@/lib/get-user-salon", () => ({ getUserSalonId: h.getUserSalonId }));
vi.mock("@/lib/db", () => ({ db: h.db }));
vi.mock("@/lib/logger", () => ({ logger: h.logger }));

const { m } = h;
const dialect = new PgDialect();

const APPT_ID = "11111111-1111-4111-8111-111111111111";

function call(id = APPT_ID) {
  return GET(new Request(`http://localhost/api/appointments/${id}/refund-status`), {
    params: Promise.resolve({ id }),
  });
}

function appt(over: Partial<{ depositAmount: string | null; depositPaid: boolean; status: string }> = {}) {
  return {
    id: APPT_ID,
    salonId: SALON_A,
    status: "cancelled",
    depositAmount: "50.00",
    depositPaid: false,
    ...over,
  };
}

function payment(over: Record<string, unknown> = {}) {
  return {
    id: "pay-1",
    appointmentId: APPT_ID,
    salonId: SALON_A,
    amount: "50.00",
    paymentMethod: "stripe",
    status: "refunded",
    refundedAt: "2026-11-01T10:00:00.000Z",
    stripeRefundId: "re_123",
    refundReason: "Anulowanie z wyprzedzeniem",
    ...over,
  };
}

function signedInOwner() {
  m.signIn("owner-a");
  h.getUserSalonId.mockResolvedValue(SALON_A);
}

beforeEach(() => {
  m.reset();
  h.selectWheres.length = 0;
  h.state.failDb = false;
  vi.clearAllMocks();
  h.getUserSalonId.mockReset();
});

describe("200 z wierszem płatności online", () => {
  it("pola jak dotąd + settledOutsideApp=false", async () => {
    signedInOwner();
    m.txRows.push([appt({ depositPaid: true })], [payment()]);

    const res = await call();

    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({
      appointmentId: APPT_ID,
      hasDeposit: true,
      depositAmount: 50,
      depositPaid: true,
      paymentMethod: "stripe",
      paymentStatus: "refunded",
      refundStatus: "refunded",
      refundAmount: 50,
      forfeitedAmount: 0,
      refundedAt: "2026-11-01T10:00:00.000Z",
      stripeRefundId: "re_123",
      refundReason: "Anulowanie z wyprzedzeniem",
      settledOutsideApp: false,
    });
  });

  it("forfeited → forfeitedAmount, refundAmount 0", async () => {
    signedInOwner();
    m.txRows.push([appt()], [payment({ status: "forfeited", paymentMethod: "blik_p2p" })]);

    const data = (await (await call()).json()).data;

    expect(data.refundStatus).toBe("forfeited");
    expect(data.forfeitedAmount).toBe(50);
    expect(data.refundAmount).toBe(0);
    expect(data.settledOutsideApp).toBe(false);
  });
});

describe("200 bez wiersza płatności (zadatek poza MyHelper)", () => {
  it("zadatek wpłacony → hasDeposit, kwota, depositPaid=true, settledOutsideApp", async () => {
    signedInOwner();
    m.txRows.push([appt({ depositAmount: "80.50", depositPaid: true })], []);

    const res = await call();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      data: {
        appointmentId: APPT_ID,
        hasDeposit: true,
        depositAmount: 80.5,
        depositPaid: true,
        paymentMethod: null,
        paymentStatus: null,
        refundStatus: "none",
        refundAmount: 0,
        forfeitedAmount: 0,
        settledOutsideApp: true,
      },
    });
  });

  it("zadatek niewpłacony → hasDeposit, depositPaid=false", async () => {
    signedInOwner();
    m.txRows.push([appt({ depositPaid: false })], []);

    const data = (await (await call()).json()).data;

    expect(data).toEqual({
      appointmentId: APPT_ID,
      hasDeposit: true,
      depositAmount: 50,
      depositPaid: false,
      paymentMethod: null,
      paymentStatus: null,
      refundStatus: "none",
      refundAmount: 0,
      forfeitedAmount: 0,
      settledOutsideApp: true,
    });
  });

  it.each([null, "", "0", "0.00", "-10.00", "abc"])(
    "bez zadatku (depositAmount=%j) → hasDeposit=false, bez depositAmount",
    async (amount) => {
      signedInOwner();
      m.txRows.push([appt({ depositAmount: amount })], []);

      const res = await call();
      const data = (await res.json()).data;

      expect(res.status).toBe(200);
      expect(data.hasDeposit).toBe(false);
      expect(data).not.toHaveProperty("depositAmount");
      expect(data.refundStatus).toBe("none");
      expect(data.refundAmount).toBe(0);
    }
  );
});

describe("zakres salonu", () => {
  it("odczyt wizyty i płatności mają eq(salonId) salonu z sesji", async () => {
    signedInOwner();
    m.txRows.push([appt()], []);

    expect((await call()).status).toBe(200);

    expect(h.selectWheres).toHaveLength(2);
    const [apptWhere, payWhere] = h.selectWheres.map((w) => dialect.sqlToQuery(w as SQL));
    expect(apptWhere!.sql).toBe('("appointments"."id" = $1 and "appointments"."salon_id" = $2)');
    expect(apptWhere!.params).toEqual([APPT_ID, SALON_A]);
    expect(payWhere!.sql).toBe(
      '("deposit_payments"."appointment_id" = $1 and "deposit_payments"."salon_id" = $2)'
    );
    expect(payWhere!.params).toEqual([APPT_ID, SALON_A]);
    expect(new Set(m.rlsSalonIds())).toEqual(new Set([SALON_A]));
  });
});

describe("401 / 404 / 500", () => {
  it("401 bez sesji, bez zapytań", async () => {
    m.getSession.mockResolvedValue(null);

    const res = await call();

    expect(res.status).toBe(401);
    expect(h.selectWheres).toHaveLength(0);
  });

  it("404 konto bez salonu, bez zapytań", async () => {
    m.signIn("client-1");
    h.getUserSalonId.mockResolvedValue(null);

    const res = await call();

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, error: "Salon not found" });
    expect(h.selectWheres).toHaveLength(0);
  });

  it("404 brak wizyty (także wizyta innego salonu — filtr eq(salonId) nic nie zwraca), bez odczytu płatności", async () => {
    signedInOwner();
    m.txRows.push([]);

    const res = await call();

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, error: "Appointment not found" });
    expect(h.selectWheres).toHaveLength(1);
    expect(dialect.sqlToQuery(h.selectWheres[0] as SQL).params).toEqual([APPT_ID, SALON_A]);
  });

  it("500 przy błędzie bazy", async () => {
    signedInOwner();
    h.state.failDb = true;

    const res = await call();

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ success: false, error: "Failed to get refund status" });
    expect(h.logger.error).toHaveBeenCalledTimes(1);
  });
});
