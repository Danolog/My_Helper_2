/**
 * Tests for GET /api/available-slots: walidacja salonId, przynależność
 * pracownika do salonu (forSalon), odcięcie przeszłych slotów (UAT B-5),
 * prywatność blokad i kolizja półotwarta (#165).
 *
 * Atrapa bazy to tabele-fikstury: każde zapytanie `tx.select(cols)` filtruje
 * wiersze ZBUDOWANYM przez trasę warunkiem WHERE (predicate-tree) i zwraca
 * tylko wybrane kolumny. Test sprawdza więc znaczenie warunków (np. jawne
 * eq(salonId) przy pracowniku), a nie tylko to, że atrapa „coś” zwróciła.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

type Row = Record<string, unknown>;

const tables: Record<string, Row[]> = {};
const selectCalls: { table: string; cols: Record<string, string>; where: unknown }[] = [];

function resetTables() {
  tables.employees = [];
  tables.workSchedules = [];
  tables.appointments = [];
  tables.timeBlocks = [];
  selectCalls.length = 0;
}

function project(row: Row, cols: Record<string, string>): Row {
  return Object.fromEntries(
    Object.entries(cols).map(([key, column]) => [key, row[column.split(".")[1]!]]),
  );
}

function select(cols: Record<string, string>) {
  const call = { table: "", cols, where: undefined as unknown };
  selectCalls.push(call);
  const chain = {
    from(table: { _table: string }) {
      call.table = table._table;
      return chain;
    },
    where(predicate: unknown) {
      call.where = predicate;
      return chain;
    },
    limit() {
      return chain;
    },
    then(resolve: (rows: Row[]) => unknown, reject: (e: unknown) => unknown) {
      try {
        const rows = (tables[call.table] ?? [])
          .filter((r) => matchesPredicate(call.where, r))
          .map((r) => project(r, cols));
        return Promise.resolve(rows).then(resolve, reject);
      } catch (e) {
        return Promise.reject(e).then(resolve, reject);
      }
    },
  };
  return chain;
}

const mockExecute = vi.fn().mockResolvedValue(undefined);
const mockTx = {
  select: (cols: Record<string, string>) => select(cols),
  execute: (...args: unknown[]) => mockExecute(...args),
};

vi.mock("@/lib/db", () => ({
  db: {
    transaction: (fn: (tx: typeof mockTx) => unknown) => fn(mockTx),
  },
}));

// Prawdziwa warstwa repo (na atrapie db wyżej) z podglądem wywołań forSalon.
vi.mock("@/lib/server/repository", async (orig) => {
  const actual = await orig<typeof import("@/lib/server/repository")>();
  return { ...actual, forSalon: vi.fn(actual.forSalon) };
});

vi.mock("@/lib/schema", () => {
  const createTable = (name: string) => ({
    _table: name,
    id: `${name}.id`,
    salonId: `${name}.salonId`,
    employeeId: `${name}.employeeId`,
    dayOfWeek: `${name}.dayOfWeek`,
    startTime: `${name}.startTime`,
    endTime: `${name}.endTime`,
    status: `${name}.status`,
    blockType: `${name}.blockType`,
    reason: `${name}.reason`,
  });
  return {
    appointments: createTable("appointments"),
    employees: createTable("employees"),
    workSchedules: createTable("workSchedules"),
    timeBlocks: createTable("timeBlocks"),
  };
});

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: unknown[]) => ({ type: "eq", args })),
  and: vi.fn((...args: unknown[]) => ({ type: "and", args })),
  not: vi.fn((...args: unknown[]) => ({ type: "not", args })),
  gte: vi.fn((...args: unknown[]) => ({ type: "gte", args })),
  lt: vi.fn((...args: unknown[]) => ({ type: "lt", args })),
  // sql`...` (set_config) + sql.raw (SET LOCAL ROLE) — oba używa forSalon.
  sql: Object.assign(
    vi.fn((...args: unknown[]) => ({ type: "sql", args })),
    { raw: vi.fn((query: string) => ({ type: "sql.raw", query })) },
  ),
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
import { apiRateLimit } from "@/lib/rate-limit";
import { forSalon } from "@/lib/server/repository";
import { matchesPredicate } from "./predicate-tree";

const SALON_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SALON_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const EMPLOYEE_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_EMPLOYEE_ID = "22222222-2222-4222-8222-222222222222";
const MISSING_EMPLOYEE_ID = "33333333-3333-4333-8333-333333333333";

/** Pracownik w salonie A z grafikiem na każdy dzień tygodnia. */
function mockDay(scheduleStart = "09:00", scheduleEnd = "17:00") {
  tables.employees!.push({ id: EMPLOYEE_ID, salonId: SALON_A });
  for (let day = 0; day < 7; day++) {
    tables.workSchedules!.push({
      employeeId: EMPLOYEE_ID,
      dayOfWeek: day,
      startTime: scheduleStart,
      endTime: scheduleEnd,
    });
  }
}

