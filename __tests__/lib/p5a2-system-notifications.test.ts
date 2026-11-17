/**
 * #193 P5a-2: crony przypomnień (push 1h, push 24h, SMS) i `reminders/appointment`
 * idą przez wyjścia `system/notifications.ts` (pula systemowa), nie przez pulę
 * żądań. Crony są celowo cross-salon (sekret crona, nie sesja).
 *
 * `reminders/appointment` (decyzja A): `?salonId=` to filtr danych wołającego
 * crona. DoD: bez sekretu → 401, zły UUID → 400 (oba bez zapytania), z salonId
 * → zapytanie ma warunek `"appointments"."salon_id" = salonId`, bez salonId →
 * bez warunku salonu (oba salony). Odczyt kończy się przed wysyłką SMS.
 *
 * `dbSystem` to prawdziwy budowniczy zapytań drizzle (`pg-proxy`) zapisujący
 * SQL i parametry; pula `db` i brama salonu rzucają przy użyciu.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockRequest, parseResponse } from "../api/helpers";

const h = vi.hoisted(() => {
  const throwingPool = (name: string) =>
    new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === "then") return undefined;
          throw new Error(`${name} użyte w trasie systemowej (${String(prop)})`);
        },
      }
    );
  return {
    throwingPool,
    captured: [] as Array<{ sql: string; params: unknown[] }>,
    rows: [] as Array<[RegExp, unknown[][]]>,
    sendSms: vi.fn(),
    sendReminderSms: vi.fn(),
    push1h: vi.fn(),
    push24h: vi.fn(),
    /** Liczba zapytań w chwili każdego wywołania wysyłki. */
    queriesAtSend: [] as number[],
  };
});

vi.mock("@/lib/db", () => ({ db: h.throwingPool("db") }));
vi.mock("@/lib/server/repository", () => ({ forSalon: () => h.throwingPool("forSalon") }));
vi.mock("@/lib/server/system/db-system", async () => {
  const { drizzle } = await import("drizzle-orm/pg-proxy");
  return {
    dbSystem: drizzle(async (sql: string, params: unknown[]) => {
      h.captured.push({ sql, params });
      const hit = h.rows.find(([re]) => re.test(sql));
      return { rows: hit ? hit[1] : [] };
    }),
  };
});
vi.mock("@/lib/sms", async (orig) => ({
  SMS_TIME_ZONE: (await orig<typeof import("@/lib/sms")>()).SMS_TIME_ZONE,
  sendSms: (...a: unknown[]) => {
    h.queriesAtSend.push(h.captured.length);
    return h.sendSms(...a);
  },
  sendAppointmentReminderSms: (...a: unknown[]) => h.sendReminderSms(...a),
}));
vi.mock("@/lib/push", () => ({
  sendAppointmentReminderPush: (...a: unknown[]) => h.push1h(...a),
  sendAppointmentReminder24hPush: (...a: unknown[]) => h.push24h(...a),
}));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: vi.fn() } } }));

import * as push1h from "@/app/api/cron/push-reminders/route";
import * as push24h from "@/app/api/cron/push-reminders-24h/route";
import * as smsReminders from "@/app/api/cron/sms-reminders/route";
import * as reminders from "@/app/api/reminders/appointment/route";

const SALON_A = "00000000-0000-4000-8000-00000000000a";
const SECRET = "test-cron-secret";
const START = "2026-11-17 10:00:00";

const req = (path: string, method: "GET" | "POST", secret: string | null = SECRET) =>
  createMockRequest(`http://localhost${path}`, {
    method,
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
  });

const salonParamIndexes = (q: { sql: string; params: unknown[] }) =>
  [...q.sql.matchAll(/"appointments"\."salon_id" = \$(\d+)/g)].map((m) => Number(m[1]));

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = SECRET;
  h.captured.length = 0;
  h.queriesAtSend.length = 0;
  h.rows = [];
  h.sendSms.mockResolvedValue({ success: true });
  h.sendReminderSms.mockResolvedValue({ success: true });
  h.push1h.mockResolvedValue({ success: true, sent: 1 });
  h.push24h.mockResolvedValue({ success: true, sent: 1 });
});

