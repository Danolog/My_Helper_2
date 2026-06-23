/**
 * Testy regresyjne IDOR dla /api/salons (POST + DELETE).
 *
 * Domknięte luki:
 *  - POST przyjmował `ownerId` z body → salon tworzony na cudzego usera. Teraz
 *    ownerId pochodzi WYŁĄCZNIE z sesji.
 *  - DELETE kasował dowolny salon po `?id=` (tylko requireAuth) → każdy zalogowany
 *    user mógł usunąć cudzy salon. Teraz delete zawężony do eq(ownerId, sesja);
 *    cudzy/nieistniejący => brak wiersza => 404.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const SESSION_USER_ID = "user-OWNER-001";

const mockDbInsert = vi.fn();
const mockDbDelete = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    insert: (...args: unknown[]) => mockDbInsert(...args),
    delete: (...args: unknown[]) => mockDbDelete(...args),
  },
}));

vi.mock("@/lib/schema", () => ({
  salons: new Proxy({}, { get: (_t, p) => `salons.${String(p)}` }),
  services: new Proxy({}, { get: (_t, p) => `services.${String(p)}` }),
  reviews: new Proxy({}, { get: (_t, p) => `reviews.${String(p)}` }),
}));

// drizzle: eq/and zwracają struktury, które można zainspekować w asercjach.
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((col: unknown, val: unknown) => ({ type: "eq", col, val })),
  and: vi.fn((...args: unknown[]) => ({ type: "and", args })),
  isNotNull: vi.fn((c: unknown) => ({ type: "isNotNull", c })),
  ne: vi.fn((...a: unknown[]) => ({ type: "ne", a })),
  inArray: vi.fn((...a: unknown[]) => ({ type: "inArray", a })),
  count: vi.fn(() => ({ type: "count" })),
  avg: vi.fn(() => ({ type: "avg" })),
}));

vi.mock("@/lib/auth-middleware", () => ({
  requireAuth: vi.fn(async () => ({ session: {}, user: { id: SESSION_USER_ID } })),
  isAuthError: (r: unknown) => r instanceof Response,
}));

vi.mock("@/lib/api-validation", () => ({
  validateBody: vi.fn(() => null), // walidacja przechodzi
  createSalonSchema: {},
}));

vi.mock("@/lib/rate-limit", () => ({
  apiRateLimit: { check: vi.fn(() => ({ success: true, reset: 0 })) },
  getClientIp: vi.fn(() => "127.0.0.1"),
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

import { POST, DELETE } from "@/app/api/salons/route";

const makeRequest = (body?: unknown, url = "http://localhost/api/salons") =>
  ({ url, json: async () => body }) as unknown as Request;

beforeEach(() => {
  mockDbInsert.mockReset();
  mockDbDelete.mockReset();
});

describe("POST /api/salons — ownerId z sesji, nie z body", () => {
  it("ignoruje body.ownerId i ustawia ownerId z sesji", async () => {
    let capturedValues: Record<string, unknown> | undefined;
    mockDbInsert.mockReturnValue({
      values: (v: Record<string, unknown>) => {
        capturedValues = v;
        return { returning: async () => [{ id: "salon-1", ...v }] };
      },
    });

    const res = await POST(
      makeRequest({ name: "Zły", ownerId: "user-VICTIM-999" })
    );

    expect(res.status).toBe(201);
    expect(capturedValues?.ownerId).toBe(SESSION_USER_ID);
    expect(capturedValues?.ownerId).not.toBe("user-VICTIM-999");
  });
});

describe("DELETE /api/salons — tylko własny salon", () => {
  it("zawęża delete do eq(salons.id) AND eq(salons.ownerId, sesja)", async () => {
    let capturedWhere: { type: string; args: { col: unknown; val: unknown }[] } | undefined;
    mockDbDelete.mockReturnValue({
      where: (w: typeof capturedWhere) => {
        capturedWhere = w;
        return { returning: async () => [{ id: "salon-1", name: "Mój" }] };
      },
    });

    const res = await DELETE(makeRequest(undefined, "http://localhost/api/salons?id=salon-1"));

    expect(res.status).toBe(200);
    // WHERE = and(eq(id), eq(ownerId, sesja)) — sprawdź obecność warunku ownerId=sesja
    const conds = capturedWhere?.args ?? [];
    const ownerCond = conds.find(
      (c) => c.col === "salons.ownerId" && c.val === SESSION_USER_ID
    );
    expect(ownerCond).toBeDefined();
  });

  it("zwraca 404, gdy delete nie trafia w wiersz (cudzy salon => brak returning)", async () => {
    mockDbDelete.mockReturnValue({
      where: () => ({ returning: async () => [] }), // nic nie usunięto (nie właściciel)
    });

    const res = await DELETE(makeRequest(undefined, "http://localhost/api/salons?id=cudzy-salon"));
    expect(res.status).toBe(404);
  });

  it("zwraca 400, gdy brak id", async () => {
    const res = await DELETE(makeRequest(undefined, "http://localhost/api/salons"));
    expect(res.status).toBe(400);
  });
});
