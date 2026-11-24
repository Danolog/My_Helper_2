/**
 * `DELETE /api/clients/[id]` na PRAWDZIWYM Postgresie: anonimizacja danych
 * klienta, sprawdzenie zobowiązań (409) i wyścig z rezerwacją.
 *
 * Trasa w jednej transakcji `forSalon(...).raw`: blokady klienta i jego wizyt,
 * liczenie przyszłych wizyt i zadatków do zwrotu, anonimizacja, `DELETE`.
 *
 * Dowody:
 * a) 200: wartownik (imię, nazwisko, telefon, e-mail) znika z wierszy wizyt
 *    i kart zabiegu klienta (porównanie całego wiersza przez `::text`), liczba
 *    wizyt i sumy kwot bez zmian, żadna wizyta nie wskazuje konta portalu,
 *    konto zostaje. Zakończona wizyta z zadatkiem, nieobecność z zadatkiem
 *    i odwołana przyszła wizyta nie blokują usunięcia;
 * b) 409 przy przyszłej nieodwołanej wizycie i osobno przy odwołanej wizycie
 *    z wpłaconym zadatkiem: kod i dwie liczby, bez danych klienta; wiersze
 *    klienta i wizyt identyczne przed i po (nic nie zapisane);
 * c) wyścig, rezerwacja po blokadzie: usunięcie trzyma klienta (obserwator
 *    zatrzymuje je na wierszu powiadomienia), równoległe wstawienie przyszłej
 *    wizyty czeka na blokadę klienta i po usunięciu dostaje 23503;
 * d) wyścig, rezerwacja przed blokadą: niezatwierdzone wstawienie wizyty
 *    zatrzymuje blokadę klienta; po jego zatwierdzeniu usunięcie widzi wizytę
 *    i kończy się 409.
 * Bariera: `pg_stat_activity` w bieżącej bazie (`datname = current_database()`).
 *
 * Sesja (`auth.api.getSession`, `getSalonContext`) zmockowana; baza prawdziwa,
 * hash hasła prawdziwy. Dane: użytkownicy `it-t3-clianon-…`, kontakty w domenie
 * example.invalid; reszta kaskadą z salonu w `afterAll`.
 * Uruchomienie: `INTEGRATION_POSTGRES_URL=<lokalna baza testowa> pnpm test:pg -- __tests__/pg/clients-delete-anonymize-route.pg.test.ts`.
 * Wymaga bazy po `pnpm db:migrate` (RLS i rola aplikacji).
 */
import { randomInt, randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as route from "@/app/api/clients/[id]/route";
import {
  account,
  appointments,
  clients,
  employees,
  notifications,
  salons,
  services,
  treatmentHistory,
  user,
} from "@/lib/schema";
import { createMockRequest, createRouteParams, parseResponse } from "../api/helpers";

const h = await vi.hoisted(async () => (await import("./pg-harness")).createIntegrationDb());
const ctl = vi.hoisted(() => ({ salonId: "", userId: "" }));

vi.mock("@/lib/db", () => ({
  get db() {
    if (!h) throw new Error("INTEGRATION_POSTGRES_URL not set");
    return h.db;
  },
}));
// Pula systemowa jawnie na tę samą bazę (wygrywa z bezpiecznikiem z __tests__/setup.ts).
vi.mock("@/lib/server/system/db-system", () => ({
  get dbSystem() {
    if (!h) throw new Error("INTEGRATION_POSTGRES_URL not set");
    return h.db;
  },
}));
vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: async () => ({ user: { id: ctl.userId } }) } },
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));
vi.mock("@/lib/salon-context", () => ({
  getSalonContext: async () => ({ salonId: ctl.salonId, role: "owner", employeeId: null, userId: ctl.userId }),
  hasFeatureAccess: async () => false,
}));
vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const RUN = randomUUID().slice(0, 8);
const OWNER = `it-t3-clianon-o-${RUN}`;
const PORTAL_USER = `it-t3-clianon-p-${RUN}`;
const USERS = [OWNER, PORTAL_USER];
const PASSWORD = `IT-haslo-${RUN}`;

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
/** Kolejne terminy co 2 h od `base`, żeby wizyty pracownika się nie nakładały. */
let slotCounter = 0;
function slot(base: number): { startTime: Date; endTime: Date } {
  const start = base + slotCounter++ * 2 * HOUR;
  return { startTime: new Date(start), endTime: new Date(start + HOUR) };
}
const past = () => slot(Date.now() - 60 * DAY);
const future = () => slot(Date.now() + 14 * DAY);

