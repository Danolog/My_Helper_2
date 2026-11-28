/**
 * Raport przychodu (kwota zapisana przy zakończeniu, podział na metody) na
 * PRAWDZIWYM Postgresie, pod rolą aplikacji:
 * - rozdzielenie salonów: raport A nie zawiera kwot ani wizyt B; właściciel A
 *   z `salonId` B → 403;
 * - statusy: tylko `completed`; anulowane, „Nie przyszedł”, zaplanowane
 *   i potwierdzone z wpisaną kwotą nie wchodzą do sumy;
 * - zakres dat po `startTime`: wizyta w dniu `dateTo` o 18:00 wchodzi, dzień
 *   po `dateTo` o 00:30 i przed `dateFrom` nie wchodzą. Godziny daleko od
 *   północy UTC.
 *
 * Trasa wołana bezpośrednio; atrapa sesji (`auth.api.getSession`) i nagłówków;
 * `@/lib/db` wskazuje bazę testową. Kontekst salonu i `forSalon` prawdziwe.
 *
 * Dane: konta `it-t3-rev-…` (właściciele A i B), salony A i B, pracownik i usługa
 * w każdym, wizyty w czerwcu 2097 wstawione rolą migracji (wizyta `completed`
 * z kwotą da się założyć tylko tak albo przez trasę zakończenia). Salony
 * usuwane w `afterAll` (kaskada).
 */
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/reports/revenue/route";
import { appointments, employees, services, salons, user } from "@/lib/schema";
import { parseResponse } from "../api/helpers";

const h = await vi.hoisted(async () => (await import("./pg-harness")).createIntegrationDb());
const ctl = vi.hoisted(() => ({ userId: "" }));

vi.mock("@/lib/db", () => ({
  get db() {
    if (!h) throw new Error("INTEGRATION_POSTGRES_URL not set");
    return h.db;
  },
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: async () =>
        ctl.userId
          ? {
              user: { id: ctl.userId, email: `${ctl.userId}@example.invalid`, name: "IT" },
              session: { id: `s-${ctl.userId}`, userId: ctl.userId },
            }
          : null,
    },
  },
}));

const suite = h ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const OWNER_A = `it-t3-rev-a-${RUN}`;
const OWNER_B = `it-t3-rev-b-${RUN}`;
const ids = { salonA: "", salonB: "", empA: "", empB: "", serviceA: "", serviceB: "" };

/** Okres raportu: 10–20 czerwca 2097. */
const DATE_FROM = "2097-06-10";
const DATE_TO = "2097-06-20";
/** Dzień z wizytami w innych statusach (osobny, żeby test statusów miał tylko je). */
const STATUS_DAY = "2097-06-13";

type Salon = "A" | "B";

interface SeedAppointment {
  salon: Salon;
  /** ISO w UTC. */
  start: string;
  status: string;
  paidAmount?: string;
  paymentMethod?: "cash" | "card" | "blik";
  discountAmount?: string;
}

async function insertAppointment(a: SeedAppointment) {
  const start = new Date(a.start);
  await h!.db.insert(appointments).values({
    salonId: a.salon === "A" ? ids.salonA : ids.salonB,
    employeeId: a.salon === "A" ? ids.empA : ids.empB,
    serviceId: a.salon === "A" ? ids.serviceA : ids.serviceB,
    startTime: start,
    endTime: new Date(start.getTime() + 1_800_000),
    status: a.status,
    paidAmount: a.paidAmount ?? null,
    paymentMethod: a.paymentMethod ?? null,
    discountAmount: a.discountAmount ?? null,
  });
}

interface MethodRow {
  method: string;
  count: number;
  revenue: string;
}

interface RevenueBody {
  success: boolean;
  data: {
    summary: { totalRevenue: string; totalAppointments: number };
    byPaymentMethod: MethodRow[];
    byService: { serviceId: string; revenue: string }[];
  };
}

