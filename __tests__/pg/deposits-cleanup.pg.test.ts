/**
 * #193 P5a-2: `cleanupStaleDepositBookings()` (system/deposits-cleanup.ts) na
 * PRAWDZIWYM Postgresie — niezmiennik z decyzji CTO:
 *
 *   wizyta jest anulowana tylko wtedy, gdy nie ma żywej płatności;
 *   żywa = płatność tej wizyty o statusie innym niż `failed` albo utworzona
 *   nie wcześniej niż próg (45 min). Wizyty bez żadnej płatności cron nie rusza.
 *
 * Wyścig (deterministycznie, bez sleep): pula systemowa jest podmieniona na
 * proxy nad pulą testu, które PRZED pierwszą transakcją crona uruchamia hak.
 * Hak na DRUGIM połączeniu (`h.observer`, osobna pula) wstawia i zatwierdza
 * młodszą płatność `pending` tej samej wizyty. Kolejność poleceń wynika z kodu:
 * (1) to, co cron robi przed transakcją, (2) zatwierdzony insert haka,
 * (3) transakcja crona. Test sprawdza, że hak się wykonał.
 *
 * Cron działa na wszystkich salonach bazy i zatwierdza zmiany: asercje o
 * wierszach tylko dla id utworzonych przez test, liczniki jako „co najmniej
 * własne” (dokładne mapowanie RETURNING → licznik: test jednostkowy).
 * Uruchamiać na bazie, w której zmiany cudzych rezerwacji są dopuszczalne.
 *
 * Dane: użytkownik `it-t3-dcl-…` (prefiks z notatki sprzątania w pg-harness.ts),
 * salon, pracownik, usługa; wizyty i płatności kaskadą z salonu w `afterAll`.
 * Uruchomienie: `INTEGRATION_POSTGRES_URL=postgresql://…@localhost:5432/<baza> pnpm test:pg -- __tests__/pg/deposits-cleanup.pg.test.ts`.
 */
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/schema";
import { appointments, depositPayments, employees, salons, services, user } from "@/lib/schema";
import { cleanupStaleDepositBookings } from "@/lib/server/system/deposits-cleanup";

const h = await vi.hoisted(async () => (await import("./pg-harness")).createIntegrationDb());
const ctl = vi.hoisted(() => ({
  beforeTransaction: null as null | (() => Promise<void>),
  hookRuns: 0,
}));

vi.mock("@/lib/db", () => ({
  get db() {
    if (!h) throw new Error("INTEGRATION_POSTGRES_URL not set");
    return h.db;
  },
}));
// Pula systemowa = proxy nad pulą testu; `transaction` najpierw wykonuje jednorazowy hak.
vi.mock("@/lib/server/system/db-system", () => ({
  get dbSystem() {
    if (!h) throw new Error("INTEGRATION_POSTGRES_URL not set");
    const target = h.db;
    return new Proxy(target, {
      get(t, prop, receiver) {
        if (prop === "transaction") {
          return async (...args: Parameters<typeof target.transaction>) => {
            const hook = ctl.beforeTransaction;
            if (hook) {
              ctl.beforeTransaction = null;
              await hook();
              ctl.hookRuns += 1;
            }
            return t.transaction(...args);
          };
        }
        const value = Reflect.get(t, prop, receiver) as unknown;
        return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(t) : value;
      },
    });
  },
}));
vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const RUN = randomUUID().slice(0, 8);
const USER_ID = `it-t3-dcl-${RUN}`;
let salonId = "";
let employeeId = "";
let serviceId = "";
let slot = 0;

type PaymentSpec = { status: string; ageMinutes: number };

/** Wizyta (domyślnie `scheduled`, bez wpłaty) z podanymi płatnościami zadatku. */
async function booking(payments: PaymentSpec[], appt: { status?: string; depositPaid?: boolean } = {}) {
  const db = h!.db;
  const start = new Date(Date.UTC(2099, 2, 1, 8) + slot++ * 3_600_000);
  const [a] = await db
    .insert(appointments)
    .values({
      salonId,
      employeeId,
      serviceId,
      startTime: start,
      endTime: new Date(start.getTime() + 1_800_000),
      status: appt.status ?? "scheduled",
      depositPaid: appt.depositPaid ?? false,
      guestName: "IT Gość",
      guestPhone: "+48500600700",
    })
    .returning();
  const paymentIds: string[] = [];
  for (const p of payments) paymentIds.push(await payment(a!.id, p, db));
  return { appointmentId: a!.id, paymentIds };
}

