/**
 * POST + GET /api/products — izolacja salonu (P1 z przeglądu Ryana).
 *
 * Przed naprawą kontrola salonu była warunkowana `ctx.role !== "owner"`:
 * KAŻDY właściciel był z niej zwolniony — owner salonu A dodawał produkt
 * do salonu B (body.salonId) i listował magazyn salonu B (?salonId=B).
 * Teraz salon z sesji (requireSalonStaff), wartość z żądania tylko
 * porównywana; dostęp właściciel albo czasowy grant "products".
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET, POST } from "@/app/api/products/route";
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
    new Request("http://localhost/api/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

const list = (query: string) => GET(new Request(`http://localhost/api/products${query}`));

const product = (salonId: string) => ({ salonId, name: "Szampon", quantity: 5 });
const row = (salonId: string) => ({
  id: "pr-new", salonId, name: "Szampon", quantity: "5", minQuantity: null, unit: null,
});

describe("POST /api/products — izolacja salonu", () => {
  beforeEach(() => m.reset());

  it("łańcuch z raportu: owner salonu A nie dodaje produktu w salonie B (403, brak insertu)", async () => {
    m.asOwnerOf(SALON_A);
    m.txRows.push([row(SALON_B)]);

    const res = await create(product(SALON_B));

    expect(res.status).toBe(403);
    expect(m.insertedValues).toEqual([]);
    expect(m.rlsSalonIds()).toEqual([]);
  });

  it("właściciel dodaje produkt we własnym salonie", async () => {
    m.asOwnerOf(SALON_A);
    m.txRows.push([row(SALON_A)]);

    const res = await create(product(SALON_A));

    expect(res.status).toBe(201);
    expect(m.insertedValues).toEqual([expect.objectContaining({ salonId: SALON_A })]);
    expect(new Set(m.rlsSalonIds())).toEqual(new Set([SALON_A]));
  });

  it("pracownik bez grantu 'products' => 403", async () => {
    m.asStaffOf(SALON_A, "receptionist");
    const res = await create(product(SALON_A));
    expect(res.status).toBe(403);
    expect(m.insertedValues).toEqual([]);
  });

  it("pracownik z grantem dodaje produkt we własnym salonie, nie w cudzym", async () => {
    m.asStaffOf(SALON_A, "employee");
    m.hasTemporaryAccess.mockResolvedValue(true);
    m.txRows.push([row(SALON_A)]);
    expect((await create(product(SALON_A))).status).toBe(201);
    expect(m.insertedValues).toEqual([expect.objectContaining({ salonId: SALON_A })]);

    m.reset();
    m.asStaffOf(SALON_A, "employee");
    m.hasTemporaryAccess.mockResolvedValue(true);
    expect((await create(product(SALON_B))).status).toBe(403);
    expect(m.insertedValues).toEqual([]);
  });

  it("konto bez salonu => 404; bez sesji => 401", async () => {
    m.signIn("client-1");
    m.ctxRows.push([], []);
    expect((await create(product(SALON_B))).status).toBe(404);

    m.reset();
    m.getSession.mockResolvedValue(null);
    expect((await create(product(SALON_A))).status).toBe(401);
  });
});

describe("GET /api/products — izolacja salonu", () => {
  beforeEach(() => m.reset());

  it("owner salonu A nie listuje magazynu salonu B (403, brak RLS)", async () => {
    m.asOwnerOf(SALON_A);
    m.txRows.push([row(SALON_B)]);

    const res = await list(`?salonId=${SALON_B}`);

    expect(res.status).toBe(403);
    expect(m.rlsSalonIds()).toEqual([]);
  });

  it("właściciel bez salonId => własny salon", async () => {
    m.asOwnerOf(SALON_A);
    m.txRows.push([row(SALON_A)]);

    const res = await list("");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toEqual([row(SALON_A)]);
    expect(new Set(m.rlsSalonIds())).toEqual(new Set([SALON_A]));
  });

  it("pracownik z grantem i ?salonId=B => 403 (wcześniej po cichu własny)", async () => {
    m.asStaffOf(SALON_A, "employee");
    m.hasTemporaryAccess.mockResolvedValue(true);
    const res = await list(`?salonId=${SALON_B}`);
    expect(res.status).toBe(403);
    expect(m.rlsSalonIds()).toEqual([]);
  });

  it("pracownik bez grantu => 403", async () => {
    m.asStaffOf(SALON_A, "employee");
    expect((await list(`?salonId=${SALON_A}`)).status).toBe(403);
    expect(m.rlsSalonIds()).toEqual([]);
  });

  it("pracownik z grantem bez salonId => własny salon", async () => {
    m.asStaffOf(SALON_A, "employee");
    m.hasTemporaryAccess.mockResolvedValue(true);
    m.txRows.push([row(SALON_A)]);
    const res = await list("");
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual([row(SALON_A)]);
    expect(new Set(m.rlsSalonIds())).toEqual(new Set([SALON_A]));
  });
});
