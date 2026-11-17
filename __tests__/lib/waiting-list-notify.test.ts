/**
 * notifyWaitingList — powiadomienie o zwolnionym terminie:
 * - SMS na numer klienta wpisu (treść wyłącznie z `buildWaitingListSms`,
 *   telefon salonu z bazy), poza godzinami ciszy 21:00–8:00 czasu warszawskiego;
 * - push na konto `user` znalezione po e-mailu KLIENTA, tylko ze
 *   zweryfikowanym e-mailem (treść wyłącznie z `buildWaitingListPush`);
 * - wpis oznaczany tylko, gdy wiadomość została przyjęta (SMS albo push).
 *
 * Mock bazy ewaluuje warunki eq()/isNull()/isNotNull() na fiksturach (konta,
 * wpisy, salony), stosuje porządek i limit zapytania — test sprawdza
 * zachowanie (kto dostaje wiadomość), a nie tylko kształt zapytania.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

type Cond =
  | { kind: "eq"; col: string; val: unknown }
  | { kind: "isNull"; col: string }
  | { kind: "isNotNull"; col: string }
  | { kind: "and"; conds: Cond[] }
  | { kind: "other" };

type Order = { kind: "asc"; col: string };

vi.mock("drizzle-orm", () => ({
  eq: (col: string, val: unknown): Cond => ({ kind: "eq", col, val }),
  and: (...conds: Cond[]): Cond => ({ kind: "and", conds }),
  or: (): Cond => ({ kind: "other" }),
  not: (): Cond => ({ kind: "other" }),
  isNull: (col: string): Cond => ({ kind: "isNull", col }),
  isNotNull: (col: string): Cond => ({ kind: "isNotNull", col }),
  asc: (col: string): Order => ({ kind: "asc", col }),
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
    salons: table("salons"),
  };
});

const CLIENT_EMAIL = "osoba.b@example.com";
/** Numery z puli testowej projektu (src/lib/test-phone.ts); sendSms jest atrapą. */
const CLIENT_PHONE = "+48000600701";
const SALON_PHONE = "+48 000 600 704";
const OTHER_SALON_PHONE = "+48 000 600 705";

// Konta w bazie (tabela "user")
let users: Array<Record<string, unknown>> = [];

// Kontakt klienta wpisu (ustawiany per test)
let clientPhone: string | null = null;
let clientEmail: string | null = CLIENT_EMAIL;

// Wartości przekazane do db.update(...).set(...) i warunki tych zapisów
const updates: Array<Record<string, unknown>> = [];
const updateWheres: Cond[] = [];

interface EntryFixture {
  id: string;
  salonId: string;
  createdAt: Date;
  clientRequestConfirmedAt: Date | null;
}

/** Wpis salonu "salon-1", potwierdzony; createdAt rośnie z numerem w id. */
function entryFixture(id: string, extra: Partial<EntryFixture> = {}): EntryFixture {
  const n = Number(id.replace(/\D/g, "")) || 0;
  return {
    id,
    salonId: "salon-1",
    createdAt: new Date(Date.UTC(2026, 0, 1 + n)),
    clientRequestConfirmedAt: new Date("2026-01-01T00:00:00Z"),
    ...extra,
  };
}

// Wpisy w bazie — domyślnie jeden.
let entries: EntryFixture[] = [entryFixture("wl-1")];
// Salony w bazie (telefon) — obcy salon pierwszy, żeby odczyt bez warunku salonu dał zły telefon.
let salonRows: Array<Record<string, unknown>> = [];
// Liczniki odczytów i parametry zapytania o wpisy.
let userReads = 0;
let entryReads = 0;
let salonReads = 0;
let entryOrderBy: unknown[][] = [];
let entryLimits: unknown[] = [];
// Awarie
let updateFails = false;
let userReadFails = false;
let salonReadFails = false;

function entryRow(e: EntryFixture) {
  return {
    entry: { ...e },
    client: {
      id: "client-b",
      firstName: "Barbara",
      lastName: "Bielska",
      phone: clientPhone,
      email: clientEmail,
    },
  };
}

