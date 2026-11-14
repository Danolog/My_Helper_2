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
  eq: vi.fn((...args: unknown[]) => ({ type: "eq", args })),
  and: vi.fn((...args: unknown[]) => ({ type: "and", args })),
}));

// Mock schema
vi.mock("@/lib/schema", () => ({
  salons: { id: "salons.id", ownerId: "salons.ownerId" },
  employees: {
    id: "employees.id",
    salonId: "employees.salonId",
    userId: "employees.userId",
    role: "employees.role",
    isActive: "employees.isActive",
  },
}));

import { auth } from "@/lib/auth";
import {
  isProtectedRoute,
  isAdminRoute,
  protectedRoutes,
  adminRoutes,
  requireAuth,
  requireAdmin,
  requireDashboardAccess,
  getOptionalSession,
  hasActiveSession,
} from "@/lib/session";

// Import mock references so we can control their behavior per test
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

const mockGetSession = auth.api.getSession as unknown as ReturnType<typeof vi.fn>;
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

  it.each(["admin", "owner"])(
    "user.role '%s' bez salonu NIE daje isAdmin (własność = salons.ownerId)",
    async (role) => {
      const fakeSession = createFakeSession({ role });
      mockGetSession.mockResolvedValue(fakeSession);
      mockLimit.mockResolvedValue([]); // brak salonu

      const result = await requireAdmin();

      expect(result).toEqual({ session: fakeSession, isAdmin: false });
      expect(mockSelect).toHaveBeenCalled();
    }
  );

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

describe("requireDashboardAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the db chain mocks
    mockSelect.mockReturnValue({ from: mockFrom });
    mockFrom.mockReturnValue({ where: mockWhere });
    mockWhere.mockReturnValue({ limit: mockLimit });
  });

  it.each(["admin", "owner"])(
    "user.role '%s' bez salonu i bez rekordu pracownika => brak wstępu do panelu",
    async (role) => {
      const fakeSession = createFakeSession({ role });
      mockGetSession.mockResolvedValue(fakeSession);
      mockLimit.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

      const result = await requireDashboardAccess();

      expect(result).toEqual({ session: fakeSession, allowed: false, role: null });
    }
  );

  it("user.role 'owner' u pracownika => rola z employees, nie 'owner'", async () => {
    const fakeSession = createFakeSession({ role: "owner" });
    mockGetSession.mockResolvedValue(fakeSession);
    mockLimit
      .mockResolvedValueOnce([]) // brak salonu właścicielskiego
      .mockResolvedValueOnce([{ id: "emp-1", salonId: "salon-1", role: "employee" }]);

    const result = await requireDashboardAccess();

    expect(result).toEqual({ session: fakeSession, allowed: true, role: "employee" });
  });

  it("konto z kilkoma aktywnymi rekordami pracownika => brak wstępu (fail-closed)", async () => {
    const fakeSession = createFakeSession({ role: "client" });
    mockGetSession.mockResolvedValue(fakeSession);
    mockLimit.mockResolvedValueOnce([]).mockResolvedValueOnce([
      { id: "emp-1", salonId: "salon-1", role: "employee" },
      { id: "emp-2", salonId: "salon-2", role: "employee" },
    ]);

    const result = await requireDashboardAccess();

    expect(result).toEqual({ session: fakeSession, allowed: false, role: null });
  });

  it("should return role 'owner' when user owns a salon", async () => {
    const fakeSession = createFakeSession({ role: "client" });
    mockGetSession.mockResolvedValue(fakeSession);
    mockLimit
      .mockResolvedValueOnce([{ id: "salon-1" }])
      .mockResolvedValueOnce([]); // brak własnego rekordu employees

    const result = await requireDashboardAccess();

    expect(result).toEqual({ session: fakeSession, allowed: true, role: "owner" });
  });

  it("should return role 'employee' for an active linked employee", async () => {
    const fakeSession = createFakeSession({ role: "client" });
    mockGetSession.mockResolvedValue(fakeSession);
    mockLimit
      .mockResolvedValueOnce([]) // no owned salon
      .mockResolvedValueOnce([{ id: "emp-1", salonId: "salon-1", role: "employee" }]); // active employee

    const result = await requireDashboardAccess();

    expect(result).toEqual({ session: fakeSession, allowed: true, role: "employee" });
  });

  it("should return role 'receptionist' for an active linked receptionist", async () => {
    const fakeSession = createFakeSession({ role: "client" });
    mockGetSession.mockResolvedValue(fakeSession);
    mockLimit
      .mockResolvedValueOnce([]) // no owned salon
      .mockResolvedValueOnce([{ id: "emp-2", salonId: "salon-1", role: "receptionist" }]);

    const result = await requireDashboardAccess();

    expect(result).toEqual({
      session: fakeSession,
      allowed: true,
      role: "receptionist",
    });
  });

  it("should return allowed=false and role=null when user is neither owner nor employee", async () => {
    const fakeSession = createFakeSession({ role: "client" });
    mockGetSession.mockResolvedValue(fakeSession);
    mockLimit.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    const result = await requireDashboardAccess();

    expect(result).toEqual({ session: fakeSession, allowed: false, role: null });
  });

  it("should redirect to '/login' when not authenticated", async () => {
    mockGetSession.mockResolvedValue(null);
    mockRedirect.mockImplementation(() => {
      throw new Error("NEXT_REDIRECT");
    });

    await expect(requireDashboardAccess()).rejects.toThrow("NEXT_REDIRECT");
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
