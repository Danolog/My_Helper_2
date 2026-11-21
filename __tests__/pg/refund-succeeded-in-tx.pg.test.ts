/**
 * `selectSucceededDepositsInTx` (#193) na PRAWDZIWYM Postgresie, pod rolą aplikacji
 * z kontekstem RLS salonu (`forSalon(salonId).raw`):
 * - widzi płatności `succeeded` wizyty własnego salonu, od najstarszej (paid_at, id);
 * - pomija `pending`, `refunded`, `failed`;
 * - wizyta salonu B pod `forSalon(A)` → pusto (filtr `eq(salonId)`), a także gdy
 *   wołający poda `salonId` B (sama polityka RLS);
 * - wynik zgodny z `selectSucceededDeposits` (rola migracji) dla tej samej wizyty.
 *
 * Dane: konta `it-t3-rsit-…-a` i `-b` (właściciele), salony A i B, pracownicy, wizyty
 * i płatności zapisane rolą migracji. Salony usuwane w `afterAll` (kaskada: wizyty
 * i płatności). Bez danych klientów (wizyty bez gościa i klienta).
 *
 *   INTEGRATION_POSTGRES_URL=postgresql://…@localhost:5432/pos_dev pnpm test:pg
 */
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { selectSucceededDeposits, selectSucceededDepositsInTx } from "@/lib/refund";
import { appointments, depositPayments, employees, salons, user } from "@/lib/schema";
import { forSalon } from "@/lib/server/repository";
import { APP_ROLE } from "../../scripts/db-rls-guard";

const h = await vi.hoisted(async () => (await import("./pg-harness")).createIntegrationDb());

vi.mock("@/lib/db", () => ({
  get db() {
    if (!h) throw new Error("INTEGRATION_POSTGRES_URL not set");
    return h.db;
  },
}));

const suite = h ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const USER_ID = `it-t3-rsit-${RUN}`;
let salonA = "";
let salonB = "";
const employeeOf: Record<string, string> = {};
let slot = 0;

/** Wizyta salonu (rola migracji); każda w osobnym, dalekim terminie. */
async function appointment(salonId: string): Promise<string> {
  const start = new Date(Date.UTC(2099, 6, 1, 8) + slot++ * 3_600_000);
  const [a] = await h!.db
    .insert(appointments)
    .values({ salonId, employeeId: employeeOf[salonId]!, startTime: start, endTime: new Date(start.getTime() + 1_800_000), depositPaid: true })
    .returning({ id: appointments.id });
  return a!.id;
}

/** Płatność zadatku wizyty (rola migracji). */
async function payment(salonId: string, appointmentId: string, status: string, paidAt: Date | null): Promise<string> {
  const [p] = await h!.db
    .insert(depositPayments)
    .values({ salonId, appointmentId, amount: "20.00", paymentMethod: "blik", status, paidAt })
    .returning({ id: depositPayments.id });
  return p!.id;
}

/** Odczyt pod `forSalon(ctx)`; zwraca też rolę bieżącą (kontrola fałszywej zieleni). */
async function readAs(ctx: string, salonId: string, appointmentId: string) {
  return forSalon(ctx).raw(async (tx) => {
    const roleRows = (await tx.execute(sql`select current_user as u`)) as unknown as Array<{ u: string }>;
    const rows = await selectSucceededDepositsInTx(tx, salonId, appointmentId);
    return { role: roleRows[0]!.u, rows };
  });
}

suite("selectSucceededDepositsInTx — prawdziwy Postgres, rola aplikacji z RLS", () => {
  let apptA = "";
  let apptB = "";
  const expectedA: string[] = [];
  let paymentB = "";

  beforeAll(async () => {
    const db = h!.db;
    for (const label of ["A", "B"]) {
      // Jedno konto = jeden salon (salons_owner_id_uq) — osobny właściciel dla A i B.
      const ownerId = `${USER_ID}-${label.toLowerCase()}`;
      await db.insert(user).values({ id: ownerId, name: "IT T3 rsit", email: `${ownerId}@example.invalid` });
      const [s] = await db.insert(salons).values({ name: `IT T3 rsit ${label} ${RUN}`, ownerId }).returning({ id: salons.id });
      const [e] = await db.insert(employees).values({ salonId: s!.id, firstName: "IT", lastName: "Pracownik" }).returning({ id: employees.id });
      employeeOf[s!.id] = e!.id;
      if (label === "A") salonA = s!.id;
      else salonB = s!.id;
    }

    apptA = await appointment(salonA);
    apptB = await appointment(salonB);

    const early = new Date(Date.UTC(2099, 5, 1, 10));
    const late = new Date(Date.UTC(2099, 5, 2, 10));
    // Zapis w kolejności odwrotnej do oczekiwanej: późniejsza wpłata najpierw.
    const later = await payment(salonA, apptA, "succeeded", late);
    // Dwie wpłaty z tym samym paid_at — rozstrzyga id.
    const tieX = await payment(salonA, apptA, "succeeded", early);
    const tieY = await payment(salonA, apptA, "succeeded", early);
    await payment(salonA, apptA, "pending", null);
    await payment(salonA, apptA, "refunded", early);
    await payment(salonA, apptA, "failed", null);
    expectedA.push(...[tieX, tieY].sort(), later);

    paymentB = await payment(salonB, apptB, "succeeded", early);
  });

  afterAll(async () => {
    if (!h) return;
    try {
      // Kaskada z salonów: pracownicy, wizyty i ich płatności.
      for (const s of [salonA, salonB]) if (s) await h.db.delete(salons).where(eq(salons.id, s));
      for (const label of ["a", "b"]) await h.db.delete(user).where(eq(user.id, `${USER_ID}-${label}`));
    } finally {
      await h.end();
    }
  });

  it("forSalon(A): płatności 'succeeded' wizyty A od najstarszej (paid_at, id), bez pending/refunded/failed", async () => {
    const { role, rows } = await readAs(salonA, salonA, apptA);
    expect(role).toBe(APP_ROLE);
    expect(rows.map((r) => r.id)).toEqual(expectedA);
    expect(rows.every((r) => r.status === "succeeded" && r.salonId === salonA && r.appointmentId === apptA)).toBe(true);
  });

  it("forSalon(A): wizyta salonu B → pusto", async () => {
    const { role, rows } = await readAs(salonA, salonA, apptB);
    expect(role).toBe(APP_ROLE);
    expect(rows).toEqual([]);
  });

  it("forSalon(A) z salonId B od wołającego: wizyta B → pusto (odcina polityka RLS)", async () => {
    const { role, rows } = await readAs(salonA, salonB, apptB);
    expect(role).toBe(APP_ROLE);
    expect(rows).toEqual([]);
    // Kontrola fałszywej zieleni: płatność B istnieje i jest widoczna we własnym kontekście.
    const own = await readAs(salonB, salonB, apptB);
    expect(own.rows.map((r) => r.id)).toEqual([paymentB]);
  });

  it("jawna lista kolumn: bez identyfikatorów Stripe, numeru BLIK i powodu zwrotu", async () => {
    const { rows } = await readAs(salonA, salonA, apptA);
    expect(Object.keys(rows[0]!).sort()).toEqual(
      ["amount", "appointmentId", "currency", "id", "paidAt", "paymentMethod", "salonId", "status"]
    );
  });

  it("ten sam wynik co selectSucceededDeposits (rola migracji) dla wizyty A", async () => {
    const legacy = await selectSucceededDeposits(apptA);
    const { rows } = await readAs(salonA, salonA, apptA);
    expect(rows.map((r) => r.id)).toEqual(legacy.map((r) => r.id));
  });
});
