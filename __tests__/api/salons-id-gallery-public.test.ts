/**
 * GET /api/salons/[id]/gallery — publiczna galeria salonu (bez sesji).
 *
 * Odczyty w jednej transakcji forSalon(id z URL), jawne listy kolumn i jawne
 * eq(salonId) także po stronie złączeń z pracownikami i usługami. Format id
 * (ścieżka i filtry z query) sprawdzany przed forSalon — zły format daje 400.
 * Kształt odpowiedzi bez zmian, `productsUsed` ukrywane jak dotąd.
 *
 * Atrapa bazy: tabele-fikstury z `./salon-public-fixture` (WHERE i warunki
 * złączeń trasy wykonywane na wierszach), warstwa repozytorium prawdziwa.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
// vi.mock niżej jest hoistowany przez vitest — trasa importuje już atrapy.
import { GET } from "@/app/api/salons/[id]/gallery/route";
import { logger } from "@/lib/logger";
import { forSalon } from "@/lib/server/repository";
import { resetFixture, selectCalls, state, whereHasEq } from "./salon-public-fixture";

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
const EMP_A = "11111111-1111-4111-8111-111111111111";
const EMP_B = "22222222-2222-4222-8222-222222222222";
const SVC_A = "44444444-4444-4444-8444-444444444444";
const SVC_B = "55555555-5555-4555-8555-555555555555";
const PHOTO_A1 = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";
const PHOTO_A2 = "a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2";
const PHOTO_A3 = "a3a3a3a3-a3a3-4a3a-8a3a-a3a3a3a3a3a3";
const PHOTO_B1 = "b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1";

const T1 = new Date("2026-01-01T08:00:00Z");
const T2 = new Date("2026-01-02T08:00:00Z");
const T3 = new Date("2026-01-03T08:00:00Z");

function photoRow(id: string, salonId: string, extra: Record<string, unknown> = {}) {
  return {
    id, salonId, employeeId: null, serviceId: null,
    beforePhotoUrl: null, afterPhotoUrl: null, description: null,
    productsUsed: "Produkt X", techniques: null, duration: null,
    showProductsToClients: false, createdAt: T1, ...extra,
  };
}

function seed() {
  resetFixture({
    galleryPhotos: [
      photoRow(PHOTO_A1, SALON_A, {
        employeeId: EMP_A, serviceId: SVC_A, beforePhotoUrl: "https://x/b1.jpg", afterPhotoUrl: "https://x/a1.jpg",
        description: "Przed i po", showProductsToClients: true, createdAt: T1,
      }),
      photoRow(PHOTO_A2, SALON_A, { employeeId: EMP_A, afterPhotoUrl: "https://x/a2.jpg", createdAt: T3 }),
      // Wadliwe odwołania do pracownika i usługi salonu B — jawne eq(salonId)
      // w złączeniu nie ujawnia ich imienia ani nazwy.
      photoRow(PHOTO_A3, SALON_A, { employeeId: EMP_B, serviceId: SVC_B, createdAt: T2 }),
      photoRow(PHOTO_B1, SALON_B, { employeeId: EMP_B, serviceId: SVC_B, createdAt: T3 }),
    ],
    employees: [
      { id: EMP_A, salonId: SALON_A, firstName: "Anna", lastName: "Test", phone: "+48600000000", email: "a@x.pl" },
      { id: EMP_B, salonId: SALON_B, firstName: "Beata", lastName: "Obca", phone: "+48600000001", email: "b@x.pl" },
    ],
    services: [
      { id: SVC_A, salonId: SALON_A, name: "Strzyżenie A" },
      { id: SVC_B, salonId: SALON_B, name: "Usługa B" },
    ],
  });
}

const get = (id: string, query = "") =>
  GET(new Request(`http://localhost/api/salons/${id}/gallery${query}`), { params: Promise.resolve({ id }) });

/** Odpowiedź dla salonu A, jak ją zwracał kod sprzed zmiany (po JSON), z wyjątkiem złączeń z obcym salonem. */
const EXPECTED_A = {
  success: true,
  data: [
    {
      id: PHOTO_A2, salonId: SALON_A, employeeId: EMP_A, serviceId: null,
      beforePhotoUrl: null, afterPhotoUrl: "https://x/a2.jpg", description: null,
      productsUsed: null, techniques: null, duration: null, showProductsToClients: false,
      createdAt: T3.toISOString(), employeeFirstName: "Anna", employeeLastName: "Test", serviceName: null,
    },
    {
      id: PHOTO_A3, salonId: SALON_A, employeeId: EMP_B, serviceId: SVC_B,
      beforePhotoUrl: null, afterPhotoUrl: null, description: null,
      productsUsed: null, techniques: null, duration: null, showProductsToClients: false,
      createdAt: T2.toISOString(), employeeFirstName: null, employeeLastName: null, serviceName: null,
    },
    {
      id: PHOTO_A1, salonId: SALON_A, employeeId: EMP_A, serviceId: SVC_A,
      beforePhotoUrl: "https://x/b1.jpg", afterPhotoUrl: "https://x/a1.jpg", description: "Przed i po",
      productsUsed: "Produkt X", techniques: null, duration: null, showProductsToClients: true,
      createdAt: T1.toISOString(), employeeFirstName: "Anna", employeeLastName: "Test", serviceName: "Strzyżenie A",
    },
  ],
  count: 3,
  filters: {
    employees: [{ id: EMP_A, firstName: "Anna", lastName: "Test" }],
    services: [{ id: SVC_A, name: "Strzyżenie A" }],
  },
};

