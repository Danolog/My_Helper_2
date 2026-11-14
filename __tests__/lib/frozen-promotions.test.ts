/**
 * Strażnik zamrożenia promocji złożonych (krok B2).
 *
 * Moduł `promotions` łączy proste rabaty, kody rabatowe i promocje złożone,
 * więc nie da się go zamrozić jednym kluczem. Zamrożone są TYPY promocji z
 * `FROZEN_PROMOTION_TYPES` w `src/lib/features.ts` (happy hours, pakiety,
 * 2+1, pierwsza wizyta). Trasy tylko tę listę wołają:
 * - utworzenie albo zmiana na typ zamrożony → 400,
 * - lista promocji nie zwraca typów zamrożonych, pojedyncza promocja → 404,
 * - kod rabatowy powiązany z promocją typu zamrożonego jest nieważny.
 * Proste rabaty (`percentage`, `fixed`) działają bez zmian.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockRequest, createRouteParams, parseResponse } from "../api/helpers";

const { SALON, PROMO_ID } = vi.hoisted(() => ({
  SALON: "11111111-1111-1111-1111-111111111111",
  PROMO_ID: "33333333-3333-3333-3333-333333333333",
}));

const repo = vi.hoisted(() => ({
  rawResult: [] as unknown[],
  findOneResult: null as unknown,
  update: vi.fn(),
  insert: vi.fn(),
}));

vi.mock("@/lib/auth-middleware", () => ({
  requireAuth: vi.fn().mockResolvedValue({ user: { id: "user-1" } }),
  isAuthError: vi.fn().mockReturnValue(false),
}));
vi.mock("@/lib/salon-context", () => ({
  getSalonContext: vi.fn().mockResolvedValue({ salonId: SALON, role: "owner", userId: "user-1" }),
  hasFeatureAccess: vi.fn().mockResolvedValue(true),
}));
vi.mock("@/lib/get-user-salon", () => ({
  getUserSalonId: vi.fn().mockResolvedValue(SALON),
}));
vi.mock("@/lib/rate-limit", () => ({
  apiRateLimit: { check: () => ({ success: true, reset: 0 }) },
  getClientIp: () => "127.0.0.1",
}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/server/repository", () => ({
  forSalon: () => ({
    raw: async () => repo.rawResult,
    findOne: async () => repo.findOneResult,
    update: repo.update,
    insert: repo.insert,
  }),
}));
// Trasa kodów rabatowych jest opakowana w withApiHandler (auth + walidacja) —
// tu liczy się sama reguła, więc opakowanie przekazuje ciało żądania dalej.
vi.mock("@/lib/api-handler", () => ({
  withApiHandler:
    (_opts: unknown, handler: (ctx: { body: unknown }) => Promise<Response>) =>
    async (request: Request) =>
      handler({ body: await request.json() }),
}));

import { POST as validatePromoCode } from "@/app/api/promo-codes/validate/route";
import { GET as getPromotion, PUT as updatePromotion } from "@/app/api/promotions/[id]/route";
import { GET as listPromotions, POST as createPromotion } from "@/app/api/promotions/route";
import {
  createPromotionSchema,
  updatePromotionSchema,
  validateBody,
} from "@/lib/api-validation";
import { FROZEN_PROMOTION_TYPES } from "@/lib/features";

const FROZEN = [...FROZEN_PROMOTION_TYPES];
const SIMPLE = ["percentage", "fixed"] as const;
const URL = "http://localhost:3000/api/promotions";

function promo(type: string, overrides: Record<string, unknown> = {}) {
  return {
    id: PROMO_ID,
    salonId: SALON,
    name: `Promocja ${type}`,
    type,
    value: "10",
    startDate: null,
    endDate: null,
    conditionsJson: {},
    isActive: true,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  repo.rawResult = [];
  repo.findOneResult = null;
});

describe("walidacja typu promocji (schematy)", () => {
  it.each(FROZEN)("utworzenie promocji typu %s jest odrzucane", (type) => {
    const error = validateBody(createPromotionSchema, { salonId: SALON, name: "X", type, value: 10 });
    expect(error).not.toBeNull();
    expect(JSON.stringify(error)).toMatch(/niedost[ęe]pn/i);
  });

  it.each(FROZEN)("zmiana promocji na typ %s jest odrzucana", (type) => {
    expect(validateBody(updatePromotionSchema, { type })).not.toBeNull();
  });

  it.each(SIMPLE)("prosty rabat %s przechodzi walidację", (type) => {
    expect(validateBody(createPromotionSchema, { salonId: SALON, name: "X", type, value: 10 })).toBeNull();
    expect(validateBody(updatePromotionSchema, { type })).toBeNull();
  });
});

describe("POST /api/promotions", () => {
  it.each(FROZEN)("typ zamrożony %s → 400, bez zapisu do bazy", async (type) => {
    const response = await createPromotion(
      createMockRequest(URL, { method: "POST", body: { salonId: SALON, name: "X", type, value: 10 } })
    );
    const { status, body } = await parseResponse(response);

    expect(status).toBe(400);
    expect(body.success).toBe(false);
    expect(repo.insert).not.toHaveBeenCalled();
  });
});

describe("GET /api/promotions", () => {
  it("nie zwraca promocji typów zamrożonych, proste rabaty zostają", async () => {
    repo.rawResult = [
      promo("percentage", { id: "p1" }),
      promo("happy_hours", { id: "p2" }),
      promo("fixed", { id: "p3" }),
      promo("package", { id: "p4" }),
      promo("buy2get1", { id: "p5" }),
      promo("first_visit", { id: "p6" }),
    ];

    const response = await listPromotions(createMockRequest(`${URL}?salonId=${SALON}`));
    const { status, body } = await parseResponse<{ data: Array<{ id: string }>; count: number }>(response);

    expect(status).toBe(200);
    expect(body.data.map((p) => p.id)).toEqual(["p1", "p3"]);
    expect(body.count).toBe(2);
  });
});

describe("/api/promotions/[id]", () => {
  it.each(FROZEN)("GET promocji typu %s → 404", async (type) => {
    repo.findOneResult = promo(type);
    const response = await getPromotion(createMockRequest(`${URL}/${PROMO_ID}`), createRouteParams(PROMO_ID));
    expect(response.status).toBe(404);
  });

  it.each(FROZEN)("PUT na promocji typu %s (np. włączenie) → 404, bez zapisu", async (type) => {
    repo.findOneResult = promo(type, { isActive: false });
    const response = await updatePromotion(
      createMockRequest(`${URL}/${PROMO_ID}`, { method: "PUT", body: { isActive: true } }),
      createRouteParams(PROMO_ID)
    );
    expect(response.status).toBe(404);
    expect(repo.update).not.toHaveBeenCalled();
  });

  it.each(FROZEN)("PUT zmieniający prosty rabat na typ %s → 400, bez zapisu", async (type) => {
    repo.findOneResult = promo("percentage");
    const response = await updatePromotion(
      createMockRequest(`${URL}/${PROMO_ID}`, { method: "PUT", body: { type } }),
      createRouteParams(PROMO_ID)
    );
    expect(response.status).toBe(400);
    expect(repo.update).not.toHaveBeenCalled();
  });

  it.each(SIMPLE)("kontrola: GET prostego rabatu %s → 200", async (type) => {
    repo.findOneResult = promo(type);
    const response = await getPromotion(createMockRequest(`${URL}/${PROMO_ID}`), createRouteParams(PROMO_ID));
    expect(response.status).toBe(200);
  });
});

describe("POST /api/promo-codes/validate", () => {
  const code = { id: "c1", code: "LATO10", salonId: SALON, expiresAt: null, usageLimit: null, usedCount: 0 };

  async function validate() {
    const response = await validatePromoCode(
      createMockRequest("http://localhost:3000/api/promo-codes/validate", {
        method: "POST",
        body: { code: "lato10", salonId: SALON },
      }) as never
    );
    return (await parseResponse<{ data: Record<string, unknown> }>(response as Response)).body.data;
  }

  it.each(FROZEN)("kod powiązany z promocją typu %s jest nieważny", async (type) => {
    repo.rawResult = [{ promoCode: code, promotion: promo(type) }];

    const data = await validate();

    expect(data.valid).toBe(false);
    expect(data.errorType).toBe("promotion_unavailable");
    expect(data.discountType).toBeUndefined();
    expect(data.discountValue).toBeUndefined();
  });

  it.each(SIMPLE)("kontrola: kod powiązany z prostym rabatem %s działa", async (type) => {
    repo.rawResult = [{ promoCode: code, promotion: promo(type) }];

    const data = await validate();

    expect(data.valid).toBe(true);
    expect(data.discountType).toBe(type);
    expect(data.discountValue).toBe(10);
  });
});
