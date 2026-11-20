/**
 * GET /api/salons/[id]/employees/[employeeId] — publiczny profil pracownika
 * (portal klienta, bez sesji). Odpowiedź nie może zawierać danych
 * kontaktowych pracownika (phone, email) — portal ich nie wyświetla,
 * a trasa jest dostępna dla każdego. Telefon i e-mail nie są nawet czytane.
 *
 * Odczyty idą w jednej transakcji forSalon(id z URL); atrapa bazy to
 * tabele-fikstury z `./salon-public-fixture` (WHERE trasy wykonywany na
 * wierszach), a warstwa repozytorium jest prawdziwa.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
// vi.mock niżej jest hoistowany przez vitest — trasa importuje już atrapy.
import { GET } from "@/app/api/salons/[id]/employees/[employeeId]/route";
import { forSalon } from "@/lib/server/repository";
import { columnsReadFrom, resetFixture, selectCalls, state, whereHasEq } from "./salon-public-fixture";

vi.mock("@/lib/db", async () => ({ db: (await import("./salon-public-fixture")).db }));
vi.mock("@/lib/schema", async () => (await import("./salon-public-fixture")).schemaMock);
vi.mock("drizzle-orm", async () => (await import("./salon-public-fixture")).drizzleMock);
// Prawdziwa warstwa repo (na atrapie db wyżej) z podglądem wywołań forSalon.
vi.mock("@/lib/server/repository", async (orig) => {
  const actual = await orig<typeof import("@/lib/server/repository")>();
  return { ...actual, forSalon: vi.fn(actual.forSalon) };
});
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const SALON_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_SALON_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const EMPLOYEE_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_EMPLOYEE_ID = "22222222-2222-4222-8222-222222222222";
const MISSING_EMPLOYEE_ID = "33333333-3333-4333-8333-333333333333";
const SERVICE_ID = "44444444-4444-4444-8444-444444444444";
const OTHER_SERVICE_ID = "55555555-5555-4555-8555-555555555555";

const EMPLOYEE_ROW = {
  id: EMPLOYEE_ID,
  salonId: SALON_ID,
  firstName: "Anna",
  lastName: "Kowalska",
  role: "employee",
  photoUrl: null,
  color: "#3b82f6",
  isActive: true,
  phone: "+48500600700",
  email: "anna@example.com",
};

function seed() {
  resetFixture({
    salons: [
      { id: SALON_ID, name: "Salon Testowy" },
      { id: OTHER_SALON_ID, name: "Salon Obcy" },
    ],
    employees: [
      EMPLOYEE_ROW,
      { ...EMPLOYEE_ROW, id: OTHER_EMPLOYEE_ID, salonId: OTHER_SALON_ID, firstName: "Obca" },
    ],
    services: [
      { id: SERVICE_ID, salonId: SALON_ID, name: "Strzyżenie", basePrice: "100.00", baseDuration: 30 },
      { id: OTHER_SERVICE_ID, salonId: OTHER_SALON_ID, name: "Obca usługa", basePrice: "1.00", baseDuration: 5 },
    ],
    employeeServices: [
      { employeeId: EMPLOYEE_ID, serviceId: SERVICE_ID },
      // Wadliwe przypisanie do usługi obcego salonu — jawne eq(services.salonId) je odcina.
      { employeeId: EMPLOYEE_ID, serviceId: OTHER_SERVICE_ID },
    ],
    reviews: [
      {
        id: "r1", salonId: SALON_ID, employeeId: EMPLOYEE_ID, clientId: "c1", rating: 5,
        comment: "Super", status: "approved", createdAt: new Date("2026-01-02T10:00:00Z"),
      },
      {
        id: "r2", salonId: SALON_ID, employeeId: EMPLOYEE_ID, clientId: null, rating: 3,
        comment: null, status: "approved", createdAt: new Date("2026-01-01T10:00:00Z"),
      },
      {
        id: "r3", salonId: SALON_ID, employeeId: EMPLOYEE_ID, clientId: "c1", rating: 1,
        comment: "Oczekuje", status: "pending", createdAt: new Date("2026-01-03T10:00:00Z"),
      },
    ],
    clients: [{ id: "c1", firstName: "Jan", lastName: "Nowak" }],
    galleryPhotos: [
      {
        id: "g1", salonId: SALON_ID, employeeId: EMPLOYEE_ID, beforePhotoUrl: "b.jpg", afterPhotoUrl: "a.jpg",
        description: "Opis", productsUsed: "Tajny krem", showProductsToClients: false,
        createdAt: new Date("2026-01-01T09:00:00Z"),
      },
    ],
  });
}

function call(salonId = SALON_ID, employeeId = EMPLOYEE_ID) {
  return GET(
    new Request(`http://localhost:3000/api/salons/${salonId}/employees/${employeeId}`),
    { params: Promise.resolve({ id: salonId, employeeId }) }
  );
}

describe("GET /api/salons/[id]/employees/[employeeId] — publiczny profil", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seed();
  });

  it("200 — profil bez phone i email, z id, firstName, lastName, salon", async () => {
    const res = await call();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toHaveProperty("id", EMPLOYEE_ID);
    expect(body.data).toHaveProperty("firstName", "Anna");
    expect(body.data).toHaveProperty("lastName", "Kowalska");
    expect(body.data).toHaveProperty("salon", { id: SALON_ID, name: "Salon Testowy" });
    expect(body.data).not.toHaveProperty("phone");
    expect(body.data).not.toHaveProperty("email");
  });

  it("200 — pełny kształt odpowiedzi bez zmian (imię klienta z inicjałem, produkty ukryte)", async () => {
    const res = await call();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      success: true,
      data: {
        id: EMPLOYEE_ID,
        firstName: "Anna",
        lastName: "Kowalska",
        role: "employee",
        photoUrl: null,
        color: "#3b82f6",
        salon: { id: SALON_ID, name: "Salon Testowy" },
        specialties: [{ id: SERVICE_ID, name: "Strzyżenie", basePrice: "100.00", baseDuration: 30 }],
        averageRating: 4,
        reviewCount: 2,
        recentReviews: [
          { id: "r1", rating: 5, comment: "Super", createdAt: "2026-01-02T10:00:00.000Z", clientName: "Jan N." },
          { id: "r2", rating: 3, comment: null, createdAt: "2026-01-01T10:00:00.000Z", clientName: "Anonim" },
        ],
        galleryPhotos: [
          {
            id: "g1", beforePhotoUrl: "b.jpg", afterPhotoUrl: "a.jpg", description: "Opis",
            productsUsed: null, showProductsToClients: false, createdAt: "2026-01-01T09:00:00.000Z",
          },
        ],
        galleryCount: 1,
      },
    });
  });

  it("forSalon wołany raz, z id z URL; wszystko w jednej transakcji", async () => {
    await call();
    expect(vi.mocked(forSalon)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(forSalon)).toHaveBeenCalledWith(SALON_ID);
    expect(state.transactions).toBe(1);
  });

  it("jawna lista kolumn pracownika: bez phone i email (i bez select())", async () => {
    await call();
    const reads = columnsReadFrom("employees");
    expect(reads).toEqual([
      ["employees.id", "employees.firstName", "employees.lastName", "employees.role", "employees.photoUrl", "employees.color"],
    ]);
  });

  it("zapytanie o pracownika ma jawne eq(employees.salonId, id z URL)", async () => {
    await call();
    const q = selectCalls.find((c) => c.table === "employees")!;
    expect(whereHasEq(q.where, "employees.salonId", SALON_ID)).toBe(true);
    expect(whereHasEq(q.where, "employees.id", EMPLOYEE_ID)).toBe(true);
  });

  it("400 — zły format id salonu, bez wołania forSalon", async () => {
    const res = await call("salon-1");
    expect(res.status).toBe(400);
    expect((await res.json()).success).toBe(false);
    expect(vi.mocked(forSalon)).not.toHaveBeenCalled();
    expect(state.transactions).toBe(0);
  });

  it("400 — zły format id pracownika, bez wołania forSalon", async () => {
    const res = await call(SALON_ID, "employee-1");
    expect(res.status).toBe(400);
    expect(vi.mocked(forSalon)).not.toHaveBeenCalled();
  });

  it("404 — salon nie istnieje", async () => {
    const res = await call("cccccccc-cccc-4ccc-8ccc-cccccccccccc");
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.success).toBe(false);
  });

  it("404 — pracownik nie istnieje w tym salonie", async () => {
    const res = await call(SALON_ID, MISSING_EMPLOYEE_ID);
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.success).toBe(false);
  });

  it("pracownik obcego salonu i nieistniejący → ta sama 404, identyczne ciała", async () => {
    const foreign = await call(SALON_ID, OTHER_EMPLOYEE_ID);
    const missing = await call(SALON_ID, MISSING_EMPLOYEE_ID);
    expect(foreign.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(await foreign.json()).toEqual(await missing.json());
  });

  it("500 — błąd bazy", async () => {
    state.failSelect = new Error("db down");

    const res = await call();
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.success).toBe(false);
  });
});
