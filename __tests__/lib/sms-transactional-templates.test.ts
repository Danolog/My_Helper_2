/**
 * Szablony SMS transakcyjnych z src/lib/sms.ts: treść przekazana dostawcy
 * zawiera wyłącznie informację o wizycie / płatności — bez adresu URL
 * i bez wezwania do rezerwacji.
 *
 * Lista szablonów jest zamknięta względem eksportów sms.ts: każdy eksport
 * `send…Sms` (poza ogólnym `sendSms`) musi mieć wpis w TEMPLATES, inaczej
 * test jest czerwony — nowy szablon z linkiem nie przejdzie bez przeglądu.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockDbValues } = vi.hoisted(() => {
  const returning = vi.fn().mockResolvedValue([{ id: "notif-1" }]);
  const mockDbValues = vi.fn().mockReturnValue({ returning });
  return { mockDbValues };
});

vi.mock("@/lib/db", () => ({
  db: { insert: () => ({ values: mockDbValues }) },
}));

vi.mock("@/lib/schema", () => ({ notifications: "notifications_table" }));

vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import * as sms from "@/lib/sms";

const APP_URL = "https://aplikacja-salonu.example";
const SALON_ID = "11111111-2222-4333-8444-555555555555";
const PHONE = "+48512345678";
const DATE = new Date("2030-01-15T14:00:00");

/** Każdy eksportowany szablon SMS transakcyjnego z parametrami do wywołania. */
const TEMPLATES: Record<string, (mod: typeof sms) => Promise<sms.SmsResult>> = {
  sendAppointmentReminderSms: (mod) =>
    mod.sendAppointmentReminderSms({
      clientPhone: PHONE,
      clientName: "Jan Kowalski",
      serviceName: "Strzyzenie",
      employeeName: "Anna Nowak",
      appointmentDate: DATE,
      salonName: "Salon Uroda",
      salonId: SALON_ID,
      clientId: "client-1",
    }),
  sendBookingConfirmationSms: (mod) =>
    mod.sendBookingConfirmationSms({
      clientPhone: PHONE,
      clientName: "Jan Kowalski",
      serviceName: "Strzyzenie",
      employeeName: "Anna Nowak",
      appointmentDate: DATE,
      salonName: "Salon Uroda",
      salonId: SALON_ID,
      clientId: "client-1",
    }),
  sendPaymentConfirmationSms: (mod) =>
    mod.sendPaymentConfirmationSms({
      clientPhone: PHONE,
      clientName: "Jan Kowalski",
      amount: 50,
      currency: "PLN",
      serviceName: "Strzyzenie",
      appointmentDate: DATE,
      employeeName: "Anna Nowak",
      salonId: SALON_ID,
      clientId: "client-1",
    }),
};

const mockFetch = vi.fn();

/** Treść wysłana do dostawcy (pole `message` w treści żądania SMSAPI). */
function sentMessage(): string {
  expect(mockFetch).toHaveBeenCalledTimes(1);
  const init = mockFetch.mock.calls[0]![1] as { body: string };
  return new URLSearchParams(init.body).get("message") ?? "";
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("SMSAPI_TOKEN", "test-token");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", APP_URL);
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

describe("szablony SMS transakcyjnych: lista zamknięta względem eksportów", () => {
  it("każdy eksport send…Sms (poza sendSms) ma wpis w teście i odwrotnie", () => {
    const exported = Object.entries(sms)
      .filter(([name, value]) => typeof value === "function" && /^send\w+Sms$/.test(name))
      .map(([name]) => name)
      .filter((name) => name !== "sendSms")
      .sort();

    expect(exported).toEqual(Object.keys(TEMPLATES).sort());
  });
});

describe("szablony SMS transakcyjnych: bez linku i bez wezwania do rezerwacji", () => {
  it.each(Object.keys(TEMPLATES).map((name) => [name]))(
    "%s: treść do dostawcy bez URL, adresu aplikacji, /book i „Zarezerwuj”",
    async (name) => {
      const result = await TEMPLATES[name]!(sms);
      expect(result.success).toBe(true);

      const message = sentMessage();
      expect(message.length).toBeGreaterThan(0);
      expect(message).not.toMatch(/https?:\/\//i);
      expect(message).not.toMatch(/www\./i);
      expect(message).not.toContain(APP_URL);
      expect(message).not.toContain("aplikacja-salonu");
      expect(message).not.toContain("/book");
      expect(message).not.toContain(SALON_ID);
      expect(message).not.toMatch(/zarezerwuj/i);
    }
  );
});
