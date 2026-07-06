/**
 * Tests for GET /api/available-slots — filtering of past time slots
 * (UAT B-5: wizard oferowal i przyjmowal sloty z przeszlosci).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockDbSelect = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    select: (...args: unknown[]) => mockDbSelect(...args),
  },
}));

vi.mock("@/lib/rate-limit", () => ({
  apiRateLimit: {
    check: vi.fn().mockReturnValue({ success: true, remaining: 59, reset: 60000 }),
    checkAsync: vi.fn().mockResolvedValue({ success: true, remaining: 59, reset: 60000 }),
  },
  getClientIp: vi.fn().mockReturnValue("127.0.0.1"),
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { GET } from "@/app/api/available-slots/route";

function chainMock(result: unknown[] = []) {
  const chain: Record<string, unknown> = {};
  for (const method of ["from", "where", "limit", "orderBy"]) {
    chain[method] = vi.fn().mockReturnValue(chain);
  }
  chain.then = (resolve: (val: unknown[]) => unknown) => resolve(result);
  return chain;
}

const EMPLOYEE_ID = "11111111-1111-4111-8111-111111111111";

function mockDay(scheduleStart = "09:00", scheduleEnd = "17:00") {
  // Route wykonuje 3 selecty w kolejnosci: workSchedules, appointments, timeBlocks
  mockDbSelect
    .mockReturnValueOnce(
      chainMock([
        { employeeId: EMPLOYEE_ID, dayOfWeek: 1, startTime: scheduleStart, endTime: scheduleEnd },
      ]),
    )
    .mockReturnValueOnce(chainMock([]))
    .mockReturnValueOnce(chainMock([]));
}

function requestFor(date: string) {
  return new Request(
    `http://localhost:3000/api/available-slots?employeeId=${EMPLOYEE_ID}&date=${date}&duration=60`,
  );
}

describe("GET /api/available-slots — past slots", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    // Poniedzialek 2026-07-06, 12:00 czasu lokalnego
    vi.setSystemTime(new Date("2026-07-06T12:00:00"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not offer slots earlier than the current time for today", async () => {
    mockDay();
    const res = await GET(requestFor("2026-07-06"));
    const body = await res.json();

    expect(body.success).toBe(true);
    const times = body.data.slots.map((s: { time: string }) => s.time);
    expect(times.length).toBeGreaterThan(0);
    expect(times).not.toContain("09:00");
    expect(times).not.toContain("11:45");
    expect(times).not.toContain("12:00"); // slot startujacy "teraz" tez nie
    expect(times[0] >= "12:15").toBe(true);
  });

  it("keeps morning slots for a future date", async () => {
    mockDay();
    const res = await GET(requestFor("2026-07-07"));
    const body = await res.json();

    const times = body.data.slots.map((s: { time: string }) => s.time);
    expect(times).toContain("09:00");
  });

  it("returns no slots for a past date", async () => {
    mockDay();
    const res = await GET(requestFor("2026-07-05"));
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.data.slots).toEqual([]);
  });
});
