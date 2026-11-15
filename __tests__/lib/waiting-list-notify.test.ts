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

const entryRow = {
  entry: { id: "wl-1" },
  client: {
    id: "client-b",
    firstName: "Barbara",
    lastName: "Bielska",
    phone: null,
    email: CLIENT_EMAIL,
  },
};

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
    if (tableName === "waitingList") return resolve([entryRow]);
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
      c.set = () => c;
      c.where = () => Promise.resolve([]);
      return c;
    },
  },
}));

const mockSendPush = vi.fn();
vi.mock("@/lib/push", () => ({
  sendPushNotification: (...args: unknown[]) => mockSendPush(...args),
}));
vi.mock("@/lib/sms", () => ({ sendSms: vi.fn() }));
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
    mockSendPush.mockResolvedValue({ success: true });
  });

  it("niezweryfikowane konto z e-mailem klienta NIE dostaje pusha", async () => {
    users = [{ id: "intruz", email: CLIENT_EMAIL, emailVerified: false }];

    const result = await notifyWaitingList(params);

    expect(mockSendPush).not.toHaveBeenCalled();
    expect(result.pushCount).toBe(0);
    expect(result.notified).toBe(1);
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
