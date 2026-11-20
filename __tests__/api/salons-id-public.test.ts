/**
 * GET i PUT /api/salons/[id].
 *
 * - GET: publiczny katalog salonu w `unstable_cache`. Odczyty w jednej
 *   transakcji forSalon(id z URL), jawne listy kolumn, kształt odpowiedzi bez
 *   zmian. Atrapa `unstable_cache` rozróżnia klucze jak Next (keyParts +
 *   argumenty), więc test dwóch salonów wyłapie salonId tylko w domknięciu;
 *   błąd bazy nie może trafić do cache.
 * - PUT: właściciel; odczyt własności przez forSalon (404 vs 403 jak dotąd),
 *   UPDATE tylko podstawowych pól (settingsJson nietknięty).
 *
 * Atrapa bazy: tabele-fikstury z `./salon-public-fixture` (WHERE trasy
 * wykonywany na wierszach), warstwa repozytorium prawdziwa.
 */
import { NextResponse } from "next/server";
import { describe, it, expect, vi, beforeEach } from "vitest";
// vi.mock niżej jest hoistowany przez vitest — trasa importuje już atrapy.
import { GET, PUT } from "@/app/api/salons/[id]/route";
import { requireAuth } from "@/lib/auth-middleware";
import { forSalon } from "@/lib/server/repository";
import {
  cacheConfigs,
  cacheStore,
  columnsReadFrom,
  resetFixture,
  selectCalls,
  state,
  tables,
  whereHasEq,
} from "./salon-public-fixture";

