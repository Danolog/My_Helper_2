/**
 * Testy jednostkowe warstwy repozytorium `forSalon` (src/lib/server/repository.ts).
 *
 * Ta warstwa jest krytyczna dla izolacji najemcy (RLS, ADR-001): każda operacja
 * musi (1) odpalić się w transakcji z `SET LOCAL ROLE myhelper_app` + ustawionym
 * `app.current_salon_id`, oraz (2) automatycznie domknąć filtr `eq(salonId)`.
 *
 * Pokrycie: happy path (row), error path (null gdy brak wiersza), edge:
 * - fail-fast na pustym salonId (forSalon),
 * - walidacja nazwy roli z env (APP_DB_ROLE),
 * - listOwned z dodatkowym warunkiem i bez,
 * - raw(...) przekazuje klienta transakcyjnego z ustawionym kontekstem.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ----------------------------------------------------------------------------
// Mock @/lib/db — db.transaction(fn) odpala fn(mockTx); mockTx loguje wywołania
// execute (SET LOCAL ROLE + set_config) i deleguje buildery do sterowalnych
// stanów (mockState). Nazwy z prefiksem `mock` — wymóg hoistingu vi.mock.
// ----------------------------------------------------------------------------
const mockState = {
  selectRows: [] as unknown[],
  updateRows: [] as unknown[],
  deleteRows: [] as unknown[],
};
const mockExecCalls: unknown[] = [];

// where() musi obsłużyć findOne (`.where().limit()`) ORAZ listOwned (`.where()` await).
// Zwracamy Promise rozwiązujący się do wierszy, z doczepionym `.limit()`.
const mockSelectResult = () => {
  const p = Promise.resolve(mockState.selectRows) as Promise<unknown[]> & {
    limit?: () => Promise<unknown[]>;
  };
  p.limit = () => Promise.resolve(mockState.selectRows);
  return p;
};

const mockTx = {
  select: () => ({ from: () => ({ where: () => mockSelectResult() }) }),
  update: () => ({
    set: () => ({ where: () => ({ returning: () => Promise.resolve(mockState.updateRows) }) }),
  }),
  delete: () => ({ where: () => ({ returning: () => Promise.resolve(mockState.deleteRows) }) }),
  execute: (q: unknown) => {
    mockExecCalls.push(q);
    return Promise.resolve(undefined);
  },
};

vi.mock("@/lib/db", () => ({
  db: {
    transaction: (fn: (tx: typeof mockTx) => unknown) => fn(mockTx),
  },
}));

// Fałszywa tabela salon-scoped: drizzle `eq`/`and` nie czytają kolumn przy
// konstrukcji SQL (dopiero przy toSQL, którego nie wołamy — buildery są mockiem),
// więc Proxy z `.id` i `.salonId` w zupełności wystarcza.
const fakeTable = new Proxy(
  {},
  { get: (_t, prop) => `fakeTable.${String(prop)}` }
) as never;

const SALON = "11111111-1111-1111-1111-111111111111";

import { forSalon } from "@/lib/server/repository";

beforeEach(() => {
  mockState.selectRows = [];
  mockState.updateRows = [];
  mockState.deleteRows = [];
  mockExecCalls.length = 0;
});

describe("forSalon — fail-fast na zakresie", () => {
  it("rzuca, gdy salonId puste (pominięcie scope NIEMOŻLIWE)", () => {
    expect(() => forSalon("")).toThrow(/salonId wymagany/);
  });

  it("zwraca bramę z odsłoniętym salonId do raw(...)", () => {
    expect(forSalon(SALON).salonId).toBe(SALON);
  });
});

describe("forSalon — kontekst RLS w każdej operacji", () => {
  it("findOne ustawia SET LOCAL ROLE + set_config przed odczytem", async () => {
    mockState.selectRows = [{ id: "a", salonId: SALON }];
    const row = await forSalon(SALON).findOne(fakeTable, "a");
    expect(row).toEqual({ id: "a", salonId: SALON });
    // Dwie instrukcje SET LOCAL: rola app (bez BYPASSRLS) + kontekst salonu.
    expect(mockExecCalls).toHaveLength(2);
  });
});

describe("forSalon.findOne", () => {
  it("zwraca wiersz mojego salonu (happy path)", async () => {
    mockState.selectRows = [{ id: "a", salonId: SALON }];
    await expect(forSalon(SALON).findOne(fakeTable, "a")).resolves.toEqual({
      id: "a",
      salonId: SALON,
    });
  });

  it("zwraca null, gdy brak wiersza (=> 404 w trasie)", async () => {
    mockState.selectRows = [];
    await expect(forSalon(SALON).findOne(fakeTable, "missing")).resolves.toBeNull();
  });
});

describe("forSalon.updateOwned", () => {
  it("zwraca zaktualizowany wiersz", async () => {
    mockState.updateRows = [{ id: "a", salonId: SALON, name: "x" }];
    await expect(
      forSalon(SALON).updateOwned(fakeTable, "a", { name: "x" } as never)
    ).resolves.toEqual({ id: "a", salonId: SALON, name: "x" });
  });

  it("zwraca null, gdy nic nie zaktualizowano (cudzy/nieistniejący => 404)", async () => {
    mockState.updateRows = [];
    await expect(
      forSalon(SALON).updateOwned(fakeTable, "a", { name: "x" } as never)
    ).resolves.toBeNull();
  });
});

describe("forSalon.deleteOwned", () => {
  it("zwraca usunięty wiersz", async () => {
    mockState.deleteRows = [{ id: "a", salonId: SALON }];
    await expect(forSalon(SALON).deleteOwned(fakeTable, "a")).resolves.toEqual({
      id: "a",
      salonId: SALON,
    });
  });

  it("zwraca null, gdy nic nie usunięto (=> 404)", async () => {
    mockState.deleteRows = [];
    await expect(forSalon(SALON).deleteOwned(fakeTable, "a")).resolves.toBeNull();
  });
});

describe("forSalon.listOwned — gałąź extra", () => {
  it("listuje wiersze salonu BEZ dodatkowego warunku", async () => {
    mockState.selectRows = [{ id: "a", salonId: SALON }];
    await expect(forSalon(SALON).listOwned(fakeTable)).resolves.toEqual([
      { id: "a", salonId: SALON },
    ]);
  });

  it("listuje wiersze salonu Z dodatkowym warunkiem (extra)", async () => {
    mockState.selectRows = [{ id: "b", salonId: SALON }];
    // dowolny SQL — buildery są mockiem, ważne że gałąź `extra ? ...` zostaje wzięta
    const extra = { fake: "sql" } as never;
    await expect(forSalon(SALON).listOwned(fakeTable, extra)).resolves.toEqual([
      { id: "b", salonId: SALON },
    ]);
  });
});

describe("forSalon.raw", () => {
  it("przekazuje klienta transakcyjny z USTAWIONYM kontekstem RLS", async () => {
    const result = await forSalon(SALON).raw(async (tx) => {
      // kontekst (SET LOCAL ROLE + set_config) ustawiony PRZED callbackiem
      expect(mockExecCalls).toHaveLength(2);
      expect(tx).toBe(mockTx);
      return "ok";
    });
    expect(result).toBe("ok");
  });
});

describe("APP_DB_ROLE — walidacja nazwy roli z env", () => {
  it("rzuca przy niepoprawnym identyfikatorze roli", async () => {
    vi.resetModules();
    const prev = process.env.MYHELPER_APP_DB_ROLE;
    process.env.MYHELPER_APP_DB_ROLE = "zła rola; DROP";
    await expect(import("@/lib/server/repository")).rejects.toThrow(
      /nie jest poprawnym identyfikatorem roli/
    );
    if (prev === undefined) delete process.env.MYHELPER_APP_DB_ROLE;
    else process.env.MYHELPER_APP_DB_ROLE = prev;
    vi.resetModules();
  });
});
