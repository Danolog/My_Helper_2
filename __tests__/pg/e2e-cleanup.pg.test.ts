/**
 * `purgeE2eAppointments()` (teardown E2E, #175) na PRAWDZIWYM Postgresie.
 *
 * Kontrakt: usuwa twardo wyłącznie wizyty ze znacznikiem `[E2E]` na początku
 * `notes` albo `guest_name`, tylko w podanych salonach; zależne `deposit_payments`
 * znikają kaskadą; wizyty bez znacznika (w tym z `[E2E]` w środku tekstu
 * i stare „Gosc E2E” bez prefiksu) zostają. Bezpiecznik w transakcji: zmiana
 * liczby wizyt bez znacznika = ROLLBACK i błąd.
 *
 * Dane: użytkownik `it-t3-e2ec-…` (prefiks z notatki sprzątania w pg-harness.ts),
 * dwa salony z pracownikiem; wszystko kaskadą z salonów w `afterAll`.
 * Uruchomienie: `INTEGRATION_POSTGRES_URL=postgresql://…@localhost:5432/pos_dev pnpm test:pg`.
 */
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { appointments, depositPayments, employees, salons, user } from "@/lib/schema";
import { E2E_MARKER, purgeE2eAppointments } from "../../tests/e2e-cleanup";

const h = await vi.hoisted(async () => (await import("./pg-harness")).createIntegrationDb());

const RUN = randomUUID().slice(0, 8);
const USER_ID = `it-t3-e2ec-${RUN}`;
let salonA = "";
let salonB = "";
let empA = "";
let empB = "";
let slot = 0;

async function appt(salonId: string, employeeId: string, fields: { notes?: string; guestName?: string }) {
  // Każda wizyta w osobnym, dalekim terminie — bez kolizji z EXCLUDE.
  const start = new Date(Date.UTC(2098, 0, 1, 8) + slot++ * 3_600_000);
  const [row] = await h!.db
    .insert(appointments)
    .values({
      salonId,
      employeeId,
      startTime: start,
      endTime: new Date(start.getTime() + 1_800_000),
      status: "cancelled",
      notes: fields.notes ?? null,
      guestName: fields.guestName ?? null,
    })
    .returning({ id: appointments.id });
  return row!.id;
}

describe.skipIf(!h)("purgeE2eAppointments (pg)", () => {
  beforeAll(async () => {
    const db = h!.db;
    await db.insert(user).values({ id: USER_ID, name: "IT T3 e2ec", email: `${USER_ID}@example.invalid` });
    const [a] = await db.insert(salons).values({ name: `IT T3 e2ec A ${RUN}`, ownerId: USER_ID }).returning();
    const [b] = await db.insert(salons).values({ name: `IT T3 e2ec B ${RUN}`, ownerId: USER_ID }).returning();
    salonA = a!.id;
    salonB = b!.id;
    const [ea] = await db.insert(employees).values({ salonId: salonA, firstName: "IT", lastName: "A" }).returning();
    const [eb] = await db.insert(employees).values({ salonId: salonB, firstName: "IT", lastName: "B" }).returning();
    empA = ea!.id;
    empB = eb!.id;
  });

  afterAll(async () => {
    if (!h) return;
    try {
      const ids = [salonA, salonB].filter(Boolean);
      if (ids.length) await h.db.delete(salons).where(inArray(salons.id, ids));
      await h.db.delete(user).where(eq(user.id, USER_ID));
    } finally {
      await h.end();
    }
  });

  it("usuwa tylko oznaczone wizyty podanego salonu, z kaskadą deposit_payments; reszta zostaje", async () => {
    const markedNotes = await appt(salonA, empA, { notes: `${E2E_MARKER} kalendarz API` });
    const markedGuest = await appt(salonA, empA, { guestName: `${E2E_MARKER} Gosc` });
    const [payment] = await h!.db
      .insert(depositPayments)
      .values({ appointmentId: markedGuest, salonId: salonA, amount: "60.00", paymentMethod: "stripe" })
      .returning({ id: depositPayments.id });
    const keep = [
      await appt(salonA, empA, {}), // bez notes i gościa — jak ręcznie umówiona wizyta
      await appt(salonA, empA, { notes: `Klientka prosi: ${E2E_MARKER} w środku tekstu` }),
      await appt(salonA, empA, { guestName: "Gosc E2E" }), // stara nazwa bez prefiksu
      await appt(salonA, empA, { notes: "[e2e] mała litera" }),
      await appt(salonB, empB, { notes: `${E2E_MARKER} inny salon` }), // poza listą salonów
    ];

    const r = await purgeE2eAppointments(h!.observer, [salonA]);

    const left = await h!.db
      .select({ id: appointments.id })
      .from(appointments)
      .where(inArray(appointments.salonId, [salonA, salonB]));
    expect(new Set(left.map((x) => x.id))).toEqual(new Set(keep));
    expect(r.deleted).toBe(2);
    expect(r.untouchedAfter).toBe(r.untouchedBefore);
    const payments = await h!.db.select().from(depositPayments).where(eq(depositPayments.id, payment!.id));
    expect(payments, "deposit_payments oznaczonej wizyty usunięte kaskadą").toEqual([]);
    expect(left.map((x) => x.id)).not.toContain(markedNotes);
  });

  it("drugi przebieg bez nowych oznaczonych wizyt niczego nie usuwa", async () => {
    const r = await purgeE2eAppointments(h!.observer, [salonA]);
    expect(r.deleted).toBe(0);
  });

  it("pusta lista salonów = błąd, nie DELETE bez zakresu", async () => {
    await expect(purgeE2eAppointments(h!.observer, [])).rejects.toThrow(/brak salonów/);
  });
});
