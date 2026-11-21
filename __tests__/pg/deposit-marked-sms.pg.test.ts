/**
 * SMS po ręcznym oznaczeniu zadatku (`notifyDepositMarkedPaid`) na PRAWDZIWYM Postgresie:
 * - odczyt wizyty i dziennika `deposit_status_events` przez `forSalon` (rola aplikacji, RLS):
 *   jeden wpis potwierdzający (bieżące oznaczenie) → wysyłka, drugi → `already_confirmed`;
 *   `owner_edit` się nie liczy; wpisy salonu B nie zmieniają decyzji dla wizyty A;
 *   kontekst salonu B na wizycie A → `no_details`;
 * - kolejność pomijania: no_details → not_paid → already_confirmed → no_amount → no_phone;
 * - limit „najwyżej jeden SMS na wizytę” przez prawdziwe trasy
 *   POST → POST (bez zmiany) → DELETE → POST `/api/appointments/[id]/deposit`.
 *
 * Atrapa wysyłki: tylko `sendDepositMarkedSms` z `@/lib/sms` (reszta modułu prawdziwa).
 * Jak we wzorcu tras: atrapa sesji (`auth.api.getSession`), nagłówków i loggera (logger
 * odczytuje powód pominięcia); `@/lib/db` wskazuje bazę testową. Kontekst salonu,
 * `forSalon`, dziennik i moduł SMS po oznaczeniu prawdziwe.
 *
 * Dane: konta `it-t3-dms-…` (właściciele A i B), salony A i B, pracownicy, klient A
 * z własnym numerem, wizyty w osobnych terminach (2097). Wpisy dziennika do przypadków
 * modułu dopisywane rolą migracji. Salony usuwane w `afterAll` (kaskada: klienci,
 * wizyty i ich wpisy).
 *
 *   INTEGRATION_POSTGRES_URL=postgresql://…@localhost:5432/pos_dev pnpm test:pg
 */
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as depositRoute from "@/app/api/appointments/[id]/deposit/route";
import { notifyDepositMarkedPaid } from "@/lib/deposit-marked-sms";
import { appointments, clients, depositStatusEvents, employees, salons, user } from "@/lib/schema";
import { createMockRequest, createRouteParams, parseResponse } from "../api/helpers";

const h = await vi.hoisted(async () => (await import("./pg-harness")).createIntegrationDb());
const ctl = vi.hoisted(() => ({ userId: "" }));
const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  info: vi.fn<(message: string, meta?: Record<string, unknown>) => void>(),
  warn: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  get db() {
    if (!h) throw new Error("INTEGRATION_POSTGRES_URL not set");
    return h.db;
  },
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: async () =>
        ctl.userId ? { user: { id: ctl.userId, email: `${ctl.userId}@example.invalid`, name: "IT" }, session: { id: `s-${ctl.userId}`, userId: ctl.userId } } : null,
    },
  },
}));
vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), info: mocks.info, warn: mocks.warn, debug: vi.fn() },
}));
// Tylko wysyłka; `smsFailureReason` i stałe błędów prawdziwe.
vi.mock("@/lib/sms", async (orig) => ({
  ...(await orig<typeof import("@/lib/sms")>()),
  sendDepositMarkedSms: mocks.send,
}));

const suite = h ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const OWNER_A = `it-t3-dms-a-${RUN}`;
const OWNER_B = `it-t3-dms-b-${RUN}`;
const SALON_A_NAME = `IT T3 dms A ${RUN}`;
// Numery tylko tego pliku (prefiks +48 000 71…); wysyłka i tak jest atrapą.
const CLIENT_PHONE = "+48000710001";
const GUEST_PHONE = "+48000710002";
const SKIP_MESSAGE = "[AppointmentDeposit API] Deposit marked SMS skipped";
const ids = { salonA: "", salonB: "", empA: "", empB: "", clientA: "" };
const ownerOf: Record<string, string> = {};
let slot = 0;

type VisitOptions = {
  salonId?: string;
  depositPaid?: boolean;
  depositAmount?: string | null;
  clientId?: string | null;
  guestPhone?: string | null;
};

