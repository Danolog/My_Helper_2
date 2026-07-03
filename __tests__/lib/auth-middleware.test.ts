/**
 * requireAuth — brama sesji dla tras API (P0 audytu: 91 endpointow bez auth).
 * Kontrakt:
 *   - brak sesji => NextResponse 401,
 *   - requiredRole i inna rola usera => NextResponse 403,
 *   - zgodna rola / brak wymogu roli => { session, user },
 *   - isAuthError odroznia NextResponse od wyniku auth.
 * (requireCronSecret jest testowany przy trasach cronowych.)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
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

import { requireAuth, isAuthError } from "@/lib/auth-middleware";

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

  it("zwraca 403, gdy rola usera nie zgadza sie z wymagana", async () => {
    mockGetSession.mockResolvedValue({ user: { id: "u1", role: "employee" } });

    const result = await requireAuth("owner");
    expect(isAuthError(result)).toBe(true);
    const response = result as NextResponse;
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body).toEqual({ success: false, error: "Brak uprawnień" });
  });

  it("zwraca 403 takze gdy user w ogole nie ma roli", async () => {
    mockGetSession.mockResolvedValue({ user: { id: "u1" } });

    const result = await requireAuth("owner");
    expect(isAuthError(result)).toBe(true);
    expect((result as NextResponse).status).toBe(403);
  });

  it("przepuszcza usera ze zgodna rola", async () => {
    const session = { user: { id: "u1", role: "owner" } };
    mockGetSession.mockResolvedValue(session);

    const result = await requireAuth("owner");
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
