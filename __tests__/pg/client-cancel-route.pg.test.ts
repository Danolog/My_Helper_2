/**
 * #193 (ADR-002): `GET/POST /api/client/appointments/[id]/cancel` na PRAWDZIWYM
 * Postgresie — salony A i B, klienci X i Y (obaj w salonie A), personel P.
 *
 * Trasa: odczyt wizyty przez `findClientAppointmentForUser(sesja, id)` (pula
 * systemowa, warunek `booked_by_user_id`), potem odczyt płatności i zapis
 * anulowania przez `forSalon(salon z wyniku odczytu)` — rola aplikacji bez
 * BYPASSRLS + `app.current_salon_id`. Zapis ponawia warunki id, salonu,
 * tożsamości i stanu.
 *
 * Dowody:
 * 1. X anuluje swoją wizytę w A i swoją w B (dokładny zbiór zmienionych id).
 * 2/3. Y nie widzi ani nie anuluje wizyt X (A i B): 404, stan tabeli bez zmian.
 * 4. Dokładny zbiór kluczy odpowiedzi GET i POST (także zagnieżdżonych).
 * 5. Odczyt wskazuje salon A, a wizyta jest w B: zapis pod forSalon(A) = 0 wierszy,
 *    404, bez zwrotu i bez powiadomienia listy oczekujących.
 * 6. Odczyt zwraca wizytę X, a sesja to Y: ponowiony warunek tożsamości w zapisie
 *    = 0 wierszy, 404, bez skutków ubocznych.
 * 7. Dwa równoległe anulowania tej samej wizyty na dwóch połączeniach, oba UPDATE
 *    w locie jednocześnie (bariera: blokada wiersza trzymana przez obserwatora):
 *    dokładnie jedno 200, drugie 404, jedno powiadomienie listy oczekujących.
 * 8. Płatność `succeeded` odczytana pod rolą aplikacji: GET mówi „zwrot”, nie
 *    „rozlicza salon”; POST zwraca zadatek.
 * 9. Wizyta dodana przez personel P (booked_by_user_id NULL) nie jest widoczna ani
 *    anulowalna w portalu konta P: 404, stan bez zmian.
 *
 * Mocki: sesja (`requireAuth`), logger, powiadomienie listy oczekujących (licznik
 * skutków ubocznych). Baza, RLS, odczyt systemowy i zwrot zadatku — prawdziwe.
 *
 * Dane: użytkownicy `it-t3-ccancel-…`; reszta kaskadą z salonów w `afterAll`.
 * Terminy 72 h od teraz (polityka > 24 h → zwrot).
 * Uruchomienie: `INTEGRATION_POSTGRES_URL=postgresql://…@localhost:5432/<baza> pnpm test:pg -- __tests__/pg/client-cancel-route.pg.test.ts`.
 * Wymaga bazy po `pnpm db:migrate` (RLS i rola `myhelper_app`).
 */
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as route from "@/app/api/client/appointments/[id]/cancel/route";
import {
  appointments,
  clients,
  depositPayments,
  employees,
  salons,
  services,
  user,
} from "@/lib/schema";
import type { ClientAppointmentForCancel } from "@/lib/server/system";
import { createRouteParams, parseResponse } from "../api/helpers";

const h = await vi.hoisted(async () => (await import("./pg-harness")).createIntegrationDb());

/**
 * `userId` — konto z sesji; `findOverride` — podmiana wyniku odczytu systemowego
 * (null = prawdziwa funkcja), do dowodu warunków ponowionych w zapisie.
 */
