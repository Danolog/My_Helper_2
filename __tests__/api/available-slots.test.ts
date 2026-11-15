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

describe("GET /api/available-slots — time block privacy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-06T08:00:00"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not leak private time block reason in public response", async () => {
    mockDbSelect
      .mockReturnValueOnce(
        chainMock([{ employeeId: EMPLOYEE_ID, dayOfWeek: 2, startTime: "09:00", endTime: "17:00" }]),
      )
      .mockReturnValueOnce(chainMock([]))
      .mockReturnValueOnce(
        chainMock([
          {
            employeeId: EMPLOYEE_ID,
            startTime: new Date("2026-07-07T13:00:00"),
            endTime: new Date("2026-07-07T14:00:00"),
            blockType: "personal",
            reason: "Wizyta u lekarza - onkolog",
          },
        ]),
      );

    const res = await GET(requestFor("2026-07-07"));
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.data.blockedRanges).toEqual([
      { start: "13:00", end: "14:00", type: "personal", label: "personal" },
    ]);
    expect(JSON.stringify(body)).not.toContain("lekarza");
  });
});

describe("GET /api/available-slots — kolizja półotwarta (#165)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-06T08:00:00"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Wtorek 2026-07-07, czas lokalny (trasa liczy minuty od północy lokalnie).
  async function slotsWith(appointmentsRows: unknown[], blocks: unknown[] = []) {
    mockDbSelect
      .mockReturnValueOnce(
        chainMock([{ employeeId: EMPLOYEE_ID, dayOfWeek: 2, startTime: "09:00", endTime: "17:00" }]),
      )
      .mockReturnValueOnce(chainMock(appointmentsRows))
      .mockReturnValueOnce(chainMock(blocks));
    const body = await (await GET(requestFor("2026-07-07"))).json();
    return body.data.slots.map((s: { time: string }) => s.time) as string[];
  }
  const appt = (start: string, end: string) => ({
    employeeId: EMPLOYEE_ID,
    status: "scheduled",
    startTime: new Date(`2026-07-07T${start}:00`),
    endTime: new Date(`2026-07-07T${end}:00`),
  });

  it("slot na styku po wizycie (11:00 po 10–11) i przed nią (09:00) jest wolny", async () => {
    const times = await slotsWith([appt("10:00", "11:00")]);
    expect(times).toContain("11:00");
    expect(times).toContain("09:00");
  });

  it("slot nachodzący na wizytę (09:15, 10:45) jest zajęty", async () => {
    const times = await slotsWith([appt("10:00", "11:00")]);
    expect(times).not.toContain("09:15");
    expect(times).not.toContain("10:00");
    expect(times).not.toContain("10:45");
  });

  it("blokada czasu na styku (12–13) zwalnia 11:00 i 13:00", async () => {
    const times = await slotsWith([], [{
      employeeId: EMPLOYEE_ID,
      startTime: new Date("2026-07-07T12:00:00"),
      endTime: new Date("2026-07-07T13:00:00"),
      blockType: "break",
      reason: null,
    }]);
    expect(times).toContain("11:00");
    expect(times).toContain("13:00");
    expect(times).not.toContain("11:15");
    expect(times).not.toContain("12:45");
  });
});
