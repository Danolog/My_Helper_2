import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * refund.ts — decyzja Ethana (#98):
 *   - processAutomaticRefund zwraca JEDNĄ wskazaną płatność (id + wizyta +
 *     status 'succeeded'), klucz idempotencji deposit-refund:<id>;
 *   - Stripe bez klienta / bez PaymentIntentu / błąd => płatność zostaje
 *     'succeeded', logger.error „manual refund”, refunded=false;
 *   - cs_… => checkout.sessions.retrieve(...).payment_intent (z limitem czasu);
 *   - zapis 'refunded' warunkowy (WHERE status='succeeded'), liczba wierszy
 *     sprawdzana;
 *   - treść błędu Stripe nie wychodzi w wyniku (tylko kod);
 *   - refundAppointmentDeposits: każda 'succeeded' od najstarszej, forfeit
 *     tylko najstarszej, depositPaid=false tylko gdy wszystkie zwroty OK.
 */
const {
  mockStripeRefundsCreate,
  mockSessionsRetrieve,
  stripeState,
  selectQueue,
  mockDbSelectWhere,
  mockOrderBy,
  updateReturningQueue,
  mockDbUpdateWhere,
  mockDbUpdateSet,
  mockDbUpdateTable,
  mockDbSelect,
} = vi.hoisted(() => {
  const mockStripeRefundsCreate = vi.fn();
  const mockSessionsRetrieve = vi.fn();
  const stripeState = { configured: true };

  // db.select().from().where() [.orderBy()] — wyniki z kolejki (FIFO);
  // element kolejki typu Error => odrzucenie.
  const selectQueue: unknown[] = [];
  const mockOrderBy = vi.fn();
  const next = () => {
    const rows = selectQueue.length > 0 ? selectQueue.shift()! : [];
    return rows instanceof Error ? Promise.reject(rows) : Promise.resolve(rows);
  };
  const mockDbSelectWhere = vi.fn((..._args: unknown[]) => ({
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => next().then(res, rej),
    orderBy: (...a: unknown[]) => {
      mockOrderBy(...a);
      return next();
    },
  }));
  const mockDbSelectFrom = vi.fn(() => ({ where: mockDbSelectWhere }));
  const mockDbSelect = vi.fn(() => ({ from: mockDbSelectFrom }));

  // db.update().set().where() [.returning()] — returning z kolejki, domyślnie 1 wiersz
  const updateReturningQueue: unknown[][] = [];
  const mockDbUpdateWhere = vi.fn((..._args: unknown[]) => ({
    then: (res: (v: unknown) => unknown) => Promise.resolve(undefined).then(res),
    returning: () =>
      Promise.resolve(updateReturningQueue.length > 0 ? updateReturningQueue.shift()! : [{ id: "x" }]),
  }));
  const mockDbUpdateSet = vi.fn((..._args: unknown[]) => ({ where: mockDbUpdateWhere }));
  const mockDbUpdateTable = vi.fn((..._args: unknown[]) => ({ set: mockDbUpdateSet }));

  return {
    mockStripeRefundsCreate,
    mockSessionsRetrieve,
    stripeState,
    selectQueue,
    mockDbSelectWhere,
    mockOrderBy,
    updateReturningQueue,
    mockDbUpdateWhere,
    mockDbUpdateSet,
    mockDbUpdateTable,
    mockDbSelect,
  };
});

vi.mock("@/lib/stripe", () => ({
  getStripe: vi.fn(() =>
    stripeState.configured
      ? {
          refunds: { create: (...args: unknown[]) => mockStripeRefundsCreate(...args) },
          checkout: { sessions: { retrieve: (...args: unknown[]) => mockSessionsRetrieve(...args) } },
        }
      : null
  ),
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: (...args: unknown[]) => mockDbSelect(...(args as [])),
    update: (...args: unknown[]) => mockDbUpdateTable(...args),
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: unknown[]) => ({ type: "eq", args })),
  and: vi.fn((...args: unknown[]) => ({ type: "and", args })),
  asc: vi.fn((col: unknown) => ({ type: "asc", col })),
}));

vi.mock("@/lib/schema", () => ({
  depositPayments: {
    appointmentId: "depositPayments.appointmentId",
    id: "depositPayments.id",
    status: "depositPayments.status",
    paidAt: "depositPayments.paidAt",
  },
  appointments: {
    id: "appointments.id",
  },
}));

