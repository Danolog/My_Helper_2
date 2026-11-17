/**
 * Lista oczekujących na PRAWDZIWYM Postgresie: zajęcie wpisu przed wysyłką
 * oferty (warunkowy UPDATE … WHERE notified_at IS NULL AND accepted IS NULL
 * RETURNING) i warunkowe zwolnienie po nieudanej wysyłce (… WHERE accept_token
 * = token z zajęcia AND accepted IS NULL).
 *
 * - wyścig: dwa równoległe `notifyWaitingList` na ten sam wpis, oba odczytały
 *   wpis przed zajęciem → dokładnie jedno zajęcie, jedna oferta, jeden token;
 * - przyjęcie w oknie: `acceptEarlierSlot` w trakcie opóźnionej, nieudanej
 *   wysyłki → wpis przyjęty, pola oferty nietknięte przez zwolnienie, wizyta jest;
 * - zwolniony wpis wraca: po nieudanej wysyłce następne wywołanie go wybiera;
 * - inny salon: wpis salonu B pasujący do terminu (poza salonem) nietknięty.
 *   Ten sam identyfikator wpisu w dwóch salonach nie istnieje (klucz główny
 *   `waiting_list.id`), więc warunek salonu w samym zapisie sprawdza test
 *   jednostkowy; tu — skutek w bazie przy wywołaniu dla salonu A.
 *
 * Niezależność od pory dnia (godziny ciszy SMS 21:00–8:00): każdy klient ma
 * numer telefonu spoza listy numerów testowych ORAZ zweryfikowane konto.
 * `sendSms` i `sendPushNotification` to ta sama atrapa (wynik i opóźnienie
 * sterowane przez test), więc w dzień wychodzą oba kanały, w nocy tylko push —
 * a asercje nie liczą wywołań kanałów, tylko zajęcia (tokeny widziane przez
 * atrapę w chwili wysyłki), wynik `notified` i stan wpisu w bazie. Wynik jest
 * ten sam o każdej porze.
 *
 * Dane: użytkownicy `it-t3-claim-…` (prefiks z notatki sprzątania w pg-harness.ts),
 * dwa salony; reszta kaskadą z salonów w `afterAll`. Każdy przypadek ma własną
 * usługę i własnego klienta, więc wpisy przypadków się nie mieszają.
 * Terminy w 2099 (zawsze w przyszłości).
 *
 * Uruchomienie: `INTEGRATION_POSTGRES_URL=postgresql://…@localhost:5432/pos_dev pnpm test:pg -- __tests__/pg/waiting-list-claim.pg.test.ts`.
 * Wymaga bazy po `pnpm db:migrate` (RLS i rola `myhelper_app`).
 */
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { appointments, clients, employees, salons, services, user, waitingList } from "@/lib/schema";
import { acceptEarlierSlot, notifyWaitingList } from "@/lib/waiting-list";

const h = await vi.hoisted(async () => (await import("./pg-harness")).createIntegrationDb());

type Send = { channel: "sms" | "push"; clientId: string | undefined; token: string | null };

const ctl = vi.hoisted(() => ({
  /** Wynik obu kanałów: true = przyjęta. */
  accept: true,
  /** Opóźnienie każdej wysyłki (ms). */
  delayMs: 0,
  /** Jednorazowy krok wykonywany w trakcie pierwszej wysyłki. */
  onSend: null as null | (() => Promise<void>),
  sends: [] as Send[],
  /** Token wpisu klienta w chwili wysyłki (ustawiane w beforeAll). */
  readToken: async (_clientId: string | undefined): Promise<string | null> => null,
  /** Wołane po każdym `raw` bramy z wynikiem (bariera w teście wyścigu). */
  afterRaw: async (_result: unknown): Promise<void> => {},
}));

/** Wspólna atrapa wysyłki obu kanałów. */
async function fakeSend(channel: Send["channel"], clientId: string | undefined): Promise<boolean> {
  ctl.sends.push({ channel, clientId, token: await ctl.readToken(clientId) });
  const step = ctl.onSend;
  ctl.onSend = null;
  if (step) await step();
  if (ctl.delayMs > 0) await new Promise((r) => setTimeout(r, ctl.delayMs));
  return ctl.accept;
}

