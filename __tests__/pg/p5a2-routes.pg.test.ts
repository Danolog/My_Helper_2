/**
 * #193 P5a-2 na PRAWDZIWYM Postgresie: trasy z sekretem crona po przeniesieniu
 * z puli żądań (decyzja CTO D1, warunek 5) — salony A i B.
 *
 * Trasy jednego salonu przez `forSalon(salonId)` (rola bez BYPASSRLS +
 * `app.current_salon_id`): wywołane dla salonu A nie czytają danych salonu B
 * (odpowiedź bez id z B) i nie zapisują nic w B (brak notyfikacji w B):
 * - `notifications/birthday` GET/POST,
 * - `notifications/we-miss-you` GET/POST,
 * - `notifications/low-stock` GET/POST (duplikat z salonu B nie blokuje A;
 *   duplikat z A blokuje).
 *
 * Podgląd `reminders/appointment` GET `?salonId=A` przez `forSalon`: tylko wizyty A.
 *
 * Trasy przez wyjścia `system/` (pula systemowa):
 * - `reminders/appointment` POST `?salonId=A`: wysyłka i `reminder_sent_at`
 *   tylko dla wizyt A; bez `salonId` — oba salony; wizyta A z klientem
 *   salonu B pominięta bez SMS i bez danych klienta B, z linią logu (liczba);
 * - `cron/sms-reminders`: flaga `reminder_1h_sent_at` na wizytach obu salonów.
 *
 * Wysyłka (SMS, plan, AI) zmockowana. Trasy bez `salonId` i crony działają na
 * wszystkich salonach bazy i zatwierdzają zmiany (flagi przypomnień cudzych
 * wizyt w oknie): asercje tylko o wierszach utworzonych przez test.
 * Uruchamiać na bazie, w której to jest dopuszczalne.
 *
 * Dane: użytkownicy `it-t3-p5a2-…` (prefiks z notatki sprzątania w pg-harness.ts),
 * dwa salony; reszta kaskadą z salonów w `afterAll`.
 * Uruchomienie: `INTEGRATION_POSTGRES_URL=postgresql://…@localhost:5432/<baza> pnpm test:pg -- __tests__/pg/p5a2-routes.pg.test.ts`.
 * Wymaga bazy po `pnpm db:migrate` (RLS i rola `myhelper_app`).
 */
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as birthday from "@/app/api/notifications/birthday/route";
import * as lowStock from "@/app/api/notifications/low-stock/route";
import * as weMissYou from "@/app/api/notifications/we-miss-you/route";
import * as smsCron from "@/app/api/cron/sms-reminders/route";
import * as reminders from "@/app/api/reminders/appointment/route";
import { logger } from "@/lib/logger";
import { appointments, clients, employees, notifications, products, salons, services, user } from "@/lib/schema";
import { createMockRequest, parseResponse } from "../api/helpers";

const h = await vi.hoisted(async () => (await import("./pg-harness")).createIntegrationDb());
const ctl = vi.hoisted(() => ({ sendSms: vi.fn(), sendReminderSms: vi.fn() }));

vi.mock("@/lib/db", () => ({
  get db() {
    if (!h) throw new Error("INTEGRATION_POSTGRES_URL not set");
    return h.db;
  },
}));
vi.mock("@/lib/sms", async (orig) => ({
  SMS_TIME_ZONE: (await orig<typeof import("@/lib/sms")>()).SMS_TIME_ZONE,
  sendSms: (...a: unknown[]) => ctl.sendSms(...a),
  sendAppointmentReminderSms: (...a: unknown[]) => ctl.sendReminderSms(...a),
}));
vi.mock("@/lib/subscription", async (orig) => ({
  ...(await orig<typeof import("@/lib/subscription")>()),
  isProPlan: async () => false,
}));
vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const SECRET = "it-p5a2-cron-secret";
const RUN = randomUUID().slice(0, 8);
const OWNER_A = `it-t3-p5a2-a-${RUN}`;
const OWNER_B = `it-t3-p5a2-b-${RUN}`;
const PHONE = "+48512345678";
const DAY_MS = 86_400_000;

