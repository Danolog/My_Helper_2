/**
 * Limity w `POST /api/deposits/blik-booking` na PRAWDZIWYM Postgresie:
 * najwyżej 20 rezerwacji z zadatkiem na salon w 24 h kroczących (bez
 * anulowanych i bez wizyt z kartoteką klienta) i najwyżej 3 niewpłacone,
 * nieanulowane na jednego gościa w salonie; personel salonu poza limitami.
 *
 * Prawdziwa trasa: walidacje, `assertSalonRefs`, `calculateExpectedDeposit`
 * i transakcja zapisu przez `forSalon(salonId)` (rola aplikacji + kontekst
 * salonu), z prawdziwym `pg_advisory_xact_lock`. Atrapy: sesja i kontekst
 * salonu (sterowane przez `ctl`, domyślnie gość), limit IP (wiele żądań
 * z jednego adresu), SMS, logger.
 *
 * Przypadki:
 * - 20 wizyt z zadatkiem w A (utworzone teraz, start jutro) → 429, w A nadal 20 wierszy;
 * - 20 wizyt → 429, potem anulowanie jednej z nich → następna rezerwacja 201;
 * - 20 w B → rezerwacja w A = 201;
 * - w A 20 wizyt sprzed 25 h i 20 bez zadatku → 201 (nie liczą się);
 * - 19 + 1 anulowana → 201 (anulowana się nie liczy);
 * - 20 wizyt z kartoteką klienta salonu A → 201 (nie liczą się);
 * - personel salonu A przy 20 wizytach → 201;
 * - gość: 3 niewpłacone z jego numerem w innym zapisie → 429; 3 wpłacone → 201; 3 anulowane → 201;
 * - 19 + dwa równoległe żądania (różni pracownicy, różne terminy) → dokładnie jedno 201 i jedno 429.
 *
 * Wiersze wizyt fikstur zapisuje test pulą harnessu (bez kontekstu salonu);
 * każda wizyta fikstury ma własny numer gościa (+48 000 9…, numeracja
 * nieprzydzielana abonentom), chyba że przypadek podaje numer.
 * Dane: użytkownicy `it-t3-blim-…` (prefiks z notatki sprzątania w pg-harness.ts),
 * dwa salony z pracownikami i usługą, klient salonu A; `afterAll` usuwa wizyty,
 * klientów, pracowników, usługi i salony testu, potem użytkowników.
 * Uruchomienie: `INTEGRATION_POSTGRES_URL=postgresql://…@localhost:5432/<baza> pnpm test:pg -- __tests__/pg/blik-booking-salon-limit.pg.test.ts`.
 * Wymaga bazy po `pnpm db:migrate` (RLS i rola `myhelper_app`).
 */
import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/deposits/blik-booking/route";
import { appointments, clients, employees, salons, services, user } from "@/lib/schema";
import { TEST_PHONE } from "@/lib/test-phone";
import { createMockRequest, parseResponse } from "../api/helpers";

const h = await vi.hoisted(async () => (await import("./pg-harness")).createIntegrationDb());
const ctl = vi.hoisted(() => ({
  sms: vi.fn(),
  /** Wynik `getOptionalSession`: null = gość. */
  session: null as null | { user: { id: string } },
  /** Wynik `getSalonContext`: salon personelu albo null. */
  salonCtx: null as null | { salonId: string; role: string },
}));

vi.mock("@/lib/db", () => ({
  get db() {
    if (!h) throw new Error("INTEGRATION_POSTGRES_URL not set");
    return h.db;
  },
}));
vi.mock("@/lib/session", () => ({ getOptionalSession: async () => ctl.session }));
vi.mock("@/lib/salon-context", () => ({ getSalonContext: async () => ctl.salonCtx }));
// Limit IP poza zakresem: wszystkie żądania testu idą z jednego adresu.
vi.mock("@/lib/rate-limit", () => ({
  strictRateLimit: { check: () => ({ success: true, remaining: 99, reset: 60_000 }) },
  getClientIp: () => "127.0.0.1",
}));
vi.mock("@/lib/sms", async (orig) => ({
  ...(await orig<typeof import("@/lib/sms")>()),
  sendBlikDepositBookingSms: (...a: unknown[]) => ctl.sms(...a),
}));
vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const RUN = randomUUID().slice(0, 8);
const OWNER_A = `it-t3-blim-a-${RUN}`;
const OWNER_B = `it-t3-blim-b-${RUN}`;
const BLIK_PHONE = "+48000600703";
/** Numer gościa z body (`TEST_PHONE`) zapisany w innym formacie. */
const GUEST_PHONE_OTHER_FORMAT = "000600700";
const LIMIT = 20;
const GUEST_LIMIT = 3;
const RATE_LIMIT_BODY = { success: false, error: "Zbyt wiele żądań. Spróbuj ponownie później." };
const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const SERVICE_MINUTES = 30;
/** 30% z 100 PLN (usługa testu) — kwota liczona przez serwer. */
const DEPOSIT = 30;