vi.mock("@/lib/db", async () => ({ db: (await import("./salon-public-fixture")).db }));
vi.mock("@/lib/schema", async () => (await import("./salon-public-fixture")).schemaMock);
vi.mock("drizzle-orm", async () => (await import("./salon-public-fixture")).drizzleMock);
vi.mock("next/cache", async () => (await import("./salon-public-fixture")).nextCacheMock);
vi.mock("@/lib/server/repository", async (orig) => {
  const actual = await orig<typeof import("@/lib/server/repository")>();
  return { ...actual, forSalon: vi.fn(actual.forSalon) };
});
vi.mock("@/lib/auth-middleware", () => ({
  requireAuth: vi.fn(),
  isAuthError: (r: unknown) => r instanceof Response,
}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const SALON_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SALON_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MISSING_SALON = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OWNER_A = "user-owner-a";
const OWNER_B = "user-owner-b";
const EMP_A = "11111111-1111-4111-8111-111111111111";
const EMP_B = "22222222-2222-4222-8222-222222222222";
const SVC_A = "44444444-4444-4444-8444-444444444444";
const SVC_A_INACTIVE = "66666666-6666-4666-8666-666666666666";
const SVC_B = "55555555-5555-4555-8555-555555555555";
const CAT_A = "77777777-7777-4777-8777-777777777777";
const VAR_A = "88888888-8888-4888-8888-888888888888";

const CREATED = new Date("2026-01-01T08:00:00Z");
const UPDATED = new Date("2026-01-05T08:00:00Z");

function salonRow(id: string, ownerId: string, name: string) {
  return {
    id, name, ownerId,
    phone: "+48500000000", email: `${name}@example.com`, address: "Ul. Testowa 1", industryType: "spa",
    settingsJson: { fiscal: { printerIp: "10.0.0.5" }, loyalty: { enabled: true } },
    createdAt: CREATED, updatedAt: UPDATED,
  };
}

function serviceRow(id: string, salonId: string, name: string, extra: Record<string, unknown> = {}) {
  return {
    id, salonId, name, categoryId: null, description: null, basePrice: "100.00", baseDuration: 30,
    suggestedNextVisitDays: null, depositRequired: false, depositPercentage: 30, isActive: true, ...extra,
  };
}

function employeeRow(id: string, salonId: string, firstName: string) {
  return {
    id, salonId, firstName, lastName: "Test", role: "employee", photoUrl: null, color: "#3b82f6",
    isActive: true, phone: "+48600000000", email: `${firstName}@example.com`,
  };
}

function seed() {
  resetFixture({
    salons: [salonRow(SALON_A, OWNER_A, "SalonA"), salonRow(SALON_B, OWNER_B, "SalonB")],
    services: [
      serviceRow(SVC_A, SALON_A, "Strzyżenie A", { categoryId: CAT_A, description: "Opis" }),
      serviceRow(SVC_A_INACTIVE, SALON_A, "Wycofana A", { isActive: false }),
      serviceRow(SVC_B, SALON_B, "Usługa B"),
    ],
    serviceCategories: [
      { id: CAT_A, salonId: SALON_A, name: "Włosy", sortOrder: 1 },
      { id: "99999999-9999-4999-8999-999999999999", salonId: SALON_B, name: "Kat B", sortOrder: 0 },
    ],
    serviceVariants: [
      { id: VAR_A, serviceId: SVC_A, name: "Długie", priceModifier: "20.00", durationModifier: 15 },
    ],
    employees: [employeeRow(EMP_A, SALON_A, "Anna"), employeeRow(EMP_B, SALON_B, "Beata")],
    employeeServices: [
      { employeeId: EMP_A, serviceId: SVC_A },
      // Wadliwe przypisanie do usługi obcego salonu — jawne eq(services.salonId) je odcina.
      { employeeId: EMP_A, serviceId: SVC_B },
      { employeeId: EMP_B, serviceId: SVC_B },
    ],
    reviews: [
      { id: "r1", salonId: SALON_A, employeeId: EMP_A, rating: 5, status: "approved" },
      { id: "r2", salonId: SALON_A, employeeId: EMP_A, rating: 4, status: "approved" },
      { id: "r3", salonId: SALON_A, employeeId: EMP_A, rating: 1, status: "pending" },
      // Wadliwa opinia z obcego salonu o pracowniku A — jawne eq(reviews.salonId) ją odcina.
      { id: "r4", salonId: SALON_B, employeeId: EMP_A, rating: 1, status: "approved" },
      { id: "r5", salonId: SALON_B, employeeId: EMP_B, rating: 2, status: "approved" },
    ],
    galleryPhotos: [
      { id: "g1", salonId: SALON_A, employeeId: EMP_A },
      { id: "g2", salonId: SALON_A, employeeId: null },
    ],
  });
}

/** Odpowiedź GET dla salonu A, jak ją zwracał kod sprzed zmiany (po JSON). */
const EXPECTED_A = {
  id: SALON_A,
  name: "SalonA",
  phone: "+48500000000",
  email: "SalonA@example.com",
  address: "Ul. Testowa 1",
  industryType: "spa",
  createdAt: CREATED.toISOString(),
  updatedAt: UPDATED.toISOString(),
  services: [
    {
      id: SVC_A, salonId: SALON_A, categoryId: CAT_A, name: "Strzyżenie A", description: "Opis",
      basePrice: "100.00", baseDuration: 30, suggestedNextVisitDays: null, depositRequired: false,
      depositPercentage: 30, isActive: true, categoryName: "Włosy",
      variants: [{ id: VAR_A, serviceId: SVC_A, name: "Długie", priceModifier: "20.00", durationModifier: 15 }],
    },
  ],
  categories: [{ id: CAT_A, salonId: SALON_A, name: "Włosy", sortOrder: 1 }],
  employees: [
    {
      id: EMP_A, firstName: "Anna", lastName: "Test", role: "employee", photoUrl: null, color: "#3b82f6",
      specialties: ["Strzyżenie A"], averageRating: 4.5, reviewCount: 2, galleryCount: 1,
    },
  ],
  averageRating: 4.5,
};

const get = (id: string) =>
  GET(new Request(`http://localhost/api/salons/${id}`), { params: Promise.resolve({ id }) });

describe("GET /api/salons/[id] — publiczny katalog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seed();
  });

  it("200 — kształt odpowiedzi bez zmian", async () => {
    const res = await get(SALON_A);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: EXPECTED_A });
  });

  it("bez settingsJson i ownerId; salon czytany jawną listą publicznych kolumn", async () => {
    const body = await (await get(SALON_A)).json();
    expect(body.data).not.toHaveProperty("settingsJson");
    expect(body.data).not.toHaveProperty("ownerId");
    expect(columnsReadFrom("salons")).toEqual([
      ["salons.id", "salons.name", "salons.phone", "salons.email", "salons.address",
        "salons.industryType", "salons.createdAt", "salons.updatedAt"],
    ]);
  });

  it("żadne zapytanie nie jest select() bez listy kolumn; pracownicy bez phone i email", async () => {
    await get(SALON_A);
    expect(selectCalls.length).toBeGreaterThan(0);
    expect(selectCalls.filter((c) => c.cols === null)).toEqual([]);
    for (const cols of columnsReadFrom("employees")) {
      expect(cols).not.toContain("employees.phone");
      expect(cols).not.toContain("employees.email");
    }
  });

  it("jawne eq(salonId) w zapytaniach tabel z salon_id", async () => {
    await get(SALON_A);
    const byTable = (t: string) => selectCalls.filter((c) => c.table === t);
    for (const [table, col] of [
      ["services", "services.salonId"],
      ["serviceCategories", "serviceCategories.salonId"],
      ["employees", "employees.salonId"],
      ["galleryPhotos", "galleryPhotos.salonId"],
    ] as const) {
      expect(byTable(table).length, table).toBeGreaterThan(0);
      for (const q of byTable(table)) expect(whereHasEq(q.where, col, SALON_A), table).toBe(true);
    }
    for (const q of byTable("reviews")) expect(whereHasEq(q.where, "reviews.salonId", SALON_A)).toBe(true);
    for (const q of byTable("employeeServices")) expect(whereHasEq(q.where, "services.salonId", SALON_A)).toBe(true);
  });

  it("forSalon wołany raz, z id z URL; jedna transakcja", async () => {
    await get(SALON_A);
    expect(vi.mocked(forSalon)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(forSalon)).toHaveBeenCalledWith(SALON_A);
    expect(state.transactions).toBe(1);
  });

  it("cache: dwa salony → dwa różne wyniki z tej samej funkcji opakowanej (klucz zawiera salonId)", async () => {
    const a = await (await get(SALON_A)).json();
    const b = await (await get(SALON_B)).json();
    expect(a.data.id).toBe(SALON_A);
    expect(b.data.id).toBe(SALON_B);
    expect(b.data.services.map((s: { id: string }) => s.id)).toEqual([SVC_B]);
    expect(b.data.employees.map((e: { id: string }) => e.id)).toEqual([EMP_B]);
    expect(cacheStore.size).toBe(2);
    // Trafienie w cache: drugi GET salonu A bez nowej transakcji, te same dane.
    const again = await (await get(SALON_A)).json();
    expect(again).toEqual(a);
    expect(state.transactions).toBe(2);
  });

  it("cache: klucz, tagi i rewalidacja bez zmian", () => {
    expect(cacheConfigs).toContainEqual({
      keyParts: ["salon-detail"],
      options: { revalidate: 30, tags: ["salon-detail"] },
    });
  });

  it("500 przy błędzie bazy, a błąd NIE trafia do cache (kolejny GET czyta bazę)", async () => {
    state.failSelect = new Error("db down");
    const res = await get(SALON_A);
    expect(res.status).toBe(500);
    expect((await res.json()).success).toBe(false);
    expect(cacheStore.size).toBe(0);

    const ok = await get(SALON_A);
    expect(ok.status).toBe(200);
    expect((await ok.json()).data).toEqual(EXPECTED_A);
  });

  it("404 — salon nie istnieje", async () => {
    const res = await get(MISSING_SALON);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, error: "Salon not found" });
  });

  it("400 — zły format id, bez wołania forSalon i bez cache", async () => {
    const res = await get("not-a-uuid");
    expect(res.status).toBe(400);
    expect((await res.json()).success).toBe(false);
    expect(vi.mocked(forSalon)).not.toHaveBeenCalled();
    expect(cacheStore.size).toBe(0);
  });
});