function slotsUrl(params: Record<string, string>) {
  const query = new URLSearchParams(params).toString();
  return new Request(`http://localhost:3000/api/available-slots?${query}`);
}

function requestFor(date: string, overrides: Record<string, string> = {}) {
  return slotsUrl({ salonId: SALON_A, employeeId: EMPLOYEE_ID, date, duration: "60", ...overrides });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetTables();
});

describe("GET /api/available-slots — past slots", () => {
  beforeEach(() => {
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
    expect(body.data.dayOff).toBe(false); // grafik jest — puste sloty to odcięcie przeszłości
    expect(body.data.allSlots.length).toBeGreaterThan(0);
    expect(body.data.slots).toEqual([]);
  });
});

describe("GET /api/available-slots — time block privacy", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-06T08:00:00"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not leak private time block reason in public response", async () => {
    mockDay();
    tables.timeBlocks!.push({
      employeeId: EMPLOYEE_ID,
      startTime: new Date("2026-07-07T13:00:00"),
      endTime: new Date("2026-07-07T14:00:00"),
      blockType: "personal",
      reason: "Wizyta u lekarza - onkolog",
    });

    const res = await GET(requestFor("2026-07-07"));
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.data.blockedRanges).toEqual([
      { start: "13:00", end: "14:00", type: "personal", label: "personal" },
    ]);
    expect(JSON.stringify(body)).not.toContain("lekarza");
    // Powód blokady nie jest nawet czytany z bazy (jawna lista kolumn).
    const blocksCall = selectCalls.find((c) => c.table === "timeBlocks");
    expect(Object.values(blocksCall!.cols)).not.toContain("timeBlocks.reason");
  });
});