import { logger } from "@/lib/logger";
import { processAutomaticRefund, refundAppointmentDeposits } from "@/lib/refund";

const eqArgs = (col: string, val: unknown) => ({ type: "eq", args: [col, val] });

function payment(over: Record<string, unknown> = {}) {
  return {
    id: "pay-1",
    appointmentId: "appt-1",
    salonId: "salon-1",
    status: "succeeded",
    amount: "50.00",
    stripePaymentIntentId: "pi_1",
    paymentMethod: "stripe",
    ...over,
  };
}

/** Wywołania set(...) na tabeli płatności w kolejności. */
const paymentSets = () =>
  mockDbUpdateTable.mock.calls
    .map((c, i) => ({ table: c[0], set: mockDbUpdateSet.mock.calls[i]![0] as Record<string, unknown>, where: mockDbUpdateWhere.mock.calls[i]![0] }))
    .filter((c) => c.table !== undefined && (c.table as { id?: string }).id === "depositPayments.id");
const appointmentSets = () =>
  mockDbUpdateTable.mock.calls
    .map((c, i) => ({ table: c[0], set: mockDbUpdateSet.mock.calls[i]![0] as Record<string, unknown> }))
    .filter((c) => (c.table as { id?: string }).id === "appointments.id");

function resetAll() {
  vi.clearAllMocks();
  selectQueue.length = 0;
  updateReturningQueue.length = 0;
  stripeState.configured = true;
}

