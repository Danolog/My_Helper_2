/**
 * #193: autor wizyty (`booked_by_user_id`) na PRAWDZIWYM Postgresie.
 *
 * Portal klienta szuka wizyt po `booked_by_user_id`. Wizyta dodana przez
 * personel salonu w panelu należy do klienta z kartoteki, nie do konta
 * personelu — inaczej trafia do portalu klienta pracownika/właściciela.
 *
 * - POST /api/appointments jako właściciel salonu → booked_by_user_id IS NULL;
 * - POST /api/appointments jako zalogowany klient portalu (bez kontekstu
 *   salonu) → booked_by_user_id = id klienta;
 * - POST /api/appointments/book-package jako właściciel → każda wizyta pakietu
 *   z booked_by_user_id IS NULL.
 *
 * Mocki: sesja i kontekst salonu (sterowane per test), limiter, SMS, logger,
 * bramka zamrożenia modułu pakietów. Baza, RLS (forSalon), walidacja,
 * przynależność referencji do salonu i strażnik zadatku — prawdziwe.
 *
 * Dane: użytkownicy `it-t3-bkby-…` (prefiks z notatki sprzątania w
 * pg-harness.ts), salon, pracownik, klient z kartoteki, dwie usługi bez
 * zadatku, promocja-pakiet; wizyty kaskadą z salonu w `afterAll`. Terminy
 * w 2099 r., każdy test na własnym dniu.
 * Uruchomienie: `INTEGRATION_POSTGRES_URL=postgresql://…@localhost:5432/pos_dev pnpm test:pg`.
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { POST as bookPackage } from "@/app/api/appointments/book-package/route";
import { POST as createAppointment } from "@/app/api/appointments/route";
import { appointments, clients, employees, promotions, salons, services, user } from "@/lib/schema";
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
vi.mock("@/lib/auth-middleware", () => ({
  requireAuth: async () => ({
    user: { id: session.userId ?? "", name: "IT", email: `${session.userId}@example.invalid` },
  }),
  isAuthError: () => false,
}));
vi.mock("@/lib/salon-context", async (orig) => ({
  ...(await orig<typeof import("@/lib/salon-context")>()),
  getSalonContext: async () => session.staffCtx,
}));
vi.mock("@/lib/get-user-salon", () => ({ getUserSalonId: async () => session.staffCtx?.salonId ?? null }));
vi.mock("@/lib/server/frozen-guard", async (orig) => ({
  ...(await orig<typeof import("@/lib/server/frozen-guard")>()),
  frozenModuleResponse: () => null, // pakiety zamrożone w produkcie; tu testujemy samego autora wizyty
}));
vi.mock("@/lib/rate-limit", () => {
  const ok = { success: true, remaining: 99, reset: 60_000 };
  const limiter = { check: () => ok, checkAsync: async () => ok };
  return { strictRateLimit: limiter, apiRateLimit: limiter, getClientIp: () => "127.0.0.1" };
});
vi.mock("@/lib/sms", () => ({
  sendBookingConfirmationSms: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const RUN = randomUUID().slice(0, 8);
const OWNER_ID = `it-t3-bkby-${RUN}`;
const PORTAL_CLIENT_ID = `it-t3-bkby-cl-${RUN}`;
let salonId = "";
let employeeId = "";
let clientId = "";
let serviceId = "";
let service2Id = "";
let promotionId = "";

const asOwner = () => {
  session.userId = OWNER_ID;
  session.staffCtx = { salonId, role: "owner", employeeId: null, userId: OWNER_ID };
};
const asPortalClient = () => {
  session.userId = PORTAL_CLIENT_ID;
  session.staffCtx = null;
};

async function post(body: Record<string, unknown>) {
  const res = await createAppointment(
    new Request("http://localhost/api/appointments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ salonId, employeeId, serviceId, ...body }),
    })
  );
  return { status: res.status, body: (await res.json()) as { error?: string; data?: { id: string } } };
}

async function bookedByOf(id: string) {
  const [row] = await h!.db
    .select({ bookedByUserId: appointments.bookedByUserId })
    .from(appointments)
    .where(eq(appointments.id, id));
  return row?.bookedByUserId;
}

const suite = h ? describe : describe.skip;

suite("#193: booked_by_user_id wizyty, prawdziwy Postgres", () => {
  beforeAll(async () => {
    const db = h!.db;
    await db.insert(user).values([
      { id: OWNER_ID, name: "IT T3 bkby", email: `${OWNER_ID}@example.invalid` },
      { id: PORTAL_CLIENT_ID, name: "IT T3 bkby klient", email: `${PORTAL_CLIENT_ID}@example.invalid` },
    ]);
    const [salon] = await db.insert(salons).values({ name: `IT T3 bkby ${RUN}`, ownerId: OWNER_ID }).returning();
    salonId = salon!.id;
    const [emp] = await db.insert(employees).values({ salonId, firstName: "IT", lastName: "Pracownik" }).returning();
    employeeId = emp!.id;
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
        name: `IT pakiet bkby ${RUN}`,
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
      // Salon kaskadą zabiera wizyty (także te z booked_by_user_id klienta portalu), potem użytkownicy.
      if (salonId) await h.db.delete(salons).where(eq(salons.id, salonId));
      await h.db.delete(user).where(eq(user.id, PORTAL_CLIENT_ID));
      await h.db.delete(user).where(eq(user.id, OWNER_ID));
    } finally {
      await h.end();
    }
  });

  it("właściciel salonu tworzy wizytę POST-em → booked_by_user_id IS NULL", async () => {
    asOwner();
    const res = await post({ clientId, startTime: at(1, "10:00"), endTime: at(1, "11:00") });
    expect(res.status, res.body.error).toBe(201);
    expect(await bookedByOf(res.body.data!.id)).toBeNull();
  });

  it("właściciel salonu: bookedByUserId z body (konto klienta portalu) jest ignorowany → NULL", async () => {
    asOwner();
    const res = await post({
      clientId,
      startTime: at(2, "10:00"),
      endTime: at(2, "11:00"),
      bookedByUserId: PORTAL_CLIENT_ID,
    });
    expect(res.status, res.body.error).toBe(201);
    expect(await bookedByOf(res.body.data!.id)).toBeNull();
  });

  it("klient portalu tworzy wizytę POST-em → booked_by_user_id = jego id", async () => {
    asPortalClient();
    const res = await post({ startTime: at(3, "10:00"), endTime: at(3, "11:00") });
    expect(res.status, res.body.error).toBe(201);
    expect(await bookedByOf(res.body.data!.id)).toBe(PORTAL_CLIENT_ID);
  });

  it("właściciel rezerwuje pakiet → każda wizyta pakietu z booked_by_user_id IS NULL", async () => {
    asOwner();
    const res = await bookPackage(
      new Request("http://localhost/api/appointments/book-package", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          salonId,
          clientId,
          employeeId,
          serviceId,
          dates: [at(4, "10:00").slice(0, 10)],
          promotionId,
          startTime: at(4, "10:00"),
        }),
      })
    );
    const body = (await res.json()) as { error?: string; data?: { appointments: { id: string }[] } };
    expect(res.status, body.error).toBe(201);
    const ids = body.data!.appointments.map((a) => a.id);
    expect(ids).toHaveLength(2);
    for (const id of ids) expect(await bookedByOf(id)).toBeNull();
  });
});
