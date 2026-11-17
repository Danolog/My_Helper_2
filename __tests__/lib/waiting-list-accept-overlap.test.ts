/**
 * #165: acceptEarlierSlot (lista oczekujących) sprawdza kolizję tą samą
 * definicją co zapis wizyty — przedział półotwarty [start, end), wizyty
 * nieanulowane, przenoszona wizyta klienta wykluczona. Wcześniej wynik
 * zapytania był ignorowany („For MVP we trust the slot was freed”).
 *
 * Wiersze-fikstury przechodzą przez warunek WHERE funkcji (prawdziwy drizzle,
 * `sqlMatches`), więc wynik zależy od znaczenia predykatu.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { deadlock } from "../api/deadlock-fixture";
import { createChainMock } from "../api/helpers";
import { sqlMatches } from "../api/sql-predicate";

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
// Moduł listy oczekujących włączony w salonie (przełącznik: osobny plik testów).
vi.mock("@/lib/server/modules", async () => {
  const { resolveModules } = await vi.importActual<typeof import("@/lib/features")>("@/lib/features");
  return { getSalonModules: async () => resolveModules({ modules: { waitingList: true } }) };
});

import { acceptEarlierSlot } from "@/lib/waiting-list";

const MIN = 60_000;
const START = new Date(Date.now() + 2 * 86_400_000);
START.setUTCSeconds(0, 0);
const END = new Date(START.getTime() + 60 * MIN);
const EMPLOYEE = "e-1";
const SALON = "salon-1";

function entry(extra: Record<string, unknown> = {}) {
  return {
    id: "wl-1",
    salonId: SALON,
    clientId: "client-1",
    serviceId: "service-1",
    preferredEmployeeId: null,
    offeredEmployeeId: EMPLOYEE,
    existingAppointmentId: null,
    acceptToken: "tok",
    accepted: null,
    offeredStartTime: START,
    offeredEndTime: END,
    ...extra,
  };
}

/** Wiersz `appointments` w nazwach kolumn bazy; czas względem START w minutach. */
function appt(fromMin: number, toMin: number, extra: Record<string, unknown> = {}) {
  return {
    id: "apt-other",
    salon_id: SALON,
    employee_id: EMPLOYEE,
    status: "scheduled",
    start_time: new Date(START.getTime() + fromMin * MIN),
    end_time: new Date(START.getTime() + toMin * MIN),
    ...extra,
  };
}

function filteringChain(rows: Record<string, unknown>[]) {
  const c = createChainMock([]);
  let where: unknown;
  c.where = vi.fn((w: unknown) => {
    where = w;
    return c;
  });
  c.then = (resolve: (v: unknown[]) => unknown) =>
    resolve(rows.filter((r) => sqlMatches(where as Parameters<typeof sqlMatches>[0], r)));
  return c;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.select.mockReset();
  h.insert.mockReset();
  h.update.mockReset();
  h.insert.mockReturnValue(createChainMock([{ id: "apt-new" }]));
  h.update.mockReturnValue(createChainMock([]));
  h.calc.mockResolvedValue({ ok: true, required: false, amount: 0, serviceName: "X" });
});