vi.mock("@/lib/db", () => ({
  get db() {
    if (!h) throw new Error("INTEGRATION_POSTGRES_URL not set");
    return h.db;
  },
}));
// Prawdziwa brama; po każdym `raw` test może wstrzymać wywołanie (bariera wyścigu).
vi.mock("@/lib/server/repository", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/server/repository")>();
  return {
    ...real,
    forSalon: (salonId: string) => {
      const gate = real.forSalon(salonId);
      return {
        ...gate,
        raw: async <T,>(fn: (tx: never) => Promise<T>): Promise<T> => {
          const result = await gate.raw((tx) => fn(tx as never));
          await ctl.afterRaw(result);
          return result;
        },
      };
    },
  };
});
vi.mock("@/lib/sms", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sms")>()),
  sendSms: async (msg: { clientId?: string }) =>
    (await fakeSend("sms", msg.clientId))
      ? { success: true, notificationId: "it-sms" }
      : { success: false, error: "it: SMS nieprzyjęty" },
}));
vi.mock("@/lib/push", () => ({
  sendPushNotification: async (_userId: string, payload: { clientId?: string }) =>
    (await fakeSend("push", payload.clientId))
      ? { success: true, sent: 1, failed: 0 }
      : { success: false, sent: 0, failed: 1 },
}));
vi.mock("@/lib/features", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/features")>()),
  isModuleFrozen: () => false,
}));
vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const RUN = randomUUID().slice(0, 8);
const PREFIX = `it-t3-claim-${RUN}`;
const OWNER_A = `${PREFIX}-owner-a`;
const OWNER_B = `${PREFIX}-owner-b`;
/** Numer oczywiście fikcyjny (prefiks +48 000 nie jest przydzielany), spoza listy numerów testowych. */
const PHONE = "+48000600799";

const ids = { salonA: "", salonB: "", empA: "" };
const createdUsers: string[] = [OWNER_A, OWNER_B];

let slot = 0;
/** Każdy termin w osobnym, dalekim slocie — bez kolizji. */
function nextSlot() {
  const start = new Date(Date.UTC(2099, 7, 1, 8) + slot++ * 3_600_000);
  return { start, end: new Date(start.getTime() + 1_800_000) };
}

/** Klient salonu z telefonem i zweryfikowanym kontem (e-mail klienta = e-mail konta). */
async function clientWithAccount(salonId: string, tag: string): Promise<string> {
  const userId = `${PREFIX}-${tag}`;
  const email = `${userId}@example.invalid`;
  await h!.db.insert(user).values({ id: userId, name: `IT claim ${tag}`, email, emailVerified: true });
  createdUsers.push(userId);
  const [c] = await h!.db
    .insert(clients)
    .values({ salonId, firstName: "IT", lastName: tag, email, phone: PHONE })
    .returning({ id: clients.id });
  return c!.id;
}

async function serviceOf(salonId: string, tag: string): Promise<string> {
  const [s] = await h!.db
    .insert(services)
    .values({ salonId, name: `IT claim ${tag}`, basePrice: "100.00", baseDuration: 30 })
    .returning({ id: services.id });
  return s!.id;
}

/** Wpis z potwierdzoną prośbą klienta (dodany przez salon). */
async function waitingEntry(salonId: string, clientId: string, serviceId: string | null) {
  const [row] = await h!.db
    .insert(waitingList)
    .values({ salonId, clientId, serviceId, source: "staff", clientRequestConfirmedAt: new Date() })
    .returning();
  return row!;
}

async function entryRow(id: string) {
  const [row] = await h!.db.select().from(waitingList).where(eq(waitingList.id, id));
  return row!;
}

function notify(serviceId: string, s: { start: Date; end: Date }) {
  return notifyWaitingList({
    salonId: ids.salonA,
    serviceId,
    employeeId: ids.empA,
    startTime: s.start,
    endTime: s.end,
    serviceName: "IT claim",
    employeeName: "IT A",
    salonName: "IT claim",
  });
}

