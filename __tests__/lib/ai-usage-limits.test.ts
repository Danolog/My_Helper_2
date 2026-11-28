import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";

// ────────────────────────────────────────────────────────────
// Mocks
// ────────────────────────────────────────────────────────────

const { mockGroupBy, mockForSalon } = vi.hoisted(() => {
  const mockGroupBy = vi.fn();
  const tx = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          groupBy: (...args: unknown[]) => mockGroupBy(...args),
        })),
      })),
    })),
  };
  // Atrapa bramy: jak prawdziwa rzuca synchronicznie przy pustym salonId,
  // a zapytanie dostaje klienta transakcyjnego (`tx`), nie surowe `db`.
  const mockForSalon = vi.fn((salonId: string) => {
    if (!salonId) throw new Error("repository.forSalon: salonId wymagany");
    return { salonId, raw: (fn: (t: typeof tx) => unknown) => fn(tx) };
  });
  return { mockGroupBy, mockForSalon };
});

vi.mock("@/lib/server/repository", () => ({
  forSalon: (salonId: string) => mockForSalon(salonId),
}));

// Surowe `db` bez metod: odczyt z pominięciem `forSalon` nie trafi do atrapy.
vi.mock("@/lib/db", () => ({ db: {} }));

vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import {
  checkAIBudget,
  getAIBudgetLimits,
  COST_MAP,
  DEFAULT_COST_PER_USE,
} from "@/lib/ai/usage-limits";
import { logger } from "@/lib/logger";

const SALON_ID = "11111111-2222-3333-4444-555555555555";

type UsageRow = { type: string; provider: string; count: number };

