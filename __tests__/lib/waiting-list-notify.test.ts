/**
 * notifyWaitingList — push o zwolnionym terminie idzie na konto `user`
 * znalezione po e-mailu KLIENTA. Kierunek klient -> konto: konto zalozone na
 * cudzy adres (niezweryfikowane) nie moze dostac pusha z imieniem i nazwiskiem
 * klienta, salonem, usluga, pracownikiem i godzina.
 *
 * Mock bazy ewaluuje warunki eq() na fikstura kont, wiec test sprawdza
 * zachowanie (kto dostaje push), a nie tylko ksztalt zapytania.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

type Cond =
  | { kind: "eq"; col: string; val: unknown }
  | { kind: "and"; conds: Cond[] }
  | { kind: "other" };

vi.mock("drizzle-orm", () => ({
  eq: (col: string, val: unknown): Cond => ({ kind: "eq", col, val }),
  and: (...conds: Cond[]): Cond => ({ kind: "and", conds }),
  or: (): Cond => ({ kind: "other" }),
  not: (): Cond => ({ kind: "other" }),
  isNull: (): Cond => ({ kind: "other" }),
}));

vi.mock("@/lib/schema", () => {
  const table = (name: string) =>
    new Proxy({ __name: name } as Record<string, unknown>, {
      get: (t, col) => (col === "__name" ? t.__name : `${name}.${String(col)}`),
    });
  return {
    waitingList: table("waitingList"),
    clients: table("clients"),
    user: table("user"),
    appointments: table("appointments"),
    notifications: table("notifications"),
  };
});

const CLIENT_EMAIL = "osoba.b@example.com";

// Konta w bazie (tabela "user")
let users: Array<Record<string, unknown>> = [];

// Kontakt klienta wpisu (ustawiany per test)
let clientPhone: string | null = null;
let clientEmail: string | null = CLIENT_EMAIL;

// Wartości przekazane do db.update(...).set(...)
const updates: Array<Record<string, unknown>> = [];

// Wpisy zwracane przez odczyt listy (id; ten sam klient) — domyślnie jeden.
let entryIds: string[] = ["wl-1"];
// Liczba odczytów tabeli kont w przebiegu.
let userReads = 0;
// Zapis oznaczenia wpisu kończy się błędem.
let updateFails = false;

function entryRow(id = "wl-1") {
  return {
    entry: { id },
    client: {
      id: "client-b",
      firstName: "Barbara",
      lastName: "Bielska",
      phone: clientPhone,
      email: clientEmail,
    },
  };
}

/** Ewaluacja warunku na wierszu konta: kolumna "user.x" -> row.x. Warunki "other" nie dotycza tabeli user. */
function matches(row: Record<string, unknown>, cond: Cond | undefined): boolean {
  if (!cond) return true;
  if (cond.kind === "and") return cond.conds.every((c) => matches(row, c));
  if (cond.kind === "eq") {
    const key = cond.col.replace(/^user\./, "");
    return row[key] === cond.val;
  }
  return true;
}

function selectChain() {
  let tableName = "";
  let where: Cond | undefined;
  const c: Record<string, unknown> = {};
  c.from = (t: { __name: string }) => ((tableName = t.__name), c);
  c.innerJoin = () => c;
  c.where = (w: Cond) => ((where = w), c);
  c.limit = () => c;
  c.then = (resolve: (v: unknown[]) => unknown) => {
    if (tableName === "waitingList") {
      entryReads++;
      return resolve(entryIds.map((id) => entryRow(id)));
    }
    if (tableName === "user") {
      userReads++;
      return resolve(users.filter((u) => matches(u, where)).map((u) => ({ id: u.id })));
    }
    return resolve([]);
  };
  return c;
}

vi.mock("@/lib/db", () => ({
  db: {
    select: () => selectChain(),
    update: () => {
      const c: Record<string, unknown> = {};
      c.set = (values: Record<string, unknown>) => (updates.push(values), c);
      c.where = () => (updateFails ? Promise.reject(new Error("zapis odrzucony")) : Promise.resolve([]));
      return c;
    },
  },
}));

