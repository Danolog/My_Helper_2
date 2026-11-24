/**
 * GET /api/notifications — izolacja salonu (P0 z przeglądu bezpieczeństwa).
 *
 * Przed naprawą trasa brała salonId z query i od razu forSalon(salonId):
 * każde zalogowane konto czytało log SMS/e-maili (treść + telefony klientów)
 * dowolnego salonu. Id salonów są publiczne (GET /api/salons).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "@/app/api/notifications/route";
import { SALON_A, SALON_B } from "./salon-staff-harness";

const m = await vi.hoisted(async () =>
  (await import("./salon-staff-harness")).createSalonStaffMocks()
);

vi.mock("next/headers", () => ({ headers: vi.fn().mockResolvedValue(new Headers()) }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: m.getSession } } }));
vi.mock("@/lib/db", () => ({ db: m.db }));
vi.mock("@/lib/server/system/db-system", () => ({ dbSystem: m.dbSystem }));
vi.mock("@/lib/temporary-access", () => ({ hasTemporaryAccess: m.hasTemporaryAccess }));

const notificationRow = {
  id: "n-1",
  salonId: SALON_B,
  clientId: "c-1",
  type: "sms",
  message: "Przypomnienie o wizycie",
  sentAt: null,
  status: "sent",
  createdAt: new Date("2026-11-01T10:00:00Z"),
  clientFirstName: "Anna",
  clientLastName: "Nowak",
  clientPhone: "+48500100200",
};

function get(query: string) {
  return GET(new Request(`http://localhost/api/notifications${query}`));
}

describe("GET /api/notifications — izolacja salonu", () => {
  beforeEach(() => m.reset());

  it("właściciel salonu A nie czyta logu salonu B (403, zero zapytań o dane)", async () => {
    m.asOwnerOf(SALON_A);
    m.txRows.push([notificationRow], [{ count: 1 }]);

    const res = await get(`?salonId=${SALON_B}`);

    expect(res.status).toBe(403);
    expect(m.rlsSalonIds()).toEqual([]);
  });

  it("właściciel czyta własny salon (forSalon z salonem sesji)", async () => {
    m.asOwnerOf(SALON_A);
    m.txRows.push([{ ...notificationRow, salonId: SALON_A }], [{ count: 1 }]);

    const res = await get(`?salonId=${SALON_A}`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.total).toBe(1);
    expect(body.data.notifications[0].clientName).toBe("Anna Nowak");
    expect(new Set(m.rlsSalonIds())).toEqual(new Set([SALON_A]));
  });

  it("bez salonId w query => salon z sesji (nie 400)", async () => {
    m.asStaffOf(SALON_A, "receptionist");
    m.txRows.push([], [{ count: 0 }]);

    const res = await get("");

    expect(res.status).toBe(200);
    expect(new Set(m.rlsSalonIds())).toEqual(new Set([SALON_A]));
  });

  it("pracownik salonu A z salonId salonu B => 403", async () => {
    m.asStaffOf(SALON_A, "employee");
    const res = await get(`?salonId=${SALON_B}`);
    expect(res.status).toBe(403);
  });

  it("konto bez salonu (klient) => 404", async () => {
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