const ids = {
  salonA: "",
  salonB: "",
  /** Pracownik fikstur (wizyty zapisane przez test). */
  seedEmpA: "",
  seedEmpB: "",
  /** Pracownicy rezerwacji przez trasę (bez fikstur — bez kolizji). */
  bookEmpA1: "",
  bookEmpA2: "",
  svcA: "",
  svcB: "",
  /** Kartoteka klienta salonu A. */
  clientA: "",
};

/** Kolejny wolny slot fikstur w teście (wizyty jednego pracownika bez nakładania). */
let seedSlot = 0;
/** Kolejny numer gościa fikstury: każdy wiersz inny, żaden nie jest numerem z body. */
let seedPhoneSeq = 0;
const nextSeedPhone = () => `+48 000 9${String(seedPhoneSeq++).padStart(5, "0")}`;

/** Początek jutrzejszego dnia fikstur, wyrównany do pełnej godziny. */
const seedBase = () => new Date(Math.ceil((Date.now() + DAY_MS) / 3_600_000) * 3_600_000);

interface SeedOptions {
  depositAmount?: string | null;
  depositPaid?: boolean;
  status?: string;
  /** Wizyty utworzone 25 h temu (zegar bazy). */
  old?: boolean;
  /** Ten sam numer gościa we wszystkich wierszach; domyślnie każdy wiersz inny. */
  guestPhone?: string;
  clientId?: string;
}

async function seed(salonId: string, employeeId: string, serviceId: string, n: number, opts: SeedOptions = {}) {
  const base = seedBase().getTime();
  const rows = Array.from({ length: n }, () => {
    const start = new Date(base + seedSlot++ * SERVICE_MINUTES * MINUTE_MS);
    return {
      salonId,
      employeeId,
      serviceId,
      startTime: start,
      endTime: new Date(start.getTime() + SERVICE_MINUTES * MINUTE_MS),
      status: opts.status ?? "scheduled",
      depositAmount: opts.depositAmount === undefined ? "30.00" : opts.depositAmount,
      depositPaid: opts.depositPaid ?? false,
      guestName: "IT Gosc",
      guestPhone: opts.guestPhone ?? nextSeedPhone(),
      clientId: opts.clientId ?? null,
      ...(opts.old ? { createdAt: sql`now() - interval '25 hours'` } : {}),
    };
  });
  if (rows.length > 0) await h!.db.insert(appointments).values(rows);
}

/** Termin rezerwacji przez trasę: pojutrze, osobna godzina na żądanie. */
function bookingBody(salonId: string, employeeId: string, serviceId: string, hourOffset = 0) {
  const start = new Date(Math.ceil((Date.now() + 2 * DAY_MS) / 3_600_000) * 3_600_000 + hourOffset * 3_600_000);
  return {
    salonId,
    employeeId,
    serviceId,
    startTime: start.toISOString(),
    endTime: new Date(start.getTime() + SERVICE_MINUTES * MINUTE_MS).toISOString(),
    depositAmount: DEPOSIT,
    guestName: "IT Gosc",
    guestPhone: TEST_PHONE,
  };
}

const book = (body: unknown) =>
  POST(createMockRequest("http://localhost/api/deposits/blik-booking", { method: "POST", body }));

const bookA = (hourOffset = 0) => book(bookingBody(ids.salonA, ids.bookEmpA1, ids.svcA, hourOffset));

async function countAppointments(salonId: string) {
  const rows = await h!.db
    .select({ id: appointments.id })
    .from(appointments)
    .where(eq(appointments.salonId, salonId));
  return rows.length;
}

const suite = h ? describe : describe.skip;

