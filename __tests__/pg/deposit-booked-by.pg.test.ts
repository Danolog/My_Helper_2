/**
 * #193: autor wizyty z zadatkiem BLIK (`booked_by_user_id`) na PRAWDZIWYM Postgresie.
 *
 * Portal klienta szuka wizyt po `booked_by_user_id`. Wizyta z zadatkiem dodana
 * przez personel salonu należy do klienta z kartoteki, nie do konta personelu —
 * inaczej trafia do portalu klienta pracownika/właściciela.
 *
 * - POST /api/deposits/blik-booking jako właściciel salonu → booked_by_user_id IS NULL;
 * - POST /api/deposits/blik-booking jako zalogowany klient portalu (bez
 *   kontekstu salonu) → booked_by_user_id = id klienta.
 *
 * Mocki: sesja i kontekst salonu (sterowane per test), limiter IP, wysyłka SMS
 * (stałe błędów SMS prawdziwe), logger. Baza, RLS (forSalon), walidacja,
 * przynależność referencji do salonu, wyliczenie zadatku i liczniki limitów —
 * prawdziwe.
 *
 * Dane: użytkownicy `it-t3-dpbk-…` (prefiks z notatki sprzątania w
 * pg-harness.ts), salon z numerem BLIK i datą zgody, pracownik, klient
 * z kartoteki, usługa 60 min z zadatkiem 30%; wizyty kaskadą z salonu
 * w `afterAll`. Terminy w 2099 r., każdy test na własnym dniu.
 * Uruchomienie: `INTEGRATION_POSTGRES_URL=postgresql://…@localhost:5432/pos_dev pnpm test:pg`.
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { POST as blikBooking } from "@/app/api/deposits/blik-booking/route";
import { appointments, clients, employees, salons, services, user } from "@/lib/schema";
import { at } from "./pg-dates";

const h = await vi.hoisted(async () => (await import("./pg-harness")).createIntegrationDb());

/**
 * `userId` — zalogowany użytkownik (null = gość); `staffCtx` — kontekst
 * personelu salonu (null = brak, np. klient portalu).
 */
const session = vi.hoisted(() => ({
  userId: null as string | null,
  staffCtx: null as null | { salonId: string; role: "owner"; employeeId: null; userId: string },
}));

vi.mock("@/lib/db", () => ({
  get db() {
    if (!h) throw new Error("INTEGRATION_POSTGRES_URL not set");
    return h.db;
  },
}));
vi.mock("@/lib/session", () => ({
  getOptionalSession: vi.fn(async () =>
    session.userId ? { user: { id: session.userId, name: "IT", email: `${session.userId}@example.invalid` } } : null
  ),
}));
vi.mock("@/lib/salon-context", async (orig) => ({
  ...(await orig<typeof import("@/lib/salon-context")>()),
  getSalonContext: async () => session.staffCtx,
}));
vi.mock("@/lib/rate-limit", () => {
  const ok = { success: true, remaining: 99, reset: 60_000 };
  const limiter = { check: () => ok, checkAsync: async () => ok };
  return { strictRateLimit: limiter, apiRateLimit: limiter, getClientIp: () => "127.0.0.1" };
});
vi.mock("@/lib/sms", async (orig) => ({
  ...(await orig<typeof import("@/lib/sms")>()),
  sendBlikDepositBookingSms: vi.fn(async () => ({ success: true })),
}));
vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const RUN = randomUUID().slice(0, 8);
const OWNER_ID = `it-t3-dpbk-${RUN}`;
const PORTAL_CLIENT_ID = `it-t3-dpbk-cl-${RUN}`;
// Wyłącznie numery testowe (src/lib/test-phone.ts).
const BLIK_PHONE = "+48000600703";
/** basePrice 100 PLN × depositPercentage 30% (happy hours zamrożone). */
const DEPOSIT = 30;
let salonId = "";
let employeeId = "";
let clientId = "";
let serviceId = "";

const asOwner = () => {
  session.userId = OWNER_ID;
  session.staffCtx = { salonId, role: "owner", employeeId: null, userId: OWNER_ID };
};
const asPortalClient = () => {
  session.userId = PORTAL_CLIENT_ID;
  session.staffCtx = null;
};

async function post(body: Record<string, unknown>) {
  const res = await blikBooking(
    new Request("http://localhost/api/deposits/blik-booking", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ salonId, employeeId, serviceId, depositAmount: DEPOSIT, ...body }),
    })
  );
  return {
    status: res.status,
    body: (await res.json()) as { error?: string; data?: { appointmentId: string } },
  };
}

async function bookedByOf(id: string) {
  const [row] = await h!.db
    .select({ bookedByUserId: appointments.bookedByUserId })
    .from(appointments)
    .where(eq(appointments.id, id));
  return row?.bookedByUserId;
}

const suite = h ? describe : describe.skip;

suite("#193: booked_by_user_id wizyty z zadatkiem BLIK, prawdziwy Postgres", () => {
  beforeAll(async () => {
    const db = h!.db;
    await db.insert(user).values([
      { id: OWNER_ID, name: "IT T3 dpbk", email: `${OWNER_ID}@example.invalid` },
      { id: PORTAL_CLIENT_ID, name: "IT T3 dpbk klient", email: `${PORTAL_CLIENT_ID}@example.invalid` },
    ]);
    const [salon] = await db
      .insert(salons)
      .values({
        name: `IT T3 dpbk ${RUN}`,
        ownerId: OWNER_ID,
        settingsJson: { deposits: { blikPhone: BLIK_PHONE, blikConsentAt: "2026-11-21T00:00:00.000Z" } },
      })
      .returning();
    salonId = salon!.id;
    const [emp] = await db.insert(employees).values({ salonId, firstName: "IT", lastName: "Pracownik" }).returning();
    employeeId = emp!.id;
    const [client] = await db.insert(clients).values({ salonId, firstName: "IT", lastName: "Klient" }).returning();
    clientId = client!.id;
    const [svc] = await db
      .insert(services)
      .values({
        salonId,
        name: "IT Usługa z zadatkiem",
        basePrice: "100.00",
        baseDuration: 60,
        depositRequired: true,
        depositPercentage: 30,
      })
      .returning();
    serviceId = svc!.id;
  });

  afterAll(async () => {
    if (!h) return;
    try {
      // Salon kaskadą zabiera wizyty (także te z booked_by_user_id klienta portalu), potem użytkownicy.
      if (salonId) await h.db.delete(salons).where(eq(salons.id, salonId));
      await h.db.delete(user).where(eq(user.id, PORTAL_CLIENT_ID));
      await h.db.delete(user).where(eq(user.id, OWNER_ID));
    } finally {
      await h.end();
    }
  });

  it("właściciel salonu tworzy rezerwację z zadatkiem BLIK → booked_by_user_id IS NULL", async () => {
    asOwner();
    const res = await post({ clientId, startTime: at(11, "10:00"), endTime: at(11, "11:00") });
    expect(res.status, res.body.error).toBe(201);
    expect(await bookedByOf(res.body.data!.appointmentId)).toBeNull();
  });

  it("klient portalu tworzy rezerwację z zadatkiem BLIK → booked_by_user_id = jego id", async () => {
    asPortalClient();
    const res = await post({ startTime: at(12, "10:00"), endTime: at(12, "11:00") });
    expect(res.status, res.body.error).toBe(201);
    expect(await bookedByOf(res.body.data!.appointmentId)).toBe(PORTAL_CLIENT_ID);
  });
});