// #193 P5a-1: biblioteka idzie przez forSalon(params.salonId).raw — mock
// deleguje do mocka `db` powyżej, więc asercje zostają bez zmian.
vi.mock("@/lib/server/repository", async () => {
  const { db } = await import("@/lib/db");
  return {
    forSalon: (salonId: string) => ({ salonId, raw: (fn: (tx: unknown) => unknown) => fn(db) }),
  };
});
vi.mock("@/lib/server/system", () => ({ resolveWaitingListToken: vi.fn() }));

// Stan modułów salonu — domyślnie lista oczekujących włączona.
let waitingListModuleOn = true;
const mockGetSalonModules = vi.fn();
vi.mock("@/lib/server/modules", async () => {
  const { resolveModules } = await vi.importActual<typeof import("@/lib/features")>("@/lib/features");
  return {
    getSalonModules: async (salonId: string) => {
      mockGetSalonModules(salonId);
      return resolveModules({ modules: { waitingList: waitingListModuleOn } });
    },
  };
});
// Liczba odczytów listy wpisów.
let entryReads = 0;

const mockSendPush = vi.fn();
vi.mock("@/lib/push", () => ({
  sendPushNotification: (...args: unknown[]) => mockSendPush(...args),
}));
const mockSendSms = vi.fn();
vi.mock("@/lib/sms", async (importOriginal) => ({
  SMS_TIME_ZONE: (await importOriginal<typeof import("@/lib/sms")>()).SMS_TIME_ZONE,
  sendSms: (...args: unknown[]) => mockSendSms(...args),
}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { logger } from "@/lib/logger";
import { notifyWaitingList } from "@/lib/waiting-list";

const params = {
  salonId: "salon-1",
  serviceId: null,
  employeeId: null,
  startTime: new Date("2026-08-01T10:00:00Z"),
  endTime: new Date("2026-08-01T11:00:00Z"),
  serviceName: "Strzyzenie",
  employeeName: "Ewa Nowak",
  salonName: "Salon Testowy",
};

describe("notifyWaitingList — push tylko na konto ze zweryfikowanym e-mailem klienta", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updates.length = 0;
    clientPhone = null;
    clientEmail = CLIENT_EMAIL;
    mockSendPush.mockResolvedValue({ success: true });
    mockSendSms.mockResolvedValue({ success: true });
  });

  it("niezweryfikowane konto z e-mailem klienta NIE dostaje pusha (wpis nietknięty)", async () => {
    users = [{ id: "intruz", email: CLIENT_EMAIL, emailVerified: false }];

    const result = await notifyWaitingList(params);

    expect(mockSendPush).not.toHaveBeenCalled();
    expect(result.pushCount).toBe(0);
    expect(result.notified).toBe(0);
    expect(updates).toHaveLength(0);
  });

  it("zweryfikowane konto z e-mailem klienta dostaje push", async () => {
    users = [{ id: "wlasciciel", email: CLIENT_EMAIL, emailVerified: true }];

    const result = await notifyWaitingList(params);

    expect(mockSendPush).toHaveBeenCalledTimes(1);
    expect(mockSendPush.mock.calls[0]![0]).toBe("wlasciciel");
    expect(result.pushCount).toBe(1);
  });

  it("brak konta z tym e-mailem => brak pusha", async () => {
    users = [{ id: "inny", email: "ktos.inny@example.com", emailVerified: true }];

    await notifyWaitingList(params);

    expect(mockSendPush).not.toHaveBeenCalled();
  });
});

