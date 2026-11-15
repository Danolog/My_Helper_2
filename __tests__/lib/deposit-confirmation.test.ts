/**
 * confirmDepositPayment — potwierdzenie zadatku (wolane z webhooka Stripe
 * i dev-symulatora). Kontrakt:
 *   - not_found: brak rekordu platnosci,
 *   - succeeded: idempotentny no-op (alreadyConfirmed, ZERO update'ow),
 *   - refunded: stan terminalny => not_pending, NIGDY nie wskrzeszany,
 *   - pending: transakcyjny update platnosci (guard status='pending'),
 *     potem wizyta FOR UPDATE; paymentIntentId zapisywany tylko gdy podany,
 *   - failed: TYLKO gdy Stripe payment_status === "paid" — osobny warunkowy
 *     UPDATE ... WHERE status='failed' w tej samej transakcji; bez tego
 *     (dev-symulator) => not_pending (warunki Ethana, #70),
 *   - #70: wizyta nie scheduled/confirmed (np. cancelled) => platnosc
 *     succeeded, wizyta NIETYKANA (status i depositPaid), bez SMS, zwrot TEJ
 *     platnosci; nieudany zwrot => logger.error „manual refund”,
 *   - confirmed + depositPaid=false => depositPaid=true, bez zwrotu, bez SMS;
 *     depositPaid=true z innej platnosci => zwrot tej drugiej,
 *   - przegrany wyscig (guard 0 wierszy) => decyzja po ponownym odczycie:
 *     succeeded => alreadyConfirmed, inaczej not_pending,
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
  mockTxWhere,
  mockTransaction,
  mockSendSms,
  txSelectQueue,
  mockTxFor,
  mockRefund,
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
  const mockTxWhere = vi.fn((..._args: unknown[]) => ({ returning: mockTxReturning }));
  const mockTxSet = vi.fn((..._args: unknown[]) => ({ where: mockTxWhere }));
  const mockTxUpdate = vi.fn(() => ({ set: mockTxSet }));

  // tx.select().from().where().for("update") — stan wizyty po blokadzie
  const txSelectQueue: unknown[][] = [];
  const mockTxFor = vi.fn(() =>
    Promise.resolve(
      txSelectQueue.length > 0 ? txSelectQueue.shift()! : [{ id: "appt-1", status: "scheduled" }]
    )
  );
  const mockTxSelect = vi.fn(() => ({ from: () => ({ where: () => ({ for: mockTxFor }) }) }));

  const mockTransaction = vi.fn(
    (fn: (tx: { update: typeof mockTxUpdate; select: typeof mockTxSelect }) => unknown) =>
      fn({ update: mockTxUpdate, select: mockTxSelect })
  );

  const mockSendSms = vi.fn();
  const mockRefund = vi.fn();

  return {
    selectQueue,
    mockDbSelect,
    txReturningQueue,
    mockTxUpdate,
    mockTxSet,
    mockTxWhere,
    mockTxReturning,
    mockTransaction,
    mockSendSms,
    txSelectQueue,
    mockTxFor,
    mockRefund,
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
  inArray: vi.fn((...args: unknown[]) => ({ type: "inArray", args })),
}));

vi.mock("@/lib/refund", () => ({
  processAutomaticRefund: (...args: unknown[]) => mockRefund(...args),
}));

vi.mock("@/lib/schema", () => ({
  depositPayments: {
    id: "depositPayments.id",
    status: "depositPayments.status",
    appointmentId: "depositPayments.appointmentId",
  },
  appointments: { id: "appointments.id", status: "appointments.status" },
  clients: { id: "clients.id" },
  services: { id: "services.id" },
  employees: { id: "employees.id" },
}));

vi.mock("@/lib/sms", () => ({
  sendPaymentConfirmationSms: (...args: unknown[]) => mockSendSms(...args),
}));

import { confirmDepositPayment } from "@/lib/deposit-confirmation";
import { logger } from "@/lib/logger";

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
    txSelectQueue.length = 0;
    mockSendSms.mockResolvedValue({ success: true });
    mockRefund.mockResolvedValue({ success: true, refunded: true, refundId: "re_1", amount: 50, message: "ok" });
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

  it.each(["refunded"])(
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

  const REFUND_THIS_PAYMENT = { depositPaymentId: "dp-1", resetAppointmentDepositPaid: false };
  const failedPayment = { ...pendingPayment, status: "failed" };
  // where() update'u platnosci: and(eq(id), eq(status, X)) => X
  const statusGuard = (call: number) =>
    (mockTxWhere.mock.calls[call]![0] as { args: { args: unknown[] }[] }).args[1]!.args[1];

  it.each(["cancelled", "completed", "no_show"])(
    "#70: wizyta %s + pozna wplata => platnosc succeeded, wizyta nietykana, bez SMS, zwrot TEJ platnosci",
    async (status) => {
      queueSelect([pendingPayment]);
      txSelectQueue.push([{ id: "appt-1", status, depositPaid: false }]);
      txReturningQueue.push([updatedPayment]);

      const result = await confirmDepositPayment("dp-1", { paymentIntentId: "pi_late", stripePaymentStatus: "paid" });

      expect(result).toEqual({
        success: true,
        alreadyConfirmed: false,
        smsSent: false,
        depositPayment: updatedPayment,
        inactiveAppointment: { appointmentStatus: status, reason: "appointment_inactive", refunded: true, refundId: "re_1" },
      });
      // tylko update platnosci (succeeded + pi_), wizyta bez zapisu (status i depositPaid)
      expect(mockTxUpdate).toHaveBeenCalledTimes(1);
      expect(mockTxSet.mock.calls[0]![0]).toMatchObject({ status: "succeeded", stripePaymentIntentId: "pi_late" });
      expect(mockTxFor).toHaveBeenCalledWith("update");
      expect(mockRefund).toHaveBeenCalledWith("appt-1", expect.stringContaining("po anulowaniu"), REFUND_THIS_PAYMENT);
      expect(mockSendSms).not.toHaveBeenCalled();
      expect(logger.error).not.toHaveBeenCalled();
    }
  );

  it("#70 wyscig wygrany przez cron: failed + payment_status paid => warunkowy UPDATE WHERE status='failed', succeeded i zwrot", async () => {
    queueSelect([failedPayment]);
    txReturningQueue.push([], [updatedPayment]); // guard 'pending' 0 wierszy, guard 'failed' 1 wiersz
    txSelectQueue.push([{ id: "appt-1", status: "cancelled", depositPaid: false }]);

    const result = await confirmDepositPayment("dp-1", { paymentIntentId: "pi_late", stripePaymentStatus: "paid" });

    expect(result.success).toBe(true);
    expect(result.depositPayment).toEqual(updatedPayment);
    expect(result.inactiveAppointment).toMatchObject({ appointmentStatus: "cancelled", refunded: true });
    expect(mockTxUpdate).toHaveBeenCalledTimes(2);
    expect(statusGuard(0)).toBe("pending");
    expect(statusGuard(1)).toBe("failed");
    // odczyt wizyty w TEJ samej transakcji, po update'cie platnosci
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(mockTxFor).toHaveBeenCalledWith("update");
    expect(mockRefund).toHaveBeenCalledTimes(1);
    expect(mockRefund).toHaveBeenCalledWith("appt-1", expect.any(String), REFUND_THIS_PAYMENT);
  });

  it("#70 powtorzony webhook => dokladnie jeden zwrot (drugi widzi succeeded)", async () => {
    queueSelect([failedPayment]);
    txReturningQueue.push([], [updatedPayment]);
    txSelectQueue.push([{ id: "appt-1", status: "cancelled", depositPaid: false }]);
    await confirmDepositPayment("dp-1", { paymentIntentId: "pi_late", stripePaymentStatus: "paid" });

    queueSelect([updatedPayment]);
    const second = await confirmDepositPayment("dp-1", { paymentIntentId: "pi_late", stripePaymentStatus: "paid" });

    expect(second).toMatchObject({ success: true, alreadyConfirmed: true, smsSent: false });
    expect(mockRefund).toHaveBeenCalledTimes(1);
    expect(mockTransaction).toHaveBeenCalledTimes(1);
  });

  it("#70 wyscig w transakcji: guard 0 wierszy, ponowny odczyt succeeded => alreadyConfirmed, bez zwrotu", async () => {
    queueSelect([failedPayment], [updatedPayment]);
    txReturningQueue.push([], []); // konkurencyjny webhook potwierdzil miedzy odczytem a update'em

    const result = await confirmDepositPayment("dp-1", { stripePaymentStatus: "paid" });

    expect(result).toMatchObject({ success: true, alreadyConfirmed: true, smsSent: false });
    expect(mockTxFor).not.toHaveBeenCalled();
    expect(mockRefund).not.toHaveBeenCalled();
  });

  it("failed bez payment_status paid (dev-symulator) => not_pending, zero zapisow", async () => {
    queueSelect([failedPayment]);

    const result = await confirmDepositPayment("dp-1", { paymentIntentId: "cs_test_1" });

    expect(result).toMatchObject({ success: false, error: "not_pending" });
    expect(mockTransaction).not.toHaveBeenCalled();
    expect(mockRefund).not.toHaveBeenCalled();
  });

  it.each(["unpaid", "no_payment_required"])("failed + payment_status %s => not_pending", async (paymentStatus) => {
    queueSelect([failedPayment]);
    const result = await confirmDepositPayment("dp-1", { stripePaymentStatus: paymentStatus });
    expect(result).toMatchObject({ success: false, error: "not_pending" });
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("refunded jest koncowe, takze z payment_status paid", async () => {
    queueSelect([{ ...pendingPayment, status: "refunded" }]);
    const result = await confirmDepositPayment("dp-1", { stripePaymentStatus: "paid" });
    expect(result).toMatchObject({ success: false, error: "not_pending" });
    expect(mockTransaction).not.toHaveBeenCalled();
    expect(mockRefund).not.toHaveBeenCalled();
  });

  it("#70 failed + wizyta wciaz scheduled => potwierdzenie wizyty i SMS, nie zwrot", async () => {
    queueSelect([failedPayment], [], [{ firstName: "Ewa", lastName: "Nowak" }], []);
    txReturningQueue.push([], [updatedPayment], [{ ...confirmedAppointment, clientId: null, guestPhone: "+48600700800" }]);
    txSelectQueue.push([{ id: "appt-1", status: "scheduled", depositPaid: false }]);

    const result = await confirmDepositPayment("dp-1", { paymentIntentId: "pi_1", stripePaymentStatus: "paid" });

    expect(result.success).toBe(true);
    expect(result.inactiveAppointment).toBeUndefined();
    expect(statusGuard(1)).toBe("failed");
    expect(mockTxSet.mock.calls[2]![0]).toMatchObject({ depositPaid: true, status: "confirmed" });
    expect(mockRefund).not.toHaveBeenCalled();
    expect(mockSendSms).toHaveBeenCalledTimes(1);
  });

  it("#70: nieudany zwrot => logger.error 'manual refund' z id, platnosc zostaje succeeded, wizyta nietykana", async () => {
    queueSelect([pendingPayment]);
    txSelectQueue.push([{ id: "appt-1", status: "cancelled", depositPaid: false }]);
    txReturningQueue.push([updatedPayment]);
    mockRefund.mockResolvedValueOnce({ success: false, refunded: false, message: "Zwrot Stripe nie powiodl sie" });

    const result = await confirmDepositPayment("dp-1", { paymentIntentId: "pi_late", stripePaymentStatus: "paid" });

    expect(result.success).toBe(true);
    expect(result.depositPayment?.status).toBe("succeeded");
    expect(result.inactiveAppointment).toEqual({
      appointmentStatus: "cancelled",
      reason: "appointment_inactive",
      refunded: false,
      refundId: undefined,
    });
    expect(mockTxUpdate).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      "Deposit paid for cancelled appointment — manual refund",
      { depositPaymentId: "dp-1", appointmentId: "appt-1", salonId: "salon-1", appointmentStatus: "cancelled", reason: "appointment_inactive" }
    );
    expect(mockSendSms).not.toHaveBeenCalled();
  });

  it("wizyta confirmed (potwierdzona recznie przed wplata) => depositPaid=true, zostaje confirmed, bez zwrotu i bez SMS", async () => {
    queueSelect([pendingPayment]);
    txSelectQueue.push([{ id: "appt-1", status: "confirmed", depositPaid: false }]);
    txReturningQueue.push([updatedPayment], [{ ...confirmedAppointment, clientId: null, guestPhone: "+48600700800" }]);

    const result = await confirmDepositPayment("dp-1");

    expect(result).toMatchObject({ success: true, alreadyConfirmed: false, smsSent: false });
    expect(result.inactiveAppointment).toBeUndefined();
    expect(mockTxSet.mock.calls[1]![0]).toMatchObject({ depositPaid: true, status: "confirmed" });
    expect(mockRefund).not.toHaveBeenCalled();
    expect(mockSendSms).not.toHaveBeenCalled();
  });

  it.each(["scheduled", "confirmed"])(
    "wizyta %s z depositPaid=true z innej platnosci => zwrot drugiej platnosci, wizyta bez zapisu, bez SMS",
    async (status) => {
      queueSelect([pendingPayment]);
      txSelectQueue.push([{ id: "appt-1", status, depositPaid: true }]);
      txReturningQueue.push([updatedPayment]);

      const result = await confirmDepositPayment("dp-1", { paymentIntentId: "pi_2", stripePaymentStatus: "paid" });

      expect(result).toMatchObject({ success: true, alreadyConfirmed: false, smsSent: false });
      expect(result.inactiveAppointment).toEqual({
        appointmentStatus: status,
        reason: "deposit_already_paid",
        refunded: true,
        refundId: "re_1",
      });
      expect(mockTxUpdate).toHaveBeenCalledTimes(1);
      expect(mockRefund).toHaveBeenCalledWith("appt-1", expect.stringContaining("Druga wplata"), REFUND_THIS_PAYMENT);
      expect(mockSendSms).not.toHaveBeenCalled();
    }
  );

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

  it("przegrany wyscig: guard 0 wierszy, ponowny odczyt succeeded => alreadyConfirmed, wizyta nietykana", async () => {
    queueSelect([pendingPayment], [updatedPayment]);
    txReturningQueue.push([]); // konkurencyjny webhook juz potwierdzil

    const result = await confirmDepositPayment("dp-1");
    expect(result).toMatchObject({ success: true, alreadyConfirmed: true, smsSent: false });
    // Tylko jeden tx.update (platnosc; bez payment_status paid brak guardu 'failed')
    expect(mockTxUpdate).toHaveBeenCalledTimes(1);
    expect(mockSendSms).not.toHaveBeenCalled();
  });

  it("przegrany wyscig z anulowaniem bez potwierdzonej wplaty: ponowny odczyt failed => not_pending", async () => {
    queueSelect([pendingPayment], [failedPayment]);
    txReturningQueue.push([]);

    const result = await confirmDepositPayment("dp-1");
    expect(result).toMatchObject({ success: false, error: "not_pending", depositPayment: failedPayment });
    expect(mockRefund).not.toHaveBeenCalled();
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
