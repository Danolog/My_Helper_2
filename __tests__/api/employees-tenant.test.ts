/**
 * POST /api/employees — izolacja salonu (P1 z przeglądu bezpieczeństwa).
 *
 * Przed naprawą trasa brała salonId z body i wołała forSalon(body.salonId):
 * każde zalogowane konto (także salonu A albo klient) dodawało pracownika
 * do salonu B. Teraz salon z sesji (requireSalonStaff), body.salonId tylko
 * porównywany; dodawanie pracowników wyłącznie właściciel (salons.ownerId).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/employees/route";
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
    new Request("http://localhost/api/employees", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

const employee = (salonId: string) => ({ salonId, firstName: "Anna", lastName: "Nowak" });

describe("POST /api/employees — izolacja salonu", () => {
  beforeEach(() => m.reset());

  it("owner salonu A nie dodaje pracownika w salonie B (403, brak insertu i RLS)", async () => {
    m.asOwnerOf(SALON_A);
    m.txRows.push([], [{ id: "e-new", salonId: SALON_B }]);

    const res = await create(employee(SALON_B));

    expect(res.status).toBe(403);
    expect(m.insertedValues).toEqual([]);
    expect(m.rlsSalonIds()).toEqual([]);
  });

  it("właściciel dodaje pracownika we własnym salonie (insert i RLS z salonem sesji)", async () => {
    m.asOwnerOf(SALON_A);
    m.txRows.push([], [{ id: "e-new", salonId: SALON_A }]);

    const res = await create(employee(SALON_A));

    expect(res.status).toBe(201);
    expect(m.insertedValues).toEqual([expect.objectContaining({ salonId: SALON_A })]);
    expect(new Set(m.rlsSalonIds())).toEqual(new Set([SALON_A]));
  });

  it("recepcja własnego salonu => 403 (tylko właściciel)", async () => {
    m.asStaffOf(SALON_A, "receptionist");
    const res = await create(employee(SALON_A));
    expect(res.status).toBe(403);
    expect(m.insertedValues).toEqual([]);
  });

  it("pracownik własnego salonu => 403 nawet z dowolnym grantem", async () => {
    m.asStaffOf(SALON_A, "employee");
    m.hasTemporaryAccess.mockResolvedValue(true);
    const res = await create(employee(SALON_A));
    expect(res.status).toBe(403);
    expect(m.insertedValues).toEqual([]);
  });

  it("konto bez salonu (np. klient) => 404, brak insertu", async () => {
    m.signIn("client-1");
    m.ctxRows.push([], []);
    const res = await create(employee(SALON_B));
    expect(res.status).toBe(404);
    expect(m.insertedValues).toEqual([]);
  });

  it("bez sesji => 401", async () => {
    m.getSession.mockResolvedValue(null);
    const res = await create(employee(SALON_A));
    expect(res.status).toBe(401);
  });
});
