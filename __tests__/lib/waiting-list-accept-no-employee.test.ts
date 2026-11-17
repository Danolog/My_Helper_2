/**
 * #168 pkt 4 (decyzja Olivera, wariant A): acceptEarlierSlot z ofertą bez
 * `offeredEmployeeId` (pracownik usunięty po wysłaniu oferty, FK ON DELETE
 * SET NULL) → odmowa „Proponowany termin nie jest juz dostepny”. Żadna wizyta
 * nie powstaje ani się nie zmienia, wpis bez zmian (accepted = null), bez
 * wyjątku (wcześniej INSERT z employee_id = null → 23502 → 500) i bez
 * przejścia na `preferredEmployeeId`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { acceptEarlierSlot } from "@/lib/waiting-list";
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

const START = new Date(Date.now() + 2 * 86_400_000);
const END = new Date(START.getTime() + 3_600_000);
const REFUSAL = { success: false, message: "Proponowany termin nie jest juz dostepny" };

function entry(extra: Record<string, unknown> = {}) {
  return {
    id: "wl-1",
    salonId: "salon-1",
    clientId: "client-1",
    serviceId: "service-1",
    preferredEmployeeId: null,
    offeredEmployeeId: null,
    existingAppointmentId: null,
    acceptToken: "tok",
    accepted: null,
    offeredStartTime: START,
    offeredEndTime: END,
    ...extra,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.select.mockReset();
  h.insert.mockReset();
  h.update.mockReset();
  h.select.mockReturnValue(createChainMock([]));
  h.insert.mockReturnValue(createChainMock([{ id: "apt-new" }]));
  h.update.mockReturnValue(createChainMock([]));
  h.calc.mockResolvedValue({ ok: true, required: false, amount: 0, serviceName: "X" });
});

describe("acceptEarlierSlot — oferta bez pracownika (#168 pkt 4, wariant A)", () => {
  it.each([
    ["oba pola puste", {}],
    ["offered puste, preferred ustawione (bez przejścia na preferred)", { preferredEmployeeId: "e-pref" }],
    [
      "przesunięcie istniejącej wizyty z pustym offered",
      { existingAppointmentId: "apt-old", preferredEmployeeId: "e-pref" },
    ],
  ])("%s → odmowa bez wyjątku, bez zapisu, wpis bez zmian", async (_n, extra) => {
    h.select.mockReturnValueOnce(createChainMock([entry(extra)]));

    const res = await acceptEarlierSlot("wl-1", "tok");

    expect(res).toEqual(REFUSAL);
    expect(h.select).toHaveBeenCalledTimes(1); // tylko wpis: bez kolizji, bez odczytu wizyty
    expect(h.insert).not.toHaveBeenCalled();
    expect(h.update).not.toHaveBeenCalled(); // ani wizyta, ani accepted na wpisie
    expect(h.calc).not.toHaveBeenCalled();
  });

  it("kontrast: offered ustawione → nowa wizyta u TEGO pracownika (nie preferred)", async () => {
    h.select.mockReturnValueOnce(createChainMock([entry({ offeredEmployeeId: "e-off", preferredEmployeeId: "e-pref" })]));
    const res = await acceptEarlierSlot("wl-1", "tok");

    expect(res.success).toBe(true);
    const values = (h.insert.mock.results[0]!.value as { values: ReturnType<typeof vi.fn> }).values;
    expect(values.mock.calls[0]![0]).toMatchObject({ employeeId: "e-off" });
  });

  it("kontrast: przesunięcie z offered ustawionym → wizyta przeniesiona do pracownika oferty", async () => {
    h.select
      .mockReturnValueOnce(createChainMock([entry({ offeredEmployeeId: "e-off", existingAppointmentId: "apt-old" })]))
      .mockReturnValueOnce(createChainMock([])) // kolizje
      .mockReturnValueOnce(
        createChainMock([{ id: "apt-old", status: "scheduled", startTime: START, notes: null, employeeId: "e-old" }])
      );
    const res = await acceptEarlierSlot("wl-1", "tok");

    expect(res.success).toBe(true);
    const set = (h.update.mock.results[0]!.value as { set: ReturnType<typeof vi.fn> }).set;
    expect(set.mock.calls[0]![0]).toMatchObject({ employeeId: "e-off" });
  });

  it("wpis z innym błędem (brak terminu) ma pierwszeństwo przed brakiem pracownika", async () => {
    h.select.mockReturnValueOnce(createChainMock([entry({ offeredStartTime: null })]));
    expect(await acceptEarlierSlot("wl-1", "tok")).toEqual({
      success: false,
      message: "Brak danych o proponowanym terminie",
    });
  });
});
