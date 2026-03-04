import { describe, it, expect, vi, beforeEach } from "vitest";

// Build a chainable db mock that supports .select().from().where().limit()
const mockLimit = vi.fn();
const mockWhere = vi.fn().mockReturnValue({ limit: mockLimit });
const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
const mockSelect = vi.fn().mockReturnValue({ from: mockFrom });

// Mock the database module to prevent POSTGRES_URL error
vi.mock("@/lib/db", () => ({
  db: {
    select: (...args: unknown[]) => mockSelect(...args),
  },
}));

// Mock auth to prevent the db import chain
vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: vi.fn(),
    },
  },
}));

// Mock next/headers and next/navigation to prevent server-side errors
vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue(new Headers()),
  cookies: vi.fn().mockResolvedValue({
    has: vi.fn().mockReturnValue(false),
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));

// Mock drizzle-orm
vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
}));

// Mock schema
vi.mock("@/lib/schema", () => ({
  salons: { id: "salons.id", ownerId: "salons.ownerId" },
}));

import {
  isProtectedRoute,
  isAdminRoute,
  protectedRoutes,
  adminRoutes,
  requireAuth,
  requireAdmin,
  getOptionalSession,
  hasActiveSession,
} from "@/lib/session";

// Import mock references so we can control their behavior per test
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";

describe("protectedRoutes", () => {
  it("should be an array of strings", () => {
    expect(protectedRoutes).toBeInstanceOf(Array);
    for (const route of protectedRoutes) {
      expect(typeof route).toBe("string");
    }
  });

  it("should include /dashboard", () => {
    expect(protectedRoutes).toContain("/dashboard");
  });

  it("should include /chat", () => {
    expect(protectedRoutes).toContain("/chat");
  });

  it("should include /profile", () => {
    expect(protectedRoutes).toContain("/profile");
  });

  it("should include /admin", () => {
    expect(protectedRoutes).toContain("/admin");
  });
});

describe("adminRoutes", () => {
  it("should be an array of strings", () => {
    expect(adminRoutes).toBeInstanceOf(Array);
    for (const route of adminRoutes) {
      expect(typeof route).toBe("string");
    }
  });

  it("should include /admin", () => {
    expect(adminRoutes).toContain("/admin");
  });
});

describe("isProtectedRoute", () => {
  it("should return true for exact protected route", () => {
    expect(isProtectedRoute("/dashboard")).toBe(true);
    expect(isProtectedRoute("/chat")).toBe(true);
    expect(isProtectedRoute("/profile")).toBe(true);
    expect(isProtectedRoute("/admin")).toBe(true);
  });

  it("should return true for sub-paths of protected routes", () => {
    expect(isProtectedRoute("/dashboard/settings")).toBe(true);
    expect(isProtectedRoute("/dashboard/clients/123")).toBe(true);
    expect(isProtectedRoute("/admin/users")).toBe(true);
  });

  it("should return false for public routes", () => {
    expect(isProtectedRoute("/")).toBe(false);
    expect(isProtectedRoute("/login")).toBe(false);
    expect(isProtectedRoute("/register")).toBe(false);
    expect(isProtectedRoute("/salons")).toBe(false);
  });

  it("should return false for paths that start with a protected route name but are different", () => {
    expect(isProtectedRoute("/dashboardx")).toBe(false);
    expect(isProtectedRoute("/chatroom")).toBe(false);
    expect(isProtectedRoute("/profiles")).toBe(false);
    expect(isProtectedRoute("/administrator")).toBe(false);
  });

  it("should return false for empty string", () => {
    expect(isProtectedRoute("")).toBe(false);
  });
});

describe("isAdminRoute", () => {
  it("should return true for exact admin route", () => {
    expect(isAdminRoute("/admin")).toBe(true);
  });

  it("should return true for sub-paths of admin routes", () => {
    expect(isAdminRoute("/admin/users")).toBe(true);
    expect(isAdminRoute("/admin/settings/general")).toBe(true);
  });

  it("should return false for non-admin routes", () => {
    expect(isAdminRoute("/dashboard")).toBe(false);
    expect(isAdminRoute("/chat")).toBe(false);
    expect(isAdminRoute("/")).toBe(false);
  });

  it("should return false for paths that just start with /admin letters but differ", () => {
    expect(isAdminRoute("/administrator")).toBe(false);
    expect(isAdminRoute("/adminx")).toBe(false);
  });

  it("should return false for empty string", () => {
    expect(isAdminRoute("")).toBe(false);
  });
});

// ─── Async Server Function Tests ─────────────────────────────────────────────

const mockGetSession = auth.api.getSession as ReturnType<typeof vi.fn>;
const mockRedirect = redirect as unknown as ReturnType<typeof vi.fn>;
const mockCookies = cookies as unknown as ReturnType<typeof vi.fn>;

