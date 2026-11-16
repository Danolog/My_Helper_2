/**
 * #165: kolizja wizyt jako przedział półotwarty `[start, end)` na PRAWDZIWYM
 * Postgresie, przez prawdziwą trasę POST /api/appointments (rezerwacja gościa).
 *
 * - 10–11, potem 11–12 → 201 (styk nie koliduje; przed #165: 409);
 * - 10:30–11:30 → 409 (nakładanie);
 * - anulowana 11–12, potem 11–12 → 201 (anulowana nie blokuje).
 *
 * Mocki: tylko sesja (gość), limiter, SMS i logger. Baza, walidacja,
 * przynależność referencji do salonu i strażnik zadatku — prawdziwe.
 *
 * Dane: użytkownik `it-t3-ovl-…` (prefiks z notatki sprzątania w pg-harness.ts),
 * salon, pracownik, usługa bez zadatku; wizyty kaskadą z salonu w `afterAll`.
 * Terminy w 2099 r. — bez styku z danymi deweloperskimi.
 * Uruchomienie: `INTEGRATION_POSTGRES_URL=postgresql://…@localhost:5432/pos_dev pnpm test:pg`.
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { POST as createAppointment } from "@/app/api/appointments/route";
import { appointments, employees, salons, services, user } from "@/lib/schema";

const h = await vi.hoisted(async () => (await import("./pg-harness")).createIntegrationDb());

vi.mock("@/lib/db", () => ({
  get db() {
    if (!h) throw new Error("INTEGRATION_POSTGRES_URL not set");
    return h.db;
  },
}));
vi.mock("@/lib/session", () => ({ getOptionalSession: vi.fn().mockResolvedValue(null) }));
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
let salonId = "";
let employeeId = "";
let serviceId = "";

/** Godzina `hh:mm` w dniu `day` (UTC) 2099 r. — każdy test na osobnym dniu. */
const at = (day: number, hhmm: string) => `2099-03-${String(day).padStart(2, "0")}T${hhmm}:00.000Z`;

async function post(start: string, end: string) {
  const res = await createAppointment(
    new Request("http://localhost/api/appointments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        salonId,
        employeeId,
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

const suite = h ? describe : describe.skip;

suite("POST /api/appointments — kolizja półotwarta (#165), prawdziwy Postgres", () => {
  beforeAll(async () => {
    const db = h!.db;
    await db.insert(user).values({ id: USER_ID, name: "IT T3 ovl", email: `${USER_ID}@example.invalid` });
    const [salon] = await db.insert(salons).values({ name: `IT T3 ovl ${RUN}`, ownerId: USER_ID }).returning();
    salonId = salon!.id;
    const [emp] = await db.insert(employees).values({ salonId, firstName: "IT", lastName: "Pracownik" }).returning();
    employeeId = emp!.id;
    const [svc] = await db
      .insert(services)
      .values({ salonId, name: "IT Usługa", basePrice: "100.00", baseDuration: 60, depositRequired: false })
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

  it("10–11, potem 11–12 → 201 (styk nie koliduje)", async () => {
    expect((await post(at(1, "10:00"), at(1, "11:00"))).status).toBe(201);
    const second = await post(at(1, "11:00"), at(1, "12:00"));
    expect(second.status, second.body.error).toBe(201);
  });

  it("10:30–11:30 przy 10–11 → 409 z dotychczasowym komunikatem", async () => {
    expect((await post(at(2, "10:00"), at(2, "11:00"))).status).toBe(201);
    const res = await post(at(2, "10:30"), at(2, "11:30"));
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("Termin koliduje z istniejaca wizyta. Wybierz inna godzine");
  });

  it("anulowana 11–12, potem 11–12 → 201", async () => {
    await h!.db.insert(appointments).values({
      salonId,
      employeeId,
      serviceId,
      startTime: new Date(at(3, "11:00")),
      endTime: new Date(at(3, "12:00")),
      status: "cancelled",
      guestName: "IT Gość",
      guestPhone: "+48500600700",
    });
    const res = await post(at(3, "11:00"), at(3, "12:00"));
    expect(res.status, res.body.error).toBe(201);
  });

  it("w bazie: dokładnie dwie aktywne wizyty dnia 1 (styk zapisany, nic nie zdublowane)", async () => {
    const rows = await h!.db
      .select({ startTime: appointments.startTime, status: appointments.status })
      .from(appointments)
      .where(eq(appointments.salonId, salonId));
    const day1 = rows.filter((r) => r.startTime.toISOString().startsWith("2099-03-01"));
    expect(day1.map((r) => r.startTime.toISOString()).sort()).toEqual([at(1, "10:00"), at(1, "11:00")]);
  });
});
