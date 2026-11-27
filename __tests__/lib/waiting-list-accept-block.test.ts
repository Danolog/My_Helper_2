/**
 * acceptEarlierSlot (lista oczekujących) — klient z blokadą rezerwacji online:
 * NOWA wizyta nie powstaje (kod ONLINE_BOOKING_UNAVAILABLE, trasa 403),
 * przeniesienie istniejącej wizyty przechodzi. Blokadę sprawdza ta sama
 * reguła co portal: findOnlineBookingBlock z kartą wpisu (karta wpisu albo
 * inna karta salonu z tym samym e-mailem lub numerem). Samo zapytanie ma
 * własne testy (online-booking-block, pg); tu wynik jest podstawiony.
 *
 * Kolejność odczytów (select) przy nowej wizycie: [wpis], [kolizje].
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createChainMock } from "../api/helpers";

const h = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  calc: vi.fn(),
  block: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: (...a: unknown[]) => h.select(...a),
    insert: (...a: unknown[]) => h.insert(...a),
    update: (...a: unknown[]) => h.update(...a),
  },
}));
// Salon z tokenu przez wyjście systemowe, zapytania przez forSalon(salonId).raw
// — mock deleguje do mocka `db`, kolejność bez zmian.
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
vi.mock("@/lib/online-booking-block", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/online-booking-block")>()),
  findOnlineBookingBlock: (...a: unknown[]) => h.block(...a),
}));
vi.mock("@/lib/push", () => ({ sendPushNotification: vi.fn() }));
vi.mock("@/lib/sms", async (importOriginal) => ({
  SMS_TIME_ZONE: (await importOriginal<typeof import("@/lib/sms")>()).SMS_TIME_ZONE,
  sendSms: vi.fn(),
}));
vi.mock("@/lib/deposit-calculation", () => ({ calculateExpectedDeposit: (...a: unknown[]) => h.calc(...a) }));
vi.mock("@/lib/server/modules", async () => {
  const { resolveModules } = await vi.importActual<typeof import("@/lib/features")>("@/lib/features");
  return { getSalonModules: async () => resolveModules({ modules: { waitingList: true } }) };
});
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { acceptEarlierSlot } from "@/lib/waiting-list";

const FUTURE_START = new Date(Date.now() + 2 * 86400000);
const FUTURE_END = new Date(FUTURE_START.getTime() + 3600000);

function entry(extra: Record<string, unknown> = {}) {
  return {
    id: "wl-1",
    salonId: "salon-1",
    clientId: "client-1",
    // Bez usługi: zadatek nie wchodzi w grę, wynik zależy tylko od blokady.
    serviceId: null,
    preferredEmployeeId: null,
    offeredEmployeeId: "e-1",
    existingAppointmentId: null,
    acceptToken: "tok",
    accepted: null,
    offeredStartTime: FUTURE_START,
    offeredEndTime: FUTURE_END,
    ...extra,
  };
}

/** Kolejne wyniki select. */
function selects(...results: unknown[][]) {
  for (const r of results) h.select.mockReturnValueOnce(createChainMock(r as never));
}

const blocked = (salonPhone: string | null) => ({ blocked: true, salonPhone, matchedBy: "card" });

beforeEach(() => {
  vi.clearAllMocks();
  h.select.mockReset();
  h.insert.mockReset();
  h.update.mockReset();
  h.block.mockReset();
  h.select.mockReturnValue(createChainMock([]));
  h.insert.mockReturnValue(createChainMock([{ id: "apt-new" }]));
  h.update.mockReturnValue(createChainMock([]));
  h.block.mockResolvedValue({ blocked: false });
});

