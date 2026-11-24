/**
 * Kontrakt POST /api/time-blocks — body dokładnie takie, jakie buduje UI
 * (src/components/calendar/block-time-dialog.tsx i
 *  src/app/dashboard/employees/[id]/schedule/_hooks/use-schedule-data.ts):
 *   { employeeId, startTime: ISO, endTime: ISO, blockType, reason|null }
 *
 * Przed poprawką schemat wymagał salonId, którego UI nie wysyła (trasa bierze
 * salon z sesji), więc przerwa i urlop kończyły się 400 (potwierdzone testem
 * żądaniami HTTP: req-3a / req-3b).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockRequest, parseResponse } from "./helpers";

const mockTxSelect = vi.fn();
const mockTxInsert = vi.fn();
const mockInsertValues = vi.fn();

const mockTx = {
  select: (...args: unknown[]) => mockTxSelect(...args),
  insert: (...args: unknown[]) => mockTxInsert(...args),
  execute: vi.fn().mockResolvedValue(undefined),
};

vi.mock("@/lib/db", () => ({
  db: {
    select: (...args: unknown[]) => mockTxSelect(...args),
    insert: (...args: unknown[]) => mockTxInsert(...args),
    transaction: (fn: (tx: typeof mockTx) => unknown) => fn(mockTx),
  },
}));

vi.mock("@/lib/auth-middleware", () => ({
  requireAuth: vi.fn().mockResolvedValue({
    session: { user: { id: "user-a" } },
    user: { id: "user-a" },
  }),
  isAuthError: vi.fn().mockReturnValue(false),
  requireCronSecret: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  apiRateLimit: { check: () => ({ success: true, reset: 0 }) },
  getClientIp: () => "127.0.0.1",
}));

const mockGetSalonContext = vi.fn();
vi.mock("@/lib/salon-context", () => ({
  getSalonContext: (...args: unknown[]) => mockGetSalonContext(...args),
}));

vi.mock("@/lib/schema", () => {
  const createTable = (name: string) =>
    new Proxy({}, { get: (_t, prop) => (prop === "_table" ? name : `${name}.${String(prop)}`) });
  return { timeBlocks: createTable("timeBlocks"), employees: createTable("employees") };
});

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: unknown[]) => ({ type: "eq", args })),
  and: vi.fn((...args: unknown[]) => ({ type: "and", args })),
  gte: vi.fn(),
  lte: vi.fn(),
  sql: Object.assign(
    vi.fn((...args: unknown[]) => ({ type: "sql", args })),
    { raw: vi.fn((query: string) => ({ type: "sql.raw", query })) }
  ),
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

function chainMock(result: unknown[] = []) {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "from", "where", "limit", "returning"]) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.values = (...args: unknown[]) => {
    mockInsertValues(...args);
    return chain;
  };
  chain.then = (resolve: (val: unknown[]) => unknown) => resolve(result);
  return chain;
}

import { POST } from "@/app/api/time-blocks/route";

const SALON_A = crypto.randomUUID();
const EMPLOYEE_A = crypto.randomUUID();

/** Body 1:1 z block-time-dialog.tsx (przerwa w kalendarzu). */
function uiBreakBody(overrides: Record<string, unknown> = {}) {
  return {
    employeeId: EMPLOYEE_A,
    startTime: "2026-12-01T12:00:00.000Z",
    endTime: "2026-12-01T13:00:00.000Z",
    blockType: "break",
    reason: null,
    ...overrides,
  };
}

async function post(body: unknown) {
  const req = createMockRequest("http://localhost:3000/api/time-blocks", { method: "POST", body });
  return parseResponse(await POST(req));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSalonContext.mockResolvedValue({ salonId: SALON_A, role: "owner", employeeId: null, userId: "user-a" });
  mockTxSelect.mockImplementation(() => chainMock([{ id: EMPLOYEE_A, salonId: SALON_A }]));
  mockTxInsert.mockImplementation(() => chainMock([{ id: crypto.randomUUID() }]));
});