/**
 * Ewaluacja warunku na wierszu tabeli `table`: kolumna "<table>.x" -> row.x.
 * Warunki innych tabel i "other" (np. alternatywy usługi/pracownika) nie filtrują.
 */
function matches(row: Record<string, unknown>, cond: Cond | undefined, table: string): boolean {
  if (!cond) return true;
  if (cond.kind === "and") return cond.conds.every((c) => matches(row, c, table));
  if (cond.kind === "other") return true;
  if (!cond.col.startsWith(`${table}.`)) return true;
  const key = cond.col.slice(table.length + 1);
  if (cond.kind === "eq") return row[key] === cond.val;
  if (cond.kind === "isNull") return row[key] === null || row[key] === undefined;
  return row[key] !== null && row[key] !== undefined;
}

function selectChain() {
  let tableName = "";
  let where: Cond | undefined;
  let order: Order[] = [];
  let limit: number | undefined;
  const c: Record<string, unknown> = {};
  c.from = (t: { __name: string }) => ((tableName = t.__name), c);
  c.innerJoin = () => c;
  c.where = (w: Cond) => ((where = w), c);
  c.orderBy = (...o: Order[]) => {
    order = o;
    if (tableName === "waitingList") entryOrderBy.push(o);
    return c;
  };
  c.limit = (n: number) => {
    limit = n;
    if (tableName === "waitingList") entryLimits.push(n);
    return c;
  };
  c.then = (resolve: (v: unknown[]) => unknown, reject: (e: unknown) => unknown) => {
    if (tableName === "waitingList") {
      entryReads++;
      let rows = entries.filter((e) => matches(e as unknown as Record<string, unknown>, where, "waitingList"));
      for (const o of [...order].reverse()) {
        const key = o.col.replace(/^waitingList\./, "") as keyof EntryFixture;
        rows = [...rows].sort((a, b) => (a[key] as Date).getTime() - (b[key] as Date).getTime());
      }
      if (limit !== undefined) rows = rows.slice(0, limit);
      return resolve(rows.map(entryRow));
    }
    if (tableName === "user") {
      userReads++;
      if (userReadFails) {
        // Błąd zapytania niosący w treści parametr (e-mail klienta).
        return reject(new Error(`Failed query: select "id" from "user" where "email" = $1 params: ${CLIENT_EMAIL}`));
      }
      return resolve(users.filter((u) => matches(u, where, "user")).map((u) => ({ id: u.id })));
    }
    if (tableName === "salons") {
      salonReads++;
      if (salonReadFails) {
        return reject(new Error(`Failed query: select "phone" from "salons" params: ${SALON_PHONE}`));
      }
      const rows = salonRows.filter((s) => matches(s, where, "salons")).map((s) => ({ phone: s.phone }));
      return resolve(limit !== undefined ? rows.slice(0, limit) : rows);
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
      c.where = (w: Cond) => {
        updateWheres.push(w);
        return updateFails ? Promise.reject(new Error("zapis odrzucony")) : Promise.resolve([]);
      };
      return c;
    },
  },
}));

