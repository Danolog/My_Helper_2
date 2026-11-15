/**
 * Przypomnienia SMS a numery testowe i dane osobowe w logach (#75, uwagi Ryana z #74).
 *
 * - POST /api/reminders/appointment: wizyta klienta z numerem testowym jest
 *   oznaczana jako obsłużona (reminderSentAt), choć SMS nie wychodzi.
 *   Wcześniej oznaczane były tylko udane wysyłki, więc każde wywołanie brało
 *   tę wizytę od nowa. Nieudana wysyłka na prawdziwy numer NIE jest oznaczana,
 *   bo ma zostać ponowiona.
 * - POST /api/cron/sms-reminders: imię i nazwisko klienta nie trafiają ani do
 *   logów, ani do odpowiedzi crona.
 *
 * `sendSms` jest PRAWDZIWY (blokada numeru testowego, tryb symulacji, błąd
 * dostawcy). Zmockowane są tylko baza (select/update/insert), fetch dostawcy
 * i logger, żeby można było sprawdzić, co trafia do logów.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { selectRows, updateSet, updateWhere, insertValues, inArrayCalls } = vi.hoisted(() => ({
  selectRows: { current: [] as unknown[] },
  updateSet: vi.fn(),
  updateWhere: vi.fn(),
  insertValues: vi.fn(),
  inArrayCalls: [] as Array<{ values: unknown }>,
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
    update: () => ({
      set: (v: unknown) => {
        updateSet(v);
        return { where: (w: unknown) => { updateWhere(w); return Promise.resolve(); } };
      },
    }),
    insert: () => ({
      values: (v: unknown) => {
        insertValues(v);
        return { returning: () => Promise.resolve([{ id: "notif-1" }]) };
      },
    }),
  },
}));

vi.mock("drizzle-orm", async (importOriginal) => {
  const orig = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...orig,
    inArray: (col: unknown, values: unknown) => {
      inArrayCalls.push({ values });
      return orig.inArray(col as never, values as never);
    },
  };
});

vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { POST as cronPost } from "@/app/api/cron/sms-reminders/route";
import { POST as remindersPost } from "@/app/api/reminders/appointment/route";
import { logger } from "@/lib/logger";
import { TEST_PHONE } from "@/lib/test-phone";
import { createMockRequest, parseResponse } from "./helpers";

const SECRET = "test-cron-secret";
const SALON_ID = "00000000-0000-4000-8000-000000000001";
const mockFetch = vi.fn();

function cronRequest(url: string) {
  return createMockRequest(url, { method: "POST", headers: { authorization: `Bearer ${SECRET}` } });
}

function reminderRow(id: string, phone: string | null, firstName = "Maria", lastName = "Kaczmarek") {
  return {
    appointmentId: id,
    startTime: new Date(Date.now() + 3 * 3600_000),
    endTime: new Date(Date.now() + 4 * 3600_000),
    appointmentStartTime: new Date(Date.now() + 3600_000),
    salonId: SALON_ID,
    clientId: `client-${id}`,
    serviceId: "service-1",
    employeeId: "employee-1",
    status: "scheduled",
    clientFirstName: firstName,
    clientLastName: lastName,
    clientPhone: phone,
    salonName: "Salon",
    serviceName: "Strzyzenie",
    employeeFirstName: "Ewa",
    employeeLastName: "Zadatkowa",
  };
}

/** Id wizyt przekazane do `inArray` w UPDATE (ostatnie wywołanie z listą id `appt-*`). */
function markedIds(): string[] {
  const ids = inArrayCalls
    .map((c) => c.values)
    .filter((v): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string" && x.startsWith("appt-")));
  return ids.at(-1) ?? [];
}

beforeEach(() => {
  vi.clearAllMocks();
  inArrayCalls.length = 0;
  selectRows.current = [];
  process.env.CRON_SECRET = SECRET;
  vi.stubEnv("SMSAPI_TOKEN", "");
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("POST /api/reminders/appointment — numer testowy", () => {
  const URL_ = "http://localhost/api/reminders/appointment";

  it("numer testowy: SMS nie wychodzi, wizyta oznaczona jako obsłużona (bez ponawiania)", async () => {
    selectRows.current = [reminderRow("appt-test", TEST_PHONE)];

    const { status, body } = await parseResponse<{ data: Record<string, unknown> }>(
      await remindersPost(cronRequest(URL_))
    );

    expect(status).toBe(200);
    expect(body.data).toMatchObject({ processed: 1, sent: 0, skipped: 1, failed: 0 });
    expect(insertValues).not.toHaveBeenCalled(); // bez wpisu w notifications
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ reminderSentAt: expect.any(Date) }));
    expect(markedIds()).toEqual(["appt-test"]);
  });

  it("mieszanka: oznaczone udane i testowe, nieudana na prawdziwy numer zostaje do ponowienia", async () => {
    vi.stubEnv("SMSAPI_TOKEN", "test-token");
    mockFetch.mockImplementation(async (_url: string, init: { body: string }) => {
      const to = new URLSearchParams(init.body).get("to");
      return to === "+48123456789"
        ? { ok: true, status: 200, json: async () => ({ count: 1, list: [{ id: "m1" }] }) }
        : { ok: false, status: 500, json: async () => { throw new Error("not json"); } };
    });
    selectRows.current = [
      reminderRow("appt-ok", "+48 123 456 789"),
      reminderRow("appt-test", TEST_PHONE),
      reminderRow("appt-fail", "+48 987 654 321"),
    ];

    const { status, body } = await parseResponse<{ data: Record<string, unknown> }>(
      await remindersPost(cronRequest(URL_))
    );

    expect(status).toBe(200);
    expect(body.data).toMatchObject({ processed: 3, sent: 1, skipped: 1, failed: 1 });
    expect(mockFetch).toHaveBeenCalledTimes(2); // numer testowy nie dociera do dostawcy
    expect(markedIds().sort()).toEqual(["appt-ok", "appt-test"]);
  });

  it("tylko nieudana wysyłka: brak UPDATE (ponowienie przy następnym wywołaniu)", async () => {
    vi.stubEnv("SMSAPI_TOKEN", "test-token");
    mockFetch.mockResolvedValue({ ok: false, status: 500, json: async () => { throw new Error("not json"); } });
    selectRows.current = [reminderRow("appt-fail", "+48 987 654 321")];

    const { body } = await parseResponse<{ data: Record<string, unknown> }>(
      await remindersPost(cronRequest(URL_))
    );

    expect(body.data).toMatchObject({ processed: 1, sent: 0, skipped: 0, failed: 1 });
    expect(updateSet).not.toHaveBeenCalled();
  });
});