describe("notifyWaitingList — kanał SMS wstrzymany, wpis oznaczany po dostarczeniu (Refs #221)", () => {
  const VERIFIED = [{ id: "wlasciciel", email: CLIENT_EMAIL, emailVerified: true }];

  beforeEach(() => {
    vi.clearAllMocks();
    updates.length = 0;
    clientPhone = null;
    clientEmail = CLIENT_EMAIL;
    mockSendPush.mockResolvedValue({ success: true });
    mockSendSms.mockResolvedValue({ success: true });
  });

  it("(a) wpis z telefonem i kontem: sendSms 0 razy, smsCount 0", async () => {
    clientPhone = "+48512345678";
    users = VERIFIED;

    const result = await notifyWaitingList(params);

    expect(mockSendSms).not.toHaveBeenCalled();
    expect(result.smsCount).toBe(0);
    expect(result.pushCount).toBe(1);
  });

  it("(a) wpis tylko z telefonem (bez e-maila): sendSms 0 razy, wpis nietknięty, bez błędu", async () => {
    clientPhone = "+48512345678";
    clientEmail = null;
    users = VERIFIED;

    const result = await notifyWaitingList(params);

    expect(mockSendSms).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
    expect(result).toEqual({ notified: 0, smsCount: 0, pushCount: 0, errors: 0 });
  });

  it("(b) push dostarczony: pola oferty ustawione, notified +1", async () => {
    users = VERIFIED;
    const withEmployee = { ...params, employeeId: "emp-1" };

    const result = await notifyWaitingList(withEmployee);

    expect(updates).toHaveLength(1);
    const set = updates[0]!;
    expect(set.notifiedAt).toBeInstanceOf(Date);
    expect(set.acceptToken).toMatch(/^[0-9a-f]{64}$/);
    expect(set.offeredStartTime).toBe(withEmployee.startTime);
    expect(set.offeredEndTime).toBe(withEmployee.endTime);
    expect(set.offeredEmployeeId).toBe("emp-1");
    expect(set).toHaveProperty("existingAppointmentId", null);
    expect(result).toEqual({ notified: 1, smsCount: 0, pushCount: 1, errors: 0 });
  });

  it("(c) push niedostarczony (success: false): wpis nietknięty, notified i errors bez zmian", async () => {
    users = VERIFIED;
    mockSendPush.mockResolvedValue({ success: false, sent: 0, failed: 0, error: "No subscriptions" });

    const result = await notifyWaitingList(params);

    expect(mockSendPush).toHaveBeenCalledTimes(1);
    expect(updates).toHaveLength(0);
    expect(result).toEqual({ notified: 0, smsCount: 0, pushCount: 0, errors: 0 });
  });

  it("(c) push rzuca wyjątek: wpis nietknięty, notified i errors bez zmian", async () => {
    users = VERIFIED;
    mockSendPush.mockRejectedValue(new Error("push down"));

    const result = await notifyWaitingList(params);

    expect(updates).toHaveLength(0);
    expect(result).toEqual({ notified: 0, smsCount: 0, pushCount: 0, errors: 0 });
  });

  it("(c) brak konta: wpis nietknięty, notified i errors bez zmian", async () => {
    users = [];

    const result = await notifyWaitingList(params);

    expect(mockSendPush).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
    expect(result).toEqual({ notified: 0, smsCount: 0, pushCount: 0, errors: 0 });
  });
});

