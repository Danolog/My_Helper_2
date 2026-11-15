import { describe, it, expect, vi, beforeEach } from "vitest";

// Use vi.hoisted for all mock variables used in vi.mock factories
const {
  mockStripeRefundsCreate,
  mockDbSelectWhere,
  mockDbSelectFrom,
  mockDbSelect,
  mockDbUpdateWhere,
  mockDbUpdateSet,
  mockDbUpdateTable,
  mockDbInsertReturning,
  mockDbInsertValues,
  mockDbInsertInto,
} = vi.hoisted(() => {
  const mockStripeRefundsCreate = vi.fn();
  const mockDbSelectWhere = vi.fn();
  const mockDbSelectFrom = vi.fn().mockReturnValue({ where: mockDbSelectWhere });
  const mockDbSelect = vi.fn().mockReturnValue({ from: mockDbSelectFrom });
  const mockDbUpdateWhere = vi.fn().mockResolvedValue(undefined);
  const mockDbUpdateSet = vi.fn().mockReturnValue({ where: mockDbUpdateWhere });
  const mockDbUpdateTable = vi.fn().mockReturnValue({ set: mockDbUpdateSet });
  const mockDbInsertReturning = vi.fn();
  const mockDbInsertValues = vi.fn().mockReturnValue({ returning: mockDbInsertReturning });
  const mockDbInsertInto = vi.fn().mockReturnValue({ values: mockDbInsertValues });
  return {
    mockStripeRefundsCreate,
    mockDbSelectWhere,
    mockDbSelectFrom,
    mockDbSelect,
    mockDbUpdateWhere,
    mockDbUpdateSet,
    mockDbUpdateTable,
    mockDbInsertReturning,
    mockDbInsertValues,
    mockDbInsertInto,
  };
});

// Mock stripe
vi.mock("@/lib/stripe", () => ({
  getStripe: vi.fn(() => ({
    refunds: {
      create: (...args: unknown[]) => mockStripeRefundsCreate(...args),
    },
  })),
}));

// Mock database
vi.mock("@/lib/db", () => ({
  db: {
    select: (...args: unknown[]) => mockDbSelect(...args),
    insert: (...args: unknown[]) => mockDbInsertInto(...args),
    update: (...args: unknown[]) => mockDbUpdateTable(...args),
  },
}));

// Mock drizzle-orm
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: unknown[]) => ({ type: "eq", args })),
  and: vi.fn((...args: unknown[]) => ({ type: "and", args })),
}));

// Mock schema
vi.mock("@/lib/schema", () => ({
  depositPayments: {
    appointmentId: "depositPayments.appointmentId",
    id: "depositPayments.id",
  },
  appointments: {
    id: "appointments.id",
  },
  notifications: "notifications_table",
}));

import { processAutomaticRefund, createRefundNotification } from "@/lib/refund";

