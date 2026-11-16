/**
 * Kolizja wizyt na PRAWDZIWYM Postgresie: przedział półotwarty `[start, end)`
 * (#165) i ograniczenia z migracji 0009 (#171).
 *
 * - POST /api/appointments (rezerwacja gościa): styk, nakładanie, anulowana;
 * - ograniczenia bazy wprost: EXCLUDE `appointments_no_overlap` (23P01) i CHECK
 *   `*_end_after_start` (23514) na appointments i time_blocks;
 * - wyścig: równoległe zapisy tego samego terminu — dokładnie jeden przechodzi,
 *   reszta 409 (nie 500) — przez POST, PUT i pakiet;
 * - PUT /api/appointments/[id] i POST /api/appointments/book-package.
 *
 * Mocki: sesja i kontekst salonu (atrapy, sterowane per opis), limiter, SMS,
 * logger i bramka zamrożenia modułu pakietów. Baza, RLS (forSalon), walidacja,
 * przynależność referencji do salonu i strażnik zadatku — prawdziwe.
 *
 * Dane: użytkownik `it-t3-ovl-…` (prefiks z notatki sprzątania w pg-harness.ts),
 * salon, dwóch pracowników, klient, dwie usługi bez zadatku, promocja-pakiet;
 * wizyty kaskadą z salonu w `afterAll`. Terminy w 2099 r., KAŻDY test na
 * własnym dniu i z własnymi danymi — kolejność testów bez znaczenia.
 * Wymaga bazy z migracją 0009.
 * Uruchomienie: `INTEGRATION_POSTGRES_URL=postgresql://…@localhost:5432/pos_dev pnpm test:pg`.
 */
import { randomUUID } from "node:crypto";
import { and, eq, gte, lt } from "drizzle-orm";
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { PUT as updateAppointment } from "@/app/api/appointments/[id]/route";
import { POST as bookPackage } from "@/app/api/appointments/book-package/route";
import { POST as createAppointment } from "@/app/api/appointments/route";
import { APPOINTMENT_NO_OVERLAP_CONSTRAINT, isAppointmentOverlapViolation } from "@/lib/appointment-overlap";
import { appointments, clients, employees, promotions, salons, services, timeBlocks, user } from "@/lib/schema";

const h = await vi.hoisted(async () => (await import("./pg-harness")).createIntegrationDb());

/** Kontekst sesji: `null` = gość (POST portalu), inaczej właściciel salonu. */
const session = vi.hoisted(() => ({
  ctx: null as null | { salonId: string; role: "owner"; employeeId: null; userId: string },
}));

vi.mock("@/lib/db", () => ({
  get db() {
    if (!h) throw new Error("INTEGRATION_POSTGRES_URL not set");
    return h.db;
  },
}));
vi.mock("@/lib/session", () => ({
  getOptionalSession: vi.fn(async () =>
    session.ctx ? { user: { id: session.ctx.userId, name: "IT", email: "it@example.invalid" } } : null
  ),
}));
vi.mock("@/lib/auth-middleware", () => ({
  requireAuth: async () => ({ user: { id: session.ctx?.userId ?? "", name: "IT", email: "it@example.invalid" } }),
  isAuthError: () => false,
}));
vi.mock("@/lib/salon-context", async (orig) => ({
  ...(await orig<typeof import("@/lib/salon-context")>()),
  getSalonContext: async () => session.ctx,
}));
vi.mock("@/lib/get-user-salon", () => ({ getUserSalonId: async () => session.ctx?.salonId ?? null }));
vi.mock("@/lib/server/frozen-guard", async (orig) => ({
  ...(await orig<typeof import("@/lib/server/frozen-guard")>()),
  frozenModuleResponse: () => null, // pakiety zamrożone w produkcie; tu testujemy samą kolizję
}));
vi.mock("@/lib/rate-limit", () => {
  const ok = { success: true, remaining: 99, reset: 60_000 };
  const limiter = { check: () => ok, checkAsync: async () => ok };
  return { strictRateLimit: limiter, apiRateLimit: limiter, getClientIp: () => "127.0.0.1" };
});
vi.mock("@/lib/sms", () => ({ sendBookingConfirmationSms: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const RUN = randomUUID().slice(0, 8);
const USER_ID = `it-t3-ovl-${RUN}`;
const MSG = "Termin koliduje z istniejaca wizyta. Wybierz inna godzine";
let salonId = "";
let employeeId = "";
let employee2Id = "";
let clientId = "";
let serviceId = "";
let service2Id = "";
let promotionId = "";

/** Godzina `hh:mm` w dniu `day` (UTC) marca 2099 r. — każdy test na osobnym dniu. */
const at = (day: number, hhmm: string) => `2099-03-${String(day).padStart(2, "0")}T${hhmm}:00.000Z`;

const owner = () => ({ salonId, role: "owner" as const, employeeId: null, userId: USER_ID });

async function post(start: string, end: string, emp = employeeId) {
  const res = await createAppointment(
    new Request("http://localhost/api/appointments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        salonId,
        employeeId: emp,
        serviceId,
        startTime: start,
        endTime: end,
        guestName: "IT Gość",
        guestPhone: "500600700",
      }),
    })
  );
  return { status: res.status, body: (await res.json()) as { success: boolean; error?: string } };
}

