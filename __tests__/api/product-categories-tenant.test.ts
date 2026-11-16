/**
 * POST + GET /api/product-categories — izolacja salonu (P1/P2 z przeglądu Ryana).
 *
 * Przed naprawą obie metody brały salonId z żądania (body / query) i wołały
 * forSalon(salonId): zalogowane konto czytało i zapisywało kategorie
 * magazynu cudzego salonu. Teraz salon z sesji; dostęp jak do magazynu
 * (/api/products): właściciel albo czasowy grant "products".
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET, POST } from "@/app/api/product-categories/route";
import { SALON_A, SALON_B } from "./salon-staff-harness";

const m = await vi.hoisted(async () =>
  (await import("./salon-staff-harness")).createSalonStaffMocks()
);

vi.mock("next/headers", () => ({ headers: vi.fn().mockResolvedValue(new Headers()) }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: m.getSession } } }));
vi.mock("@/lib/db", () => ({ db: m.db }));
vi.mock("@/lib/server/system/db-system", () => ({ dbSystem: m.dbSystem }));
vi.mock("@/lib/temporary-access", () => ({ hasTemporaryAccess: m.hasTemporaryAccess }));

function create(body: Record<string, unknown>) {
  return POST(
    new Request("http://localhost/api/product-categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

const list = (query: string) =>
  GET(new Request(`http://localhost/api/product-categories${query}`));

const category = (salonId: string) => ({ salonId, name: "Farby" });

/** Wyniki tx dla POST: duplikat? (brak), max sortOrder, insert. */
function pushCreateRows(salonId: string) {
  m.txRows.push([], [{ max: 2 }], [{ id: "pc-new", salonId, name: "Farby" }]);
}

describe("POST /api/product-categories — izolacja salonu", () => {
  beforeEach(() => m.reset());

  it("owner salonu A nie tworzy kategorii w salonie B (403, brak insertu i RLS)", async () => {
    m.asOwnerOf(SALON_A);
    pushCreateRows(SALON_B);

    const res = await create(category(SALON_B));

    expect(res.status).toBe(403);
    expect(m.insertedValues).toEqual([]);
    expect(m.rlsSalonIds()).toEqual([]);
  });

  it("właściciel tworzy kategorię we własnym salonie", async () => {
    m.asOwnerOf(SALON_A);
    pushCreateRows(SALON_A);

    const res = await create(category(SALON_A));

    expect(res.status).toBe(201);
    expect(m.insertedValues).toEqual([expect.objectContaining({ salonId: SALON_A })]);
    expect(new Set(m.rlsSalonIds())).toEqual(new Set([SALON_A]));
  });

  it("pracownik bez grantu 'products' => 403", async () => {
    m.asStaffOf(SALON_A, "employee");
    const res = await create(category(SALON_A));
    expect(res.status).toBe(403);
    expect(m.insertedValues).toEqual([]);
  });

  it("pracownik z grantem tworzy kategorię we własnym salonie", async () => {
    m.asStaffOf(SALON_A, "receptionist");
    m.hasTemporaryAccess.mockResolvedValue(true);
    pushCreateRows(SALON_A);
    const res = await create(category(SALON_A));
    expect(res.status).toBe(201);
    expect(m.insertedValues).toEqual([expect.objectContaining({ salonId: SALON_A })]);
  });

  it("pracownik z grantem nie tworzy kategorii w cudzym salonie (403)", async () => {
    m.asStaffOf(SALON_A, "receptionist");
    m.hasTemporaryAccess.mockResolvedValue(true);
    const res = await create(category(SALON_B));
    expect(res.status).toBe(403);
    expect(m.insertedValues).toEqual([]);
  });

  it("konto bez salonu => 404; bez sesji => 401", async () => {
    m.signIn("client-1");
    m.ctxRows.push([], []);
    expect((await create(category(SALON_B))).status).toBe(404);

    m.reset();
    m.getSession.mockResolvedValue(null);
    expect((await create(category(SALON_A))).status).toBe(401);
  });
});

describe("GET /api/product-categories — izolacja salonu", () => {
  beforeEach(() => m.reset());

  it("owner salonu A nie listuje kategorii salonu B (403, brak RLS)", async () => {
    m.asOwnerOf(SALON_A);
    m.txRows.push([{ id: "pc-b", salonId: SALON_B, name: "Tajne" }]);

    const res = await list(`?salonId=${SALON_B}`);

    expect(res.status).toBe(403);
    expect(m.rlsSalonIds()).toEqual([]);
  });

  it("konto bez salonu nie czyta kategorii salonu B (404)", async () => {
    m.signIn("client-1");
    m.ctxRows.push([], []);
    m.txRows.push([{ id: "pc-b", salonId: SALON_B, name: "Tajne" }]);

    const res = await list(`?salonId=${SALON_B}`);

    expect(res.status).toBe(404);
    expect(m.rlsSalonIds()).toEqual([]);
  });

  it("właściciel bez salonId => własny salon", async () => {
    m.asOwnerOf(SALON_A);
    m.txRows.push([{ id: "pc-a", salonId: SALON_A, name: "Farby" }]);

    const res = await list("");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toEqual([{ id: "pc-a", salonId: SALON_A, name: "Farby" }]);
    expect(new Set(m.rlsSalonIds())).toEqual(new Set([SALON_A]));
  });

  it("pracownik bez grantu => 403; z grantem => własny salon", async () => {
    m.asStaffOf(SALON_A, "employee");
    expect((await list(`?salonId=${SALON_A}`)).status).toBe(403);

    m.reset();
    m.asStaffOf(SALON_A, "employee");
    m.hasTemporaryAccess.mockResolvedValue(true);
    m.txRows.push([]);
    expect((await list(`?salonId=${SALON_A}`)).status).toBe(200);
    expect(new Set(m.rlsSalonIds())).toEqual(new Set([SALON_A]));
  });
});