/** Wizyta (rola migracji, zatwierdzona); każda w osobnym, dalekim terminie. Domyślnie: salon A, zadatek 50.00 niewpłacony, klient A. */
async function appointment(opts: VisitOptions = {}): Promise<string> {
  const salonId = opts.salonId ?? ids.salonA;
  const start = new Date(Date.UTC(2097, 3, 1, 8) + slot++ * 3_600_000);
  const [a] = await h!.db
    .insert(appointments)
    .values({
      salonId,
      employeeId: salonId === ids.salonA ? ids.empA : ids.empB,
      startTime: start,
      endTime: new Date(start.getTime() + 1_800_000),
      status: "scheduled",
      depositAmount: opts.depositAmount === undefined ? "50.00" : opts.depositAmount,
      depositPaid: opts.depositPaid ?? false,
      clientId: opts.clientId === undefined ? ids.clientA : opts.clientId,
      guestPhone: opts.guestPhone ?? null,
    })
    .returning({ id: appointments.id });
  return a!.id;
}

type EventSource = "manual_mark" | "manual_unmark" | "owner_edit" | "stripe_confirmation";

/** Wpis dziennika rolą migracji (omija RLS, CHECK-i i FK obowiązują). */
async function event(appt: string, source: EventSource, depositPaid: boolean, salonId = ids.salonA): Promise<void> {
  const manual = source !== "stripe_confirmation";
  await h!.db.insert(depositStatusEvents).values({
    salonId,
    appointmentId: appt,
    depositPaid,
    previousDepositPaid: !depositPaid,
    source,
    actorUserId: manual ? ownerOf[salonId]! : null,
    actorRole: manual ? "owner" : null,
  });
}

/** Decyzja modułu dla wizyty: liczba wysyłek, powody pominięcia z logu, ostrzeżenia. */
function decisionFor(appt: string) {
  const skips = mocks.info.mock.calls
    .filter(([message, meta]) => message === SKIP_MESSAGE && meta?.appointmentId === appt)
    .map(([, meta]) => meta?.reason);
  return { sent: mocks.send.mock.calls.length, skips, warned: mocks.warn.mock.calls.length };
}

const depositRequest = (id: string, method: "POST" | "DELETE") =>
  createMockRequest(`http://localhost/api/appointments/${id}/deposit`, { method });
const mark = (id: string) => depositRoute.POST(depositRequest(id, "POST"), createRouteParams(id));
const unmark = (id: string) => depositRoute.DELETE(depositRequest(id, "DELETE"), createRouteParams(id));

