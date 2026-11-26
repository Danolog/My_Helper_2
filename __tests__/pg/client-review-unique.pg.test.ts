/**
 * Jedna opinia na wizytę: `POST /api/client/appointments/[id]/review` na
 * PRAWDZIWYM Postgresie z indeksem `reviews_appointment_id_uq` (migracja 0016).
 *
 * Dowody:
 * 1. Dwa równoległe POST dla tej samej wizyty, oba INSERT w locie jednocześnie
 *    (bariera: obserwator trzyma `LOCK TABLE reviews IN SHARE MODE`, które
 *    przepuszcza SELECT szybkiej ścieżki, a zatrzymuje INSERT): dokładnie jedno
 *    200 i jedno 409 z komunikatem szybkiej ścieżki, w tabeli jeden wiersz.
 * 2. Kolejne POST po zapisie: 409 z szybkiej ścieżki SELECT, nadal jeden wiersz.
 * 3. Indeks jest częściowy: dwie opinie z `appointment_id = NULL` (stan po
 *    usunięciu wizyty, FK `ON DELETE SET NULL`) wchodzą bez błędu.
 * 4. Bezpośredni drugi INSERT dla tej samej wizyty (z pominięciem trasy) → 23505.
 *
 * Trasa jest user-scoped i pisze przez `@/lib/db` (ADR-001), więc `@/lib/db`
 * podmieniamy na pulę testu. Mocki: sesja (`requireAuth`), logger.
 *
 * Dane: użytkownicy `it-t3-review-…`; reszta kaskadą z salonu w `afterAll`.
 * Uruchomienie: `INTEGRATION_POSTGRES_URL=<lokalna baza testowa> pnpm test:pg -- __tests__/pg/client-review-unique.pg.test.ts`.
 * Wymaga bazy po `pnpm db:migrate`.
 */
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as route from "@/app/api/client/appointments/[id]/review/route";
import { appointments, employees, reviews, salons, services, user } from "@/lib/schema";
import { isUniqueViolation } from "@/lib/subscription-predicates";
import { createRouteParams, parseResponse } from "../api/helpers";

const h = await vi.hoisted(async () => (await import("./pg-harness")).createIntegrationDb());

const ctl = vi.hoisted(() => ({ userId: "" }));

vi.mock("@/lib/db", () => ({
  get db() {
    if (!h) throw new Error("INTEGRATION_POSTGRES_URL not set");
    return h.db;
  },
}));
vi.mock("@/lib/auth-middleware", () => ({
  requireAuth: async () => ({ user: { id: ctl.userId } }),
  isAuthError: () => false,
}));
vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
// Moduł opinii jest zamrożony; test sprawdza logikę na czas po odmrożeniu.
vi.mock("@/lib/features", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/features")>();
  return {
    ...actual,
    isModuleFrozen: (key: Parameters<typeof actual.isModuleFrozen>[0]) =>
      key === "reviews" ? false : actual.isModuleFrozen(key),
  };
});

const RUN = randomUUID().slice(0, 8);
const OWNER = `it-t3-review-o-${RUN}`;
const USER_X = `it-t3-review-x-${RUN}`;
const USERS = [OWNER, USER_X];

const ids = { salon: "", emp: "", svc: "", race: "", direct: "" };

const HOUR = 60 * 60 * 1000;
const hoursAgo = (hours: number) => new Date(Date.now() - hours * HOUR);
const BASE = "http://localhost/api/client/appointments";
const ALREADY_EXISTS = { success: false, error: "Opinia dla tej wizyty zostala juz wystawiona" };

