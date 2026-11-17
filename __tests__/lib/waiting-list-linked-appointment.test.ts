/**
 * Lista oczekujących: wizyta powiązana z ofertą (`existingAppointmentId`).
 *
 * - Przy ofercie powiązanie dostaje tylko wizyta klienta na tę usługę w tym
 *   salonie, zaplanowana albo potwierdzona, ze startem później niż proponowany
 *   termin i później niż „teraz”; przy kilku — najwcześniejsza.
 * - Przy przyjęciu przeniesienie to jeden warunkowy zapis z tym samym
 *   warunkiem. Wizyta powiązana, której brak albo odwołana → nowa wizyta (z
 *   regułą zadatku). Wizyta żywa, ale niespełniająca warunku (także zmieniona
 *   między odczytem a zapisem) → odmowa, bez nowej wizyty i bez oznaczenia wpisu.
 * - Komunikat sukcesu mówi o przeniesieniu tylko po przeniesieniu.
 *
 * Atrapa bazy przepuszcza wiersze-fikstury przez PRAWDZIWY warunek WHERE
 * zapytania (`sqlMatches`) i stosuje jego porządek, a zapis wizyty wykonuje na
 * fiksturze pod warunkiem zapisu — wynik zależy od znaczenia warunków.
 */
import { getTableName, type SQL, type Table } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sqlMatches } from "../api/sql-predicate";

type Row = Record<string, unknown>;

const st = vi.hoisted(() => ({
  db: null as unknown,
  deposit: vi.fn<(...a: unknown[]) => Promise<unknown>>(),
}));

vi.mock("@/lib/db", () => ({
  get db() {
    return st.db;
  },
}));
vi.mock("@/lib/server/repository", () => ({
  forSalon: (salonId: string) => ({ salonId, raw: async (fn: (tx: unknown) => unknown) => fn(st.db) }),
}));
vi.mock("@/lib/server/system", () => ({
  resolveWaitingListToken: async (token: string) =>
    token === "tok" ? { waitingListId: "wl-1", salonId: "salon-1" } : null,
}));
vi.mock("@/lib/server/modules", async () => {
  const { resolveModules } = await vi.importActual<typeof import("@/lib/features")>("@/lib/features");
  return { getSalonModules: async () => resolveModules({ modules: { waitingList: true } }) };
});
vi.mock("@/lib/deposit-guard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/deposit-guard")>()),
  checkBookingWithoutDeposit: (...a: unknown[]) => st.deposit(...a),
}));
vi.mock("@/lib/push", () => ({
  sendPushNotification: vi.fn(async () => ({ success: true, sent: 1, failed: 0 })),
}));
vi.mock("@/lib/sms", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sms")>()),
  sendSms: vi.fn(),
}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { acceptEarlierSlot, notifyWaitingList } from "@/lib/waiting-list";

const SALON = "salon-1";
const CLIENT = "client-1";
const SERVICE = "service-1";
const EMPLOYEE = "e-1";
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** „Teraz” (zegar aplikacji): 20 lipca 2026, 12:00 w Warszawie. */
const NOW = new Date("2026-07-20T10:00:00.000Z");
const START = new Date("2026-08-01T10:00:00.000Z");
const END = new Date(START.getTime() + HOUR);
const at = (offsetMs: number) => new Date(START.getTime() + offsetMs);

const MOVED_MESSAGE = "Termin zostal zaakceptowany! Wizyta zostala przeniesiona.";
const BOOKED_MESSAGE = "Termin zostal zaakceptowany! Wizyta zostala zarezerwowana.";
const REFUSED = { success: false, message: "Oferta nie jest już aktualna" };

// ─── Atrapa bazy ─────────────────────────────────────────────────────────────

/** Wizyty w bazie: klucze = nazwy kolumn (`start_time`). */
let appts: Row[] = [];
/** Wpis czytany przez acceptEarlierSlot (null = przebieg notifyWaitingList). */
let acceptEntry: Row | null = null;
/** Wiersze { entry, client } czytane przez notifyWaitingList. */
let notifyRows: Row[] = [];
let apptSelects: Array<{ where: SQL; order: string[]; limit: number | undefined }> = [];
let apptUpdates: Array<{ where: SQL; set: Row; affected: number }> = [];
let apptInserts: Row[] = [];
let entryUpdates: Row[] = [];
/** Wartości zapisów do `notifications`. */
let notifInserts: Row[] = [];
/** Wołane po każdym odczycie wizyt z numerem odczytu (zmiana stanu w oknie). */
let afterApptSelect: ((n: number) => void) | null = null;