function revenue(salonId: string, dateFrom: string, dateTo: string) {
  return GET(
    new Request(
      `http://localhost/api/reports/revenue?salonId=${salonId}&dateFrom=${dateFrom}&dateTo=${dateTo}`
    )
  );
}

function methods(body: RevenueBody): [string, number, string][] {
  return body.data.byPaymentMethod.map((r) => [r.method, r.count, r.revenue]);
}

suite("raport przychodu pod rolą aplikacji — prawdziwy Postgres", () => {
  beforeAll(async () => {
    const db = h!.db;
    await db.insert(user).values([
      { id: OWNER_A, name: "IT rev A", email: `${OWNER_A}@example.invalid` },
      { id: OWNER_B, name: "IT rev B", email: `${OWNER_B}@example.invalid` },
    ]);
    const [a] = await db.insert(salons).values({ name: `IT rev A ${RUN}`, ownerId: OWNER_A }).returning({ id: salons.id });
    const [b] = await db.insert(salons).values({ name: `IT rev B ${RUN}`, ownerId: OWNER_B }).returning({ id: salons.id });
    ids.salonA = a!.id;
    ids.salonB = b!.id;
    const [ea] = await db
      .insert(employees)
      .values({ salonId: ids.salonA, firstName: "IT", lastName: "Pracownik A" })
      .returning({ id: employees.id });
    const [eb] = await db
      .insert(employees)
      .values({ salonId: ids.salonB, firstName: "IT", lastName: "Pracownik B" })
      .returning({ id: employees.id });
    ids.empA = ea!.id;
    ids.empB = eb!.id;
    const [sa] = await db
      .insert(services)
      .values({ salonId: ids.salonA, name: "IT rev usługa A", basePrice: "200.00", baseDuration: 30 })
      .returning({ id: services.id });
    const [sb] = await db
      .insert(services)
      .values({ salonId: ids.salonB, name: "IT rev usługa B", basePrice: "200.00", baseDuration: 30 })
      .returning({ id: services.id });
    ids.serviceA = sa!.id;
    ids.serviceB = sb!.id;

    const seed: SeedAppointment[] = [
      // Salon A, w okresie, completed
      { salon: "A", start: "2097-06-12T10:00:00.000Z", status: "completed", paidAmount: "100.00", paymentMethod: "cash" },
      // bez zapisu płatności: 200.00 − 30.00
      { salon: "A", start: "2097-06-15T10:00:00.000Z", status: "completed", discountAmount: "30.00" },
      // dzień dateTo, 18:00 UTC — wchodzi
      { salon: "A", start: `${DATE_TO}T18:00:00.000Z`, status: "completed", paidAmount: "50.00", paymentMethod: "card" },
      // Salon A, poza okresem
      { salon: "A", start: "2097-06-21T00:30:00.000Z", status: "completed", paidAmount: "7.00", paymentMethod: "blik" },
      { salon: "A", start: "2097-06-09T12:00:00.000Z", status: "completed", paidAmount: "9.00", paymentMethod: "blik" },
      // Salon A, w okresie, inne statusy z wpisaną kwotą — poza sumą
      { salon: "A", start: `${STATUS_DAY}T08:00:00.000Z`, status: "cancelled", paidAmount: "1000.00", paymentMethod: "cash" },
      { salon: "A", start: `${STATUS_DAY}T09:00:00.000Z`, status: "no_show", paidAmount: "1000.00", paymentMethod: "card" },
      { salon: "A", start: `${STATUS_DAY}T11:00:00.000Z`, status: "scheduled", paidAmount: "1000.00", paymentMethod: "blik" },
      { salon: "A", start: `${STATUS_DAY}T12:00:00.000Z`, status: "confirmed", paidAmount: "1000.00", paymentMethod: "cash" },
      // Salon B, w okresie, completed
      { salon: "B", start: "2097-06-12T10:00:00.000Z", status: "completed", paidAmount: "555.55", paymentMethod: "cash" },
    ];
    for (const a of seed) await insertAppointment(a);
  });

  afterAll(async () => {
    if (!h) return;
    try {
      for (const s of [ids.salonA, ids.salonB]) if (s) await h.db.delete(salons).where(eq(salons.id, s));
      await h.db.delete(user).where(inArray(user.id, [OWNER_A, OWNER_B]));
    } finally {
      await h.end();
    }
  });

  beforeEach(() => {
    ctl.userId = "";
  });

  describe("rozdzielenie salonów", () => {
    it("raport A: tylko wizyty A, kwoty w swoich metodach, bez kwot i wizyt B", async () => {
      ctl.userId = OWNER_A;

      const res = await parseResponse<RevenueBody>(await revenue(ids.salonA, DATE_FROM, DATE_TO));

      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.summary).toMatchObject({ totalRevenue: "320.00", totalAppointments: 3 });
      expect(methods(res.body)).toEqual([
        ["cash", 1, "100.00"],
        ["card", 1, "50.00"],
        ["blik", 0, "0.00"],
        ["none", 1, "170.00"],
      ]);
      expect(res.body.data.byService.map((s) => s.serviceId)).toEqual([ids.serviceA]);
      const raw = JSON.stringify(res.body);
      expect(raw).not.toContain("555.55");
      expect(raw).not.toContain(ids.serviceB);
      expect(raw).not.toContain(ids.empB);
    });

    it("raport B: tylko wizyta B", async () => {
      ctl.userId = OWNER_B;

      const res = await parseResponse<RevenueBody>(await revenue(ids.salonB, DATE_FROM, DATE_TO));

      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.summary).toMatchObject({ totalRevenue: "555.55", totalAppointments: 1 });
      expect(methods(res.body)[0]).toEqual(["cash", 1, "555.55"]);
    });

    it("właściciel A z salonId B → 403, bez danych B", async () => {
      ctl.userId = OWNER_A;

      const res = await parseResponse<Record<string, unknown>>(await revenue(ids.salonB, DATE_FROM, DATE_TO));

      expect(res.status).toBe(403);
      expect(JSON.stringify(res.body)).not.toContain("555.55");
    });
  });

  describe("statusy", () => {
    it("anulowana, „Nie przyszedł”, zaplanowana i potwierdzona z kwotą nie wchodzą do sumy", async () => {
      ctl.userId = OWNER_A;

      const res = await parseResponse<RevenueBody>(await revenue(ids.salonA, STATUS_DAY, STATUS_DAY));

      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.summary).toMatchObject({ totalRevenue: "0.00", totalAppointments: 0 });
      expect(methods(res.body)).toEqual([
        ["cash", 0, "0.00"],
        ["card", 0, "0.00"],
        ["blik", 0, "0.00"],
        ["none", 0, "0.00"],
      ]);
    });
  });

  describe("zakres dat", () => {
    it("wizyta w dniu dateTo o 18:00 wchodzi", async () => {
      ctl.userId = OWNER_A;

      const res = await parseResponse<RevenueBody>(await revenue(ids.salonA, DATE_TO, DATE_TO));

      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.summary).toMatchObject({ totalRevenue: "50.00", totalAppointments: 1 });
      expect(methods(res.body)[1]).toEqual(["card", 1, "50.00"]);
    });

    it("dzień po dateTo o 00:30 i dzień przed dateFrom nie wchodzą", async () => {
      ctl.userId = OWNER_A;

      const res = await parseResponse<RevenueBody>(await revenue(ids.salonA, DATE_FROM, DATE_TO));

      expect(res.status, JSON.stringify(res.body)).toBe(200);
      // wizyty BLIK (7.00 i 9.00) leżą tylko poza okresem
      expect(methods(res.body)[2]).toEqual(["blik", 0, "0.00"]);
      expect(res.body.data.summary.totalAppointments).toBe(3);
    });
  });
});
