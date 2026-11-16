/**
 * `purgeE2eAppointments()` (teardown E2E, #175) i `purgeE2eEmployees()` (#199)
 * na PRAWDZIWYM Postgresie.
 *
 * Kontrakt: usuwa twardo wyłącznie wizyty ze znacznikiem `[E2E]` na początku
 * `notes` albo `guest_name`, tylko w podanych salonach; zależne `deposit_payments`
 * znikają kaskadą; wizyty bez znacznika (w tym z `[E2E]` w środku tekstu
 * i stare „Gosc E2E” bez prefiksu) zostają. Bezpiecznik w transakcji: zmiana
 * liczby wizyt bez znacznika = ROLLBACK i błąd.
 *
 * Dane: dwóch użytkowników `it-t3-e2ec-…` (prefiks z notatki sprzątania w pg-harness.ts),
 * każdy z jednym salonem i pracownikiem; `afterAll` usuwa salony po właścicielach
 * (kaskada wizyt/pracowników), potem użytkowników — także po awarii `beforeAll`.
 * Uruchomienie: `INTEGRATION_POSTGRES_URL=postgresql://…@localhost:5432/pos_dev pnpm test:pg`.
 */
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { appointments, depositPayments, employees, salons, user } from "@/lib/schema";
import { E2E_MARKER, purgeE2eAppointments, purgeE2eEmployees } from "../../tests/e2e-cleanup";

const h = await vi.hoisted(async () => (await import("./pg-harness")).createIntegrationDb());

const RUN = randomUUID().slice(0, 8);
// Osobny właściciel na salon: salons_owner_id_uq — jeden salon na właściciela.
const USER_A = `it-t3-e2ec-${RUN}-a`;
const USER_B = `it-t3-e2ec-${RUN}-b`;
const USERS = [USER_A, USER_B];
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
    await db.insert(user).values(USERS.map((id) => ({ id, name: "IT T3 e2ec", email: `${id}@example.invalid` })));
    const [a] = await db.insert(salons).values({ name: `IT T3 e2ec A ${RUN}`, ownerId: USER_A }).returning();
    const [b] = await db.insert(salons).values({ name: `IT T3 e2ec B ${RUN}`, ownerId: USER_B }).returning();
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
      // Po właścicielach, nie po zmiennych salonA/salonB: sprząta też salon
      // utworzony przed awarią beforeAll w połowie (zmienna jeszcze pusta).
      await h.db.delete(salons).where(inArray(salons.ownerId, USERS));
      await h.db.delete(user).where(inArray(user.id, USERS));
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

// #199: pracownicy E2E. Te same salony co wyżej (describe biegną po kolei w jednym pliku).
describe.skipIf(!h)("purgeE2eEmployees (pg)", () => {
  async function emp(salonId: string, firstName: string, lastName: string) {
    const [row] = await h!.db.insert(employees).values({ salonId, firstName, lastName }).returning({ id: employees.id });
    return row!.id;
  }
  async function idsIn(salonIds: string[]) {
    const rows = await h!.db.select({ id: employees.id }).from(employees).where(inArray(employees.salonId, salonIds));
    return new Set(rows.map((x) => x.id));
  }

  it("usuwa tylko oznaczonych pracowników podanego salonu; reszta zostaje", async () => {
    const before = await idsIn([salonA, salonB]); // empA, empB
    const marked = [
      await emp(salonA, E2E_MARKER, "Edycja"), // jak pracownicy testu edycji
      await emp(salonA, `${E2E_MARKER} Anna`, "Kowalska"), // jak formularz "Dodaj pracownika"
      await emp(salonA, "Imie", `${E2E_MARKER} Nazwisko`),
    ];
    const keep = [
      await emp(salonA, "E2E", "Status"), // stara nazwa bez prefiksu (przed #199)
      await emp(salonA, "Anna", `Kowalska ${E2E_MARKER}`), // znacznik w środku
      await emp(salonA, "[e2e]", "mała litera"),
      await emp(salonB, E2E_MARKER, "inny salon"), // poza listą salonów
    ];

    const r = await purgeE2eEmployees(h!.observer, [salonA]);

    expect(await idsIn([salonA, salonB])).toEqual(new Set([...before, ...keep]));
    expect(r.deleted).toBe(marked.length);
    expect(r.untouchedAfter).toBe(r.untouchedBefore);
    expect(r.appointmentsAfter).toBe(r.appointmentsBefore);
  });

  it("oznaczony pracownik z wizytą bez znacznika = ROLLBACK: pracownik i wizyta zostają", async () => {
    const id = await emp(salonA, E2E_MARKER, "z prawdziwa wizyta");
    const visit = await appt(salonA, id, {}); // wizyta bez znacznika — kaskada by ją zabrała

    await expect(purgeE2eEmployees(h!.observer, [salonA])).rejects.toThrow(/wycofano/);

    expect(await idsIn([salonA])).toContain(id);
    const left = await h!.db.select({ id: appointments.id }).from(appointments).where(eq(appointments.id, visit));
    expect(left, "wizyta bez znacznika nie zniknęła kaskadą").toHaveLength(1);
    // Sprzątanie stanu dla kolejnych testów: bez wizyty pracownik znika normalnie.
    await h!.db.delete(appointments).where(eq(appointments.id, visit));
    expect((await purgeE2eEmployees(h!.observer, [salonA])).deleted).toBe(1);
  });

  it("pusta lista salonów = błąd, nie DELETE bez zakresu", async () => {
    await expect(purgeE2eEmployees(h!.observer, [])).rejects.toThrow(/brak salonów/);
  });
});