suite("SMS po ręcznym oznaczeniu zadatku — prawdziwy Postgres", () => {
  beforeAll(async () => {
    const db = h!.db;
    await db.insert(user).values([
      { id: OWNER_A, name: "IT T3 dms A", email: `${OWNER_A}@example.invalid` },
      { id: OWNER_B, name: "IT T3 dms B", email: `${OWNER_B}@example.invalid` },
    ]);
    const [a] = await db.insert(salons).values({ name: SALON_A_NAME, ownerId: OWNER_A }).returning({ id: salons.id });
    const [b] = await db.insert(salons).values({ name: `IT T3 dms B ${RUN}`, ownerId: OWNER_B }).returning({ id: salons.id });
    ids.salonA = a!.id;
    ids.salonB = b!.id;
    ownerOf[ids.salonA] = OWNER_A;
    ownerOf[ids.salonB] = OWNER_B;
    const [ea] = await db.insert(employees).values({ salonId: ids.salonA, firstName: "IT", lastName: "Pracownik A" }).returning({ id: employees.id });
    const [eb] = await db.insert(employees).values({ salonId: ids.salonB, firstName: "IT", lastName: "Pracownik B" }).returning({ id: employees.id });
    ids.empA = ea!.id;
    ids.empB = eb!.id;
    const [c] = await db
      .insert(clients)
      .values({ salonId: ids.salonA, firstName: "IT", lastName: "Klient A", phone: CLIENT_PHONE })
      .returning({ id: clients.id });
    ids.clientA = c!.id;
  });

  afterAll(async () => {
    if (!h) return;
    try {
      // Kaskada z salonów: pracownicy, klienci, wizyty i ich wpisy w dzienniku.
      for (const s of [ids.salonA, ids.salonB]) if (s) await h.db.delete(salons).where(eq(salons.id, s));
      await h.db.delete(user).where(inArray(user.id, [OWNER_A, OWNER_B]));
    } finally {
      await h.end();
    }
  });

  beforeEach(() => {
    ctl.userId = "";
    mocks.send.mockReset();
    mocks.send.mockResolvedValue({ success: true });
    mocks.info.mockClear();
    mocks.warn.mockClear();
  });

  describe("odczyt dziennika przez moduł (forSalon, RLS)", () => {
    it("jeden wpis manual_mark (bieżące oznaczenie) → jedna wysyłka na numer klienta salonu A", async () => {
      const appt = await appointment({ depositPaid: true });
      await event(appt, "manual_mark", true);

      await notifyDepositMarkedPaid({ salonId: ids.salonA, appointmentId: appt });

      expect(decisionFor(appt)).toEqual({ sent: 1, skips: [], warned: 0 });
      expect(mocks.send).toHaveBeenCalledWith({
        clientPhone: CLIENT_PHONE,
        amount: 50,
        appointmentDate: expect.any(Date),
        salonName: SALON_A_NAME,
        salonId: ids.salonA,
        clientId: ids.clientA,
      });
    });

    it("oznacz → cofnij → oznacz w dzienniku (2 × manual_mark) → already_confirmed, bez wysyłki", async () => {
      const appt = await appointment({ depositPaid: true });
      await event(appt, "manual_mark", true);
      await event(appt, "manual_unmark", false);
      await event(appt, "manual_mark", true);

      await notifyDepositMarkedPaid({ salonId: ids.salonA, appointmentId: appt });

      expect(decisionFor(appt)).toEqual({ sent: 0, skips: ["already_confirmed"], warned: 0 });
    });

    it("owner_edit nie liczy się jako potwierdzenie: owner_edit + manual_mark → wysyłka", async () => {
      const appt = await appointment({ depositPaid: true });
      await event(appt, "owner_edit", true);
      await event(appt, "owner_edit", false);
      await event(appt, "manual_mark", true);

      await notifyDepositMarkedPaid({ salonId: ids.salonA, appointmentId: appt });

      expect(decisionFor(appt)).toEqual({ sent: 1, skips: [], warned: 0 });
    });

    it("wpisy potwierdzające salonu B (jego wizyta) nie zmieniają decyzji dla wizyty A → wysyłka", async () => {
      const apptB = await appointment({ salonId: ids.salonB, depositPaid: true, clientId: null, guestPhone: GUEST_PHONE });
      await event(apptB, "manual_mark", true, ids.salonB);
      await event(apptB, "manual_unmark", false, ids.salonB);
      await event(apptB, "manual_mark", true, ids.salonB);
      const apptA = await appointment({ depositPaid: true });
      await event(apptA, "manual_mark", true);

      await notifyDepositMarkedPaid({ salonId: ids.salonA, appointmentId: apptA });

      expect(decisionFor(apptA)).toEqual({ sent: 1, skips: [], warned: 0 });
      expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({ clientPhone: CLIENT_PHONE, salonId: ids.salonA }));
    });

    it("kontekst salonu B na wizycie A (opłaconej, z wpisem) → no_details, bez wysyłki", async () => {
      const appt = await appointment({ depositPaid: true });
      await event(appt, "manual_mark", true);

      await notifyDepositMarkedPaid({ salonId: ids.salonB, appointmentId: appt });

      expect(decisionFor(appt)).toEqual({ sent: 0, skips: ["no_details"], warned: 0 });
    });
  });

  describe("kolejność pomijania: no_details → not_paid → already_confirmed → no_amount → no_phone", () => {
    it("no_details: nieistniejąca wizyta", async () => {
      const appt = randomUUID();
      await notifyDepositMarkedPaid({ salonId: ids.salonA, appointmentId: appt });
      expect(decisionFor(appt)).toEqual({ sent: 0, skips: ["no_details"], warned: 0 });
    });

    it("not_paid przed already_confirmed: flaga false przy 2 wpisach potwierdzających", async () => {
      const appt = await appointment({ depositPaid: false });
      await event(appt, "manual_mark", true);
      await event(appt, "manual_unmark", false);
      await event(appt, "manual_mark", true);
      await event(appt, "manual_unmark", false);

      await notifyDepositMarkedPaid({ salonId: ids.salonA, appointmentId: appt });

      expect(decisionFor(appt)).toEqual({ sent: 0, skips: ["not_paid"], warned: 0 });
    });

    it("already_confirmed przed no_amount i no_phone: stripe_confirmation + manual_mark, bez kwoty i telefonu", async () => {
      const appt = await appointment({ depositPaid: true, depositAmount: null, clientId: null });
      await event(appt, "stripe_confirmation", true);
      await event(appt, "manual_unmark", false);
      await event(appt, "manual_mark", true);

      await notifyDepositMarkedPaid({ salonId: ids.salonA, appointmentId: appt });

      expect(decisionFor(appt)).toEqual({ sent: 0, skips: ["already_confirmed"], warned: 0 });
    });

    it("no_amount przed no_phone: jeden wpis, bez kwoty i telefonu", async () => {
      const appt = await appointment({ depositPaid: true, depositAmount: null, clientId: null });
      await event(appt, "manual_mark", true);

      await notifyDepositMarkedPaid({ salonId: ids.salonA, appointmentId: appt });

      expect(decisionFor(appt)).toEqual({ sent: 0, skips: ["no_amount"], warned: 0 });
    });

    it("no_phone: jeden wpis, kwota 50.00, bez klienta i gościa", async () => {
      const appt = await appointment({ depositPaid: true, clientId: null });
      await event(appt, "manual_mark", true);

      await notifyDepositMarkedPaid({ salonId: ids.salonA, appointmentId: appt });

      expect(decisionFor(appt)).toEqual({ sent: 0, skips: ["no_phone"], warned: 0 });
    });
  });

  describe("limit jednego SMS przez prawdziwe trasy", () => {
    it("POST → POST (bez zmiany) → DELETE → POST: łącznie 1 wysyłka, drugie oznaczenie → already_confirmed", async () => {
      const appt = await appointment();
      ctl.userId = OWNER_A;

      const first = await parseResponse<{ data: { changed: boolean } }>(await mark(appt));
      expect(first.status, JSON.stringify(first.body)).toBe(200);
      expect(first.body.data.changed).toBe(true);
      expect(decisionFor(appt)).toEqual({ sent: 1, skips: [], warned: 0 });

      const again = await parseResponse<{ data: { changed: boolean } }>(await mark(appt));
      expect(again.status).toBe(200);
      expect(again.body.data.changed).toBe(false);

      const revert = await parseResponse<{ data: { changed: boolean } }>(await unmark(appt));
      expect(revert.status, JSON.stringify(revert.body)).toBe(200);
      expect(revert.body.data.changed).toBe(true);

      const remark = await parseResponse<{ data: { changed: boolean } }>(await mark(appt));
      expect(remark.status, JSON.stringify(remark.body)).toBe(200);
      expect(remark.body.data.changed).toBe(true);

      expect(decisionFor(appt)).toEqual({ sent: 1, skips: ["already_confirmed"], warned: 0 });
      expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({ clientPhone: CLIENT_PHONE, amount: 50, salonId: ids.salonA }));
      const events = await h!.db
        .select({ source: depositStatusEvents.source })
        .from(depositStatusEvents)
        .where(eq(depositStatusEvents.appointmentId, appt));
      expect(events.map((e) => e.source).sort()).toEqual(["manual_mark", "manual_mark", "manual_unmark"]);
    });

    it("sesja salonu B na wizycie A → 404, bez wysyłki i bez wpisu", async () => {
      const appt = await appointment();
      ctl.userId = OWNER_B;

      const res = await parseResponse(await mark(appt));

      expect(res.status).toBe(404);
      expect(decisionFor(appt)).toEqual({ sent: 0, skips: [], warned: 0 });
      const events = await h!.db.select().from(depositStatusEvents).where(eq(depositStatusEvents.appointmentId, appt));
      expect(events).toHaveLength(0);
    });
  });
});
