/**
 * Lista oczekujących na PRAWDZIWYM Postgresie: wizyta powiązana z ofertą
 * (`existingAppointmentId`), pełna ścieżka `notifyWaitingList` →
 * `acceptEarlierSlot`.
 *
 * - wizyta zakończona w przeszłości i przyszła wizyta wcześniejsza niż oferta
 *   → wpis bez powiązania;
 * - przyszła wizyta późniejsza niż oferta → przyjęcie ją przenosi: stary
 *   termin wolny, klient ma jedną wizytę tej usługi;
 * - przyszła późniejsza wizyta zakończona przez salon po ofercie → odmowa,
 *   wizyta nietknięta, bez drugiej wizyty, wpis nierozstrzygnięty;
 * - klient z blokadą rezerwacji online (jego karta albo inna karta salonu
 *   z tym samym e-mailem) nie dostaje oferty nowej wizyty, a oferta
 *   przeniesienia istniejącej wizyty wychodzi.
 *
 * Niezależność od pory dnia (godziny ciszy SMS 21:00–8:00): klient ma numer
 * spoza listy numerów testowych ORAZ zweryfikowane konto, a oba kanały to
 * atrapy przyjmujące wiadomość — w nocy wychodzi sam push, wynik ten sam.
 *
 * Dane: użytkownicy `it-t3-linked-…`, jeden salon; reszta kaskadą z salonu
 * w `afterAll`. Każdy przypadek ma własną usługę i własnego klienta. Terminy
 * ofert w 2099 (zawsze w przyszłości).
 *
 * Uruchomienie: `INTEGRATION_POSTGRES_URL=postgresql://…@localhost:5432/pos_dev pnpm test:pg -- __tests__/pg/waiting-list-linked-appointment.pg.test.ts`.
 * Wymaga bazy po `pnpm db:migrate` (RLS i rola `myhelper_app`).
 */
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { appointments, clients, employees, notifications, salons, services, user, waitingList } from "@/lib/schema";
import { acceptEarlierSlot, notifyWaitingList } from "@/lib/waiting-list";

const h = await vi.hoisted(async () => (await import("./pg-harness")).createIntegrationDb());

vi.mock("@/lib/db", () => ({
  get db() {
    if (!h) throw new Error("INTEGRATION_POSTGRES_URL not set");
    return h.db;
  },
}));
vi.mock("@/lib/sms", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sms")>()),
  sendSms: async () => ({ success: true, notificationId: "it-sms" }),
}));
vi.mock("@/lib/push", () => ({
  sendPushNotification: async () => ({ success: true, sent: 1, failed: 0 }),
}));
vi.mock("@/lib/features", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/features")>()),
  isModuleFrozen: () => false,
}));
vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const RUN = randomUUID().slice(0, 8);
const PREFIX = `it-t3-linked-${RUN}`;
const OWNER = `${PREFIX}-owner`;
/** Numer oczywiście fikcyjny (prefiks +48 000 nie jest przydzielany), spoza listy numerów testowych. */
const PHONE = "+48000600798";
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const ids = { salon: "", empOffer: "", empOther: "" };
const createdUsers: string[] = [OWNER];

let slot = 0;
/** Każda oferta w osobnym dniu 2099 — wizyty przypadków się nie nakładają. */
function nextOffer() {
  const start = new Date(Date.UTC(2099, 8, 1 + slot++ * 7, 10));
  return { start, end: new Date(start.getTime() + HOUR) };
}

async function clientWithAccount(
  tag: string,
  card: Partial<typeof clients.$inferInsert> = {}
): Promise<string> {
  const userId = `${PREFIX}-${tag}`;
  const email = `${userId}@example.invalid`;
  await h!.db.insert(user).values({ id: userId, name: `IT linked ${tag}`, email, emailVerified: true });
  createdUsers.push(userId);
  const [c] = await h!.db
    .insert(clients)
    .values({ salonId: ids.salon, firstName: "IT", lastName: tag, email, phone: PHONE, ...card })
    .returning({ id: clients.id });
  return c!.id;
}

async function serviceOf(tag: string): Promise<string> {
  const [s] = await h!.db
    .insert(services)
    .values({ salonId: ids.salon, name: `IT linked ${tag}`, basePrice: "100.00", baseDuration: 60 })
    .returning({ id: services.id });
  return s!.id;
}

/** Wizyta klienta u „drugiego” pracownika (nie koliduje z ofertą u pracownika oferty). */
async function visit(clientId: string, serviceId: string, start: Date, status: string): Promise<string> {
  const [a] = await h!.db
    .insert(appointments)
    .values({
      salonId: ids.salon,
      clientId,
      employeeId: ids.empOther,
      serviceId,
      startTime: start,
      endTime: new Date(start.getTime() + HOUR),
      status,
    })
    .returning({ id: appointments.id });
  return a!.id;
}

