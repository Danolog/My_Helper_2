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
/** Wynik INSERT: wiersze albo błąd (np. 23505 z indeksu reviews_appointment_id_uq). */
let insertResult: () => unknown[] = () => [{ id: "review-1" }];

function chain(result: () => unknown[]) {
  const c: Record<string, unknown> = {};
  for (const m of ["select", "from", "where", "limit", "returning"]) c[m] = vi.fn(() => c);
  c.values = vi.fn((v: unknown) => {
    mockInsertValues(v);
    return c;
  });
  c.then = (resolve: (v: unknown[]) => unknown, reject: (e: unknown) => unknown) => {
    try {
      return resolve(result());
    } catch (e) {
      return reject(e);
    }
  };
  return c;
}

vi.mock("@/lib/db", () => ({
  db: {
    select: (...args: unknown[]) => {
      mockSelect(...args);
      return chain(() => selectQueue.shift() ?? []);
    },
    insert: () => chain(() => insertResult()),
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
  insertResult = () => [{ id: "review-1" }];
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

describe("POST /api/client/appointments/[id]/review — jedna opinia na wizytę", () => {
  const ALREADY_EXISTS = { success: false, error: "Opinia dla tej wizyty zostala juz wystawiona" };

  it("409 z szybkiej ścieżki SELECT, bez INSERT", async () => {
    selectQueue = [[completedAppointment], [{ id: "existing-review" }]];
    const { status, body } = await post({ rating: 5, comment: null });
    expect(status).toBe(409);
    expect(body).toEqual(ALREADY_EXISTS);
    expect(mockInsertValues).not.toHaveBeenCalled();
  });

  it("409 z tym samym komunikatem, gdy INSERT trafia w indeks unikalny (23505, wyścig)", async () => {
    insertResult = () => {
      throw Object.assign(new Error("duplicate key value violates unique constraint"), { code: "23505" });
    };
    const { status, body } = await post({ rating: 5, comment: null });
    expect(status).toBe(409);
    expect(body).toEqual(ALREADY_EXISTS);
    expect(mockInsertValues).toHaveBeenCalledTimes(1);
  });

  it("409 także gdy 23505 jest w `cause` (opakowanie błędu przez sterownik/ORM)", async () => {
    insertResult = () => {
      throw new Error("Failed query", { cause: { code: "23505" } });
    };
    const { status, body } = await post({ rating: 5, comment: null });
    expect(status).toBe(409);
    expect(body).toEqual(ALREADY_EXISTS);
  });

  it("500 dla innego błędu INSERT (np. 23503), nie 409", async () => {
    insertResult = () => {
      throw Object.assign(new Error("foreign key violation"), { code: "23503" });
    };
    const { status, body } = await post({ rating: 5, comment: null });
    expect(status).toBe(500);
    expect(body).toEqual({ success: false, error: "Nie udalo sie dodac opinii" });
  });
});
