/**
 * notifyWaitingList — push o zwolnionym terminie idzie na konto `user`
 * znalezione po e-mailu KLIENTA. Kierunek klient -> konto: konto zalozone na
 * cudzy adres (niezweryfikowane) nie moze dostac pusha z imieniem i nazwiskiem
 * klienta, salonem, usluga, pracownikiem i godzina.
 *
 * Mock bazy ewaluuje warunki eq() na fikstura kont, wiec test sprawdza
 * zachowanie (kto dostaje push), a nie tylko ksztalt zapytania.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

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

function entryRow() {
  return {
    entry: { id: "wl-1" },
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
    if (tableName === "waitingList") return resolve([entryRow()]);
    if (tableName === "user") {
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
      c.where = () => Promise.resolve([]);
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

const mockSendPush = vi.fn();
vi.mock("@/lib/push", () => ({
  sendPushNotification: (...args: unknown[]) => mockSendPush(...args),
}));
const mockSendSms = vi.fn();
vi.mock("@/lib/sms", () => ({
  sendSms: (...args: unknown[]) => mockSendSms(...args),
}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

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