async function waitingEntry(clientId: string, serviceId: string) {
  const [row] = await h!.db
    .insert(waitingList)
    .values({ salonId: ids.salon, clientId, serviceId, source: "staff", clientRequestConfirmedAt: new Date() })
    .returning();
  return row!;
}

async function entryRow(id: string) {
  const [row] = await h!.db.select().from(waitingList).where(eq(waitingList.id, id));
  return row!;
}

async function clientVisits(clientId: string, serviceId: string) {
  return h!.db
    .select({ id: appointments.id, startTime: appointments.startTime, status: appointments.status, employeeId: appointments.employeeId })
    .from(appointments)
    .where(and(eq(appointments.clientId, clientId), eq(appointments.serviceId, serviceId)));
}

async function salonNotifications(type: string) {
  return h!.db
    .select({ id: notifications.id, message: notifications.message, status: notifications.status })
    .from(notifications)
    .where(and(eq(notifications.salonId, ids.salon), eq(notifications.type, type)));
}

async function notify(serviceId: string, s: { start: Date; end: Date }) {
  const res = await notifyWaitingList({
    salonId: ids.salon,
    serviceId,
    employeeId: ids.empOffer,
    startTime: s.start,
    endTime: s.end,
    serviceName: "IT linked",
    employeeName: "IT oferta",
    salonName: "IT linked",
  });
  expect(res).toMatchObject({ notified: 1, errors: 0 });
}

const suite = h ? describe : describe.skip;

