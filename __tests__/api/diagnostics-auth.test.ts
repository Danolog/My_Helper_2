/**
 * GET /api/diagnostics — dostęp tylko dla adminów platformy z ADMIN_EMAILS.
 *
 * Przed naprawą bramką był requireAuth("owner") = user.role, który na
 * produkcji ma jedno konto (i nie oznacza admina platformy). Teraz jawna
 * lista e-maili z env; pusta = nikt.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GET } from "@/app/api/diagnostics/route";

const { mockGetSession } = vi.hoisted(() => ({ mockGetSession: vi.fn() }));

vi.mock("next/headers", () => ({ headers: vi.fn().mockResolvedValue(new Headers()) }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: mockGetSession } } }));

const ORIGINAL_ADMINS = process.env.ADMIN_EMAILS;
const ORIGINAL_PG = process.env.POSTGRES_URL;

function call() {
  return GET(new Request("http://localhost/api/diagnostics"));
}

describe("GET /api/diagnostics — bramka admina", () => {
  beforeEach(() => {
    mockGetSession.mockReset();
    // Bez bazy i bez sieci: diagnostyka sprawdza tylko env, fetch auth odrzucony.
    delete process.env.POSTGRES_URL;
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (ORIGINAL_ADMINS === undefined) delete process.env.ADMIN_EMAILS;
    else process.env.ADMIN_EMAILS = ORIGINAL_ADMINS;
    if (ORIGINAL_PG === undefined) delete process.env.POSTGRES_URL;
    else process.env.POSTGRES_URL = ORIGINAL_PG;
  });

  it("401 bez sesji", async () => {
    mockGetSession.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
  });

  it("user.role='owner' spoza ADMIN_EMAILS => 403", async () => {
    process.env.ADMIN_EMAILS = "admin@myhelper.pl";
    mockGetSession.mockResolvedValue({ user: { id: "u1", email: "owner@salon.pl", role: "owner" } });
    expect((await call()).status).toBe(403);
  });

  it("pusta ADMIN_EMAILS => 403 dla każdego", async () => {
    delete process.env.ADMIN_EMAILS;
    mockGetSession.mockResolvedValue({ user: { id: "u1", email: "owner@salon.pl", role: "owner" } });
    expect((await call()).status).toBe(403);
  });

  it("admin z listy (bez user.role) dostaje raport", async () => {
    process.env.ADMIN_EMAILS = "admin@myhelper.pl";
    mockGetSession.mockResolvedValue({ user: { id: "u2", email: "admin@myhelper.pl" } });
    const res = await call();
    expect([200, 503]).toContain(res.status);
    const body = await res.json();
    expect(body).toHaveProperty("overallStatus");
  });
});
