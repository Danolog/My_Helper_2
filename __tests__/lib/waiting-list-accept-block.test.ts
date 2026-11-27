/**
 * acceptEarlierSlot (lista oczekujących) — karta klienta z blokadą rezerwacji
 * online: NOWA wizyta nie powstaje (kod ONLINE_BOOKING_UNAVAILABLE, trasa 403),
 * przeniesienie istniejącej wizyty przechodzi. Odczyt blokady przez bramę
 * salonu z jawnym warunkiem id karty i salonu (renderowany dialektem Postgresa).
 *
 * Kolejność odczytów (select) przy nowej wizycie: [wpis], [kolizje], [karta],
 * a przy blokadzie dodatkowo [telefon salonu].
 */
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createChainMock } from "../api/helpers";
import type { SQL } from "drizzle-orm";

const h = vi.hoisted(() => ({ select: vi.fn(), insert: vi.fn(), update: vi.fn(), calc: vi.fn() }));

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

const dialect = new PgDialect();
const FUTURE_START = new Date(Date.now() + 2 * 86400000);
const FUTURE_END = new Date(FUTURE_START.getTime() + 3600000);
const BLOCKED_AT = new Date("2026-11-20T09:00:00.000Z");

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

type Chain = ReturnType<typeof createChainMock>;

/** Kolejne wyniki select; zwraca łańcuchy, żeby sprawdzić ich `where`. */
function selects(...results: unknown[][]): Chain[] {
  const chains = results.map((r) => createChainMock(r as never));
  for (const c of chains) h.select.mockReturnValueOnce(c);
  return chains;
}

function renderedWhere(chain: Chain) {
  const where = chain.where as ReturnType<typeof vi.fn>;
  return dialect.sqlToQuery(where.mock.calls[0]![0] as SQL);
}

beforeEach(() => {
  vi.clearAllMocks();
  h.select.mockReset();
  h.insert.mockReset();
  h.update.mockReset();
  h.select.mockReturnValue(createChainMock([]));
  h.insert.mockReturnValue(createChainMock([{ id: "apt-new" }]));
  h.update.mockReturnValue(createChainMock([]));
});

describe("acceptEarlierSlot — blokada rezerwacji online karty klienta", () => {
  it("karta z blokadą, nowa wizyta → odmowa z kodem i komunikatem z telefonem salonu, nic nie zapisane", async () => {
    const [, , card] = selects([entry()], [], [{ blockedAt: BLOCKED_AT }], [{ phone: "+48 91 000 00 00" }]);

    const res = await acceptEarlierSlot("wl-1", "tok");

    expect(res).toEqual({
      success: false,
      code: "ONLINE_BOOKING_UNAVAILABLE",
      message: "Rezerwacja online jest niedostępna. Zadzwoń do salonu: +48 91 000 00 00",
    });
    expect(h.insert).not.toHaveBeenCalled();
    expect(h.update).not.toHaveBeenCalled(); // wpis zostaje nierozstrzygnięty
    const where = renderedWhere(card!);
    expect(where.sql).toBe('("clients"."id" = $1 and "clients"."salon_id" = $2)');
    expect(where.params).toEqual(["client-1", "salon-1"]);
  });

  it("karta z blokadą, salon bez telefonu → komunikat ogólny", async () => {
    selects([entry()], [], [{ blockedAt: BLOCKED_AT }], [{ phone: null }]);

    const res = await acceptEarlierSlot("wl-1", "tok");

    expect(res.code).toBe("ONLINE_BOOKING_UNAVAILABLE");
    expect(res.message).toBe("Rezerwacja online jest niedostępna. Skontaktuj się z salonem.");
  });

  it("blokada sprawdzana przed zadatkiem: usługa z zadatkiem i blokada → kod blokady, bez liczenia zadatku", async () => {
    selects([entry({ serviceId: "service-1" })], [], [{ blockedAt: BLOCKED_AT }], [{ phone: null }]);

    const res = await acceptEarlierSlot("wl-1", "tok");

    expect(res.code).toBe("ONLINE_BOOKING_UNAVAILABLE");
    expect(h.calc).not.toHaveBeenCalled();
  });

  it("powiązana wizyta odwołana + blokada → odmowa nowej wizyty", async () => {
    selects(
      [entry({ existingAppointmentId: "apt-old" })],
      [], // kolizje
      [{ id: "apt-old", status: "cancelled", startTime: FUTURE_START }],
      [{ blockedAt: BLOCKED_AT }],
      [{ phone: null }]
    );

    const res = await acceptEarlierSlot("wl-1", "tok");

    expect(res.code).toBe("ONLINE_BOOKING_UNAVAILABLE");
    expect(h.insert).not.toHaveBeenCalled();
  });

  it("przeniesienie istniejącej wizyty przy blokadzie karty → sukces, blokada nie jest czytana", async () => {
    selects(
      [entry({ existingAppointmentId: "apt-old" })],
      [], // kolizje
      [{ id: "apt-old", status: "scheduled", startTime: new Date(FUTURE_START.getTime() + 86400000), notes: null }]
    );
    h.update.mockReturnValueOnce(createChainMock([{ id: "apt-old" }])); // zapis przeniesienia objął wizytę

    const res = await acceptEarlierSlot("wl-1", "tok");

    expect(res.success).toBe(true);
    expect(res.appointmentId).toBe("apt-old");
    expect(res.code).toBeUndefined();
    expect(h.select).toHaveBeenCalledTimes(3); // wpis, kolizje, powiązana wizyta — bez karty
    expect(h.insert).toHaveBeenCalledTimes(1); // tylko wpis historii powiadomień
  });

  it("karta bez blokady → nowa wizyta powstaje", async () => {
    selects([entry()], [], [{ blockedAt: null }]);

    const res = await acceptEarlierSlot("wl-1", "tok");

    expect(res.success).toBe(true);
    expect(res.appointmentId).toBe("apt-new");
    expect(res.code).toBeUndefined();
  });

  it("karta niewidoczna w salonie wpisu (np. blokada tylko w innym salonie) → nowa wizyta powstaje", async () => {
    const [, , card] = selects([entry()], [], []);

    const res = await acceptEarlierSlot("wl-1", "tok");

    expect(res.success).toBe(true);
    expect(res.appointmentId).toBe("apt-new");
    expect(renderedWhere(card!).params).toEqual(["client-1", "salon-1"]);
  });
});