const EMPTY_OFFER = {
  notifiedAt: null,
  acceptToken: null,
  offeredStartTime: null,
  offeredEndTime: null,
  offeredEmployeeId: null,
  existingAppointmentId: null,
  accepted: null,
};

const suite = h ? describe : describe.skip;

suite("lista oczekujących: zajęcie wpisu przed wysyłką i warunkowe zwolnienie — prawdziwy Postgres", () => {
  beforeAll(async () => {
    const db = h!.db;
    await db.insert(user).values([
      { id: OWNER_A, name: "IT claim A", email: `${OWNER_A}@example.invalid` },
      { id: OWNER_B, name: "IT claim B", email: `${OWNER_B}@example.invalid` },
    ]);
    const modulesOn = { modules: { waitingList: true } };
    const [a] = await db
      .insert(salons)
      .values({ name: `IT T3 claim A ${RUN}`, ownerId: OWNER_A, settingsJson: modulesOn })
      .returning();
    const [b] = await db
      .insert(salons)
      .values({ name: `IT T3 claim B ${RUN}`, ownerId: OWNER_B, settingsJson: modulesOn })
      .returning();
    ids.salonA = a!.id;
    ids.salonB = b!.id;
    const [ea] = await db.insert(employees).values({ salonId: ids.salonA, firstName: "IT", lastName: "A" }).returning();
    ids.empA = ea!.id;

    ctl.readToken = async (clientId) => {
      if (!clientId) return null;
      const [row] = await h!.db
        .select({ token: waitingList.acceptToken })
        .from(waitingList)
        .where(eq(waitingList.clientId, clientId));
      return row?.token ?? null;
    };
  });

  afterAll(async () => {
    if (!h) return;
    try {
      for (const id of [ids.salonA, ids.salonB]) if (id) await h.db.delete(salons).where(eq(salons.id, id));
      await h.db.delete(user).where(inArray(user.id, createdUsers));
    } finally {
      await h.end();
    }
  });

  beforeEach(() => {
    ctl.accept = true;
    ctl.delayMs = 0;
    ctl.onSend = null;
    ctl.sends = [];
    ctl.afterRaw = async () => {};
  });

  it("dwa równoległe wywołania na ten sam wpis, oba po odczycie wpisu: jedno zajęcie, jedna oferta, token zgodny z wysłaną ofertą", async () => {
    const svc = await serviceOf(ids.salonA, "race");
    const clientId = await clientWithAccount(ids.salonA, "race");
    const entry = await waitingEntry(ids.salonA, clientId, svc);
    const s = nextSlot();
    ctl.delayMs = 200;

    // Bariera: każde wywołanie po odczycie wpisów czeka, aż oba odczytają wpis
    // (dopiero potem zajęcie) — oba konkurują o ten sam, niezajęty wpis.
    let readsWithEntry = 0;
    let release: () => void = () => {};
    const bothRead = new Promise<void>((r) => (release = r));
    ctl.afterRaw = async (result) => {
      const rows = Array.isArray(result) ? (result as Array<{ entry?: { id?: string } }>) : [];
      if (!rows.some((r) => r.entry?.id === entry.id)) return;
      readsWithEntry++;
      if (readsWithEntry >= 2) release();
      await Promise.race([bothRead, new Promise((r) => setTimeout(r, 5_000))]);
    };

    const results = await Promise.all([notify(svc, s), notify(svc, s)]);

    expect(readsWithEntry, "oba wywołania odczytały wpis przed zajęciem").toBe(2);
    expect(results.map((r) => r.notified).sort()).toEqual([0, 1]);
    expect(results.find((r) => r.notified === 0)).toEqual({ notified: 0, smsCount: 0, pushCount: 0, errors: 0 });
    expect(results.find((r) => r.notified === 1)!.errors).toBe(0);

    const tokens = new Set(ctl.sends.map((x) => x.token));
    expect(tokens.size, "wysyłki tylko z jednego zajęcia").toBe(1);
    const row = await entryRow(entry.id);
    expect(row.acceptToken).toMatch(/^[0-9a-f]{64}$/);
    expect([...tokens][0]).toBe(row.acceptToken);
    expect(row.notifiedAt).not.toBeNull();
    expect(row).toMatchObject({ offeredStartTime: s.start, offeredEndTime: s.end, offeredEmployeeId: ids.empA, accepted: null });
  });

  it("przyjęcie przez acceptEarlierSlot w trakcie opóźnionej, nieudanej wysyłki: wpis przyjęty, pola oferty zostają, wizyta jest", async () => {
    const svc = await serviceOf(ids.salonA, "window");
    const clientId = await clientWithAccount(ids.salonA, "window");
    const entry = await waitingEntry(ids.salonA, clientId, svc);
    const s = nextSlot();
    ctl.accept = false;
    ctl.delayMs = 100;
    const accept: { result?: Awaited<ReturnType<typeof acceptEarlierSlot>> } = {};
    ctl.onSend = async () => {
      const token = ctl.sends[0]!.token;
      if (token) accept.result = await acceptEarlierSlot(entry.id, token);
    };

    const res = await notify(svc, s);

    expect(res).toEqual({ notified: 0, smsCount: 0, pushCount: 0, errors: 0 });
    expect(accept.result).toMatchObject({ success: true });
    const token = ctl.sends[0]!.token;
    const row = await entryRow(entry.id);
    expect(row.accepted).toBe(true);
    expect(row.acceptToken).toBe(token);
    expect(row.notifiedAt).not.toBeNull();
    expect(row).toMatchObject({ offeredStartTime: s.start, offeredEndTime: s.end, offeredEmployeeId: ids.empA });
    const appts = await h!.db
      .select({ id: appointments.id, clientId: appointments.clientId })
      .from(appointments)
      .where(and(eq(appointments.salonId, ids.salonA), eq(appointments.startTime, s.start)));
    expect(appts).toEqual([{ id: accept.result?.appointmentId, clientId }]);
  });

  it("nieudana wysyłka: wpis zwolniony; następne wywołanie wybiera go i wysyła ofertę", async () => {
    const svc = await serviceOf(ids.salonA, "back");
    const clientId = await clientWithAccount(ids.salonA, "back");
    const entry = await waitingEntry(ids.salonA, clientId, svc);
    ctl.accept = false;

    const first = await notify(svc, nextSlot());

    expect(first).toEqual({ notified: 0, smsCount: 0, pushCount: 0, errors: 0 });
    expect(ctl.sends.length).toBeGreaterThanOrEqual(1);
    expect(await entryRow(entry.id)).toMatchObject(EMPTY_OFFER);

    ctl.accept = true;
    ctl.sends = [];
    const s2 = nextSlot();
    const second = await notify(svc, s2);

    expect(second.notified).toBe(1);
    expect(second.errors).toBe(0);
    expect(ctl.sends.length).toBeGreaterThanOrEqual(1);
    const row = await entryRow(entry.id);
    expect(row.acceptToken).toMatch(/^[0-9a-f]{64}$/);
    expect(new Set(ctl.sends.map((x) => x.token))).toEqual(new Set([row.acceptToken]));
    expect(row).toMatchObject({ offeredStartTime: s2.start, offeredEndTime: s2.end, accepted: null });
  });

  it("wywołanie dla salonu A: wpis salonu B bez preferencji usługi (pasujący poza salonem) nietknięty, bez wysyłki do jego klienta", async () => {
    const svc = await serviceOf(ids.salonA, "salon-a");
    const clientA = await clientWithAccount(ids.salonA, "salon-a");
    const clientB = await clientWithAccount(ids.salonB, "salon-b");
    const entryA = await waitingEntry(ids.salonA, clientA, svc);
    const entryB = await waitingEntry(ids.salonB, clientB, null);

    const res = await notify(svc, nextSlot());

    expect(res.notified).toBe(1);
    expect((await entryRow(entryA.id)).notifiedAt).not.toBeNull();
    expect(await entryRow(entryB.id)).toMatchObject(EMPTY_OFFER);
    expect(ctl.sends.every((x) => x.clientId === clientA)).toBe(true);
  });
});
