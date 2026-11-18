/**
 * #193 P5a-1 na PRAWDZIWYM Postgresie: biblioteki powiadomień przez
 * `forSalon(salonId)` (rola bez BYPASSRLS + `app.current_salon_id`) i wyjścia
 * `system/` (pula systemowa).
 *
 * Stara ścieżka (§2b): funkcje wołane DOKŁADNIE tak jak w plikach wywołujących
 * (bez nowych parametrów), skutek ten sam co przed P5a-1:
 * - `sendSms` / `sendPaymentConfirmationSms`: wiersz `notifications` (sms) w salonie wiadomości;
 * - `sendPushNotification`: wiersz `notifications` (push); 404/410 kasuje tylko tę subskrypcję;
 * - `notifyWaitingList`: `notifiedAt`, `acceptToken`, `offered*`; tylko wpisy z potwierdzoną
 *   prośbą klienta (wpis `legacy` bez potwierdzenia nietknięty, bez wysyłki);
 * - `acceptEarlierSlot`: wizyta + `accepted = true`; odmowa przy zadatku (#63) i przy
 *   wyłączonym module listy oczekujących w salonie;
 * - `confirmDepositPayment`: błąd zapisu notyfikacji SMS nie cofa potwierdzenia wpłaty.
 *
 * Wyjścia `system/`:
 * - `deleteUndeliverablePushSubscriptions`: nie rusza innego endpointu tego samego
 *   użytkownika ani tego samego id podanego z innym użytkownikiem; pusta lista = 0;
 * - `resolveWaitingListToken`: token nieznany → null i brak zapisu; token salonu A
 *   nie zmienia danych salonu B.
 * - brama: zapis notyfikacji z obcym `salon_id` w `forSalon(A)` → 42501 (RLS WITH CHECK);
 * - brama: nakładający się insert wizyty w `raw` → `isAppointmentSlotTaken` (23P01, #171);
 * - notifyWaitingList z powiązanym, zweryfikowanym kontem: push dochodzi do skutku.
 *
 * Dane: użytkownicy `it-t3-p5a-…` (prefiks z notatki sprzątania w pg-harness.ts),
 * dwa salony; reszta kaskadą z salonów w `afterAll`.
 * Uruchomienie: `INTEGRATION_POSTGRES_URL=postgresql://…@localhost:5432/pos_dev pnpm test:pg -- __tests__/pg/p5a-libraries.pg.test.ts`.
 * Wymaga bazy po `pnpm db:migrate` (RLS i rola `myhelper_app`).
 */
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { dbErrorCode, isAppointmentSlotTaken } from "@/lib/appointment-overlap";
import { confirmDepositPayment } from "@/lib/deposit-confirmation";
import { sendPushNotification } from "@/lib/push";
import {
  appointments,
  clients,
  depositPayments,
  employees,
  notifications,
  pushSubscriptions,
  salons,
  services,
  user,
  waitingList,
} from "@/lib/schema";
import { forSalon } from "@/lib/server/repository";
import { deleteUndeliverablePushSubscriptions, resolveWaitingListToken } from "@/lib/server/system";
import { sendSms } from "@/lib/sms";
import { acceptEarlierSlot, declineEarlierSlot, notifyWaitingList } from "@/lib/waiting-list";
import { VALID_AUTH, VALID_ENDPOINTS, VALID_P256DH } from "../fixtures/push-subscriptions";

const h = await vi.hoisted(async () => (await import("./pg-harness")).createIntegrationDb());
const ctl = vi.hoisted(() => ({ failNotificationInsert: false, webpush: vi.fn() }));

