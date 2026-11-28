/**
 * getSalonContext (@/lib/ai/openrouter) — odczyt salonu przez forSalon.
 *
 * Nazwa i branża salonu dla zapytań do modelu pochodzą z jednego odczytu
 * `forSalon(salonId).raw(...)` z warunkiem `eq(salons.id, salonId)`. Przy
 * błędzie bazy i pustym salonId funkcja zwraca wartości domyślne, bez wyjątku.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => {
  const rows = vi.fn();
  const where = vi.fn();
  const tx = {
    select: () => ({
      from: () => ({
        where: (w: unknown) => {
          where(w);
          return { then: (resolve: (r: unknown) => unknown, reject?: (e: unknown) => unknown) =>
            Promise.resolve().then(() => rows()).then(resolve, reject) };
        },
      }),
    }),
  };
  // Atrapa bramy: jak prawdziwa rzuca synchronicznie przy pustym salonId,
  // a zapytanie dostaje klienta transakcyjnego (`tx`), nie surowe `db`.
  const forSalon = vi.fn((salonId: string) => {
    if (!salonId) throw new Error("repository.forSalon: salonId wymagany");
    return { salonId, raw: (fn: (t: typeof tx) => unknown) => fn(tx) };
  });
  return { rows, where, forSalon };
});

vi.mock("@/lib/server/repository", () => ({
  forSalon: (salonId: string) => m.forSalon(salonId),
}));
// Surowe `db` bez metod: odczyt z pominięciem `forSalon` nie trafi do atrapy.
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("drizzle-orm", async (importActual) => {
  const actual = await importActual<typeof import("drizzle-orm")>();
  return { ...actual, eq: (col: unknown, val: unknown) => ({ eq: [col, val] }) };
});
vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { getSalonContext } from "@/lib/ai/openrouter";
import { logger } from "@/lib/logger";
import { salons } from "@/lib/schema";

const SALON = "11111111-2222-3333-4444-555555555555";
const DEFAULTS = { salonName: "Salon", industryType: null, industryLabel: "salon uslugowy" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getSalonContext", () => {
  it("nazwa i branża salonu z odczytu przez forSalon z tym samym salonId", async () => {
    m.rows.mockReturnValue([{ name: "Salon Testowy", industryType: "hair_salon" }]);

    await expect(getSalonContext(SALON)).resolves.toEqual({
      salonName: "Salon Testowy",
      industryType: "hair_salon",
      industryLabel: "salon fryzjerski",
    });
    expect(m.forSalon).toHaveBeenCalledTimes(1);
    expect(m.forSalon).toHaveBeenCalledWith(SALON);
    // Warunek WHERE zostaje jako druga warstwa.
    expect(m.where).toHaveBeenCalledWith({ eq: [salons.id, SALON] });
  });

  it("nieznana branża → etykieta ogólna", async () => {
    m.rows.mockReturnValue([{ name: "Salon Testowy", industryType: "inna" }]);

    await expect(getSalonContext(SALON)).resolves.toEqual({
      salonName: "Salon Testowy",
      industryType: "inna",
      industryLabel: "salon uslugowy",
    });
  });

  it("brak wiersza → wartości domyślne", async () => {
    m.rows.mockReturnValue([]);

    await expect(getSalonContext(SALON)).resolves.toEqual(DEFAULTS);
  });

  it("błąd bazy → wartości domyślne i log błędu", async () => {
    m.rows.mockImplementation(() => {
      throw new Error("db down");
    });

    await expect(getSalonContext(SALON)).resolves.toEqual(DEFAULTS);
    expect(logger.error).toHaveBeenCalledWith(
      "[AI] Error fetching salon context",
      expect.objectContaining({ error: expect.any(Error) }),
    );
  });

  it("pusty salonId → wartości domyślne bez wyjątku i bez zapytania", async () => {
    await expect(getSalonContext("")).resolves.toEqual(DEFAULTS);
    expect(m.rows).not.toHaveBeenCalled();
  });
});