describe("notifyWaitingList — wyszukiwanie konta w przebiegu i nieudany zapis oznaczenia (#221)", () => {
  const VERIFIED = [{ id: "wlasciciel", email: CLIENT_EMAIL, emailVerified: true }];

  function reset() {
    vi.clearAllMocks();
    updates.length = 0;
    entryIds = ["wl-1"];
    userReads = 0;
    updateFails = false;
    clientPhone = null;
    clientEmail = CLIENT_EMAIL;
    mockSendPush.mockResolvedValue({ success: true });
  }
  beforeEach(reset);
  afterEach(reset);

  /** Wszystkie argumenty wywołań loggera jako tekst. */
  function loggedText(): string {
    const calls = Object.values(logger).flatMap((fn) => (fn as ReturnType<typeof vi.fn>).mock.calls);
    return JSON.stringify(calls);
  }

  it("dwa wpisy tego samego klienta: jeden odczyt konta w przebiegu, push do obu", async () => {
    entryIds = ["wl-1", "wl-2"];
    users = VERIFIED;

    const result = await notifyWaitingList(params);

    expect(userReads).toBe(1);
    expect(mockSendPush).toHaveBeenCalledTimes(2);
    expect(mockSendPush.mock.calls.map((c) => c[0])).toEqual(["wlasciciel", "wlasciciel"]);
    expect(result).toMatchObject({ notified: 2, pushCount: 2, errors: 0 });
  });

  it("brak konta w przebiegu 1, konto w przebiegu 2: następny przebieg czyta konto od nowa", async () => {
    users = [];
    const first = await notifyWaitingList(params);
    expect(first).toMatchObject({ notified: 0, pushCount: 0 });
    expect(userReads).toBe(1);

    users = VERIFIED;
    const second = await notifyWaitingList(params);

    expect(userReads).toBe(2);
    expect(mockSendPush).toHaveBeenCalledTimes(1);
    expect(second).toMatchObject({ notified: 1, pushCount: 1, errors: 0 });
  });

  it("push przyjęty, zapis oznaczenia nieudany: errors 1, notified 0, jedna próba zapisu; następny termin wysyła ponownie", async () => {
    users = VERIFIED;
    updateFails = true;

    const first = await notifyWaitingList(params);

    expect(first).toEqual({ notified: 0, smsCount: 0, pushCount: 1, errors: 1 });
    expect(updates).toHaveLength(1); // bez ponawiania zapisu

    // Wpis został oczekujący — przy następnym zwolnionym terminie znów pasuje.
    updateFails = false;
    updates.length = 0;
    const second = await notifyWaitingList(params);

    expect(mockSendPush).toHaveBeenCalledTimes(2);
    expect(second).toEqual({ notified: 1, smsCount: 0, pushCount: 1, errors: 0 });
    expect(updates).toHaveLength(1);
  });

  it("log nieudanego zapisu: id wpisu i klasa błędu; żaden log bez e-maila i danych klienta", async () => {
    users = VERIFIED;
    updateFails = true;

    await notifyWaitingList(params);

    expect(logger.error).toHaveBeenCalledWith(expect.any(String), { entryId: "wl-1", errorName: "Error" });
    const text = loggedText();
    expect(text).not.toContain(CLIENT_EMAIL);
    expect(text).not.toContain("Barbara");
    expect(text).not.toContain("Bielska");
  });
});

describe("notifyWaitingList — przełącznik modułu listy oczekujących salonu (#221)", () => {
  const VERIFIED = [{ id: "wlasciciel", email: CLIENT_EMAIL, emailVerified: true }];

  function reset() {
    vi.clearAllMocks();
    updates.length = 0;
    entryIds = ["wl-1"];
    entryReads = 0;
    userReads = 0;
    updateFails = false;
    waitingListModuleOn = true;
    clientEmail = CLIENT_EMAIL;
    mockSendPush.mockResolvedValue({ success: true });
  }
  beforeEach(reset);
  afterEach(reset);

  it("moduł wyłączony: stan modułów salonu sprawdzony, brak odczytu wpisów, kont i wysyłki", async () => {
    users = VERIFIED;
    waitingListModuleOn = false;

    const result = await notifyWaitingList(params);

    expect(mockGetSalonModules).toHaveBeenCalledWith("salon-1");
    expect(entryReads).toBe(0);
    expect(userReads).toBe(0);
    expect(mockSendPush).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
    expect(result).toEqual({ notified: 0, smsCount: 0, pushCount: 0, errors: 0 });
  });

  it("moduł włączony: wysyłka jak dotąd", async () => {
    users = VERIFIED;

    const result = await notifyWaitingList(params);

    expect(mockGetSalonModules).toHaveBeenCalledWith("salon-1");
    expect(entryReads).toBe(1);
    expect(result).toEqual({ notified: 1, smsCount: 0, pushCount: 1, errors: 0 });
  });
});
