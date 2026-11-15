/**
 * PUT/GET /api/clients/[id]/consents — P2 (Ryan): zgody RODO klientów salonu.
 *
 * Przed naprawą schemat walidacji opisywał inne pola (marketingEmail...) niż
 * body z UI ({ consents: { email|sms|phone: boolean } }), więc nie sprawdzał
 * niczego: tekst "false" był prawdziwy i zapisywał się jako udzielona zgoda,
 * a brak pola `consents` kończył się 500 (TypeError). Teraz schemat .strict()
 * zgodny z UI, wartości wyłącznie boolean, salon z sesji (requireSalonStaff),
 * kartoteka klientów jak w pozostałych trasach: owner/receptionist, employee 403.
 *
 * Uprząż: prawdziwa bramka salonu i prawdziwe forSalon; mock tylko sesji i db.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET, PUT } from "@/app/api/clients/[id]/consents/route";
import { SALON_A } from "./salon-staff-harness";

const m = await vi.hoisted(async () =>
  (await import("./salon-staff-harness")).createSalonStaffMocks()
);

vi.mock("next/headers", () => ({ headers: vi.fn().mockResolvedValue(new Headers()) }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: m.getSession } } }));
vi.mock("@/lib/db", () => ({ db: m.db }));
vi.mock("@/lib/temporary-access", () => ({ hasTemporaryAccess: m.hasTemporaryAccess }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const CLIENT_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const client = { id: CLIENT_ID, salonId: SALON_A, firstName: "Anna", lastName: "Nowak" };
const GRANTED_AT = new Date("2026-11-01T10:00:00.000Z");

function put(body: unknown, id = CLIENT_ID) {
  return PUT(
    new Request(`http://localhost/api/clients/${id}/consents`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }) as never,
    { params: Promise.resolve({ id }) }
  );
}

function get(id = CLIENT_ID) {
  return GET(new Request(`http://localhost/api/clients/${id}/consents`) as never, {
    params: Promise.resolve({ id }),
  });
}

describe("PUT /api/clients/[id]/consents — walidacja zgód (RODO)", () => {
  beforeEach(() => m.reset());

  it('tekst "false" nie zapisuje się jako zgoda — 400, brak insertu', async () => {
    m.asOwnerOf(SALON_A);
    m.txRows.push([client], [], []);

    const res = await put({ consents: { email: "false" } });

    expect(res.status).toBe(400);
    expect(m.insertedValues).toEqual([]);
  });

  it('tekst "true" i liczby też odrzucane (bez koercji) — 400', async () => {
    for (const value of ["true", 1, 0, null]) {
      m.reset();
      m.asOwnerOf(SALON_A);
      m.txRows.push([client], [], []);
      const res = await put({ consents: { sms: value } });
      expect(res.status, `wartość ${JSON.stringify(value)}`).toBe(400);
      expect(m.insertedValues).toEqual([]);
    }
  });

  it("brak pola consents => 400 (nie 500)", async () => {
    m.asOwnerOf(SALON_A);
    m.txRows.push([client], [], []);

    const res = await put({});

    expect(res.status).toBe(400);
    expect(m.insertedValues).toEqual([]);
  });

  it("consents nie-obiekt / pusty obiekt => 400", async () => {
    for (const consents of [true, "email", ["email"], {}]) {
      m.reset();
      m.asOwnerOf(SALON_A);
      m.txRows.push([client], [], []);
      const res = await put({ consents });
      expect(res.status, `consents=${JSON.stringify(consents)}`).toBe(400);
      expect(m.insertedValues).toEqual([]);
    }
  });

  it("nieznany typ zgody => 400", async () => {
    m.asOwnerOf(SALON_A);
    m.txRows.push([client], [], []);

    const res = await put({ consents: { email: true, whatsapp: true } });

    expect(res.status).toBe(400);
    expect(m.insertedValues).toEqual([]);
  });

  it("nadmiarowe pole poza consents => 400 (.strict)", async () => {
    m.asOwnerOf(SALON_A);
    m.txRows.push([client], [], []);

    const res = await put({ consents: { email: true }, salonId: SALON_A });

    expect(res.status).toBe(400);
    expect(m.insertedValues).toEqual([]);
  });

  it("niepoprawny JSON => 400", async () => {
    m.asOwnerOf(SALON_A);
    const res = await put("{nie-json");
    expect(res.status).toBe(400);
  });

  it("id klienta w złym formacie => 400 (nie 500 z rzutowania uuid)", async () => {
    m.asOwnerOf(SALON_A);
    const res = await put({ consents: { email: true } }, "abc");
    expect(res.status).toBe(400);
    expect(m.insertedValues).toEqual([]);
  });

  it("cudzy klient (brak w salonie sesji) => 404, brak insertu", async () => {
    m.asOwnerOf(SALON_A);
    m.txRows.push([]); // findOne w salonie A nie znajduje klienta

    const res = await put({ consents: { email: true } });

    expect(res.status).toBe(404);
    expect(m.insertedValues).toEqual([]);
    expect(new Set(m.rlsSalonIds())).toEqual(new Set([SALON_A]));
  });

  it("pracownik (employee) => 403 jak w pozostałych trasach klientów", async () => {
    m.asStaffOf(SALON_A, "employee");
    m.txRows.push([client], [], []);

    const res = await put({ consents: { email: true } });

    expect(res.status).toBe(403);
    expect(m.insertedValues).toEqual([]);
  });

  it("brak sesji => 401", async () => {
    m.getSession.mockResolvedValue(null);
    const res = await put({ consents: { email: true } });
    expect(res.status).toBe(401);
  });

  it("poprawne body z UI (właściciel) => 200, zgoda zapisana w salonie sesji", async () => {
    m.asOwnerOf(SALON_A);
    // findOne klienta, aktywne zgody (brak), insert, ponowny odczyt
    m.txRows.push([client], [], [], [{ consentType: "email", grantedAt: GRANTED_AT }]);

    const res = await put({ consents: { email: true } });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(m.insertedValues).toEqual([
      expect.objectContaining({ clientId: CLIENT_ID, salonId: SALON_A, consentType: "email" }),
    ]);
    expect(body.consents).toEqual([
      { type: "email", granted: true, grantedAt: GRANTED_AT.toISOString() },
      { type: "sms", granted: false, grantedAt: null },
      { type: "phone", granted: false, grantedAt: null },
    ]);
  });

  it("wycofanie zgody (false) przez recepcję => 200, bez nowego insertu", async () => {
    m.asStaffOf(SALON_A, "receptionist");
    // findOne klienta, aktywne zgody, update revokedAt, ponowny odczyt
    m.txRows.push([client], [{ id: "mc-1", consentType: "sms", grantedAt: GRANTED_AT }], [], []);

    const res = await put({ consents: { sms: false } });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(m.insertedValues).toEqual([]);
    expect(body.consents.find((c: { type: string }) => c.type === "sms").granted).toBe(false);
  });
});

describe("GET /api/clients/[id]/consents", () => {
  beforeEach(() => m.reset());

  it("właściciel => 200 ze statusem zgód", async () => {
    m.asOwnerOf(SALON_A);
    m.txRows.push([client], [{ consentType: "phone", grantedAt: GRANTED_AT }]);

    const res = await get();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.consents).toContainEqual({
      type: "phone",
      granted: true,
      grantedAt: GRANTED_AT.toISOString(),
    });
  });

  it("cudzy klient => 404", async () => {
    m.asOwnerOf(SALON_A);
    m.txRows.push([]);
    expect((await get()).status).toBe(404);
  });

  it("pracownik (employee) => 403", async () => {
    m.asStaffOf(SALON_A, "employee");
    m.txRows.push([client], []);
    expect((await get()).status).toBe(403);
  });
});
