/**
 * requireAuth — brama sesji dla tras API (P0 audytu: 91 endpointow bez auth).
 * Kontrakt:
 *   - brak sesji => NextResponse 401,
 *   - sesja => { session, user } (bez sprawdzania user.role),
 *   - isAuthError odroznia NextResponse od wyniku auth.
 * (requireCronSecret jest testowany przy trasach cronowych.)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextResponse } from "next/server";

const { mockGetSession } = vi.hoisted(() => ({ mockGetSession: vi.fn() }));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ cookie: "session=abc" })),
}));

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: (...args: unknown[]) => mockGetSession(...args),
    },
  },
}));

import { requireAuth, requirePlatformAdmin, isAuthError } from "@/lib/auth-middleware";

describe("requireAuth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("zwraca 401, gdy brak sesji", async () => {
    mockGetSession.mockResolvedValue(null);

    const result = await requireAuth();
    expect(isAuthError(result)).toBe(true);
    const response = result as NextResponse;
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body).toEqual({ success: false, error: "Wymagane logowanie" });
  });

  it("przepuszcza zalogowanego usera bez wymogu roli", async () => {
    const session = { user: { id: "u1", email: "a@b.pl", role: "employee" } };
    mockGetSession.mockResolvedValue(session);

    const result = await requireAuth();
    expect(isAuthError(result)).toBe(false);
    expect(result).toEqual({ session, user: session.user });
  });

  it("nie przyjmuje roli — user.role nie jest uprawnieniem (sygnatura bez argumentu)", async () => {
    const session = { user: { id: "u1", role: "employee" } };
    mockGetSession.mockResolvedValue(session);

    // requireAuth nie ma już parametru roli: uprawnienia salonu =
    // requireSalonStaff (salons.ownerId / employees.role), admin platformy =
    // requirePlatformAdmin (ADMIN_EMAILS).
    expect(requireAuth.length).toBe(0);
    const result = await requireAuth();
    expect(result).toEqual({ session, user: session.user });
  });
});

describe("requirePlatformAdmin (jawna lista ADMIN_EMAILS, nie user.role)", () => {
  const original = process.env.ADMIN_EMAILS;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (original === undefined) delete process.env.ADMIN_EMAILS;
    else process.env.ADMIN_EMAILS = original;
  });

  it("401 bez sesji", async () => {
    process.env.ADMIN_EMAILS = "admin@myhelper.pl";
    mockGetSession.mockResolvedValue(null);
    const result = await requirePlatformAdmin();
    expect((result as NextResponse).status).toBe(401);
  });

  it("pusta/nieustawiona lista => nikt (nawet user.role='owner')", async () => {
    delete process.env.ADMIN_EMAILS;
    mockGetSession.mockResolvedValue({ user: { id: "u1", email: "darek@x.pl", role: "owner" } });
    const result = await requirePlatformAdmin();
    expect((result as NextResponse).status).toBe(403);

    process.env.ADMIN_EMAILS = " , ";
    const again = await requirePlatformAdmin();
    expect((again as NextResponse).status).toBe(403);
  });

  it("user.role='owner' spoza listy => 403", async () => {
    process.env.ADMIN_EMAILS = "admin@myhelper.pl";
    mockGetSession.mockResolvedValue({ user: { id: "u1", email: "owner@salon.pl", role: "owner" } });
    const result = await requirePlatformAdmin();
    expect((result as NextResponse).status).toBe(403);
  });

  it("e-mail z listy (bez roli, wielkość liter i spacje bez znaczenia) => przepuszcza", async () => {
    process.env.ADMIN_EMAILS = "ops@myhelper.pl, Admin@MyHelper.pl";
    const session = { user: { id: "u2", email: "admin@myhelper.pl" } };
    mockGetSession.mockResolvedValue(session);
    const result = await requirePlatformAdmin();
    expect(isAuthError(result)).toBe(false);
    expect(result).toEqual({ session, user: session.user });
  });
});

describe("isAuthError", () => {
  it("true dla NextResponse, false dla wyniku auth", () => {
    expect(isAuthError(NextResponse.json({}, { status: 401 }))).toBe(true);
    const authResult = { session: { user: { id: "u1" } }, user: { id: "u1" } };
    expect(isAuthError(authResult as never)).toBe(false);
  });
});