describe("GET /api/salons/[id]/gallery — publiczna galeria", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seed();
  });

  it("200 — kształt odpowiedzi bez zmian; productsUsed ukryte, gdy showProductsToClients = false", async () => {
    const res = await get(SALON_A);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(EXPECTED_A);
  });

  it("zdjęcie salonu B nie występuje pod adresem salonu A", async () => {
    const body = await (await get(SALON_A)).json();
    expect(body.data.map((p: { id: string }) => p.id)).not.toContain(PHOTO_B1);
    expect(body.data.every((p: { salonId: string }) => p.salonId === SALON_A)).toBe(true);
    // Pracownik i usługa salonu B nie trafiają do filtrów ani do pól zdjęcia.
    expect(JSON.stringify(body)).not.toContain("Beata");
    expect(JSON.stringify(body)).not.toContain("Usługa B");
  });

  it("filtr employeeId pracownika z innego salonu → pusta lista zdjęć tego pracownika z salonu B", async () => {
    const res = await get(SALON_B, `?employeeId=${EMP_A}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual([]);
    expect(body.count).toBe(0);
  });

  it("filtry employeeId, serviceId i pairsOnly zawężają zdjęcia salonu", async () => {
    const byEmp = await (await get(SALON_A, `?employeeId=${EMP_A}`)).json();
    expect(byEmp.data.map((p: { id: string }) => p.id)).toEqual([PHOTO_A2, PHOTO_A1]);
    const bySvc = await (await get(SALON_A, `?serviceId=${SVC_A}`)).json();
    expect(bySvc.data.map((p: { id: string }) => p.id)).toEqual([PHOTO_A1]);
    const pairs = await (await get(SALON_A, "?pairsOnly=true")).json();
    expect(pairs.data.map((p: { id: string }) => p.id)).toEqual([PHOTO_A1]);
  });

  it("forSalon wołany raz, z id z URL; jedna transakcja", async () => {
    await get(SALON_A);
    expect(vi.mocked(forSalon)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(forSalon)).toHaveBeenCalledWith(SALON_A);
    expect(state.transactions).toBe(1);
  });

  it("jawne listy kolumn i eq(salonId) w każdym zapytaniu, także po stronie złączeń", async () => {
    await get(SALON_A);
    expect(selectCalls).toHaveLength(3);
    expect(selectCalls.filter((c) => c.cols === null)).toEqual([]);
    for (const q of selectCalls) {
      expect(q.table).toBe("galleryPhotos");
      expect(whereHasEq(q.where, "galleryPhotos.salonId", SALON_A)).toBe(true);
    }
    const [photos, emps, svcs] = selectCalls;
    // Pracownicy bez phone i email.
    for (const q of selectCalls) {
      expect(Object.values(q.cols!)).not.toContain("employees.phone");
      expect(Object.values(q.cols!)).not.toContain("employees.email");
    }
    expect(photos!.joins).toEqual(["employees", "services"]);
    expect(whereHasEq(emps!.where, "employees.salonId", SALON_A)).toBe(true);
    expect(whereHasEq(svcs!.where, "services.salonId", SALON_A)).toBe(true);
  });

  it.each([
    ["id", "not-a-uuid", ""],
    ["employeeId", SALON_A, "?employeeId=not-a-uuid"],
    ["serviceId", SALON_A, "?serviceId=1;DROP"],
  ])("400 — zły format %s, bez wołania forSalon", async (_label, id, query) => {
    const res = await get(id, query);
    expect(res.status).toBe(400);
    expect((await res.json()).success).toBe(false);
    expect(vi.mocked(forSalon)).not.toHaveBeenCalled();
    expect(state.transactions).toBe(0);
  });

  it("500 przy błędzie bazy", async () => {
    state.failSelect = new Error("db down");
    const res = await get(SALON_A);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ success: false, error: "Failed to fetch gallery photos" });
    expect(logger.error).toHaveBeenCalledTimes(1);
  });
});
