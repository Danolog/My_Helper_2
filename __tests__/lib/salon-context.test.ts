/**
 * Faza 3 — role pracownik/recepcja: getSalonContext + hasFeatureAccess.
 *
 * Mocki wzorowane na __tests__/lib/get-user-salon.test.ts (chain
 * db.select().from().where().limit()). Kolejność zapytań w getSalonContext:
 *   1. salon właścicielski (salons.ownerId === user.id),
 *   2a. (owner) własny rekord employees w tym salonie,
 *   2b. (nie-owner) aktywny pracownik (employees.userId AND isActive).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Use vi.hoisted to declare mock variables available to vi.mock factories
const {
  mockGetSession,
  mockDbLimit,
  mockDbWhere,
  mockDbFrom,
  mockDbSelect,
  mockHasTemporaryAccess,
} = vi.hoisted(() => {
  const mockDbLimit = vi.fn();
  const mockDbWhere = vi.fn().mockReturnValue({ limit: mockDbLimit });
  const mockDbFrom = vi.fn().mockReturnValue({ where: mockDbWhere });
  const mockDbSelect = vi.fn().mockReturnValue({ from: mockDbFrom });
  const mockGetSession = vi.fn();
  const mockHasTemporaryAccess = vi.fn();
  return {
    mockGetSession,
    mockDbLimit,
    mockDbWhere,
    mockDbFrom,
    mockDbSelect,
    mockHasTemporaryAccess,
  };
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
  and: vi.fn((...args: unknown[]) => ({ type: "and", args })),
}));

// Mock schema
vi.mock("@/lib/schema", () => ({
  salons: {
    id: "salons.id",
    ownerId: "salons.ownerId",
  },
  employees: {
    id: "employees.id",
    salonId: "employees.salonId",
    userId: "employees.userId",
    role: "employees.role",
    isActive: "employees.isActive",
  },
}));

// Mock temporary-access
vi.mock("@/lib/temporary-access", () => ({
  hasTemporaryAccess: (...args: unknown[]) => mockHasTemporaryAccess(...args),
}));

import { eq } from "drizzle-orm";
import {
  getSalonContext,
  hasFeatureAccess,
  type SalonContext,
} from "@/lib/salon-context";

describe("getSalonContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbSelect.mockReturnValue({ from: mockDbFrom });
    mockDbFrom.mockReturnValue({ where: mockDbWhere });
    mockDbWhere.mockReturnValue({ limit: mockDbLimit });
  });

  it("should return null when user is not authenticated", async () => {
    mockGetSession.mockResolvedValue(null);

    const result = await getSalonContext();

    expect(result).toBeNull();
    expect(mockDbSelect).not.toHaveBeenCalled();
  });

  it("should return role 'owner' with employeeId when owner has own employees record", async () => {
    mockGetSession.mockResolvedValue({ user: { id: "user-123" } });
    mockDbLimit
      .mockResolvedValueOnce([{ id: "salon-456" }]) // owned salon
      .mockResolvedValueOnce([{ id: "emp-1" }]); // own employees record in that salon

    const result = await getSalonContext();

    expect(result).toEqual({
      salonId: "salon-456",
      role: "owner",
      employeeId: "emp-1",
      userId: "user-123",
    });
  });

  it("should return role 'owner' with employeeId=null when owner has no employees record", async () => {
    mockGetSession.mockResolvedValue({ user: { id: "user-123" } });
    mockDbLimit
      .mockResolvedValueOnce([{ id: "salon-456" }]) // owned salon
      .mockResolvedValueOnce([]); // no own employees record

    const result = await getSalonContext();

    expect(result).toEqual({
      salonId: "salon-456",
      role: "owner",
      employeeId: null,
      userId: "user-123",
    });
  });

  it("should return role 'employee' with salonId from the record for an active employee", async () => {
    mockGetSession.mockResolvedValue({ user: { id: "user-123" } });
    mockDbLimit
      .mockResolvedValueOnce([]) // no owned salon
      .mockResolvedValueOnce([
        { id: "emp-7", salonId: "salon-999", role: "employee" },
      ]);

    const result = await getSalonContext();

    expect(result).toEqual({
      salonId: "salon-999",
      role: "employee",
      employeeId: "emp-7",
      userId: "user-123",
    });
    // Zapytanie o pracownika filtruje po isActive — nieaktywny nie przejdzie.
    expect(eq).toHaveBeenCalledWith("employees.isActive", true);
  });

  it("should return role 'receptionist' for an active receptionist", async () => {
    mockGetSession.mockResolvedValue({ user: { id: "user-123" } });
    mockDbLimit
      .mockResolvedValueOnce([]) // no owned salon
      .mockResolvedValueOnce([
        { id: "emp-8", salonId: "salon-999", role: "receptionist" },
      ]);

    const result = await getSalonContext();

    expect(result).toEqual({
      salonId: "salon-999",
      role: "receptionist",
      employeeId: "emp-8",
      userId: "user-123",
    });
  });

  it("should map any non-receptionist employees.role to 'employee'", async () => {
    mockGetSession.mockResolvedValue({ user: { id: "user-123" } });
    mockDbLimit
      .mockResolvedValueOnce([]) // no owned salon
      .mockResolvedValueOnce([
        { id: "emp-9", salonId: "salon-999", role: "owner" }, // etykieta, nie uprawnienia
      ]);

    const result = await getSalonContext();

    expect(result?.role).toBe("employee");
  });

  it("should return null for an inactive employee (query filtered by isActive)", async () => {
    mockGetSession.mockResolvedValue({ user: { id: "user-123" } });
    // Nieaktywny pracownik nie przechodzi filtra isActive => puste wyniki.
    mockDbLimit
      .mockResolvedValueOnce([]) // no owned salon
      .mockResolvedValueOnce([]); // no ACTIVE employee record

    const result = await getSalonContext();

    expect(result).toBeNull();
  });

  it("should return null when user is neither owner nor employee", async () => {
    mockGetSession.mockResolvedValue({ user: { id: "user-123" } });
    mockDbLimit.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    const result = await getSalonContext();

    expect(result).toBeNull();
  });
});

describe("hasFeatureAccess", () => {
  const ownerCtx: SalonContext = {
    salonId: "salon-1",
    role: "owner",
    employeeId: null,
    userId: "user-owner",
  };
  const employeeCtx: SalonContext = {
    salonId: "salon-1",
    role: "employee",
    employeeId: "emp-1",
    userId: "user-emp",
  };
  const receptionistCtx: SalonContext = {
    salonId: "salon-1",
    role: "receptionist",
    employeeId: "emp-2",
    userId: "user-rec",
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should always return true for owner without checking temporary access", async () => {
    const result = await hasFeatureAccess(ownerCtx, "reports");

    expect(result).toBe(true);
    expect(mockHasTemporaryAccess).not.toHaveBeenCalled();
  });

  it("should return false for employee without a temporary access grant", async () => {
    mockHasTemporaryAccess.mockResolvedValue(false);

    const result = await hasFeatureAccess(employeeCtx, "reports");

    expect(result).toBe(false);
    expect(mockHasTemporaryAccess).toHaveBeenCalledWith("user-emp", "reports", "salon-1");
  });

  it("should return true for employee with an active temporary access grant", async () => {
    mockHasTemporaryAccess.mockResolvedValue(true);

    const result = await hasFeatureAccess(employeeCtx, "reports");

    expect(result).toBe(true);
    expect(mockHasTemporaryAccess).toHaveBeenCalledWith("user-emp", "reports", "salon-1");
  });

  it("should consult temporary access for receptionist as well", async () => {
    mockHasTemporaryAccess.mockResolvedValue(false);

    const result = await hasFeatureAccess(receptionistCtx, "sms");

    expect(result).toBe(false);
    expect(mockHasTemporaryAccess).toHaveBeenCalledWith("user-rec", "sms", "salon-1");
  });
});
