/**
 * POST /api/promo-codes/validate — izolacja salonu.
 *
 * Salon pochodzi wyłącznie z sesji (requireSalonStaff). salonId z body jest
 * tylko porównywany: inny niż salon sesji => 403 i żadnego zapytania o kody
 * (forSalon niewołany), równy albo brak => sprawdzenie w salonie sesji.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/promo-codes/validate/route";
import { forSalon } from "@/lib/server/repository";
import { SALON_A, SALON_B } from "./salon-staff-harness";

const m = await vi.hoisted(async () =>
  (await import("./salon-staff-harness")).createSalonStaffMocks()
);

vi.mock("next/headers", () => ({ headers: vi.fn().mockResolvedValue(new Headers()) }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: m.getSession } } }));
vi.mock("@/lib/db", () => ({ db: m.db }));
vi.mock("@/lib/server/system/db-system", () => ({ dbSystem: m.dbSystem }));
vi.mock("@/lib/temporary-access", () => ({ hasTemporaryAccess: m.hasTemporaryAccess }));
// Prawdziwe forSalon, owinięte w spy — dowód, czy trasa w ogóle sięgnęła do bazy.
vi.mock("@/lib/server/repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/repository")>();
  return { ...actual, forSalon: vi.fn(actual.forSalon) };
});

const forSalonSpy = vi.mocked(forSalon);

const promoCode = {
  id: "pc-1",
  salonId: SALON_A,
  code: "LATO",
  promotionId: "p-1",
  usageLimit: null,
  usedCount: 0,
  expiresAt: null,
};

const promotion = {
  id: "p-1",
  salonId: SALON_A,
  name: "Lato -20%",
  type: "percentage",
  value: "20",
  startDate: null,
  endDate: null,
  conditionsJson: {},
  isActive: true,
};

function validate(body: unknown) {
  return POST(
    new Request("http://localhost/api/promo-codes/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

beforeEach(() => {
  m.reset();
  forSalonSpy.mockClear();
});

describe("POST /api/promo-codes/validate — salon z sesji", () => {
  it("200: kod własnego salonu (salonId z body równy salonowi sesji)", async () => {
    m.asOwnerOf(SALON_A);
    m.txRows.push([{ promoCode, promotion }]);

    const res = await validate({ code: "lato", salonId: SALON_A });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toMatchObject({ valid: true, code: "LATO", discountValue: 20 });
    expect(forSalonSpy).toHaveBeenCalledTimes(1);
    expect(forSalonSpy).toHaveBeenCalledWith(SALON_A);
    expect(m.rlsSalonIds()).toEqual([SALON_A]);
  });

  it("200: bez salonId w body — sprawdzenie w salonie sesji", async () => {
    m.asOwnerOf(SALON_A);
    m.txRows.push([{ promoCode, promotion }]);

    const res = await validate({ code: "LATO" });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.valid).toBe(true);
    expect(forSalonSpy).toHaveBeenCalledWith(SALON_A);
    expect(m.rlsSalonIds()).toEqual([SALON_A]);
  });

  it("200: salonId null w body traktowany jak brak", async () => {
    m.asOwnerOf(SALON_A);
    m.txRows.push([{ promoCode, promotion }]);

    const res = await validate({ code: "LATO", salonId: null });

    expect(res.status).toBe(200);
    expect(forSalonSpy).toHaveBeenCalledWith(SALON_A);
  });

  it("200: recepcja salonu sprawdza kod w swoim salonie", async () => {
    m.asStaffOf(SALON_A, "receptionist");
    m.txRows.push([{ promoCode, promotion }]);

    const res = await validate({ code: "LATO", salonId: SALON_A });

    expect(res.status).toBe(200);
    expect(m.rlsSalonIds()).toEqual([SALON_A]);
  });

  it("200 valid:false: kod nieistniejący w salonie sesji", async () => {
    m.asOwnerOf(SALON_A);
    m.txRows.push([]);

    const res = await validate({ code: "NIEMA" });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toMatchObject({ valid: false, errorType: "not_found" });
  });

  it("403: salonId z body inny niż salon sesji — forSalon niewołany", async () => {
    m.asOwnerOf(SALON_A);
    m.txRows.push([{ promoCode: { ...promoCode, salonId: SALON_B }, promotion }]);

    const res = await validate({ code: "LATO", salonId: SALON_B });
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.success).toBe(false);
    expect(body).not.toHaveProperty("data");
    expect(forSalonSpy).not.toHaveBeenCalled();
    expect(m.rlsSalonIds()).toEqual([]);
    // Wynik bazy nietknięty: trasa nie pytała o kody.
    expect(m.txRows).toHaveLength(1);
  });

  it("401: bez sesji", async () => {
    const res = await validate({ code: "LATO", salonId: SALON_A });

    expect(res.status).toBe(401);
    expect(forSalonSpy).not.toHaveBeenCalled();
  });

  it("404: zalogowane konto bez salonu (np. klient portalu)", async () => {
    m.signIn("client-x");

    const res = await validate({ code: "LATO", salonId: SALON_A });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.success).toBe(false);
    expect(forSalonSpy).not.toHaveBeenCalled();
  });

  it("400: brak kodu", async () => {
    m.asOwnerOf(SALON_A);

    const res = await validate({ salonId: SALON_A });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.details).toHaveProperty("code");
    expect(forSalonSpy).not.toHaveBeenCalled();
  });

  it("400: salonId nie jest tekstem", async () => {
    m.asOwnerOf(SALON_A);

    const res = await validate({ code: "LATO", salonId: 123 });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.details).toHaveProperty("salonId");
    expect(forSalonSpy).not.toHaveBeenCalled();
  });

  it("500: błąd bazy — ogólny komunikat bez szczegółów", async () => {
    m.asOwnerOf(SALON_A);
    forSalonSpy.mockImplementationOnce(() => {
      throw new Error("connection refused");
    });

    const res = await validate({ code: "LATO" });
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toEqual({ success: false, error: "Failed to validate promo code" });
  });
});