const VALID_BODY = {
  name: "Nowa nazwa",
  phone: "500600700",
  email: "nowy@example.com",
  address: "Ul. Nowa 2",
  industryType: "spa",
};

const put = (id: string, body: unknown = VALID_BODY) =>
  PUT(
    new Request(`http://localhost/api/salons/${id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) }
  );

function loginAs(userId: string) {
  vi.mocked(requireAuth).mockResolvedValue({ user: { id: userId } } as Awaited<ReturnType<typeof requireAuth>>);
}

describe("PUT /api/salons/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seed();
    loginAs(OWNER_A);
  });

  it("200 — właściciel aktualizuje dane; settingsJson i ownerId nietknięte", async () => {
    const res = await put(SALON_A);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({
      success: true,
      message: "Dane salonu zaktualizowane",
      data: {
        id: SALON_A,
        name: "Nowa nazwa",
        phone: "500600700",
        email: "nowy@example.com",
        address: "Ul. Nowa 2",
        industryType: "spa",
      },
    });
    const row = tables.salons!.find((s) => s.id === SALON_A)!;
    expect(row.settingsJson).toEqual({ fiscal: { printerIp: "10.0.0.5" }, loyalty: { enabled: true } });
    expect(row.ownerId).toBe(OWNER_A);
    expect(tables.salons!.find((s) => s.id === SALON_B)!.name).toBe("SalonB");
  });

  it("odczyt własności i UPDATE przez forSalon(id z URL); odczyt jawnymi kolumnami id, ownerId", async () => {
    await put(SALON_A);
    expect(vi.mocked(forSalon).mock.calls).toEqual([[SALON_A], [SALON_A]]);
    expect(columnsReadFrom("salons")).toEqual([["salons.id", "salons.ownerId"]]);
  });

  it("401 — bez sesji", async () => {
    vi.mocked(requireAuth).mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }) as Awaited<ReturnType<typeof requireAuth>>
    );
    const res = await put(SALON_A);
    expect(res.status).toBe(401);
    expect(vi.mocked(forSalon)).not.toHaveBeenCalled();
  });

  it("403 — cudzy salon (RLS po id widzi wiersz, właściciel się nie zgadza); bez zapisu", async () => {
    const res = await put(SALON_B);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ success: false, error: "Brak uprawnien" });
    expect(tables.salons!.find((s) => s.id === SALON_B)!.name).toBe("SalonB");
    expect(vi.mocked(forSalon)).toHaveBeenCalledTimes(1);
  });

  it("404 — salon nie istnieje", async () => {
    const res = await put(MISSING_SALON);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, error: "Salon nie znaleziony" });
  });

  it("400 — zły format id, bez wołania forSalon", async () => {
    const res = await put("not-a-uuid");
    expect(res.status).toBe(400);
    expect(vi.mocked(forSalon)).not.toHaveBeenCalled();
  });

  it("400 — niepoprawne body (walidacja Zod) po sprawdzeniu własności", async () => {
    const res = await put(SALON_A, { name: "" });
    expect(res.status).toBe(400);
    expect(tables.salons!.find((s) => s.id === SALON_A)!.name).toBe("SalonA");
  });

  it("500 — błąd bazy przy odczycie własności", async () => {
    state.failSelect = new Error("db down");
    const res = await put(SALON_A);
    expect(res.status).toBe(500);
    expect((await res.json()).success).toBe(false);
  });

  it("rewalidacja: konfiguracja tagu katalogu bez zmian po stronie GET", () => {
    // PUT dziś nie woła revalidateTag (stan sprzed zmiany, zachowany);
    // katalog odświeża się po `revalidate: 30` z tagiem `salon-detail`.
    expect(cacheConfigs).toContainEqual({
      keyParts: ["salon-detail"],
      options: { revalidate: 30, tags: ["salon-detail"] },
    });
  });
});