describe("acceptEarlierSlot — blokada rezerwacji online klienta", () => {
  it("blokada, nowa wizyta → odmowa z kodem i komunikatem z telefonem salonu, nic nie zapisane", async () => {
    selects([entry()], []);
    h.block.mockResolvedValue(blocked("+48 91 000 00 00"));

    const res = await acceptEarlierSlot("wl-1", "tok");

    expect(res).toEqual({
      success: false,
      code: "ONLINE_BOOKING_UNAVAILABLE",
      message: "Rezerwacja online jest niedostępna. Zadzwoń do salonu: +48 91 000 00 00",
    });
    expect(h.insert).not.toHaveBeenCalled();
    expect(h.update).not.toHaveBeenCalled(); // wpis zostaje nierozstrzygnięty
  });

  it("sprawdzenie używa reguły tego samego klienta: salon wpisu, karta wpisu, bez sesji", async () => {
    selects([entry()], []);

    await acceptEarlierSlot("wl-1", "tok");

    expect(h.block).toHaveBeenCalledTimes(1);
    expect(h.block).toHaveBeenCalledWith({ salonId: "salon-1", sessionUser: null, clientId: "client-1" });
  });

  it("blokada, salon bez telefonu → komunikat ogólny", async () => {
    selects([entry()], []);
    h.block.mockResolvedValue(blocked(null));

    const res = await acceptEarlierSlot("wl-1", "tok");

    expect(res.code).toBe("ONLINE_BOOKING_UNAVAILABLE");
    expect(res.message).toBe("Rezerwacja online jest niedostępna. Skontaktuj się z salonem.");
  });

  it("blokada sprawdzana przed zadatkiem: usługa z zadatkiem i blokada → kod blokady, bez liczenia zadatku", async () => {
    selects([entry({ serviceId: "service-1" })], []);
    h.block.mockResolvedValue(blocked(null));

    const res = await acceptEarlierSlot("wl-1", "tok");

    expect(res.code).toBe("ONLINE_BOOKING_UNAVAILABLE");
    expect(h.calc).not.toHaveBeenCalled();
  });

  it("powiązana wizyta odwołana w trakcie + blokada innej karty tego klienta → odmowa nowej wizyty", async () => {
    selects(
      [entry({ existingAppointmentId: "apt-old" })],
      [], // kolizje
      [{ id: "apt-old", status: "cancelled", startTime: FUTURE_START }]
    );
    h.block.mockResolvedValue(blocked(null));

    const res = await acceptEarlierSlot("wl-1", "tok");

    expect(res.code).toBe("ONLINE_BOOKING_UNAVAILABLE");
    expect(h.block).toHaveBeenCalledWith({ salonId: "salon-1", sessionUser: null, clientId: "client-1" });
    expect(h.insert).not.toHaveBeenCalled();
  });

  it("przeniesienie istniejącej wizyty przy blokadzie → sukces, blokada nie jest sprawdzana", async () => {
    selects(
      [entry({ existingAppointmentId: "apt-old" })],
      [], // kolizje
      [{ id: "apt-old", status: "scheduled", startTime: new Date(FUTURE_START.getTime() + 86400000), notes: null }]
    );
    h.update.mockReturnValueOnce(createChainMock([{ id: "apt-old" }])); // zapis przeniesienia objął wizytę
    h.block.mockResolvedValue(blocked(null));

    const res = await acceptEarlierSlot("wl-1", "tok");

    expect(res.success).toBe(true);
    expect(res.appointmentId).toBe("apt-old");
    expect(res.code).toBeUndefined();
    expect(h.block).not.toHaveBeenCalled();
    expect(h.insert).toHaveBeenCalledTimes(1); // tylko wpis historii powiadomień
  });

  it("bez blokady → nowa wizyta powstaje", async () => {
    selects([entry()], []);

    const res = await acceptEarlierSlot("wl-1", "tok");

    expect(res.success).toBe(true);
    expect(res.appointmentId).toBe("apt-new");
    expect(res.code).toBeUndefined();
  });

  it("błąd sprawdzenia blokady → wyjątek, nowa wizyta nie powstaje", async () => {
    selects([entry()], []);
    h.block.mockRejectedValue(new Error("db down"));

    await expect(acceptEarlierSlot("wl-1", "tok")).rejects.toThrow("db down");
    expect(h.insert).not.toHaveBeenCalled();
  });
});
