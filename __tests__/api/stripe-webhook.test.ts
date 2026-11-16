/**
 * P0-C · Stripe webhook signature enforcement regression.
 *
 * Before the fix the webhook had a "dev fallback" that parsed UNSIGNED events
 * when no secret was configured — an attacker could forge `invoice.paid` and
 * activate a paid plan for free. The fix makes signature verification
 * MANDATORY: no configured secret -> reject; no signature header -> 400;
 * bad signature -> 400; only a verified event is processed.
 *
 * Deposit (zadatek) Checkout events:
 * - checkout.session.completed with metadata.kind === "deposit" AND
 *   payment_status === "paid" confirms the deposit via the shared
 *   confirmDepositPayment() (stores the real pi_ payment_intent id)
 * - completed with payment_status "unpaid" (async P24/BLIK) does NOTHING —
 *   confirmation waits for checkout.session.async_payment_succeeded
 * - checkout.session.expired / async_payment_failed mark the still-pending
 *   payment as failed AND cancel the appointment (frees the slot)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockRequest, parseResponse } from "./helpers";

// -------------------------------------------------------
// Mocks
// -------------------------------------------------------

const mockDbSelect = vi.fn();
const mockDbInsert = vi.fn();
const mockDbUpdate = vi.fn();
const mockTxUpdate = vi.fn();

const mockTx = {
  select: (...a: unknown[]) => mockDbSelect(...a),
  insert: (...a: unknown[]) => mockDbInsert(...a),
  update: (...a: unknown[]) => mockTxUpdate(...a),
};

vi.mock("@/lib/db", () => ({
  db: {
    select: (...a: unknown[]) => mockDbSelect(...a),
    insert: (...a: unknown[]) => mockDbInsert(...a),
    update: (...a: unknown[]) => mockDbUpdate(...a),
    transaction: (fn: (tx: typeof mockTx) => unknown) => fn(mockTx),
  },
}));
vi.mock("@/lib/schema", () => ({
  salonSubscriptions: {},
  subscriptionPayments: {},
  subscriptionPlans: {},
  depositPayments: { id: "id", status: "status", appointmentId: "appointmentId" },
  appointments: { id: "id", status: "status" },
}));
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...a: unknown[]) => ({ type: "eq", args: a })),
  and: vi.fn((...a: unknown[]) => ({ type: "and", args: a })),
}));

// Shared deposit confirmation logic — the webhook must delegate to it.
const mockConfirmDeposit = vi.fn();
vi.mock("@/lib/deposit-confirmation", () => ({
  confirmDepositPayment: (...a: unknown[]) => mockConfirmDeposit(...a),
}));

const mockGetStripe = vi.fn();
const mockIsConfigured = vi.fn();
const mockConstructEvent = vi.fn();

vi.mock("@/lib/stripe", () => ({
  getStripe: (...args: unknown[]) => mockGetStripe(...args),
  isStripeWebhookConfigured: (...args: unknown[]) => mockIsConfigured(...args),
  getStripeWebhookSecret: () => (mockIsConfigured() ? "mock-webhook-secret" : null),
}));

// The `stripe` package is imported for its types only in the route; the
// runtime client comes from getStripe(). A minimal default export is enough.
vi.mock("stripe", () => ({ default: class StripeStub {} }));

import { POST as stripeWebhook } from "@/app/api/stripe/webhook/route";

// A fake Stripe client whose constructEvent we control.
const fakeStripeClient = {
  webhooks: { constructEvent: (...args: unknown[]) => mockConstructEvent(...args) },
} as unknown;

/** Set up a configured webhook whose constructEvent returns `event`. */
function signedEvent(event: Record<string, unknown>) {
  mockIsConfigured.mockReturnValue(true);
  mockGetStripe.mockReturnValue(fakeStripeClient);
  mockConstructEvent.mockReturnValue(event);
  return createMockRequest("http://localhost:3000/api/stripe/webhook", {
    method: "POST",
    headers: { "stripe-signature": "t=123,v1=valid" },
    body: event,
  });
}

const DEPOSIT_PAYMENT_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

// -------------------------------------------------------
// Tests
// -------------------------------------------------------