async function payment(appointmentId: string, p: PaymentSpec, db = h!.db) {
  const [row] = await db
    .insert(depositPayments)
    .values({
      appointmentId,
      salonId,
      amount: "50.00",
      paymentMethod: "stripe",
      status: p.status,
      stripePaymentIntentId: `cs_it_${randomUUID().slice(0, 8)}`,
      createdAt: new Date(Date.now() - p.ageMinutes * 60_000),
    })
    .returning({ id: depositPayments.id });
  return row!.id;
}

async function appointmentStatus(id: string) {
  const [a] = await h!.db.select().from(appointments).where(eq(appointments.id, id));
  return { status: a!.status, depositPaid: a!.depositPaid };
}

async function paymentStatuses(ids: string[]) {
  const rows = await h!.db
    .select({ id: depositPayments.id, status: depositPayments.status })
    .from(depositPayments)
    .where(inArray(depositPayments.id, ids));
  return ids.map((id) => rows.find((r) => r.id === id)?.status);
}

const STALE = 120;
const FRESH = 5;

const suite = h ? describe : describe.skip;

suite("cleanupStaleDepositBookings — niezmiennik „brak żywej płatności”, prawdziwy Postgres", () => {
  beforeAll(async () => {
    const db = h!.db;
    await db.insert(user).values({ id: USER_ID, name: "IT T3 dcl", email: `${USER_ID}@example.invalid` });
    const [salon] = await db.insert(salons).values({ name: `IT T3 dcl ${RUN}`, ownerId: USER_ID }).returning();
    salonId = salon!.id;
    const [emp] = await db.insert(employees).values({ salonId, firstName: "IT", lastName: "Pracownik" }).returning();
    employeeId = emp!.id;
    const [svc] = await db
      .insert(services)
      .values({ salonId, name: "IT Usługa", basePrice: "100.00", baseDuration: 30, depositRequired: true })
      .returning();
    serviceId = svc!.id;
  });

  afterAll(async () => {
    if (!h) return;
    try {
      if (salonId) await h.db.delete(salons).where(eq(salons.id, salonId));
      await h.db.delete(user).where(eq(user.id, USER_ID));
    } finally {
      await h.end();
    }
  });

  beforeEach(() => {
    ctl.beforeTransaction = null;
    ctl.hookRuns = 0;
  });

  // ------------------------------------------------------------ wyścig

  it("wyścig: młodsza płatność pending zatwierdzona przed transakcją crona → wizyta zostaje scheduled", async () => {
    const b = await booking([{ status: "pending", ageMinutes: STALE }]);
    const observerDb = drizzle(h!.observer, { schema });
    let younger = "";
    ctl.beforeTransaction = async () => {
      younger = await payment(b.appointmentId, { status: "pending", ageMinutes: 0 }, observerDb as never);
    };

    await cleanupStaleDepositBookings();

    expect(ctl.hookRuns, "hak wstawiający młodszą płatność się nie wykonał").toBe(1);
    expect(await appointmentStatus(b.appointmentId)).toEqual({ status: "scheduled", depositPaid: false });
    expect(await paymentStatuses([younger])).toEqual(["pending"]);
    // Płatność zmienia się tylko razem z anulowaną wizytą: stara pending też zostaje.
    expect(await paymentStatuses(b.paymentIds)).toEqual(["pending"]);
  });

  // ------------------------------------------------------------ anulowanie

  it("(a) stara pending → płatność failed, wizyta cancelled; liczniki co najmniej własne", async () => {
    const b = await booking([{ status: "pending", ageMinutes: STALE }]);
    const res = await cleanupStaleDepositBookings();
    expect(await appointmentStatus(b.appointmentId)).toEqual({ status: "cancelled", depositPaid: false });
    expect(await paymentStatuses(b.paymentIds)).toEqual(["failed"]);
    expect(res.cancelledAppointments).toBeGreaterThanOrEqual(1);
    expect(res.failedPayments).toBeGreaterThanOrEqual(1);
  });

  it("(b) same stare failed → wizyta cancelled, płatności bez zmian", async () => {
    const b = await booking([
      { status: "failed", ageMinutes: STALE },
      { status: "failed", ageMinutes: STALE + 30 },
    ]);
    const res = await cleanupStaleDepositBookings();
    expect(await appointmentStatus(b.appointmentId)).toEqual({ status: "cancelled", depositPaid: false });
    expect(await paymentStatuses(b.paymentIds)).toEqual(["failed", "failed"]);
    expect(res.cancelledAppointments).toBeGreaterThanOrEqual(1);
  });

  // ------------------------------------------------------------ strażniki: zostaje bez zmian

  it.each(["succeeded", "refunded"])("płatność stara %s (nie-pending) → płatność i wizyta bez zmian", async (status) => {
    const b = await booking([{ status, ageMinutes: STALE }]);
    await cleanupStaleDepositBookings();
    expect(await appointmentStatus(b.appointmentId)).toEqual({ status: "scheduled", depositPaid: false });
    expect(await paymentStatuses(b.paymentIds)).toEqual([status]);
  });

  it("stara failed obok starej succeeded (żywa przez status) → wizyta i płatności bez zmian", async () => {
    const b = await booking([
      { status: "failed", ageMinutes: STALE },
      { status: "succeeded", ageMinutes: STALE },
    ]);
    await cleanupStaleDepositBookings();
    expect(await appointmentStatus(b.appointmentId)).toEqual({ status: "scheduled", depositPaid: false });
    expect(await paymentStatuses(b.paymentIds)).toEqual(["failed", "succeeded"]);
  });

  it("wizyta z deposit_paid = true i starą pending → wizyta i płatność bez zmian", async () => {
    const b = await booking([{ status: "pending", ageMinutes: STALE }], { depositPaid: true });
    await cleanupStaleDepositBookings();
    expect(await appointmentStatus(b.appointmentId)).toEqual({ status: "scheduled", depositPaid: true });
    expect(await paymentStatuses(b.paymentIds)).toEqual(["pending"]);
  });

  it("młodsza od progu pending → wizyta i płatność bez zmian", async () => {
    const b = await booking([{ status: "pending", ageMinutes: FRESH }]);
    await cleanupStaleDepositBookings();
    expect(await appointmentStatus(b.appointmentId)).toEqual({ status: "scheduled", depositPaid: false });
    expect(await paymentStatuses(b.paymentIds)).toEqual(["pending"]);
  });

  it("stara failed obok młodszej failed (żywa przez wiek) → wizyta bez zmian", async () => {
    const b = await booking([
      { status: "failed", ageMinutes: STALE },
      { status: "failed", ageMinutes: FRESH },
    ]);
    await cleanupStaleDepositBookings();
    expect(await appointmentStatus(b.appointmentId)).toEqual({ status: "scheduled", depositPaid: false });
    expect(await paymentStatuses(b.paymentIds)).toEqual(["failed", "failed"]);
  });

  it("stara pending obok młodszej pending → wizyta i obie płatności bez zmian", async () => {
    const b = await booking([
      { status: "pending", ageMinutes: STALE },
      { status: "pending", ageMinutes: FRESH },
    ]);
    await cleanupStaleDepositBookings();
    expect(await appointmentStatus(b.appointmentId)).toEqual({ status: "scheduled", depositPaid: false });
    expect(await paymentStatuses(b.paymentIds)).toEqual(["pending", "pending"]);
  });

  it("wizyta bez żadnej płatności → bez zmian", async () => {
    const b = await booking([]);
    await cleanupStaleDepositBookings();
    expect(await appointmentStatus(b.appointmentId)).toEqual({ status: "scheduled", depositPaid: false });
  });

  it("wizyta innego statusu (confirmed) ze starą pending → wizyta i płatność bez zmian", async () => {
    const b = await booking([{ status: "pending", ageMinutes: STALE }], { status: "confirmed" });
    await cleanupStaleDepositBookings();
    expect(await appointmentStatus(b.appointmentId)).toEqual({ status: "confirmed", depositPaid: false });
    expect(await paymentStatuses(b.paymentIds)).toEqual(["pending"]);
  });

  // ------------------------------------------------------------ idempotencja

  it("idempotencja: drugi przebieg zaraz po pierwszym → 0 i 0, wiersze testu bez zmian", async () => {
    const a = await booking([{ status: "pending", ageMinutes: STALE }]);
    const b = await booking([{ status: "failed", ageMinutes: STALE }]);
    await cleanupStaleDepositBookings();
    const second = await cleanupStaleDepositBookings();
    expect(second).toEqual({ cancelledAppointments: 0, failedPayments: 0 });
    expect(await appointmentStatus(a.appointmentId)).toEqual({ status: "cancelled", depositPaid: false });
    expect(await appointmentStatus(b.appointmentId)).toEqual({ status: "cancelled", depositPaid: false });
    expect(await paymentStatuses([...a.paymentIds, ...b.paymentIds])).toEqual(["failed", "failed"]);
  });
});
