/**
 * POST /api/reminders/appointment (#234, część A): data i godzina w treści
 * SMS przypomnienia zawsze w strefie Europe/Warsaw, niezależnie od strefy
 * procesu.
 *
 * Test SAM wymusza strefę procesu UTC (`TZ=UTC`) i przywraca ją po sobie.
 * Na maszynie w strefie warszawskiej test bez tego wymuszenia przeszedłby
 * na pusto, dlatego każdy przypadek najpierw sprawdza, że proces naprawdę
 * liczy w UTC (`assertProcessInUtc`).
 *
 * `sendSms` jest prawdziwy; zmockowane są baza, logger i fetch dostawcy,
 * a asercja dotyczy treści przekazanej do wysyłki. Treść składa szablon
 * modułu SMS; data w niej tylko ze znakami GSM-7.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// #193 P5a-1: sendSms zapisuje przez forSalon(salonId).raw — brama deleguje
// do zmockowanego `db`, więc asercje zostają bez zmian.
vi.mock("@/lib/server/repository", async () => {
  const { db } = await import("@/lib/db");
  return {
    forSalon: (salonId: string) => ({ salonId, raw: (fn: (tx: unknown) => unknown) => fn(db) }),
  };
});

const { selectRows } = vi.hoisted(() => ({
  selectRows: { current: [] as unknown[] },
}));

/** Łańcuch zapytania: każda metoda zwraca ten sam obiekt, `await` daje wiersze. */
function selectChain() {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "leftJoin", "innerJoin", "where", "limit"]) {
    chain[m] = () => chain;
  }
  chain.then = (resolve: (rows: unknown[]) => unknown) => resolve(selectRows.current);
  return chain;
}

vi.mock("@/lib/db", () => ({
  db: {
    select: () => selectChain(),
    update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
    insert: () => ({
      values: () => ({ returning: () => Promise.resolve([{ id: "notif-1" }]) }),
    }),
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { POST } from "@/app/api/reminders/appointment/route";
import { createMockRequest, parseResponse } from "./helpers";

const SECRET = "test-cron-secret";
const URL_ = "http://localhost/api/reminders/appointment";
const mockFetch = vi.fn();

function row(startTime: Date) {
  return {
    appointmentId: "appt-1",
    startTime,
    endTime: new Date(startTime.getTime() + 3600_000),
    salonId: "00000000-0000-4000-8000-000000000001",
    clientId: "client-1",
    serviceId: "service-1",
    employeeId: "employee-1",
    status: "scheduled",
    clientFirstName: "Jan",
    clientLastName: "Kowalski",
    clientPhone: "+48512345678",
    salonName: "Salon",
    serviceName: "Strzyzenie",
    employeeFirstName: "Anna",
    employeeLastName: "Nowak",
  };
}

/**
 * Chwile w UTC i oczekiwany tekst w Warszawie:
 * - zima (CET, +1): 13:00 UTC → 14:00, wtorek 15 stycznia 2030,
 * - lato (CEST, +2): 12:00 UTC → 14:00, wtorek 16 lipca 2030,
 * - 23:30 UTC 15 stycznia → w Warszawie już środa 16 stycznia, 00:30.
 */
const CASES = [
  {
    label: "zima",
    at: "2030-01-15T13:00:00Z",
    text: "odbedzie sie wtorek, 15 stycznia 2030 o godz. 14:00. Do zobaczenia!",
  },
  {
    label: "lato",
    at: "2030-07-16T12:00:00Z",
    text: "odbedzie sie wtorek, 16 lipca 2030 o godz. 14:00. Do zobaczenia!",
  },
  {
    label: "po północy UTC następny dzień w Warszawie",
    at: "2030-01-15T23:30:00Z",
    // Dzień tygodnia bez polskich znaków (data przez toGsm7Basic w szablonie).
    text: "odbedzie sie sroda, 16 stycznia 2030 o godz. 00:30. Do zobaczenia!",
  },
] as const;

function sentMessage(): string {
  expect(mockFetch).toHaveBeenCalledTimes(1);
  const init = mockFetch.mock.calls[0]![1] as { body: string };
  return new URLSearchParams(init.body).get("message") ?? "";
}

/** Strażnik: proces liczy w UTC, inaczej test sprawdzałby strefę maszyny. */
function assertProcessInUtc() {
  const d = new Date("2030-07-16T12:00:00Z");
  expect(d.getHours(), "proces nie jest w UTC — test przeszedłby na pusto").toBe(12);
  expect(d.getTimezoneOffset()).toBe(0);
}

beforeEach(() => {
  vi.clearAllMocks();
  selectRows.current = [];
  vi.stubEnv("TZ", "UTC");
  vi.stubEnv("CRON_SECRET", SECRET);
  vi.stubEnv("SMSAPI_TOKEN", "test-token");
  vi.stubGlobal("fetch", mockFetch);
  mockFetch.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ count: 1, list: [{ id: "msg-1" }] }),
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("POST /api/reminders/appointment: data i godzina w Europe/Warsaw przy procesie w UTC", () => {
  it.each(CASES.map((c) => [c.label, c] as const))("%s", async (_label, c) => {
    assertProcessInUtc();
    selectRows.current = [row(new Date(c.at))];

    const { status, body } = await parseResponse<{ data: Record<string, unknown> }>(
      await POST(
        createMockRequest(URL_, { method: "POST", headers: { authorization: `Bearer ${SECRET}` } })
      )
    );

    expect(status).toBe(200);
    expect(body.data).toMatchObject({ processed: 1, sent: 1, failed: 0 });
    expect(sentMessage()).toContain(c.text);
  });
});