async function put(id: string, body: Record<string, unknown>) {
  const res = await updateAppointment(
    new Request(`http://localhost/api/appointments/${id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) }
  );
  return { status: res.status, body: (await res.json()) as { success: boolean; error?: string } };
}

async function book(start: string) {
  const res = await bookPackage(
    new Request("http://localhost/api/appointments/book-package", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        salonId,
        clientId,
        employeeId,
        serviceId,
        dates: [start.slice(0, 10)],
        promotionId,
        startTime: start,
      }),
    })
  );
  return { status: res.status, body: (await res.json()) as { success: boolean; error?: string } };
}

/** Wiersz wizyty wprost w bazie (z pominięciem tras). */
async function insertAppt(start: string, end: string, extra: Partial<typeof appointments.$inferInsert> = {}) {
  const [row] = await h!.db
    .insert(appointments)
    .values({
      salonId,
      employeeId,
      serviceId,
      startTime: new Date(start),
      endTime: new Date(end),
      status: "scheduled",
      guestName: "IT Gość",
      guestPhone: "+48500600700",
      ...extra,
    })
    .returning();
  return row!;
}

/** Aktywne (nieanulowane) wizyty pracownika w danym dniu, posortowane po starcie. */
async function activeOnDay(day: number, emp = employeeId) {
  const rows = await h!.db
    .select({ startTime: appointments.startTime, endTime: appointments.endTime, status: appointments.status })
    .from(appointments)
    .where(
      and(
        eq(appointments.salonId, salonId),
        eq(appointments.employeeId, emp),
        gte(appointments.startTime, new Date(at(day, "00:00"))),
        lt(appointments.startTime, new Date(at(day + 1, "00:00")))
      )
    );
  return rows
    .filter((r) => r.status !== "cancelled")
    .map((r) => `${r.startTime.toISOString()}–${r.endTime.toISOString()}`)
    .sort();
}

/** Błąd z bazy po odwinięciu opakowania Drizzle. */
async function dbError(p: Promise<unknown>): Promise<{ code?: string; constraint_name?: string }> {
  try {
    await p;
  } catch (e) {
    let cur = e as { code?: string; cause?: unknown };
    while (!cur.code && cur.cause) cur = cur.cause as typeof cur;
    return cur as { code?: string; constraint_name?: string };
  }
  throw new Error("oczekiwano odrzucenia przez bazę");
}

const statuses = (rs: { status: number }[]) => rs.map((r) => r.status).sort();

const suite = h ? describe : describe.skip;

suite("kolizja wizyt (#165, #171), prawdziwy Postgres", () => {
  beforeAll(async () => {
    const db = h!.db;
    await db.insert(user).values({ id: USER_ID, name: "IT T3 ovl", email: `${USER_ID}@example.invalid` });
    const [salon] = await db.insert(salons).values({ name: `IT T3 ovl ${RUN}`, ownerId: USER_ID }).returning();
    salonId = salon!.id;
    const [emp, emp2] = await db
      .insert(employees)
      .values([
        { salonId, firstName: "IT", lastName: "Pracownik" },
        { salonId, firstName: "IT", lastName: "Pracownik 2" },
      ])
      .returning();
    employeeId = emp!.id;
    employee2Id = emp2!.id;
    const [client] = await db.insert(clients).values({ salonId, firstName: "IT", lastName: "Klient" }).returning();
    clientId = client!.id;
    const [svc, svc2] = await db
      .insert(services)
      .values([
        { salonId, name: "IT Usługa 30", basePrice: "100.00", baseDuration: 30, depositRequired: false },
        { salonId, name: "IT Usługa 45", basePrice: "80.00", baseDuration: 45, depositRequired: false },
      ])
      .returning();
    serviceId = svc!.id;
    service2Id = svc2!.id;
    const [promo] = await db
      .insert(promotions)
      .values({
        salonId,
        name: `IT pakiet ${RUN}`,
        type: "package",
        value: "150.00",
        conditionsJson: { packageServiceIds: [serviceId, service2Id] },
        isActive: true,
      })
      .returning();
    promotionId = promo!.id;
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

  describe("POST /api/appointments (gość)", () => {
    beforeEach(() => {
      session.ctx = null;
    });

    it("10–11, potem 11–12 → 201 (styk nie koliduje)", async () => {
      expect((await post(at(1, "10:00"), at(1, "11:00"))).status).toBe(201);
      const second = await post(at(1, "11:00"), at(1, "12:00"));
      expect(second.status, second.body.error).toBe(201);
    });

    it("10:30–11:30 przy 10–11 → 409 z dotychczasowym komunikatem", async () => {
      expect((await post(at(2, "10:00"), at(2, "11:00"))).status).toBe(201);
      const res = await post(at(2, "10:30"), at(2, "11:30"));
      expect(res.status).toBe(409);
      expect(res.body.error).toBe(MSG);
    });

    it("anulowana 11–12, potem 11–12 → 201", async () => {
      await insertAppt(at(3, "11:00"), at(3, "12:00"), { status: "cancelled" });
      const res = await post(at(3, "11:00"), at(3, "12:00"));
      expect(res.status, res.body.error).toBe(201);
    });

    it("w bazie po stykających się rezerwacjach: dokładnie dwie aktywne wizyty, nic nie zdublowane", async () => {
      expect((await post(at(4, "10:00"), at(4, "11:00"))).status).toBe(201);
      expect((await post(at(4, "11:00"), at(4, "12:00"))).status).toBe(201);
      expect((await post(at(4, "10:00"), at(4, "11:00"))).status).toBe(409);
      expect(await activeOnDay(4)).toEqual([
        `${at(4, "10:00")}–${at(4, "11:00")}`,
        `${at(4, "11:00")}–${at(4, "12:00")}`,
      ]);
    });

    it("wyścig: 6 równoległych rezerwacji tego samego terminu → jedna 201, pięć 409, żadnej 500", async () => {
      const results = await Promise.all(Array.from({ length: 6 }, () => post(at(5, "10:00"), at(5, "11:00"))));
      expect(statuses(results)).toEqual([201, 409, 409, 409, 409, 409]);
      for (const r of results.filter((x) => x.status === 409)) expect(r.body.error).toBe(MSG);
      expect(await activeOnDay(5)).toEqual([`${at(5, "10:00")}–${at(5, "11:00")}`]);
    });
  });

  describe("ograniczenia bazy wprost (migracja 0009)", () => {
    it("EXCLUDE: nakładająca się aktywna wizyta tego pracownika → 23P01 appointments_no_overlap", async () => {
      await insertAppt(at(10, "10:00"), at(10, "11:00"));
      const err = await dbError(insertAppt(at(10, "10:59"), at(10, "12:00")));
      expect(err.code).toBe("23P01");
      expect(err.constraint_name).toBe(APPOINTMENT_NO_OVERLAP_CONSTRAINT);
    });

    it("EXCLUDE: isAppointmentOverlapViolation rozpoznaje błąd w kształcie z Drizzle", async () => {
      await insertAppt(at(11, "10:00"), at(11, "11:00"));
      let caught: unknown;
      try {
        await insertAppt(at(11, "10:30"), at(11, "11:30"));
      } catch (e) {
        caught = e;
      }
      expect(isAppointmentOverlapViolation(caught)).toBe(true);
    });

    it("EXCLUDE przepuszcza: styk, anulowaną i innego pracownika", async () => {
      await insertAppt(at(12, "10:00"), at(12, "11:00"));
      await insertAppt(at(12, "11:00"), at(12, "12:00")); // styk
      await insertAppt(at(12, "09:00"), at(12, "10:00")); // styk z drugiej strony
      await insertAppt(at(12, "10:15"), at(12, "10:45"), { status: "cancelled" });
      await insertAppt(at(12, "10:00"), at(12, "11:00"), { employeeId: employee2Id });
      expect(await activeOnDay(12)).toHaveLength(3);
    });

    it("EXCLUDE: przywrócenie anulowanej wizyty na zajęty termin → 23P01", async () => {
      await insertAppt(at(13, "10:00"), at(13, "11:00"));
      const cancelled = await insertAppt(at(13, "10:30"), at(13, "11:30"), { status: "cancelled" });
      const err = await dbError(
        h!.db.update(appointments).set({ status: "scheduled" }).where(eq(appointments.id, cancelled.id))
      );
      expect(err.code).toBe("23P01");
    });

    it.each([
      ["koniec = początek", "10:00", "10:00"],
      ["koniec przed początkiem", "11:00", "10:00"],
    ])("CHECK appointments: %s → 23514 appointments_end_after_start", async (_n, s, e) => {
      const err = await dbError(insertAppt(at(14, s), at(14, e)));
      expect(err.code).toBe("23514");
      expect(err.constraint_name).toBe("appointments_end_after_start");
    });

    it("CHECK time_blocks: koniec ≤ początek → 23514 time_blocks_end_after_start", async () => {
      const err = await dbError(
        h!.db.insert(timeBlocks).values({
          employeeId,
          startTime: new Date(at(15, "10:00")),
          endTime: new Date(at(15, "10:00")),
          blockType: "break",
        })
      );
      expect(err.code).toBe("23514");
      expect(err.constraint_name).toBe("time_blocks_end_after_start");
    });
  });

  describe("PUT /api/appointments/[id] (właściciel, RLS)", () => {
    beforeEach(() => {
      session.ctx = owner();
    });

    it("przeniesienie na zajęty termin → 409; na styk → 200", async () => {
      await insertAppt(at(20, "10:00"), at(20, "11:00"));
      const moved = await insertAppt(at(20, "14:00"), at(20, "15:00"));

      const clash = await put(moved.id, { startTime: at(20, "10:30"), endTime: at(20, "11:30") });
      expect(clash.status).toBe(409);
      expect(clash.body.error).toBe(MSG);

      const touch = await put(moved.id, { startTime: at(20, "11:00"), endTime: at(20, "12:00") });
      expect(touch.status, touch.body.error).toBe(200);
      expect(await activeOnDay(20)).toEqual([
        `${at(20, "10:00")}–${at(20, "11:00")}`,
        `${at(20, "11:00")}–${at(20, "12:00")}`,
      ]);
    });

    it("przeniesienie na innego pracownika, zajętego w tym terminie → 409", async () => {
      await insertAppt(at(21, "10:00"), at(21, "11:00"), { employeeId: employee2Id });
      const moved = await insertAppt(at(21, "10:00"), at(21, "11:00"));
      const res = await put(moved.id, { employeeId: employee2Id });
      expect(res.status).toBe(409);
      expect(res.body.error).toBe(MSG);
    });

    it("wyścig: dwie wizyty przenoszone równolegle na ten sam wolny termin → jedna 200, druga 409", async () => {
      const a = await insertAppt(at(22, "08:00"), at(22, "09:00"));
      const b = await insertAppt(at(22, "14:00"), at(22, "15:00"));
      const target = { startTime: at(22, "11:00"), endTime: at(22, "12:00") };
      const results = await Promise.all([put(a.id, target), put(b.id, target)]);
      expect(statuses(results)).toEqual([200, 409]);
      expect(results.find((r) => r.status === 409)!.body.error).toBe(MSG);
      const day = await activeOnDay(22);
      expect(day.filter((r) => r.startsWith(at(22, "11:00")))).toHaveLength(1);
    });
  });

  describe("POST /api/appointments/book-package (właściciel, RLS)", () => {
    // Pakiet: 30 + 45 min od startu, czyli jeden przedział [start, start + 75 min).
    beforeEach(() => {
      session.ctx = owner();
    });

    it("pakiet na styk z istniejącą wizytą → 201, obie wizyty pakietu zapisane", async () => {
      await insertAppt(at(30, "11:15"), at(30, "12:00"));
      const res = await book(at(30, "10:00"));
      expect(res.status, res.body.error).toBe(201);
      expect(await activeOnDay(30)).toEqual([
        `${at(30, "10:00")}–${at(30, "10:30")}`,
        `${at(30, "10:30")}–${at(30, "11:15")}`,
        `${at(30, "11:15")}–${at(30, "12:00")}`,
      ]);
    });

    it("pakiet nachodzący na wizytę → 409, żadna wizyta pakietu nie zapisana", async () => {
      await insertAppt(at(31, "11:00"), at(31, "12:00"));
      const res = await book(at(31, "10:00"));
      expect(res.status).toBe(409);
      expect(res.body.error).toBe(MSG);
      expect(await activeOnDay(31)).toEqual([`${at(31, "11:00")}–${at(31, "12:00")}`]);
    });

    it("wyścig: dwa pakiety równolegle na ten sam termin → jeden 201, drugi 409, bez połowicznego pakietu", async () => {
      const results = await Promise.all([book(at(32, "10:00")), book(at(32, "10:00"))]);
      expect(statuses(results)).toEqual([201, 409]);
      expect(await activeOnDay(32)).toEqual([
        `${at(32, "10:00")}–${at(32, "10:30")}`,
        `${at(32, "10:30")}–${at(32, "11:15")}`,
      ]);
    });
  });
});