vi.mock("@/lib/db", () => ({
  get db() {
    if (!h) throw new Error("INTEGRATION_POSTGRES_URL not set");
    return h.db;
  },
}));
// Prawdziwa brama; na żądanie testu insert do `notifications` w jej transakcji rzuca
// (symulacja błędu zapisu notyfikacji), reszta zapytań bez zmian.
vi.mock("@/lib/server/repository", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/server/repository")>();
  const { notifications: notificationsTable } = await import("@/lib/schema");
  return {
    ...real,
    forSalon: (salonId: string) => {
      const gate = real.forSalon(salonId);
      return {
        ...gate,
        raw: <T,>(fn: (tx: never) => Promise<T>) =>
          gate.raw((tx) => {
            if (!ctl.failNotificationInsert) return fn(tx as never);
            const wrapped = new Proxy(tx as object, {
              get(target, prop, receiver) {
                const value = Reflect.get(target, prop, receiver) as unknown;
                if (prop !== "insert" || typeof value !== "function") return value;
                return (table: unknown) => {
                  if (table === notificationsTable) throw new Error("it: zapis notyfikacji odrzucony");
                  return (value as (t: unknown) => unknown).call(target, table);
                };
              },
            });
            return fn(wrapped as never);
          }),
      };
    },
  };
});
vi.mock("web-push", () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: (...a: unknown[]) => ctl.webpush(...a),
  },
}));
vi.mock("@/lib/features", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/features")>()),
  isModuleFrozen: () => false,
}));
vi.mock("@/lib/stripe", () => ({ getStripe: () => ({ refunds: { create: vi.fn() } }) }));
vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const RUN = randomUUID().slice(0, 8);
const OWNER_A = `it-t3-p5a-a-${RUN}`;
const OWNER_B = `it-t3-p5a-b-${RUN}`;
const CLIENT_USER_A = `it-t3-p5a-ca-${RUN}`;
const CLIENT_USER_B = `it-t3-p5a-cb-${RUN}`;
const CLIENT_USER_L = `it-t3-p5a-cl-${RUN}`;
const CLIENT_EMAIL_A = `${CLIENT_USER_A}@example.invalid`;
const CLIENT_EMAIL_L = `${CLIENT_USER_L}@example.invalid`;
const PHONE = "+48512345678";
/** Wpis z potwierdzoną prośbą klienta (dodany przez salon). */
const CONFIRMED = () => ({ source: "staff", clientRequestConfirmedAt: new Date() });

const ids = {
  salonA: "",
  salonB: "",
  empA: "",
  empB: "",
  svcA: "",
  svcDepositA: "",
  svcB: "",
  clientA: "",
  clientB: "",
};
let slot = 0;
/** Każdy termin w osobnym, dalekim slocie — bez kolizji. */
function nextSlot() {
  const start = new Date(Date.UTC(2099, 5, 1, 8) + slot++ * 3_600_000);
  return { start, end: new Date(start.getTime() + 1_800_000) };
}

function pgCode(e: unknown): string | undefined {
  const err = e as { code?: string; cause?: { code?: string } };
  return err?.code ?? err?.cause?.code;
}

async function notificationRows(salonId: string, type: string) {
  return h!.db.select().from(notifications).where(and(eq(notifications.salonId, salonId), eq(notifications.type, type)));
}

async function pushSub(userId: string, endpoint: string) {
  const [row] = await h!.db
    .insert(pushSubscriptions)
    .values({ userId, endpoint, p256dh: VALID_P256DH, auth: VALID_AUTH })
    .returning({ id: pushSubscriptions.id });
  return row!.id;
}

async function waitingEntry(salonId: string, clientId: string, extra: Partial<typeof waitingList.$inferInsert> = {}) {
  const [row] = await h!.db.insert(waitingList).values({ salonId, clientId, ...extra }).returning();
  return row!;
}

const suite = h ? describe : describe.skip;

