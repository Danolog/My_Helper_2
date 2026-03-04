import { describe, it, expect, vi, beforeEach } from "vitest";

// Use vi.hoisted to create mock variables that are available inside vi.mock factories
const {
  mockGetUserSalonId,
  mockDbLimit,
  mockDbOrderBy,
  mockDbWhere,
  mockDbInnerJoin,
  mockDbFrom,
  mockDbSelect,
} = vi.hoisted(() => {
  const mockDbLimit = vi.fn();
  const mockDbOrderBy = vi.fn().mockReturnValue({ limit: mockDbLimit });
  const mockDbWhere = vi.fn().mockReturnValue({ orderBy: mockDbOrderBy });
  const mockDbInnerJoin = vi.fn().mockReturnValue({ where: mockDbWhere });
  const mockDbFrom = vi.fn().mockReturnValue({ innerJoin: mockDbInnerJoin });
  const mockDbSelect = vi.fn().mockReturnValue({ from: mockDbFrom });
  const mockGetUserSalonId = vi.fn();
  return {
    mockGetUserSalonId,
    mockDbLimit,
    mockDbOrderBy,
    mockDbWhere,
    mockDbInnerJoin,
    mockDbFrom,
    mockDbSelect,
  };
});

// Mock get-user-salon
vi.mock("@/lib/get-user-salon", () => ({
  getUserSalonId: () => mockGetUserSalonId(),
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
  and: vi.fn((...args: unknown[]) => ({ type: "and", args })),
  desc: vi.fn((col: unknown) => ({ type: "desc", col })),
  inArray: vi.fn((...args: unknown[]) => ({ type: "inArray", args })),
}));

// Mock schema
vi.mock("@/lib/schema", () => ({
  salonSubscriptions: {
    salonId: "salonSubscriptions.salonId",
    planId: "salonSubscriptions.planId",
    status: "salonSubscriptions.status",
    createdAt: "salonSubscriptions.createdAt",
  },
  subscriptionPlans: {
    id: "subscriptionPlans.id",
    slug: "subscriptionPlans.slug",
    name: "subscriptionPlans.name",
  },
}));

// Mock next/headers (needed by get-user-salon -> auth -> session)
vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue(new Headers()),
}));

// Mock auth (prevents db.ts from loading)
vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

import { getCurrentPlan, isProPlan } from "@/lib/subscription";

describe("getCurrentPlan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the chain
    mockDbSelect.mockReturnValue({ from: mockDbFrom });
    mockDbFrom.mockReturnValue({ innerJoin: mockDbInnerJoin });
    mockDbInnerJoin.mockReturnValue({ where: mockDbWhere });
    mockDbWhere.mockReturnValue({ orderBy: mockDbOrderBy });
    mockDbOrderBy.mockReturnValue({ limit: mockDbLimit });
  });

  it("should return basic plan when salonId is not provided and user has no salon", async () => {
    mockGetUserSalonId.mockResolvedValue(null);
    const plan = await getCurrentPlan();
    expect(plan).toEqual({ slug: "basic", name: "Basic", status: "active" });
  });

  it("should return basic plan when no subscription is found", async () => {
    mockDbLimit.mockResolvedValue([]);
    const plan = await getCurrentPlan("salon-123");
    expect(plan).toEqual({ slug: "basic", name: "Basic", status: "active" });
  });

  it("should return the active subscription plan", async () => {
    mockDbLimit.mockResolvedValue([
      { planSlug: "pro", planName: "Pro", status: "active" },
    ]);
    const plan = await getCurrentPlan("salon-123");
    expect(plan).toEqual({ slug: "pro", name: "Pro", status: "active" });
  });

  it("should return trialing plan", async () => {
    mockDbLimit.mockResolvedValue([
      { planSlug: "pro", planName: "Pro", status: "trialing" },
    ]);
    const plan = await getCurrentPlan("salon-123");
    expect(plan).toEqual({ slug: "pro", name: "Pro", status: "trialing" });
  });

  it("should fallback to basic plan on database error", async () => {
    mockDbLimit.mockRejectedValue(new Error("DB error"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const plan = await getCurrentPlan("salon-123");
    expect(plan).toEqual({ slug: "basic", name: "Basic", status: "active" });
  });

  it("should use getUserSalonId when salonId is not provided", async () => {
    mockGetUserSalonId.mockResolvedValue("resolved-salon");
    mockDbLimit.mockResolvedValue([
      { planSlug: "basic", planName: "Basic", status: "active" },
    ]);

    await getCurrentPlan();
    expect(mockGetUserSalonId).toHaveBeenCalled();
  });
});

describe("isProPlan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbSelect.mockReturnValue({ from: mockDbFrom });
    mockDbFrom.mockReturnValue({ innerJoin: mockDbInnerJoin });
    mockDbInnerJoin.mockReturnValue({ where: mockDbWhere });
    mockDbWhere.mockReturnValue({ orderBy: mockDbOrderBy });
    mockDbOrderBy.mockReturnValue({ limit: mockDbLimit });
  });

  it("should return true when plan is pro", async () => {
    mockDbLimit.mockResolvedValue([
      { planSlug: "pro", planName: "Pro", status: "active" },
    ]);
    const result = await isProPlan("salon-123");
    expect(result).toBe(true);
  });

  it("should return false when plan is basic", async () => {
    mockDbLimit.mockResolvedValue([
      { planSlug: "basic", planName: "Basic", status: "active" },
    ]);
    const result = await isProPlan("salon-123");
    expect(result).toBe(false);
  });

  it("should return false when no subscription found (defaults to basic)", async () => {
    mockDbLimit.mockResolvedValue([]);
    const result = await isProPlan("salon-123");
    expect(result).toBe(false);
  });

  it("should return false on database error (defaults to basic)", async () => {
    mockDbLimit.mockRejectedValue(new Error("DB error"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await isProPlan("salon-123");
    expect(result).toBe(false);
  });
});