const ids = {
  salonA: "",
  salonB: "",
  empA: "",
  empB: "",
  svcA: "",
  svcB: "",
  /** Nieaktywni od 60 dni, urodziny dziś. */
  inactiveA: "",
  inactiveB: "",
  /** Klienci z wizytami w najbliższych godzinach. */
  apptClientA: "",
  apptClientB: "",
  productA: "",
  productB: "",
  /** Wizyty za 3 h (przypomnienie 24h) i za 60 min (cron SMS 1h). */
  remindA: "",
  remindB: "",
  soonA: "",
  soonB: "",
  /** Wizyta salonu A za 3 h z klientem salonu B (niezgodny klient w złączeniu). */
  mismatchA: "",
};

const post = (path: string, body: unknown) =>
  createMockRequest(`http://localhost${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${SECRET}` },
    body,
  });
const postNoBody = (path: string) =>
  createMockRequest(`http://localhost${path}`, { method: "POST", headers: { authorization: `Bearer ${SECRET}` } });
const get = (path: string) =>
  createMockRequest(`http://localhost${path}`, { method: "GET", headers: { authorization: `Bearer ${SECRET}` } });

async function notificationsOf(salonId: string) {
  return h!.db.select().from(notifications).where(eq(notifications.salonId, salonId));
}

async function appointmentFlags(idList: string[]) {
  const rows = await h!.db
    .select({ id: appointments.id, reminderSentAt: appointments.reminderSentAt, reminder1hSentAt: appointments.reminder1hSentAt })
    .from(appointments)
    .where(inArray(appointments.id, idList));
  return Object.fromEntries(rows.map((r) => [r.id, r]));
}

async function appointment(salonId: string, employeeId: string, serviceId: string, clientId: string, inMinutes: number) {
  const start = new Date(Date.now() + inMinutes * 60_000);
  const [row] = await h!.db
    .insert(appointments)
    .values({ salonId, employeeId, serviceId, clientId, startTime: start, endTime: new Date(start.getTime() + 1_800_000) })
    .returning({ id: appointments.id });
  return row!.id;
}

const suite = h ? describe : describe.skip;

