/**
 * trackAIUsage — rozszerzenie o type/provider (UAT B-9).
 * Chat biznesowy, newsletter i baner nie zapisywaly wierszy w
 * aiGeneratedMedia, wiec /dashboard/ai-usage pokazywal 0 zapytan,
 * a limity (np. miesieczny limit obrazow) nigdy nie rosly.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockValues, mockInsert, mockForSalon } = vi.hoisted(() => {
  const mockValues = vi.fn().mockResolvedValue(undefined);
  const mockInsert = vi.fn(() => ({ values: mockValues }));
  // Atrapa bramy: jak prawdziwa rzuca synchronicznie przy pustym salonId,
  // a zapytanie dostaje klienta transakcyjnego (`tx`), nie surowe `db`.
  const mockForSalon = vi.fn((salonId: string) => {
    if (!salonId) throw new Error("repository.forSalon: salonId wymagany");
    return {
      salonId,
      raw: (fn: (tx: unknown) => unknown) => fn({ insert: () => mockInsert() }),
    };
  });
  return { mockValues, mockInsert, mockForSalon };
});

vi.mock("@/lib/server/repository", () => ({
  forSalon: (salonId: string) => mockForSalon(salonId),
}));

// Surowe `db` bez metod: zapis z pominięciem `forSalon` nie trafi do atrapy.
vi.mock("@/lib/db", () => ({ db: {} }));

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

  it("defaults to text/vertex (new records go to the Vertex AI cost key)", async () => {
    await trackAIUsage("salon-1", "search");

    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({
        salonId: "salon-1",
        type: "text",
        provider: "vertex",
        prompt: "search",
      }),
    );
  });

  it("explicit openrouter provider is still accepted (historical key)", async () => {
    await trackAIUsage("salon-1", "search", {}, { provider: "openrouter" });

    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({ type: "text", provider: "openrouter" }),
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

  it("zapis wideo nie kompiluje się (B4/B5, audyt bezpieczeństwa #114 V1–V2) — wywołania tylko sprawdzane przez tsc", () => {
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

  describe("allowlista w czasie wykonania (audyt bezpieczeństwa #117, T1–T3, J2)", () => {
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
    ])("%s → rozwiązana obietnica, brak zapisu, dokładnie jeden logger.error", async (_label, options: { type?: unknown; provider?: unknown }) => {
      await expect(
        trackAIUsage("salon-1", "x", { prompt: "treść żądania" }, options as Parameters<typeof trackAIUsage>[3]),
      ).resolves.toBeUndefined();
      expect(mockInsert).not.toHaveBeenCalled();
      expect(mockValues).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledTimes(1);
      const [message, context] = vi.mocked(logger.error).mock.calls[0]!;
      expect(message).toBe("[AI] Rejected usage record outside the allowlist");
      // Dokładnie salon i odrzucone wartości — bez feature i metadata żądania
      // (recenzja #117: M4 log bez type/provider, M5 log z metadata).
      expect(context).toEqual({
        salonId: "salon-1",
        type: String(options.type ?? "text"),
        provider: String(options.provider ?? "vertex"),
      });
      expect(JSON.stringify(context)).not.toContain("treść żądania");
    });

    it("bardzo długa wartość spoza listy trafia do logu przycięta do 64 znaków", async () => {
      await trackAIUsage("salon-1", "x", {}, { type: "v".repeat(500) as "text" });
      const context = vi.mocked(logger.error).mock.calls[0]![1] as { type: string };
      expect(context.type).toHaveLength(64);
      expect(mockInsert).not.toHaveBeenCalled();
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
        "vertex",
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

  describe("zapis przez forSalon (rozdzielenie salonów)", () => {
    it("zapis idzie przez forSalon z salonId wołającego, raz", async () => {
      await trackAIUsage("salon-1", "search");

      expect(mockForSalon).toHaveBeenCalledTimes(1);
      expect(mockForSalon).toHaveBeenCalledWith("salon-1");
      expect(mockInsert).toHaveBeenCalledTimes(1);
    });

    it("salonId w metadata nie zmienia kolumny salonId", async () => {
      await trackAIUsage("salon-1", "chat", { salonId: "salon-2" });

      expect(mockForSalon).toHaveBeenCalledWith("salon-1");
      expect(mockForSalon).not.toHaveBeenCalledWith("salon-2");
      const row = mockValues.mock.calls[0]![0] as { salonId: string; metadata: Record<string, unknown> };
      expect(row.salonId).toBe("salon-1");
      expect(row.metadata).toEqual({ feature: "chat", salonId: "salon-2" });
    });

    it("pusty salonId: obietnica rozwiązana, bez zapisu, ostrzeżenie w logu", async () => {
      await expect(trackAIUsage("", "chat")).resolves.toBeUndefined();

      expect(mockInsert).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        "[AI] Failed to track usage",
        expect.objectContaining({ feature: "chat" }),
      );
    });
  });
});