describe("processAutomaticRefund — jedna wskazana płatność", () => {
  beforeEach(resetAll);

  it("szuka płatności po id + wizycie + status 'succeeded' (obrona przed złym wierszem)", async () => {
    selectQueue.push([]);
    const result = await processAutomaticRefund("appt-1", "pay-1", "powod");

    expect(result).toEqual({ success: true, refunded: false, message: "Brak zadatku do zwrotu" });
    expect(mockDbSelectWhere.mock.calls[0]![0]).toEqual({
      type: "and",
      args: [
        eqArgs("depositPayments.id", "pay-1"),
        eqArgs("depositPayments.appointmentId", "appt-1"),
        eqArgs("depositPayments.status", "succeeded"),
      ],
    });
    expect(mockStripeRefundsCreate).not.toHaveBeenCalled();
    expect(mockDbUpdateTable).not.toHaveBeenCalled();
  });

  it("kwota 0 => bez zwrotu", async () => {
    selectQueue.push([payment({ amount: "0.00" })]);
    const result = await processAutomaticRefund("appt-1", "pay-1", "powod");
    expect(result.refunded).toBe(false);
    expect(mockStripeRefundsCreate).not.toHaveBeenCalled();
  });

  it("Stripe: zwrot z kluczem deposit-refund:<id> i limitem czasu, zapis refunded warunkowy, bez ruszania wizyty", async () => {
    selectQueue.push([payment()]);
    mockStripeRefundsCreate.mockResolvedValue({ id: "re_1" });

    const result = await processAutomaticRefund("appt-1", "pay-1", "powod");

    expect(result).toMatchObject({ success: true, refunded: true, refundId: "re_1", amount: 50 });
    expect(mockStripeRefundsCreate).toHaveBeenCalledWith(
      { payment_intent: "pi_1", amount: 5000, reason: "requested_by_customer" },
      { idempotencyKey: "deposit-refund:pay-1", timeout: 5000 }
    );
    expect(mockDbUpdateTable).toHaveBeenCalledTimes(1);
    expect(mockDbUpdateSet.mock.calls[0]![0]).toMatchObject({ status: "refunded", stripeRefundId: "re_1", refundReason: "powod" });
    expect(mockDbUpdateWhere.mock.calls[0]![0]).toEqual({
      type: "and",
      args: [eqArgs("depositPayments.id", "pay-1"), eqArgs("depositPayments.status", "succeeded")],
    });
  });

  it("(b) zapis refunded zmienił 0 wierszy => manual refund, refunded=false", async () => {
    selectQueue.push([payment()]);
    mockStripeRefundsCreate.mockResolvedValue({ id: "re_1" });
    updateReturningQueue.push([]);

    const result = await processAutomaticRefund("appt-1", "pay-1", "powod");

    expect(result).toMatchObject({ success: false, refunded: false, error: "payment_changed_concurrently" });
    expect(logger.error).toHaveBeenCalledWith(
      "Deposit refund failed — manual refund",
      expect.objectContaining({ depositPaymentId: "pay-1", appointmentId: "appt-1", salonId: "salon-1" })
    );
  });

  it("(a) brak klienta Stripe dla płatności Stripe => zostaje succeeded, manual refund, refunded=false", async () => {
    stripeState.configured = false;
    selectQueue.push([payment()]);

    const result = await processAutomaticRefund("appt-1", "pay-1", "powod");

    expect(result).toMatchObject({ success: false, refunded: false, error: "stripe_not_configured" });
    expect(mockDbUpdateTable).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      "Deposit refund failed — manual refund",
      { depositPaymentId: "pay-1", appointmentId: "appt-1", salonId: "salon-1", error: "stripe_not_configured" }
    );
  });

  it("płatność Stripe bez referencji => manual refund, bez zapisu", async () => {
    selectQueue.push([payment({ stripePaymentIntentId: null })]);
    const result = await processAutomaticRefund("appt-1", "pay-1", "powod");
    expect(result).toMatchObject({ refunded: false, error: "missing_payment_intent" });
    expect(mockDbUpdateTable).not.toHaveBeenCalled();
  });

  it("cs_… => najpierw sessions.retrieve z limitem czasu, zwrot na payment_intent sesji", async () => {
    selectQueue.push([payment({ stripePaymentIntentId: "cs_test_1" })]);
    mockSessionsRetrieve.mockResolvedValue({ payment_intent: "pi_from_session" });
    mockStripeRefundsCreate.mockResolvedValue({ id: "re_9" });

    const result = await processAutomaticRefund("appt-1", "pay-1", "powod");

    expect(mockSessionsRetrieve).toHaveBeenCalledWith("cs_test_1", {}, { timeout: 5000 });
    expect(mockStripeRefundsCreate.mock.calls[0]![0]).toMatchObject({ payment_intent: "pi_from_session" });
    expect(result.refunded).toBe(true);
  });

  it("cs_… bez payment_intent (lub obiekt bez pi_) => manual refund", async () => {
    selectQueue.push([payment({ stripePaymentIntentId: "cs_test_1" })]);
    mockSessionsRetrieve.mockResolvedValue({ payment_intent: null });

    const result = await processAutomaticRefund("appt-1", "pay-1", "powod");

    expect(result).toMatchObject({ refunded: false, error: "payment_intent_unresolved" });
    expect(mockStripeRefundsCreate).not.toHaveBeenCalled();
    expect(mockDbUpdateTable).not.toHaveBeenCalled();
  });

  it("cs_… z rozwiniętym payment_intent => używa jego id", async () => {
    selectQueue.push([payment({ stripePaymentIntentId: "cs_test_1" })]);
    mockSessionsRetrieve.mockResolvedValue({ payment_intent: { id: "pi_obj" } });
    mockStripeRefundsCreate.mockResolvedValue({ id: "re_9" });
    await processAutomaticRefund("appt-1", "pay-1", "powod");
    expect(mockStripeRefundsCreate.mock.calls[0]![0]).toMatchObject({ payment_intent: "pi_obj" });
  });

  it("błąd Stripe => zostaje succeeded, manual refund, treść błędu NIE wychodzi w wyniku", async () => {
    selectQueue.push([payment()]);
    mockStripeRefundsCreate.mockRejectedValue(
      Object.assign(new Error("No such payment_intent: pi_1 for jan@example.com"), { type: "StripeInvalidRequestError", code: "resource_missing" })
    );

    const result = await processAutomaticRefund("appt-1", "pay-1", "powod");

    expect(result).toMatchObject({ success: false, refunded: false, error: "stripe_refund_failed" });
    expect(JSON.stringify(result)).not.toContain("No such payment_intent");
    expect(mockDbUpdateTable).not.toHaveBeenCalled();
    const logged = vi.mocked(logger.error).mock.calls[0]!;
    expect(logged[0]).toBe("Deposit refund failed — manual refund");
    expect(logged[1]).toMatchObject({ stripeErrorType: "StripeInvalidRequestError", stripeErrorCode: "resource_missing" });
    expect(JSON.stringify(logged[1])).not.toContain("jan@example.com");
  });

  it("timeout sessions.retrieve => manual refund (stripe_refund_failed)", async () => {
    selectQueue.push([payment({ stripePaymentIntentId: "cs_test_1" })]);
    mockSessionsRetrieve.mockRejectedValue(Object.assign(new Error("timeout"), { type: "StripeConnectionError" }));
    const result = await processAutomaticRefund("appt-1", "pay-1", "powod");
    expect(result).toMatchObject({ refunded: false, error: "stripe_refund_failed" });
    expect(mockDbUpdateTable).not.toHaveBeenCalled();
  });

  it("metoda spoza Stripe (blik) => refunded (zwrot ręczny w salonie), refundId manual_", async () => {
    selectQueue.push([payment({ paymentMethod: "blik", stripePaymentIntentId: null, amount: "10.00" })]);
    const result = await processAutomaticRefund("appt-1", "pay-1", "Custom refund reason");
    expect(result).toMatchObject({ success: true, refunded: true, refundId: "manual_pay-1", amount: 10 });
    expect(mockStripeRefundsCreate).not.toHaveBeenCalled();
    expect(mockDbUpdateSet).toHaveBeenCalledWith(expect.objectContaining({ refundReason: "Custom refund reason" }));
  });

  it("wyjątek bazy => success=false, kod refund_error, bez treści błędu", async () => {
    selectQueue.push(new Error("DB connection failed postgres://user:secret@host"));
    const result = await processAutomaticRefund("appt-1", "pay-1", "powod");
    expect(result).toMatchObject({ success: false, refunded: false, error: "refund_error" });
    expect(JSON.stringify(result)).not.toContain("secret");
  });
});