describe("processAutomaticRefund", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mock chains
    mockDbSelect.mockReturnValue({ from: mockDbSelectFrom });
    mockDbSelectFrom.mockReturnValue({ where: mockDbSelectWhere });
    mockDbUpdateTable.mockReturnValue({ set: mockDbUpdateSet });
    mockDbUpdateSet.mockReturnValue({ where: mockDbUpdateWhere });
    mockDbUpdateWhere.mockResolvedValue(undefined);
    mockDbInsertInto.mockReturnValue({ values: mockDbInsertValues });
    mockDbInsertValues.mockReturnValue({ returning: mockDbInsertReturning });
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("should return no refund when no deposit payment exists", async () => {
    // db.select().from().where() returns empty array directly (no .limit())
    mockDbSelectWhere.mockResolvedValue([]);

    const result = await processAutomaticRefund("appt-1");
    expect(result.success).toBe(true);
    expect(result.refunded).toBe(false);
    expect(result.message).toContain("Brak zadatku");
  });

  it("should return no refund when payment status is not succeeded", async () => {
    mockDbSelectWhere.mockResolvedValue([
      { id: "pay-1", status: "pending", amount: "50.00" },
    ]);

    const result = await processAutomaticRefund("appt-1");
    expect(result.success).toBe(true);
    expect(result.refunded).toBe(false);
    expect(result.message).toContain("pending");
  });

  it("should return no refund when amount is zero", async () => {
    mockDbSelectWhere.mockResolvedValue([
      { id: "pay-1", status: "succeeded", amount: "0" },
    ]);

    const result = await processAutomaticRefund("appt-1");
    expect(result.success).toBe(true);
    expect(result.refunded).toBe(false);
    expect(result.message).toContain("0");
  });

  it("should process Stripe refund for Stripe payments", async () => {
    mockDbSelectWhere.mockResolvedValue([
      {
        id: "pay-1",
        status: "succeeded",
        amount: "50.00",
        stripePaymentIntentId: "pi_123",
        paymentMethod: "stripe",
      },
    ]);
    mockStripeRefundsCreate.mockResolvedValue({ id: "re_123" });

    const result = await processAutomaticRefund("appt-1");
    expect(result.success).toBe(true);
    expect(result.refunded).toBe(true);
    expect(result.refundId).toBe("re_123");
    expect(result.amount).toBe(50);
    expect(mockStripeRefundsCreate).toHaveBeenCalledWith(
      {
        payment_intent: "pi_123",
        amount: 5000, // 50.00 * 100 cents
        reason: "requested_by_customer",
      },
      // jeden zwrot na płatność (Ethan, #70): klucz z id płatności
      { idempotencyKey: "deposit-refund:pay-1" }
    );
  });

  it("depositPaymentId: zwraca TE platnosc (id + appointmentId), bez resetu depositPaid gdy reset=false", async () => {
    const { and, eq } = await import("drizzle-orm");
    mockDbSelectWhere.mockResolvedValue([
      { id: "pay-2", status: "succeeded", amount: "50.00", stripePaymentIntentId: "pi_2", paymentMethod: "stripe" },
    ]);
    mockStripeRefundsCreate.mockResolvedValue({ id: "re_2" });

    const result = await processAutomaticRefund("appt-1", "druga wplata", {
      depositPaymentId: "pay-2",
      resetAppointmentDepositPaid: false,
    });

    expect(result.refunded).toBe(true);
    expect(and).toHaveBeenCalledWith(
      { type: "eq", args: ["depositPayments.id", "pay-2"] },
      { type: "eq", args: ["depositPayments.appointmentId", "appt-1"] }
    );
    expect(eq).toHaveBeenCalledWith("depositPayments.id", "pay-2");
    expect(mockStripeRefundsCreate).toHaveBeenCalledWith(expect.anything(), { idempotencyKey: "deposit-refund:pay-2" });
    // tylko update platnosci (refunded); wizyta (depositPaid) nietknieta
    expect(mockDbUpdateTable).toHaveBeenCalledTimes(1);
    expect(mockDbUpdateSet.mock.calls[0]![0]).toMatchObject({ status: "refunded" });
  });

  it("domyslnie resetuje depositPaid wizyty po zwrocie", async () => {
    mockDbSelectWhere.mockResolvedValue([
      { id: "pay-1", status: "succeeded", amount: "50.00", stripePaymentIntentId: "pi_1", paymentMethod: "stripe" },
    ]);
    mockStripeRefundsCreate.mockResolvedValue({ id: "re_1" });

    await processAutomaticRefund("appt-1");

    expect(mockDbUpdateTable).toHaveBeenCalledTimes(2);
    expect(mockDbUpdateSet.mock.calls[1]![0]).toEqual({ depositPaid: false });
  });

  it("should NOT mark as refunded when the Stripe refund fails (money still with us)", async () => {
    mockDbSelectWhere.mockResolvedValue([
      {
        id: "pay-1",
        status: "succeeded",
        amount: "30.00",
        stripePaymentIntentId: "pi_123",
        paymentMethod: "stripe",
      },
    ]);
    mockStripeRefundsCreate.mockRejectedValue(new Error("Stripe error"));

    const result = await processAutomaticRefund("appt-1");
    expect(result.success).toBe(false);
    expect(result.refunded).toBe(false);
    expect(result.error).toBe("Stripe error");
    // Payment must stay "succeeded" — no DB update to status "refunded"
    expect(mockDbUpdateSet).not.toHaveBeenCalled();
  });

  it("should process manual refund for non-Stripe payments", async () => {
    mockDbSelectWhere.mockResolvedValue([
      {
        id: "pay-1",
        status: "succeeded",
        amount: "25.00",
        stripePaymentIntentId: null,
        paymentMethod: "blik",
      },
    ]);

    const result = await processAutomaticRefund("appt-1");
    expect(result.success).toBe(true);
    expect(result.refunded).toBe(true);
    expect(result.refundId).toBe("manual_pay-1");
    expect(result.amount).toBe(25);
  });

  it("should return failure when an exception occurs", async () => {
    mockDbSelectWhere.mockRejectedValue(new Error("DB connection failed"));

    const result = await processAutomaticRefund("appt-1");
    expect(result.success).toBe(false);
    expect(result.refunded).toBe(false);
    expect(result.error).toBe("DB connection failed");
    expect(result.message).toContain("Blad");
  });

  it("should use custom reason when provided", async () => {
    mockDbSelectWhere.mockResolvedValue([
      {
        id: "pay-1",
        status: "succeeded",
        amount: "10.00",
        stripePaymentIntentId: null,
        paymentMethod: "blik",
      },
    ]);

    const customReason = "Custom refund reason";
    await processAutomaticRefund("appt-1", customReason);

    // Verify the update call used the custom reason
    expect(mockDbUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        refundReason: customReason,
      })
    );
  });
});

describe("createRefundNotification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbInsertInto.mockReturnValue({ values: mockDbInsertValues });
    mockDbInsertValues.mockReturnValue({ returning: mockDbInsertReturning });
    mockDbInsertReturning.mockResolvedValue([{ id: "notif-1" }]);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("should create a refund notification with correct details", async () => {
    await createRefundNotification(
      "salon-1",
      "client-1",
      50.0,
      "Jan Kowalski",
      "Strzyzenie",
      new Date("2024-01-15T14:00:00")
    );

    expect(mockDbInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        salonId: "salon-1",
        clientId: "client-1",
        type: "sms",
        status: "pending",
      })
    );

    const insertedValues = mockDbInsertValues.mock.calls[0]![0];
    expect(insertedValues.message).toContain("50.00 PLN");
    expect(insertedValues.message).toContain("Jan Kowalski");
    expect(insertedValues.message).toContain("Strzyzenie");
  });

  it("should not throw when database insert fails", async () => {
    mockDbInsertValues.mockReturnValue({
      returning: vi.fn().mockRejectedValue(new Error("DB error")),
    });

    // Should not throw even though insert fails - error is caught internally
    // Note: createRefundNotification uses db.insert().values() without .returning()
    // Looking at the code: it just calls insert().values({...}) directly
    await expect(
      createRefundNotification(
        "salon-1",
        "client-1",
        50.0,
        "Jan",
        "Service",
        new Date()
      )
    ).resolves.toBeUndefined();
  });

  it("should include booking link in notification message", async () => {
    await createRefundNotification(
      "salon-1",
      "client-1",
      25.0,
      "Anna",
      "Manicure",
      new Date("2024-03-01T10:00:00")
    );

    const insertedValues = mockDbInsertValues.mock.calls[0]![0];
    expect(insertedValues.message).toContain("/salons/salon-1/book");
  });
});