describe("P0-C Stripe webhook — signature is mandatory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects (no 2xx) when the webhook is not configured — closes the dev fallback", async () => {
    mockIsConfigured.mockReturnValue(false);
    mockGetStripe.mockReturnValue(fakeStripeClient);

    const request = createMockRequest("http://localhost:3000/api/stripe/webhook", {
      method: "POST",
      body: { type: "invoice.paid" },
    });
    const response = await stripeWebhook(request);
    const { status } = await parseResponse(response);

    // Must NOT process the event. Current impl returns 503 "not configured".
    expect(status).toBeGreaterThanOrEqual(400);
    expect(mockConstructEvent).not.toHaveBeenCalled();
  });

  it("returns 400 when the stripe-signature header is missing", async () => {
    mockIsConfigured.mockReturnValue(true);
    mockGetStripe.mockReturnValue(fakeStripeClient);

    const request = createMockRequest("http://localhost:3000/api/stripe/webhook", {
      method: "POST",
      body: { type: "invoice.paid" },
    });
    const response = await stripeWebhook(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(400);
    expect((body as any).error).toContain("stripe-signature");
    expect(mockConstructEvent).not.toHaveBeenCalled();
  });

  it("returns 400 when the signature does not verify (forged event)", async () => {
    mockIsConfigured.mockReturnValue(true);
    mockGetStripe.mockReturnValue(fakeStripeClient);
    mockConstructEvent.mockImplementation(() => {
      throw new Error("No signatures found matching the expected signature");
    });

    const request = createMockRequest("http://localhost:3000/api/stripe/webhook", {
      method: "POST",
      headers: { "stripe-signature": "t=123,v1=deadbeef" },
      body: { type: "invoice.paid" },
    });
    const response = await stripeWebhook(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(400);
    expect((body as any).error).toContain("verification failed");
  });
});

describe("Stripe webhook — deposit checkout completion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfirmDeposit.mockResolvedValue({
      success: true,
      alreadyConfirmed: false,
      smsSent: true,
    });
  });

  it("confirms the deposit with the real payment_intent id when payment_status is paid", async () => {
    const request = signedEvent({
      id: "evt_1",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_test_123",
          payment_intent: "pi_test_456",
          payment_status: "paid",
          metadata: {
            kind: "deposit",
            depositPaymentId: DEPOSIT_PAYMENT_ID,
            appointmentId: "appt-1",
            salonId: "salon-1",
          },
        },
      },
    });

    const response = await stripeWebhook(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(200);
    expect((body as any).received).toBe(true);
    expect(mockConfirmDeposit).toHaveBeenCalledTimes(1);
    expect(mockConfirmDeposit).toHaveBeenCalledWith(DEPOSIT_PAYMENT_ID, {
      paymentIntentId: "pi_test_456",
      stripePaymentStatus: "paid",
    });
  });

  it("does NOT confirm when payment_status is unpaid (async P24 — waits for async_payment_succeeded)", async () => {
    const request = signedEvent({
      id: "evt_1b",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_test_123",
          payment_intent: "pi_test_456",
          payment_status: "unpaid",
          metadata: { kind: "deposit", depositPaymentId: DEPOSIT_PAYMENT_ID },
        },
      },
    });

    const response = await stripeWebhook(request);
    expect((await parseResponse(response)).status).toBe(200);
    expect(mockConfirmDeposit).not.toHaveBeenCalled();
    expect(mockTxUpdate).not.toHaveBeenCalled();
  });

  it("confirms on checkout.session.async_payment_succeeded (delayed P24 payment)", async () => {
    const request = signedEvent({
      id: "evt_1c",
      type: "checkout.session.async_payment_succeeded",
      data: {
        object: {
          id: "cs_test_123",
          payment_intent: "pi_async_1",
          payment_status: "paid",
          metadata: { kind: "deposit", depositPaymentId: DEPOSIT_PAYMENT_ID },
        },
      },
    });

    const response = await stripeWebhook(request);
    expect((await parseResponse(response)).status).toBe(200);
    expect(mockConfirmDeposit).toHaveBeenCalledWith(DEPOSIT_PAYMENT_ID, {
      paymentIntentId: "pi_async_1",
      stripePaymentStatus: "paid",
    });
  });

  it("unwraps an expanded payment_intent object", async () => {
    const request = signedEvent({
      id: "evt_2",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_test_123",
          payment_intent: { id: "pi_expanded_789" },
          payment_status: "paid",
          metadata: { kind: "deposit", depositPaymentId: DEPOSIT_PAYMENT_ID },
        },
      },
    });

    const response = await stripeWebhook(request);
    expect((await parseResponse(response)).status).toBe(200);
    expect(mockConfirmDeposit).toHaveBeenCalledWith(DEPOSIT_PAYMENT_ID, {
      paymentIntentId: "pi_expanded_789",
      stripePaymentStatus: "paid",
    });
  });

  it("does not pass a non-pi_ id as paymentIntentId (keeps the stored cs_ reference)", async () => {
    const request = signedEvent({
      id: "evt_2b",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_test_123",
          payment_intent: null,
          payment_status: "paid",
          metadata: { kind: "deposit", depositPaymentId: DEPOSIT_PAYMENT_ID },
        },
      },
    });

    const response = await stripeWebhook(request);
    expect((await parseResponse(response)).status).toBe(200);
    // Called WITHOUT paymentIntentId — the existing stored value stays.
    expect(mockConfirmDeposit).toHaveBeenCalledWith(DEPOSIT_PAYMENT_ID, { stripePaymentStatus: "paid" });
  });

  it("ignores checkout sessions without deposit metadata and without mode \"subscription\" (subscriptions: stripe-webhook-subscription.test.ts)", async () => {
    const request = signedEvent({
      id: "evt_3",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_sub_1",
          payment_intent: "pi_sub_1",
          payment_status: "paid",
          metadata: { salonId: "salon-1", planId: "plan-1" },
        },
      },
    });

    const response = await stripeWebhook(request);
    expect((await parseResponse(response)).status).toBe(200);
    expect(mockConfirmDeposit).not.toHaveBeenCalled();
    expect(mockDbUpdate).not.toHaveBeenCalled();
  });

  it("still returns 200 when confirmation fails (not_found/not_pending — logged for manual handling)", async () => {
    mockConfirmDeposit.mockResolvedValue({
      success: false,
      alreadyConfirmed: false,
      smsSent: false,
      error: "not_pending",
    });

    const request = signedEvent({
      id: "evt_4",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_test_123",
          payment_intent: "pi_test_456",
          payment_status: "paid",
          metadata: { kind: "deposit", depositPaymentId: DEPOSIT_PAYMENT_ID },
        },
      },
    });

    const response = await stripeWebhook(request);
    expect((await parseResponse(response)).status).toBe(200);
  });
});