describe("POST /api/time-blocks — kontrakt z UI", () => {
  it("201 dla przerwy z kalendarza (body bez salonId)", async () => {
    const { status, body } = await post(uiBreakBody());
    expect(status).toBe(201);
    expect(body.success).toBe(true);
    expect(mockInsertValues.mock.calls[0]?.[0]).toMatchObject({
      employeeId: EMPLOYEE_A,
      blockType: "break",
      reason: null,
    });
  });

  it("201 dla urlopu z grafiku pracownika", async () => {
    const { status } = await post(
      uiBreakBody({
        startTime: "2026-12-07T23:00:00.000Z",
        endTime: "2026-12-08T22:59:59.000Z",
        blockType: "vacation",
        reason: "Urlop",
      })
    );
    expect(status).toBe(201);
  });

  it("201 dla id pracownika z seeda (UUID v4 po #33)", async () => {
    const { status } = await post(uiBreakBody({ employeeId: "00000000-0000-4000-8000-000000000201" }));
    expect(status).toBe(201);
  });

  it("salonId w body (starszy klient) nie zmienia salonu — zapis w salonie z sesji", async () => {
    const { status } = await post(uiBreakBody({ salonId: crypto.randomUUID() }));
    expect(status).toBe(201);
  });

  it.each([
    ["nieznany blockType", { blockType: "party" }],
    ["brak blockType", { blockType: undefined }],
    ["niepoprawna data", { startTime: "jutro" }],
    ["id pracownika to nie UUID", { employeeId: "abc" }],
    ["id pracownika w starym formacie seeda (wersja 0)", { employeeId: "00000000-0000-0000-0000-e00000000001" }],
    ["id pracownika z niepoprawnym wariantem", { employeeId: "11111111-1111-4111-1111-111111111111" }],
    ["brak pracownika", { employeeId: undefined }],
  ])("400 — %s, bez zapisu", async (_label, overrides) => {
    const { status } = await post(uiBreakBody(overrides));
    expect(status).toBe(400);
    expect(mockTxInsert).not.toHaveBeenCalled();
  });

  it("400, gdy koniec przed początkiem", async () => {
    const { status } = await post(
      uiBreakBody({ startTime: "2026-12-01T13:00:00.000Z", endTime: "2026-12-01T12:00:00.000Z" })
    );
    expect(status).toBe(400);
    expect(mockTxInsert).not.toHaveBeenCalled();
  });

  it("404, gdy pracownik nie należy do salonu z sesji", async () => {
    mockTxSelect.mockImplementation(() => chainMock([]));
    const { status } = await post(uiBreakBody());
    expect(status).toBe(404);
    expect(mockTxInsert).not.toHaveBeenCalled();
  });

  it("403, gdy pracownik blokuje czas innemu pracownikowi", async () => {
    mockGetSalonContext.mockResolvedValue({
      salonId: SALON_A,
      role: "employee",
      employeeId: crypto.randomUUID(),
      userId: "user-a",
    });
    const { status } = await post(uiBreakBody());
    expect(status).toBe(403);
    expect(mockTxInsert).not.toHaveBeenCalled();
  });
});

// Uwaga z recenzji F2 (#32): bez refine'a w isoDateTime `new Date("x")` daje Invalid
// Date, `start >= end` jest wtedy fałszywe i insert leci do Postgresa (500).
// Każde z pól osobno i oba naraz muszą dać 400 jeszcze przed bazą.
describe("POST /api/time-blocks — nieparsowalna data -> 400 (F2)", () => {
  it.each([
    ["startTime", { startTime: "nie-data" }],
    ["endTime", { endTime: "nie-data" }],
    ["oba pola", { startTime: "x", endTime: "y" }],
    ["miesiąc 13", { endTime: "2026-13-01T12:00:00.000Z" }],
    ["pusty napis", { endTime: "" }],
  ])("400 — %s, bez zapytania do bazy i zapisu", async (_label, overrides) => {
    const { status, body } = await post(uiBreakBody(overrides));
    expect(status).toBe(400);
    expect(body.success).toBe(false);
    expect(mockTxSelect).not.toHaveBeenCalled();
    expect(mockTxInsert).not.toHaveBeenCalled();
  });
});