const post = async (id: string, body: unknown) =>
  parseResponse<Record<string, unknown>>(
    await route.POST(
      new Request(`${BASE}/${id}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
      createRouteParams(id)
    )
  );

async function reviewCount(appointmentId: string): Promise<number> {
  const rows = await h!.db.select({ id: reviews.id }).from(reviews).where(eq(reviews.appointmentId, appointmentId));
  return rows.length;
}

async function insertCompletedAppointment(hoursBack: number): Promise<string> {
  const start = hoursAgo(hoursBack);
  const [row] = await h!.db
    .insert(appointments)
    .values({
      salonId: ids.salon,
      employeeId: ids.emp,
      serviceId: ids.svc,
      bookedByUserId: USER_X,
      startTime: start,
      endTime: new Date(start.getTime() + HOUR),
      status: "completed",
    })
    .returning({ id: appointments.id });
  return row!.id;
}

/** Czeka, aż `count` INSERT-ów do reviews czeka na blokadę (oba w locie). */
async function waitForBlockedInserts(count: number, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const [row] = await h!.observer<{ n: number }[]>`
      select count(*)::int as n
      from pg_stat_activity
      where wait_event_type = 'Lock'
        and query ilike 'insert into "reviews"%'
    `;
    if ((row?.n ?? 0) >= count) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`bariera: mniej niż ${count} INSERT w oczekiwaniu na blokadę po ${timeoutMs} ms`);
}

const suite = h ? describe : describe.skip;

suite("jedna opinia na wizytę (reviews_appointment_id_uq), prawdziwy Postgres", () => {
  beforeAll(async () => {
    const db = h!.db;
    await db.insert(user).values(
      USERS.map((id) => ({ id, name: `IT T3 review ${id}`, email: `${id}@example.invalid`, emailVerified: true }))
    );
    const [s] = await db.insert(salons).values({ name: `IT T3 review ${RUN}`, ownerId: OWNER }).returning({ id: salons.id });
    ids.salon = s!.id;
    const [e] = await db.insert(employees).values({ salonId: ids.salon, firstName: "Ola", lastName: "R" }).returning({ id: employees.id });
    ids.emp = e!.id;
    const [v] = await db
      .insert(services)
      .values({ salonId: ids.salon, name: "IT Usługa R", basePrice: "100.00", baseDuration: 60 })
      .returning({ id: services.id });
    ids.svc = v!.id;
    ids.race = await insertCompletedAppointment(48);
    ids.direct = await insertCompletedAppointment(46);
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

  it("1: dwa równoległe POST dla tej samej wizyty — jedno 200, jedno 409, jeden wiersz", async () => {
    ctl.userId = USER_X;
    let calls: Promise<Awaited<ReturnType<typeof post>>[]> | null = null;
    // SHARE nie koliduje z ACCESS SHARE (SELECT szybkiej ścieżki przechodzi),
    // a koliduje z ROW EXCLUSIVE (oba INSERT stają). Po commicie obserwatora
    // pierwszy INSERT wygrywa, drugi trafia w indeks unikalny.
    await h!.observer.begin(async (tx) => {
      await tx.unsafe('lock table "reviews" in share mode');
      calls = Promise.all([
        post(ids.race, { rating: 5, comment: "Pierwsza" }),
        post(ids.race, { rating: 4, comment: "Druga" }),
      ]);
      await waitForBlockedInserts(2);
    });
    const results = await calls!;
    const codes = results.map((r) => r.status).sort();
    expect(codes, JSON.stringify(results.map((r) => r.body))).toEqual([200, 409]);
    expect(results.find((r) => r.status === 409)!.body).toEqual(ALREADY_EXISTS);
    expect(await reviewCount(ids.race)).toBe(1);
  });

  it("2: kolejne POST po zapisie — 409 z szybkiej ścieżki, nadal jeden wiersz", async () => {
    ctl.userId = USER_X;
    const res = await post(ids.race, { rating: 3, comment: null });
    expect(res.status).toBe(409);
    expect(res.body).toEqual(ALREADY_EXISTS);
    expect(await reviewCount(ids.race)).toBe(1);
  });

  it("3: indeks częściowy — wiele opinii z appointment_id = NULL wchodzi bez błędu", async () => {
    const rows = await h!.db
      .insert(reviews)
      .values([
        { salonId: ids.salon, appointmentId: null, rating: 5, status: "pending" },
        { salonId: ids.salon, appointmentId: null, rating: 4, status: "pending" },
      ])
      .returning({ id: reviews.id });
    expect(rows).toHaveLength(2);
  });

  it("4: bezpośredni drugi INSERT dla tej samej wizyty — 23505", async () => {
    await h!.db.insert(reviews).values({ salonId: ids.salon, appointmentId: ids.direct, rating: 5, status: "pending" });
    let caught: unknown = null;
    try {
      await h!.db.insert(reviews).values({ salonId: ids.salon, appointmentId: ids.direct, rating: 1, status: "pending" });
    } catch (e) {
      caught = e;
    }
    expect(isUniqueViolation(caught), String(caught)).toBe(true);
    expect(await reviewCount(ids.direct)).toBe(1);
  });
});