describe("Stripe webhook — deposit checkout failure (expired / async_payment_failed)", () => {
  // tx.update #1: depositPayments -> returning the flipped payment
  // tx.update #2: appointments -> cancel
  const mockPaymentReturning = vi.fn();
  const mockPaymentWhere = vi.fn(() => ({ returning: mockPaymentReturning }));
  const mockPaymentSet = vi.fn(() => ({ where: mockPaymentWhere }));

  const mockApptWhere = vi.fn().mockResolvedValue(undefined);
  const mockApptSet = vi.fn(() => ({ where: mockApptWhere }));

  beforeEach(() => {
    vi.clearAllMocks();
    mockPaymentReturning.mockResolvedValue([
      { id: DEPOSIT_PAYMENT_ID, appointmentId: "appt-1", status: "failed" },
    ]);
    mockApptWhere.mockResolvedValue(undefined);
    mockTxUpdate
      .mockReturnValueOnce({ set: mockPaymentSet })
      .mockReturnValueOnce({ set: mockApptSet });
  });

  function failureEvent(type: string) {
    return signedEvent({
      id: `evt_${type}`,
      type,
      data: {
        object: {
          id: "cs_test_123",
          payment_intent: null,
          payment_status: "unpaid",
          metadata: { kind: "deposit", depositPaymentId: DEPOSIT_PAYMENT_ID },
        },
      },
    });
  }

  it("expired: marks the pending payment failed AND cancels the appointment", async () => {
    const response = await stripeWebhook(failureEvent("checkout.session.expired"));
    const { status, body } = await parseResponse(response);

    expect(status).toBe(200);
    expect((body as any).received).toBe(true);
    // Payment flipped to "failed" (guarded by status='pending')…
    expect(mockPaymentSet).toHaveBeenCalledWith({ status: "failed" });
    // …and the appointment is cancelled so the slot is freed.
    expect(mockApptSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: "cancelled" })
    );
    expect(mockConfirmDeposit).not.toHaveBeenCalled();
  });

  it("async_payment_failed: same handling as expired", async () => {
    const response = await stripeWebhook(
      failureEvent("checkout.session.async_payment_failed")
    );
    expect((await parseResponse(response)).status).toBe(200);
    expect(mockPaymentSet).toHaveBeenCalledWith({ status: "failed" });
    expect(mockApptSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: "cancelled" })
    );
  });

  it("does not touch the appointment when the payment was no longer pending (e.g. already succeeded)", async () => {
    mockPaymentReturning.mockResolvedValue([]); // conditional update matched nothing

    const response = await stripeWebhook(failureEvent("checkout.session.expired"));
    expect((await parseResponse(response)).status).toBe(200);
    expect(mockApptSet).not.toHaveBeenCalled();
  });

  it("ignores expired sessions without deposit metadata", async () => {
    const request = signedEvent({
      id: "evt_6",
      type: "checkout.session.expired",
      data: { object: { id: "cs_sub_2", metadata: { planId: "plan-1" } } },
    });

    const response = await stripeWebhook(request);
    expect((await parseResponse(response)).status).toBe(200);
    expect(mockTxUpdate).not.toHaveBeenCalled();
  });
});