describe("crony przypomnień przez pulę systemową", () => {
  const pushRow = ["appt-1", START, SALON_A, "Salon A", "c-1", "Ala", "Nowak", "user-1", "Ewa", "Kowal", "Strzyżenie"];

  it.each([
    ["push 1h", push1h.POST, h.push1h, "reminder_push_1h_sent_at"],
    ["push 24h", push24h.POST, h.push24h, "reminder_push_sent_at"],
  ] as const)("%s POST: odczyt, oznaczenie, subskrypcje, wysyłka", async (_n, POST, send, flag) => {
    h.rows = [
      [/^select .* from "appointments"/, [pushRow]],
      [/from "push_subscriptions"/, [["user-1"]]],
    ];
    const { status, body } = await parseResponse(await POST(req("/api/cron/x", "POST")));
    expect(status, JSON.stringify(body)).toBe(200);
    expect(h.captured).toHaveLength(3);
    expect(h.captured[1]!.sql).toMatch(new RegExp(`^update "appointments" set "${flag}"`));
    expect(h.captured[1]!.sql).toMatch(/where "appointments"\."id" in \(\$\d+\)/);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["push 1h", push1h.GET],
    ["push 24h", push24h.GET],
  ] as const)("%s GET ?status=1: dwa odczyty przez pulę systemową", async (_n, GET) => {
    const { status } = await parseResponse(await GET(req("/api/cron/x?status=1", "GET")));
    expect(status).toBe(200);
    expect(h.captured).toHaveLength(2);
  });

  it("SMS POST: odczyt, oznaczenie, wysyłka", async () => {
    h.rows = [[/^select .* from "appointments"/, [["appt-1", START, SALON_A, "Salon A", "c-1", "Ala", "Nowak", "+48500100200", "Ewa", "Kowal", null]]]];
    const { status, body } = await parseResponse(await smsReminders.POST(req("/api/cron/sms-reminders", "POST")));
    expect(status, JSON.stringify(body)).toBe(200);
    expect(h.captured).toHaveLength(2);
    expect(h.captured[1]!.sql).toMatch(/^update "appointments" set "reminder_1h_sent_at"/);
    expect(h.sendReminderSms).toHaveBeenCalledTimes(1);
  });

  it("SMS GET ?status=1: jeden odczyt przez pulę systemową", async () => {
    const { status } = await parseResponse(await smsReminders.GET(req("/api/cron/sms-reminders?status=1", "GET")));
    expect(status).toBe(200);
    expect(h.captured).toHaveLength(1);
  });

  it.each([
    ["push 1h", push1h.POST],
    ["push 24h", push24h.POST],
    ["SMS", smsReminders.POST],
  ] as const)("%s bez sekretu → 401 bez zapytania", async (_n, POST) => {
    const res = await POST(req("/api/cron/x", "POST", null));
    expect(res.status).toBe(401);
    expect(h.captured).toEqual([]);
  });
});

describe("reminders/appointment: filtr salonu wołającego crona (decyzja A)", () => {
  const row = ["appt-1", START, "2026-11-17 11:00:00", SALON_A, "c-1", "s-1", "e-1", "scheduled", "Ala", "Nowak", "+48500100200", "Salon A", "Strzyżenie", "Ewa", "Kowal"];

  it("POST bez sekretu → 401 bez zapytania", async () => {
    const res = await reminders.POST(req("/api/reminders/appointment", "POST", null));
    expect(res.status).toBe(401);
    expect(h.captured).toEqual([]);
  });

  it.each([
    ["POST", () => reminders.POST(req("/api/reminders/appointment?salonId=abc", "POST"))],
    // Podany, ale pusty salonId nie może zamienić filtra jednego salonu w przebieg po wszystkich.
    ["POST z pustym salonId", () => reminders.POST(req("/api/reminders/appointment?salonId=", "POST"))],
    ["GET", () => reminders.GET(req("/api/reminders/appointment?salonId=abc", "GET"))],
    ["GET bez salonId", () => reminders.GET(req("/api/reminders/appointment", "GET"))],
  ] as const)("%s ze złym albo brakującym salonId → 400 bez zapytania", async (_n, call) => {
    const res = await call();
    expect(res.status).toBe(400);
    expect(h.captured).toEqual([]);
  });

  it("POST z salonId → odczyt z warunkiem salonu, wysyłka po odczycie, potem oznaczenie", async () => {
    h.rows = [[/^select .* from "appointments"/, [row]]];
    const { status, body } = await parseResponse(await reminders.POST(req(`/api/reminders/appointment?salonId=${SALON_A}`, "POST")));
    expect(status, JSON.stringify(body)).toBe(200);
    expect(h.captured).toHaveLength(2);
    const sel = h.captured[0]!;
    expect(salonParamIndexes(sel).some((n) => sel.params[n - 1] === SALON_A), sel.sql).toBe(true);
    expect(h.queriesAtSend).toEqual([1]);
    expect(h.captured[1]!.sql).toMatch(/^update "appointments" set "reminder_sent_at"/);
  });

  it("POST bez salonId → odczyt bez warunku salonu (wszystkie salony)", async () => {
    const { status } = await parseResponse(await reminders.POST(req("/api/reminders/appointment", "POST")));
    expect(status).toBe(200);
    expect(h.captured).toHaveLength(1);
    // Join po `"appointments"."salon_id" = "salons"."id"` zostaje; brak tylko warunku z parametrem.
    expect(h.captured[0]!.sql).not.toMatch(/"appointments"\."salon_id" = \$\d+/);
    expect(h.captured[0]!.sql).toMatch(/"appointments"\."salon_id" = "salons"\."id"/);
  });

  it("GET z salonId → podgląd z warunkiem salonu", async () => {
    const { status } = await parseResponse(await reminders.GET(req(`/api/reminders/appointment?salonId=${SALON_A}`, "GET")));
    expect(status).toBe(200);
    expect(h.captured).toHaveLength(1);
    const sel = h.captured[0]!;
    expect(salonParamIndexes(sel).some((n) => sel.params[n - 1] === SALON_A), sel.sql).toBe(true);
  });
});
