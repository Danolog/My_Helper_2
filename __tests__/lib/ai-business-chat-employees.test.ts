/**
 * Employee labels in the business assistant's salon data.
 *
 * - `employeeLabelsForModel`: first word of the first name only; a last-name
 *   initial only for people who share a first name on the same list
 *   (case-insensitive); "Pracownik" when there is no first name.
 * - `gatherSalonData`: the salon data text sent to the model lists employees
 *   by those labels and never contains a last name.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// -------------------------------------------------------
// Mocks
// -------------------------------------------------------

const { mockDbSelect, mockForSalon, mockRaw } = vi.hoisted(() => {
  const mockDbSelect = vi.fn();
  const tx = { select: (...args: unknown[]) => mockDbSelect(...args) };
  const mockRaw = vi.fn((fn: (t: typeof tx) => unknown) => fn(tx));
  // Atrapa bramy: jak prawdziwa rzuca synchronicznie przy pustym salonId,
  // a zapytania dostają klienta transakcyjnego (`tx`), nie surowe `db`.
  const mockForSalon = vi.fn((salonId: string) => {
    if (!salonId) throw new Error("repository.forSalon: salonId wymagany");
    return { salonId, raw: mockRaw };
  });
  return { mockDbSelect, mockForSalon, mockRaw };
});
vi.mock("@/lib/server/repository", () => ({
  forSalon: (salonId: string) => mockForSalon(salonId),
}));
// Surowe `db` bez metod: zapytanie z pominięciem `forSalon` nie trafi do atrapy.
vi.mock("@/lib/db", () => ({ db: {} }));

vi.mock("@/lib/schema", () => {
  const createTable = (name: string) =>
    new Proxy({}, { get: (_target, prop) => `${name}.${String(prop)}` });
  return {
    appointments: createTable("appointments"),
    clients: createTable("clients"),
    employees: createTable("employees"),
    services: createTable("services"),
    reviews: createTable("reviews"),
    products: createTable("products"),
    salons: createTable("salons"),
  };
});

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: unknown[]) => ({ type: "eq", args })),
  and: vi.fn((...args: unknown[]) => ({ type: "and", args })),
  gte: vi.fn((...args: unknown[]) => ({ type: "gte", args })),
  desc: vi.fn((...args: unknown[]) => ({ type: "desc", args })),
  count: vi.fn(() => ({ type: "count" })),
  sql: vi.fn((...args: unknown[]) => ({ type: "sql", args })),
}));

vi.mock("@openrouter/ai-sdk-provider", () => ({ createOpenRouter: vi.fn() }));
vi.mock("ai", () => ({ streamText: vi.fn(), convertToModelMessages: vi.fn() }));

vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { employeeLabelsForModel, gatherSalonData } from "@/lib/ai/business/chat";

function chainMock(result: unknown) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "from", "where", "innerJoin", "leftJoin", "groupBy", "orderBy", "limit"]) {
    chain[method] = vi.fn().mockReturnValue(chain);
  }
  chain.then = (resolve: (val: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return chain;
}

/** Queries in the order `gatherSalonData` issues them. */
function mockSalonQueries(topEmployees: unknown[]) {
  const results: unknown[] = [
    [{ name: "Salon Testowy", industryType: "hair_salon" }],
    [{ count: 10 }],
    [{ count: 3 }],
    [{ count: 5 }],
    [{ count: 20 }],
    [{ status: "completed", count: 18 }, { status: "cancelled", count: 2 }],
    [{ serviceName: "Strzyzenie", servicePrice: "80", count: 12 }],
    topEmployees,
    [{ avg: "4.5", count: 7 }],
    [],
    [{ total: "1440" }],
  ];
  for (const r of results) mockDbSelect.mockReturnValueOnce(chainMock(r));
}