// Biblioteka idzie przez forSalon(params.salonId).raw — mock deleguje do
// mocka `db` powyżej.
vi.mock("@/lib/server/repository", async () => {
  const { db } = await import("@/lib/db");
  return {
    forSalon: (salonId: string) => ({ salonId, raw: async (fn: (tx: unknown) => unknown) => fn(db) }),
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

const mockSendPush = vi.fn();
vi.mock("@/lib/push", () => ({
  sendPushNotification: (...args: unknown[]) => mockSendPush(...args),
}));
const mockSendSms = vi.fn();
vi.mock("@/lib/sms", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sms")>()),
  sendSms: (...args: unknown[]) => mockSendSms(...args),
}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { logger } from "@/lib/logger";
import { buildWaitingListSms } from "@/lib/sms";
import {
  isWaitingListSmsQuietTime,
  notifyWaitingList,
  WAITING_LIST_NOTIFY_LIMIT,
} from "@/lib/waiting-list";
import { buildWaitingListPush } from "@/lib/waiting-list-message";

/** „Teraz” w testach: 20 lipca 2026, 12:00 w Warszawie (poza godzinami ciszy). */
const NOW = new Date("2026-07-20T10:00:00Z");

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

const VERIFIED = [{ id: "wlasciciel", email: CLIENT_EMAIL, emailVerified: true }];

function resetAll() {
  vi.clearAllMocks();
  updates.length = 0;
  updateWheres.length = 0;
  entries = [entryFixture("wl-1")];
  salonRows = [
    { id: "salon-2", phone: OTHER_SALON_PHONE },
    { id: "salon-1", phone: SALON_PHONE },
  ];
  users = [];
  userReads = 0;
  entryReads = 0;
  salonReads = 0;
  entryOrderBy = [];
  entryLimits = [];
  updateFails = false;
  userReadFails = false;
  salonReadFails = false;
  waitingListModuleOn = true;
  clientPhone = null;
  clientEmail = CLIENT_EMAIL;
  mockSendPush.mockResolvedValue({ success: true });
  mockSendSms.mockResolvedValue({ success: true, notificationId: "n-1" });
}

beforeEach(() => {
  resetAll();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

/** Wszystkie argumenty wywołań loggera jako tekst (obiekt błędu z nazwą i treścią). */
function loggedText(): string {
  const calls = Object.values(logger).flatMap((fn) => (fn as ReturnType<typeof vi.fn>).mock.calls);
  return JSON.stringify(calls, (_key, value: unknown) =>
    value instanceof Error ? { name: value.name, message: value.message } : value
  );
}

/** Id wpisów, których dotyczyły zapisy oznaczenia (warunek eq(waitingList.id, ...)). */
function markedEntryIds(): unknown[] {
  const ids: unknown[] = [];
  const walk = (c: Cond) => {
    if (c.kind === "and") c.conds.forEach(walk);
    if (c.kind === "eq" && c.col === "waitingList.id") ids.push(c.val);
  };
  updateWheres.forEach(walk);
  return ids;
}

describe("notifyWaitingList — push tylko na konto ze zweryfikowanym e-mailem klienta", () => {
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

describe("notifyWaitingList — wpis oznaczany tylko po przyjęciu wiadomości", () => {
  it("push dostarczony: pola oferty ustawione, notified +1", async () => {
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

  it("push niedostarczony (success: false): wpis nietknięty, notified i errors bez zmian", async () => {
    users = VERIFIED;
    mockSendPush.mockResolvedValue({ success: false, sent: 0, failed: 0, error: "No subscriptions" });

    const result = await notifyWaitingList(params);

    expect(mockSendPush).toHaveBeenCalledTimes(1);
    expect(updates).toHaveLength(0);
    expect(result).toEqual({ notified: 0, smsCount: 0, pushCount: 0, errors: 0 });
  });

  it("push rzuca wyjątek: wpis nietknięty, notified i errors bez zmian", async () => {
    users = VERIFIED;
    mockSendPush.mockRejectedValue(new Error("push down"));

    const result = await notifyWaitingList(params);

    expect(updates).toHaveLength(0);
    expect(result).toEqual({ notified: 0, smsCount: 0, pushCount: 0, errors: 0 });
  });

  it("brak konta i brak telefonu: wpis nietknięty, notified i errors bez zmian", async () => {
    users = [];

    const result = await notifyWaitingList(params);

    expect(mockSendPush).not.toHaveBeenCalled();
    expect(mockSendSms).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
    expect(result).toEqual({ notified: 0, smsCount: 0, pushCount: 0, errors: 0 });
  });

  it("SMS przyjęty (wpis tylko z telefonem): pola oferty ustawione, smsCount 1, notified 1", async () => {
    clientPhone = CLIENT_PHONE;
    clientEmail = null;
    const withEmployee = { ...params, employeeId: "emp-1" };

    const result = await notifyWaitingList(withEmployee);

    expect(mockSendSms).toHaveBeenCalledTimes(1);
    expect(mockSendSms.mock.calls[0]![0]).toMatchObject({ to: CLIENT_PHONE, salonId: "salon-1", clientId: "client-b" });
    expect(updates).toHaveLength(1);
    const set = updates[0]!;
    expect(set.notifiedAt).toBeInstanceOf(Date);
    expect(set.acceptToken).toMatch(/^[0-9a-f]{64}$/);
    expect(set.offeredStartTime).toBe(withEmployee.startTime);
    expect(set.offeredEndTime).toBe(withEmployee.endTime);
    expect(set.offeredEmployeeId).toBe("emp-1");
    expect(markedEntryIds()).toEqual(["wl-1"]);
    expect(result).toEqual({ notified: 1, smsCount: 1, pushCount: 0, errors: 0 });
  });

  it("SMS nieprzyjęty (success: false): wpis nietknięty, errors bez zmian", async () => {
    clientPhone = CLIENT_PHONE;
    clientEmail = null;
    mockSendSms.mockResolvedValue({ success: false, error: "Nie udało się wysłać SMS." });

    const result = await notifyWaitingList(params);

    expect(mockSendSms).toHaveBeenCalledTimes(1);
    expect(updates).toHaveLength(0);
    expect(result).toEqual({ notified: 0, smsCount: 0, pushCount: 0, errors: 0 });
    expect(logger.warn).toHaveBeenCalledWith(expect.any(String), {
      entryId: "wl-1",
      errorName: expect.any(String),
    });
  });

  it("sendSms rzuca wyjątek: wpis nietknięty, errors bez zmian, log tylko id wpisu i klasa błędu", async () => {
    clientPhone = CLIENT_PHONE;
    clientEmail = null;
    mockSendSms.mockRejectedValue(new TypeError(`fetch failed for ${CLIENT_PHONE}`));

    const result = await notifyWaitingList(params);

    expect(updates).toHaveLength(0);
    expect(result).toEqual({ notified: 0, smsCount: 0, pushCount: 0, errors: 0 });
    expect(logger.warn).toHaveBeenCalledWith(expect.any(String), { entryId: "wl-1", errorName: "TypeError" });
    expect(loggedText()).not.toContain("600701");
  });

  it("numer testowy (skipped: test_phone): wpis nietknięty, nie błąd, nie smsCount, nie notified", async () => {
    clientPhone = CLIENT_PHONE;
    clientEmail = null;
    mockSendSms.mockResolvedValue({ success: false, error: "SMS nie wysłany: numer testowy.", skipped: "test_phone" });

    const result = await notifyWaitingList(params);

    expect(mockSendSms).toHaveBeenCalledTimes(1);
    expect(updates).toHaveLength(0);
    expect(result).toEqual({ notified: 0, smsCount: 0, pushCount: 0, errors: 0 });
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalledWith(expect.any(String), { entryId: "wl-1" });
    expect(loggedText()).not.toContain("600701");
  });

  it("SMS i push przyjęte: jedno oznaczenie, smsCount 1 i pushCount 1", async () => {
    clientPhone = CLIENT_PHONE;
    users = VERIFIED;

    const result = await notifyWaitingList(params);

    expect(mockSendSms).toHaveBeenCalledTimes(1);
    expect(mockSendPush).toHaveBeenCalledTimes(1);
    expect(updates).toHaveLength(1);
    expect(result).toEqual({ notified: 1, smsCount: 1, pushCount: 1, errors: 0 });
  });

  it("SMS nieprzyjęty, push przyjęty: wpis oznaczony, smsCount 0, pushCount 1", async () => {
    clientPhone = CLIENT_PHONE;
    users = VERIFIED;
    mockSendSms.mockResolvedValue({ success: false, error: "Nie udało się wysłać SMS." });

    const result = await notifyWaitingList(params);

    expect(updates).toHaveLength(1);
    expect(result).toEqual({ notified: 1, smsCount: 0, pushCount: 1, errors: 0 });
  });
});

describe("notifyWaitingList — treść SMS i push", () => {
  it("treść SMS = buildWaitingListSms z telefonem salonu z bazy; bez danych klienta, pracownika i linku", async () => {
    clientPhone = CLIENT_PHONE;
    clientEmail = null;

    await notifyWaitingList(params);

    const message = (mockSendSms.mock.calls[0]![0] as { message: string }).message;
    expect(message).toBe(
      buildWaitingListSms({
        salonName: params.salonName,
        serviceName: params.serviceName,
        startTime: params.startTime,
        salonPhone: SALON_PHONE,
      })
    );
    expect(message).toContain(`zadzwon: ${SALON_PHONE}.`);
    expect(message).not.toContain(OTHER_SALON_PHONE);
    expect(message).not.toMatch(/Barbara|Bielska|Ewa|Nowak|http/);
    expect(salonReads).toBe(1);
  });

  it("dwa wpisy z telefonem: jeden odczyt telefonu salonu w przebiegu", async () => {
    clientPhone = CLIENT_PHONE;
    clientEmail = null;
    entries = [entryFixture("wl-1"), entryFixture("wl-2")];

    const result = await notifyWaitingList(params);

    expect(salonReads).toBe(1);
    expect(mockSendSms).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ notified: 2, smsCount: 2, pushCount: 0, errors: 0 });
  });

  it("błąd odczytu telefonu salonu: SMS bez fragmentu telefonu, przebieg bez błędu", async () => {
    clientPhone = CLIENT_PHONE;
    clientEmail = null;
    salonReadFails = true;

    const result = await notifyWaitingList(params);

    const message = (mockSendSms.mock.calls[0]![0] as { message: string }).message;
    expect(message).toBe(
      buildWaitingListSms({ salonName: params.salonName, serviceName: params.serviceName, startTime: params.startTime })
    );
    expect(message).not.toContain("zadzwon");
    expect(result).toEqual({ notified: 1, smsCount: 1, pushCount: 0, errors: 0 });
    expect(loggedText()).not.toContain("600 704");
  });

  it("treść push = buildWaitingListPush; dane powiadomienia bez zmian", async () => {
    users = VERIFIED;

    await notifyWaitingList(params);

    const payload = mockSendPush.mock.calls[0]![1] as Record<string, unknown>;
    const expected = buildWaitingListPush({
      salonName: params.salonName,
      serviceName: params.serviceName,
      startTime: params.startTime,
    });
    expect(payload).toMatchObject({ title: expected.title, body: expected.body, tag: "waiting-list-wl-1" });
    expect(payload.data).toEqual({
      type: "waiting_list_notification",
      waitingListId: "wl-1",
      salonId: "salon-1",
      url: "/client/waiting-list",
    });
    expect(`${payload.title} ${payload.body}`).not.toMatch(/Barbara|Bielska|Ewa|Nowak|http/);
  });

  it("żaden log nie zawiera numeru telefonu klienta ani salonu, ani e-maila", async () => {
    clientPhone = CLIENT_PHONE;
    users = VERIFIED;
    entries = [entryFixture("wl-1"), entryFixture("wl-2")];
    mockSendSms
      .mockResolvedValueOnce({ success: false, error: "Nie udało się wysłać SMS." })
      .mockRejectedValueOnce(new Error(`SMSAPI error for ${CLIENT_PHONE}`));
    mockSendPush.mockRejectedValue(new Error(`push for ${CLIENT_EMAIL}`));

    await notifyWaitingList(params);

    const text = loggedText();
    expect(text).not.toContain("600701");
    expect(text).not.toContain("600 704");
    expect(text).not.toContain(CLIENT_EMAIL);
  });
});

describe("notifyWaitingList — wybór wpisów", () => {
  it("6 pasujących wpisów: zapytanie z porządkiem createdAt rosnąco i limitem 5, SMS do 5 najstarszych", async () => {
    clientPhone = CLIENT_PHONE;
    clientEmail = null;
    // W bazie w kolejności od najnowszego — porządek musi dać zapytanie.
    entries = ["wl-6", "wl-5", "wl-4", "wl-3", "wl-2", "wl-1"].map((id) => entryFixture(id));

    const result = await notifyWaitingList(params);

    expect(WAITING_LIST_NOTIFY_LIMIT).toBe(5);
    expect(entryOrderBy).toEqual([[{ kind: "asc", col: "waitingList.createdAt" }]]);
    expect(entryLimits).toEqual([5]);
    expect(mockSendSms).toHaveBeenCalledTimes(5);
    expect(markedEntryIds()).toEqual(["wl-1", "wl-2", "wl-3", "wl-4", "wl-5"]);
    expect(result).toEqual({ notified: 5, smsCount: 5, pushCount: 0, errors: 0 });
  });

  it("wpis bez potwierdzenia prośby klienta: 0 SMS (warunek w zapytaniu)", async () => {
    clientPhone = CLIENT_PHONE;
    clientEmail = null;
    entries = [entryFixture("wl-1", { clientRequestConfirmedAt: null })];

    const result = await notifyWaitingList(params);

    expect(entryReads).toBe(1);
    expect(mockSendSms).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
    expect(result).toEqual({ notified: 0, smsCount: 0, pushCount: 0, errors: 0 });
  });

  it("wpis innego salonu: 0 SMS; telefon salonu z warunkiem tego salonu", async () => {
    clientPhone = CLIENT_PHONE;
    clientEmail = null;
    entries = [entryFixture("wl-9", { salonId: "salon-2" }), entryFixture("wl-1")];

    const result = await notifyWaitingList(params);

    expect(mockSendSms).toHaveBeenCalledTimes(1);
    expect(markedEntryIds()).toEqual(["wl-1"]);
    const message = (mockSendSms.mock.calls[0]![0] as { message: string }).message;
    expect(message).toContain(`zadzwon: ${SALON_PHONE}.`);
    expect(message).not.toContain(OTHER_SALON_PHONE);
    expect(result).toEqual({ notified: 1, smsCount: 1, pushCount: 0, errors: 0 });
  });
});

describe("notifyWaitingList — termin w przeszłości albo nieprawidłowy", () => {
  it.each([
    ["termin w przeszłości", new Date("2026-07-19T10:00:00Z")],
    ["termin równy chwili obecnej", NOW],
    ["nieprawidłowa data", new Date("nie-data")],
  ])("%s: 0 odczytów wpisów, 0 SMS i push, wynik zerowy bez błędu", async (_label, startTime) => {
    clientPhone = CLIENT_PHONE;
    users = VERIFIED;

    const result = await notifyWaitingList({ ...params, startTime: new Date(startTime.getTime()) });

    expect(entryReads).toBe(0);
    expect(salonReads).toBe(0);
    expect(mockSendSms).not.toHaveBeenCalled();
    expect(mockSendPush).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
    expect(result).toEqual({ notified: 0, smsCount: 0, pushCount: 0, errors: 0 });
    expect(logger.debug).toHaveBeenCalled();
  });
});

/** Strażnik: proces liczy w UTC, inaczej test godzin ciszy sprawdzałby strefę maszyny. */
function assertProcessInUtc() {
  const d = new Date("2026-07-15T08:30:00Z");
  expect(d.getHours(), "proces nie jest w UTC — test przeszedłby na pusto").toBe(8);
  expect(d.getTimezoneOffset()).toBe(0);
}

/**
 * Godziny ciszy 21:00–8:00 czasu warszawskiego przy procesie w UTC.
 * Lato (CEST, +2) i zima (CET, +1): ta sama godzina w Warszawie to inna w UTC.
 */
const QUIET_CASES = [
  { label: "lato 20:59", at: "2026-07-20T18:59:00Z", quiet: false },
  { label: "lato 21:00", at: "2026-07-20T19:00:00Z", quiet: true },
  { label: "lato 07:59", at: "2026-07-20T05:59:00Z", quiet: true },
  { label: "lato 08:00", at: "2026-07-20T06:00:00Z", quiet: false },
  { label: "zima 20:59", at: "2026-01-20T19:59:00Z", quiet: false },
  { label: "zima 21:00", at: "2026-01-20T20:00:00Z", quiet: true },
  { label: "zima 07:59", at: "2026-01-20T06:59:00Z", quiet: true },
  { label: "zima 08:00", at: "2026-01-20T07:00:00Z", quiet: false },
] as const;

describe("notifyWaitingList — godziny ciszy SMS (czas warszawski, proces w UTC)", () => {
  beforeEach(() => {
    vi.stubEnv("TZ", "UTC");
  });

  it.each(QUIET_CASES)("isWaitingListSmsQuietTime: $label → cisza = $quiet", (c) => {
    assertProcessInUtc();
    expect(isWaitingListSmsQuietTime(new Date(c.at))).toBe(c.quiet);
  });

  it("isWaitingListSmsQuietTime: 21:00:00 w Warszawie → cisza", () => {
    assertProcessInUtc();
    expect(isWaitingListSmsQuietTime(new Date("2026-07-20T19:00:00.000Z"))).toBe(true);
    expect(isWaitingListSmsQuietTime(new Date("2026-07-20T18:59:59.999Z"))).toBe(false);
  });

  it.each(QUIET_CASES)("wysyłka o $label: SMS wychodzi tylko poza ciszą", async (c) => {
    assertProcessInUtc();
    vi.setSystemTime(new Date(c.at));
    clientPhone = CLIENT_PHONE;
    clientEmail = null;

    const result = await notifyWaitingList({
      ...params,
      startTime: new Date("2027-03-01T10:00:00Z"),
      endTime: new Date("2027-03-01T11:00:00Z"),
    });

    if (c.quiet) {
      expect(mockSendSms).not.toHaveBeenCalled();
      expect(updates).toHaveLength(0);
      expect(result).toEqual({ notified: 0, smsCount: 0, pushCount: 0, errors: 0 });
    } else {
      expect(mockSendSms).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ notified: 1, smsCount: 1, pushCount: 0, errors: 0 });
    }
  });

  it("w ciszy push nadal wychodzi i oznacza wpis; SMS 0 razy", async () => {
    assertProcessInUtc();
    vi.setSystemTime(new Date("2026-07-20T20:00:00Z"));
    clientPhone = CLIENT_PHONE;
    users = VERIFIED;

    const result = await notifyWaitingList(params);

    expect(mockSendSms).not.toHaveBeenCalled();
    expect(result).toEqual({ notified: 1, smsCount: 0, pushCount: 1, errors: 0 });
  });
});

describe("notifyWaitingList — wyszukiwanie konta w przebiegu i nieudany zapis oznaczenia", () => {
  it("dwa wpisy tego samego klienta: jeden odczyt konta w przebiegu, push do obu", async () => {
    entries = [entryFixture("wl-1"), entryFixture("wl-2")];
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

  it("odczyt konta rzuca błąd z e-mailem w treści: log bez e-maila, brak pusha, errors bez zmian", async () => {
    users = VERIFIED;
    userReadFails = true;

    const result = await notifyWaitingList(params);

    expect(mockSendPush).not.toHaveBeenCalled();
    expect(result).toEqual({ notified: 0, smsCount: 0, pushCount: 0, errors: 0 });
    expect(logger.warn).toHaveBeenCalledWith(expect.any(String), { entryId: "wl-1", errorName: "Error" });
    expect(loggedText()).not.toContain(CLIENT_EMAIL);
  });
});

describe("notifyWaitingList — przełącznik modułu listy oczekujących salonu", () => {
  it("moduł wyłączony: stan modułów salonu sprawdzony, brak odczytu wpisów, kont, salonu i wysyłki", async () => {
    users = VERIFIED;
    clientPhone = CLIENT_PHONE;
    waitingListModuleOn = false;

    const result = await notifyWaitingList(params);

    expect(mockGetSalonModules).toHaveBeenCalledWith("salon-1");
    expect(entryReads).toBe(0);
    expect(userReads).toBe(0);
    expect(salonReads).toBe(0);
    expect(mockSendPush).not.toHaveBeenCalled();
    expect(mockSendSms).not.toHaveBeenCalled();
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
