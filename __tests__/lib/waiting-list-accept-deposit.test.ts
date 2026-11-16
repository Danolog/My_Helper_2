/**
 * #63: acceptEarlierSlot (lista oczekujących) — NOWA wizyta usługi z
 * zadatkiem nie powstaje bez wpłaty; przeniesienie istniejącej wizyty tak.
 * Wymóg klienta liczony po clientId wpisu (ustawionym przez salon).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createChainMock } from "../api/helpers";

const h = vi.hoisted(() => ({ select: vi.fn(), insert: vi.fn(), update: vi.fn(), calc: vi.fn() }));

vi.mock("@/lib/db", () => ({
  db: {
    select: (...a: unknown[]) => h.select(...a),
    insert: (...a: unknown[]) => h.insert(...a),
    update: (...a: unknown[]) => h.update(...a),
  },
}));
// #193 P5a-1: salon z tokenu przez wyjście systemowe, zapytania przez
// forSalon(salonId).raw — mock deleguje do mocka `db`, kolejność bez zmian.
vi.mock("@/lib/server/system", () => ({
  resolveWaitingListToken: async (token: string) =>
    token === "tok" ? { waitingListId: "wl-1", salonId: "salon-1" } : null,
}));
vi.mock("@/lib/server/repository", async () => {
  const { db } = await import("@/lib/db");
  return {
    forSalon: (salonId: string) => ({ salonId, raw: (fn: (tx: unknown) => unknown) => fn(db) }),
  };
});
vi.mock("@/lib/push", () => ({ sendPushNotification: vi.fn() }));
vi.mock("@/lib/sms", async (importOriginal) => ({
  SMS_TIME_ZONE: (await importOriginal<typeof import("@/lib/sms")>()).SMS_TIME_ZONE,
  sendSms: vi.fn(),
}));
vi.mock("@/lib/deposit-calculation", () => ({ calculateExpectedDeposit: (...a: unknown[]) => h.calc(...a) }));

import { acceptEarlierSlot } from "@/lib/waiting-list";

const FUTURE_START = new Date(Date.now() + 2 * 86400000);
const FUTURE_END = new Date(FUTURE_START.getTime() + 3600000);

function entry(extra: Record<string, unknown> = {}) {
  return {
    id: "wl-1",
    salonId: "salon-1",
    clientId: "client-1",
    serviceId: "service-1",
    preferredEmployeeId: null,
    // #168 pkt 4: oferta zawsze z pracownikiem (bez niego jest nieważna)
    offeredEmployeeId: "e-1",
    existingAppointmentId: null,
    acceptToken: "tok",
    accepted: null,
    offeredStartTime: FUTURE_START,
    offeredEndTime: FUTURE_END,
    ...extra,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.select.mockReset();
  h.insert.mockReset();
  h.update.mockReset();
  h.select.mockReturnValue(createChainMock([])); // kolizje: termin wolny
  h.insert.mockReturnValue(createChainMock([{ id: "apt-new" }]));
  h.update.mockReturnValue(createChainMock([]));
});

describe("acceptEarlierSlot — zadatek (#63)", () => {
  it("nowa wizyta usługi z zadatkiem → odmowa, nic nie zapisane, wpis nierozstrzygnięty", async () => {
    h.select.mockReturnValueOnce(createChainMock([entry()]));
    h.calc.mockResolvedValue({ ok: true, required: true, amount: 40, serviceName: "X" });

    const res = await acceptEarlierSlot("wl-1", "tok");

    expect(res.success).toBe(false);
    expect(res.message).toMatch(/zadatku/);
    expect(h.insert).not.toHaveBeenCalled();
    expect(h.update).not.toHaveBeenCalled(); // accepted zostaje null
    expect(h.calc).toHaveBeenCalledWith(
      expect.objectContaining({ salonId: "salon-1", serviceId: "service-1", clientId: "client-1" })
    );
  });

  it("błąd wyliczenia → odmowa z prośbą o ponowienie, nic nie zapisane", async () => {
    h.select.mockReturnValueOnce(createChainMock([entry()]));
    h.calc.mockRejectedValue(new Error("db down"));

    const res = await acceptEarlierSlot("wl-1", "tok");

    expect(res.success).toBe(false);
    expect(res.message).toMatch(/Spróbuj ponownie/);
    expect(h.insert).not.toHaveBeenCalled();
    expect(h.update).not.toHaveBeenCalled();
  });

  it("istniejąca wizyta anulowana → nowa wizyta też podlega regule", async () => {
    h.select
      .mockReturnValueOnce(createChainMock([entry({ existingAppointmentId: "apt-old" })]))
      .mockReturnValueOnce(createChainMock([])) // kolizje
      .mockReturnValueOnce(createChainMock([{ id: "apt-old", status: "cancelled", startTime: FUTURE_START }]));
    h.calc.mockResolvedValue({ ok: true, required: true, amount: 40, serviceName: "X" });

    const res = await acceptEarlierSlot("wl-1", "tok");

    expect(res.success).toBe(false);
    expect(h.insert).not.toHaveBeenCalled();
  });

  it("przeniesienie istniejącej (aktywnej) wizyty → bez sprawdzania zadatku, sukces", async () => {
    h.select
      .mockReturnValueOnce(createChainMock([entry({ existingAppointmentId: "apt-old" })]))
      .mockReturnValueOnce(createChainMock([])) // kolizje
      .mockReturnValueOnce(
        createChainMock([{ id: "apt-old", status: "scheduled", startTime: new Date(), notes: null, employeeId: "e-1" }])
      );

    const res = await acceptEarlierSlot("wl-1", "tok");

    expect(res.success).toBe(true);
    expect(h.calc).not.toHaveBeenCalled();
  });

  it("usługa bez zadatku → nowa wizyta powstaje", async () => {
    h.select.mockReturnValueOnce(createChainMock([entry()]));
    h.calc.mockResolvedValue({ ok: true, required: false, amount: 0, serviceName: "X" });

    const res = await acceptEarlierSlot("wl-1", "tok");

    expect(res.success).toBe(true);
    expect(h.insert).toHaveBeenCalled();
  });

  it("wpis bez usługi → bez zadatku do sprawdzenia, nowa wizyta powstaje", async () => {
    h.select.mockReturnValueOnce(createChainMock([entry({ serviceId: null })]));
    const res = await acceptEarlierSlot("wl-1", "tok");
    expect(res.success).toBe(true);
    expect(h.calc).not.toHaveBeenCalled();
  });
});
