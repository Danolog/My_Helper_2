/**
 * trackAIUsage — rozszerzenie o type/provider (UAT B-9).
 * Chat biznesowy, newsletter i baner nie zapisywaly wierszy w
 * aiGeneratedMedia, wiec /dashboard/ai-usage pokazywal 0 zapytan,
 * a limity (np. miesieczny limit obrazow) nigdy nie rosly.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockValues = vi.fn().mockResolvedValue(undefined);
const mockInsert = vi.fn(() => ({ values: mockValues }));

vi.mock("@/lib/db", () => ({
  db: { insert: () => mockInsert() },
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { trackAIUsage } from "@/lib/ai/openrouter";

describe("trackAIUsage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("defaults to text/openrouter (backward compatible)", async () => {
    await trackAIUsage("salon-1", "search");

    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({
        salonId: "salon-1",
        type: "text",
        provider: "openrouter",
        prompt: "search",
      }),
    );
  });

  it("accepts type/provider override for media features", async () => {
    await trackAIUsage(
      "salon-1",
      "banner",
      { style: "modern" },
      { type: "banner", provider: "google_imagen" },
    );

    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({
        salonId: "salon-1",
        type: "banner",
        provider: "google_imagen",
        metadata: expect.objectContaining({ feature: "banner", style: "modern" }),
      }),
    );
  });

  it("zapis wideo nie kompiluje się (B4/B5, Ryan #114 V1–V2) — wywołania tylko sprawdzane przez tsc", () => {
    // Funkcja nie jest wołana: liczy się `pnpm typecheck`. Gdy ktoś poszerzy
    // typ zapisu, dyrektywy @ts-expect-error staną się zbędne i tsc padnie.
    const neverCalled = () => {
      // @ts-expect-error — "video" nie jest typem zapisu
      void trackAIUsage("s", "x", {}, { type: "video" });
      const t: string = "vid" + "eo";
      // @ts-expect-error — typ sklejany ze stringów to `string`, nie literał
      void trackAIUsage("s", "x", {}, { type: t });
      // @ts-expect-error — "google_veo" nie jest dostawcą zapisu
      void trackAIUsage("s", "x", {}, { type: "image", provider: "google_veo" });
    };
    expect(typeof neverCalled).toBe("function");
    expect(mockValues).not.toHaveBeenCalled();
  });

  it("never throws when the insert fails", async () => {
    mockValues.mockRejectedValueOnce(new Error("db down"));
    await expect(trackAIUsage("salon-1", "chat")).resolves.toBeUndefined();
  });
});
