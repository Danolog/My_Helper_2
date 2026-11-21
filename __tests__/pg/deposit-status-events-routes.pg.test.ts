/**
 * Wpisy dziennika `deposit_status_events` z tras panelu na PRAWDZIWYM Postgresie:
 * - POST/DELETE `/api/appointments/[id]/deposit` (`manual_mark` / `manual_unmark`),
 *   idempotentne powtórzenie bez nowego wpisu;
 * - PUT `/api/appointments/[id]` właściciela (`owner_edit`), ta sama wartość bez wpisu;
 * - atomowość pod rolą aplikacji: błąd po prawdziwym INSERT wpisu → 500, flaga i wpis cofnięte;
 * - sesja salonu B na wizycie A → 404, bez wpisu.
 *
 * Trasy wołane bezpośrednio (wzór `p5a2-routes.pg.test.ts`); atrapa sesji
 * (`auth.api.getSession`), nagłówków i loggera; `@/lib/db` wskazuje bazę testową, a pomocnik
 * dziennika jest prawdziwy z przełącznikiem błędu po INSERT. Kontekst salonu i `forSalon` prawdziwe.
 *
 * Dane: konta `it-t3-dser-…` (właściciele A i B, recepcja A), salony A i B, pracownicy
 * i wizyty zatwierdzone rolą migracji (`scheduled`, zadatek 50.00, bez `deposit_payments`,
 * bez gościa i klienta). Salony usuwane w `afterAll` (kaskada: wizyty i ich wpisy).
 *
 *   INTEGRATION_POSTGRES_URL=postgresql://…@localhost:5432/pos_dev pnpm test:pg
 */