suite("P5a-1: biblioteki przez forSalon i wyjścia system/ — prawdziwy Postgres", () => {
  beforeAll(async () => {
    const db = h!.db;
    await db.insert(user).values([
      { id: OWNER_A, name: "IT T3 p5a A", email: `${OWNER_A}@example.invalid` },
      { id: OWNER_B, name: "IT T3 p5a B", email: `${OWNER_B}@example.invalid` },
      { id: CLIENT_USER_A, name: "IT T3 p5a klient A", email: CLIENT_EMAIL_A, emailVerified: true },
      { id: CLIENT_USER_B, name: "IT T3 p5a klient B", email: `${CLIENT_USER_B}@example.invalid` },
      { id: CLIENT_USER_L, name: "IT T3 p5a klient L", email: CLIENT_EMAIL_L, emailVerified: true },
    ]);
    // Salon A: moduł listy oczekujących włączony (notifyWaitingList wysyła tylko wtedy).
    const [a] = await db
      .insert(salons)
      .values({ name: `IT T3 p5a A ${RUN}`, ownerId: OWNER_A, settingsJson: { modules: { waitingList: true } } })
      .returning();
    const [b] = await db.insert(salons).values({ name: `IT T3 p5a B ${RUN}`, ownerId: OWNER_B }).returning();
    ids.salonA = a!.id;
    ids.salonB = b!.id;
    const [ea] = await db.insert(employees).values({ salonId: ids.salonA, firstName: "IT", lastName: "A" }).returning();
    const [eb] = await db.insert(employees).values({ salonId: ids.salonB, firstName: "IT", lastName: "B" }).returning();
    ids.empA = ea!.id;
    ids.empB = eb!.id;
    const [sa] = await db
      .insert(services)
      .values({ salonId: ids.salonA, name: "IT Usługa A", basePrice: "100.00", baseDuration: 30 })
      .returning();
    const [sd] = await db
      .insert(services)
      .values({ salonId: ids.salonA, name: "IT Usługa A zadatek", basePrice: "100.00", baseDuration: 30, depositRequired: true })
      .returning();
    const [sb] = await db
      .insert(services)
      .values({ salonId: ids.salonB, name: "IT Usługa B", basePrice: "100.00", baseDuration: 30 })
      .returning();
    ids.svcA = sa!.id;
    ids.svcDepositA = sd!.id;
    ids.svcB = sb!.id;
    const [ca] = await db
      .insert(clients)
      .values({ salonId: ids.salonA, firstName: "Jan", lastName: "A", email: CLIENT_EMAIL_A, phone: PHONE })
      .returning();
    const [cb] = await db
      .insert(clients)
      .values({ salonId: ids.salonB, firstName: "Ewa", lastName: "B", phone: PHONE })
      .returning();
    ids.clientA = ca!.id;
    ids.clientB = cb!.id;
  });

  afterAll(async () => {
    if (!h) return;
    try {
      for (const id of [ids.salonA, ids.salonB]) if (id) await h.db.delete(salons).where(eq(salons.id, id));
      await h.db.delete(user).where(inArray(user.id, [OWNER_A, OWNER_B, CLIENT_USER_A, CLIENT_USER_B, CLIENT_USER_L]));
    } finally {
      await h.end();
    }
  });

  beforeEach(() => {
    ctl.failNotificationInsert = false;
    ctl.webpush.mockReset();
    ctl.webpush.mockResolvedValue({ statusCode: 201 });
    vi.stubEnv("SMSAPI_TOKEN", "");
  });

  // ------------------------------------------------------------ brama salonu

  it("brama: notyfikacja z obcym salon_id w forSalon(A) → 42501, nic nie zapisane", async () => {
    const before = (await notificationRows(ids.salonB, "sms")).length;
    let code: string | undefined;
    try {
      await forSalon(ids.salonA).raw((tx) =>
        tx.insert(notifications).values({ salonId: ids.salonB, type: "sms", message: "it obcy", status: "sent" })
      );
    } catch (e) {
      code = pgCode(e);
    }
    expect(code).toBe("42501");
    expect((await notificationRows(ids.salonB, "sms")).length).toBe(before);
  });

  // ------------------------------------------------------------ sms (stara ścieżka)

  it("sendSms jak w trasach: wiersz notifications (sms, sent) w salonie wiadomości", async () => {
    const message = `it-sms-${randomUUID()}`;
    const res = await sendSms({ to: PHONE, message, salonId: ids.salonA, clientId: ids.clientA });
    expect(res.success).toBe(true);
    const rows = (await notificationRows(ids.salonA, "sms")).filter((r) => r.message === message);
    expect(rows).toEqual([expect.objectContaining({ id: res.notificationId, clientId: ids.clientA, status: "sent" })]);
  });

  it("confirmDepositPayment: błąd zapisu notyfikacji SMS nie cofa potwierdzenia wpłaty", async () => {
    const { start, end } = nextSlot();
    const [appt] = await h!.db
      .insert(appointments)
      .values({
        salonId: ids.salonA,
        employeeId: ids.empA,
        serviceId: ids.svcA,
        startTime: start,
        endTime: end,
        status: "scheduled",
        depositPaid: false,
        guestName: "IT Gość",
        guestPhone: PHONE,
      })
      .returning();
    const [payment] = await h!.db
      .insert(depositPayments)
      .values({
        appointmentId: appt!.id,
        salonId: ids.salonA,
        amount: "30.00",
        paymentMethod: "stripe",
        status: "pending",
        stripePaymentIntentId: `cs_it_${randomUUID().slice(0, 8)}`,
      })
      .returning();
    const smsBefore = (await notificationRows(ids.salonA, "sms")).length;

    ctl.failNotificationInsert = true;
    const res = await confirmDepositPayment(payment!.id, { paymentIntentId: `pi_it_${RUN}` });
    ctl.failNotificationInsert = false;

    expect(res).toMatchObject({ success: true, alreadyConfirmed: false, smsSent: false });
    const [p] = await h!.db.select().from(depositPayments).where(eq(depositPayments.id, payment!.id));
    const [a] = await h!.db.select().from(appointments).where(eq(appointments.id, appt!.id));
    expect(p!.status).toBe("succeeded");
    expect(a).toMatchObject({ status: "confirmed", depositPaid: true });
    expect((await notificationRows(ids.salonA, "sms")).length).toBe(smsBefore);
  });

  // ------------------------------------------------------------ push

  it("deleteUndeliverablePushSubscriptions: tylko wskazane id TEGO użytkownika; pusta lista = 0", async () => {
    const a1 = await pushSub(CLIENT_USER_A, `${VALID_ENDPOINTS.chromeFcm}-a1`);
    const a2 = await pushSub(CLIENT_USER_A, `${VALID_ENDPOINTS.chromeFcm}-a2`);
    const b1 = await pushSub(CLIENT_USER_B, `${VALID_ENDPOINTS.chromeFcm}-b1`);

    expect(await deleteUndeliverablePushSubscriptions(CLIENT_USER_A, [])).toBe(0);
    // id użytkownika B podane z użytkownikiem A nie znika
    expect(await deleteUndeliverablePushSubscriptions(CLIENT_USER_A, [a1, b1])).toBe(1);

    const left = await h!.db
      .select({ id: pushSubscriptions.id })
      .from(pushSubscriptions)
      .where(inArray(pushSubscriptions.id, [a1, a2, b1]));
    expect(left.map((r) => r.id).sort()).toEqual([a2, b1].sort());
    await h!.db.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, [a2, b1]));
  });

  it("sendPushNotification jak w trasach: notyfikacja (push) w salonie; 410 kasuje tylko tę subskrypcję", async () => {
    const ok = await pushSub(CLIENT_USER_B, `${VALID_ENDPOINTS.chromeFcm}-ok`);
    const gone = await pushSub(CLIENT_USER_B, `${VALID_ENDPOINTS.chromeFcm}-gone`);
    ctl.webpush.mockImplementation(async (sub: { endpoint: string }) => {
      if (sub.endpoint.endsWith("-gone")) throw Object.assign(new Error("gone"), { statusCode: 410 });
      return { statusCode: 201 };
    });
    const title = `it-push-${randomUUID()}`;

    const res = await sendPushNotification(CLIENT_USER_B, { title, body: "B", salonId: ids.salonB });

    expect(res).toMatchObject({ success: true, sent: 1, failed: 1 });
    const rows = (await notificationRows(ids.salonB, "push")).filter((r) => r.message.startsWith(title));
    expect(rows).toEqual([expect.objectContaining({ id: res.notificationId, status: "sent" })]);
    const left = await h!.db
      .select({ id: pushSubscriptions.id })
      .from(pushSubscriptions)
      .where(inArray(pushSubscriptions.id, [ok, gone]));
    expect(left.map((r) => r.id)).toEqual([ok]);
    await h!.db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, ok));
  });

  // ------------------------------------------------------------ waiting-list

  it("notifyWaitingList jak w trasach: notifiedAt, acceptToken, offered* ustawione; wpis salonu B nietknięty", async () => {
    const sub = await pushSub(CLIENT_USER_A, `${VALID_ENDPOINTS.chromeFcm}-wl`);
    const entryA = await waitingEntry(ids.salonA, ids.clientA, { serviceId: ids.svcA, ...CONFIRMED() });
    const entryB = await waitingEntry(ids.salonB, ids.clientB, { serviceId: ids.svcB });
    const { start, end } = nextSlot();

    const res = await notifyWaitingList({
      salonId: ids.salonA,
      serviceId: ids.svcA,
      employeeId: ids.empA,
      startTime: start,
      endTime: end,
      serviceName: "IT Usługa A",
      employeeName: "IT A",
      salonName: "IT A",
    });

    expect(res.notified).toBeGreaterThanOrEqual(1);
    const [a] = await h!.db.select().from(waitingList).where(eq(waitingList.id, entryA.id));
    expect(a!.notifiedAt).not.toBeNull();
    expect(a!.acceptToken).toMatch(/^[0-9a-f]{64}$/);
    expect(a).toMatchObject({ offeredStartTime: start, offeredEndTime: end, offeredEmployeeId: ids.empA });
    const [b] = await h!.db.select().from(waitingList).where(eq(waitingList.id, entryB.id));
    expect(b).toMatchObject({ notifiedAt: null, acceptToken: null, accepted: null });
    await h!.db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub));
  });

  it("notifyWaitingList, powiązane konto: odczyt konta przez bramę działa, push dochodzi do skutku", async () => {
    const endpoint = `${VALID_ENDPOINTS.chromeFcm}-linked-${RUN}`;
    const sub = await pushSub(CLIENT_USER_A, endpoint);
    const entry = await waitingEntry(ids.salonA, ids.clientA, { serviceId: ids.svcA, ...CONFIRMED() });
    const { start, end } = nextSlot();
    const salonName = `IT linked ${RUN}`;

    const res = await notifyWaitingList({
      salonId: ids.salonA,
      serviceId: ids.svcA,
      employeeId: ids.empA,
      startTime: start,
      endTime: end,
      serviceName: "IT Usługa A",
      employeeName: "IT A",
      salonName,
    });

    expect(res.pushCount).toBeGreaterThanOrEqual(1);
    // konto znalezione po e-mailu klienta (zweryfikowane) → wysyłka na jego subskrypcję
    const endpoints = ctl.webpush.mock.calls.map((c) => (c[0] as { endpoint: string }).endpoint);
    expect(endpoints).toContain(endpoint);
    const pushRows = (await notificationRows(ids.salonA, "push")).filter((r) => r.message.includes(salonName));
    expect(pushRows.length).toBeGreaterThanOrEqual(1);
    expect(pushRows.every((r) => r.status === "sent" && r.clientId === ids.clientA)).toBe(true);
    const [after] = await h!.db.select().from(waitingList).where(eq(waitingList.id, entry.id));
    expect(after!.notifiedAt).not.toBeNull();
    await h!.db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub));
  });

  it("notifyWaitingList: wpis legacy bez potwierdzenia → brak wysyłki i oznaczenia; wpis potwierdzony → powiadomiony", async () => {
    // Klient wpisu legacy ma zweryfikowane konto z subskrypcją: kanał wysyłki jest dostępny.
    const [clientL] = await h!.db
      .insert(clients)
      .values({ salonId: ids.salonA, firstName: "Lena", lastName: "L", email: CLIENT_EMAIL_L, phone: PHONE })
      .returning();
    const endpointL = `${VALID_ENDPOINTS.chromeFcm}-legacy-${RUN}`;
    const endpointA = `${VALID_ENDPOINTS.chromeFcm}-confirmed-${RUN}`;
    const subL = await pushSub(CLIENT_USER_L, endpointL);
    const subA = await pushSub(CLIENT_USER_A, endpointA);
    const legacy = await waitingEntry(ids.salonA, clientL!.id, { serviceId: ids.svcA });
    expect(legacy).toMatchObject({ source: "legacy", clientRequestConfirmedAt: null });
    const confirmed = await waitingEntry(ids.salonA, ids.clientA, { serviceId: ids.svcA, ...CONFIRMED() });
    const { start, end } = nextSlot();
    const salonName = `IT legacy ${RUN}`;

    const res = await notifyWaitingList({
      salonId: ids.salonA,
      serviceId: ids.svcA,
      employeeId: ids.empA,
      startTime: start,
      endTime: end,
      serviceName: "IT Usługa A",
      employeeName: "IT A",
      salonName,
    });

    expect(res.notified).toBeGreaterThanOrEqual(1);
    const endpoints = ctl.webpush.mock.calls.map((c) => (c[0] as { endpoint: string }).endpoint);
    expect(endpoints).toContain(endpointA);
    expect(endpoints).not.toContain(endpointL);

    const [l] = await h!.db.select().from(waitingList).where(eq(waitingList.id, legacy.id));
    expect(l).toMatchObject({
      notifiedAt: null,
      acceptToken: null,
      offeredStartTime: null,
      offeredEndTime: null,
      offeredEmployeeId: null,
      accepted: null,
    });
    const pushRows = (await notificationRows(ids.salonA, "push")).filter((r) => r.message.includes(salonName));
    expect(pushRows.filter((r) => r.clientId === clientL!.id)).toEqual([]);
    expect(pushRows.some((r) => r.clientId === ids.clientA && r.status === "sent")).toBe(true);

    const [c] = await h!.db.select().from(waitingList).where(eq(waitingList.id, confirmed.id));
    expect(c!.notifiedAt).not.toBeNull();
    expect(c!.acceptToken).toMatch(/^[0-9a-f]{64}$/);
    expect(c).toMatchObject({ offeredStartTime: start, offeredEndTime: end, offeredEmployeeId: ids.empA });
    await h!.db.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, [subL, subA]));
  });

  it("N2: nakładający się insert wizyty w forSalon(...).raw → isAppointmentSlotTaken = true (23P01 przez bramę)", async () => {
    const { start, end } = nextSlot();
    const base = { salonId: ids.salonA, employeeId: ids.empA, serviceId: ids.svcA, status: "scheduled" as const };
    await forSalon(ids.salonA).raw((tx) =>
      tx.insert(appointments).values({ ...base, startTime: start, endTime: end, guestName: "IT N2 a" })
    );

    let caught: unknown;
    try {
      await forSalon(ids.salonA).raw((tx) =>
        tx
          .insert(appointments)
          .values({ ...base, startTime: new Date(start.getTime() + 60_000), endTime: end, guestName: "IT N2 b" })
      );
    } catch (e) {
      caught = e;
    }

    expect(caught, "drugi insert miał zostać odrzucony przez EXCLUDE").toBeDefined();
    expect(dbErrorCode(caught)).toBe("23P01");
    expect(isAppointmentSlotTaken(caught)).toBe(true);
  });

  it("resolveWaitingListToken: token nieznany → null; accept/decline z nim → odmowa, brak zapisu", async () => {
    const { start, end } = nextSlot();
    const entry = await waitingEntry(ids.salonA, ids.clientA, {
      serviceId: ids.svcA,
      notifiedAt: new Date(),
      acceptToken: `it-${randomUUID()}`,
      offeredStartTime: start,
      offeredEndTime: end,
      offeredEmployeeId: ids.empA,
    });
    expect(await resolveWaitingListToken(`it-nieznany-${randomUUID()}`)).toBeNull();
    expect(await resolveWaitingListToken(entry.acceptToken!)).toEqual({ waitingListId: entry.id, salonId: ids.salonA });

    expect((await acceptEarlierSlot(entry.id, `it-nieznany-${randomUUID()}`)).success).toBe(false);
    expect((await declineEarlierSlot(entry.id, `it-nieznany-${randomUUID()}`)).success).toBe(false);
    const [after] = await h!.db.select().from(waitingList).where(eq(waitingList.id, entry.id));
    expect(after!.accepted).toBeNull();
    const created = await h!.db
      .select({ id: appointments.id })
      .from(appointments)
      .where(and(eq(appointments.salonId, ids.salonA), eq(appointments.startTime, start)));
    expect(created).toEqual([]);
  });

  it("token salonu A z id wpisu salonu B → odmowa; dane obu salonów bez zmian", async () => {
    const slotA = nextSlot();
    const slotB = nextSlot();
    const entryA = await waitingEntry(ids.salonA, ids.clientA, {
      serviceId: ids.svcA,
      notifiedAt: new Date(),
      acceptToken: `it-a-${randomUUID()}`,
      offeredStartTime: slotA.start,
      offeredEndTime: slotA.end,
      offeredEmployeeId: ids.empA,
    });
    const entryB = await waitingEntry(ids.salonB, ids.clientB, {
      serviceId: ids.svcB,
      notifiedAt: new Date(),
      acceptToken: `it-b-${randomUUID()}`,
      offeredStartTime: slotB.start,
      offeredEndTime: slotB.end,
      offeredEmployeeId: ids.empB,
    });

    expect((await acceptEarlierSlot(entryB.id, entryA.acceptToken!)).success).toBe(false);
    expect((await declineEarlierSlot(entryB.id, entryA.acceptToken!)).success).toBe(false);

    const rows = await h!.db.select().from(waitingList).where(inArray(waitingList.id, [entryA.id, entryB.id]));
    expect(rows.map((r) => r.accepted)).toEqual([null, null]);
    const created = await h!.db
      .select({ id: appointments.id })
      .from(appointments)
      .where(inArray(appointments.startTime, [slotA.start, slotB.start]));
    expect(created).toEqual([]);
  });

  it("acceptEarlierSlot jak w trasie: nowa wizyta w salonie z tokenu, accepted = true, notyfikacja", async () => {
    const { start, end } = nextSlot();
    const entry = await waitingEntry(ids.salonA, ids.clientA, {
      serviceId: ids.svcA,
      notifiedAt: new Date(),
      acceptToken: `it-${randomUUID()}`,
      offeredStartTime: start,
      offeredEndTime: end,
      offeredEmployeeId: ids.empA,
    });

    const res = await acceptEarlierSlot(entry.id, entry.acceptToken!);

    expect(res.success).toBe(true);
    const [appt] = await h!.db.select().from(appointments).where(eq(appointments.id, res.appointmentId!));
    expect(appt).toMatchObject({ salonId: ids.salonA, clientId: ids.clientA, employeeId: ids.empA, status: "scheduled" });
    const [after] = await h!.db.select().from(waitingList).where(eq(waitingList.id, entry.id));
    expect(after!.accepted).toBe(true);
    const notifs = (await notificationRows(ids.salonA, "system")).filter((r) => r.message.includes(res.appointmentId!));
    expect(notifs).toHaveLength(1);
  });

  it("acceptEarlierSlot: usługa z zadatkiem (#63) → odmowa, brak wizyty, wpis nierozstrzygnięty", async () => {
    const { start, end } = nextSlot();
    const entry = await waitingEntry(ids.salonA, ids.clientA, {
      serviceId: ids.svcDepositA,
      notifiedAt: new Date(),
      acceptToken: `it-${randomUUID()}`,
      offeredStartTime: start,
      offeredEndTime: end,
      offeredEmployeeId: ids.empA,
    });

    const res = await acceptEarlierSlot(entry.id, entry.acceptToken!);

    expect(res.success).toBe(false);
    expect(res.message).toBe(
      "Ta rezerwacja wymaga wpłaty zadatku. Zarezerwuj wizytę w portalu salonu z płatnością zadatku."
    );
    const created = await h!.db
      .select({ id: appointments.id })
      .from(appointments)
      .where(and(eq(appointments.salonId, ids.salonA), eq(appointments.startTime, start)));
    expect(created).toEqual([]);
    const [after] = await h!.db.select().from(waitingList).where(eq(waitingList.id, entry.id));
    expect(after!.accepted).toBeNull();
  });

  it("acceptEarlierSlot: salon B z modułem listy domyślnie wyłączonym → odmowa, oferta nietknięta, brak wizyty", async () => {
    // Istniejąca wizyta klienta w salonie B (późniejszy termin) — oferta miałaby ją przenieść.
    const existingSlot = nextSlot();
    const offered = nextSlot();
    const [existing] = await h!.db
      .insert(appointments)
      .values({
        salonId: ids.salonB,
        clientId: ids.clientB,
        employeeId: ids.empB,
        serviceId: ids.svcB,
        startTime: existingSlot.start,
        endTime: existingSlot.end,
        status: "scheduled",
      })
      .returning();
    const notifiedAt = new Date();
    const entry = await waitingEntry(ids.salonB, ids.clientB, {
      serviceId: ids.svcB,
      notifiedAt,
      acceptToken: `it-b-${randomUUID()}`,
      offeredStartTime: offered.start,
      offeredEndTime: offered.end,
      offeredEmployeeId: ids.empB,
      existingAppointmentId: existing!.id,
    });

    const res = await acceptEarlierSlot(entry.id, entry.acceptToken!);

    expect(res).toEqual({ success: false, message: "Oferta nie jest już aktualna" });
    const [after] = await h!.db.select().from(waitingList).where(eq(waitingList.id, entry.id));
    expect(after).toMatchObject({
      accepted: null,
      acceptToken: entry.acceptToken,
      notifiedAt: entry.notifiedAt,
      offeredStartTime: offered.start,
      offeredEndTime: offered.end,
      offeredEmployeeId: ids.empB,
      existingAppointmentId: existing!.id,
    });
    const created = await h!.db
      .select({ id: appointments.id })
      .from(appointments)
      .where(and(eq(appointments.salonId, ids.salonB), eq(appointments.startTime, offered.start)));
    expect(created).toEqual([]);
    const [moved] = await h!.db.select().from(appointments).where(eq(appointments.id, existing!.id));
    expect(moved).toMatchObject({
      startTime: existingSlot.start,
      endTime: existingSlot.end,
      employeeId: ids.empB,
      status: "scheduled",
      notes: existing!.notes,
    });
  });
});
