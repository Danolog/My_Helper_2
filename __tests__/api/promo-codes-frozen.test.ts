/**
 * Promocja zamrożonego typu nie istnieje dla panelu kodów (B2.1, audyt bezpieczeństwa N1).
 *
 * POST /api/promo-codes i PUT /api/promo-codes/:id: powiązanie kodu z promocją
 * pakietową / 2+1 / happy hours / pierwszej wizyty → 404, ta sama odpowiedź co
 * brak promocji, zero zapisu. PUT: kod JUŻ powiązany z taką promocją da się
 * edytować (formularz zawsze odsyła promotionId) — link zostaje, jak był.
 * GET: join zostaje (salon widzi, z czym kod był powiązany), a panel oznacza
 * go „Promocja niedostępna” po `promotion.type` (PromoCodesTable).
 *
 * PUT/:id jest tylko dla właściciela (getUserSalonId = salons.ownerId):
 * pracownik dostaje 404 „Salon not found”, nie 403 — trasa nie ma ścieżki 403.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PUT } from "@/app/api/promo-codes/[id]/route";
import { GET, POST } from "@/app/api/promo-codes/route";
import { FROZEN_PROMOTION_TYPES } from "@/lib/features";
import { SALON_A, SALON_B } from "./salon-staff-harness";

const m = await vi.hoisted(async () =>
  (await import("./salon-staff-harness")).createSalonStaffMocks()
);

vi.mock("next/headers", () => ({ headers: vi.fn().mockResolvedValue(new Headers()) }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: m.getSession } } }));
vi.mock("@/lib/db", () => ({ db: m.db }));
vi.mock("@/lib/server/system/db-system", () => ({ dbSystem: m.dbSystem }));
vi.mock("@/lib/temporary-access", () => ({ hasTemporaryAccess: m.hasTemporaryAccess }));

const NOT_FOUND = "Promotion not found or does not belong to this salon";

function promotion(type: string, id = `promo-${type}`) {
  return { id, salonId: SALON_A, name: `Promo ${type}`, type, value: "20", isActive: true };
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

function update(id: string, body: Record<string, unknown>) {
  return PUT(
    new Request(`http://localhost/api/promo-codes/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) }
  );
}

const existingCode = (promotionId: string | null) => ({
  id: "pc-1",
  salonId: SALON_A,
  code: "LATO10",
  promotionId,
  usageLimit: null,
  expiresAt: null,
});

describe("POST /api/promo-codes — promocja zamrożonego typu", () => {
  beforeEach(() => m.reset());

  it.each(FROZEN_PROMOTION_TYPES)("%s → 404 jak brak promocji, brak insertu", async (type) => {
    m.asOwnerOf(SALON_A);
    m.txRows.push([], [promotion(type)], [{ id: "pc-new" }]);
    const res = await create({ salonId: SALON_A, code: "X1", promotionId: `promo-${type}` });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, error: NOT_FOUND });
    expect(m.insertedValues).toEqual([]);
  });

  it("brak promocji → 404 (ta sama odpowiedź)", async () => {
    m.asOwnerOf(SALON_A);
    m.txRows.push([], []);
    const res = await create({ salonId: SALON_A, code: "X1", promotionId: "promo-missing" });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, error: NOT_FOUND });
  });

  it.each(["percentage", "fixed"])("kontrola: %s → 201, kod powiązany", async (type) => {
    m.asOwnerOf(SALON_A);
    m.txRows.push([], [promotion(type)], [{ id: "pc-new", salonId: SALON_A, code: "X1" }]);
    const res = await create({ salonId: SALON_A, code: "X1", promotionId: `promo-${type}` });
    expect(res.status).toBe(201);
    expect(m.insertedValues).toEqual([
      expect.objectContaining({ salonId: SALON_A, promotionId: `promo-${type}` }),
    ]);
  });

  it("400: ujemny limit, zanim trasa sięgnie po promocję", async () => {
    m.asOwnerOf(SALON_A);
    const res = await create({ salonId: SALON_A, promotionId: "promo-package", usageLimit: -1 });
    expect(res.status).toBe(400);
    expect(m.insertedValues).toEqual([]);
  });

  it("401: bez sesji", async () => {
    m.getSession.mockResolvedValue(null);
    const res = await create({ salonId: SALON_A, promotionId: "promo-package" });
    expect(res.status).toBe(401);
  });

  it("403: cudzy salon — przed sprawdzeniem promocji", async () => {
    m.asOwnerOf(SALON_A);
    const res = await create({ salonId: SALON_B, promotionId: "promo-package" });
    expect(res.status).toBe(403);
    expect(m.insertedValues).toEqual([]);
  });
});

describe("PUT /api/promo-codes/:id — promocja zamrożonego typu", () => {
  beforeEach(() => m.reset());

  it.each(FROZEN_PROMOTION_TYPES)("nowe powiązanie z %s → 404, bez update", async (type) => {
    m.asOwnerOf(SALON_A);
    const sentinel = [{ id: "update-should-not-run" }];
    m.txRows.push([existingCode(null)], [promotion(type)], sentinel);
    const res = await update("pc-1", { promotionId: `promo-${type}` });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, error: NOT_FOUND });
    expect(m.txRows).toEqual([sentinel]);
  });

  it("przepięcie z rabatu procentowego na happy hours → 404", async () => {
    m.asOwnerOf(SALON_A);
    m.txRows.push([existingCode("promo-percentage")], [promotion("happy_hours")]);
    const res = await update("pc-1", { promotionId: "promo-happy_hours" });
    expect(res.status).toBe(404);
  });

  it("kod już powiązany z zamrożoną promocją: edycja limitu → 200, link bez zmian", async () => {
    m.asOwnerOf(SALON_A);
    const updated = { ...existingCode("promo-package"), usageLimit: 5 };
    m.txRows.push([existingCode("promo-package")], [promotion("package")], [updated]);
    const res = await update("pc-1", {
      code: "LATO10",
      promotionId: "promo-package",
      usageLimit: 5,
      expiresAt: null,
    });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual(updated);
  });

  it("kontrola: przepięcie na rabat kwotowy → 200 (z promocji zamrożonej też)", async () => {
    m.asOwnerOf(SALON_A);
    const updated = existingCode("promo-fixed");
    m.txRows.push([existingCode("promo-package")], [promotion("fixed")], [updated]);
    const res = await update("pc-1", { promotionId: "promo-fixed" });
    expect(res.status).toBe(200);
    expect((await res.json()).data.promotionId).toBe("promo-fixed");
  });

  it("brak promocji → 404", async () => {
    m.asOwnerOf(SALON_A);
    m.txRows.push([existingCode(null)], []);
    const res = await update("pc-1", { promotionId: "promo-missing" });
    expect(res.status).toBe(404);
  });

  it("400: ujemny limit", async () => {
    m.asOwnerOf(SALON_A);
    const res = await update("pc-1", { promotionId: "promo-package", usageLimit: -1 });
    expect(res.status).toBe(400);
  });

  it("401: bez sesji", async () => {
    m.getSession.mockResolvedValue(null);
    const res = await update("pc-1", { promotionId: "promo-package" });
    expect(res.status).toBe(401);
  });

  it("pracownik (nie właściciel): 404 „Salon not found” — trasa nie ma ścieżki 403", async () => {
    m.signIn("staff-a");
    m.ctxRows.push([]);
    const res = await update("pc-1", { promotionId: "promo-package" });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Salon not found");
  });
});

describe("GET /api/promo-codes — join z promocją zamrożonego typu", () => {
  beforeEach(() => m.reset());

  it("200: kod zwraca promocję z typem, po którym panel ją oznacza", async () => {
    m.asOwnerOf(SALON_A);
    m.txRows.push([
      { promoCode: { id: "pc-1", salonId: SALON_A, code: "LATO10" }, promotion: promotion("package") },
    ]);
    const res = await GET(new Request(`http://localhost/api/promo-codes?salonId=${SALON_A}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data[0].promotion).toEqual(expect.objectContaining({ type: "package" }));
  });
});