describe("employeeLabelsForModel", () => {
  it("uses the first name alone when every first name is unique", () => {
    expect(
      employeeLabelsForModel([
        { firstName: "Anna", lastName: "Kowalska" },
        { firstName: "Ewa", lastName: "Nowak" },
      ]),
    ).toEqual(["Anna", "Ewa"]);
  });

  it("adds a last-name initial to every person sharing a first name", () => {
    expect(
      employeeLabelsForModel([
        { firstName: "Anna", lastName: "Kowalska" },
        { firstName: "Ewa", lastName: "Nowak" },
        { firstName: "Anna", lastName: "Wisniewska" },
      ]),
    ).toEqual(["Anna K.", "Ewa", "Anna W."]);
  });

  it("compares first names without regard to letter case", () => {
    expect(
      employeeLabelsForModel([
        { firstName: "anna", lastName: "Kowalska" },
        { firstName: "ANNA", lastName: "Wisniewska" },
      ]),
    ).toEqual(["anna K.", "ANNA W."]);
  });

  it("uses only the first word of a multi-word first name", () => {
    expect(
      employeeLabelsForModel([{ firstName: "  Anna Maria ", lastName: "Kowalska" }]),
    ).toEqual(["Anna"]);
  });

  it("treats people whose first word matches as sharing a first name", () => {
    expect(
      employeeLabelsForModel([
        { firstName: "Anna Maria", lastName: "Kowalska" },
        { firstName: "Anna", lastName: "Wisniewska" },
      ]),
    ).toEqual(["Anna K.", "Anna W."]);
  });

  it("labels a person without a first name as Pracownik", () => {
    expect(
      employeeLabelsForModel([
        { firstName: null, lastName: "Kowalska" },
        { firstName: "   ", lastName: "Nowak" },
        { firstName: "Ewa", lastName: "Zielinska" },
      ]),
    ).toEqual(["Pracownik", "Pracownik", "Ewa"]);
  });

  it("uses the first name alone for a shared name without a last name", () => {
    expect(
      employeeLabelsForModel([
        { firstName: "Anna", lastName: null },
        { firstName: "Anna", lastName: "  wisniewska" },
      ]),
    ).toEqual(["Anna", "Anna W."]);
  });

  it("never contains a full last name", () => {
    const labels = employeeLabelsForModel([
      { firstName: "Anna", lastName: "Kowalska" },
      { firstName: "Anna", lastName: "Wisniewska" },
      { firstName: "Ewa", lastName: "Nowak" },
    ]).join("\n");
    for (const lastName of ["Kowalska", "Wisniewska", "Nowak"]) {
      expect(labels).not.toContain(lastName);
    }
  });

  it("returns an empty list for no employees", () => {
    expect(employeeLabelsForModel([])).toEqual([]);
  });
});

describe("gatherSalonData — employees in the salon data text", () => {
  beforeEach(() => {
    mockDbSelect.mockReset();
    mockForSalon.mockClear();
    mockRaw.mockClear();
  });

  it("lists employees by label and count, without last names", async () => {
    mockSalonQueries([
      { firstName: "Anna Maria", lastName: "Kowalska", count: 9 },
      { firstName: "Ewa", lastName: "Nowak", count: 6 },
      { firstName: "anna", lastName: "Wisniewska", count: 3 },
    ]);

    const { data } = await gatherSalonData("salon-1");

    expect(data).toContain("  1. Anna K. - 9 wizyt");
    expect(data).toContain("  2. Ewa - 6 wizyt");
    expect(data).toContain("  3. anna W. - 3 wizyt");
    for (const hidden of ["Kowalska", "Nowak", "Wisniewska", "Maria"]) {
      expect(data).not.toContain(hidden);
    }
  });

  it("labels an employee without a first name as Pracownik", async () => {
    mockSalonQueries([{ firstName: "", lastName: "Kowalska", count: 4 }]);

    const { data } = await gatherSalonData("salon-1");

    expect(data).toContain("  1. Pracownik - 4 wizyt");
    expect(data).not.toContain("Kowalska");
  });
});

describe("gatherSalonData — odczyty przez forSalon (rozdzielenie salonów)", () => {
  const FALLBACK = "Nie udalo sie pobrac danych salonu. Prosze sprobowac ponownie.";

  beforeEach(() => {
    mockDbSelect.mockReset();
    mockForSalon.mockClear();
    mockRaw.mockClear();
  });

  it("wszystkie 11 zapytań idzie przez forSalon z salonId wołającego", async () => {
    mockSalonQueries([{ firstName: "Ewa", lastName: "Nowak", count: 6 }]);

    const result = await gatherSalonData("salon-1");

    expect(mockForSalon).toHaveBeenCalledTimes(1);
    expect(mockForSalon).toHaveBeenCalledWith("salon-1");
    // Salon osobno, potem 10 agregatów w jednej transakcji.
    expect(mockRaw).toHaveBeenCalledTimes(2);
    expect(mockDbSelect).toHaveBeenCalledTimes(11);
    expect(result.salonName).toBe("Salon Testowy");
    expect(result.industryType).toBe("hair_salon");
    expect(result.data).toContain("- Liczba klientow: 10");
    expect(result.data).toContain("- Przychod z ukonczonych wizyt: 1440.00 PLN");
    expect(result.data).toContain("- Wskaznik anulacji: 10.0%");
  });

  it("pusty salonId: komunikat o braku danych, bez zapytań i bez wyjątku", async () => {
    await expect(gatherSalonData("")).resolves.toEqual({
      data: FALLBACK,
      industryType: null,
      salonName: "Salon",
    });
    expect(mockDbSelect).not.toHaveBeenCalled();
  });

  it("błąd bazy: komunikat o braku danych, bez wyjątku", async () => {
    mockDbSelect.mockImplementationOnce(() => {
      throw new Error("db down");
    });

    await expect(gatherSalonData("salon-1")).resolves.toEqual({
      data: FALLBACK,
      industryType: null,
      salonName: "Salon",
    });
  });
});