suite("lista oczekujących: powiązana wizyta przy ofercie i przyjęciu — prawdziwy Postgres", () => {
  beforeAll(async () => {
    const db = h!.db;
    await db.insert(user).values({ id: OWNER, name: "IT linked", email: `${OWNER}@example.invalid` });
    const [s] = await db
      .insert(salons)
      .values({ name: `IT T3 linked ${RUN}`, ownerId: OWNER, settingsJson: { modules: { waitingList: true } } })
      .returning();
    ids.salon = s!.id;
    const [e1] = await db.insert(employees).values({ salonId: ids.salon, firstName: "IT", lastName: "Oferta" }).returning();
    const [e2] = await db.insert(employees).values({ salonId: ids.salon, firstName: "IT", lastName: "Inny" }).returning();
    ids.empOffer = e1!.id;
    ids.empOther = e2!.id;
  });

  afterAll(async () => {
    if (!h) return;
    try {
      if (ids.salon) await h.db.delete(salons).where(eq(salons.id, ids.salon));
      await h.db.delete(user).where(inArray(user.id, createdUsers));
    } finally {
      await h.end();
    }
  });

  it("wizyta zakończona w przeszłości i przyszła wcześniejsza niż oferta → wpis bez powiązania", async () => {
    const svc = await serviceOf("none");
    const clientId = await clientWithAccount("none");
    const offer = nextOffer();
    await visit(clientId, svc, new Date(Date.UTC(2020, 0, 10, 10)), "completed");
    await visit(clientId, svc, new Date(offer.start.getTime() - DAY), "scheduled");
    const entry = await waitingEntry(clientId, svc);

    await notify(svc, offer);

    const row = await entryRow(entry.id);
    expect(row.notifiedAt).not.toBeNull();
    expect(row.existingAppointmentId).toBeNull();
  });

  it("przyszła wizyta późniejsza niż oferta → przyjęcie ją przenosi; stary termin wolny, jedna wizyta klienta", async () => {
    const svc = await serviceOf("move");
    const clientId = await clientWithAccount("move");
    const offer = nextOffer();
    const oldStart = new Date(offer.start.getTime() + 2 * DAY);
    const apptId = await visit(clientId, svc, oldStart, "scheduled");
    const entry = await waitingEntry(clientId, svc);

    await notify(svc, offer);
    const offered = await entryRow(entry.id);
    expect(offered.existingAppointmentId).toBe(apptId);
    const smsBefore = await salonNotifications("sms");
    const systemBefore = await salonNotifications("system");

    const res = await acceptEarlierSlot(entry.id, offered.acceptToken!);

    const systemAfter = await salonNotifications("system");
    const systemNew = systemAfter.filter((n) => !systemBefore.some((b) => b.id === n.id));
    expect(systemNew).toEqual([
      expect.objectContaining({ status: "sent", message: expect.stringContaining(`Wizyta ${apptId} przeniesiona na`) }),
    ]);
    expect(await salonNotifications("sms")).toEqual(smsBefore);
    expect(res).toMatchObject({ success: true, appointmentId: apptId, oldStartTime: oldStart, newStartTime: offer.start });
    expect(res.message).toMatch(/przeniesiona/);
    expect(await clientVisits(clientId, svc)).toEqual([
      { id: apptId, startTime: offer.start, status: "scheduled", employeeId: ids.empOffer },
    ]);
    const atOldStart = await h!.db
      .select({ id: appointments.id })
      .from(appointments)
      .where(and(eq(appointments.salonId, ids.salon), eq(appointments.startTime, oldStart)));
    expect(atOldStart).toEqual([]);
    expect((await entryRow(entry.id)).accepted).toBe(true);
  });

  it("przyszła późniejsza wizyta zakończona przez salon po ofercie → odmowa, wizyta nietknięta, bez drugiej wizyty", async () => {
    const svc = await serviceOf("refuse");
    const clientId = await clientWithAccount("refuse");
    const offer = nextOffer();
    const oldStart = new Date(offer.start.getTime() + 2 * DAY);
    const apptId = await visit(clientId, svc, oldStart, "scheduled");
    const entry = await waitingEntry(clientId, svc);

    await notify(svc, offer);
    const offered = await entryRow(entry.id);
    expect(offered.existingAppointmentId).toBe(apptId);
    await h!.db.update(appointments).set({ status: "completed" }).where(eq(appointments.id, apptId));

    const res = await acceptEarlierSlot(entry.id, offered.acceptToken!);

    expect(res).toEqual({ success: false, message: "Oferta nie jest już aktualna" });
    expect(await clientVisits(clientId, svc)).toEqual([
      { id: apptId, startTime: oldStart, status: "completed", employeeId: ids.empOther },
    ]);
    const atOffer = await h!.db
      .select({ id: appointments.id })
      .from(appointments)
      .where(and(eq(appointments.salonId, ids.salon), eq(appointments.startTime, offer.start)));
    expect(atOffer).toEqual([]);
    expect((await entryRow(entry.id)).accepted).toBeNull();
  });

  describe("klient z blokadą rezerwacji online", () => {
    /**
     * Własny numer każdego klienta tej grupy: zablokowana karta z numerem
     * PHONE dopasowałaby wpisy pozostałych przypadków (ten sam klient po numerze).
     */
    const blockedCard = () => ({ blockedAt: new Date(), blockedBy: OWNER });

    async function notifyRaw(serviceId: string, s: { start: Date; end: Date }) {
      return notifyWaitingList({
        salonId: ids.salon,
        serviceId,
        employeeId: ids.empOffer,
        startTime: s.start,
        endTime: s.end,
        serviceName: "IT linked",
        employeeName: "IT oferta",
        salonName: "IT linked",
      });
    }

    it("karta wpisu zablokowana, brak wizyty do przeniesienia → bez oferty, wpis nietknięty", async () => {
      const svc = await serviceOf("blocked-new");
      const clientId = await clientWithAccount("blocked-new", { phone: "+48000600796", ...blockedCard() });
      const entry = await waitingEntry(clientId, svc);

      const res = await notifyRaw(svc, nextOffer());

      expect(res).toMatchObject({ notified: 0, errors: 0 });
      const row = await entryRow(entry.id);
      expect(row.notifiedAt).toBeNull();
      expect(row.acceptToken).toBeNull();
    });

    it("inna zablokowana karta z tym samym e-mailem (wielkie litery) → bez oferty nowej wizyty", async () => {
      const svc = await serviceOf("blocked-twin");
      const clientId = await clientWithAccount("blocked-twin", { phone: "+48000600795" });
      await h!.db.insert(clients).values({
        salonId: ids.salon,
        firstName: "IT",
        lastName: "blocked-twin-2",
        email: `${PREFIX}-blocked-twin@example.invalid`.toUpperCase(),
        ...blockedCard(),
      });
      const entry = await waitingEntry(clientId, svc);

      const res = await notifyRaw(svc, nextOffer());

      expect(res).toMatchObject({ notified: 0, errors: 0 });
      expect((await entryRow(entry.id)).notifiedAt).toBeNull();
    });

    it("karta wpisu zablokowana, późniejsza wizyta do przeniesienia → oferta przeniesienia wychodzi", async () => {
      const svc = await serviceOf("blocked-move");
      const clientId = await clientWithAccount("blocked-move", { phone: "+48000600794", ...blockedCard() });
      const offer = nextOffer();
      const apptId = await visit(clientId, svc, new Date(offer.start.getTime() + 2 * DAY), "scheduled");
      const entry = await waitingEntry(clientId, svc);

      await notify(svc, offer);

      const row = await entryRow(entry.id);
      expect(row.notifiedAt).not.toBeNull();
      expect(row.existingAppointmentId).toBe(apptId);
    });
  });
});