import { randomUUID } from "node:crypto";
import { asc, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as depositRoute from "@/app/api/appointments/[id]/deposit/route";
import * as appointmentRoute from "@/app/api/appointments/[id]/route";
import { appointments, depositStatusEvents, employees, salons, user } from "@/lib/schema";
import { createMockRequest, createRouteParams, parseResponse } from "../api/helpers";

const h = await vi.hoisted(async () => (await import("./pg-harness")).createIntegrationDb());
const ctl = vi.hoisted(() => ({ userId: "", failAfterInsert: false }));

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
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
// Prawdziwy pomocnik; przełącznik rzuca dopiero PO prawdziwym INSERT wpisu.
vi.mock("@/lib/deposit-status-events", async (orig) => {
  const actual = await orig<typeof import("@/lib/deposit-status-events")>();
  return {
    ...actual,
    recordDepositStatusEvent: async (...args: Parameters<typeof actual.recordDepositStatusEvent>) => {
      await actual.recordDepositStatusEvent(...args);
      if (ctl.failAfterInsert) throw new Error("it-after-insert");
    },
  };
});

const suite = h ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const OWNER_A = `it-t3-dser-a-${RUN}`;
const OWNER_B = `it-t3-dser-b-${RUN}`;
const RECEPTION_A = `it-t3-dser-r-${RUN}`;
const ids = { salonA: "", salonB: "", empA: "" };
let slot = 0;

/** Wizyta salonu A (rola migracji, zatwierdzona); każda w osobnym, dalekim terminie. */
async function appointment(): Promise<string> {
  const start = new Date(Date.UTC(2099, 6, 1, 8) + slot++ * 3_600_000);
  const [a] = await h!.db
    .insert(appointments)
    .values({
      salonId: ids.salonA,
      employeeId: ids.empA,
      startTime: start,
      endTime: new Date(start.getTime() + 1_800_000),
      status: "scheduled",
      depositAmount: "50.00",
      depositPaid: false,
    })
    .returning({ id: appointments.id });
  return a!.id;
}

const depositRequest = (id: string, method: "POST" | "DELETE") =>
  createMockRequest(`http://localhost/api/appointments/${id}/deposit`, { method });

const mark = (id: string) => depositRoute.POST(depositRequest(id, "POST"), createRouteParams(id));
const unmark = (id: string) => depositRoute.DELETE(depositRequest(id, "DELETE"), createRouteParams(id));
const put = (id: string, body: Record<string, unknown>) =>
  appointmentRoute.PUT(
    createMockRequest(`http://localhost/api/appointments/${id}`, { method: "PUT", body }),
    createRouteParams(id)
  );

async function flagOf(appt: string): Promise<boolean | null> {
  const [a] = await h!.db.select({ v: appointments.depositPaid }).from(appointments).where(eq(appointments.id, appt));
  return a!.v;
}

async function eventsOf(appt: string) {
  return h!.db
    .select()
    .from(depositStatusEvents)
    .where(eq(depositStatusEvents.appointmentId, appt))
    .orderBy(asc(depositStatusEvents.createdAt));
}

suite("deposit_status_events z tras panelu — prawdziwy Postgres", () => {
  beforeAll(async () => {
    const db = h!.db;
    await db.insert(user).values([
      { id: OWNER_A, name: "IT T3 dser A", email: `${OWNER_A}@example.invalid` },
      { id: OWNER_B, name: "IT T3 dser B", email: `${OWNER_B}@example.invalid` },
      { id: RECEPTION_A, name: "IT T3 dser R", email: `${RECEPTION_A}@example.invalid` },
    ]);
    const [a] = await db.insert(salons).values({ name: `IT T3 dser A ${RUN}`, ownerId: OWNER_A }).returning({ id: salons.id });
    const [b] = await db.insert(salons).values({ name: `IT T3 dser B ${RUN}`, ownerId: OWNER_B }).returning({ id: salons.id });
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
  });

  it("POST właściciela → wpis manual_mark; powtórny POST → changed:false bez wpisu; DELETE recepcji → manual_unmark", async () => {
    const appt = await appointment();

    ctl.userId = OWNER_A;
    const first = await parseResponse<{ data: { changed: boolean } }>(await mark(appt));
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body.data.changed).toBe(true);
    expect(await flagOf(appt)).toBe(true);
    let events = await eventsOf(appt);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      salonId: ids.salonA,
      depositPaid: true,
      previousDepositPaid: false,
      source: "manual_mark",
      actorUserId: OWNER_A,
      actorRole: "owner",
    });

    const again = await parseResponse<{ data: { changed: boolean } }>(await mark(appt));
    expect(again.status).toBe(200);
    expect(again.body.data.changed).toBe(false);
    expect(await eventsOf(appt)).toHaveLength(1);

    ctl.userId = RECEPTION_A;
    const revert = await parseResponse<{ data: { changed: boolean } }>(await unmark(appt));
    expect(revert.status, JSON.stringify(revert.body)).toBe(200);
    expect(revert.body.data.changed).toBe(true);
    expect(await flagOf(appt)).toBe(false);
    events = await eventsOf(appt);
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({
      depositPaid: false,
      previousDepositPaid: true,
      source: "manual_unmark",
      actorUserId: RECEPTION_A,
      actorRole: "receptionist",
    });
  });

  it("PUT właściciela depositPaid=true → wpis owner_edit; ta sama wartość → bez nowego wpisu", async () => {
    const appt = await appointment();
    ctl.userId = OWNER_A;

    const res = await parseResponse(await put(appt, { depositPaid: true }));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await flagOf(appt)).toBe(true);
    const events = await eventsOf(appt);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      depositPaid: true,
      previousDepositPaid: false,
      source: "owner_edit",
      actorUserId: OWNER_A,
      actorRole: "owner",
    });

    const same = await parseResponse(await put(appt, { depositPaid: true }));
    expect(same.status, JSON.stringify(same.body)).toBe(200);
    expect(await eventsOf(appt)).toHaveLength(1);
  });

  it("atomowość pod rolą aplikacji: błąd po prawdziwym INSERT wpisu → 500, flaga false, 0 wpisów", async () => {
    const appt = await appointment();
    ctl.userId = OWNER_A;
    ctl.failAfterInsert = true;

    const res = await parseResponse(await mark(appt));

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ success: false, error: "Nie udalo sie zmienic stanu zadatku" });
    expect(await flagOf(appt)).toBe(false);
    expect(await eventsOf(appt)).toHaveLength(0);
  });

  it("sesja salonu B na wizycie A → 404, flaga bez zmian, 0 wpisów", async () => {
    const appt = await appointment();
    ctl.userId = OWNER_B;

    const res = await parseResponse(await mark(appt));

    expect(res.status).toBe(404);
    expect(await flagOf(appt)).toBe(false);
    expect(await eventsOf(appt)).toHaveLength(0);
  });
});
