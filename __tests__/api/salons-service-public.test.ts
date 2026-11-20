/**
 * GET /api/salons/[id]/services/[serviceId] — publiczny szczegół usługi
 * (portal klienta, bez sesji). Odczyty w jednej transakcji forSalon(id z URL),
 * każdy z jawną listą kolumn; kształt odpowiedzi bez zmian; usługa z obcego
 * salonu daje tę samą 404 co nieistniejąca.
 *
 * Atrapa bazy: tabele-fikstury z `./salon-public-fixture` (WHERE trasy
 * wykonywany na wierszach), warstwa repozytorium prawdziwa.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
// vi.mock niżej jest hoistowany przez vitest — trasa importuje już atrapy.
import { GET } from "@/app/api/salons/[id]/services/[serviceId]/route";
import { forSalon } from "@/lib/server/repository";
import { columnsReadFrom, resetFixture, selectCalls, state, whereHasEq } from "./salon-public-fixture";

vi.mock("@/lib/db", async () => ({ db: (await import("./salon-public-fixture")).db }));
vi.mock("@/lib/schema", async () => (await import("./salon-public-fixture")).schemaMock);
vi.mock("drizzle-orm", async () => (await import("./salon-public-fixture")).drizzleMock);
vi.mock("@/lib/server/repository", async (orig) => {
  const actual = await orig<typeof import("@/lib/server/repository")>();
  return { ...actual, forSalon: vi.fn(actual.forSalon) };
});
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const SALON_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SALON_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SVC_A = "44444444-4444-4444-8444-444444444444";
const SVC_B = "55555555-5555-4555-8555-555555555555";
const MISSING_SVC = "33333333-3333-4333-8333-333333333333";
const CAT_A = "77777777-7777-4777-8777-777777777777";
const EMP_A = "11111111-1111-4111-8111-111111111111";
const EMP_A_INACTIVE = "12121212-1212-4212-8212-121212121212";
const EMP_B = "22222222-2222-4222-8222-222222222222";

function employeeRow(id: string, salonId: string, firstName: string, isActive = true) {
  return {
    id, salonId, firstName, lastName: "Test", role: "employee", color: "#3b82f6", photoUrl: null,
    isActive, phone: "+48600000000", email: `${firstName}@example.com`,
  };
}

function seed() {
  resetFixture({
    services: [
      {
        id: SVC_A, salonId: SALON_A, categoryId: CAT_A, name: "Strzyżenie", description: "Opis",
        basePrice: "100.00", baseDuration: 30, isActive: true, depositRequired: false,
      },
      {
        id: SVC_B, salonId: SALON_B, categoryId: null, name: "Usługa B", description: null,
        basePrice: "50.00", baseDuration: 15, isActive: true, depositRequired: false,
      },
    ],
    serviceCategories: [{ id: CAT_A, salonId: SALON_A, name: "Włosy", sortOrder: 0 }],
    serviceVariants: [
      { id: "v1", serviceId: SVC_A, name: "Długie", priceModifier: "20.00", durationModifier: 15 },
      { id: "v2", serviceId: SVC_B, name: "Obcy wariant", priceModifier: "1.00", durationModifier: 1 },
    ],
    employees: [
      employeeRow(EMP_A, SALON_A, "Anna"),
      employeeRow(EMP_A_INACTIVE, SALON_A, "Nieaktywna", false),
      employeeRow(EMP_B, SALON_B, "Beata"),
    ],
    employeeServices: [
      { employeeId: EMP_A, serviceId: SVC_A },
      { employeeId: EMP_A_INACTIVE, serviceId: SVC_A },
      // Wadliwe przypisanie pracownika obcego salonu — jawne eq(employees.salonId) je odcina.
      { employeeId: EMP_B, serviceId: SVC_A },
    ],
    employeeServicePrices: [{ employeeId: EMP_A, serviceId: SVC_A, customPrice: "120.00" }],
  });
}

const get = (salonId: string, serviceId: string) =>
  GET(new Request(`http://localhost/api/salons/${salonId}/services/${serviceId}`), {
    params: Promise.resolve({ id: salonId, serviceId }),
  });

describe("GET /api/salons/[id]/services/[serviceId] — publiczny szczegół usługi", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seed();
  });

  it("200 — kształt odpowiedzi bez zmian", async () => {
    const res = await get(SALON_A, SVC_A);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      data: {
        id: SVC_A,
        name: "Strzyżenie",
        description: "Opis",
        basePrice: "100.00",
        baseDuration: 30,
        isActive: true,
        salonId: SALON_A,
        categoryId: CAT_A,
        category: { id: CAT_A, name: "Włosy" },
        variants: [{ id: "v1", name: "Długie", priceModifier: "20.00", durationModifier: 15 }],
        employees: [
          {
            id: EMP_A, firstName: "Anna", lastName: "Test", role: "employee", color: "#3b82f6",
            photoUrl: null, customPrice: "120.00",
          },
        ],
      },
    });
  });

  it("forSalon wołany raz, z id z URL; jedna transakcja", async () => {
    await get(SALON_A, SVC_A);
    expect(vi.mocked(forSalon)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(forSalon)).toHaveBeenCalledWith(SALON_A);
    expect(state.transactions).toBe(1);
  });

  it("każde zapytanie ma jawną listę kolumn; pracownicy bez phone i email", async () => {
    await get(SALON_A, SVC_A);
    expect(selectCalls).toHaveLength(5);
    expect(selectCalls.filter((c) => c.cols === null)).toEqual([]);
    const employeeCols = selectCalls
      .filter((c) => c.joins.includes("employees"))
      .flatMap((c) => Object.values(c.cols ?? {}));
    expect(employeeCols).not.toContain("employees.phone");
    expect(employeeCols).not.toContain("employees.email");
    expect(columnsReadFrom("services")).toEqual([
      ["services.id", "services.name", "services.description", "services.basePrice", "services.baseDuration",
        "services.isActive", "services.salonId", "services.categoryId"],
    ]);
  });

  it("jawne eq(salonId) przy usłudze, kategorii i pracownikach", async () => {
    await get(SALON_A, SVC_A);
    const q = (t: string) => selectCalls.find((c) => c.table === t)!;
    expect(whereHasEq(q("services").where, "services.salonId", SALON_A)).toBe(true);
    expect(whereHasEq(q("serviceCategories").where, "serviceCategories.salonId", SALON_A)).toBe(true);
    expect(whereHasEq(q("employeeServices").where, "employees.salonId", SALON_A)).toBe(true);
  });

  it("usługa z obcego salonu i nieistniejąca → ta sama 404 (dzisiejszy kod i treść)", async () => {
    const foreign = await get(SALON_A, SVC_B);
    const missing = await get(SALON_A, MISSING_SVC);
    expect(foreign.status).toBe(404);
    expect(missing.status).toBe(404);
    const body = await foreign.json();
    expect(body).toEqual({ success: false, error: "Service not found" });
    expect(await missing.json()).toEqual(body);
  });

  it("400 — zły format id salonu albo usługi, bez wołania forSalon", async () => {
    expect((await get("salon-1", SVC_A)).status).toBe(400);
    expect((await get(SALON_A, "service-1")).status).toBe(400);
    expect(vi.mocked(forSalon)).not.toHaveBeenCalled();
    expect(state.transactions).toBe(0);
  });

  it("500 — błąd bazy", async () => {
    state.failSelect = new Error("db down");
    const res = await get(SALON_A, SVC_A);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ success: false, error: "Failed to fetch service details" });
  });
});