// Helper to create a fake session object
function createFakeSession(overrides: Record<string, unknown> = {}) {
  return {
    session: { id: "sess-1", token: "tok-1" },
    user: { id: "user-1", name: "Test User", email: "test@example.com", ...overrides },
  };
}

describe("requireAuth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return session when authenticated", async () => {
    const fakeSession = createFakeSession();
    mockGetSession.mockResolvedValue(fakeSession);

    const result = await requireAuth();

    expect(result).toEqual(fakeSession);
    expect(mockGetSession).toHaveBeenCalledTimes(1);
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("should redirect to '/' when not authenticated", async () => {
    mockGetSession.mockResolvedValue(null);
    // Simulate Next.js redirect throwing to abort execution
    mockRedirect.mockImplementation(() => {
      throw new Error("NEXT_REDIRECT");
    });

    await expect(requireAuth()).rejects.toThrow("NEXT_REDIRECT");
    expect(mockRedirect).toHaveBeenCalledWith("/");
  });
});

describe("requireAdmin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the db chain mocks
    mockSelect.mockReturnValue({ from: mockFrom });
    mockFrom.mockReturnValue({ where: mockWhere });
    mockWhere.mockReturnValue({ limit: mockLimit });
  });

  it("should return isAdmin=true when user role is 'admin'", async () => {
    const fakeSession = createFakeSession({ role: "admin" });
    mockGetSession.mockResolvedValue(fakeSession);

    const result = await requireAdmin();

    expect(result).toEqual({ session: fakeSession, isAdmin: true });
    // Should not query the database when role is already admin
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it("should return isAdmin=true when user role is 'owner'", async () => {
    const fakeSession = createFakeSession({ role: "owner" });
    mockGetSession.mockResolvedValue(fakeSession);

    const result = await requireAdmin();

    expect(result).toEqual({ session: fakeSession, isAdmin: true });
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it("should return isAdmin=true when user owns a salon", async () => {
    const fakeSession = createFakeSession({ role: "client" });
    mockGetSession.mockResolvedValue(fakeSession);
    // Simulate db query returning a salon row
    mockLimit.mockResolvedValue([{ id: "salon-1" }]);

    const result = await requireAdmin();

    expect(result).toEqual({ session: fakeSession, isAdmin: true });
    expect(mockSelect).toHaveBeenCalled();
    expect(mockLimit).toHaveBeenCalledWith(1);
  });

  it("should return isAdmin=false when user has no admin role and no salon", async () => {
    const fakeSession = createFakeSession({ role: "client" });
    mockGetSession.mockResolvedValue(fakeSession);
    // Simulate db query returning empty array (no salon)
    mockLimit.mockResolvedValue([]);

    const result = await requireAdmin();

    expect(result).toEqual({ session: fakeSession, isAdmin: false });
    expect(mockSelect).toHaveBeenCalled();
  });

  it("should redirect to '/login' when not authenticated", async () => {
    mockGetSession.mockResolvedValue(null);
    mockRedirect.mockImplementation(() => {
      throw new Error("NEXT_REDIRECT");
    });

    await expect(requireAdmin()).rejects.toThrow("NEXT_REDIRECT");
    expect(mockRedirect).toHaveBeenCalledWith("/login");
  });
});

describe("getOptionalSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return session when authenticated", async () => {
    const fakeSession = createFakeSession();
    mockGetSession.mockResolvedValue(fakeSession);

    const result = await getOptionalSession();

    expect(result).toEqual(fakeSession);
    expect(mockGetSession).toHaveBeenCalledTimes(1);
  });

  it("should return null when not authenticated", async () => {
    mockGetSession.mockResolvedValue(null);

    const result = await getOptionalSession();

    expect(result).toBeNull();
    expect(mockGetSession).toHaveBeenCalledTimes(1);
  });
});

describe("hasActiveSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return true when 'better-auth.session_token' cookie exists", async () => {
    const mockHas = vi.fn((name: string) => name === "better-auth.session_token");
    mockCookies.mockResolvedValue({ has: mockHas });

    const result = await hasActiveSession();

    expect(result).toBe(true);
    expect(mockHas).toHaveBeenCalledWith("better-auth.session_token");
  });

  it("should return true when '__Secure-better-auth.session_token' cookie exists", async () => {
    const mockHas = vi.fn((name: string) => name === "__Secure-better-auth.session_token");
    mockCookies.mockResolvedValue({ has: mockHas });

    const result = await hasActiveSession();

    expect(result).toBe(true);
  });

  it("should return false when no session cookie exists", async () => {
    const mockHas = vi.fn().mockReturnValue(false);
    mockCookies.mockResolvedValue({ has: mockHas });

    const result = await hasActiveSession();

    expect(result).toBe(false);
    expect(mockHas).toHaveBeenCalledWith("better-auth.session_token");
    expect(mockHas).toHaveBeenCalledWith("__Secure-better-auth.session_token");
  });
});