describe("acceptEarlierSlot — kolizja półotwarta (#165)", () => {
  it("nowa wizyta, termin zajęty (nakładanie o 1 min) → odmowa, nic nie zapisane, wpis bez zmian", async () => {
    h.select
      .mockReturnValueOnce(createChainMock([entry()]))
      .mockReturnValueOnce(filteringChain([appt(59, 120)]));

    const res = await acceptEarlierSlot("wl-1", "tok");

    expect(res).toEqual({ success: false, message: "Termin jest juz zajety" });
    expect(h.insert).not.toHaveBeenCalled();
    expect(h.update).not.toHaveBeenCalled(); // accepted zostaje null
  });

  it("nowa wizyta, wizyta na styku (koniec = START) → nowa wizyta powstaje", async () => {
    h.select
      .mockReturnValueOnce(createChainMock([entry()]))
      .mockReturnValueOnce(filteringChain([appt(-60, 0), appt(60, 120, { id: "apt-after" })]));

    const res = await acceptEarlierSlot("wl-1", "tok");

    expect(res.success).toBe(true);
    expect(h.insert).toHaveBeenCalled();
  });

  it("anulowana wizyta w tym terminie nie blokuje", async () => {
    h.select
      .mockReturnValueOnce(createChainMock([entry()]))
      .mockReturnValueOnce(filteringChain([appt(0, 60, { status: "cancelled" })]));

    const res = await acceptEarlierSlot("wl-1", "tok");

    expect(res.success).toBe(true);
  });

  it("wizyta innego pracownika nie blokuje", async () => {
    h.select
      .mockReturnValueOnce(createChainMock([entry()]))
      .mockReturnValueOnce(filteringChain([appt(0, 60, { employee_id: "e-2" })]));

    expect((await acceptEarlierSlot("wl-1", "tok")).success).toBe(true);
  });

  it("przeniesienie: wizyta klienta nie koliduje sama ze sobą → przeniesiona", async () => {
    const own = appt(30, 90, { id: "apt-old" });
    h.select
      .mockReturnValueOnce(createChainMock([entry({ existingAppointmentId: "apt-old" })]))
      .mockReturnValueOnce(filteringChain([own]))
      .mockReturnValueOnce(
        createChainMock([{ id: "apt-old", status: "scheduled", startTime: own.start_time, notes: null, employeeId: EMPLOYEE }])
      );

    const res = await acceptEarlierSlot("wl-1", "tok");

    expect(res.success).toBe(true);
    expect(res.appointmentId).toBe("apt-old");
    expect(h.update).toHaveBeenCalled();
  });

  it("przeniesienie: termin zajęty przez inną wizytę → odmowa, wizyta i wpis bez zmian", async () => {
    h.select
      .mockReturnValueOnce(createChainMock([entry({ existingAppointmentId: "apt-old" })]))
      .mockReturnValueOnce(filteringChain([appt(180, 240, { id: "apt-old" }), appt(0, 30)]));

    const res = await acceptEarlierSlot("wl-1", "tok");

    expect(res).toEqual({ success: false, message: "Termin jest juz zajety" });
    expect(h.update).not.toHaveBeenCalled();
    expect(h.insert).not.toHaveBeenCalled();
  });

  it("wizyta innego salonu nie blokuje (filtr salonu)", async () => {
    h.select
      .mockReturnValueOnce(createChainMock([entry()]))
      .mockReturnValueOnce(filteringChain([appt(0, 60, { salon_id: "salon-2" })]));

    expect((await acceptEarlierSlot("wl-1", "tok")).success).toBe(true);
  });

  it.each([
    ["pusty (koniec = początek)", START],
    ["odwrócony (koniec przed początkiem)", new Date(START.getTime() - 30 * MIN)],
  ])("proponowany termin %s → odmowa, bez zapytania o kolizje i bez zapisu", async (_n, end) => {
    h.select.mockReturnValueOnce(createChainMock([entry({ offeredEndTime: end })]));

    const res = await acceptEarlierSlot("wl-1", "tok");

    expect(res).toEqual({ success: false, message: "Nieprawidlowy proponowany termin" });
    expect(h.select).toHaveBeenCalledTimes(1); // tylko wpis
    expect(h.insert).not.toHaveBeenCalled();
    expect(h.update).not.toHaveBeenCalled();
  });

  it("kolizja sprawdzana przed zadatkiem: zajęty termin → odmowa kolizji, zadatek nie liczony", async () => {
    h.calc.mockResolvedValue({ ok: true, required: true, amount: 40, serviceName: "X" });
    h.select
      .mockReturnValueOnce(createChainMock([entry()]))
      .mockReturnValueOnce(filteringChain([appt(0, 60)]));

    const res = await acceptEarlierSlot("wl-1", "tok");

    expect(res.message).toBe("Termin jest juz zajety");
    expect(h.calc).not.toHaveBeenCalled();
  });
});

