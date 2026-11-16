/**
 * POST /api/services — izolacja salonu (P1 z przeglądu Ryana).
 *
 * Przed naprawą forSalon(body.salonId): dowolne zalogowane konto tworzyło
 * usługę (z ceną) w cudzym salonie, widoczną w jego portalu rezerwacji.
 * Teraz salon z sesji; tworzenie usług wyłącznie właściciel.
 *
 * GET /api/services — izolacja salonu (#73). Przed naprawą salonId z query szedł
 * prosto do forSalon(), więc dowolne zalogowane konto czytało pełną listę usług
 * cudzego salonu (z nieaktywnymi). Teraz salon z sesji, query tylko porównywane.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET, POST } from "@/app/api/services/route";
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

function list(query = "") {
  return GET(new Request(`http://localhost/api/services${query}`));
}

describe("GET /api/services — izolacja salonu (#73)", () => {
  beforeEach(() => m.reset());

  it("klient portalu (konto bez salonu) nie czyta usług salonu B: 404, bez zapytania o usługi", async () => {
    m.signIn("client-1");
    m.ctxRows.push([], []);
    m.txRows.push([{ service: { id: "s-b", salonId: SALON_B, isActive: false }, category: null }]);

    const res = await list(`?salonId=${SALON_B}`);

    expect(res.status).toBe(404);
    expect(m.rlsSalonIds()).toEqual([]);
    expect(m.txRows).toHaveLength(1);
  });

  it("właściciel salonu A z salonId=B => 403, bez zapytania o usługi", async () => {
    m.asOwnerOf(SALON_A);
    m.txRows.push([{ service: { id: "s-b", salonId: SALON_B }, category: null }]);

    const res = await list(`?salonId=${SALON_B}&activeOnly=true`);

    expect(res.status).toBe(403);
    expect(m.rlsSalonIds()).toEqual([]);
    expect(m.txRows).toHaveLength(1);
  });

  it.each(["", `?salonId=${SALON_A}`, `?salonId=${SALON_A}&activeOnly=true`])(
    "właściciel czyta własny salon (%s) => 200, kontekst RLS tylko A",
    async (query) => {
      m.asOwnerOf(SALON_A);
      m.txRows.push([{ service: { id: "s-a", salonId: SALON_A }, category: null }]);

      const res = await list(query);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data).toEqual([expect.objectContaining({ id: "s-a" })]);
      expect(new Set(m.rlsSalonIds())).toEqual(new Set([SALON_A]));
    }
  );

  it.each(["receptionist", "employee"] as const)(
    "%s własnego salonu czyta listę bez salonId w query (podgląd kalendarza)",
    async (role) => {
      m.asStaffOf(SALON_A, role);
      m.txRows.push([]);
      const res = await list();
      expect(res.status).toBe(200);
      expect(new Set(m.rlsSalonIds())).toEqual(new Set([SALON_A]));
    }
  );

  it("pracownik salonu A z salonId=B => 403", async () => {
    m.asStaffOf(SALON_A, "employee");
    const res = await list(`?salonId=${SALON_B}`);
    expect(res.status).toBe(403);
    expect(m.rlsSalonIds()).toEqual([]);
  });

  it.each(["null", "undefined", "abc", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa"])(
    "salonId=%s => 400 (wcześniej 500 z 22P02), bez kontekstu i zapytania",
    async (salonId) => {
      m.asOwnerOf(SALON_A);
      const res = await list(`?salonId=${salonId}&activeOnly=true`);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ success: false, error: "Invalid salon ID format" });
      expect(m.rlsSalonIds()).toEqual([]);
    }
  );

  it("bez sesji => 401", async () => {
    m.getSession.mockResolvedValue(null);
    const res = await list(`?salonId=${SALON_A}`);
    expect(res.status).toBe(401);
    expect(m.rlsSalonIds()).toEqual([]);
  });
});
