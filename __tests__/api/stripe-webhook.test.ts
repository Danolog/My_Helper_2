/**
 * P0-C · Stripe webhook signature enforcement regression.
 *
 * Before the fix the webhook had a "dev fallback" that parsed UNSIGNED events
 * when no secret was configured — an attacker could forge `invoice.paid` and
 * activate a paid plan for free. The fix makes signature verification
 * MANDATORY: no configured secret -> reject; no signature header -> 400;
 * bad signature -> 400; only a verified event is processed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockRequest, parseResponse } from "./helpers";

// -------------------------------------------------------
// Mocks
// -------------------------------------------------------

// db is never reached in the rejection paths, but the route imports it.
vi.mock("@/lib/db", () => ({ db: { select: vi.fn(), insert: vi.fn(), update: vi.fn() } }));
vi.mock("@/lib/schema", () => ({
  salonSubscriptions: {},
  subscriptionPayments: {},
  subscriptionPlans: {},
}));
vi.mock("drizzle-orm", () => ({ eq: vi.fn((...a: unknown[]) => ({ type: "eq", args: a })) }));

const mockGetStripe = vi.fn();
const mockIsConfigured = vi.fn();
const mockConstructEvent = vi.fn();

vi.mock("@/lib/stripe", () => ({
  getStripe: (...args: unknown[]) => mockGetStripe(...args),
  isStripeWebhookConfigured: (...args: unknown[]) => mockIsConfigured(...args),
}));

// The `stripe` package is imported for its types only in the route; the
// runtime client comes from getStripe(). A minimal default export is enough.
vi.mock("stripe", () => ({ default: class StripeStub {} }));

import { POST as stripeWebhook } from "@/app/api/stripe/webhook/route";

// A fake Stripe client whose constructEvent we control.
const fakeStripeClient = {
  webhooks: { constructEvent: (...args: unknown[]) => mockConstructEvent(...args) },
} as unknown;

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
