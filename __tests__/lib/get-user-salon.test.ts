import { describe, it, expect, vi, beforeEach } from "vitest";

// Use vi.hoisted to declare mock variables available to vi.mock factories
const { mockGetSession, mockDbLimit, mockDbWhere, mockDbFrom, mockDbSelect } =
  vi.hoisted(() => {
    const mockDbLimit = vi.fn();
    const mockDbWhere = vi.fn().mockReturnValue({ limit: mockDbLimit });
    const mockDbFrom = vi.fn().mockReturnValue({ where: mockDbWhere });
    const mockDbSelect = vi.fn().mockReturnValue({ from: mockDbFrom });
    const mockGetSession = vi.fn();
    return { mockGetSession, mockDbLimit, mockDbWhere, mockDbFrom, mockDbSelect };
  });

// Mock next/headers
vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue(new Headers()),
}));

// Mock auth
vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: (...args: unknown[]) => mockGetSession(...args),
    },
  },
}));

// Mock database
vi.mock("@/lib/db", () => ({
  db: {
    select: (...args: unknown[]) => mockDbSelect(...args),
  },
}));

// Mock drizzle-orm
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: unknown[]) => ({ type: "eq", args })),
}));

// Mock schema
vi.mock("@/lib/schema", () => ({
  salons: {
    id: "salons.id",
    ownerId: "salons.ownerId",
  },
}));

import { getUserSalon, getUserSalonId } from "@/lib/get-user-salon";

describe("getUserSalon", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbSelect.mockReturnValue({ from: mockDbFrom });
    mockDbFrom.mockReturnValue({ where: mockDbWhere });
    mockDbWhere.mockReturnValue({ limit: mockDbLimit });
  });

  it("should return null when user is not authenticated", async () => {
    mockGetSession.mockResolvedValue(null);
    const result = await getUserSalon();
    expect(result).toBeNull();
  });

  it("should return the salon when user is authenticated and owns a salon", async () => {
    mockGetSession.mockResolvedValue({
      user: { id: "user-123" },
    });
    const salon = { id: "salon-456", ownerId: "user-123", name: "My Salon" };
    mockDbLimit.mockResolvedValue([salon]);

    const result = await getUserSalon();
    expect(result).toEqual(salon);
  });

  it("should return null when authenticated user does not own a salon", async () => {
    mockGetSession.mockResolvedValue({
      user: { id: "user-123" },
    });
    mockDbLimit.mockResolvedValue([]);

    const result = await getUserSalon();
    expect(result).toBeNull();
  });
});

describe("getUserSalonId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbSelect.mockReturnValue({ from: mockDbFrom });
    mockDbFrom.mockReturnValue({ where: mockDbWhere });
    mockDbWhere.mockReturnValue({ limit: mockDbLimit });
  });

  it("should return null when user is not authenticated", async () => {
    mockGetSession.mockResolvedValue(null);
    const result = await getUserSalonId();
    expect(result).toBeNull();
  });

  it("should return the salon ID when user owns a salon", async () => {
    mockGetSession.mockResolvedValue({
      user: { id: "user-123" },
    });
    mockDbLimit.mockResolvedValue([{ id: "salon-456", ownerId: "user-123" }]);

    const result = await getUserSalonId();
    expect(result).toBe("salon-456");
  });

  it("should return null when authenticated user does not own a salon", async () => {
    mockGetSession.mockResolvedValue({
      user: { id: "user-123" },
    });
    mockDbLimit.mockResolvedValue([]);

    const result = await getUserSalonId();
    expect(result).toBeNull();
  });
});