const ids = { salon: "", employee: "", service: "" };

type Sentinel = { firstName: string; lastName: string; phone: string; email: string };

function newSentinel(label: string): Sentinel {
  return {
    firstName: `Wartoslaw${label}${RUN}`,
    lastName: `Zetowski${label}${RUN}`,
    phone: `+48 6${String(randomInt(10_000_000, 99_999_999))}`,
    email: `wartownik-${label}-${RUN}@example.invalid`,
  };
}

async function insertClient(s: Sentinel): Promise<string> {
  const [row] = await h!.db
    .insert(clients)
    .values({ salonId: ids.salon, ...s, notes: `Notatka ${s.firstName}` })
    .returning({ id: clients.id });
  return row!.id;
}

type AppointmentSeed = Partial<typeof appointments.$inferInsert> & { startTime: Date; endTime: Date };

async function insertAppointments(clientId: string, s: Sentinel, rows: AppointmentSeed[]): Promise<string[]> {
  const inserted = await h!.db
    .insert(appointments)
    .values(
      rows.map((r) => ({
        salonId: ids.salon,
        clientId,
        employeeId: ids.employee,
        serviceId: ids.service,
        bookedByUserId: PORTAL_USER,
        notes: `Dzwonic: ${s.firstName} ${s.lastName}, ${s.phone}`,
        guestName: `${s.firstName} ${s.lastName}`,
        guestPhone: s.phone,
        guestEmail: s.email,
        ...r,
      }))
    )
    .returning({ id: appointments.id });
  return inserted.map((r) => r.id);
}

const deleteClientRoute = (clientId: string) =>
  route.DELETE(
    createMockRequest(`http://localhost/api/clients/${clientId}`, { method: "DELETE", body: { password: PASSWORD } }),
    createRouteParams(clientId)
  );

async function clientExists(id: string) {
  return (await h!.db.select({ id: clients.id }).from(clients).where(eq(clients.id, id))).length === 1;
}

/** Wiersze klienta i jego wizyt — do porównania przed i po odmowie. */
async function snapshot(clientId: string, appointmentIds: string[]) {
  return {
    client: await h!.db.select().from(clients).where(eq(clients.id, clientId)),
    appointments: await h!.db
      .select()
      .from(appointments)
      .where(inArray(appointments.id, appointmentIds))
      .orderBy(appointments.startTime),
  };
}

/** Liczba wierszy tabeli (wizyty albo karty zabiegu), których CAŁY wiersz zawiera wartość. */
async function rowsContaining(table: "appointments" | "treatment_history", column: "id" | "appointment_id", rowIds: string[], value: string) {
  const [row] = await h!.observer<{ n: number }[]>`
    select count(*)::int as n from ${h!.observer(table)} t
    where t.${h!.observer(column)} = any(${rowIds}::uuid[]) and t::text ilike ${`%${value}%`}
  `;
  return row?.n ?? 0;
}

/** Błąd z bazy po odwinięciu opakowania Drizzle. */
function dbCode(error: unknown): string | undefined {
  let cur = error as { code?: string; cause?: unknown } | undefined;
  while (cur && !cur.code && cur.cause) cur = cur.cause as typeof cur;
  return cur?.code;
}

/** Czeka, aż zapytanie zaczynające się od `prefix` czeka na blokadę w bieżącej bazie. */
async function waitForBlocked(prefix: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const [row] = await h!.observer<{ n: number }[]>`
      select count(*)::int as n
      from pg_stat_activity
      where datname = current_database()
        and wait_event_type = 'Lock'
        and query ilike ${`${prefix}%`}
    `;
    if ((row?.n ?? 0) >= 1) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`bariera: brak zapytania „${prefix}…” w oczekiwaniu na blokadę po ${timeoutMs} ms`);
}

const suite = h ? describe : describe.skip;

