/**
 * confirmDepositPayment — potwierdzenie zadatku (wolane z webhooka Stripe
 * i dev-symulatora). Kontrakt:
 *   - not_found: brak rekordu platnosci,
 *   - succeeded: idempotentny no-op (alreadyConfirmed, ZERO update'ow),
 *   - failed/refunded: stany terminalne => not_pending, NIGDY nie wskrzeszane,
 *   - pending: transakcyjny update platnosci (guard status='pending')
 *     + potwierdzenie wizyty; paymentIntentId zapisywany tylko gdy podany,
 *   - przegrany wyscig (guard zwraca 0 wierszy) => alreadyConfirmed,
 *   - SMS do klienta/goscia jest non-blocking: brak telefonu / blad SMS
 *     nie psuje potwierdzenia (smsSent=false, success=true).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  selectQueue,
  mockDbSelect,
  txReturningQueue,
  mockTxUpdate,
  mockTxSet,
  mockTransaction,
  mockSendSms,
} = vi.hoisted(() => {
  // db.select().from().where() — kolejne wyniki z kolejki (FIFO)
  const selectQueue: unknown[][] = [];
  const mockDbSelectWhere = vi.fn(() =>
    Promise.resolve(selectQueue.length > 0 ? selectQueue.shift()! : [])
  );
  const mockDbSelectFrom = vi.fn(() => ({ where: mockDbSelectWhere }));
  const mockDbSelect = vi.fn((..._args: unknown[]) => ({ from: mockDbSelectFrom }));

  // tx.update().set().where().returning() — kolejne wyniki z kolejki
  const txReturningQueue: unknown[][] = [];
  const mockTxReturning = vi.fn(() =>
    Promise.resolve(txReturningQueue.length > 0 ? txReturningQueue.shift()! : [])
  );
  const mockTxWhere = vi.fn(() => ({ returning: mockTxReturning }));
  const mockTxSet = vi.fn((..._args: unknown[]) => ({ where: mockTxWhere }));
  const mockTxUpdate = vi.fn(() => ({ set: mockTxSet }));

  const mockTransaction = vi.fn(
    (fn: (tx: { update: typeof mockTxUpdate }) => unknown) =>
      fn({ update: mockTxUpdate })
  );

  const mockSendSms = vi.fn();

  return {
    selectQueue,
    mockDbSelect,
    txReturningQueue,
    mockTxUpdate,
    mockTxSet,
    mockTxReturning,
    mockTransaction,
    mockSendSms,
  };
});

vi.mock("@/lib/db", () => ({
  db: {
    select: (...args: unknown[]) => mockDbSelect(...args),
    transaction: (...args: unknown[]) =>
      mockTransaction(...(args as Parameters<typeof mockTransaction>)),
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: unknown[]) => ({ type: "eq", args })),
  and: vi.fn((...args: unknown[]) => ({ type: "and", args })),
}));

vi.mock("@/lib/schema", () => ({
  depositPayments: {
    id: "depositPayments.id",
    status: "depositPayments.status",
    appointmentId: "depositPayments.appointmentId",
  },
  appointments: { id: "appointments.id" },
  clients: { id: "clients.id" },
  services: { id: "services.id" },
  employees: { id: "employees.id" },
}));

vi.mock("@/lib/sms", () => ({
  sendPaymentConfirmationSms: (...args: unknown[]) => mockSendSms(...args),
}));

import { confirmDepositPayment } from "@/lib/deposit-confirmation";

function queueSelect(...results: unknown[][]) {
  selectQueue.push(...results);
}

const pendingPayment = {
  id: "dp-1",
  appointmentId: "appt-1",
  salonId: "salon-1",
  status: "pending",
  amount: "50.00",
  currency: "PLN",
  stripePaymentIntentId: null,
};

const updatedPayment = { ...pendingPayment, status: "succeeded" };

const confirmedAppointment = {
  id: "appt-1",
  clientId: "client-1",
  employeeId: "emp-1",
  serviceId: "svc-1",
  startTime: new Date("2026-07-10T10:00:00Z"),
  guestPhone: null,
  guestName: null,
  depositPaid: true,
  status: "confirmed",
};

describe("confirmDepositPayment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectQueue.length = 0;
    txReturningQueue.length = 0;
    mockSendSms.mockResolvedValue({ success: true });
  });

  it("zwraca not_found, gdy platnosc nie istnieje", async () => {
    queueSelect([]);

    const result = await confirmDepositPayment("dp-nieistniejacy");
    expect(result).toEqual({
      success: false,
      alreadyConfirmed: false,
      smsSent: false,
      error: "not_found",
    });
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("succeeded => idempotentny no-op (alreadyConfirmed, bez update'ow i SMS)", async () => {
    const payment = { ...pendingPayment, status: "succeeded" };
    queueSelect([payment]);

    const result = await confirmDepositPayment("dp-1");
    expect(result).toEqual({
      success: true,
      alreadyConfirmed: true,
      smsSent: false,
      depositPayment: payment,
    });
    expect(mockTransaction).not.toHaveBeenCalled();
    expect(mockTxUpdate).not.toHaveBeenCalled();
    expect(mockSendSms).not.toHaveBeenCalled();
  });

  it.each(["failed", "refunded"])(
    "status %s => not_pending, platnosc NIGDY nie jest wskrzeszana",
    async (status) => {
      const payment = { ...pendingPayment, status };
      queueSelect([payment]);

      const result = await confirmDepositPayment("dp-1");
      expect(result).toEqual({
        success: false,
        alreadyConfirmed: false,
        smsSent: false,
        depositPayment: payment,
        error: "not_pending",
      });
      expect(mockTransaction).not.toHaveBeenCalled();
      expect(mockTxUpdate).not.toHaveBeenCalled();
    }
  );

  it("happy path: pending -> succeeded, wizyta potwierdzona, pi_ zapisany, SMS do klienta", async () => {
    queueSelect(
      [pendingPayment],
      /* klient */ [
        { id: "client-1", phone: "+48111222333", firstName: "Jan", lastName: "Kowalski" },
      ],
      /* pracownik */ [{ id: "emp-1", firstName: "Ewa", lastName: "Nowak" }],
      /* usluga */ [{ id: "svc-1", name: "Strzyzenie" }]
    );
    txReturningQueue.push([updatedPayment], [confirmedAppointment]);

    const result = await confirmDepositPayment("dp-1", { paymentIntentId: "pi_real_1" });

    expect(result.success).toBe(true);
    expect(result.alreadyConfirmed).toBe(false);
    expect(result.smsSent).toBe(true);
    expect(result.depositPayment).toEqual(updatedPayment);
    expect(result.appointment).toEqual(confirmedAppointment);

    // Update platnosci: succeeded + zapis prawdziwego payment_intent id (dla refundu)
    expect(mockTxSet.mock.calls[0]![0]).toMatchObject({
      status: "succeeded",
      stripePaymentIntentId: "pi_real_1",
    });
    // Update wizyty: depositPaid + confirmed
    expect(mockTxSet.mock.calls[1]![0]).toMatchObject({
      depositPaid: true,
      status: "confirmed",
    });

    expect(mockSendSms).toHaveBeenCalledWith(
      expect.objectContaining({
        clientPhone: "+48111222333",
        clientName: "Jan Kowalski",
        clientId: "client-1",
        amount: 50,
        currency: "PLN",
        serviceName: "Strzyzenie",
        employeeName: "Ewa Nowak",
        salonId: "salon-1",
      })
    );
  });

  it("bez paymentIntentId nie nadpisuje stripePaymentIntentId (zostaje istniejaca referencja)", async () => {
    queueSelect([pendingPayment], [], [{ firstName: "Ewa", lastName: "Nowak" }], []);
    txReturningQueue.push(
      [updatedPayment],
      [{ ...confirmedAppointment, clientId: null, guestPhone: "+48600700800" }]
    );

    await confirmDepositPayment("dp-1");

    expect(mockTxSet.mock.calls[0]![0]).toMatchObject({ status: "succeeded" });
    expect(mockTxSet.mock.calls[0]![0]).not.toHaveProperty("stripePaymentIntentId");
  });

  it("przegrany wyscig: guard status='pending' zwraca 0 wierszy => alreadyConfirmed, wizyta nietykana", async () => {
    queueSelect([pendingPayment]);
    txReturningQueue.push([]); // konkurencyjny webhook juz potwierdzil

    const result = await confirmDepositPayment("dp-1");
    expect(result).toEqual({ success: true, alreadyConfirmed: true, smsSent: false });
    // Tylko jeden tx.update (platnosc) — update wizyty sie nie wykonal
    expect(mockTxUpdate).toHaveBeenCalledTimes(1);
    expect(mockSendSms).not.toHaveBeenCalled();
  });

  it("gosc bez kartoteki: SMS na guestPhone, bez clientId, serviceName fallback 'Wizyta'", async () => {
    queueSelect(
      [pendingPayment],
      /* pracownik */ [{ id: "emp-1", firstName: "Ewa", lastName: "Nowak" }]
      // brak selecta uslugi — serviceId=null
    );
    txReturningQueue.push(
      [updatedPayment],
      [
        {
          ...confirmedAppointment,
          clientId: null,
          serviceId: null,
          guestPhone: "+48600700800",
          guestName: "Anna Gosc",
        },
      ]
    );

    const result = await confirmDepositPayment("dp-1");
    expect(result.success).toBe(true);
    expect(result.smsSent).toBe(true);

    expect(mockSendSms).toHaveBeenCalledWith(
      expect.objectContaining({
        clientPhone: "+48600700800",
        clientName: "Anna Gosc",
        serviceName: "Wizyta",
      })
    );
    expect(mockSendSms.mock.calls[0]![0]).not.toHaveProperty("clientId");
  });

  it("brak telefonu klienta i goscia => smsSent=false, ale potwierdzenie OK", async () => {
    queueSelect(
      [pendingPayment],
      /* klient bez telefonu */ [
        { id: "client-1", phone: null, firstName: "Jan", lastName: "Kowalski" },
      ]
    );
    txReturningQueue.push([updatedPayment], [confirmedAppointment]);

    const result = await confirmDepositPayment("dp-1");
    expect(result.success).toBe(true);
    expect(result.smsSent).toBe(false);
    expect(mockSendSms).not.toHaveBeenCalled();
  });

  it("wyjatek przy wysylce SMS nie psuje potwierdzenia (non-blocking)", async () => {
    queueSelect(
      [pendingPayment],
      [{ id: "client-1", phone: "+48111222333", firstName: "Jan", lastName: "Kowalski" }],
      [{ firstName: "Ewa", lastName: "Nowak" }],
      [{ name: "Strzyzenie" }]
    );
    txReturningQueue.push([updatedPayment], [confirmedAppointment]);
    mockSendSms.mockRejectedValue(new Error("SMSAPI down"));

    const result = await confirmDepositPayment("dp-1");
    expect(result.success).toBe(true);
    expect(result.alreadyConfirmed).toBe(false);
    expect(result.smsSent).toBe(false);
  });

  it("SMS zwracajacy success=false => smsSent=false, potwierdzenie OK", async () => {
    queueSelect(
      [pendingPayment],
      [{ id: "client-1", phone: "+48111222333", firstName: "Jan", lastName: "Kowalski" }],
      [{ firstName: "Ewa", lastName: "Nowak" }],
      [{ name: "Strzyzenie" }]
    );
    txReturningQueue.push([updatedPayment], [confirmedAppointment]);
    mockSendSms.mockResolvedValue({ success: false, error: "invalid number" });

    const result = await confirmDepositPayment("dp-1");
    expect(result.success).toBe(true);
    expect(result.smsSent).toBe(false);
  });
});
