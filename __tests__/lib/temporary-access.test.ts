import { describe, it, expect, vi, beforeEach } from "vitest";

// Use vi.hoisted for mock variables
const {
  mockDbReturning,
  mockDbDeleteWhere,
  mockDbDeleteFrom,
  mockDbLimit,
  mockDbWhere,
  mockDbFrom,
  mockDbSelect,
} = vi.hoisted(() => {
  const mockDbReturning = vi.fn();
  const mockDbDeleteWhere = vi.fn().mockReturnValue({ returning: mockDbReturning });
  const mockDbDeleteFrom = vi.fn().mockReturnValue({ where: mockDbDeleteWhere });
  const mockDbLimit = vi.fn();
  const mockDbWhere = vi.fn().mockReturnValue({ limit: mockDbLimit });
  const mockDbFrom = vi.fn().mockReturnValue({ where: mockDbWhere });
  const mockDbSelect = vi.fn().mockReturnValue({ from: mockDbFrom });
  return {
    mockDbReturning,
    mockDbDeleteWhere,
    mockDbDeleteFrom,
    mockDbLimit,
    mockDbWhere,
    mockDbFrom,
    mockDbSelect,
  };
});

vi.mock("@/lib/db", () => ({
  db: {
    select: (...args: unknown[]) => mockDbSelect(...args),
    delete: (...args: unknown[]) => mockDbDeleteFrom(...args),
  },
}));

// Mock drizzle-orm
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: unknown[]) => ({ type: "eq", args })),
  and: vi.fn((...args: unknown[]) => ({ type: "and", args })),
  gt: vi.fn((...args: unknown[]) => ({ type: "gt", args })),
  lt: vi.fn((...args: unknown[]) => ({ type: "lt", args })),
}));

// Mock schema
vi.mock("@/lib/schema", () => ({
  temporaryAccess: {
    id: "temporaryAccess.id",
    userId: "temporaryAccess.userId",
    featureName: "temporaryAccess.featureName",
    expiresAt: "temporaryAccess.expiresAt",
  },
}));

import {
  hasTemporaryAccess,
  getActiveTemporaryAccess,
  cleanupExpiredTemporaryAccess,
} from "@/lib/temporary-access";

describe("hasTemporaryAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbSelect.mockReturnValue({ from: mockDbFrom });
    mockDbFrom.mockReturnValue({ where: mockDbWhere });
    mockDbWhere.mockReturnValue({ limit: mockDbLimit });
  });

  it("should return true when user has active temporary access", async () => {
    mockDbLimit.mockResolvedValue([{ id: "grant-1" }]);
    const result = await hasTemporaryAccess("user-123", "reports");
    expect(result).toBe(true);
  });

  it("should return false when no grant is found", async () => {
    mockDbLimit.mockResolvedValue([]);
    const result = await hasTemporaryAccess("user-123", "reports");
    expect(result).toBe(false);
  });

  it("should call db.select with correct structure", async () => {
    mockDbLimit.mockResolvedValue([]);
    await hasTemporaryAccess("user-123", "reports");
    expect(mockDbSelect).toHaveBeenCalled();
    expect(mockDbFrom).toHaveBeenCalled();
    expect(mockDbWhere).toHaveBeenCalled();
    expect(mockDbLimit).toHaveBeenCalledWith(1);
  });
});

describe("getActiveTemporaryAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // getActiveTemporaryAccess uses db.select().from().where() without .limit()
    const mockWhereNoLimit = vi.fn();
    mockDbFrom.mockReturnValue({ where: mockWhereNoLimit });
    mockDbSelect.mockReturnValue({ from: mockDbFrom });
    // Store for test access
    (globalThis as Record<string, unknown>).__mockWhereNoLimit = mockWhereNoLimit;
  });

  it("should return array of active grants", async () => {
    const grants = [
      { id: "1", userId: "user-1", featureName: "reports", expiresAt: new Date() },
      { id: "2", userId: "user-1", featureName: "settings", expiresAt: new Date() },
    ];
    const mockWhere = vi.fn().mockResolvedValue(grants);
    mockDbFrom.mockReturnValue({ where: mockWhere });

    const result = await getActiveTemporaryAccess("user-1");
    expect(result).toEqual(grants);
  });

  it("should return empty array when no active grants exist", async () => {
    const mockWhere = vi.fn().mockResolvedValue([]);
    mockDbFrom.mockReturnValue({ where: mockWhere });

    const result = await getActiveTemporaryAccess("user-1");
    expect(result).toEqual([]);
  });
});

describe("cleanupExpiredTemporaryAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbDeleteFrom.mockReturnValue({ where: mockDbDeleteWhere });
    mockDbDeleteWhere.mockReturnValue({ returning: mockDbReturning });
  });

  it("should return 0 when no expired entries exist", async () => {
    mockDbReturning.mockResolvedValue([]);
    const count = await cleanupExpiredTemporaryAccess();
    expect(count).toBe(0);
  });

  it("should return count of removed entries", async () => {
    mockDbReturning.mockResolvedValue([{ id: "1" }, { id: "2" }, { id: "3" }]);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const count = await cleanupExpiredTemporaryAccess();
    expect(count).toBe(3);
  });

  it("should log warning when entries are cleaned up", async () => {
    mockDbReturning.mockResolvedValue([{ id: "1" }]);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await cleanupExpiredTemporaryAccess();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Removed 1 expired entries")
    );
  });

  it("should not log warning when no entries are cleaned up", async () => {
    mockDbReturning.mockResolvedValue([]);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await cleanupExpiredTemporaryAccess();
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