suite("P5a-2: trasy z sekretem crona — salony A i B, prawdziwy Postgres", () => {
  beforeAll(async () => {
    const db = h!.db;
    await db.insert(user).values([
      { id: OWNER_A, name: "IT T3 p5a2 A", email: `${OWNER_A}@example.invalid` },
      { id: OWNER_B, name: "IT T3 p5a2 B", email: `${OWNER_B}@example.invalid` },
    ]);
    const [a] = await db.insert(salons).values({ name: `IT T3 p5a2 A ${RUN}`, ownerId: OWNER_A }).returning();
    const [b] = await db.insert(salons).values({ name: `IT T3 p5a2 B ${RUN}`, ownerId: OWNER_B }).returning();
    ids.salonA = a!.id;
    ids.salonB = b!.id;
    const [ea] = await db.insert(employees).values({ salonId: ids.salonA, firstName: "IT", lastName: "A" }).returning();
    const [eb] = await db.insert(employees).values({ salonId: ids.salonB, firstName: "IT", lastName: "B" }).returning();
    ids.empA = ea!.id;
    ids.empB = eb!.id;
    const [sa] = await db
      .insert(services)
      .values({ salonId: ids.salonA, name: "IT Usługa A", basePrice: "100.00", baseDuration: 30 })
      .returning();
    const [sb] = await db
      .insert(services)
      .values({ salonId: ids.salonB, name: "IT Usługa B", basePrice: "100.00", baseDuration: 30 })
      .returning();
    ids.svcA = sa!.id;
    ids.svcB = sb!.id;

    // Urodziny „dziś” liczone jak w trasie (strefa procesu).
    const now = new Date();
    const bday = `1990-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const old = new Date(Date.now() - 60 * DAY_MS);
    const [ia] = await db
      .insert(clients)
      .values({ salonId: ids.salonA, firstName: "Ala", lastName: "A", phone: PHONE, birthday: bday, createdAt: old })
      .returning();
    const [ib] = await db
      .insert(clients)
      .values({ salonId: ids.salonB, firstName: "Ola", lastName: "B", phone: PHONE, birthday: bday, createdAt: old })
      .returning();
    ids.inactiveA = ia!.id;
    ids.inactiveB = ib!.id;
    const [ca] = await db.insert(clients).values({ salonId: ids.salonA, firstName: "Jan", lastName: "A", phone: PHONE }).returning();
    const [cb] = await db.insert(clients).values({ salonId: ids.salonB, firstName: "Ewa", lastName: "B", phone: PHONE }).returning();
    ids.apptClientA = ca!.id;
    ids.apptClientB = cb!.id;

    const [pa] = await db
      .insert(products)
      .values({ salonId: ids.salonA, name: "IT produkt A", quantity: "1", minQuantity: "5" })
      .returning();
    const [pb] = await db
      .insert(products)
      .values({ salonId: ids.salonB, name: "IT produkt B", quantity: "1", minQuantity: "5" })
      .returning();
    ids.productA = pa!.id;
    ids.productB = pb!.id;

    ids.remindA = await appointment(ids.salonA, ids.empA, ids.svcA, ids.apptClientA, 180);
    ids.remindB = await appointment(ids.salonB, ids.empB, ids.svcB, ids.apptClientB, 180);
    ids.soonA = await appointment(ids.salonA, ids.empA, ids.svcA, ids.apptClientA, 60);
    ids.soonB = await appointment(ids.salonB, ids.empB, ids.svcB, ids.apptClientB, 60);
    ids.mismatchA = await appointment(ids.salonA, ids.empA, ids.svcA, ids.apptClientB, 180);
  });

  afterAll(async () => {
    if (!h) return;
    try {
      for (const id of [ids.salonA, ids.salonB]) if (id) await h.db.delete(salons).where(eq(salons.id, id));
      await h.db.delete(user).where(inArray(user.id, [OWNER_A, OWNER_B]));
    } finally {
      await h.end();
    }
  });

  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", SECRET);
    ctl.sendSms.mockReset();
    ctl.sendSms.mockResolvedValue({ success: true });
    ctl.sendReminderSms.mockReset();
    ctl.sendReminderSms.mockResolvedValue({ success: true });
    vi.mocked(logger.warn).mockClear();
  });

  // ------------------------------------------------------------ forSalon: odczyt

  it("birthday GET A: klient A, bez klienta B", async () => {
    const { status, body } = await parseResponse(await birthday.GET(get(`/api/notifications/birthday?salonId=${ids.salonA}`)));
    expect(status, JSON.stringify(body)).toBe(200);
    const text = JSON.stringify(body);
    expect(text).toContain(ids.inactiveA);
    expect(text).not.toContain(ids.inactiveB);
  });

  it("we-miss-you GET A: nieaktywny klient A, bez klienta B", async () => {
    const { status, body } = await parseResponse(await weMissYou.GET(get(`/api/notifications/we-miss-you?salonId=${ids.salonA}`)));
    expect(status, JSON.stringify(body)).toBe(200);
    const text = JSON.stringify(body);
    expect(text).toContain(ids.inactiveA);
    expect(text).not.toContain(ids.inactiveB);
  });

  it("low-stock GET A: produkt A, bez produktu B", async () => {
    const { status, body } = await parseResponse(await lowStock.GET(get(`/api/notifications/low-stock?salonId=${ids.salonA}`)));
    expect(status, JSON.stringify(body)).toBe(200);
    const text = JSON.stringify(body);
    expect(text).toContain(ids.productA);
    expect(text).not.toContain(ids.productB);
  });

  // ------------------------------------------------------------ forSalon: zapis

  it("birthday POST A: notyfikacja dla klienta A w salonie A; salon B bez nowych wierszy", async () => {
    const before = (await notificationsOf(ids.salonB)).length;
    const { status, body } = await parseResponse(await birthday.POST(post("/api/notifications/birthday", { salonId: ids.salonA })));
    expect(status, JSON.stringify(body)).toBe(200);
    const rowsA = (await notificationsOf(ids.salonA)).filter((r) => r.clientId === ids.inactiveA);
    expect(rowsA.length).toBeGreaterThanOrEqual(1);
    expect((await notificationsOf(ids.salonB)).length).toBe(before);
    const anyForB = await h!.db.select().from(notifications).where(eq(notifications.clientId, ids.inactiveB));
    expect(anyForB).toEqual([]);
  });

  it("we-miss-you POST A: notyfikacja dla klienta A w salonie A; salon B bez nowych wierszy", async () => {
    const before = (await notificationsOf(ids.salonB)).length;
    const beforeA = (await notificationsOf(ids.salonA)).length;
    const { status, body } = await parseResponse(await weMissYou.POST(post("/api/notifications/we-miss-you", { salonId: ids.salonA })));
    expect(status, JSON.stringify(body)).toBe(200);
    const rowsA = await notificationsOf(ids.salonA);
    expect(rowsA.length).toBeGreaterThan(beforeA);
    expect(rowsA.every((r) => r.clientId === null || r.clientId === ids.inactiveA || r.clientId === ids.apptClientA)).toBe(true);
    expect((await notificationsOf(ids.salonB)).length).toBe(before);
  });

  it("low-stock POST A: notyfikacja z salonu B o tym samym produkcie nie blokuje A; duplikat z A blokuje", async () => {
    await h!.db
      .insert(notifications)
      .values({ salonId: ids.salonB, type: "system", message: `it [product:${ids.productA}]`, status: "sent" });
    const beforeB = (await notificationsOf(ids.salonB)).length;
    const payload = {
      salonId: ids.salonA,
      productId: ids.productA,
      productName: "IT produkt A",
      quantity: 1,
      minQuantity: 5,
    };

    const first = await parseResponse<{ data: { notificationSent: boolean } }>(
      await lowStock.POST(post("/api/notifications/low-stock", payload))
    );
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body.data.notificationSent).toBe(true);
    const rowsA = (await notificationsOf(ids.salonA)).filter((r) => r.message.includes(ids.productA));
    expect(rowsA).toHaveLength(1);

    const second = await parseResponse<{ data: { notificationSent: boolean } }>(
      await lowStock.POST(post("/api/notifications/low-stock", payload))
    );
    expect(second.body.data.notificationSent).toBe(false);
    expect((await notificationsOf(ids.salonB)).length).toBe(beforeB);
  });

  // ------------------------------------------------------------ system/: przypomnienia

  it("reminders/appointment GET ?salonId=A: podgląd przez bramę salonu — tylko wizyty A", async () => {
    const { status, body } = await parseResponse(await reminders.GET(get(`/api/reminders/appointment?salonId=${ids.salonA}`)));
    expect(status, JSON.stringify(body)).toBe(200);
    const text = JSON.stringify(body);
    expect(text).toContain(ids.remindA);
    expect(text).not.toContain(ids.remindB);
    expect(text).not.toContain(ids.soonB);
    expect(text).not.toContain(ids.salonB);
    // Wizyta A z klientem salonu B: wiersz jest, dane klienta B nie.
    const appts = (body as { data: { appointments: Array<Record<string, unknown>> } }).data.appointments;
    const mismatch = appts.filter((a) => a.id === ids.mismatchA);
    expect(mismatch).toHaveLength(1);
    expect(mismatch[0]!.clientName).toBeNull();
    expect(mismatch[0]!.clientPhone).toBeNull();
  });

  it("reminders/appointment POST ?salonId=A: SMS i reminder_sent_at tylko dla wizyt A", async () => {
    const { status, body } = await parseResponse(await reminders.POST(postNoBody(`/api/reminders/appointment?salonId=${ids.salonA}`)));
    expect(status, JSON.stringify(body)).toBe(200);
    const salonsSent = ctl.sendSms.mock.calls.map((c) => (c[0] as { salonId: string }).salonId);
    expect(salonsSent.length).toBeGreaterThanOrEqual(1);
    expect(salonsSent.every((s) => s === ids.salonA)).toBe(true);
    const flags = await appointmentFlags([ids.remindA, ids.remindB]);
    expect(flags[ids.remindA]!.reminderSentAt).not.toBeNull();
    expect(flags[ids.remindB]!.reminderSentAt).toBeNull();
  });

  // Po poprzednim przypadku wizyty A z klientem A są oznaczone; w oknie A zostaje
  // tylko wizyta z klientem salonu B (i ewentualnie cudze wiersze bazy spoza testu).
  it("reminders/appointment POST ?salonId=A: wizyta A z klientem salonu B → pominięta bez SMS, bez danych klienta B, log liczby", async () => {
    const { status, body } = await parseResponse<{ data: { results: Array<Record<string, unknown>> } }>(
      await reminders.POST(postNoBody(`/api/reminders/appointment?salonId=${ids.salonA}`))
    );
    expect(status, JSON.stringify(body)).toBe(200);
    const mine = body.data.results.filter((r) => r.appointmentId === ids.mismatchA);
    expect(mine).toEqual([
      { appointmentId: ids.mismatchA, clientName: "Nieznany", success: false, error: "Brak numeru telefonu klienta" },
    ]);
    expect(ctl.sendSms).not.toHaveBeenCalled();
    // Klient B („Ewa B”) nie trafia do odpowiedzi.
    expect(JSON.stringify(body)).not.toContain("Ewa");
    const flags = await appointmentFlags([ids.mismatchA]);
    expect(flags[ids.mismatchA]!.reminderSentAt).toBeNull();
    // Log pominiętych: jedna linia z rodzajem i liczbą (≥ 1 — baza może mieć inne takie wizyty).
    const warns = vi.mocked(logger.warn).mock.calls.filter((c) => (c[1] as { reminder?: string } | undefined)?.reminder === "sms24h");
    expect(warns).toHaveLength(1);
    const ctx = warns[0]![1] as { reminder: string; skipped: number };
    expect(Object.keys(ctx).sort()).toEqual(["reminder", "skipped"]);
    expect(ctx.skipped).toBeGreaterThanOrEqual(1);
  });

  it("reminders/appointment POST bez salonId: wizyty obu salonów (cron)", async () => {
    const { status, body } = await parseResponse(await reminders.POST(postNoBody("/api/reminders/appointment")));
    expect(status, JSON.stringify(body)).toBe(200);
    const flags = await appointmentFlags([ids.remindA, ids.remindB]);
    expect(flags[ids.remindA]!.reminderSentAt).not.toBeNull();
    expect(flags[ids.remindB]!.reminderSentAt).not.toBeNull();
  });

  it("cron/sms-reminders: flaga 1h na wizytach obu salonów", async () => {
    const { status, body } = await parseResponse(await smsCron.POST(postNoBody("/api/cron/sms-reminders")));
    expect(status, JSON.stringify(body)).toBe(200);
    const flags = await appointmentFlags([ids.soonA, ids.soonB]);
    expect(flags[ids.soonA]!.reminder1hSentAt).not.toBeNull();
    expect(flags[ids.soonB]!.reminder1hSentAt).not.toBeNull();
  });

  it("reminders/appointment POST z pustym salonId → 400, bez wysyłki", async () => {
    const res = await reminders.POST(postNoBody("/api/reminders/appointment?salonId="));
    expect(res.status).toBe(400);
    expect(ctl.sendSms).not.toHaveBeenCalled();
  });
});
