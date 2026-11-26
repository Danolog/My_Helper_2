/**
 * PATCH /api/reviews/[id]/moderate — moderacja opinii przez salon.
 *
 * Regulamin pkt 8.3.4: odrzucenie jest ostateczne — odrzuconej opinii salon
 * nie może później opublikować ani ponownie zmienić. Wycofanie publikacji
 * (reject opinii zatwierdzonej) pozostaje dozwolone.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";
import { createMockRequest, parseResponse } from "./helpers";

const REVIEW_ID = "c1d2e3f4-a5b6-4789-abcd-ef1234567890";
const SALON_ID = "a1b2c3d4-e5f6-4789-abcd-ef1234567890";

const mockRequireAuth = vi.fn();
const mockIsAuthError = vi.fn();
vi.mock("@/lib/auth-middleware", () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
  isAuthError: (...args: unknown[]) => mockIsAuthError(...args),
  requireCronSecret: vi.fn(),
}));

const mockGetSession = vi.fn();
vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: (...args: unknown[]) => mockGetSession(...args) } },
}));

vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue(new Headers()),
}));

const mockGetUserSalonId = vi.fn();
vi.mock("@/lib/get-user-salon", () => ({
  getUserSalonId: (...args: unknown[]) => mockGetUserSalonId(...args),
}));

const mockFindOne = vi.fn();
const mockUpdateOwned = vi.fn();
const mockForSalon = vi.fn();
vi.mock("@/lib/server/repository", () => ({
  forSalon: (...args: unknown[]) => mockForSalon(...args),
}));

vi.mock("@/lib/schema", () => ({
  reviews: new Proxy({}, { get: (_t, col) => `reviews.${String(col)}` }),
}));

vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { PATCH } from "@/app/api/reviews/[id]/moderate/route";

function makeReview(status: string) {
  return { id: REVIEW_ID, salonId: SALON_ID, rating: 5, comment: "Super", status };
}

async function patch(body: unknown) {
  const req = createMockRequest(`http://localhost:3000/api/reviews/${REVIEW_ID}/moderate`, {
    method: "PATCH",
    body,
  });
  return parseResponse(await PATCH(req, { params: Promise.resolve({ id: REVIEW_ID }) }));
}

beforeEach(() => {
  vi.clearAllMocks();
  const session = { user: { id: "owner-user" } };
  mockRequireAuth.mockResolvedValue({ session, user: session.user });
  mockIsAuthError.mockReturnValue(false);
  mockGetSession.mockResolvedValue(session);
  mockGetUserSalonId.mockResolvedValue(SALON_ID);
  mockForSalon.mockReturnValue({ findOne: mockFindOne, updateOwned: mockUpdateOwned });
  mockFindOne.mockResolvedValue(makeReview("pending"));
  mockUpdateOwned.mockImplementation(
    async (_table: unknown, _id: unknown, values: { status: string }) => makeReview(values.status),
  );
});

describe("PATCH /api/reviews/[id]/moderate", () => {
  it("401 bez sesji (wrapper)", async () => {
    mockRequireAuth.mockResolvedValue(
      NextResponse.json({ success: false, error: "Brak autoryzacji" }, { status: 401 }),
    );
    mockIsAuthError.mockReturnValue(true);

    const { status } = await patch({ action: "approve" });

    expect(status).toBe(401);
    expect(mockFindOne).not.toHaveBeenCalled();
    expect(mockUpdateOwned).not.toHaveBeenCalled();
  });

  it("401 gdy sesja w handlerze jest pusta", async () => {
    mockGetSession.mockResolvedValue(null);

    const { status, body } = await patch({ action: "approve" });

    expect(status).toBe(401);
    expect(body.success).toBe(false);
    expect(mockUpdateOwned).not.toHaveBeenCalled();
  });

  it.each([
    ["nieznana akcja", { action: "publish" }],
    ["brak akcji", {}],
  ])("400 — %s, bez zapisu", async (_label, reqBody) => {
    const { status } = await patch(reqBody);

    expect(status).toBe(400);
    expect(mockFindOne).not.toHaveBeenCalled();
    expect(mockUpdateOwned).not.toHaveBeenCalled();
  });

  it("403 gdy użytkownik nie ma salonu", async () => {
    mockGetUserSalonId.mockResolvedValue(null);

    const { status, body } = await patch({ action: "approve" });

    expect(status).toBe(403);
    expect(body.success).toBe(false);
    expect(mockUpdateOwned).not.toHaveBeenCalled();
  });

  it("404 gdy opinii nie ma w salonie", async () => {
    mockFindOne.mockResolvedValue(undefined);

    const { status, body } = await patch({ action: "approve" });

    expect(status).toBe(404);
    expect(body.error).toBe("Opinia nie zostala znaleziona");
    expect(mockUpdateOwned).not.toHaveBeenCalled();
  });

  it("200 — approve opinii oczekującej", async () => {
    const { status, body } = await patch({ action: "approve" });

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(mockForSalon).toHaveBeenCalledWith(SALON_ID);
    expect(mockUpdateOwned).toHaveBeenCalledWith(expect.anything(), REVIEW_ID, { status: "approved" });
    expect((body.data as { status: string }).status).toBe("approved");
  });

  it("200 — reject opinii oczekującej", async () => {
    const { status, body } = await patch({ action: "reject" });

    expect(status).toBe(200);
    expect(mockUpdateOwned).toHaveBeenCalledWith(expect.anything(), REVIEW_ID, { status: "rejected" });
    expect((body.data as { status: string }).status).toBe("rejected");
  });

  it("409 — approve opinii odrzuconej, bez zapisu", async () => {
    mockFindOne.mockResolvedValue(makeReview("rejected"));

    const { status, body } = await patch({ action: "approve" });

    expect(status).toBe(409);
    expect(body).toEqual({ success: false, error: "Odrzucona opinia nie może zostać zmieniona" });
    expect(mockUpdateOwned).not.toHaveBeenCalled();
  });

  it("409 — reject opinii odrzuconej, bez zapisu", async () => {
    mockFindOne.mockResolvedValue(makeReview("rejected"));

    const { status, body } = await patch({ action: "reject" });

    expect(status).toBe(409);
    expect(body.success).toBe(false);
    expect(mockUpdateOwned).not.toHaveBeenCalled();
  });

  it("200 — reject opinii zatwierdzonej (wycofanie publikacji)", async () => {
    mockFindOne.mockResolvedValue(makeReview("approved"));

    const { status, body } = await patch({ action: "reject" });

    expect(status).toBe(200);
    expect(mockUpdateOwned).toHaveBeenCalledWith(expect.anything(), REVIEW_ID, { status: "rejected" });
    expect((body.data as { status: string }).status).toBe("rejected");
  });

  it("500 gdy odczyt opinii z bazy się nie powiedzie", async () => {
    mockFindOne.mockRejectedValue(new Error("DB connection failed"));

    const { status, body } = await patch({ action: "approve" });

    expect(status).toBe(500);
    expect(body.success).toBe(false);
    expect(mockUpdateOwned).not.toHaveBeenCalled();
  });
});
