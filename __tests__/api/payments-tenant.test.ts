/**
 * GET /api/payments — izolacja salonu (P0 z przeglądu bezpieczeństwa).
 *
 * Przed naprawą trasa brała salonId z query i od razu forSalon(salonId):
 * każde zalogowane konto czytało zadatki (z nazwiskami klientów) i płatności
 * abonamentowe dowolnego salonu. Teraz salon z sesji; dostęp jak w finansach
 * (finance/commissions): właściciel albo czasowy grant "finance".
 */
import { NextRequest } from "next/server";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "@/app/api/payments/route";
import { SALON_A, SALON_B } from "./salon-staff-harness";

const m = await vi.hoisted(async () =>
  (await import("./salon-staff-harness")).createSalonStaffMocks()
);

vi.mock("next/headers", () => ({ headers: vi.fn().mockResolvedValue(new Headers()) }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: m.getSession } } }));
vi.mock("@/lib/db", () => ({ db: m.db }));
vi.mock("@/lib/server/system/db-system", () => ({ dbSystem: m.dbSystem }));
vi.mock("@/lib/temporary-access", () => ({ hasTemporaryAccess: m.hasTemporaryAccess }));

const depositRow = {
  id: "d-1",
  amount: "50.00",
  currency: "PLN",
  status: "succeeded",
  paymentMethod: "blik",
  paidAt: new Date("2026-11-01T10:00:00Z"),
  createdAt: new Date("2026-11-01T10:00:00Z"),
  appointmentId: "ap-1",
  refundedAt: null,
  refundReason: null,
  clientFirstName: "Anna",
  clientLastName: "Nowak",
  serviceName: "Strzyżenie",
};

const subscriptionRow = {
  id: "s-1",
  amount: "149.00",
  currency: "PLN",
  status: "succeeded",
  paidAt: new Date("2026-11-02T10:00:00Z"),
  createdAt: new Date("2026-11-02T10:00:00Z"),
  subscriptionId: "sub-1",
  planName: "Pro",
};

function get(query: string) {
  return GET(new NextRequest(`http://localhost/api/payments${query}`));
}

describe("GET /api/payments — izolacja salonu", () => {
  beforeEach(() => m.reset());

  it("właściciel salonu A nie czyta płatności salonu B (403, zero zapytań o dane)", async () => {
    m.asOwnerOf(SALON_A);
    m.txRows.push([depositRow], [subscriptionRow]);

    const res = await get(`?salonId=${SALON_B}`);

    expect(res.status).toBe(403);
    expect(m.rlsSalonIds()).toEqual([]);
  });

  it("właściciel czyta własne płatności (forSalon z salonem sesji)", async () => {
    m.asOwnerOf(SALON_A);
    m.txRows.push([depositRow], [subscriptionRow]);

    const res = await get(`?salonId=${SALON_A}`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.pagination.total).toBe(2);
    expect(new Set(m.rlsSalonIds())).toEqual(new Set([SALON_A]));
  });

  it("bez salonId w query => salon z sesji (nie 400)", async () => {
    m.asOwnerOf(SALON_A);
    const res = await get("?type=deposit");
    expect(res.status).toBe(200);
    expect(new Set(m.rlsSalonIds())).toEqual(new Set([SALON_A]));
  });

  it("pracownik bez grantu 'finance' => 403 nawet we własnym salonie", async () => {
    m.asStaffOf(SALON_A, "receptionist");
    const res = await get(`?salonId=${SALON_A}`);
    expect(res.status).toBe(403);
    expect(m.hasTemporaryAccess).toHaveBeenCalledWith("staff-a", "finance", SALON_A);
  });

  it("pracownik z grantem 'finance' czyta własny salon", async () => {
    m.asStaffOf(SALON_A, "employee");
    m.hasTemporaryAccess.mockResolvedValue(true);
    const res = await get(`?salonId=${SALON_A}`);
    expect(res.status).toBe(200);
  });

  it("konto bez salonu => 404", async () => {
    m.signIn("client-1");
    m.ctxRows.push([], []);
    const res = await get(`?salonId=${SALON_B}`);
    expect(res.status).toBe(404);
  });

  it("bez sesji => 401", async () => {
    m.getSession.mockResolvedValue(null);
    const res = await get(`?salonId=${SALON_A}`);
    expect(res.status).toBe(401);
  });
});
