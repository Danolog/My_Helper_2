/**
 * Integration tests for /api/work-schedules endpoints.
 *
 * Tests cover:
 * - GET /api/work-schedules (list by employeeId)
 * - POST /api/work-schedules (create/update weekly schedule)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createMockRequest,
  parseResponse,
  makeWorkSchedule,
  makeEmployee,
  TEST_IDS,
} from "./helpers";

// -------------------------------------------------------
// Mocks
// -------------------------------------------------------

const mockDbSelect = vi.fn();
const mockDbInsert = vi.fn();
const mockDbDelete = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    select: (...args: unknown[]) => mockDbSelect(...args),
    insert: (...args: unknown[]) => mockDbInsert(...args),
    delete: (...args: unknown[]) => mockDbDelete(...args),
  },
}));

vi.mock("@/lib/schema", () => {
  const createTable = (name: string) =>
    new Proxy({}, {
      get: (_target, prop) => {
        if (prop === "_table") return name;
        return `${name}.${String(prop)}`;
      },
    });
  return {
    workSchedules: createTable("workSchedules"),
    employees: createTable("employees"),
  };
});

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: unknown[]) => ({ type: "eq", args })),
}));

vi.mock("@/lib/auth-middleware", () => ({
  requireAuth: vi.fn().mockResolvedValue({
    session: { user: { id: "test-user-id", email: "test@test.com", name: "Test User" } },
    user: { id: "test-user-id", email: "test@test.com", name: "Test User" },
  }),
  isAuthError: vi.fn().mockReturnValue(false),
}));

// -------------------------------------------------------
// Chain builder
// -------------------------------------------------------

function chainMock(result: unknown[] = []) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  const methods = [
    "select", "from", "where", "leftJoin",
    "limit", "orderBy",
    "insert", "values", "delete",
    "returning",
  ];
  for (const method of methods) {
    chain[method] = vi.fn().mockReturnValue(chain);
  }
  (chain as Record<string, unknown>).then = (resolve: (val: unknown[]) => unknown) => resolve(result);
  return chain;
}

// -------------------------------------------------------
// Import route handlers
// -------------------------------------------------------

import { GET as getWorkSchedules, POST as saveWorkSchedules } from "@/app/api/work-schedules/route";

// -------------------------------------------------------
// Tests
// -------------------------------------------------------

describe("GET /api/work-schedules", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return 200 with work schedules for an employee", async () => {
    const schedule = makeWorkSchedule();
    mockDbSelect.mockReturnValue(chainMock([schedule]));

    const request = createMockRequest(
      `http://localhost:3000/api/work-schedules?employeeId=${TEST_IDS.EMPLOYEE_UUID}`
    );
    const response = await getWorkSchedules(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(1);
    expect(body.count).toBe(1);
  });

  it("should return 400 when employeeId is missing", async () => {
    const request = createMockRequest("http://localhost:3000/api/work-schedules");
    const response = await getWorkSchedules(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toContain("employeeId is required");
  });

  it("should return 200 with empty list when no schedules found", async () => {
    mockDbSelect.mockReturnValue(chainMock([]));

    const request = createMockRequest(
      `http://localhost:3000/api/work-schedules?employeeId=${TEST_IDS.EMPLOYEE_UUID}`
    );
    const response = await getWorkSchedules(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(0);
    expect(body.count).toBe(0);
  });

  it("should return 500 when database throws", async () => {
    const errorChain: Record<string, unknown> = {};
    const methods = ["select", "from", "where", "orderBy"];
    for (const m of methods) {
      (errorChain as Record<string, ReturnType<typeof vi.fn>>)[m] = vi.fn().mockReturnValue(errorChain);
    }
    errorChain.then = (_: unknown, reject: (err: Error) => void) => reject(new Error("DB error"));
    mockDbSelect.mockReturnValue(errorChain);

    const request = createMockRequest(
      `http://localhost:3000/api/work-schedules?employeeId=${TEST_IDS.EMPLOYEE_UUID}`
    );
    const response = await getWorkSchedules(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(500);
    expect(body.success).toBe(false);
  });
});

describe("POST /api/work-schedules", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return 200 when saving work schedules", async () => {
    const employee = makeEmployee();
    const inserted = [
      makeWorkSchedule({ dayOfWeek: 1, startTime: "09:00", endTime: "17:00" }),
      makeWorkSchedule({ dayOfWeek: 2, startTime: "09:00", endTime: "17:00" }),
    ];

    // Employee lookup
    mockDbSelect.mockReturnValue(chainMock([employee]));
    // Delete existing schedules
    mockDbDelete.mockReturnValue(chainMock([]));
    // Insert new schedules
    mockDbInsert.mockReturnValue(chainMock(inserted));

    const request = createMockRequest("http://localhost:3000/api/work-schedules", {
      method: "POST",
      body: {
        employeeId: TEST_IDS.EMPLOYEE_UUID,
        schedules: [
          { dayOfWeek: 1, startTime: "09:00", endTime: "17:00" },
          { dayOfWeek: 2, startTime: "09:00", endTime: "17:00" },
          { dayOfWeek: 0, startTime: "09:00", endTime: "17:00", isDayOff: true },
        ],
      },
    });

    const response = await saveWorkSchedules(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(2);
    expect(body.count).toBe(2);
  });

  it("should return 400 when employeeId is missing", async () => {
    const request = createMockRequest("http://localhost:3000/api/work-schedules", {
      method: "POST",
      body: {
        schedules: [{ dayOfWeek: 1, startTime: "09:00", endTime: "17:00" }],
      },
    });

    const response = await saveWorkSchedules(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toBe("Validation failed");
    expect((body as Record<string, unknown>).details).toBeDefined();
  });

  it("should return 400 when schedules array is missing", async () => {
    const request = createMockRequest("http://localhost:3000/api/work-schedules", {
      method: "POST",
      body: {
        employeeId: TEST_IDS.EMPLOYEE_UUID,
      },
    });

    const response = await saveWorkSchedules(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toBe("Validation failed");
    expect((body as Record<string, unknown>).details).toBeDefined();
  });

  it("should return 404 when employee not found", async () => {
    mockDbSelect.mockReturnValue(chainMock([]));

    const request = createMockRequest("http://localhost:3000/api/work-schedules", {
      method: "POST",
      body: {
        employeeId: TEST_IDS.EMPLOYEE_UUID,
        schedules: [{ dayOfWeek: 1, startTime: "09:00", endTime: "17:00" }],
      },
    });

    const response = await saveWorkSchedules(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(404);
    expect(body.success).toBe(false);
    expect(body.error).toContain("Employee not found");
  });

  it("should handle all days marked as day off (empty insert)", async () => {
    const employee = makeEmployee();

    mockDbSelect.mockReturnValue(chainMock([employee]));
    mockDbDelete.mockReturnValue(chainMock([]));
    // No insert needed when all days are off

    const request = createMockRequest("http://localhost:3000/api/work-schedules", {
      method: "POST",
      body: {
        employeeId: TEST_IDS.EMPLOYEE_UUID,
        schedules: [
          { dayOfWeek: 0, isDayOff: true },
          { dayOfWeek: 1, isDayOff: true },
        ],
      },
    });

    const response = await saveWorkSchedules(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(0);
    expect(body.count).toBe(0);
  });
});
