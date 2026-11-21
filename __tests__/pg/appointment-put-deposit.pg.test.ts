/**
 * PUT `/api/appointments/[id]` a dziennik `deposit_status_events` na PRAWDZIWYM Postgresie:
 * - atomowość: zmiana `depositPaid` razem z notatką → jeden wpis `owner_edit` i zapisana wizyta;
 *   ta sama wartość flagi albo PUT bez flagi → 0 wpisów; błąd po prawdziwym INSERT wpisu
 *   → 500, flaga, notatka i wpis cofnięte;
 * - sesja salonu B na wizycie A → 404, wizyta A bez zmian, bez wpisu; wpis A ma `salon_id` A;
 * - recepcja: pola zadatku w PUT → 403 przed zapisem (wpis `owner_edit` tylko właściciela),
 *   PUT recepcji bez pól zadatku → zapis bez wpisu.
 *
 * Trasa wołana bezpośrednio; atrapa sesji (`auth.api.getSession`), nagłówków i loggera;
 * `@/lib/db` wskazuje bazę testową. Pomocnik dziennika prawdziwy, z przełącznikiem błędu
 * rzucanego dopiero PO prawdziwym INSERT w transakcji trasy. Kontekst salonu i `forSalon` prawdziwe.
 *
 * Dane: konta `it-t3-aput-…` (właściciele A i B, recepcja A), salony A i B, pracownik A,
 * wizyty zatwierdzone rolą migracji (`scheduled`, zadatek 50.00, bez klienta, terminy 2095).
 * Salony usuwane w `afterAll` (kaskada: pracownicy, wizyty i ich wpisy).
 *
 *   INTEGRATION_POSTGRES_URL=postgresql://…@localhost:5432/pos_dev pnpm test:pg
 */
import { randomUUID } from "node:crypto";
import { asc, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as appointmentRoute from "@/app/api/appointments/[id]/route";
import { appointments, depositStatusEvents, employees, salons, user } from "@/lib/schema";
import { createMockRequest, createRouteParams, parseResponse } from "../api/helpers";

const h = await vi.hoisted(async () => (await import("./pg-harness")).createIntegrationDb());
const ctl = vi.hoisted(() => ({ userId: "", failAfterInsert: false, recordCalls: 0 }));
const mocks = vi.hoisted(() => ({ error: vi.fn(), warn: vi.fn() }));

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
  logger: { error: mocks.error, info: vi.fn(), warn: mocks.warn, debug: vi.fn() },
}));
// Prawdziwy pomocnik (walidacja + INSERT w transakcji trasy); przełącznik rzuca PO INSERT.
vi.mock("@/lib/deposit-status-events", async (orig) => {
  const actual = await orig<typeof import("@/lib/deposit-status-events")>();
  return {
    ...actual,
    recordDepositStatusEvent: async (...args: Parameters<typeof actual.recordDepositStatusEvent>) => {
      ctl.recordCalls++;
      await actual.recordDepositStatusEvent(...args);
      if (ctl.failAfterInsert) throw new Error("it-aput-after-insert");
    },
  };
});

const suite = h ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const OWNER_A = `it-t3-aput-a-${RUN}`;
const OWNER_B = `it-t3-aput-b-${RUN}`;
const RECEPTION_A = `it-t3-aput-r-${RUN}`;
const ids = { salonA: "", salonB: "", empA: "" };
let slot = 0;

/** Wizyta salonu A (rola migracji, zatwierdzona); każda w osobnym, dalekim terminie. */
async function appointment(depositPaid = false): Promise<string> {
  const start = new Date(Date.UTC(2095, 8, 1, 8) + slot++ * 3_600_000);
  const [a] = await h!.db
    .insert(appointments)
    .values({
      salonId: ids.salonA,
      employeeId: ids.empA,
      startTime: start,
      endTime: new Date(start.getTime() + 1_800_000),
      status: "scheduled",
      depositAmount: "50.00",
      depositPaid,
    })
    .returning({ id: appointments.id });
  return a!.id;
}

const put = (id: string, body: Record<string, unknown>) =>
  appointmentRoute.PUT(
    createMockRequest(`http://localhost/api/appointments/${id}`, { method: "PUT", body }),
    createRouteParams(id)
  );

async function stateOf(appt: string) {
  const [a] = await h!.db
    .select({ depositPaid: appointments.depositPaid, notes: appointments.notes, salonId: appointments.salonId })
    .from(appointments)
    .where(eq(appointments.id, appt));
  return a!;
}

