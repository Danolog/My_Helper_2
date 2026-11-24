/**
 * GET/POST /api/promo-codes — izolacja salonu (P0 z przeglądu bezpieczeństwa).
 *
 * Przed naprawą obie metody brały salonId z query/body i od razu
 * forSalon(salonId): każde zalogowane konto listowało kody dowolnego salonu
 * i tworzyło w nim kody rabatowe (łańcuch z raportu: owner salonu A tworzy
 * kod w salonie B i realizuje go przy rezerwacji). Teraz salon z sesji;
 * dostęp jak w promocjach: właściciel albo czasowy grant "promotions".
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET, POST } from "@/app/api/promo-codes/route";
import { SALON_A, SALON_B } from "./salon-staff-harness";

const m = await vi.hoisted(async () =>
  (await import("./salon-staff-harness")).createSalonStaffMocks()
);

vi.mock("next/headers", () => ({ headers: vi.fn().mockResolvedValue(new Headers()) }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: m.getSession } } }));
vi.mock("@/lib/db", () => ({ db: m.db }));
vi.mock("@/lib/server/system/db-system", () => ({ dbSystem: m.dbSystem }));
vi.mock("@/lib/temporary-access", () => ({ hasTemporaryAccess: m.hasTemporaryAccess }));

function list(query: string) {
  return GET(new Request(`http://localhost/api/promo-codes${query}`));
}

function create(body: Record<string, unknown>) {
  return POST(
    new Request("http://localhost/api/promo-codes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

describe("GET /api/promo-codes — izolacja salonu", () => {
  beforeEach(() => m.reset());

  it("właściciel salonu A nie listuje kodów salonu B (403)", async () => {
    m.asOwnerOf(SALON_A);
    m.txRows.push([{ promoCode: { id: "pc-b", salonId: SALON_B, code: "B50" }, promotion: null }]);
    const res = await list(`?salonId=${SALON_B}`);
    expect(res.status).toBe(403);
    expect(m.rlsSalonIds()).toEqual([]);
  });

  it("właściciel listuje własne kody", async () => {
    m.asOwnerOf(SALON_A);
    m.txRows.push([{ promoCode: { id: "pc-a", salonId: SALON_A, code: "A10" }, promotion: null }]);
    const res = await list(`?salonId=${SALON_A}`);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.count).toBe(1);
    expect(new Set(m.rlsSalonIds())).toEqual(new Set([SALON_A]));
  });

  it("pracownik bez grantu 'promotions' => 403", async () => {
    m.asStaffOf(SALON_A, "receptionist");
    const res = await list(`?salonId=${SALON_A}`);
    expect(res.status).toBe(403);
  });

  it("bez sesji => 401", async () => {
    m.getSession.mockResolvedValue(null);
    const res = await list(`?salonId=${SALON_A}`);
    expect(res.status).toBe(401);
  });
});

describe("POST /api/promo-codes — izolacja salonu", () => {
  beforeEach(() => m.reset());

  it("łańcuch z raportu: owner salonu A nie tworzy kodu w salonie B (403, brak insertu)", async () => {
    m.asOwnerOf(SALON_A);
    m.txRows.push([], [{ id: "pc-new", salonId: SALON_B, code: "HACK90" }]);

    const res = await create({ salonId: SALON_B, code: "HACK90" });

    expect(res.status).toBe(403);
    expect(m.insertedValues).toEqual([]);
    expect(m.rlsSalonIds()).toEqual([]);
  });

  it("właściciel tworzy kod we własnym salonie (insert z salonem sesji)", async () => {
    m.asOwnerOf(SALON_A);
    m.txRows.push([], [{ id: "pc-new", salonId: SALON_A, code: "LATO10" }]);

    const res = await create({ salonId: SALON_A, code: "lato10" });

    expect(res.status).toBe(201);
    expect(m.insertedValues).toEqual([expect.objectContaining({ salonId: SALON_A, code: "LATO10" })]);
    expect(new Set(m.rlsSalonIds())).toEqual(new Set([SALON_A]));
  });

  it("pracownik bez grantu 'promotions' nie tworzy kodu nawet we własnym salonie (403)", async () => {
    m.asStaffOf(SALON_A, "employee");
    const res = await create({ salonId: SALON_A, code: "X1" });
    expect(res.status).toBe(403);
    expect(m.insertedValues).toEqual([]);
    expect(m.hasTemporaryAccess).toHaveBeenCalledWith("staff-a", "promotions", SALON_A);
  });

  it("pracownik z grantem 'promotions' tworzy kod we własnym salonie", async () => {
    m.asStaffOf(SALON_A, "employee");
    m.hasTemporaryAccess.mockResolvedValue(true);
    m.txRows.push([], [{ id: "pc-new", salonId: SALON_A, code: "X1" }]);
    const res = await create({ salonId: SALON_A, code: "X1" });
    expect(res.status).toBe(201);
    expect(m.insertedValues).toEqual([expect.objectContaining({ salonId: SALON_A })]);
  });

  it("pracownik z grantem nie tworzy kodu w cudzym salonie (403)", async () => {
    m.asStaffOf(SALON_A, "employee");
    m.hasTemporaryAccess.mockResolvedValue(true);
    const res = await create({ salonId: SALON_B, code: "X1" });
    expect(res.status).toBe(403);
    expect(m.insertedValues).toEqual([]);
  });
});
