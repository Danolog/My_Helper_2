/**
 * Crony przypomnień (push 1h, push 24h, SMS 1h): odpowiedź bez imienia
 * i nazwiska klienta i bez tekstu wyjątku albo bibliotek wysyłki.
 *
 * Pole `error` elementu `results` przyjmuje wyłącznie stałe kody trasy;
 * szczegół przyczyny zostaje w logu serwera. Zmockowane są wyjścia rejestru
 * systemowego, biblioteki wysyłki (push, SMS) i logger.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST as push1hPost } from "@/app/api/cron/push-reminders/route";
import { POST as push24hPost } from "@/app/api/cron/push-reminders-24h/route";
import { POST as smsPost } from "@/app/api/cron/sms-reminders/route";
import { logger } from "@/lib/logger";
import { createMockRequest, parseResponse } from "./helpers";

// vi.hoisted i vi.mock są wynoszone przed importy.
const h = vi.hoisted(() => ({
  pushRows: [] as unknown[],
  smsRows: [] as unknown[],
  usersWithSubs: [] as string[],
  push1h: vi.fn(),
  push24h: vi.fn(),
  sms: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: vi.fn() } } }));

vi.mock("@/lib/server/system", () => ({
  findDuePushReminders: async () => h.pushRows,
  findDueSmsReminders: async () => h.smsRows,
  getUserIdsWithPushSubscriptions: async () => h.usersWithSubs,
  markCronRemindersSent: async () => undefined,
  getPendingCronReminders: async () => [],
  countPushSubscriptions: async () => 0,
}));

vi.mock("@/lib/push", () => ({
  sendAppointmentReminderPush: (...a: unknown[]) => h.push1h(...a),
  sendAppointmentReminder24hPush: (...a: unknown[]) => h.push24h(...a),
}));

vi.mock("@/lib/sms", () => ({
  SMS_PROVIDER_UNAVAILABLE_ERROR: "Brak dostawcy SMS",
  smsProviderUnavailablePlatform: () => null,
  sendAppointmentReminderSms: (...a: unknown[]) => h.sms(...a),
}));

const SECRET = "test-cron-secret";
const SALON_ID = "00000000-0000-4000-8000-000000000001";
const FIRST = "Testowa";
const LAST = "Klientka";
const THROWN = "connect ECONNREFUSED db.example.internal";
const LIB_ERROR = "web-push failure at push.example.com endpoint";
const SMS_LIB_ERROR = "Invalid phone number: +48*****200 from sms.example.com";

type Result = Record<string, unknown>;
type Body = {
  success: boolean;
  data: { processed: number; sent: number; failed: number; skipped?: number; results: Result[] };
};

function cronRequest(path: string) {
  return createMockRequest(`http://localhost${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${SECRET}` },
  });
}

function pushRow(id: string, userId: string | null) {
  return {
    appointmentId: id,
    appointmentStartTime: new Date(Date.now() + 3600_000),
    salonId: SALON_ID,
    salonName: "Salon",
    clientId: `client-${id}`,
    clientFirstName: FIRST,
    clientLastName: LAST,
    bookedByUserId: userId,
    employeeFirstName: "Ewa",
    employeeLastName: "Zadatkowa",
    serviceName: "Strzyzenie",
  };
}

function smsRow(id: string, phone: string | null) {
  return {
    appointmentId: id,
    appointmentStartTime: new Date(Date.now() + 3600_000),
    salonId: SALON_ID,
    salonName: "Salon",
    clientId: `client-${id}`,
    clientFirstName: FIRST,
    clientLastName: LAST,
    clientPhone: phone,
    employeeFirstName: "Ewa",
    employeeLastName: "Zadatkowa",
    serviceName: "Strzyzenie",
  };
}

function allLogCalls() {
  return [logger.debug, logger.info, logger.warn, logger.error].flatMap((f) => vi.mocked(f).mock.calls);
}

function byId(body: Body, id: string): Result {
  const r = body.data.results.find((x) => x.appointmentId === id);
  expect(r, `brak elementu ${id}`).toBeDefined();
  return r!;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = SECRET;
  h.pushRows = [];
  h.smsRows = [];
  h.usersWithSubs = [];
  h.push1h.mockResolvedValue({ success: true, sent: 1, failed: 0 });
  h.push24h.mockResolvedValue({ success: true, sent: 1, failed: 0 });
  h.sms.mockResolvedValue({ success: true, notificationId: "n-1" });
});

const PUSH_ROUTES = [
  ["push 1h", push1hPost, h.push1h, "/api/cron/push-reminders"],
  ["push 24h", push24hPost, h.push24h, "/api/cron/push-reminders-24h"],
] as const;

describe.each(PUSH_ROUTES)("POST %s — odpowiedź bez danych osoby i bez tekstu błędu", (_n, POST, send, path) => {
  it("wysyłka rzuca wyjątek → 200, kod processing_failed, tekst wyjątku tylko w logu", async () => {
    h.pushRows = [pushRow("appt-1", "user-1")];
    h.usersWithSubs = ["user-1"];
    send.mockRejectedValue(new Error(THROWN));

    const { status, body } = await parseResponse<Body>(await POST(cronRequest(path)));

    expect(status).toBe(200);
    expect(JSON.stringify(body)).not.toContain("ECONNREFUSED");
    expect(JSON.stringify(body)).not.toContain("db.example.internal");
    expect(byId(body, "appt-1").error).toBe("processing_failed");
    expect(body.data).toMatchObject({ processed: 1, sent: 0, failed: 1 });
    expect(logger.error).toHaveBeenCalled();
  });

  it("wysyłka zwraca success: false z tekstem → kod send_failed, tekstu nie ma w odpowiedzi", async () => {
    h.pushRows = [pushRow("appt-1", "user-1")];
    h.usersWithSubs = ["user-1"];
    send.mockResolvedValue({ success: false, sent: 0, failed: 1, error: LIB_ERROR });

    const { status, body } = await parseResponse<Body>(await POST(cronRequest(path)));

    expect(status).toBe(200);
    expect(JSON.stringify(body)).not.toContain("push.example.com");
    expect(JSON.stringify(body)).not.toContain("web-push failure");
    expect(byId(body, "appt-1").error).toBe("send_failed");
    expect(body.data).toMatchObject({ processed: 1, sent: 0, failed: 1 });
  });

  it("imię i nazwisko klienta nie trafiają do odpowiedzi ani do kluczy logów; kody i liczniki", async () => {
    h.pushRows = [
      pushRow("appt-ok", "user-1"),
      pushRow("appt-nouser", null),
      pushRow("appt-nosub", "user-2"),
    ];
    h.usersWithSubs = ["user-1"];

    const { status, body } = await parseResponse<Body>(await POST(cronRequest(path)));

    expect(status).toBe(200);
    const json = JSON.stringify(body);
    expect(json).not.toContain(FIRST);
    expect(json).not.toContain(LAST);
    expect(json).not.toContain("clientName");
    expect(body.data).toMatchObject({ processed: 3, sent: 1, failed: 2 });

    const ok = byId(body, "appt-ok");
    expect(ok).toMatchObject({ success: true, sent: 1, userId: "user-1" });
    expect("error" in ok).toBe(false);
    expect(byId(body, "appt-nouser")).toMatchObject({ success: false, userId: null, error: "no_user_account" });
    expect(byId(body, "appt-nosub")).toMatchObject({ success: false, userId: "user-2", error: "no_push_subscriptions" });

    // Treść powiadomienia nadal z imieniem i nazwiskiem.
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ clientName: `${FIRST} ${LAST}` }));

    const calls = allLogCalls();
    expect(JSON.stringify(calls)).toContain("appt-ok");
    for (const call of calls) {
      const ctx = call[1];
      if (ctx && typeof ctx === "object") expect(Object.keys(ctx)).not.toContain("clientName");
    }
    expect(JSON.stringify(calls)).not.toContain(LAST);
  });
});

describe("POST SMS 1h — odpowiedź bez tekstu błędu", () => {
  const path = "/api/cron/sms-reminders";

  it("wysyłka rzuca wyjątek → 200, kod processing_failed, tekst wyjątku tylko w logu", async () => {
    h.smsRows = [smsRow("appt-1", "+48600100200")];
    h.sms.mockRejectedValue(new Error(THROWN));

    const { status, body } = await parseResponse<Body>(await smsPost(cronRequest(path)));

    expect(status).toBe(200);
    expect(JSON.stringify(body)).not.toContain("ECONNREFUSED");
    expect(JSON.stringify(body)).not.toContain("db.example.internal");
    expect(byId(body, "appt-1").error).toBe("processing_failed");
    expect(body.data).toMatchObject({ processed: 1, sent: 0, skipped: 0, failed: 1 });
    expect(logger.error).toHaveBeenCalled();
  });

  it("wysyłka zwraca success: false z tekstem → kod send_failed, tekstu nie ma w odpowiedzi", async () => {
    h.smsRows = [smsRow("appt-1", "+48600100200")];
    h.sms.mockResolvedValue({ success: false, error: SMS_LIB_ERROR });

    const { status, body } = await parseResponse<Body>(await smsPost(cronRequest(path)));

    expect(status).toBe(200);
    expect(JSON.stringify(body)).not.toContain("sms.example.com");
    expect(JSON.stringify(body)).not.toContain("Invalid phone number");
    expect(byId(body, "appt-1").error).toBe("send_failed");
    expect(body.data).toMatchObject({ processed: 1, sent: 0, skipped: 0, failed: 1 });
  });

  it("udany bez error, bez telefonu → no_phone_number, pominięty → skipped bez tekstu; liczniki", async () => {
    h.smsRows = [
      smsRow("appt-ok", "+48600100200"),
      smsRow("appt-nophone", null),
      smsRow("appt-skip", "+48600100201"),
    ];
    h.sms.mockImplementation(async (p: { clientPhone: string }) =>
      p.clientPhone === "+48600100201"
        ? { success: false, error: "Numer testowy sms.example.com", skipped: "test_phone" }
        : { success: true, notificationId: "n-1" }
    );

    const { status, body } = await parseResponse<Body>(await smsPost(cronRequest(path)));

    expect(status).toBe(200);
    expect(body.data).toMatchObject({ processed: 3, sent: 1, skipped: 1, failed: 1 });

    const ok = byId(body, "appt-ok");
    expect(ok).toMatchObject({ success: true });
    expect("error" in ok).toBe(false);
    expect(byId(body, "appt-nophone")).toMatchObject({ success: false, error: "no_phone_number" });
    const skip = byId(body, "appt-skip");
    expect(skip).toMatchObject({ success: false, skipped: true });
    expect("error" in skip).toBe(false);

    const json = JSON.stringify(body);
    expect(json).not.toContain("sms.example.com");
    expect(json).not.toContain(FIRST);
    expect(json).not.toContain(LAST);
  });
});
