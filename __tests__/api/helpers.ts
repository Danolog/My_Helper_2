/**
 * Shared test helpers for API route integration tests.
 *
 * Provides utilities for creating mock NextRequest objects, mock database
 * chain builders, and test data factories for common entities.
 */

/**
 * Create a mock Request object compatible with Next.js route handlers.
 * Next.js 16 route handlers receive a standard Request (not NextRequest).
 */
export function createMockRequest(
  url: string,
  options: {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
  } = {}
): Request {
  const { method = "GET", body, headers = {} } = options;

  const init: RequestInit = {
    method,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
  };

  if (body !== undefined && method !== "GET") {
    init.body = JSON.stringify(body);
  }

  return new Request(url, init);
}

/**
 * Create route params matching Next.js 16 pattern: { params: Promise<{ id: string }> }
 */
export function createRouteParams(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

/**
 * Parse the JSON body from a NextResponse/Response object.
 */
export async function parseResponse<T = Record<string, unknown>>(
  response: Response
): Promise<{ status: number; body: T }> {
  const body = (await response.json()) as T;
  return { status: response.status, body };
}

// ===================================================
// Test data factories
// ===================================================

const VALID_UUID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const SALON_UUID = "11111111-1111-1111-1111-111111111111";
const EMPLOYEE_UUID = "22222222-2222-2222-2222-222222222222";
const CLIENT_UUID = "33333333-3333-3333-3333-333333333333";
const SERVICE_UUID = "44444444-4444-4444-4444-444444444444";
const PRODUCT_UUID = "55555555-5555-5555-5555-555555555555";
const APPOINTMENT_UUID = "66666666-6666-6666-6666-666666666666";

export const TEST_IDS = {
  VALID_UUID,
  SALON_UUID,
  EMPLOYEE_UUID,
  CLIENT_UUID,
  SERVICE_UUID,
  PRODUCT_UUID,
  APPOINTMENT_UUID,
} as const;

export function makeAppointment(overrides: Record<string, unknown> = {}) {
  return {
    id: APPOINTMENT_UUID,
    salonId: SALON_UUID,
    clientId: CLIENT_UUID,
    employeeId: EMPLOYEE_UUID,
    serviceId: SERVICE_UUID,
    startTime: new Date("2026-04-01T10:00:00Z"),
    endTime: new Date("2026-04-01T11:00:00Z"),
    status: "scheduled",
    notes: null,
    depositAmount: null,
    depositPaid: false,
    bookedByUserId: null,
    promoCodeId: null,
    discountAmount: null,
    guestName: null,
    guestPhone: null,
    guestEmail: null,
    createdAt: new Date("2026-03-01T00:00:00Z"),
    ...overrides,
  };
}

export function makeClient(overrides: Record<string, unknown> = {}) {
  return {
    id: CLIENT_UUID,
    salonId: SALON_UUID,
    firstName: "Jan",
    lastName: "Kowalski",
    phone: "+48123456789",
    email: "jan@example.com",
    notes: null,
    preferences: null,
    allergies: null,
    favoriteEmployeeId: null,
    requireDeposit: false,
    depositType: "percentage",
    depositValue: null,
    birthday: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

export function makeEmployee(overrides: Record<string, unknown> = {}) {
  return {
    id: EMPLOYEE_UUID,
    salonId: SALON_UUID,
    userId: null,
    firstName: "Anna",
    lastName: "Nowak",
    phone: "+48987654321",
    email: "anna@salon.com",
    photoUrl: null,
    role: "employee",
    color: "#3b82f6",
    isActive: true,
    commissionRate: "50.00",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

export function makeService(overrides: Record<string, unknown> = {}) {
  return {
    id: SERVICE_UUID,
    salonId: SALON_UUID,
    categoryId: null,
    name: "Strzyzenie",
    description: null,
    basePrice: "100.00",
    baseDuration: 60,
    isActive: true,
    depositRequired: false,
    depositPercentage: null,
    suggestedNextVisitDays: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

export function makeProduct(overrides: Record<string, unknown> = {}) {
  return {
    id: PRODUCT_UUID,
    salonId: SALON_UUID,
    name: "Szampon",
    category: null,
    quantity: "10",
    minQuantity: "2",
    unit: "szt.",
    pricePerUnit: "25.00",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

export function makeWorkSchedule(overrides: Record<string, unknown> = {}) {
  return {
    id: VALID_UUID,
    employeeId: EMPLOYEE_UUID,
    dayOfWeek: 1,
    startTime: "09:00",
    endTime: "17:00",
    ...overrides,
  };
}

// ===================================================
// Chainable mock builder for Drizzle ORM queries.
//
// Drizzle uses a builder pattern: db.select().from().where().limit()
// Each method returns `this` so calls can be chained.
// The terminal call is the final execution (select, insert, update, delete
// all return a promise-like object that resolves to the result rows).
// ===================================================

type MockDbResult = Record<string, unknown>[];

/**
 * Create a chainable mock that simulates Drizzle's query builder.
 * The mock resolves to `result` when awaited (via .then or at chain end).
 */
export function createChainMock(result: MockDbResult = []) {
  const chain: Record<string, unknown> = {};

  const methods = [
    "select",
    "from",
    "where",
    "leftJoin",
    "innerJoin",
    "limit",
    "orderBy",
    "groupBy",
    "as",
    "insert",
    "values",
    "update",
    "set",
    "delete",
    "returning",
    "execute",
  ];

  for (const method of methods) {
    chain[method] = vi.fn().mockReturnValue(chain);
  }

  // Make the chain thenable so `await db.select()...` resolves to result
  chain.then = (resolve: (val: MockDbResult) => unknown) => resolve(result);

  return chain;
}

// Re-export vi for convenience in helpers
import { vi } from "vitest";
