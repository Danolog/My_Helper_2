/**
 * POST /api/seed — seed deweloperski (poza produkcją) tylko dla adminów
 * platformy z ADMIN_EMAILS. Wcześniej bramką był requireAuth("owner"),
 * czyli user.role — rola konta nie jest uprawnieniem.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { POST } from "@/app/api/seed/route";

const { mockGetSession, mockInsert } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockInsert: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: vi.fn().mockResolvedValue(new Headers()) }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: mockGetSession } } }));
vi.mock("@/lib/db", () => ({ db: { insert: mockInsert } }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const ORIGINAL_ADMINS = process.env.ADMIN_EMAILS;

describe("POST /api/seed — bramka admina", () => {
  beforeEach(() => {
    mockGetSession.mockReset();
    mockInsert.mockReset();
    // Zapis do bazy kończy się błędem — interesuje nas tylko, czy do niego doszło.
    mockInsert.mockImplementation(() => {
      throw new Error("db offline");
    });
  });

  afterEach(() => {
    if (ORIGINAL_ADMINS === undefined) delete process.env.ADMIN_EMAILS;
    else process.env.ADMIN_EMAILS = ORIGINAL_ADMINS;
  });

  it("401 bez sesji", async () => {
    mockGetSession.mockResolvedValue(null);
    expect((await POST()).status).toBe(401);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("user.role='owner' spoza ADMIN_EMAILS => 403, bez zapisu", async () => {
    process.env.ADMIN_EMAILS = "admin@myhelper.pl";
    mockGetSession.mockResolvedValue({ user: { id: "u1", email: "owner@salon.pl", role: "owner" } });
    expect((await POST()).status).toBe(403);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("admin z listy (bez user.role) przechodzi bramkę", async () => {
    process.env.ADMIN_EMAILS = "admin@myhelper.pl";
    mockGetSession.mockResolvedValue({ user: { id: "u2", email: "admin@myhelper.pl" } });
    await POST();
    expect(mockInsert).toHaveBeenCalled();
  });
});
