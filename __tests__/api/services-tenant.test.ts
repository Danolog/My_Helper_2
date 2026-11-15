/**
 * POST /api/services — izolacja salonu (P1 z przeglądu Ryana).
 *
 * Przed naprawą forSalon(body.salonId): dowolne zalogowane konto tworzyło
 * usługę (z ceną) w cudzym salonie, widoczną w jego portalu rezerwacji.
 * Teraz salon z sesji; tworzenie usług wyłącznie właściciel.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/services/route";
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
    new Request("http://localhost/api/services", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

const service = (salonId: string) => ({
  salonId,
  name: "Strzyżenie",
  basePrice: 1,
  baseDuration: 30,
});

describe("POST /api/services — izolacja salonu", () => {
  beforeEach(() => m.reset());

  it("owner salonu A nie tworzy usługi w salonie B (403, brak insertu i RLS)", async () => {
    m.asOwnerOf(SALON_A);
    m.txRows.push([{ id: "s-new", salonId: SALON_B }]);

    const res = await create(service(SALON_B));

    expect(res.status).toBe(403);
    expect(m.insertedValues).toEqual([]);
    expect(m.rlsSalonIds()).toEqual([]);
  });

  it("właściciel tworzy usługę we własnym salonie", async () => {
    m.asOwnerOf(SALON_A);
    m.txRows.push([{ id: "s-new", salonId: SALON_A }]);

    const res = await create(service(SALON_A));

    expect(res.status).toBe(201);
    expect(m.insertedValues).toEqual([expect.objectContaining({ salonId: SALON_A })]);
    expect(new Set(m.rlsSalonIds())).toEqual(new Set([SALON_A]));
  });

  it("recepcja własnego salonu => 403 (tylko właściciel)", async () => {
    m.asStaffOf(SALON_A, "receptionist");
    const res = await create(service(SALON_A));
    expect(res.status).toBe(403);
    expect(m.insertedValues).toEqual([]);
  });

  it("pracownik z grantem => 403 (grant nie otwiera tworzenia usług)", async () => {
    m.asStaffOf(SALON_A, "employee");
    m.hasTemporaryAccess.mockResolvedValue(true);
    const res = await create(service(SALON_A));
    expect(res.status).toBe(403);
    expect(m.insertedValues).toEqual([]);
  });

  it("konto bez salonu => 404, brak insertu", async () => {
    m.signIn("client-1");
    m.ctxRows.push([], []);
    const res = await create(service(SALON_B));
    expect(res.status).toBe(404);
    expect(m.insertedValues).toEqual([]);
  });

  it("bez sesji => 401", async () => {
    m.getSession.mockResolvedValue(null);
    const res = await create(service(SALON_A));
    expect(res.status).toBe(401);
  });
});
