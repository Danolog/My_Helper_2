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

import {
  trackAIUsage,
  TRACKED_AI_USAGE_PROVIDERS,
  TRACKED_AI_USAGE_TYPES,
} from "@/lib/ai/openrouter";
import { logger } from "@/lib/logger";

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

  describe("allowlista w czasie wykonania (Ryan #117, T1–T3, J2)", () => {
    // Wartości dochodzą tu tak, jak przez `as any` / `as never` /
    // `// @ts-ignore` albo z pliku .js/.mjs — typ ich nie zatrzymuje.
    const cast = <T>(v: unknown) => v as T;

    it.each([
      ["typ wideo", { type: cast<"text">("vid" + "eo") }],
      ["dostawca Veo", { type: cast<"text">("image"), provider: cast<"openrouter">("google_" + "veo") }],
      ["typ wideo i dostawca Veo", { type: cast<"text">("video"), provider: cast<"openrouter">("google_veo") }],
      ["pusty typ", { type: cast<"text">("") }],
      ["typ nie-string", { type: cast<"text">({ toString: () => "text" }) }],
      ["wielkie litery", { type: cast<"text">("TEXT") }],
    ])("%s → odrzucenie i brak zapisu", async (_label, options) => {
      await expect(trackAIUsage("salon-1", "x", {}, options)).rejects.toThrow(
        /outside the allowlist/,
      );
      expect(mockInsert).not.toHaveBeenCalled();
      expect(mockValues).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith(
        "[AI] Rejected usage record outside the allowlist",
        expect.objectContaining({ feature: "x" }),
      );
    });

    it("każda para z allowlisty zapisuje się jak dotąd", async () => {
      for (const type of TRACKED_AI_USAGE_TYPES) {
        for (const provider of TRACKED_AI_USAGE_PROVIDERS) {
          mockValues.mockClear();
          await expect(
            trackAIUsage("salon-1", "f", {}, { type, provider }),
          ).resolves.toBeUndefined();
          expect(mockValues).toHaveBeenCalledWith(
            expect.objectContaining({ type, provider }),
          );
        }
      }
      expect(logger.error).not.toHaveBeenCalled();
    });

    it("allowlista nie zawiera wideo ani Veo", () => {
      expect([...TRACKED_AI_USAGE_TYPES]).toEqual(["text", "image", "banner"]);
      expect([...TRACKED_AI_USAGE_PROVIDERS]).toEqual([
        "openrouter",
        "google_imagen",
        "sharp",
      ]);
    });
  });

  it("never throws when the insert fails", async () => {
    mockValues.mockRejectedValueOnce(new Error("db down"));
    await expect(trackAIUsage("salon-1", "chat")).resolves.toBeUndefined();
  });
});