suite("DELETE /api/clients/[id]: anonimizacja, 409 i wyścig z rezerwacją, prawdziwy Postgres", () => {
  beforeAll(async () => {
    const db = h!.db;
    await db.insert(user).values(
      USERS.map((id) => ({ id, name: `IT T3 clianon ${id}`, email: `${id}@example.invalid`, emailVerified: true }))
    );
    const now = new Date();
    await db.insert(account).values({
      id: `${OWNER}-acc`,
      accountId: OWNER,
      providerId: "credential",
      userId: OWNER,
      password: await hashPassword(PASSWORD),
      createdAt: now,
      updatedAt: now,
    });
    const [salon] = await db.insert(salons).values({ name: `IT T3 clianon ${RUN}`, ownerId: OWNER }).returning();
    ids.salon = salon!.id;
    const [employee] = await db
      .insert(employees)
      .values({ salonId: ids.salon, firstName: "Pracownik", lastName: `P-${RUN}` })
      .returning({ id: employees.id });
    ids.employee = employee!.id;
    const [service] = await db
      .insert(services)
      .values({ salonId: ids.salon, name: `Usluga ${RUN}`, basePrice: "150.00", baseDuration: 60 })
      .returning({ id: services.id });
    ids.service = service!.id;
  });

  afterAll(async () => {
    if (!h) return;
    try {
      if (ids.salon) await h.db.delete(salons).where(eq(salons.id, ids.salon));
      await h.db.delete(user).where(inArray(user.id, USERS));
    } finally {
      await h.end();
    }
  });

  beforeEach(() => {
    ctl.salonId = ids.salon;
    ctl.userId = OWNER;
  });

  it("a) 200: wartownik znika z wizyt i kart zabiegu, liczba wizyt i kwoty bez zmian, booked_by_user_id NULL", async () => {
    const s = newSentinel("a");
    const clientId = await insertClient(s);
    const apptIds = await insertAppointments(clientId, s, [
      { ...past(), status: "completed", depositAmount: "45.00", depositPaid: true, discountAmount: "10.00" },
      { ...past(), status: "no_show", depositAmount: "20.00", depositPaid: true },
      { ...past(), status: "cancelled", depositAmount: "30.00", depositPaid: false },
      { ...future(), status: "cancelled" },
    ]);
    await h!.db.insert(treatmentHistory).values({
      appointmentId: apptIds[0]!,
      recipe: `Receptura dla ${s.firstName} ${s.lastName}`,
      notes: `Uwagi ${s.phone}`,
      materialsJson: [{ note: s.email }],
    });

    const totals = () =>
      h!.db
        .select({
          count: sql<number>`count(*)::int`,
          deposits: sql<string>`coalesce(sum(${appointments.depositAmount}), 0)::text`,
          discounts: sql<string>`coalesce(sum(${appointments.discountAmount}), 0)::text`,
        })
        .from(appointments)
        .where(inArray(appointments.id, apptIds));
    const totalsBefore = await totals();
    // Kontrola fałszywej zieleni: przed usunięciem skan widzi wartownika.
    expect(await rowsContaining("appointments", "id", apptIds, s.email)).toBe(4);
    expect(await rowsContaining("treatment_history", "appointment_id", apptIds, s.phone)).toBe(1);

    const { status, body } = await parseResponse(await deleteClientRoute(clientId));

    expect(status, JSON.stringify(body)).toBe(200);
    // Odpowiedź niesie sam identyfikator — żadnej wartości wartownika.
    expect(body).toEqual({ success: true, data: { id: clientId } });
    for (const value of Object.values(s)) expect(JSON.stringify(body)).not.toContain(value);
    expect(await clientExists(clientId)).toBe(false);
    for (const value of Object.values(s)) {
      expect(await rowsContaining("appointments", "id", apptIds, value), `wizyty: ${value}`).toBe(0);
      expect(await rowsContaining("treatment_history", "appointment_id", apptIds, value), `karty: ${value}`).toBe(0);
    }
    expect(await totals()).toEqual(totalsBefore);
    expect(totalsBefore[0]).toEqual({ count: 4, deposits: "95.00", discounts: "10.00" });
    const stillBooked = await h!.db
      .select({ id: appointments.id })
      .from(appointments)
      .where(and(inArray(appointments.id, apptIds), sql`${appointments.bookedByUserId} is not null`));
    expect(stillBooked).toEqual([]);
    expect(await h!.db.select({ id: user.id }).from(user).where(eq(user.id, PORTAL_USER))).toHaveLength(1);
  });

  it.each([
    [
      "przyszła nieodwołana wizyta",
      (): AppointmentSeed[] => [{ ...future(), status: "scheduled" }, { ...past(), status: "completed", depositAmount: "40.00", depositPaid: true }],
      { futureAppointments: 1, depositsToRefund: 0 },
    ],
    [
      "odwołana wizyta z wpłaconym zadatkiem",
      (): AppointmentSeed[] => [{ ...past(), status: "cancelled", depositAmount: "50.00", depositPaid: true }],
      { futureAppointments: 0, depositsToRefund: 1 },
    ],
  ])("b) 409: %s → kod i liczby, bez danych klienta; dane nietknięte", async (_label, seed, expected) => {
    const s = newSentinel(`b${slotCounter}`);
    const clientId = await insertClient(s);
    const apptIds = await insertAppointments(clientId, s, seed());
    const before = await snapshot(clientId, apptIds);

    const { status, body } = await parseResponse<Record<string, unknown>>(await deleteClientRoute(clientId));

    expect(status, JSON.stringify(body)).toBe(409);
    expect(body).toEqual({
      success: false,
      code: "CLIENT_HAS_PENDING_OBLIGATIONS",
      error: expect.any(String),
      ...expected,
    });
    for (const value of Object.values(s)) expect(JSON.stringify(body)).not.toContain(value);
    expect(await snapshot(clientId, apptIds)).toEqual(before);
  });

  it("c) wyścig: rezerwacja po blokadzie klienta czeka na nią i po usunięciu dostaje 23503", async () => {
    const s = newSentinel("c");
    const clientId = await insertClient(s);
    const [notification] = await h!.db
      .insert(notifications)
      .values({ salonId: ids.salon, clientId, type: "sms", message: `Przypomnienie ${s.phone}`, status: "sent" })
      .returning({ id: notifications.id });

    let removal: Promise<Response> | null = null;
    let booking: Promise<unknown> | null = null;
    // Obserwator trzyma wiersz powiadomienia: usunięcie ma już blokadę klienta
    // i staje na UPDATE powiadomień. Wtedy rezerwacja przyszłej wizyty dla
    // tego klienta (sprawdzenie klucza obcego) musi czekać na blokadę klienta.
    await h!.observer.begin(async (tx) => {
      await tx.unsafe("select id from notifications where id = $1 for update", [notification!.id]);
      removal = deleteClientRoute(clientId);
      await waitForBlocked('update "notifications"');
      booking = h!.db
        .insert(appointments)
        .values({ salonId: ids.salon, clientId, employeeId: ids.employee, ...future(), status: "scheduled" })
        .then(
          () => null,
          (e: unknown) => e
        );
      await waitForBlocked('insert into "appointments"');
    });

    const removed = await parseResponse(await removal!);
    expect(removed.status, JSON.stringify(removed.body)).toBe(200);
    expect(dbCode(await booking!)).toBe("23503");
    expect(await clientExists(clientId)).toBe(false);
  });

  it("d) wyścig: rezerwacja zatwierdzona, gdy usunięcie czeka na blokadę klienta → 409, klient zostaje", async () => {
    const s = newSentinel("d");
    const clientId = await insertClient(s);
    const { startTime, endTime } = future();

    let removal: Promise<Response> | null = null;
    // Niezatwierdzone wstawienie wizyty trzyma `FOR KEY SHARE` na kliencie,
    // więc `FOR UPDATE` usunięcia czeka. Po zatwierdzeniu liczenie (już po
    // blokadach) widzi nową wizytę.
    await h!.observer.begin(async (tx) => {
      await tx.unsafe(
        `insert into appointments (salon_id, client_id, employee_id, start_time, end_time, status)
         values ($1, $2, $3, $4, $5, 'scheduled')`,
        [ids.salon, clientId, ids.employee, startTime.toISOString(), endTime.toISOString()]
      );
      removal = deleteClientRoute(clientId);
      await waitForBlocked('select "id" from "clients"');
    });

    const { status, body } = await parseResponse<Record<string, unknown>>(await removal!);
    expect(status, JSON.stringify(body)).toBe(409);
    expect(body.futureAppointments).toBe(1);
    expect(body.depositsToRefund).toBe(0);
    expect(await clientExists(clientId)).toBe(true);
  });
});