suite("blik-booking: limity salonu (20) i gościa (3) na 24 h — prawdziwy Postgres", () => {
  beforeAll(async () => {
    const db = h!.db;
    await db.insert(user).values([
      { id: OWNER_A, name: "IT T3 blim A", email: `${OWNER_A}@example.invalid` },
      { id: OWNER_B, name: "IT T3 blim B", email: `${OWNER_B}@example.invalid` },
    ]);
    const settingsJson = { deposits: { blikPhone: BLIK_PHONE } };
    const [a] = await db
      .insert(salons)
      .values({ name: `IT T3 blim A ${RUN}`, ownerId: OWNER_A, settingsJson })
      .returning({ id: salons.id });
    const [b] = await db
      .insert(salons)
      .values({ name: `IT T3 blim B ${RUN}`, ownerId: OWNER_B, settingsJson })
      .returning({ id: salons.id });
    ids.salonA = a!.id;
    ids.salonB = b!.id;

    const emp = async (salonId: string, lastName: string) => {
      const [row] = await db
        .insert(employees)
        .values({ salonId, firstName: "IT", lastName })
        .returning({ id: employees.id });
      return row!.id;
    };
    ids.seedEmpA = await emp(ids.salonA, "SeedA");
    ids.seedEmpB = await emp(ids.salonB, "SeedB");
    ids.bookEmpA1 = await emp(ids.salonA, "BookA1");
    ids.bookEmpA2 = await emp(ids.salonA, "BookA2");

    const svc = async (salonId: string, name: string) => {
      const [row] = await db
        .insert(services)
        .values({
          salonId,
          name,
          basePrice: "100.00",
          baseDuration: SERVICE_MINUTES,
          depositRequired: true,
          depositPercentage: 30,
        })
        .returning({ id: services.id });
      return row!.id;
    };
    ids.svcA = await svc(ids.salonA, "IT Usługa A");
    ids.svcB = await svc(ids.salonB, "IT Usługa B");

    const [client] = await db
      .insert(clients)
      .values({ salonId: ids.salonA, firstName: "IT", lastName: "Klient A" })
      .returning({ id: clients.id });
    ids.clientA = client!.id;
  });

  afterAll(async () => {
    if (!h) return;
    try {
      const own = [ids.salonA, ids.salonB].filter(Boolean);
      if (own.length > 0) {
        await h.db.delete(appointments).where(inArray(appointments.salonId, own));
        await h.db.delete(clients).where(inArray(clients.salonId, own));
        await h.db.delete(employees).where(inArray(employees.salonId, own));
        await h.db.delete(services).where(inArray(services.salonId, own));
        await h.db.delete(salons).where(inArray(salons.id, own));
      }
      await h.db.delete(user).where(inArray(user.id, [OWNER_A, OWNER_B]));
    } finally {
      await h.end();
    }
  });

  beforeEach(async () => {
    seedSlot = 0;
    ctl.session = null;
    ctl.salonCtx = null;
    ctl.sms.mockReset();
    ctl.sms.mockResolvedValue({ success: true, notificationId: "it-notif" });
    await h!.db.delete(appointments).where(inArray(appointments.salonId, [ids.salonA, ids.salonB]));
  });

  describe("limit salonu", () => {
    it("20 wizyt z zadatkiem w A → 429, w A nadal 20 wierszy, bez SMS", async () => {
      await seed(ids.salonA, ids.seedEmpA, ids.svcA, LIMIT);
      const res = await bookA();
      const { status, body } = await parseResponse(res);
      expect(status, JSON.stringify(body)).toBe(429);
      expect(res.headers.get("Retry-After")).toBe("3600");
      expect(body).toEqual(RATE_LIMIT_BODY);
      expect(await countAppointments(ids.salonA)).toBe(LIMIT);
      expect(ctl.sms).not.toHaveBeenCalled();
    });

    it("20 wizyt → 429; właściciel anuluje jedną z nich → następna rezerwacja 201", async () => {
      await seed(ids.salonA, ids.seedEmpA, ids.svcA, LIMIT);
      expect((await bookA()).status).toBe(429);

      const [one] = await h!.db
        .select({ id: appointments.id })
        .from(appointments)
        .where(eq(appointments.salonId, ids.salonA))
        .limit(1);
      await h!.db.update(appointments).set({ status: "cancelled" }).where(eq(appointments.id, one!.id));

      const { status, body } = await parseResponse(await bookA());
      expect(status, JSON.stringify(body)).toBe(201);
      expect(await countAppointments(ids.salonA)).toBe(LIMIT + 1);
      expect(ctl.sms).toHaveBeenCalledTimes(1);
    });

    it("20 wizyt z zadatkiem w B → rezerwacja w A = 201", async () => {
      await seed(ids.salonB, ids.seedEmpB, ids.svcB, LIMIT);
      const { status, body } = await parseResponse(await bookA());
      expect(status, JSON.stringify(body)).toBe(201);
      expect(await countAppointments(ids.salonA)).toBe(1);
      expect(await countAppointments(ids.salonB)).toBe(LIMIT);
      expect(ctl.sms).toHaveBeenCalledTimes(1);
    });

    it("w A 20 wizyt sprzed 25 h i 20 bez zadatku → 201 (nie liczą się)", async () => {
      await seed(ids.salonA, ids.seedEmpA, ids.svcA, LIMIT, { old: true });
      await seed(ids.salonA, ids.seedEmpA, ids.svcA, LIMIT, { depositAmount: null });
      const { status, body } = await parseResponse(await bookA());
      expect(status, JSON.stringify(body)).toBe(201);
      expect(await countAppointments(ids.salonA)).toBe(2 * LIMIT + 1);
    });

    it("19 wizyt z zadatkiem + 1 anulowana → 201 (anulowana się nie liczy)", async () => {
      await seed(ids.salonA, ids.seedEmpA, ids.svcA, LIMIT - 1);
      await seed(ids.salonA, ids.seedEmpA, ids.svcA, 1, { status: "cancelled" });
      const { status, body } = await parseResponse(await bookA());
      expect(status, JSON.stringify(body)).toBe(201);
      expect(await countAppointments(ids.salonA)).toBe(LIMIT + 1);
      expect(ctl.sms).toHaveBeenCalledTimes(1);
    });

    it("20 wizyt z kartoteką klienta salonu A → 201 (nie liczą się)", async () => {
      await seed(ids.salonA, ids.seedEmpA, ids.svcA, LIMIT, { clientId: ids.clientA });
      const { status, body } = await parseResponse(await bookA());
      expect(status, JSON.stringify(body)).toBe(201);
      expect(await countAppointments(ids.salonA)).toBe(LIMIT + 1);
    });

    it("personel salonu A przy 20 wizytach → 201 (poza limitem)", async () => {
      ctl.session = { user: { id: OWNER_A } };
      ctl.salonCtx = { salonId: ids.salonA, role: "owner" };
      await seed(ids.salonA, ids.seedEmpA, ids.svcA, LIMIT);
      const { status, body } = await parseResponse(await bookA());
      expect(status, JSON.stringify(body)).toBe(201);
      expect(await countAppointments(ids.salonA)).toBe(LIMIT + 1);
    });

    it("19 wizyt + dwa równoległe żądania (różni pracownicy i terminy) → dokładnie jedno 201 i jedno 429", async () => {
      await seed(ids.salonA, ids.seedEmpA, ids.svcA, LIMIT - 1);
      const results = await Promise.all([
        book(bookingBody(ids.salonA, ids.bookEmpA1, ids.svcA, 0)),
        book(bookingBody(ids.salonA, ids.bookEmpA2, ids.svcA, 3)),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 429]);
      expect(await countAppointments(ids.salonA)).toBe(LIMIT);
      const created = await h!.db
        .select({ id: appointments.id })
        .from(appointments)
        .where(
          and(eq(appointments.salonId, ids.salonA), inArray(appointments.employeeId, [ids.bookEmpA1, ids.bookEmpA2]))
        );
      expect(created).toHaveLength(1);
      expect(ctl.sms).toHaveBeenCalledTimes(1);
    });
  });

  describe("limit gościa", () => {
    it("3 niewpłacone z numerem gościa w innym zapisie → 429, bez wiersza i SMS", async () => {
      await seed(ids.salonA, ids.seedEmpA, ids.svcA, GUEST_LIMIT, { guestPhone: GUEST_PHONE_OTHER_FORMAT });
      const res = await bookA();
      const { status, body } = await parseResponse(res);
      expect(status, JSON.stringify(body)).toBe(429);
      expect(res.headers.get("Retry-After")).toBe("3600");
      expect(body).toEqual(RATE_LIMIT_BODY);
      expect(await countAppointments(ids.salonA)).toBe(GUEST_LIMIT);
      expect(ctl.sms).not.toHaveBeenCalled();
    });

    it("3 wpłacone z tym numerem → 201", async () => {
      await seed(ids.salonA, ids.seedEmpA, ids.svcA, GUEST_LIMIT, {
        guestPhone: GUEST_PHONE_OTHER_FORMAT,
        depositPaid: true,
      });
      const { status, body } = await parseResponse(await bookA());
      expect(status, JSON.stringify(body)).toBe(201);
      expect(await countAppointments(ids.salonA)).toBe(GUEST_LIMIT + 1);
    });

    it("3 anulowane z tym numerem → 201", async () => {
      await seed(ids.salonA, ids.seedEmpA, ids.svcA, GUEST_LIMIT, {
        guestPhone: GUEST_PHONE_OTHER_FORMAT,
        status: "cancelled",
      });
      const { status, body } = await parseResponse(await bookA());
      expect(status, JSON.stringify(body)).toBe(201);
      expect(await countAppointments(ids.salonA)).toBe(GUEST_LIMIT + 1);
    });
  });
});
