/**
 * Tests for POST /api/deposits/create-session.
 *
 * The route recomputes the deposit amount SERVER-SIDE (via
 * calculateExpectedDeposit — the body amount is only cross-checked),
 * validates the slot, creates appointment + pending deposit payment in one
 * transaction, and then:
 * - Stripe configured  -> creates a REAL Stripe Checkout session
 *   (mode "payment", card/BLIK/P24, amount in grosze, metadata.kind
 *   "deposit") and returns its URL as `paymentUrl`.
 * - Stripe NOT configured -> returns the dev simulation payload
 *   (`simulated: true`) so the frontend can confirm via /api/deposits/confirm.
 * - Stripe configured but session creation fails -> 502 and the just-created
 *   appointment is deleted so the slot is not blocked by an unpayable booking.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createMockRequest,
  parseResponse,
  createChainMock,
} from "./helpers";

// Zod 4's z.string().uuid() enforces RFC 4122 version/variant nibbles, so the
// simple TEST_IDS placeholders (all-1s etc.) do not pass — use valid v4 UUIDs.
const SALON_UUID = "11111111-1111-4111-8111-111111111111";
const EMPLOYEE_UUID = "22222222-2222-4222-8222-222222222222";
const SERVICE_UUID = "44444444-4444-4444-8444-444444444444";
const APPOINTMENT_UUID = "66666666-6666-4666-8666-666666666666";
const CLIENT_UUID = "33333333-3333-4333-8333-333333333333";

// -------------------------------------------------------
// Mocks - must be declared before importing the route
// -------------------------------------------------------

const mockDbSelect = vi.fn();
const mockDbInsert = vi.fn();
const mockDbUpdate = vi.fn();
const mockDbDelete = vi.fn();

const mockTx = {
  select: (...a: unknown[]) => mockDbSelect(...a),
  insert: (...a: unknown[]) => mockDbInsert(...a),
  update: (...a: unknown[]) => mockDbUpdate(...a),
  delete: (...a: unknown[]) => mockDbDelete(...a),
};

vi.mock("@/lib/db", () => ({
  db: {
    select: (...a: unknown[]) => mockDbSelect(...a),
    insert: (...a: unknown[]) => mockDbInsert(...a),
    update: (...a: unknown[]) => mockDbUpdate(...a),
    delete: (...a: unknown[]) => mockDbDelete(...a),
    transaction: (fn: (tx: typeof mockTx) => unknown) => fn(mockTx),
  },
}));

vi.mock("@/lib/session", () => ({
  getOptionalSession: vi.fn().mockResolvedValue({
    user: { id: "test-user-id", email: "klient@test.pl", name: "Test User" },
  }),
}));

vi.mock("@/lib/rate-limit", () => ({
  strictRateLimit: {
    check: vi.fn().mockReturnValue({ success: true, remaining: 4, reset: 60000 }),
  },
  getClientIp: vi.fn().mockReturnValue("127.0.0.1"),
}));

// Server-side deposit amount calculation (tested separately in
// __tests__/lib/deposit-calculation.test.ts)
const mockCalcDeposit = vi.fn();
vi.mock("@/lib/deposit-calculation", () => ({
  calculateExpectedDeposit: (...a: unknown[]) => mockCalcDeposit(...a),
}));

const mockGetStripe = vi.fn();
const mockIsStripeConfigured = vi.fn();

vi.mock("@/lib/stripe", () => ({
  getStripe: (...a: unknown[]) => mockGetStripe(...a),
  isStripeConfigured: (...a: unknown[]) => mockIsStripeConfigured(...a),
}));

import { POST as createSession } from "@/app/api/deposits/create-session/route";

// -------------------------------------------------------
// Fixtures
// -------------------------------------------------------

const DEPOSIT_PAYMENT_UUID = "77777777-7777-4777-8777-777777777777";

const validBody = {
  salonId: SALON_UUID,
  employeeId: EMPLOYEE_UUID,
  serviceId: SERVICE_UUID,
  startTime: "2026-08-01T10:00:00.000Z",
  endTime: "2026-08-01T11:00:00.000Z",
  depositAmount: 50,
  paymentMethod: "stripe",
  notes: "Rezerwacja online: Strzyzenie",
};

const insertedAppointment = {
  id: APPOINTMENT_UUID,
  salonId: SALON_UUID,
  employeeId: EMPLOYEE_UUID,
  serviceId: SERVICE_UUID,
  status: "scheduled",
  depositPaid: false,
};

const insertedPayment = {
  id: DEPOSIT_PAYMENT_UUID,
  appointmentId: APPOINTMENT_UUID,
  salonId: SALON_UUID,
  amount: "50",
  currency: "PLN",
  paymentMethod: "stripe",
  status: "pending",
};

/** Queue the SELECTs (overlap, time blocks) + two INSERTs (tx). */
function primeHappyPathDb() {
  mockDbSelect
    .mockReturnValueOnce(createChainMock([])) // overlapping appointments
    .mockReturnValueOnce(createChainMock([])); // time blocks
  mockDbInsert
    .mockReturnValueOnce(createChainMock([insertedAppointment]))
    .mockReturnValueOnce(createChainMock([insertedPayment]));
  mockDbUpdate.mockReturnValue(createChainMock([]));
  mockDbDelete.mockReturnValue(createChainMock([]));
}

