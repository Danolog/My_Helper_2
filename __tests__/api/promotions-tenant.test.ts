/**
 * POST /api/promotions — izolacja salonu (P0 z przeglądu bezpieczeństwa).
 *
 * Przed naprawą warunek `ctx.role !== "owner" && salonId !== ctx.salonId`
 * zwalniał KAŻDEGO właściciela z kontroli salonu: owner salonu A tworzył
 * promocję w salonie B (id salonów są publiczne), a forSalon(body.salonId)
 * ustawiał RLS na salon B. Teraz salon z sesji; dostęp właściciel albo
 * czasowy grant "promotions".
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET, POST } from "@/app/api/promotions/route";
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
    new Request("http://localhost/api/promotions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

const promo = (salonId: string) => ({
  salonId,
  name: "Black Friday",
  type: "percentage",
  value: 90,
});

describe("POST /api/promotions — izolacja salonu", () => {
  beforeEach(() => m.reset());

  it("łańcuch z raportu: owner salonu A nie tworzy promocji w salonie B (403, brak insertu)", async () => {
    m.asOwnerOf(SALON_A);
    m.txRows.push([{ id: "p-new", salonId: SALON_B, name: "Black Friday" }]);

    const res = await create(promo(SALON_B));

    expect(res.status).toBe(403);
    expect(m.insertedValues).toEqual([]);
    expect(m.rlsSalonIds()).toEqual([]);
  });

  it("właściciel tworzy promocję we własnym salonie (insert z salonem sesji)", async () => {
    m.asOwnerOf(SALON_A);
    m.txRows.push([{ id: "p-new", salonId: SALON_A, name: "Black Friday" }]);

    const res = await create(promo(SALON_A));

    expect(res.status).toBe(201);
    expect(m.insertedValues).toEqual([expect.objectContaining({ salonId: SALON_A })]);
    expect(new Set(m.rlsSalonIds())).toEqual(new Set([SALON_A]));
  });

  it("pracownik bez grantu 'promotions' => 403", async () => {
    m.asStaffOf(SALON_A, "receptionist");
    const res = await create(promo(SALON_A));
    expect(res.status).toBe(403);
    expect(m.insertedValues).toEqual([]);
  });

  it("pracownik z grantem tworzy promocję we własnym salonie", async () => {
    m.asStaffOf(SALON_A, "employee");
    m.hasTemporaryAccess.mockResolvedValue(true);
    m.txRows.push([{ id: "p-new", salonId: SALON_A, name: "Black Friday" }]);
    const res = await create(promo(SALON_A));
    expect(res.status).toBe(201);
    expect(m.insertedValues).toEqual([expect.objectContaining({ salonId: SALON_A })]);
  });

  it("pracownik z grantem nie tworzy promocji w cudzym salonie (403)", async () => {
    m.asStaffOf(SALON_A, "employee");
    m.hasTemporaryAccess.mockResolvedValue(true);
    const res = await create(promo(SALON_B));
    expect(res.status).toBe(403);
    expect(m.insertedValues).toEqual([]);
  });

  it("konto bez salonu => 404", async () => {
    m.signIn("client-1");
    m.ctxRows.push([], []);
    const res = await create(promo(SALON_B));
    expect(res.status).toBe(404);
  });

  it("bez sesji => 401", async () => {
    m.getSession.mockResolvedValue(null);
    const res = await create(promo(SALON_A));
    expect(res.status).toBe(401);
  });
});

describe("GET /api/promotions — izolacja salonu", () => {
  beforeEach(() => m.reset());

  const list = (query: string) =>
    GET(new Request(`http://localhost/api/promotions${query}`));

  it("właściciel salonu A nie listuje promocji salonu B (403)", async () => {
    m.asOwnerOf(SALON_A);
    m.txRows.push([{ id: "p-b", salonId: SALON_B, name: "Tajna -90%" }]);

    const res = await list(`?salonId=${SALON_B}`);

    expect(res.status).toBe(403);
    expect(m.rlsSalonIds()).toEqual([]);
  });

  it("właściciel bez salonId => tylko własny salon (nie katalog wszystkich salonów)", async () => {
    m.asOwnerOf(SALON_A);
    m.txRows.push([{ id: "p-a", salonId: SALON_A, name: "Lato" }]);

    const res = await list("");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toEqual([{ id: "p-a", salonId: SALON_A, name: "Lato" }]);
    expect(new Set(m.rlsSalonIds())).toEqual(new Set([SALON_A]));
  });

  it("pracownik bez grantu => 403", async () => {
    m.asStaffOf(SALON_A, "employee");
    const res = await list(`?salonId=${SALON_A}`);
    expect(res.status).toBe(403);
  });

  it("pracownik z grantem => własny salon", async () => {
    m.asStaffOf(SALON_A, "receptionist");
    m.hasTemporaryAccess.mockResolvedValue(true);
    m.txRows.push([{ id: "p-a", salonId: SALON_A, name: "Lato" }]);
    const res = await list(`?salonId=${SALON_A}`);
    expect(res.status).toBe(200);
    expect(new Set(m.rlsSalonIds())).toEqual(new Set([SALON_A]));
  });
});
