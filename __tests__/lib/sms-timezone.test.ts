/**
 * Data i godzina w SMS transakcyjnych (#232): zawsze w strefie Europe/Warsaw,
 * niezależnie od strefy procesu.
 *
 * Test SAM wymusza strefę procesu UTC (`TZ=UTC`) i przywraca ją po sobie.
 * Na maszynie w strefie warszawskiej test bez tego wymuszenia przeszedłby
 * na pusto, dlatego każdy przypadek najpierw sprawdza, że proces naprawdę
 * liczy w UTC (`assertProcessInUtc`).
 *
 * Format treści: dzień tygodnia i nazwa miesiąca słownie, sprowadzone do
 * podstawowej tabeli GSM-7 (bez polskich znaków, np. „sroda”).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// #193 P5a-1: biblioteka zapisuje przez forSalon(salonId).raw — brama deleguje
// do zmockowanego `db`, więc asercje na zapisie zostają bez zmian.
vi.mock("@/lib/server/repository", async () => {
  const { db } = await import("@/lib/db");
  return {
    forSalon: (salonId: string) => ({ salonId, raw: (fn: (tx: unknown) => unknown) => fn(db) }),
  };
});

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

const BASE = {
  clientPhone: "+48512345678",
  clientName: "Jan Kowalski",
  serviceName: "Strzyzenie",
  employeeName: "Anna Nowak",
  salonName: "Salon Uroda",
  salonId: "11111111-2222-4333-8444-555555555555",
  clientId: "client-1",
};

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
    reminder: "juz dzisiaj o 14:00 (15 stycznia). Do zobaczenia!",
    booking: "zostala umowiona na wtorek, 15 stycznia 2030 o 14:00. Do zobaczenia!",
    payment: "dnia wtorek, 15 stycznia 2030 14:00 zostal przyjety.",
  },
  {
    label: "lato",
    at: "2030-07-16T12:00:00Z",
    reminder: "juz dzisiaj o 14:00 (16 lipca). Do zobaczenia!",
    booking: "zostala umowiona na wtorek, 16 lipca 2030 o 14:00. Do zobaczenia!",
    payment: "dnia wtorek, 16 lipca 2030 14:00 zostal przyjety.",
  },
  {
    label: "po północy UTC następny dzień w Warszawie",
    at: "2030-01-15T23:30:00Z",
    reminder: "juz dzisiaj o 00:30 (16 stycznia). Do zobaczenia!",
    // Data idzie przez sprowadzenie do GSM-7: „środa” → „sroda”.
    booking: "zostala umowiona na sroda, 16 stycznia 2030 o 00:30. Do zobaczenia!",
    payment: "dnia sroda, 16 stycznia 2030 00:30 zostal przyjety.",
  },
] as const;

const TEMPLATES = {
  reminder: (appointmentDate: Date) => sms.sendAppointmentReminderSms({ ...BASE, appointmentDate }),
  booking: (appointmentDate: Date) => sms.sendBookingConfirmationSms({ ...BASE, appointmentDate }),
  payment: (appointmentDate: Date) =>
    sms.sendPaymentConfirmationSms({ ...BASE, amount: 50, currency: "PLN", appointmentDate }),
} as const;

const mockFetch = vi.fn();

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
  vi.stubEnv("TZ", "UTC");
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

describe("SMS transakcyjne: data i godzina w Europe/Warsaw przy procesie w UTC", () => {
  it.each(
    CASES.flatMap((c) =>
      (Object.keys(TEMPLATES) as (keyof typeof TEMPLATES)[]).map((t) => [t, c.label, c] as const)
    )
  )("%s: %s", async (template, _label, c) => {
    assertProcessInUtc();

    const result = await TEMPLATES[template](new Date(c.at));
    expect(result.success).toBe(true);

    expect(sentMessage()).toContain(c[template]);
  });
});