function primeExpectedDeposit(amount = 50) {
  mockCalcDeposit.mockResolvedValue({
    ok: true,
    required: true,
    amount,
    serviceName: "Strzyzenie",
  });
}

function makeRequest(body: Record<string, unknown> = validBody) {
  return createMockRequest("http://localhost:3000/api/deposits/create-session", {
    method: "POST",
    body,
  });
}

// -------------------------------------------------------
// Tests
// -------------------------------------------------------

describe("POST /api/deposits/create-session — Stripe configured", () => {
  const mockSessionsCreate = vi.fn();
  const fakeStripe = {
    checkout: { sessions: { create: (...a: unknown[]) => mockSessionsCreate(...a) } },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    primeHappyPathDb();
    primeExpectedDeposit(50);
    mockIsStripeConfigured.mockReturnValue(true);
    mockGetStripe.mockReturnValue(fakeStripe);
    mockSessionsCreate.mockResolvedValue({
      id: "cs_test_123",
      url: "https://checkout.stripe.com/c/pay/cs_test_123",
    });
  });

  it("creates a real Checkout session and returns its URL as paymentUrl", async () => {
    const response = await createSession(makeRequest());
    const { status, body } = await parseResponse<{
      success: boolean;
      data: Record<string, unknown>;
    }>(response);

    expect(status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.data.sessionId).toBe("cs_test_123");
    expect(body.data.paymentUrl).toBe("https://checkout.stripe.com/c/pay/cs_test_123");
    expect(body.data.simulated).toBe(false);
    expect(body.data.depositPaymentId).toBe(DEPOSIT_PAYMENT_UUID);
    expect(body.data.appointmentId).toBe(APPOINTMENT_UUID);
    // The server-side calculation was consulted
    expect(mockCalcDeposit).toHaveBeenCalledWith(
      expect.objectContaining({
        salonId: SALON_UUID,
        serviceId: SERVICE_UUID,
        sessionUser: expect.objectContaining({ email: "klient@test.pl" }),
      })
    );
  });

  it("configures the session for PLN deposits: mode payment, card/BLIK/P24, grosze, deposit metadata", async () => {
    await createSession(makeRequest());

    expect(mockSessionsCreate).toHaveBeenCalledTimes(1);
    const args = mockSessionsCreate.mock.calls[0]![0] as Record<string, any>;

    expect(args.mode).toBe("payment");
    expect(args.payment_method_types).toEqual(["card", "blik", "p24"]);
    expect(args.line_items[0].price_data.currency).toBe("pln");
    // 50 PLN -> 5000 groszy
    expect(args.line_items[0].price_data.unit_amount).toBe(5000);
    expect(args.line_items[0].price_data.product_data.name).toContain("Strzyzenie");
    expect(args.metadata).toEqual({
      kind: "deposit",
      depositPaymentId: DEPOSIT_PAYMENT_UUID,
      appointmentId: APPOINTMENT_UUID,
      salonId: SALON_UUID,
    });
    // ~30 min expiry
    const now = Math.floor(Date.now() / 1000);
    expect(args.expires_at).toBeGreaterThan(now + 25 * 60);
    expect(args.expires_at).toBeLessThan(now + 45 * 60);
    // Redirects back to the booking portal with a deposit result param
    expect(args.success_url).toContain(`/salons/${SALON_UUID}/book?deposit=success`);
    expect(args.cancel_url).toContain(`/salons/${SALON_UUID}/book?deposit=cancelled`);

    // The Checkout session id is persisted on the deposit payment record
    expect(mockDbUpdate).toHaveBeenCalledTimes(1);
  });

  it("rejects a manipulated deposit amount with 400 (server-side amount wins)", async () => {
    // Server says 50 PLN, the request claims 0.01 PLN
    const response = await createSession(
      makeRequest({ ...validBody, depositAmount: 0.01 })
    );
    const { status, body } = await parseResponse<{ success: boolean; error: string }>(
      response
    );

    expect(status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toContain("kwota zadatku");
    // Nothing was created, Stripe never touched
    expect(mockDbInsert).not.toHaveBeenCalled();
    expect(mockSessionsCreate).not.toHaveBeenCalled();
  });

  it("rejects when no deposit is required for this booking", async () => {
    mockCalcDeposit.mockResolvedValue({
      ok: true,
      required: false,
      amount: 0,
      serviceName: "Strzyzenie",
    });

    const response = await createSession(makeRequest());
    const { status } = await parseResponse(response);

    expect(status).toBe(400);
    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  it("rejects a clientId that does not belong to the salon", async () => {
    mockDbSelect.mockReset();
    mockDbSelect.mockReturnValueOnce(createChainMock([])); // client lookup -> none

    const response = await createSession(
      makeRequest({ ...validBody, clientId: CLIENT_UUID })
    );
    const { status, body } = await parseResponse<{ error: string }>(response);

    expect(status).toBe(400);
    expect(body.error).toContain("klient");
    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  it("returns 502 and deletes the appointment when Checkout creation fails", async () => {
    mockSessionsCreate.mockRejectedValue(new Error("stripe down"));

    const response = await createSession(makeRequest());
    const { status, body } = await parseResponse<{ success: boolean }>(response);

    expect(status).toBe(502);
    expect(body.success).toBe(false);
    // The unpayable appointment must not keep blocking the slot
    expect(mockDbDelete).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/deposits/create-session — Stripe NOT configured (dev simulation)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeHappyPathDb();
    primeExpectedDeposit(50);
    mockIsStripeConfigured.mockReturnValue(false);
    mockGetStripe.mockReturnValue(null);
  });

  it("falls back to the simulated dev session", async () => {
    const response = await createSession(makeRequest());
    const { status, body } = await parseResponse<{
      success: boolean;
      data: Record<string, unknown>;
    }>(response);

    expect(status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.data.simulated).toBe(true);
    expect(body.data.sessionId).toBe(`dep_session_${DEPOSIT_PAYMENT_UUID}`);
    expect(body.data.paymentUrl).toBe(
      `/api/deposits/checkout?session=dep_session_${DEPOSIT_PAYMENT_UUID}`
    );
  });

  it("rejects a taken slot with 409 before creating anything", async () => {
    mockDbSelect.mockReset();
    mockDbSelect.mockReturnValueOnce(
      createChainMock([{ id: "existing-appointment" }]) // overlap found
    );

    const response = await createSession(makeRequest());
    const { status } = await parseResponse(response);

    expect(status).toBe(409);
    expect(mockDbInsert).not.toHaveBeenCalled();
  });
});
