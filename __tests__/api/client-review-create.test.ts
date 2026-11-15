/**
 * Kontrakt POST /api/client/appointments/[id]/review — body z UI
 * (src/app/(client)/appointments/[id]/_hooks/use-appointment-detail.ts):
 *   { rating: 1..5, comment: string | null }   // comment: trim() || null
 *
 * Przed poprawką schemat miał `comment: z.string().optional()`, więc ocena
 * bez komentarza (UI wysyła null) kończyła się 400 (Quinn, req-5a).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockRequest, parseResponse } from "./helpers";

const mockSelect = vi.fn();
const mockInsertValues = vi.fn();
let selectQueue: unknown[][] = [];

function chain(result: () => unknown[]) {
  const c: Record<string, unknown> = {};
  for (const m of ["select", "from", "where", "limit", "returning"]) c[m] = vi.fn(() => c);
  c.values = vi.fn((v: unknown) => {
    mockInsertValues(v);
    return c;
  });
  c.then = (resolve: (v: unknown[]) => unknown) => resolve(result());
  return c;
}

vi.mock("@/lib/db", () => ({
  db: {
    select: (...args: unknown[]) => {
      mockSelect(...args);
      return chain(() => selectQueue.shift() ?? []);
    },
    insert: () => chain(() => [{ id: "review-1" }]),
  },
}));

vi.mock("@/lib/auth-middleware", () => ({
  requireAuth: vi.fn().mockResolvedValue({
    session: { user: { id: "client-user" } },
    user: { id: "client-user" },
  }),
  isAuthError: vi.fn().mockReturnValue(false),
}));

vi.mock("@/lib/schema", () => {
  const table = (name: string) => new Proxy({}, { get: (_t, col) => `${name}.${String(col)}` });
  return { appointments: table("appointments"), reviews: table("reviews") };
});

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: unknown[]) => ({ type: "eq", args })),
  and: vi.fn((...args: unknown[]) => ({ type: "and", args })),
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { POST } from "@/app/api/client/appointments/[id]/review/route";

const APPOINTMENT_ID = crypto.randomUUID();
const completedAppointment = {
  id: APPOINTMENT_ID,
  salonId: crypto.randomUUID(),
  employeeId: crypto.randomUUID(),
  clientId: crypto.randomUUID(),
  status: "completed",
};

async function post(body: unknown) {
  const req = createMockRequest(`http://localhost:3000/api/client/appointments/${APPOINTMENT_ID}/review`, {
    method: "POST",
    body,
  });
  return parseResponse(await POST(req, { params: Promise.resolve({ id: APPOINTMENT_ID }) }));
}

beforeEach(() => {
  vi.clearAllMocks();
  // 1) wizyta klienta (zakończona), 2) brak istniejącej opinii
  selectQueue = [[completedAppointment], []];
});

describe("POST /api/client/appointments/[id]/review — kontrakt z UI", () => {
  it("200 dla oceny bez komentarza (UI wysyła comment: null)", async () => {
    const { status, body } = await post({ rating: 5, comment: null });
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(mockInsertValues).toHaveBeenCalledWith(expect.objectContaining({ rating: 5, comment: null }));
  });

  it("200 dla oceny z komentarzem", async () => {
    const { status } = await post({ rating: 4, comment: "Super fryzura" });
    expect(status).toBe(200);
    expect(mockInsertValues).toHaveBeenCalledWith(expect.objectContaining({ rating: 4, comment: "Super fryzura" }));
  });

  it.each([
    ["ocena 0", { rating: 0, comment: null }],
    ["ocena 6", { rating: 6, comment: null }],
    ["ocena ułamkowa", { rating: 4.5, comment: null }],
    ["komentarz za długi", { rating: 5, comment: "x".repeat(2001) }],
    ["komentarz liczbą", { rating: 5, comment: 42 }],
  ])("400 — %s, bez zapisu", async (_label, body) => {
    const { status } = await post(body);
    expect(status).toBe(400);
    expect(mockInsertValues).not.toHaveBeenCalled();
  });

  it("404 dla cudzej lub nieistniejącej wizyty", async () => {
    selectQueue = [[]];
    const { status } = await post({ rating: 5, comment: null });
    expect(status).toBe(404);
    expect(mockInsertValues).not.toHaveBeenCalled();
  });
});