describe("POST /api/cron/sms-reminders — bez danych osobowych w logach i odpowiedzi", () => {
  const URL_ = "http://localhost/api/cron/sms-reminders";

  it("imię i nazwisko klienta nie trafiają do logów ani do odpowiedzi", async () => {
    selectRows.current = [
      reminderRow("appt-1", "+48 123 456 789", "Zofia", "Unikatowska"),
      reminderRow("appt-2", null, "Zofia", "Unikatowska"),
      reminderRow("appt-3", TEST_PHONE, "Zofia", "Unikatowska"),
    ];

    const res = await cronPost(cronRequest(URL_));
    const { status, body } = await parseResponse<{ data: Record<string, unknown> }>(res);

    expect(status).toBe(200);
    expect(body.data).toMatchObject({ processed: 3, sent: 1, skipped: 1, failed: 1 });

    const logs = JSON.stringify([
      vi.mocked(logger.debug).mock.calls,
      vi.mocked(logger.info).mock.calls,
      vi.mocked(logger.warn).mock.calls,
      vi.mocked(logger.error).mock.calls,
    ]);
    // Kontrola pozytywna: logi tego przebiegu w ogóle są (inaczej "brak nazwiska" nic nie znaczy)
    expect(logs).toContain("appt-1");
    expect(logs).toContain("appt-2");
    expect(logs).not.toContain("Unikatowska");
    expect(logs).not.toContain("Zofia");
    expect(JSON.stringify(body)).not.toContain("Unikatowska");
  });
});