const dialect = new PgDialect();
const render = (s: SQL) => dialect.sqlToQuery(s);

const COLUMN: Record<string, string> = {
  startTime: "start_time",
  endTime: "end_time",
  employeeId: "employee_id",
  notes: "notes",
  status: "status",
};

function camel(r: Row): Row {
  return {
    id: r.id,
    salonId: r.salon_id,
    clientId: r.client_id,
    serviceId: r.service_id,
    employeeId: r.employee_id,
    status: r.status,
    startTime: r.start_time,
    endTime: r.end_time,
    notes: r.notes,
  };
}

function thenable(c: Row, run: () => unknown) {
  c.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
    Promise.resolve().then(run).then(res, rej);
  return c;
}

function selectChain() {
  let table = "";
  let where: SQL | undefined;
  let order: SQL[] = [];
  let limit: number | undefined;
  const c: Row = {};
  c.from = (t: Table) => ((table = getTableName(t)), c);
  c.innerJoin = () => c;
  c.where = (w: SQL) => ((where = w), c);
  c.orderBy = (...o: SQL[]) => ((order = o), c);
  c.limit = (n: number) => ((limit = n), c);
  return thenable(c, () => {
    if (table === "waiting_list") return acceptEntry ? [acceptEntry] : notifyRows;
    if (table === "user") return [{ id: "user-1" }];
    if (table !== "appointments") return [];
    const orderSql = order.map((o) => render(o).sql);
    apptSelects.push({ where: where!, order: orderSql, limit });
    let rows = appts.filter((r) => sqlMatches(where!, r));
    for (const o of [...orderSql].reverse()) {
      const m = /^"appointments"\."start_time" (asc|desc)$/.exec(o);
      if (!m) throw new Error(`atrapa: nieobsługiwany porządek ${o}`);
      const dir = m[1] === "asc" ? 1 : -1;
      rows = [...rows].sort((a, b) => dir * ((a.start_time as Date).getTime() - (b.start_time as Date).getTime()));
    }
    if (limit !== undefined) rows = rows.slice(0, limit);
    const out = rows.map(camel);
    afterApptSelect?.(apptSelects.length);
    return out;
  });
}

function updateChain(t: Table) {
  const table = getTableName(t);
  let set: Row = {};
  let where: SQL | undefined;
  const c: Row = {};
  c.set = (v: Row) => ((set = v), c);
  c.where = (w: SQL) => ((where = w), c);
  c.returning = () => c;
  return thenable(c, () => {
    if (table === "waiting_list") {
      entryUpdates.push(set);
      return [{ id: "wl-1" }];
    }
    if (table !== "appointments") throw new Error(`atrapa: zapis ${table}`);
    const hit = appts.filter((r) => sqlMatches(where!, r));
    for (const r of hit) {
      for (const [k, v] of Object.entries(set)) {
        if (!COLUMN[k]) throw new Error(`atrapa: kolumna ${k}`);
        r[COLUMN[k]] = v;
      }
    }
    apptUpdates.push({ where: where!, set, affected: hit.length });
    return hit.map((r) => ({ id: r.id }));
  });
}

function insertChain(t: Table) {
  const table = getTableName(t);
  let values: Row = {};
  const c: Row = {};
  c.values = (v: Row) => ((values = v), c);
  c.returning = () => c;
  return thenable(c, () => {
    if (table === "notifications") {
      notifInserts.push(values);
      return [];
    }
    if (table !== "appointments") return [];
    const row = { ...values, id: "apt-new" };
    apptInserts.push(row);
    return [row];
  });
}

/** Wizyta klienta na usługę w salonie; start względem proponowanego terminu. */
function appt(id: string, offsetMs: number, status: string, extra: Row = {}): Row {
  return {
    id,
    salon_id: SALON,
    client_id: CLIENT,
    service_id: SERVICE,
    employee_id: "e-2",
    status,
    start_time: at(offsetMs),
    end_time: at(offsetMs + HOUR),
    notes: null,
    ...extra,
  };
}

function entry(existingAppointmentId: string | null): Row {
  return {
    id: "wl-1",
    salonId: SALON,
    clientId: CLIENT,
    serviceId: SERVICE,
    preferredEmployeeId: null,
    offeredEmployeeId: EMPLOYEE,
    existingAppointmentId,
    acceptToken: "tok",
    accepted: null,
    offeredStartTime: START,
    offeredEndTime: END,
  };
}

