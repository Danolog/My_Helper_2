/**
 * getSalonModules — odczyt stanu modulow salonu (settingsJson.modules)
 * przez warstwe forSalon. Kontrakt:
 *   - wiersz z settingsJson => resolveModules(settingsJson),
 *   - brak wiersza => stan domyslny (chudy UI),
 *   - blad odczytu db NIE wywraca dashboardu => defaults + zalogowany error.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { DEFAULT_MODULES } from "@/lib/features";

const { mockForSalon, mockRaw, mockTxLimit, mockLoggerError } = vi.hoisted(() => {
  const mockTxLimit = vi.fn();
  const mockTxWhere = vi.fn(() => ({ limit: mockTxLimit }));
  const mockTxFrom = vi.fn(() => ({ where: mockTxWhere }));
  const mockTxSelect = vi.fn(() => ({ from: mockTxFrom }));
  const mockTx = { select: mockTxSelect };
  // raw(fn) wykonuje callback na zamockowanym kliencie transakcyjnym
  const mockRaw = vi.fn((fn: (tx: typeof mockTx) => unknown) => fn(mockTx));
  const mockForSalon = vi.fn((..._args: unknown[]) => ({ raw: mockRaw }));
  const mockLoggerError = vi.fn();
  return { mockForSalon, mockRaw, mockTxLimit, mockLoggerError };
});

vi.mock("@/lib/server/repository", () => ({
  forSalon: (...args: unknown[]) => mockForSalon(...(args as [string])),
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: (...args: unknown[]) => mockLoggerError(...args),
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: unknown[]) => ({ type: "eq", args })),
}));

vi.mock("@/lib/schema", () => ({
  salons: { id: "salons.id", settingsJson: "salons.settingsJson" },
}));

import { getSalonModules } from "@/lib/server/modules";

describe("getSalonModules", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("zwraca stan modulow z settingsJson salonu (reszta wg domyslnych)", async () => {
    mockTxLimit.mockResolvedValue([
      { settingsJson: { modules: { products: true, promotions: true } } },
    ]);

    const state = await getSalonModules("salon-1");
    expect(state.products).toBe(true);
    expect(state.promotions).toBe(true);
    expect(state.loyalty).toBe(false);
    expect(state.invoices).toBe(false);
    // hardOff pozostaje false niezaleznie od zapisu
    expect(state.voiceAi).toBe(false);
    expect(mockForSalon).toHaveBeenCalledWith("salon-1");
  });

  it("brak wiersza salonu => stan domyslny (chudy UI)", async () => {
    mockTxLimit.mockResolvedValue([]);

    const state = await getSalonModules("salon-nieistniejacy");
    expect(state).toEqual(DEFAULT_MODULES);
  });

  it("settingsJson=null => stan domyslny", async () => {
    mockTxLimit.mockResolvedValue([{ settingsJson: null }]);

    const state = await getSalonModules("salon-1");
    expect(state).toEqual(DEFAULT_MODULES);
  });

  it("blad odczytu db => defaults (fallback) + zalogowany error, bez rzucania", async () => {
    mockRaw.mockImplementationOnce(() => Promise.reject(new Error("db down")));

    const state = await getSalonModules("salon-1");
    expect(state).toEqual(DEFAULT_MODULES);
    expect(mockLoggerError).toHaveBeenCalledWith(
      expect.stringContaining("falling back to defaults"),
      expect.objectContaining({ salonId: "salon-1" })
    );
  });
});
