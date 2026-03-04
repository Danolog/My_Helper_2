import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock the constants module
vi.mock("@/lib/constants", () => ({
  PLANS: {
    basic: {
      slug: "basic",
      name: "Basic",
      priceMonthly: 49,
      priceLabel: "49 PLN/mies.",
    },
    pro: {
      slug: "pro",
      name: "Pro",
      priceMonthly: 149,
      priceLabel: "149 PLN/mies.",
    },
  },
}));

import { useSubscription } from "@/hooks/use-subscription";

describe("useSubscription", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // --- Initialization ---

  it("should start with loading=true and plan=null", () => {
    mockFetch.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useSubscription());

    expect(result.current.loading).toBe(true);
    expect(result.current.plan).toBeNull();
    expect(result.current.error).toBeNull();
  });

  // --- Happy path: Pro plan ---

  it("should fetch and set Pro plan data", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        plan: {
          slug: "pro",
          name: "Pro",
          priceMonthly: "149.00",
          features: ["AI Assistant", "Content Marketing"],
        },
        subscription: {
          status: "active",
          trialEndsAt: null,
        },
      }),
    });

    const { result } = renderHook(() => useSubscription());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.plan?.slug).toBe("pro");
    expect(result.current.plan?.name).toBe("Pro");
    expect(result.current.plan?.priceMonthly).toBe("149.00");
    expect(result.current.plan?.features).toEqual([
      "AI Assistant",
      "Content Marketing",
    ]);
    expect(result.current.isProPlan).toBe(true);
    expect(result.current.isBasicPlan).toBe(false);
    expect(result.current.isTrialing).toBe(false);
    expect(result.current.trialEndsAt).toBeNull();
    expect(result.current.trialDaysRemaining).toBeNull();
    expect(result.current.error).toBeNull();
  });

  // --- Happy path: Basic plan ---

  it("should fetch and set Basic plan data", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        plan: {
          slug: "basic",
          name: "Basic",
          priceMonthly: "49.00",
          features: [],
        },
        subscription: {
          status: "active",
          trialEndsAt: null,
        },
      }),
    });

    const { result } = renderHook(() => useSubscription());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.isProPlan).toBe(false);
    expect(result.current.isBasicPlan).toBe(true);
  });

  // --- No plan from API (default to basic) ---

  it("should default to basic plan when API returns no plan", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        plan: null,
        subscription: null,
      }),
    });

    const { result } = renderHook(() => useSubscription());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.plan?.slug).toBe("basic");
    expect(result.current.plan?.name).toBe("Basic");
    expect(result.current.plan?.priceMonthly).toBe("49.00");
    expect(result.current.isBasicPlan).toBe(true);
    expect(result.current.isProPlan).toBe(false);
  });

  // --- Trial status ---

  it("should detect trialing status and calculate days remaining", async () => {
    // Mock Date.now() so trial calculation is deterministic
    // "now" = 2026-03-01T12:00:00Z, trial ends 2026-03-15T12:00:00Z = 14 days
    const mockNow = new Date("2026-03-01T12:00:00Z").getTime();
    vi.spyOn(Date, "now").mockReturnValue(mockNow);
    const OriginalDate = globalThis.Date;
    const MockDate = class extends OriginalDate {
      constructor(...args: unknown[]) {
        if (args.length === 0) {
          super(mockNow);
        } else {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          super(...(args as [any]));
        }
      }
    } as DateConstructor;
    // Preserve static methods
    MockDate.now = () => mockNow;
    MockDate.parse = OriginalDate.parse;
    MockDate.UTC = OriginalDate.UTC;
    globalThis.Date = MockDate;

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        plan: {
          slug: "pro",
          name: "Pro",
          priceMonthly: "149.00",
          features: [],
        },
        subscription: {
          status: "trialing",
          trialEndsAt: "2026-03-15T12:00:00Z",
        },
      }),
    });

    const { result } = renderHook(() => useSubscription());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.isTrialing).toBe(true);
    expect(result.current.trialEndsAt).toBe("2026-03-15T12:00:00Z");
    expect(result.current.trialDaysRemaining).toBe(14);

    globalThis.Date = OriginalDate;
  });

  it("should return 0 trial days remaining when trial has expired", async () => {
    // "now" = 2026-03-01, trial ended 2026-02-20 (in the past)
    const mockNow = new Date("2026-03-01T12:00:00Z").getTime();
    vi.spyOn(Date, "now").mockReturnValue(mockNow);
    const OriginalDate = globalThis.Date;
    const MockDate = class extends OriginalDate {
      constructor(...args: unknown[]) {
        if (args.length === 0) {
          super(mockNow);
        } else {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          super(...(args as [any]));
        }
      }
    } as DateConstructor;
    MockDate.now = () => mockNow;
    MockDate.parse = OriginalDate.parse;
    MockDate.UTC = OriginalDate.UTC;
    globalThis.Date = MockDate;

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        plan: {
          slug: "pro",
          name: "Pro",
          priceMonthly: "149.00",
          features: [],
        },
        subscription: {
          status: "trialing",
          trialEndsAt: "2026-02-20T12:00:00Z",
        },
      }),
    });

    const { result } = renderHook(() => useSubscription());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.isTrialing).toBe(true);
    expect(result.current.trialDaysRemaining).toBe(0);

    globalThis.Date = OriginalDate;
  });

  it("should have null trialDaysRemaining when not trialing", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        plan: {
          slug: "pro",
          name: "Pro",
          priceMonthly: "149.00",
          features: [],
        },
        subscription: { status: "active", trialEndsAt: null },
      }),
    });

    const { result } = renderHook(() => useSubscription());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.isTrialing).toBe(false);
    expect(result.current.trialDaysRemaining).toBeNull();
  });

  // --- Error handling ---

  it("should set error and default to basic plan on HTTP error", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
    });

    const { result } = renderHook(() => useSubscription());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe("HTTP 500");
    // Should fallback to basic plan
    expect(result.current.plan?.slug).toBe("basic");
    expect(result.current.isBasicPlan).toBe(true);
  });

  it("should set error and default to basic plan on network failure", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Failed to fetch"));

    const { result } = renderHook(() => useSubscription());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe("Failed to fetch");
    expect(result.current.plan?.slug).toBe("basic");
  });

  it("should set generic error for non-Error thrown values", async () => {
    mockFetch.mockRejectedValueOnce("something bad");

    const { result } = renderHook(() => useSubscription());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe("Nie udalo sie pobrac planu");
    expect(result.current.plan?.slug).toBe("basic");
  });

  // --- Edge cases ---

  it("should call fetch with correct URL and cache option", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ plan: null, subscription: null }),
    });

    renderHook(() => useSubscription());

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith("/api/subscriptions/current", {
        cache: "no-store",
      });
    });
  });

  it("should handle plan with missing features array", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        plan: {
          slug: "pro",
          name: "Pro",
          priceMonthly: "149.00",
          // features omitted
        },
        subscription: { status: "active" },
      }),
    });

    const { result } = renderHook(() => useSubscription());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.plan?.features).toEqual([]);
  });

  it("should handle subscription without trialEndsAt", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        plan: {
          slug: "basic",
          name: "Basic",
          priceMonthly: "49.00",
          features: [],
        },
        subscription: { status: "active" },
      }),
    });

    const { result } = renderHook(() => useSubscription());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.trialEndsAt).toBeNull();
    expect(result.current.isTrialing).toBe(false);
  });
});
