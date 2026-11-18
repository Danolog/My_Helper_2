/**
 * Cron przypomnień SMS na hostingu bez dostawcy SMS: praca kończy się przed
 * wybraniem i oznaczeniem wizyt, więc przypomnienia nie przepadają.
 *
 * `sendSms` jest PRAWDZIWY. Zmockowane są tylko baza (select/update/insert),
 * fetch dostawcy i logger.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/server/repository", async () => {
  const { db } = await import("@/lib/db");
  return {
    forSalon: (salonId: string) => ({ salonId, raw: (fn: (tx: unknown) => unknown) => fn(db) }),
  };
});

const { selectRows, selectCalls, updateSet, updateWhere, insertValues } = vi.hoisted(() => ({
  selectRows: { current: [] as unknown[] },
  selectCalls: vi.fn(),
  updateSet: vi.fn(),
  updateWhere: vi.fn(),
  insertValues: vi.fn(),
}));

/** Łańcuch zapytania: każda metoda zwraca ten sam obiekt, `await` daje wiersze. */
function selectChain() {
  selectCalls();
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

vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { GET as cronGet, POST as cronPost } from "@/app/api/cron/sms-reminders/route";
import { logger } from "@/lib/logger";
import { SMS_PROVIDER_UNAVAILABLE_ERROR } from "@/lib/sms";
import { createMockRequest, parseResponse } from "./helpers";

const SECRET = "test-cron-secret";
const SALON_ID = "00000000-0000-4000-8000-000000000001";
const URL_ = "http://localhost/api/cron/sms-reminders";
const mockFetch = vi.fn();

function cronRequest(secret: string | null = SECRET, method: "POST" | "GET" = "POST", url: string = URL_) {
  return createMockRequest(url, {
    method,
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
  });
}

function reminderRow(id: string) {
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
    clientFirstName: "Zofia",
    clientLastName: "Unikatowska",
    clientPhone: "+48 123 456 789",
    salonName: "Salon",
    serviceName: "Strzyzenie",
    employeeFirstName: "Ewa",
    employeeLastName: "Zadatkowa",
  };
}

function allLogs(): string {
  return JSON.stringify([
    vi.mocked(logger.debug).mock.calls,
    vi.mocked(logger.info).mock.calls,
    vi.mocked(logger.warn).mock.calls,
    vi.mocked(logger.error).mock.calls,
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
  selectRows.current = [reminderRow("appt-1")];
  process.env.CRON_SECRET = SECRET;
  vi.stubEnv("SMSAPI_TOKEN", "");
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("K_SERVICE", "");
  vi.stubGlobal("fetch", mockFetch);
  mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ count: 1, list: [{ id: "m1" }] }) });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("POST i GET /api/cron/sms-reminders — brak dostawcy SMS na hostingu", () => {
  for (const [nazwa, zmienna, wartosc, platforma] of [
    ["Vercel", "VERCEL", "1", "Vercel"],
    ["Cloud Run", "K_SERVICE", "moja-usluga", "Cloud Run"],
  ] as const) {
    it(`${nazwa} bez tokenu: 503, wizyty nie są wybierane ani oznaczane, nic nie wychodzi`, async () => {
      vi.stubEnv(zmienna, wartosc);

      const { status, body } = await parseResponse<{ success: boolean; error: string }>(
        await cronPost(cronRequest())
      );

      expect(status).toBe(503);
      expect(body).toEqual({ success: false, error: SMS_PROVIDER_UNAVAILABLE_ERROR });
      expect(selectCalls).not.toHaveBeenCalled();
      expect(updateSet).not.toHaveBeenCalled();
      expect(updateWhere).not.toHaveBeenCalled();
      expect(mockFetch).not.toHaveBeenCalled();
      expect(insertValues).not.toHaveBeenCalled();

      expect(logger.error).toHaveBeenCalledTimes(1);
      expect(vi.mocked(logger.error).mock.calls[0]?.[1]).toMatchObject({ platform: platforma });
      const logs = allLogs();
      expect(logs).not.toContain("123 456 789");
      expect(logs).not.toContain("123456789");
      expect(logs).not.toContain("Zofia");
      expect(logs).not.toContain("Unikatowska");
    });
  }

  it("hosting z tokenem: wizyta oznaczona i SMS wysłany", async () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("SMSAPI_TOKEN", "test-token");

    const { status, body } = await parseResponse<{ data: Record<string, unknown> }>(
      await cronPost(cronRequest())
    );

    expect(status).toBe(200);
    expect(body.data).toMatchObject({ processed: 1, sent: 1, failed: 0 });
    expect(updateSet).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("poza hostingiem bez tokenu: symulacja, wizyta oznaczona, 200", async () => {
    const { status, body } = await parseResponse<{ data: Record<string, unknown> }>(
      await cronPost(cronRequest())
    );

    expect(status).toBe(200);
    expect(body.data).toMatchObject({ processed: 1, sent: 1, failed: 0 });
    expect(updateSet).toHaveBeenCalledTimes(1);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("bez poprawnego sekretu na hostingu bez tokenu: odpowiedź bramki sekretu, nie 503", async () => {
    vi.stubEnv("VERCEL", "1");

    const { status } = await parseResponse<{ success?: boolean; error?: string }>(
      await cronPost(cronRequest("zly-sekret"))
    );

    expect(status).not.toBe(503);
    expect(status).toBe(401);
    expect(selectCalls).not.toHaveBeenCalled();
    expect(updateSet).not.toHaveBeenCalled();
  });

  it("GET bez status na hostingu bez tokenu: 503, wizyty nie są wybierane ani oznaczane", async () => {
    vi.stubEnv("VERCEL", "1");

    const { status, body } = await parseResponse<{ success: boolean; error: string }>(
      await cronGet(cronRequest(SECRET, "GET"))
    );

    expect(status).toBe(503);
    expect(body).toEqual({ success: false, error: SMS_PROVIDER_UNAVAILABLE_ERROR });
    expect(selectCalls).not.toHaveBeenCalled();
    expect(updateSet).not.toHaveBeenCalled();
    expect(updateWhere).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
    expect(insertValues).not.toHaveBeenCalled();

    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(vi.mocked(logger.error).mock.calls[0]?.[1]).toMatchObject({ platform: "Vercel" });
    const logs = allLogs();
    expect(logs).not.toContain("123 456 789");
    expect(logs).not.toContain("123456789");
    expect(logs).not.toContain("Zofia");
    expect(logs).not.toContain("Unikatowska");
  });

  it("GET ?status=1 na hostingu bez tokenu: 200, odczyt oczekujących bez zmian", async () => {
    vi.stubEnv("VERCEL", "1");

    const { status, body } = await parseResponse<{
      success: boolean;
      data: { pendingReminders: number; appointments: Array<{ id: string }> };
    }>(await cronGet(cronRequest(SECRET, "GET", `${URL_}?status=1`)));

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.pendingReminders).toBe(1);
    expect(body.data.appointments.map((a) => a.id)).toEqual(["appt-1"]);
    expect(selectCalls).toHaveBeenCalled();
    expect(updateSet).not.toHaveBeenCalled();
    expect(updateWhere).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
    expect(insertValues).not.toHaveBeenCalled();
  });
});