describe("refundAppointmentDeposits — wszystkie 'succeeded' wizyty", () => {
  beforeEach(resetAll);

  /** Kolejka select: lista płatności wizyty, potem odczyt każdej w processAutomaticRefund. */
  function queuePayments(...rows: ReturnType<typeof payment>[]) {
    selectQueue.push(rows, ...rows.map((r) => [r]));
  }

  it("lista: wizyta + status 'succeeded', od najstarszej (paid_at, id)", async () => {
    selectQueue.push([]);
    const result = await refundAppointmentDeposits("appt-1", "powod");
    expect(result).toMatchObject({ success: true, refunded: false, paymentCount: 0 });
    expect(mockDbSelectWhere.mock.calls[0]![0]).toEqual({
      type: "and",
      args: [eqArgs("depositPayments.appointmentId", "appt-1"), eqArgs("depositPayments.status", "succeeded")],
    });
    expect(mockOrderBy).toHaveBeenCalledWith({ type: "asc", col: "depositPayments.paidAt" }, { type: "asc", col: "depositPayments.id" });
    expect(appointmentSets()).toHaveLength(0);
  });

  it("1 płatność => zwrot, depositPaid=false", async () => {
    queuePayments(payment());
    mockStripeRefundsCreate.mockResolvedValue({ id: "re_1" });

    const result = await refundAppointmentDeposits("appt-1", "powod");

    expect(result).toMatchObject({ success: true, refunded: true, amount: 50, refundId: "re_1", paymentCount: 1 });
    expect(mockStripeRefundsCreate).toHaveBeenCalledTimes(1);
    expect(appointmentSets()).toEqual([expect.objectContaining({ set: { depositPaid: false } })]);
  });

  it("2 płatności => obie zwrócone, 2 różne klucze idempotencji, depositPaid=false", async () => {
    queuePayments(payment(), payment({ id: "pay-2", stripePaymentIntentId: "pi_2" }));
    mockStripeRefundsCreate.mockResolvedValueOnce({ id: "re_1" }).mockResolvedValueOnce({ id: "re_2" });

    const result = await refundAppointmentDeposits("appt-1", "powod");

    expect(result).toMatchObject({ success: true, refunded: true, amount: 100, paymentCount: 2 });
    const keys = mockStripeRefundsCreate.mock.calls.map((c) => (c[1] as { idempotencyKey: string }).idempotencyKey);
    expect(keys).toEqual(["deposit-refund:pay-1", "deposit-refund:pay-2"]);
    expect(new Set(keys).size).toBe(2);
    expect(paymentSets().map((c) => c.set.status)).toEqual(["refunded", "refunded"]);
    expect(appointmentSets()).toHaveLength(1);
  });

  it("2 płatności, druga z błędem Stripe => jedna refunded, druga succeeded + manual refund, depositPaid zostaje true", async () => {
    queuePayments(payment(), payment({ id: "pay-2", stripePaymentIntentId: "pi_2" }));
    mockStripeRefundsCreate.mockResolvedValueOnce({ id: "re_1" }).mockRejectedValueOnce(new Error("card_declined"));

    const result = await refundAppointmentDeposits("appt-1", "powod");

    expect(result).toMatchObject({ success: false, refunded: false, amount: 50, failedAmount: 50, error: "stripe_refund_failed" });
    expect(result.results.map((r) => [r.depositPaymentId, r.refunded])).toEqual([
      ["pay-1", true],
      ["pay-2", false],
    ]);
    // tylko pay-1 zapisana jako refunded; pay-2 bez zapisu (zostaje succeeded)
    expect(paymentSets()).toHaveLength(1);
    expect(mockDbUpdateWhere.mock.calls[0]![0]).toMatchObject({ args: [eqArgs("depositPayments.id", "pay-1"), expect.anything()] });
    expect(logger.error).toHaveBeenCalledWith(
      "Deposit refund failed — manual refund",
      expect.objectContaining({ depositPaymentId: "pay-2", appointmentId: "appt-1", salonId: "salon-1" })
    );
    expect(appointmentSets()).toHaveLength(0);
  });

  it("failedAmount (Leo, #98): pełna porażka 1 × 50 => 50; częściowa 2 × 25 => 25", async () => {
    queuePayments(payment());
    mockStripeRefundsCreate.mockRejectedValueOnce(new Error("boom"));
    const full = await refundAppointmentDeposits("appt-1", "powod");
    expect(full).toMatchObject({ success: false, amount: 0, failedAmount: 50 });

    resetAll();
    queuePayments(payment({ amount: "25.00" }), payment({ id: "pay-2", amount: "25.00", stripePaymentIntentId: "pi_2" }));
    mockStripeRefundsCreate.mockResolvedValueOnce({ id: "re_1" }).mockRejectedValueOnce(new Error("boom"));
    const partial = await refundAppointmentDeposits("appt-1", "powod");
    expect(partial).toMatchObject({ success: false, amount: 25, failedAmount: 25 });
  });

  it("forfeit z 2 płatnościami => najstarsza forfeited (warunkowo), druga zwrócona, depositPaid bez zmian", async () => {
    selectQueue.push([payment(), payment({ id: "pay-2", stripePaymentIntentId: "pi_2" })], [payment({ id: "pay-2", stripePaymentIntentId: "pi_2" })]);
    mockStripeRefundsCreate.mockResolvedValue({ id: "re_2" });

    const result = await refundAppointmentDeposits("appt-1", "zwrot dodatkowej", { forfeitReason: "zatrzymany" });

    expect(result).toMatchObject({ success: true, refunded: true, forfeitedPaymentId: "pay-1", amount: 50 });
    expect(paymentSets()[0]).toMatchObject({
      set: { status: "forfeited", refundReason: "zatrzymany" },
      where: { type: "and", args: [eqArgs("depositPayments.id", "pay-1"), eqArgs("depositPayments.status", "succeeded")] },
    });
    expect(paymentSets()[1]!.set).toMatchObject({ status: "refunded" });
    expect(mockStripeRefundsCreate).toHaveBeenCalledTimes(1);
    expect(mockStripeRefundsCreate.mock.calls[0]![1]).toMatchObject({ idempotencyKey: "deposit-refund:pay-2" });
    expect(appointmentSets()).toHaveLength(0);
  });

  it("forfeit z 1 płatnością => zatrzymana, bez zwrotu", async () => {
    selectQueue.push([payment()]);
    const result = await refundAppointmentDeposits("appt-1", "x", { forfeitReason: "zatrzymany" });
    expect(result).toMatchObject({ success: true, refunded: false, forfeitedPaymentId: "pay-1", results: [] });
    expect(mockStripeRefundsCreate).not.toHaveBeenCalled();
    expect(appointmentSets()).toHaveLength(0);
  });

  it("błąd odczytu listy => success=false, kod, bez zwrotów", async () => {
    selectQueue.push(new Error("db down"));
    const result = await refundAppointmentDeposits("appt-1", "powod");
    expect(result).toMatchObject({ success: false, refunded: false, error: "refund_error" });
    expect(mockStripeRefundsCreate).not.toHaveBeenCalled();
  });
});