const ctl = vi.hoisted(() => ({
  userId: "",
  findOverride: null as null | ((sessionUserId: string, id: string) => Promise<unknown>),
  notify: { calls: 0 },
}));

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
vi.mock("@/lib/server/system", async (orig) => {
  const real = await orig<typeof import("@/lib/server/system")>();
  return {
    ...real,
    findClientAppointmentForUser: (sessionUserId: string, id: string) =>
      ctl.findOverride
        ? (ctl.findOverride(sessionUserId, id) as ReturnType<typeof real.findClientAppointmentForUser>)
        : real.findClientAppointmentForUser(sessionUserId, id),
  };
});
vi.mock("@/lib/auth-middleware", () => ({
  requireAuth: async () => ({ user: { id: ctl.userId } }),
  isAuthError: () => false,
}));
vi.mock("@/lib/waiting-list", () => ({
  notifyWaitingList: async () => {
    ctl.notify.calls++;
    return { notified: 0, smsCount: 0, pushCount: 0, errors: 0 };
  },
}));
vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const RUN = randomUUID().slice(0, 8);
const OWNER_A = `it-t3-ccancel-oa-${RUN}`;
const OWNER_B = `it-t3-ccancel-ob-${RUN}`;
const USER_X = `it-t3-ccancel-x-${RUN}`;
const USER_Y = `it-t3-ccancel-y-${RUN}`;
const STAFF_P = `it-t3-ccancel-p-${RUN}`;
const USERS = [OWNER_A, OWNER_B, USER_X, USER_Y, STAFF_P];

const ids = {
  salonA: "",
  salonB: "",
  empA: "",
  empB: "",
  svcA: "",
  svcB: "",
  clientA: "",
  /** X w A z wpłaconym zadatkiem i płatnością `succeeded` (przypadki 4, 8). */
  xaDeposit: "",
  /** X w A bez zadatku (przypadki 1, 6). */
  xa: "",
  /** X w B bez zadatku (przypadki 1, 2, 5). */
  xb: "",
  /** Y w A (przypadki 1, 2). */
  ya: "",
  /** X w A do wyścigu (przypadek 7). */
  xaRace: "",
  /** Wizyta dodana przez personel P w A, booked_by_user_id NULL (przypadek 9). */
  staffAdded: "",
  /** Płatność `succeeded` wizyty xaDeposit. */
  payment: "",
};

const HOUR = 60 * 60 * 1000;
const inHours = (hours: number) => new Date(Date.now() + hours * HOUR);

const BASE = "http://localhost/api/client/appointments";

function as(userId: string) {
  ctl.userId = userId;
}

const get = async (id: string) =>
  parseResponse<Record<string, unknown>>(await route.GET(new Request(`${BASE}/${id}/cancel`), createRouteParams(id)));
const post = async (id: string) =>
  parseResponse<Record<string, unknown>>(
    await route.POST(new Request(`${BASE}/${id}/cancel`, { method: "POST" }), createRouteParams(id))
  );

/** Stan wizyt testu: id → status (do porównań „bez zmian”). */
async function statuses(): Promise<Record<string, string>> {
  const all = [ids.xaDeposit, ids.xa, ids.xb, ids.ya, ids.xaRace, ids.staffAdded];
  const rows = await h!.db
    .select({ id: appointments.id, status: appointments.status })
    .from(appointments)
    .where(inArray(appointments.id, all));
  return Object.fromEntries(rows.map((r) => [r.id, r.status]));
}

async function paymentStatus(): Promise<string | undefined> {
  const [row] = await h!.db
    .select({ status: depositPayments.status })
    .from(depositPayments)
    .where(eq(depositPayments.id, ids.payment));
  return row?.status;
}

async function insertAppointment(values: {
  salonId: string;
  employeeId: string;
  serviceId: string;
  bookedByUserId: string | null;
  depositAmount?: string | null;
  depositPaid?: boolean;
  hours: number;
}): Promise<string> {
  const start = inHours(values.hours);
  const [row] = await h!.db
    .insert(appointments)
    .values({
      salonId: values.salonId,
      employeeId: values.employeeId,
      serviceId: values.serviceId,
      bookedByUserId: values.bookedByUserId,
      clientId: values.bookedByUserId === null ? ids.clientA : null,
      startTime: start,
      endTime: new Date(start.getTime() + HOUR),
      status: "scheduled",
      notes: "Notatka personelu",
      depositAmount: values.depositAmount ?? null,
      depositPaid: values.depositPaid ?? false,
    })
    .returning({ id: appointments.id });
  return row!.id;
}