/** Czy warunek ma `"appointments"."<kolumna>" <op> $n` z parametrem `value`. */
function hasCondition(where: SQL, column: string, op: string, value: unknown): boolean {
  const q = render(where);
  const re = new RegExp(`"appointments"\\."${column}" ${op} \\$(\\d+)`, "g");
  return [...q.sql.matchAll(re)].some((m) => q.params[Number(m[1]) - 1] === value);
}

/** Warunek przenoszalności: status, start względem oferty i względem „teraz”. */
function expectMovableCondition(where: SQL) {
  expect(hasCondition(where, "status", "=", "scheduled"), "status scheduled").toBe(true);
  expect(hasCondition(where, "status", "=", "confirmed"), "status confirmed").toBe(true);
  expect(hasCondition(where, "start_time", ">", START.toISOString()), "start > proponowany start").toBe(true);
  expect(hasCondition(where, "start_time", ">", NOW.toISOString()), "start > teraz").toBe(true);
  expect(hasCondition(where, "salon_id", "=", SALON), "salon").toBe(true);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  appts = [];
  acceptEntry = null;
  notifyRows = [];
  apptSelects = [];
  apptUpdates = [];
  apptInserts = [];
  entryUpdates = [];
  notifInserts = [];
  afterApptSelect = null;
  st.db = {
    select: () => selectChain(),
    update: (t: Table) => updateChain(t),
    insert: (t: Table) => insertChain(t),
  };
  st.deposit.mockReset();
  st.deposit.mockResolvedValue({ allowed: true });
});

afterEach(() => {
  vi.useRealTimers();
});

// ─── Oferta: wybór wizyty do powiązania ──────────────────────────────────────

describe("oferta z listy oczekujących: wybór powiązanej wizyty", () => {
  async function offer() {
    notifyRows = [
      {
        entry: { id: "wl-1", salonId: SALON, clientId: CLIENT, serviceId: SERVICE },
        client: { id: CLIENT, phone: null, email: "klient@example.invalid" },
      },
    ];
    const res = await notifyWaitingList({
      salonId: SALON,
      serviceId: SERVICE,
      employeeId: EMPLOYEE,
      startTime: START,
      endTime: END,
      serviceName: "Usługa",
      employeeName: "Pracownik",
      salonName: "Salon",
    });
    expect(res).toMatchObject({ notified: 1, errors: 0 });
    const claim = entryUpdates.find((u) => u.notifiedAt instanceof Date);
    expect(claim, "zajęcie wpisu").toBeDefined();
    return claim!.existingAppointmentId;
  }

  it("powiązanie z najwcześniejszą zaplanowaną albo potwierdzoną wizytą po proponowanym terminie; zapytanie z warunkiem statusu, startu (oferta, teraz) i porządkiem rosnącym", async () => {
    appts = [
      appt("apt-later-scheduled", 3 * DAY, "scheduled"),
      appt("apt-completed", HOUR, "completed"),
      appt("apt-no-show", 2 * HOUR, "no_show"),
      appt("apt-cancelled", 3 * HOUR, "cancelled"),
      appt("apt-same-start", 0, "scheduled"),
      appt("apt-earlier", -DAY, "scheduled"),
      appt("apt-later-confirmed", 2 * DAY, "confirmed"),
      appt("apt-other-client", 4 * HOUR, "scheduled", { client_id: "client-2" }),
      appt("apt-other-service", 4 * HOUR, "scheduled", { service_id: "service-2" }),
      appt("apt-other-salon", 4 * HOUR, "scheduled", { salon_id: "salon-2" }),
    ];

    expect(await offer()).toBe("apt-later-confirmed");

    expect(apptSelects).toHaveLength(1);
    const q = apptSelects[0]!;
    expectMovableCondition(q.where);
    expect(q.order).toEqual(['"appointments"."start_time" asc']);
    expect(q.limit).toBe(1);
  });

  it("tylko wizyty zakończone, odwołane, wcześniejsze albo w terminie oferty → wpis bez powiązania", async () => {
    appts = [
      appt("apt-completed", HOUR, "completed"),
      appt("apt-no-show", 2 * HOUR, "no_show"),
      appt("apt-cancelled", 3 * HOUR, "cancelled"),
      appt("apt-same-start", 0, "confirmed"),
      appt("apt-earlier", -DAY, "scheduled"),
    ];

    expect(await offer()).toBeNull();
  });
});

// ─── Przyjęcie oferty ────────────────────────────────────────────────────────

