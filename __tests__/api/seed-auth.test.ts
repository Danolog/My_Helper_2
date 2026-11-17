/**
 * POST /api/seed — seed deweloperski (poza produkcją) tylko dla adminów
 * platformy z ADMIN_EMAILS. Wcześniej bramką był requireAuth("owner"),
 * czyli user.role — rola konta nie jest uprawnieniem.
 *
 * Zapisy wykonuje wyjście systemowe `seedDemoData` (#193) z własną blokadą
 * celu; trasa mapuje odmowę wyjścia na 403, a błąd na 500.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { POST } from "@/app/api/seed/route";

const { mockGetSession, seedDemoData } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  seedDemoData: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: vi.fn().mockResolvedValue(new Headers()) }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: mockGetSession } } }));
vi.mock("@/lib/server/system", () => ({ seedDemoData }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const ORIGINAL_ADMINS = process.env.ADMIN_EMAILS;
const ADMIN = { user: { id: "u2", email: "admin@myhelper.pl" } };
const DATA = { salon: "s1", employees: 3, services: 5, clients: 3, appointments: 5 };

beforeEach(() => {
  mockGetSession.mockReset();
  seedDemoData.mockReset();
  seedDemoData.mockResolvedValue({ ok: true, data: DATA });
  process.env.ADMIN_EMAILS = "admin@myhelper.pl";
});

afterEach(() => {
  vi.unstubAllEnvs();
  if (ORIGINAL_ADMINS === undefined) delete process.env.ADMIN_EMAILS;
  else process.env.ADMIN_EMAILS = ORIGINAL_ADMINS;
});

describe("POST /api/seed — bramka admina", () => {
  it("401 bez sesji", async () => {
    mockGetSession.mockResolvedValue(null);
    expect((await POST()).status).toBe(401);
    expect(seedDemoData).not.toHaveBeenCalled();
  });

  it("user.role='owner' spoza ADMIN_EMAILS => 403, bez zapisu", async () => {
    mockGetSession.mockResolvedValue({ user: { id: "u1", email: "owner@salon.pl", role: "owner" } });
    expect((await POST()).status).toBe(403);
    expect(seedDemoData).not.toHaveBeenCalled();
  });

  it("admin z listy (bez user.role) przechodzi bramkę i woła wyjście", async () => {
    mockGetSession.mockResolvedValue(ADMIN);
    await POST();
    expect(seedDemoData).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/seed — blokady i wynik wyjścia", () => {
  it("403 w produkcji, przed sesją i wyjściem", async () => {
    vi.stubEnv("NODE_ENV", "production");
    mockGetSession.mockResolvedValue(ADMIN);
    const res = await POST();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Seed route is disabled in production" });
    expect(mockGetSession).not.toHaveBeenCalled();
    expect(seedDemoData).not.toHaveBeenCalled();
  });

  it("403 przy odmowie wyjścia (cel bazy), neutralny komunikat bez kodu powodu", async () => {
    mockGetSession.mockResolvedValue(ADMIN);
    seedDemoData.mockResolvedValue({ ok: false, reason: "neon" });
    const res = await POST();
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toEqual({ success: false, error: "Seed is disabled for this database target" });
    expect(JSON.stringify(body)).not.toContain("neon");
  });

  it("200 przy sukcesie: kształt odpowiedzi jak przed zmianą", async () => {
    mockGetSession.mockResolvedValue(ADMIN);
    const res = await POST();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, message: "Seed completed successfully", data: DATA });
  });

  it("500 przy błędzie wyjścia", async () => {
    mockGetSession.mockResolvedValue(ADMIN);
    seedDemoData.mockRejectedValue(new Error("db offline"));
    const res = await POST();
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ success: false, error: "Failed to seed data" });
  });
});
