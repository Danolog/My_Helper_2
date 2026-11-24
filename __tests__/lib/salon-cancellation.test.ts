/**
 * expireCheckoutSessions — wygaszanie sesji Checkout po odwołaniu przez salon.
 * Audyt bezpieczeństwa, P2 (#98): błąd Stripe logowany wyłącznie jako toErrorIdentity
 * (nazwa + kod), bez message/stack — komunikat może nieść dane klienta.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockExpire, stripeState } = vi.hoisted(() => ({
  mockExpire: vi.fn(),
  stripeState: { configured: true },
}));

vi.mock("@/lib/stripe", () => ({
  getStripe: vi.fn(() =>
    stripeState.configured ? { checkout: { sessions: { expire: (...a: unknown[]) => mockExpire(...a) } } } : null
  ),
}));
vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { logger } from "@/lib/logger";
import { expireCheckoutSessions } from "@/lib/salon-cancellation";

describe("expireCheckoutSessions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stripeState.configured = true;
  });

  it("wygasza tylko sesje cs_, pomija pi_ i null", async () => {
    mockExpire.mockResolvedValue({ status: "expired" });
    await expireCheckoutSessions("appt-1", [
      { id: "dp-1", stripePaymentIntentId: "cs_test_1" },
      { id: "dp-2", stripePaymentIntentId: "pi_1" },
      { id: "dp-3", stripePaymentIntentId: null },
    ]);
    expect(mockExpire).toHaveBeenCalledTimes(1);
    expect(mockExpire).toHaveBeenCalledWith("cs_test_1");
  });

  it("błąd Stripe => warn tylko z nazwą i kodem błędu, bez message i stack", async () => {
    class StripeInvalidRequestError extends Error {
      type = "StripeInvalidRequestError";
      code = "resource_missing";
    }
    const err = new StripeInvalidRequestError("No such checkout.session for anna@example.com +48600700800");
    err.name = "StripeInvalidRequestError";
    mockExpire.mockRejectedValue(err);

    await expireCheckoutSessions("appt-1", [{ id: "dp-1", stripePaymentIntentId: "cs_test_1" }]);

    expect(logger.warn).toHaveBeenCalledTimes(1);
    const [msg, meta] = vi.mocked(logger.warn).mock.calls[0]!;
    expect(msg).toContain("Checkout session expire failed");
    expect(meta).toEqual({
      appointmentId: "appt-1",
      depositPaymentId: "dp-1",
      errorName: "StripeInvalidRequestError",
      errorCode: "resource_missing",
    });
    const serialized = JSON.stringify(meta);
    expect(serialized).not.toContain("anna@example.com");
    expect(serialized).not.toContain("+48600700800");
  });

  it("brak Stripe => warn z id płatności, bez wywołań", async () => {
    stripeState.configured = false;
    await expireCheckoutSessions("appt-1", [{ id: "dp-1", stripePaymentIntentId: "cs_test_1" }]);
    expect(mockExpire).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("Stripe not configured"), {
      appointmentId: "appt-1",
      depositPaymentIds: ["dp-1"],
    });
  });
});