describe("przyjęcie oferty: powiązana wizyta", () => {
  it("przyszła, późniejsza, zaplanowana wizyta → przeniesiona jednym warunkowym zapisem; bez nowej wizyty i bez sprawdzania zadatku", async () => {
    acceptEntry = entry("apt-old");
    appts = [appt("apt-old", DAY, "scheduled")];

    const res = await acceptEarlierSlot("wl-1", "tok");

    expect(res).toEqual({
      success: true,
      message: MOVED_MESSAGE,
      appointmentId: "apt-old",
      oldStartTime: at(DAY),
      newStartTime: START,
    });
    expect(apptUpdates).toHaveLength(1);
    expect(apptUpdates[0]!.affected).toBe(1);
    expectMovableCondition(apptUpdates[0]!.where);
    expect(hasCondition(apptUpdates[0]!.where, "id", "=", "apt-old"), "id wizyty").toBe(true);
    expect(appts[0]).toMatchObject({ start_time: START, end_time: END, employee_id: EMPLOYEE, status: "scheduled" });
    expect(apptInserts).toEqual([]);
    expect(st.deposit).not.toHaveBeenCalled();
    expect(entryUpdates).toEqual([{ accepted: true }]);
  });

  it("powiązana wizyta odwołana → nowa wizyta, reguła zadatku sprawdzona, odwołana wizyta nietknięta", async () => {
    acceptEntry = entry("apt-old");
    appts = [appt("apt-old", DAY, "cancelled")];

    const res = await acceptEarlierSlot("wl-1", "tok");

    expect(res).toMatchObject({ success: true, appointmentId: "apt-new", message: BOOKED_MESSAGE });
    expect(res.oldStartTime).toBeUndefined();
    expect(apptInserts).toHaveLength(1);
    expect(apptInserts[0]).toMatchObject({ salonId: SALON, clientId: CLIENT, startTime: START, status: "scheduled" });
    expect(st.deposit).toHaveBeenCalledTimes(1);
    expect(apptUpdates.every((u) => u.affected === 0)).toBe(true);
    expect(appts[0]).toMatchObject({ status: "cancelled", start_time: at(DAY) });
    expect(entryUpdates).toEqual([{ accepted: true }]);
  });

  it("powiązanej wizyty brak w bazie → nowa wizyta, reguła zadatku sprawdzona", async () => {
    acceptEntry = entry("apt-gone");
    appts = [];

    const res = await acceptEarlierSlot("wl-1", "tok");

    expect(res).toMatchObject({ success: true, appointmentId: "apt-new", message: BOOKED_MESSAGE });
    expect(apptInserts).toHaveLength(1);
    expect(st.deposit).toHaveBeenCalledTimes(1);
    expect(entryUpdates).toEqual([{ accepted: true }]);
  });

  it.each([["completed"], ["no_show"]])(
    "powiązana wizyta w statusie %s → odmowa, bez nowej wizyty i bez oznaczenia wpisu, wizyta nietknięta",
    async (status) => {
      acceptEntry = entry("apt-old");
      appts = [appt("apt-old", DAY, status)];

      const res = await acceptEarlierSlot("wl-1", "tok");

      expect(res).toEqual(REFUSED);
      expect(apptInserts).toEqual([]);
      expect(entryUpdates).toEqual([]);
      expect(st.deposit).not.toHaveBeenCalled();
      expect(appts[0]).toMatchObject({ status, start_time: at(DAY), employee_id: "e-2" });
    }
  );

  it.each([
    ["wcześniejszy niż proponowany", -HOUR],
    ["równy proponowanemu", 0],
  ])(
    "powiązana zaplanowana wizyta ma teraz start %s → odmowa, bez nowej wizyty i bez oznaczenia wpisu",
    async (_n, offsetMs) => {
      acceptEntry = entry("apt-old");
      // Inny pracownik niż w ofercie: termin wolny, liczy się tylko warunek startu.
      appts = [appt("apt-old", offsetMs, "scheduled")];

      const res = await acceptEarlierSlot("wl-1", "tok");

      expect(res).toEqual(REFUSED);
      expect(apptInserts).toEqual([]);
      expect(entryUpdates).toEqual([]);
      expect(st.deposit).not.toHaveBeenCalled();
      expect(appts[0]).toMatchObject({ status: "scheduled", start_time: at(offsetMs) });
    }
  );

  describe("wizyta zmieniona między odczytem a zapisem przeniesienia (zapis bez wierszy)", () => {
    /** Odczyt wizyty widzi stan sprzed zmiany; zmiana tuż po nim (odczyt nr 2: po kolizji). */
    function changeAfterRead(change: Row) {
      afterApptSelect = (n) => {
        if (n === 2) Object.assign(appts[0]!, change);
      };
    }

    it.each([
      ["zakończona przez salon", { status: "completed" }],
      ["przesunięta na termin wcześniejszy niż oferta", { start_time: at(-2 * HOUR), end_time: at(-HOUR) }],
    ])("%s → odmowa; nie ma ani przeniesienia, ani nowej wizyty", async (_n, change) => {
      acceptEntry = entry("apt-old");
      appts = [appt("apt-old", DAY, "scheduled")];
      const before = { ...appts[0]!, ...change };
      changeAfterRead(change);

      const res = await acceptEarlierSlot("wl-1", "tok");

      expect(res).toEqual(REFUSED);
      expect(apptUpdates).toHaveLength(1);
      expect(apptUpdates[0]!.affected).toBe(0);
      expect(appts[0]).toEqual(before);
      expect(apptInserts).toEqual([]);
      expect(entryUpdates).toEqual([]);
      expect(st.deposit).not.toHaveBeenCalled();
    });

    it("odwołana → nowa wizyta z regułą zadatku; odwołana wizyta nie przeniesiona", async () => {
      acceptEntry = entry("apt-old");
      appts = [appt("apt-old", DAY, "scheduled")];
      changeAfterRead({ status: "cancelled" });

      const res = await acceptEarlierSlot("wl-1", "tok");

      expect(res).toMatchObject({ success: true, appointmentId: "apt-new", message: BOOKED_MESSAGE });
      expect(apptUpdates.map((u) => u.affected)).toEqual([0]);
      expect(appts[0]).toMatchObject({ status: "cancelled", start_time: at(DAY) });
      expect(apptInserts).toHaveLength(1);
      expect(st.deposit).toHaveBeenCalledTimes(1);
    });
  });

  it("nowa wizyta (bez powiązania) → komunikat o rezerwacji, bez słowa o przeniesieniu", async () => {
    acceptEntry = entry(null);

    const res = await acceptEarlierSlot("wl-1", "tok");

    expect(res.success).toBe(true);
    expect(res.message).toBe(BOOKED_MESSAGE);
    expect(res.message).not.toMatch(/przeniesion/);
    expect(res.oldStartTime).toBeUndefined();
  });
});

