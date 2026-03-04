import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock the Stripe constructor before importing the module.
// The default export of the 'stripe' module is the Stripe class constructor.
// We must use an actual class (not vi.fn().mockImplementation) because the
// source code calls `new Stripe(secretKey)` and vi.fn() is not constructable.
vi.mock("stripe", () => {
  class MockStripe {
    accounts = { retrieve: vi.fn() };
    constructor(_key: string) {
      // no-op — we only need the instance shape
    }
    static errors = {
      StripeAuthenticationError: class extends Error {
        constructor(msg: string) { super(msg); this.name = "StripeAuthenticationError"; }
      },
      StripeConnectionError: class extends Error {
        constructor(msg: string) { super(msg); this.name = "StripeConnectionError"; }
      },
      StripePermissionError: class extends Error {
        constructor(msg: string) { super(msg); this.name = "StripePermissionError"; }
      },
    };
  }
  return { default: MockStripe };
});

describe("stripe module", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    // Reset module cache so the singleton is re-created on each import
    vi.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("isStripeConfigured", () => {
    it("should return false when STRIPE_SECRET_KEY is not set", async () => {
      delete process.env.STRIPE_SECRET_KEY;
      const { isStripeConfigured } = await import("@/lib/stripe");
      expect(isStripeConfigured()).toBe(false);
    });

    it("should return true when STRIPE_SECRET_KEY is set", async () => {
      process.env.STRIPE_SECRET_KEY = "sk_test_123";
      const { isStripeConfigured } = await import("@/lib/stripe");
      expect(isStripeConfigured()).toBe(true);
    });
  });

  describe("isStripePublishableKeyConfigured", () => {
    it("should return false when key is not set", async () => {
      delete process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
      const { isStripePublishableKeyConfigured } = await import("@/lib/stripe");
      expect(isStripePublishableKeyConfigured()).toBe(false);
    });

    it("should return true when key is set", async () => {
      process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = "pk_test_123";
      const { isStripePublishableKeyConfigured } = await import("@/lib/stripe");
      expect(isStripePublishableKeyConfigured()).toBe(true);
    });
  });

  describe("isStripeWebhookConfigured", () => {
    it("should return false when STRIPE_WEBHOOK_SECRET is not set", async () => {
      delete process.env.STRIPE_WEBHOOK_SECRET;
      const { isStripeWebhookConfigured } = await import("@/lib/stripe");
      expect(isStripeWebhookConfigured()).toBe(false);
    });

    it("should return true when STRIPE_WEBHOOK_SECRET is set", async () => {
      process.env.STRIPE_WEBHOOK_SECRET = "whsec_123";
      const { isStripeWebhookConfigured } = await import("@/lib/stripe");
      expect(isStripeWebhookConfigured()).toBe(true);
    });
  });

  describe("isStripePricesConfigured", () => {
    it("should return false when neither price is set", async () => {
      delete process.env.STRIPE_PRICE_BASIC;
      delete process.env.STRIPE_PRICE_PRO;
      const { isStripePricesConfigured } = await import("@/lib/stripe");
      expect(isStripePricesConfigured()).toBe(false);
    });

    it("should return false when only basic price is set", async () => {
      process.env.STRIPE_PRICE_BASIC = "price_basic";
      delete process.env.STRIPE_PRICE_PRO;
      const { isStripePricesConfigured } = await import("@/lib/stripe");
      expect(isStripePricesConfigured()).toBe(false);
    });

    it("should return true when both prices are set", async () => {
      process.env.STRIPE_PRICE_BASIC = "price_basic";
      process.env.STRIPE_PRICE_PRO = "price_pro";
      const { isStripePricesConfigured } = await import("@/lib/stripe");
      expect(isStripePricesConfigured()).toBe(true);
    });
  });

  describe("getStripe", () => {
    it("should return null when STRIPE_SECRET_KEY is not set", async () => {
      delete process.env.STRIPE_SECRET_KEY;
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const { getStripe } = await import("@/lib/stripe");
      expect(getStripe()).toBeNull();
    });

    it("should return a Stripe-like instance when STRIPE_SECRET_KEY is set", async () => {
      process.env.STRIPE_SECRET_KEY = "sk_test_123";
      const { getStripe } = await import("@/lib/stripe");
      const stripe = getStripe();
      expect(stripe).not.toBeNull();
      expect(stripe).toHaveProperty("accounts");
    });

    it("should return the same instance on subsequent calls (singleton)", async () => {
      process.env.STRIPE_SECRET_KEY = "sk_test_123";
      const { getStripe } = await import("@/lib/stripe");
      const first = getStripe();
      const second = getStripe();
      expect(first).toBe(second);
    });
  });

  describe("testStripeConnection", () => {
    it("should return not configured status when no secret key", async () => {
      delete process.env.STRIPE_SECRET_KEY;
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const { testStripeConnection } = await import("@/lib/stripe");
      const status = await testStripeConnection();
      expect(status.configured).toBe(false);
      expect(status.connected).toBe(false);
      expect(status.error).toBeDefined();
    });

    it("should return connected status with display_name from settings", async () => {
      process.env.STRIPE_SECRET_KEY = "sk_test_123";
      const { testStripeConnection, getStripe } = await import("@/lib/stripe");
      const stripe = getStripe();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (stripe as any).accounts.retrieve.mockResolvedValue({
        id: "acct_123",
        charges_enabled: true,
        settings: { dashboard: { display_name: "My Salon" } },
        business_profile: { name: null },
      });

      const status = await testStripeConnection();

      expect(status.connected).toBe(true);
      expect(status.accountId).toBe("acct_123");
      expect(status.accountName).toBe("My Salon");
      expect(status.liveMode).toBe(true);
      expect(status.error).toBeUndefined();
    });

    it("should fall back to business_profile.name when display_name is absent", async () => {
      process.env.STRIPE_SECRET_KEY = "sk_test_123";
      const { testStripeConnection, getStripe } = await import("@/lib/stripe");
      const stripe = getStripe();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (stripe as any).accounts.retrieve.mockResolvedValue({
        id: "acct_456",
        charges_enabled: false,
        settings: { dashboard: {} },
        business_profile: { name: "Business Name" },
      });

      const status = await testStripeConnection();

      expect(status.connected).toBe(true);
      expect(status.accountId).toBe("acct_456");
      expect(status.accountName).toBe("Business Name");
      expect(status.liveMode).toBe(false);
    });

    it("should leave accountName undefined when no name is available", async () => {
      process.env.STRIPE_SECRET_KEY = "sk_test_123";
      const { testStripeConnection, getStripe } = await import("@/lib/stripe");
      const stripe = getStripe();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (stripe as any).accounts.retrieve.mockResolvedValue({
        id: "acct_789",
        charges_enabled: true,
        settings: { dashboard: {} },
        business_profile: { name: null },
      });

      const status = await testStripeConnection();

      expect(status.connected).toBe(true);
      expect(status.accountId).toBe("acct_789");
      expect(status.accountName).toBeUndefined();
    });

    it("should handle StripeAuthenticationError", async () => {
      process.env.STRIPE_SECRET_KEY = "sk_test_bad";
      const Stripe = (await import("stripe")).default;
      const { testStripeConnection, getStripe } = await import("@/lib/stripe");
      const stripe = getStripe();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (stripe as any).accounts.retrieve.mockRejectedValue(
        new Stripe.errors.StripeAuthenticationError({ message: "bad key", type: "authentication_error" })
      );

      const status = await testStripeConnection();

      expect(status.connected).toBe(false);
      expect(status.error).toBe("Invalid API key - authentication failed");
    });

    it("should handle StripeConnectionError", async () => {
      process.env.STRIPE_SECRET_KEY = "sk_test_123";
      const Stripe = (await import("stripe")).default;
      const { testStripeConnection, getStripe } = await import("@/lib/stripe");
      const stripe = getStripe();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (stripe as any).accounts.retrieve.mockRejectedValue(
        new Stripe.errors.StripeConnectionError({ message: "network down", type: "api_error" })
      );

      const status = await testStripeConnection();

      expect(status.connected).toBe(false);
      expect(status.error).toBe("Cannot connect to Stripe API");
    });

    it("should handle StripePermissionError", async () => {
      process.env.STRIPE_SECRET_KEY = "sk_test_123";
      const Stripe = (await import("stripe")).default;
      const { testStripeConnection, getStripe } = await import("@/lib/stripe");
      const stripe = getStripe();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (stripe as any).accounts.retrieve.mockRejectedValue(
        new Stripe.errors.StripePermissionError({ message: "restricted key", type: "api_error" })
      );

      const status = await testStripeConnection();

      expect(status.connected).toBe(false);
      expect(status.error).toBe("API key does not have required permissions");
    });

    it("should handle generic Error", async () => {
      process.env.STRIPE_SECRET_KEY = "sk_test_123";
      const { testStripeConnection, getStripe } = await import("@/lib/stripe");
      const stripe = getStripe();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (stripe as any).accounts.retrieve.mockRejectedValue(
        new Error("Something went wrong")
      );

      const status = await testStripeConnection();

      expect(status.connected).toBe(false);
      expect(status.error).toBe("Something went wrong");
    });

    it("should handle unknown non-Error thrown value", async () => {
      process.env.STRIPE_SECRET_KEY = "sk_test_123";
      const { testStripeConnection, getStripe } = await import("@/lib/stripe");
      const stripe = getStripe();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (stripe as any).accounts.retrieve.mockRejectedValue("unexpected string");

      const status = await testStripeConnection();

      expect(status.connected).toBe(false);
      expect(status.error).toBe("Unknown error testing Stripe connection");
    });
  });
});