/** Czeka, aż `count` UPDATE-ów wizyt czeka na blokadę (oba w locie). */
async function waitForBlockedUpdates(count: number, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const [row] = await h!.observer<{ n: number }[]>`
      select count(*)::int as n
      from pg_stat_activity
      where wait_event_type = 'Lock'
        and query ilike 'update "appointments"%'
    `;
    if ((row?.n ?? 0) >= count) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`bariera: mniej niż ${count} UPDATE w oczekiwaniu na blokadę po ${timeoutMs} ms`);
}

const GET_KEYS = [
  "appointmentId",
  "canCancel",
  "deposit",
  "employee",
  "endTime",
  "hoursUntilAppointment",
  "isMoreThan24h",
  "isPast",
  "salon",
  "service",
  "startTime",
  "status",
];
const POST_KEYS = ["cancellationDetails", "data", "message", "success"];
const POST_DATA_KEYS = ["endTime", "id", "startTime", "status"];
const DETAILS_KEYS = [
  "depositAmount",
  "depositForfeited",
  "depositPaid",
  "depositRefunded",
  "depositSettledBySalon",
  "hasDeposit",
  "hoursUntilAppointment",
  "isMoreThan24h",
  "refund",
];

const suite = h ? describe : describe.skip;

suite("#193: anulowanie wizyty w portalu klienta, salony A i B, prawdziwy Postgres", () => {
  beforeAll(async () => {
    const db = h!.db;
    await db.insert(user).values(
      USERS.map((id) => ({ id, name: `IT T3 ccancel ${id}`, email: `${id}@example.invalid`, emailVerified: true }))
    );
    const [a] = await db.insert(salons).values({ name: `IT T3 ccancel A ${RUN}`, ownerId: OWNER_A, phone: "+48600100200" }).returning({ id: salons.id });
    const [b] = await db.insert(salons).values({ name: `IT T3 ccancel B ${RUN}`, ownerId: OWNER_B }).returning({ id: salons.id });
    ids.salonA = a!.id;
    ids.salonB = b!.id;
    const [ea] = await db
      .insert(employees)
      .values({ salonId: ids.salonA, firstName: "Ola", lastName: "A", userId: STAFF_P })
      .returning({ id: employees.id });
    const [eb] = await db.insert(employees).values({ salonId: ids.salonB, firstName: "Ewa", lastName: "B" }).returning({ id: employees.id });
    ids.empA = ea!.id;
    ids.empB = eb!.id;
    const [sa] = await db
      .insert(services)
      .values({ salonId: ids.salonA, name: "IT Usługa A", basePrice: "100.00", baseDuration: 60 })
      .returning({ id: services.id });
    const [sb] = await db
      .insert(services)
      .values({ salonId: ids.salonB, name: "IT Usługa B", basePrice: "80.00", baseDuration: 60 })
      .returning({ id: services.id });
    ids.svcA = sa!.id;
    ids.svcB = sb!.id;
    const [ca] = await db
      .insert(clients)
      .values({ salonId: ids.salonA, firstName: "Kartoteka", lastName: "A", email: `kartoteka-${RUN}@example.invalid` })
      .returning({ id: clients.id });
    ids.clientA = ca!.id;

    const inA = { salonId: ids.salonA, employeeId: ids.empA, serviceId: ids.svcA };
    const inB = { salonId: ids.salonB, employeeId: ids.empB, serviceId: ids.svcB };
    ids.xaDeposit = await insertAppointment({ ...inA, bookedByUserId: USER_X, depositAmount: "50.00", depositPaid: true, hours: 72 });
    ids.xa = await insertAppointment({ ...inA, bookedByUserId: USER_X, hours: 74 });
    ids.xb = await insertAppointment({ ...inB, bookedByUserId: USER_X, hours: 76 });
    ids.ya = await insertAppointment({ ...inA, bookedByUserId: USER_Y, hours: 78 });
    ids.xaRace = await insertAppointment({ ...inA, bookedByUserId: USER_X, hours: 80 });
    ids.staffAdded = await insertAppointment({ ...inA, bookedByUserId: null, hours: 82 });

    const [p] = await db
      .insert(depositPayments)
      .values({
        appointmentId: ids.xaDeposit,
        salonId: ids.salonA,
        amount: "50.00",
        paymentMethod: "blik",
        status: "succeeded",
        paidAt: new Date(),
      })
      .returning({ id: depositPayments.id });
    ids.payment = p!.id;
  });

  afterAll(async () => {
    if (!h) return;
    try {
      for (const id of [ids.salonA, ids.salonB]) if (id) await h.db.delete(salons).where(eq(salons.id, id));
      await h.db.delete(user).where(inArray(user.id, USERS));
    } finally {
      await h.end();
    }
  });

  beforeEach(() => {
    ctl.findOverride = null;
    ctl.notify.calls = 0;
  });

  it("2/3: Y nie widzi i nie anuluje wizyt X w A ani w B — 404, stan bez zmian", async () => {
    as(USER_Y);
    const before = await statuses();
    for (const id of [ids.xaDeposit, ids.xa, ids.xb]) {
      expect((await get(id)).status).toBe(404);
      const res = await post(id);
      expect(res.status, JSON.stringify(res.body)).toBe(404);
      expect(res.body).toEqual({ success: false, error: "Appointment not found" });
    }
    expect(await statuses()).toEqual(before);
    expect(await paymentStatus()).toBe("succeeded");
    expect(ctl.notify.calls).toBe(0);
  });

  it("9: wizyta dodana przez personel P nie jest widoczna ani anulowalna w portalu konta P", async () => {
    as(STAFF_P);
    const before = await statuses();
    expect((await get(ids.staffAdded)).status).toBe(404);
    expect((await post(ids.staffAdded)).status).toBe(404);
    expect(await statuses()).toEqual(before);
    expect(ctl.notify.calls).toBe(0);
  });

  it("5: odczyt wskazuje salon A, wizyta jest w B — zapis pod forSalon(A) daje 0 wierszy, 404, bez skutków", async () => {
    as(USER_X);
    ctl.findOverride = async (): Promise<ClientAppointmentForCancel> => ({
      appointmentId: ids.xb,
      salonId: ids.salonA,
      serviceId: ids.svcB,
      employeeId: ids.empB,
      status: "scheduled",
      startTime: inHours(76),
      endTime: inHours(77),
      depositAmount: null,
      depositPaid: false,
      salonName: "Salon A",
      salonPhone: null,
      serviceName: "IT Usługa B",
      servicePrice: "80.00",
      employeeName: "Ewa B",
    });
    const before = await statuses();
    const res = await post(ids.xb);
    expect(res.status, JSON.stringify(res.body)).toBe(404);
    expect(await statuses()).toEqual(before);
    expect(ctl.notify.calls).toBe(0);
  });

  it("6: odczyt zwraca wizytę X, sesja to Y — ponowiony warunek tożsamości daje 0 wierszy, 404, bez skutków", async () => {
    as(USER_Y);
    ctl.findOverride = async (): Promise<ClientAppointmentForCancel> => ({
      appointmentId: ids.xaDeposit,
      salonId: ids.salonA,
      serviceId: ids.svcA,
      employeeId: ids.empA,
      status: "scheduled",
      startTime: inHours(72),
      endTime: inHours(73),
      depositAmount: "50.00",
      depositPaid: true,
      salonName: "Salon A",
      salonPhone: null,
      serviceName: "IT Usługa A",
      servicePrice: "100.00",
      employeeName: "Ola A",
    });
    const before = await statuses();
    const res = await post(ids.xaDeposit);
    expect(res.status, JSON.stringify(res.body)).toBe(404);
    expect(await statuses()).toEqual(before);
    expect(await paymentStatus()).toBe("succeeded");
    expect(ctl.notify.calls).toBe(0);
  });

  it("8 + 4 (GET): płatność succeeded odczytana pod rolą aplikacji → zwrot, nie „rozlicza salon”; dokładne klucze", async () => {
    as(USER_X);
    const res = await get(ids.xaDeposit);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const data = res.body.data as Record<string, Record<string, unknown>>;
    expect(Object.keys(res.body).sort()).toEqual(["data", "success"]);
    expect(Object.keys(data).sort()).toEqual(GET_KEYS);
    expect(Object.keys(data.deposit!).sort()).toEqual(["action", "amount", "paid", "settledBySalon"]);
    expect(Object.keys(data.employee!).sort()).toEqual(["name"]);
    expect(Object.keys(data.service!).sort()).toEqual(["name", "price"]);
    expect(Object.keys(data.salon!).sort()).toEqual(["name", "phone"]);
    expect(data.deposit).toEqual({ amount: 50, paid: true, action: "refund", settledBySalon: false });
  });

  it("1 + 8 + 4 (POST): X anuluje wizytę z zadatkiem w A — zwrot, dokładne klucze, płatność refunded", async () => {
    as(USER_X);
    const res = await post(ids.xaDeposit);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(POST_KEYS);
    expect(Object.keys(res.body.data as object).sort()).toEqual(POST_DATA_KEYS);
    const details = res.body.cancellationDetails as Record<string, unknown>;
    expect(Object.keys(details).sort()).toEqual(DETAILS_KEYS);
    expect(Object.keys(details.refund as object).sort()).toEqual(["amount", "message", "processed", "refundId"]);
    expect(details).toMatchObject({ depositRefunded: true, depositForfeited: false, depositSettledBySalon: false });
    expect((res.body.data as { status: string }).status).toBe("cancelled");
    expect(await paymentStatus()).toBe("refunded");
    expect(ctl.notify.calls).toBe(1);
  });

  it("1: X anuluje swoje wizyty w A i w B; wizyty Y i personelu bez zmian", async () => {
    as(USER_X);
    const before = await statuses();
    expect((await post(ids.xa)).status).toBe(200);
    expect((await post(ids.xb)).status).toBe(200);
    const after = await statuses();
    const changed = Object.keys(after)
      .filter((id) => after[id] !== before[id])
      .sort();
    expect(changed).toEqual([ids.xa, ids.xb].sort());
    expect(after[ids.ya]).toBe("scheduled");
    expect(after[ids.staffAdded]).toBe("scheduled");
  });

  it("anulowana wizyta: drugie POST → 400 „już anulowana”, bez skutków", async () => {
    as(USER_X);
    const res = await post(ids.xa);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ success: false, error: "Wizyta jest juz anulowana" });
    expect(ctl.notify.calls).toBe(0);
  });

  it("7: dwa równoległe anulowania na dwóch połączeniach — dokładnie jedno 200, jedno powiadomienie", async () => {
    as(USER_X);
    const raceId = ids.xaRace;
    let calls: Promise<Awaited<ReturnType<typeof post>>[]> | null = null;
    // Obserwator trzyma blokadę wiersza; oba żądania przechodzą odczyt i stają na UPDATE.
    await h!.observer.begin(async (tx) => {
      await tx.unsafe("select id from appointments where id = $1 for update", [raceId]);
      calls = Promise.all([post(raceId), post(raceId)]);
      await waitForBlockedUpdates(2);
    });
    const results = await calls!;
    const codes = results.map((r) => r.status).sort();
    expect(codes, JSON.stringify(results.map((r) => r.body))).toEqual([200, 404]);
    expect(ctl.notify.calls).toBe(1);
    expect((await statuses())[raceId]).toBe("cancelled");
  });
});
