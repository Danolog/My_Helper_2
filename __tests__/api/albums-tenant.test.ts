/**
 * POST + GET /api/albums — izolacja salonu (P1/P2 z przeglądu Ryana).
 *
 * Przed naprawą salonId z body/query => forSalon(salonId): zalogowane konto
 * tworzyło i listowało albumy galerii cudzego salonu. Teraz salon z sesji;
 * dostęp jak do dodawania zdjęć galerii (POST /api/gallery, ROUTE_ROLE_MAP
 * /dashboard/gallery): właściciel i pracownik, recepcja z grantem
 * "gallery-manage".
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET, POST } from "@/app/api/albums/route";
import { SALON_A, SALON_B } from "./salon-staff-harness";

const m = await vi.hoisted(async () =>
  (await import("./salon-staff-harness")).createSalonStaffMocks()
);

vi.mock("next/headers", () => ({ headers: vi.fn().mockResolvedValue(new Headers()) }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: m.getSession } } }));
vi.mock("@/lib/db", () => ({ db: m.db }));
vi.mock("@/lib/temporary-access", () => ({ hasTemporaryAccess: m.hasTemporaryAccess }));

function create(body: Record<string, unknown>) {
  return POST(
    new Request("http://localhost/api/albums", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

const list = (query: string) => GET(new Request(`http://localhost/api/albums${query}`));

const album = (salonId: string) => ({ salonId, name: "Metamorfozy" });

describe("POST /api/albums — izolacja salonu", () => {
  beforeEach(() => m.reset());

  it("owner salonu A nie tworzy albumu w salonie B (403, brak insertu i RLS)", async () => {
    m.asOwnerOf(SALON_A);
    m.txRows.push([{ id: "al-new", salonId: SALON_B, name: "Metamorfozy" }]);

    const res = await create(album(SALON_B));

    expect(res.status).toBe(403);
    expect(m.insertedValues).toEqual([]);
    expect(m.rlsSalonIds()).toEqual([]);
  });

  it("właściciel tworzy album we własnym salonie", async () => {
    m.asOwnerOf(SALON_A);
    m.txRows.push([{ id: "al-new", salonId: SALON_A, name: "Metamorfozy" }]);

    const res = await create(album(SALON_A));

    expect(res.status).toBe(201);
    expect(m.insertedValues).toEqual([expect.objectContaining({ salonId: SALON_A })]);
    expect(new Set(m.rlsSalonIds())).toEqual(new Set([SALON_A]));
  });

  it("pracownik tworzy album we własnym salonie, nie w cudzym", async () => {
    m.asStaffOf(SALON_A, "employee");
    m.txRows.push([{ id: "al-new", salonId: SALON_A, name: "Metamorfozy" }]);
    expect((await create(album(SALON_A))).status).toBe(201);
    expect(m.insertedValues).toEqual([expect.objectContaining({ salonId: SALON_A })]);

    m.reset();
    m.asStaffOf(SALON_A, "employee");
    expect((await create(album(SALON_B))).status).toBe(403);
    expect(m.insertedValues).toEqual([]);
  });

  it("recepcja bez grantu 'gallery-manage' => 403; z grantem => 201", async () => {
    m.asStaffOf(SALON_A, "receptionist");
    expect((await create(album(SALON_A))).status).toBe(403);
    expect(m.insertedValues).toEqual([]);

    m.reset();
    m.asStaffOf(SALON_A, "receptionist");
    m.hasTemporaryAccess.mockResolvedValue(true);
    m.txRows.push([{ id: "al-new", salonId: SALON_A, name: "Metamorfozy" }]);
    expect((await create(album(SALON_A))).status).toBe(201);
  });

  it("konto bez salonu => 404; bez sesji => 401", async () => {
    m.signIn("client-1");
    m.ctxRows.push([], []);
    expect((await create(album(SALON_B))).status).toBe(404);
    expect(m.insertedValues).toEqual([]);

    m.reset();
    m.getSession.mockResolvedValue(null);
    expect((await create(album(SALON_A))).status).toBe(401);
  });
});

describe("GET /api/albums — izolacja salonu", () => {
  beforeEach(() => m.reset());

  it("owner salonu A nie listuje albumów salonu B (403, brak RLS)", async () => {
    m.asOwnerOf(SALON_A);
    m.txRows.push([{ id: "al-b", salonId: SALON_B, name: "Prywatne" }]);

    const res = await list(`?salonId=${SALON_B}`);

    expect(res.status).toBe(403);
    expect(m.rlsSalonIds()).toEqual([]);
  });

  it("konto bez salonu nie czyta albumów salonu B (404)", async () => {
    m.signIn("client-1");
    m.ctxRows.push([], []);
    m.txRows.push([{ id: "al-b", salonId: SALON_B, name: "Prywatne" }]);
    expect((await list(`?salonId=${SALON_B}`)).status).toBe(404);
    expect(m.rlsSalonIds()).toEqual([]);
  });

  it("właściciel bez salonId => własny salon", async () => {
    m.asOwnerOf(SALON_A);
    m.txRows.push([{ id: "al-a", salonId: SALON_A, name: "Metamorfozy" }]);

    const res = await list("");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toEqual([{ id: "al-a", salonId: SALON_A, name: "Metamorfozy" }]);
    expect(new Set(m.rlsSalonIds())).toEqual(new Set([SALON_A]));
  });

  it("pracownik => własny salon; recepcja bez grantu => 403", async () => {
    m.asStaffOf(SALON_A, "employee");
    m.txRows.push([]);
    expect((await list(`?salonId=${SALON_A}`)).status).toBe(200);
    expect(new Set(m.rlsSalonIds())).toEqual(new Set([SALON_A]));

    m.reset();
    m.asStaffOf(SALON_A, "receptionist");
    expect((await list(`?salonId=${SALON_A}`)).status).toBe(403);
  });
});