// ─── Przyjęcie oferty: wpis w historii powiadomień ───────────────────────────

describe("przyjęcie oferty: wpis w historii powiadomień", () => {
  const WHEN = START.toLocaleString("pl-PL", { timeZone: "Europe/Warsaw" });
  const PREFIX = "Klient zaakceptowal wczesniejszy termin z listy oczekujacych.";

  it("przeniesienie → jeden wpis systemowy „wysłany” z czasem wysłania i treścią o przeniesieniu; bez wpisu SMS", async () => {
    acceptEntry = entry("apt-old");
    appts = [appt("apt-old", DAY, "scheduled")];

    const res = await acceptEarlierSlot("wl-1", "tok");

    expect(res).toMatchObject({ success: true, appointmentId: "apt-old" });
    expect(notifInserts).toEqual([
      {
        salonId: SALON,
        clientId: CLIENT,
        type: "system",
        message: `${PREFIX} Wizyta apt-old przeniesiona na ${WHEN}.`,
        status: "sent",
        sentAt: NOW,
      },
    ]);
    expect(notifInserts.filter((n) => n.type === "sms")).toEqual([]);
  });

  it("nowa wizyta → wpis systemowy z treścią o rezerwacji, bez słowa o przeniesieniu", async () => {
    acceptEntry = entry(null);

    const res = await acceptEarlierSlot("wl-1", "tok");

    expect(res).toMatchObject({ success: true, appointmentId: "apt-new" });
    expect(notifInserts).toHaveLength(1);
    expect(notifInserts[0]).toMatchObject({
      salonId: SALON,
      clientId: CLIENT,
      type: "system",
      status: "sent",
      sentAt: NOW,
      message: `${PREFIX} Wizyta apt-new zarezerwowana na ${WHEN}.`,
    });
    expect(notifInserts[0]!.message).not.toMatch(/przeniesion/);
  });

  it("odmowa (oferta nieaktualna) → brak wpisu w historii powiadomień", async () => {
    acceptEntry = entry("apt-old");
    appts = [appt("apt-old", DAY, "completed")];

    const res = await acceptEarlierSlot("wl-1", "tok");

    expect(res).toEqual(REFUSED);
    expect(notifInserts).toEqual([]);
  });
});
