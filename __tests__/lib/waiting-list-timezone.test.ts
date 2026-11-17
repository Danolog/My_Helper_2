/**
 * Data i godzina w powiadomieniu listy oczekujących (#234, #221): zawsze
 * w strefie `SMS_TIME_ZONE` (Europe/Warsaw), niezależnie od strefy procesu.
 *
 * Trzy miejsca w `src/lib/waiting-list.ts`:
 * - data i godzina zwolnionego terminu w treści powiadomienia (notifyWaitingList),
 * - termin w wierszu potwierdzenia akceptacji (acceptEarlierSlot).
 *
 * Test SAM wymusza strefę procesu UTC (`TZ=UTC`) i sprawdza to przed każdym
 * przypadkiem — inaczej na maszynie w strefie warszawskiej przeszedłby na pusto.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createChainMock } from "../api/helpers";

const h = vi.hoisted(() => ({
  push: vi.fn(),
  resolve: vi.fn(),
  tx: { select: vi.fn(), insert: vi.fn(), update: vi.fn() },
}));

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/server/system", () => ({
  resolveWaitingListToken: (...a: unknown[]) => h.resolve(...a),
}));
vi.mock("@/lib/server/repository", () => ({
  forSalon: (salonId: string) => ({
    salonId,
    raw: async (fn: (tx: unknown) => unknown) => fn(h.tx),
  }),
}));
vi.mock("@/lib/server/modules", async () => {
  const { resolveModules } = await vi.importActual<typeof import("@/lib/features")>("@/lib/features");
  return {
    getSalonModules: async () => resolveModules({ modules: { waitingList: true } }),
  };
});
vi.mock("@/lib/push", () => ({
  sendPushNotification: (...a: unknown[]) => h.push(...a),
}));
vi.mock("@/lib/deposit-guard", () => ({
  checkBookingWithoutDeposit: async () => ({ allowed: true }),
  DEPOSIT_CHECK_UNAVAILABLE_MESSAGE: "x",
  DEPOSIT_REQUIRED_MESSAGE: "y",
}));

import { acceptEarlierSlot, notifyWaitingList } from "@/lib/waiting-list";

const SALON = "salon-A";

/**
 * Chwile w UTC i oczekiwany tekst w Warszawie:
 * - lato (CEST, +2): 08:30 UTC → 10:30, środa 15 lipca,
 * - zima (CET, +1): 08:30 UTC → 09:30, czwartek 15 stycznia,
 * - tuż po północy UTC: 00:15 UTC → 01:15 tego samego dnia,
 * - granica doby: 22:30 UTC 15 lipca → w Warszawie czwartek 16 lipca, 00:30.
 */
const CASES = [
  { label: "lato", at: "2026-07-15T08:30:00Z", date: "15 lipca", time: "10:30", full: "15.07.2026, 10:30:00" },
  { label: "zima", at: "2026-01-15T08:30:00Z", date: "15 stycznia", time: "09:30", full: "15.01.2026, 09:30:00" },
  {
    label: "tuż po północy UTC",
    at: "2026-01-15T00:15:00Z",
    date: "15 stycznia",
    time: "01:15",
    full: "15.01.2026, 01:15:00",
  },
  {
    label: "granica doby (następny dzień w Warszawie)",
    at: "2026-07-15T22:30:00Z",
    date: "16 lipca",
    time: "00:30",
    full: "16.07.2026, 00:30:00",
  },
] as const;

/** Strażnik: proces liczy w UTC, inaczej test sprawdzałby strefę maszyny. */
function assertProcessInUtc() {
  const d = new Date("2026-07-15T08:30:00Z");
  expect(d.getHours(), "proces nie jest w UTC — test przeszedłby na pusto").toBe(8);
  expect(d.getTimezoneOffset()).toBe(0);
}

beforeEach(() => {
  vi.clearAllMocks();
  h.tx.select.mockReset();
  h.tx.insert.mockReset();
  h.tx.update.mockReset();
  h.tx.update.mockReturnValue(createChainMock([]));
  vi.stubEnv("TZ", "UTC");
  // Zwolniony termin i oferta w akceptacji muszą być w przyszłości względem „teraz”.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2025-12-01T00:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("notifyWaitingList: data i godzina w Europe/Warsaw przy procesie w UTC", () => {
  it.each(CASES)("$label", async (c) => {
    assertProcessInUtc();
    h.tx.select
      .mockReturnValueOnce(
        createChainMock([
          {
            entry: { id: "wl-A", salonId: SALON, clientId: "client-A" },
            client: { id: "client-A", firstName: "Jan", lastName: "K", email: "jan@example.com" },
          },
        ])
      )
      .mockReturnValueOnce(createChainMock([{ id: "user-A" }]));
    h.push.mockResolvedValue({ success: true, sent: 1, failed: 0 });

    const start = new Date(c.at);
    await notifyWaitingList({
      salonId: SALON,
      serviceId: null,
      employeeId: null,
      startTime: start,
      endTime: new Date(start.getTime() + 3_600_000),
      serviceName: "Strzyżenie",
      employeeName: "Anna Nowak",
      salonName: "Salon A",
    });

    expect(h.push).toHaveBeenCalledTimes(1);
    const msg = h.push.mock.calls[0]![1] as { body: string };
    expect(msg.body).toBe(`Salon A: Strzyżenie, ${c.date} o ${c.time}. Dotknij, aby przyjąć lub odrzucić.`);
  });
});

describe("acceptEarlierSlot: termin w wierszu potwierdzenia w Europe/Warsaw przy procesie w UTC", () => {
  it.each(CASES)("$label", async (c) => {
    assertProcessInUtc();
    const start = new Date(c.at);
    h.resolve.mockResolvedValue({ waitingListId: "wl-A", salonId: SALON });
    h.tx.select
      .mockReturnValueOnce(
        createChainMock([
          {
            id: "wl-A",
            salonId: SALON,
            clientId: "client-A",
            serviceId: null,
            preferredEmployeeId: null,
            offeredEmployeeId: "emp-A",
            existingAppointmentId: null,
            acceptToken: "tok-A",
            accepted: null,
            offeredStartTime: start,
            offeredEndTime: new Date(start.getTime() + 3_600_000),
          },
        ])
      )
      .mockReturnValueOnce(createChainMock([])); // kolizja: brak
    const inserted: Record<string, unknown>[] = [];
    h.tx.insert.mockImplementation(() => {
      const chain = createChainMock([{ id: "apt-new" }]);
      chain.values = vi.fn((v: Record<string, unknown>) => (inserted.push(v), chain));
      return chain;
    });

    const res = await acceptEarlierSlot("wl-A", "tok-A");

    expect(res.success).toBe(true);
    const confirmation = inserted.find((v) => v.type === "sms");
    expect(confirmation?.message).toBe(
      `Klient zaakceptowal wczesniejszy termin z listy oczekujacych. Wizyta apt-new przeniesiona na ${c.full}.`
    );
  });
});