function mockUsageRows(rows: UsageRow[]) {
  mockGroupBy.mockResolvedValue(rows);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUsageRows([]);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ────────────────────────────────────────────────────────────
// getAIBudgetLimits
// ────────────────────────────────────────────────────────────

describe("getAIBudgetLimits", () => {
  it("returns sensible defaults when env vars are unset", () => {
    vi.stubEnv("AI_MONTHLY_BUDGET_USD", "");
    vi.stubEnv("AI_MONTHLY_IMAGE_LIMIT", "");

    expect(getAIBudgetLimits()).toEqual({
      monthlyBudgetUSD: 20,
      monthlyImageLimit: 100,
    });
  });

  it("reads overrides from env vars", () => {
    vi.stubEnv("AI_MONTHLY_BUDGET_USD", "5");
    vi.stubEnv("AI_MONTHLY_IMAGE_LIMIT", "50");

    expect(getAIBudgetLimits()).toEqual({
      monthlyBudgetUSD: 5,
      monthlyImageLimit: 50,
    });
  });

  it("falls back to defaults for invalid or negative env values", () => {
    vi.stubEnv("AI_MONTHLY_BUDGET_USD", "not-a-number");
    vi.stubEnv("AI_MONTHLY_IMAGE_LIMIT", "-3");

    const limits = getAIBudgetLimits();
    expect(limits.monthlyBudgetUSD).toBe(20);
    expect(limits.monthlyImageLimit).toBe(100);
  });
});

// ────────────────────────────────────────────────────────────
// checkAIBudget
// ────────────────────────────────────────────────────────────

describe("checkAIBudget", () => {
  it("allows usage well within the budget (happy path)", async () => {
    mockUsageRows([
      { type: "text", provider: "openrouter", count: 100 }, // 100 * 0.002 = 0.2 USD
      { type: "image", provider: "google_imagen", count: 5 }, // 5 * 0.01 = 0.05 USD
    ]);

    const result = await checkAIBudget(SALON_ID);

    expect(result.allowed).toBe(true);
    expect(result.reason).toBeUndefined();
    expect(result.usage).toEqual({
      totalCostUSD: 0.25,
      imageCount: 5,
    });
    expect(result.budget).toEqual({
      monthlyBudgetUSD: 20,
      monthlyImageLimit: 100,
    });
  });

  it("blocks any operation when the monthly budget is exhausted", async () => {
    // 10 000 text calls * 0.002 = 20 USD >= default budget of 20 USD
    mockUsageRows([{ type: "text", provider: "openrouter", count: 10_000 }]);

    const result = await checkAIBudget(SALON_ID);

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("budzet");
    expect(result.usage.totalCostUSD).toBe(20);
  });

  it("respects a lowered budget from env", async () => {
    vi.stubEnv("AI_MONTHLY_BUDGET_USD", "1");
    // 500 text calls * 0.002 = 1 USD >= 1 USD budget
    mockUsageRows([{ type: "text", provider: "openrouter", count: 500 }]);

    const result = await checkAIBudget(SALON_ID);

    expect(result.allowed).toBe(false);
    expect(result.budget.monthlyBudgetUSD).toBe(1);
  });

  it("B4: historyczne wiersze wideo liczą się do budżetu po cenie Veo, bez limitu sztuk", async () => {
    // 10 klipów sprzed usunięcia wideo: 10 * 0.15 = 1.5 USD (w budżecie)
    mockUsageRows([{ type: "video", provider: "google_veo", count: 10 }]);

    const textResult = await checkAIBudget(SALON_ID);
    expect(textResult.allowed).toBe(true);
    expect(textResult.usage).toEqual({ totalCostUSD: 1.5, imageCount: 0 });

    const imageResult = await checkAIBudget(SALON_ID, "image");
    expect(imageResult.allowed).toBe(true);
  });

  it("blocks image and banner generation when the image unit limit is reached", async () => {
    mockUsageRows([
      { type: "image", provider: "google_imagen", count: 60 },
      { type: "banner", provider: "google_imagen", count: 40 },
    ]);

    const imageResult = await checkAIBudget(SALON_ID, "image");
    expect(imageResult.allowed).toBe(false);
    expect(imageResult.reason).toContain("obrazow");
    expect(imageResult.usage.imageCount).toBe(100);

    const bannerResult = await checkAIBudget(SALON_ID, "banner");
    expect(bannerResult.allowed).toBe(false);
  });

  it("does not count free sharp operations toward the image unit limit", async () => {
    // sharp = server-side processing, zero API cost
    mockUsageRows([
      { type: "image", provider: "sharp", count: 500 },
      { type: "banner", provider: "sharp", count: 200 },
    ]);

    const result = await checkAIBudget(SALON_ID, "image");

    expect(result.allowed).toBe(true);
    expect(result.usage.imageCount).toBe(0);
    expect(result.usage.totalCostUSD).toBe(0);
  });

  it("uses the default cost for unknown type:provider combinations", async () => {
    mockUsageRows([{ type: "text", provider: "mystery_provider", count: 10 }]);

    const result = await checkAIBudget(SALON_ID);

    expect(result.usage.totalCostUSD).toBe(10 * DEFAULT_COST_PER_USE);
  });

  it("fails open (allowed) when the database query throws", async () => {
    mockGroupBy.mockRejectedValue(new Error("db down"));

    const result = await checkAIBudget(SALON_ID, "image");

    expect(result.allowed).toBe(true);
    expect(result.usage).toEqual({
      totalCostUSD: 0,
      imageCount: 0,
    });
    expect(logger.warn).toHaveBeenCalled();
  });

  it("odczyt idzie przez forSalon z salonId sprawdzanego salonu, raz", async () => {
    mockUsageRows([{ type: "text", provider: "openrouter", count: 100 }]);

    const result = await checkAIBudget(SALON_ID);

    expect(mockForSalon).toHaveBeenCalledTimes(1);
    expect(mockForSalon).toHaveBeenCalledWith(SALON_ID);
    expect(result.usage.totalCostUSD).toBe(0.2);
  });

  it("pusty salonId: fail-open bez wyjątku, bez zapytania", async () => {
    const result = await checkAIBudget("", "image");

    expect(result.allowed).toBe(true);
    expect(result.usage).toEqual({ totalCostUSD: 0, imageCount: 0 });
    expect(mockGroupBy).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      "[AI Budget] Failed to compute usage — failing open",
      expect.objectContaining({ salonId: "" }),
    );
  });
});

// ────────────────────────────────────────────────────────────
// COST_MAP sanity (shared with GET /api/ai/usage)
// ────────────────────────────────────────────────────────────

describe("COST_MAP", () => {
  it("keeps the documented per-use costs", () => {
    expect(COST_MAP["video:google_veo"]).toBe(0.15);
    expect(COST_MAP["image:google_imagen"]).toBe(0.01);
    expect(COST_MAP["banner:google_imagen"]).toBe(0.01);
    expect(COST_MAP["image:sharp"]).toBe(0);
    expect(COST_MAP["text:openrouter"]).toBe(0.002);
  });
});