describe("GET /api/available-slots — kolizja półotwarta (#165)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-06T08:00:00"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Wtorek 2026-07-07, czas lokalny (trasa liczy minuty od północy lokalnie).
  async function slotsWith(appointmentsRows: Row[], blocks: Row[] = []) {
    mockDay();
    tables.appointments!.push(...appointmentsRows);
    tables.timeBlocks!.push(...blocks);
    const body = await (await GET(requestFor("2026-07-07"))).json();
    return body.data.slots.map((s: { time: string }) => s.time) as string[];
  }
  const appt = (start: string, end: string, salonId = SALON_A, status = "scheduled") => ({
    salonId,
    employeeId: EMPLOYEE_ID,
    status,
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

  it("wizyta anulowana i wizyta z innego salonu nie blokują slotu", async () => {
    const times = await slotsWith([
      appt("10:00", "11:00", SALON_A, "cancelled"),
      appt("10:00", "11:00", SALON_B),
    ]);
    expect(times).toContain("10:00");
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

describe("GET /api/available-slots — salonId i przynależność pracownika", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-06T08:00:00"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("400 bez salonId, forSalon nie jest wołany", async () => {
    mockDay();
    const res = await GET(
      slotsUrl({ employeeId: EMPLOYEE_ID, date: "2026-07-07", duration: "60" }),
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body).toEqual({ success: false, error: "salonId must be a valid UUID" });
    expect(forSalon).not.toHaveBeenCalled();
    expect(selectCalls).toHaveLength(0);
  });

  it.each(["not-a-uuid", "", "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", `${SALON_A}x`])(
    "400 dla złego salonId %j, forSalon nie jest wołany",
    async (salonId) => {
      mockDay();
      const res = await GET(requestFor("2026-07-07", { salonId }));

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ success: false, error: "salonId must be a valid UUID" });
      expect(forSalon).not.toHaveBeenCalled();
    },
  );

  it("400 dla złego formatu employeeId, bez zapytań do bazy", async () => {
    mockDay();
    const res = await GET(requestFor("2026-07-07", { employeeId: "emp-1" }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ success: false, error: "employeeId must be a valid UUID" });
    expect(forSalon).not.toHaveBeenCalled();
  });

  it("dotychczasowe 400 dla parametrów zostają (przed walidacją salonId)", async () => {
    const missing = await GET(slotsUrl({ salonId: "zly", date: "2026-07-07", duration: "60" }));
    expect(missing.status).toBe(400);
    expect((await missing.json()).error).toBe("employeeId, date, and duration are required");

    const badDuration = await GET(requestFor("2026-07-07", { duration: "0", salonId: "zly" }));
    expect(badDuration.status).toBe(400);
    expect((await badDuration.json()).error).toBe("duration must be a positive number (in minutes)");

    const badDate = await GET(requestFor("nie-data", { salonId: "zly" }));
    expect(badDate.status).toBe(400);
    expect((await badDate.json()).error).toBe("Invalid date format. Use YYYY-MM-DD");

    expect(forSalon).not.toHaveBeenCalled();
  });

  it("forSalon dostaje salonId z zapytania, a kontekst RLS ustawia ten sam salon", async () => {
    mockDay();
    const res = await GET(requestFor("2026-07-07"));

    expect(res.status).toBe(200);
    expect(forSalon).toHaveBeenCalledTimes(1);
    expect(forSalon).toHaveBeenCalledWith(SALON_A);
    const setConfig = mockExecute.mock.calls
      .map(([q]) => q as { type: string; args?: unknown[] })
      .find((q) => q.type === "sql");
    expect(setConfig?.args).toContain(SALON_A);
  });

  it("pracownik obcego salonu i nieistniejący dają 404 z identyczną treścią", async () => {
    mockDay();
    tables.employees!.push({ id: OTHER_EMPLOYEE_ID, salonId: SALON_B });
    tables.workSchedules!.push({ employeeId: OTHER_EMPLOYEE_ID, dayOfWeek: 2, startTime: "09:00", endTime: "17:00" });

    const foreign = await GET(requestFor("2026-07-07", { employeeId: OTHER_EMPLOYEE_ID }));
    const missing = await GET(requestFor("2026-07-07", { employeeId: MISSING_EMPLOYEE_ID }));
    const foreignBody = await foreign.json();
    const missingBody = await missing.json();

    expect(foreign.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(foreignBody).toEqual(missingBody);
    expect(foreignBody).toEqual({ success: false, error: "Employee not found" });
  });

  it("pracownik salonu A zapytany z salonId = B daje 404", async () => {
    mockDay();
    const res = await GET(requestFor("2026-07-07", { salonId: SALON_B }));

    expect(res.status).toBe(404);
    expect(forSalon).toHaveBeenCalledWith(SALON_B);
  });

  it("404 nie wykonuje zapytań o grafik, wizyty i blokady", async () => {
    mockDay();
    tables.employees!.push({ id: OTHER_EMPLOYEE_ID, salonId: SALON_B });

    const res = await GET(requestFor("2026-07-07", { employeeId: OTHER_EMPLOYEE_ID }));

    expect(res.status).toBe(404);
    expect(selectCalls.map((c) => c.table)).toEqual(["employees"]);
  });

  it("wszystkie zapytania mają jawne listy kolumn (tylko te, których trasa używa)", async () => {
    mockDay();
    await GET(requestFor("2026-07-07"));

    const byTable = Object.fromEntries(selectCalls.map((c) => [c.table, Object.values(c.cols).sort()]));
    expect(byTable).toEqual({
      employees: ["employees.id"],
      workSchedules: ["workSchedules.endTime", "workSchedules.startTime"],
      appointments: ["appointments.endTime", "appointments.startTime"],
      timeBlocks: ["timeBlocks.blockType", "timeBlocks.endTime", "timeBlocks.startTime"],
    });
  });

  it("200 ma ten sam kształt co dotąd", async () => {
    mockDay();
    const res = await GET(requestFor("2026-07-07"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(Object.keys(body.data)).toEqual([
      "date", "employeeId", "duration", "dayOff", "workStart", "workEnd", "slots", "allSlots", "blockedRanges",
    ]);
    expect(body.data).toMatchObject({
      date: "2026-07-07",
      employeeId: EMPLOYEE_ID,
      duration: 60,
      dayOff: false,
      workStart: "09:00",
      workEnd: "17:00",
      blockedRanges: [],
    });
    expect(body.data.slots[0]).toEqual({ time: "09:00", available: true });
    expect(body.data.allSlots).toHaveLength(29); // 09:00..16:00 co 15 min
  });

  it("dzień wolny: ten sam kształt co dotąd, bez zapytań o wizyty i blokady", async () => {
    tables.employees!.push({ id: EMPLOYEE_ID, salonId: SALON_A });
    const res = await GET(requestFor("2026-07-07"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      success: true,
      data: {
        date: "2026-07-07",
        employeeId: EMPLOYEE_ID,
        duration: 60,
        dayOff: true,
        workStart: null,
        workEnd: null,
        slots: [],
        message: "Pracownik nie pracuje w tym dniu",
      },
    });
    expect(selectCalls.map((c) => c.table)).toEqual(["employees", "workSchedules"]);
  });

  it("500 przy błędzie bazy", async () => {
    mockDay();
    mockExecute.mockRejectedValueOnce(new Error("connection refused"));

    const res = await GET(requestFor("2026-07-07"));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ success: false, error: "Failed to calculate available slots" });
  });

  it("429 bez zmian: przed walidacją i bez forSalon", async () => {
    vi.mocked(apiRateLimit.checkAsync).mockResolvedValueOnce({ success: false, remaining: 0, reset: 30000 });

    const res = await GET(slotsUrl({}));

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("30");
    expect(await res.json()).toEqual({ success: false, error: "Zbyt wiele żądań. Spróbuj ponownie później." });
    expect(forSalon).not.toHaveBeenCalled();
  });
});
