/**
 * Wpis dziennika `deposit_status_events` ze zwrotu zadatków (`refundAppointmentDeposits`)
 * na PRAWDZIWYM Postgresie:
 * - wszystkie zwroty udane i flaga true → flaga false i jeden wpis `refund` bez aktora;
 * - flaga już false → zwrot przechodzi, bez wpisu;
 * - wpis odrzucony przez CHECK tabeli → błąd do wołającego, flaga zostaje true, 0 wpisów
 *   (UPDATE wizyty cofnięty razem z wpisem).
 *
 * `@/lib/db` wskazuje bazę testową, Stripe podmieniony; pomocnik dziennika prawdziwy,
 * z przełącznikiem, który zamiast poprawnego wpisu robi w tej samej transakcji INSERT
 * łamiący CHECK kierunku (`refund` z `deposit_paid = true`).
 *
 * Dane: konto `it-t3-refevt-…`, salon, pracownik, wizyty w 2096 r. z płatnością
 * `succeeded`; salon usuwany w `afterAll` (kaskada: wizyty, płatności, wpisy).
 *
 *   INTEGRATION_POSTGRES_URL=postgresql://…@localhost:5432/pos_dev pnpm test:pg
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { refundAppointmentDeposits } from "@/lib/refund";
import { appointments, depositPayments, depositStatusEvents, employees, salons, user } from "@/lib/schema";

const h = await vi.hoisted(async () => (await import("./pg-harness")).createIntegrationDb());
const ctl = vi.hoisted(() => ({ violateCheck: false }));

vi.mock("@/lib/db", () => ({
  get db() {
    if (!h) throw new Error("INTEGRATION_POSTGRES_URL not set");
    return h.db;
  },
}));
const { refundsCreate } = vi.hoisted(() => ({ refundsCreate: vi.fn() }));
vi.mock("@/lib/stripe", () => ({
  getStripe: () => ({ refunds: { create: (...a: unknown[]) => refundsCreate(...a) } }),
}));
vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
// Prawdziwy pomocnik; przełącznik wstawia w TEJ transakcji wiersz łamiący CHECK kierunku.
vi.mock("@/lib/deposit-status-events", async (orig) => {
  const actual = await orig<typeof import("@/lib/deposit-status-events")>();
  const schema = await import("@/lib/schema");
  return {
    ...actual,
    recordDepositStatusEvent: async (...args: Parameters<typeof actual.recordDepositStatusEvent>) => {
      const [tx, input] = args;
      if (ctl.violateCheck) {
        await tx.insert(schema.depositStatusEvents).values({
          salonId: input.salonId,
          appointmentId: input.appointmentId,
          depositPaid: true,
          previousDepositPaid: false,
          source: "refund",
          actorUserId: null,
          actorRole: null,
        });
        return;
      }
      await actual.recordDepositStatusEvent(...args);
    },
  };
});

const suite = h ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const USER_ID = `it-t3-refevt-${RUN}`;
const ids = { salon: "", employee: "" };
let slot = 0;

/** Wizyta z jedną płatnością Stripe `succeeded`; każda w osobnym terminie w 2096 r. */
async function paidAppointment(depositPaid: boolean) {
  const db = h!.db;
  const start = new Date(Date.UTC(2096, 2, 1, 8) + slot++ * 3_600_000);
  const [appt] = await db
    .insert(appointments)
    .values({
      salonId: ids.salon,
      employeeId: ids.employee,
      startTime: start,
      endTime: new Date(start.getTime() + 1_800_000),
      status: "cancelled",
      depositAmount: "50.00",
      depositPaid,
    })
    .returning({ id: appointments.id });
  await db.insert(depositPayments).values({
    appointmentId: appt!.id,
    salonId: ids.salon,
    amount: "50.00",
    paymentMethod: "stripe",
    status: "succeeded",
    stripePaymentIntentId: `pi_it_${randomUUID().slice(0, 8)}`,
    paidAt: new Date(),
  });
  return appt!.id;
}

async function flagOf(appt: string): Promise<boolean | null> {
  const [a] = await h!.db.select({ v: appointments.depositPaid }).from(appointments).where(eq(appointments.id, appt));
  return a!.v;
}

const eventsOf = (appt: string) =>
  h!.db.select().from(depositStatusEvents).where(eq(depositStatusEvents.appointmentId, appt));

/** Kod SQLSTATE z błędu sterownika (bezpośrednio albo w `cause` opakowania Drizzle). */
function sqlState(error: unknown): unknown {
  const e = error as { code?: unknown; cause?: { code?: unknown } };
  return e?.cause?.code ?? e?.code;
}

suite("refundAppointmentDeposits — dziennik zmian zadatku, prawdziwy Postgres", () => {
  beforeAll(async () => {
    const db = h!.db;
    await db.insert(user).values({ id: USER_ID, name: "IT T3 refevt", email: `${USER_ID}@example.invalid` });
    const [salon] = await db.insert(salons).values({ name: `IT T3 refevt ${RUN}`, ownerId: USER_ID }).returning({ id: salons.id });
    ids.salon = salon!.id;
    const [emp] = await db
      .insert(employees)
      .values({ salonId: ids.salon, firstName: "IT", lastName: "Pracownik" })
      .returning({ id: employees.id });
    ids.employee = emp!.id;
  });

  afterAll(async () => {
    if (!h) return;
    try {
      // Kaskada z salonu: pracownik, wizyty, płatności i wpisy dziennika.
      if (ids.salon) await h.db.delete(salons).where(eq(salons.id, ids.salon));
      await h.db.delete(user).where(eq(user.id, USER_ID));
    } finally {
      await h.end();
    }
  });

  beforeEach(() => {
    ctl.violateCheck = false;
    refundsCreate.mockReset();
    refundsCreate.mockResolvedValue({ id: "re_it_refevt" });
  });

  it("zwrot udany i flaga true → flaga false, jeden wpis refund bez aktora", async () => {
    const appt = await paidAppointment(true);

    const result = await refundAppointmentDeposits(appt, "it zwrot");

    expect(result).toMatchObject({ success: true, refunded: true, paymentCount: 1 });
    expect(await flagOf(appt)).toBe(false);
    const events = await eventsOf(appt);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      salonId: ids.salon,
      appointmentId: appt,
      depositPaid: false,
      previousDepositPaid: true,
      source: "refund",
      actorUserId: null,
      actorRole: null,
    });
  });

  it("flaga już false → zwrot udany, bez wpisu", async () => {
    const appt = await paidAppointment(false);

    const result = await refundAppointmentDeposits(appt, "it zwrot");

    expect(result).toMatchObject({ success: true, refunded: true });
    expect(await flagOf(appt)).toBe(false);
    expect(await eventsOf(appt)).toHaveLength(0);
  });

  it("wpis odrzucony przez CHECK → błąd do wołającego, flaga zostaje true, 0 wpisów", async () => {
    const appt = await paidAppointment(true);
    ctl.violateCheck = true;

    const error = await refundAppointmentDeposits(appt, "it zwrot").then(
      () => null,
      (e: unknown) => e
    );

    expect(error, "zwrot nie zgłosił błędu wpisu").not.toBeNull();
    expect(sqlState(error)).toBe("23514");
    expect(await flagOf(appt)).toBe(true);
    expect(await eventsOf(appt)).toHaveLength(0);
  });
});
