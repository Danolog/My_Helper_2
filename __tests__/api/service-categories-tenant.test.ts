/**
 * POST /api/service-categories — izolacja salonu (P1 z przeglądu Ryana).
 *
 * Przed naprawą forSalon(body.salonId) — kategoria w cudzym salonie z
 * samym logowaniem. Teraz salon z sesji; tylko właściciel (spójnie z
 * PUT/DELETE /api/service-categories/[id], które biorą salon właściciela).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/service-categories/route";
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
    new Request("http://localhost/api/service-categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

const category = (salonId: string) => ({ salonId, name: "Koloryzacja" });

describe("POST /api/service-categories — izolacja salonu", () => {
  beforeEach(() => m.reset());

  it("owner salonu A nie tworzy kategorii w salonie B (403, brak insertu i RLS)", async () => {
    m.asOwnerOf(SALON_A);
    m.txRows.push([{ id: "c-new", salonId: SALON_B }]);

    const res = await create(category(SALON_B));

    expect(res.status).toBe(403);
    expect(m.insertedValues).toEqual([]);
    expect(m.rlsSalonIds()).toEqual([]);
  });

  it("właściciel tworzy kategorię we własnym salonie", async () => {
    m.asOwnerOf(SALON_A);
    m.txRows.push([{ id: "c-new", salonId: SALON_A }]);

    const res = await create(category(SALON_A));

    expect(res.status).toBe(201);
    expect(m.insertedValues).toEqual([expect.objectContaining({ salonId: SALON_A })]);
    expect(new Set(m.rlsSalonIds())).toEqual(new Set([SALON_A]));
  });

  it("pracownik własnego salonu => 403 (tylko właściciel)", async () => {
    m.asStaffOf(SALON_A, "employee");
    m.hasTemporaryAccess.mockResolvedValue(true);
    const res = await create(category(SALON_A));
    expect(res.status).toBe(403);
    expect(m.insertedValues).toEqual([]);
  });

  it("konto bez salonu => 404", async () => {
    m.signIn("client-1");
    m.ctxRows.push([], []);
    const res = await create(category(SALON_B));
    expect(res.status).toBe(404);
    expect(m.insertedValues).toEqual([]);
  });

  it("bez sesji => 401", async () => {
    m.getSession.mockResolvedValue(null);
    const res = await create(category(SALON_A));
    expect(res.status).toBe(401);
  });
});