async function eventsOf(appt: string) {
  return h!.db
    .select()
    .from(depositStatusEvents)
    .where(eq(depositStatusEvents.appointmentId, appt))
    .orderBy(asc(depositStatusEvents.createdAt));
}

suite("PUT wizyty a dziennik zadatku — prawdziwy Postgres", () => {
  beforeAll(async () => {
    const db = h!.db;
    await db.insert(user).values([
      { id: OWNER_A, name: "IT T3 aput A", email: `${OWNER_A}@example.invalid` },
      { id: OWNER_B, name: "IT T3 aput B", email: `${OWNER_B}@example.invalid` },
      { id: RECEPTION_A, name: "IT T3 aput R", email: `${RECEPTION_A}@example.invalid` },
    ]);
    const [a] = await db.insert(salons).values({ name: `IT T3 aput A ${RUN}`, ownerId: OWNER_A }).returning({ id: salons.id });
    const [b] = await db.insert(salons).values({ name: `IT T3 aput B ${RUN}`, ownerId: OWNER_B }).returning({ id: salons.id });
    ids.salonA = a!.id;
    ids.salonB = b!.id;
    const [e] = await db
      .insert(employees)
      .values({ salonId: ids.salonA, firstName: "IT", lastName: "Pracownik" })
      .returning({ id: employees.id });
    ids.empA = e!.id;
    await db
      .insert(employees)
      .values({ salonId: ids.salonA, userId: RECEPTION_A, firstName: "IT", lastName: "Recepcja", role: "receptionist" });
  });

  afterAll(async () => {
    if (!h) return;
    try {
      // Kaskada z salonów: pracownicy, wizyty i ich wpisy w dzienniku.
      for (const s of [ids.salonA, ids.salonB]) if (s) await h.db.delete(salons).where(eq(salons.id, s));
      await h.db.delete(user).where(inArray(user.id, [OWNER_A, OWNER_B, RECEPTION_A]));
    } finally {
      await h.end();
    }
  });

  beforeEach(() => {
    ctl.userId = "";
    ctl.failAfterInsert = false;
    ctl.recordCalls = 0;
    mocks.error.mockClear();
    mocks.warn.mockClear();
  });

  describe("atomowość zapisu wizyty i wpisu dziennika", () => {
    it("właściciel: depositPaid false→true z notatką → 200, flaga i notatka zapisane, 1 wpis owner_edit salonu A", async () => {
      const appt = await appointment();
      ctl.userId = OWNER_A;

      const res = await parseResponse<{ data: { depositPaid: boolean; notes: string } }>(
        await put(appt, { depositPaid: true, notes: "it-aput notatka 1" })
      );

      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data).toMatchObject({ depositPaid: true, notes: "it-aput notatka 1" });
      expect(await stateOf(appt)).toMatchObject({ depositPaid: true, notes: "it-aput notatka 1" });
      const events = await eventsOf(appt);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        salonId: ids.salonA,
        appointmentId: appt,
        depositPaid: true,
        previousDepositPaid: false,
        source: "owner_edit",
        actorUserId: OWNER_A,
        actorRole: "owner",
      });
      expect(mocks.error).not.toHaveBeenCalled();
      expect(mocks.warn).not.toHaveBeenCalled();
    });

    it("właściciel: depositPaid true→false → 1 wpis owner_edit w kierunku false", async () => {
      const appt = await appointment(true);
      ctl.userId = OWNER_A;

      const res = await parseResponse(await put(appt, { depositPaid: false }));

      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect((await stateOf(appt)).depositPaid).toBe(false);
      const events = await eventsOf(appt);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ depositPaid: false, previousDepositPaid: true, source: "owner_edit" });
      expect(mocks.warn).not.toHaveBeenCalled();
    });

    it("właściciel: ta sama wartość flagi z notatką → 200, notatka zapisana, pomocnik niewołany, 0 wpisów", async () => {
      const appt = await appointment();
      ctl.userId = OWNER_A;

      const res = await parseResponse(await put(appt, { depositPaid: false, notes: "it-aput notatka 2" }));

      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(await stateOf(appt)).toMatchObject({ depositPaid: false, notes: "it-aput notatka 2" });
      expect(ctl.recordCalls).toBe(0);
      expect(await eventsOf(appt)).toHaveLength(0);
      expect(mocks.error).not.toHaveBeenCalled();
      expect(mocks.warn).not.toHaveBeenCalled();
    });

    it("właściciel: PUT bez pola depositPaid → 200, flaga bez zmian, 0 wpisów", async () => {
      const appt = await appointment();
      ctl.userId = OWNER_A;

      const res = await parseResponse(await put(appt, { notes: "it-aput notatka 3" }));

      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(await stateOf(appt)).toMatchObject({ depositPaid: false, notes: "it-aput notatka 3" });
      expect(ctl.recordCalls).toBe(0);
      expect(await eventsOf(appt)).toHaveLength(0);
    });

    it("błąd po prawdziwym INSERT wpisu → 500, flaga i notatka z tego PUT cofnięte, 0 wpisów", async () => {
      const appt = await appointment();
      ctl.userId = OWNER_A;
      ctl.failAfterInsert = true;

      const res = await parseResponse(await put(appt, { depositPaid: true, notes: "it-aput notatka cofnięta" }));

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ success: false, error: "Failed to update appointment" });
      expect(ctl.recordCalls).toBe(1);
      expect(await stateOf(appt)).toMatchObject({ depositPaid: false, notes: null });
      expect(await eventsOf(appt)).toHaveLength(0);
      expect(mocks.error).toHaveBeenCalledTimes(1);
      expect(mocks.warn).not.toHaveBeenCalled();
    });
  });

  describe("izolacja salonu B", () => {
    it("sesja salonu B: PUT z depositPaid i notatką na wizytę A → 404, wizyta A bez zmian, 0 wpisów", async () => {
      const appt = await appointment();
      ctl.userId = OWNER_B;

      const res = await parseResponse(await put(appt, { depositPaid: true, notes: "it-aput salon B" }));

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ success: false, error: "Appointment not found" });
      expect(await stateOf(appt)).toMatchObject({ salonId: ids.salonA, depositPaid: false, notes: null });
      expect(ctl.recordCalls).toBe(0);
      expect(await eventsOf(appt)).toHaveLength(0);
    });

    it("wpis właściciela A zostaje jedynym wpisem z salon_id A po próbie sesji salonu B", async () => {
      const appt = await appointment();
      ctl.userId = OWNER_A;
      const own = await parseResponse(await put(appt, { depositPaid: true }));
      expect(own.status, JSON.stringify(own.body)).toBe(200);

      ctl.userId = OWNER_B;
      const foreign = await parseResponse(await put(appt, { depositPaid: false, notes: "it-aput salon B" }));
      expect(foreign.status).toBe(404);

      expect(await stateOf(appt)).toMatchObject({ depositPaid: true, notes: null });
      const events = await eventsOf(appt);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ salonId: ids.salonA, source: "owner_edit", actorUserId: OWNER_A });
    });
  });

  describe("recepcja: owner_edit tylko właściciela", () => {
    it("recepcja: PUT z depositPaid i notatką → 403 przed zapisem, wizyta bez zmian, 0 wpisów", async () => {
      const appt = await appointment();
      ctl.userId = RECEPTION_A;

      const res = await parseResponse(await put(appt, { depositPaid: true, notes: "it-aput recepcja" }));

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ success: false, error: "Tylko wlasciciel salonu moze zmieniac zadatek" });
      expect(await stateOf(appt)).toMatchObject({ depositPaid: false, notes: null });
      expect(ctl.recordCalls).toBe(0);
      expect(await eventsOf(appt)).toHaveLength(0);
    });

    it("recepcja: PUT z samym depositAmount → 403, 0 wpisów", async () => {
      const appt = await appointment();
      ctl.userId = RECEPTION_A;

      const res = await parseResponse(await put(appt, { depositAmount: "10.00" }));

      expect(res.status).toBe(403);
      expect(await eventsOf(appt)).toHaveLength(0);
    });

    it("recepcja: PUT bez pól zadatku → 200, notatka zapisana, 0 wpisów", async () => {
      const appt = await appointment();
      ctl.userId = RECEPTION_A;

      const res = await parseResponse(await put(appt, { notes: "it-aput recepcja notatka" }));

      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(await stateOf(appt)).toMatchObject({ depositPaid: false, notes: "it-aput recepcja notatka" });
      expect(ctl.recordCalls).toBe(0);
      expect(await eventsOf(appt)).toHaveLength(0);
      expect(mocks.warn).not.toHaveBeenCalled();
    });
  });
});
