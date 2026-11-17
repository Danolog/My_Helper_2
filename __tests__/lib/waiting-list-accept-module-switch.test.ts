/**
 * Przełącznik modułu listy oczekujących przy odpowiedzi na ofertę terminu.
 *
 * - `acceptEarlierSlot`: moduł wyłączony w salonie z tokenu (albo błąd odczytu
 *   ustawień) → odmowa „Oferta nie jest już aktualna”, bez odczytu wpisu
 *   i bez żadnego zapisu (brak wizyty, wpis nierozstrzygnięty).
 * - `declineEarlierSlot`: bez przełącznika — odrzucenie zamyka wpis także przy
 *   wyłączonym module.
 *
 * Stan modułów czyta prawdziwy `getSalonModules` (jedno źródło reguły) przez
 * zamockowaną bramę `forSalon`; transakcja-atrapa rozpoznaje tabelę po
 * obiekcie schematu i zapisuje nazwę tabeli każdego odczytu i zapisu.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const state = {
    settingsJson: null as unknown,
    settingsFail: false,
    entry: null as Record<string, unknown> | null,
    reads: [] as string[],
    writes: [] as { op: "insert" | "update" | "delete"; table: string; set?: unknown }[],
  };

  function chain(rows: () => unknown[]): Record<string, unknown> {
    const c: Record<string, unknown> = {};
    for (const m of ["where", "limit", "returning", "values", "innerJoin", "orderBy"]) {
      c[m] = () => c;
    }
    c.then = (onOk: (v: unknown[]) => unknown, onErr?: (e: unknown) => unknown) => {
      let p: Promise<unknown[]>;
      try {
        p = Promise.resolve(rows());
      } catch (e) {
        p = Promise.reject(e);
      }
      return p.then(onOk, onErr);
    };
    return c;
  }

  return { state, chain };
});

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/server/system", () => ({
  resolveWaitingListToken: async (token: string) =>
    token === "tok-A" ? { waitingListId: "wl-A", salonId: "salon-A" } : null,
}));
vi.mock("@/lib/server/repository", async () => {
  const schema = await vi.importActual<typeof import("@/lib/schema")>("@/lib/schema");
  const s = h.state;
  const nameOf = (table: unknown): string =>
    table === schema.salons
      ? "salons"
      : table === schema.waitingList
        ? "waiting_list"
        : table === schema.appointments
          ? "appointments"
          : table === schema.notifications
            ? "notifications"
            : "other";
  const rowsFor = (name: string): unknown[] => {
    if (name === "salons") {
      if (s.settingsFail) throw new Error("settings read failed");
      return [{ settingsJson: s.settingsJson }];
    }
    if (name === "waiting_list") return s.entry ? [s.entry] : [];
    return [];
  };
  const tx = {
    select: () => ({
      from: (table: unknown) => {
        const name = nameOf(table);
        s.reads.push(name);
        return h.chain(() => rowsFor(name));
      },
    }),
    insert: (table: unknown) => {
      s.writes.push({ op: "insert", table: nameOf(table) });
      return h.chain(() => [{ id: "apt-new" }]);
    },
    update: (table: unknown) => {
      const w: { op: "update"; table: string; set?: unknown } = { op: "update", table: nameOf(table) };
      s.writes.push(w);
      const c = h.chain(() => []);
      c.set = (v: unknown) => {
        w.set = v;
        return c;
      };
      return c;
    },
    delete: (table: unknown) => {
      s.writes.push({ op: "delete", table: nameOf(table) });
      return h.chain(() => []);
    },
  };
  return {
    forSalon: (salonId: string) => ({
      salonId,
      raw: async (fn: (t: unknown) => unknown) => fn(tx),
    }),
  };
});
vi.mock("@/lib/push", () => ({ sendPushNotification: vi.fn() }));
vi.mock("@/lib/deposit-guard", () => ({
  checkBookingWithoutDeposit: async () => ({ allowed: true }),
  DEPOSIT_CHECK_UNAVAILABLE_MESSAGE: "x",
  DEPOSIT_REQUIRED_MESSAGE: "y",
}));

import { acceptEarlierSlot, declineEarlierSlot } from "@/lib/waiting-list";

const START = new Date(Date.now() + 2 * 86_400_000);
START.setUTCSeconds(0, 0);
const END = new Date(START.getTime() + 60 * 60_000);
const OFFER_NOT_CURRENT = "Oferta nie jest już aktualna";

function pendingEntry(): Record<string, unknown> {
  return {
    id: "wl-A",
    salonId: "salon-A",
    clientId: "client-A",
    serviceId: null,
    preferredEmployeeId: null,
    offeredEmployeeId: "emp-A",
    existingAppointmentId: null,
    acceptToken: "tok-A",
    accepted: null,
    notifiedAt: new Date(),
    offeredStartTime: START,
    offeredEndTime: END,
  };
}

beforeEach(() => {
  h.state.settingsJson = null;
  h.state.settingsFail = false;
  h.state.entry = pendingEntry();
  h.state.reads = [];
  h.state.writes = [];
});

describe("acceptEarlierSlot: przełącznik modułu listy oczekujących", () => {
  it("moduł wyłączony → odmowa, bez odczytu wpisu i bez zapisów", async () => {
    h.state.settingsJson = { modules: { waitingList: false } };

    const res = await acceptEarlierSlot("wl-A", "tok-A");

    expect(res).toEqual({ success: false, message: OFFER_NOT_CURRENT });
    expect(h.state.reads).toEqual(["salons"]);
    expect(h.state.writes).toEqual([]);
  });

  it("brak ustawień modułów (stan domyślny) → odmowa, bez odczytu wpisu i bez zapisów", async () => {
    h.state.settingsJson = null;

    const res = await acceptEarlierSlot("wl-A", "tok-A");

    expect(res).toEqual({ success: false, message: OFFER_NOT_CURRENT });
    expect(h.state.reads).toEqual(["salons"]);
    expect(h.state.writes).toEqual([]);
  });

  it("błąd odczytu ustawień → odmowa, bez odczytu wpisu i bez zapisów", async () => {
    h.state.settingsFail = true;

    const res = await acceptEarlierSlot("wl-A", "tok-A");

    expect(res).toEqual({ success: false, message: OFFER_NOT_CURRENT });
    expect(h.state.reads).toEqual(["salons"]);
    expect(h.state.writes).toEqual([]);
  });

  it("moduł włączony → wpis odczytany, wizyta utworzona, wpis zaakceptowany", async () => {
    h.state.settingsJson = { modules: { waitingList: true } };

    const res = await acceptEarlierSlot("wl-A", "tok-A");

    expect(res).toMatchObject({ success: true, appointmentId: "apt-new" });
    expect(h.state.reads[0]).toBe("salons");
    expect(h.state.reads).toContain("waiting_list");
    expect(h.state.writes).toContainEqual({ op: "insert", table: "appointments" });
    expect(h.state.writes).toContainEqual({ op: "update", table: "waiting_list", set: { accepted: true } });
  });

  it("nieprawidłowy token → odmowa tokenu, bez odczytu ustawień", async () => {
    h.state.settingsJson = { modules: { waitingList: false } };

    const res = await acceptEarlierSlot("wl-A", "nieznany");

    expect(res).toEqual({ success: false, message: "Nieprawidlowy token akceptacji" });
    expect(h.state.reads).toEqual([]);
    expect(h.state.writes).toEqual([]);
  });
});

describe("declineEarlierSlot: odrzucenie działa niezależnie od modułu", () => {
  it("moduł wyłączony → odrzucenie zamyka wpis (accepted = false)", async () => {
    h.state.settingsJson = { modules: { waitingList: false } };

    const res = await declineEarlierSlot("wl-A", "tok-A");

    expect(res).toEqual({ success: true, message: "Termin zostal odrzucony." });
    expect(h.state.writes).toEqual([{ op: "update", table: "waiting_list", set: { accepted: false } }]);
  });

  it("błąd odczytu ustawień → odrzucenie zamyka wpis", async () => {
    h.state.settingsFail = true;

    const res = await declineEarlierSlot("wl-A", "tok-A");

    expect(res).toEqual({ success: true, message: "Termin zostal odrzucony." });
    expect(h.state.writes).toEqual([{ op: "update", table: "waiting_list", set: { accepted: false } }]);
  });
});