describe("acceptEarlierSlot — wyścig odrzucony przez bazę (#171)", () => {
  /** Zapis wizyty odrzucony przez bazę (kształt DrizzleQueryError: błąd sterownika w cause). */
  function rejecting(cause: Record<string, unknown>) {
    const c = createChainMock([]);
    c.then = (_res: unknown, reject: (e: unknown) => unknown) =>
      reject(Object.assign(new Error("Failed query"), { cause: Object.assign(new Error("db"), cause) }));
    return c;
  }
  const OVERLAP = { code: "23P01", constraint_name: "appointments_no_overlap" };

  it("nowa wizyta: 23P01 → odmowa jak przy kolizji, wpis nierozstrzygnięty", async () => {
    h.select.mockReturnValueOnce(createChainMock([entry()])).mockReturnValueOnce(filteringChain([]));
    h.insert.mockReturnValue(rejecting(OVERLAP));

    const res = await acceptEarlierSlot("wl-1", "tok");

    expect(res).toEqual({ success: false, message: "Termin jest juz zajety" });
    expect(h.insert).toHaveBeenCalledTimes(1);
    expect(h.update).not.toHaveBeenCalled(); // accepted zostaje null
  });

  it("przeniesienie: 23P01 przy UPDATE wizyty → odmowa, wpis nierozstrzygnięty", async () => {
    h.select
      .mockReturnValueOnce(createChainMock([entry({ existingAppointmentId: "apt-old" })]))
      .mockReturnValueOnce(filteringChain([]))
      .mockReturnValueOnce(
        createChainMock([{ id: "apt-old", status: "scheduled", startTime: START, notes: null, employeeId: EMPLOYEE }])
      );
    h.update.mockReturnValueOnce(rejecting(OVERLAP));

    const res = await acceptEarlierSlot("wl-1", "tok");

    expect(res).toEqual({ success: false, message: "Termin jest juz zajety" });
    expect(h.update).toHaveBeenCalledTimes(1); // tylko próba przeniesienia, wpis bez zmian
  });

  it("istniejąca wizyta anulowana, więc nowa: 23P01 przy INSERT → odmowa, wpis nierozstrzygnięty", async () => {
    h.select
      .mockReturnValueOnce(createChainMock([entry({ existingAppointmentId: "apt-old" })]))
      .mockReturnValueOnce(filteringChain([]))
      .mockReturnValueOnce(
        createChainMock([{ id: "apt-old", status: "cancelled", startTime: START, notes: null, employeeId: EMPLOYEE }])
      );
    h.insert.mockReturnValue(rejecting(OVERLAP));

    const res = await acceptEarlierSlot("wl-1", "tok");

    expect(res).toEqual({ success: false, message: "Termin jest juz zajety" });
    expect(h.insert).toHaveBeenCalledTimes(1); // gałąź „anulowana → nowa wizyta”
    expect(h.update).not.toHaveBeenCalled(); // anulowanej nie ruszamy, accepted zostaje null
  });

  it("inny błąd zapisu nie jest połykany (rzuca dalej)", async () => {
    h.select.mockReturnValueOnce(createChainMock([entry()])).mockReturnValueOnce(filteringChain([]));
    h.insert.mockReturnValue(rejecting({ code: "23514", constraint_name: "appointments_end_after_start" }));

    await expect(acceptEarlierSlot("wl-1", "tok")).rejects.toThrow("Failed query");
    expect(h.update).not.toHaveBeenCalled();
  });

  it("nowa wizyta: 40P01 przy sprawdzaniu EXCLUDE (zakleszczenie, db71a43) → odmowa jak przy kolizji", async () => {
    h.select.mockReturnValueOnce(createChainMock([entry()])).mockReturnValueOnce(filteringChain([]));
    h.insert.mockReturnValue(rejecting(deadlock()));

    expect(await acceptEarlierSlot("wl-1", "tok")).toEqual({ success: false, message: "Termin jest juz zajety" });
    expect(h.update).not.toHaveBeenCalled(); // accepted zostaje null
  });

  it("przeniesienie: 40P01 przy sprawdzaniu EXCLUDE → odmowa, wpis nierozstrzygnięty", async () => {
    h.select
      .mockReturnValueOnce(createChainMock([entry({ existingAppointmentId: "apt-old" })]))
      .mockReturnValueOnce(filteringChain([]))
      .mockReturnValueOnce(
        createChainMock([{ id: "apt-old", status: "scheduled", startTime: START, notes: null, employeeId: EMPLOYEE }])
      );
    h.update.mockReturnValueOnce(rejecting(deadlock()));

    expect(await acceptEarlierSlot("wl-1", "tok")).toEqual({ success: false, message: "Termin jest juz zajety" });
    expect(h.update).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["40P01 bez kontekstu", "40P01", deadlock(null)],
    ["40001 z kontekstem EXCLUDE", "40001", { ...deadlock(), code: "40001" }],
  ])("%s → rzuca dalej (500 w trasie), w logu kod błędu", async (_n, code, cause) => {
    const { logger } = await import("@/lib/logger");
    const spy = vi.spyOn(logger, "error");
    h.select.mockReturnValueOnce(createChainMock([entry()])).mockReturnValueOnce(filteringChain([]));
    h.insert.mockReturnValue(rejecting(cause));

    await expect(acceptEarlierSlot("wl-1", "tok")).rejects.toThrow("Failed query");
    expect(spy).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ code, waitingListId: "wl-1" }));
    expect(h.update).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
