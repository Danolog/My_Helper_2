/**
 * Kolizja wizyt na PRAWDZIWYM Postgresie: przedział półotwarty `[start, end)`
 * (#165) i ograniczenia z migracji 0009 (#171).
 *
 * - POST /api/appointments (rezerwacja gościa): styk, nakładanie, anulowana;
 * - ograniczenia bazy wprost: EXCLUDE `appointments_no_overlap` (23P01) i CHECK
 *   `*_end_after_start` (23514) na appointments i time_blocks;
 * - wyścig: równoległe zapisy tego samego terminu — dokładnie jeden przechodzi,
 *   reszta 409 (nie 500) — przez POST, PUT i pakiet;
 * - PUT /api/appointments/[id] i POST /api/appointments/book-package;
 * - zakleszczenie przy sprawdzaniu EXCLUDE (40P01, main `db71a43`): przepis na
 *   pewne 40P01 + wyścigi w pętli (PUT, POST, pakiet, zadatek) — zero 500;
 * - wolne terminy pod rolą aplikacji: pracownik salonu A zapytany z salonId = B → 404;
 * - publiczny katalog (GET salons/[id], usługa, profil pracownika): dane salonu A
 *   niewidoczne pod adresem salonu B, bez settingsJson/ownerId, zły format id → 400;
 * - galeria salonu (GET salons/[id]/gallery, forSalon): zdjęcia A, nie D; filtr
 *   pracownikiem A pod salonem D → pusta lista; zły format id → 400; lista salonów
 *   (GET /api/salons, pula systemowa): salon D bez settingsJson/ownerId i numeru BLIK;
 * - POST /api/deposits/blik-booking (gość): salon C z numerem BLIK → 201 bez wiersza deposit_payments, zajęty termin i wyścig → 409, salon A bez numeru → 409 bez nowej wizyty;
 * - POST /api/appointments/[id]/deposit (właściciel, forSalon): wizyta BLIK bez płatności → depositPaid=true
 *   w bazie; wizyta z wierszem deposit_payments → 409 bez zmiany stanu; wizyta salonu E przez kontekst A → 404.
 *
 * Mocki: sesja i kontekst salonu (atrapy, sterowane per opis), limiter, SMS,
 * logger, bramka zamrożenia modułu pakietów i unstable_cache (przejście bez cache).
 * Baza, RLS (forSalon), walidacja, przynależność referencji do salonu i strażnik
 * zadatku — prawdziwe. Salony B, C i D mają własnych właścicieli (jeden salon na użytkownika).
 *
 * Dane: użytkownik `it-t3-ovl-…` (prefiks z notatki sprzątania w pg-harness.ts),
 * salon, dwóch pracowników, klient, dwie usługi bez zadatku, promocja-pakiet;
 * wizyty kaskadą z salonu w `afterAll`. Terminy w 2099 r., KAŻDY test zapisu na
 * własnym dniu (ręczne oznaczenie zadatku: wspólny dzień 31, rozłączne godziny)
 * i z własnymi danymi — kolejność testów bez znaczenia.
 * Wymaga bazy z migracją 0009.
 * Uruchomienie: `INTEGRATION_POSTGRES_URL=postgresql://…@localhost:5432/pos_dev pnpm test:pg`.
 */
import { randomUUID } from "node:crypto";
import { and, eq, gte, lt } from "drizzle-orm";
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { POST as markDepositPaid } from "@/app/api/appointments/[id]/deposit/route";
import { PUT as updateAppointment } from "@/app/api/appointments/[id]/route";
import { POST as bookPackage } from "@/app/api/appointments/book-package/route";
import { POST as createAppointment } from "@/app/api/appointments/route";
import { GET as getAvailableSlots } from "@/app/api/available-slots/route";
import { POST as createBlikBooking } from "@/app/api/deposits/blik-booking/route";
import { POST as createDepositSession } from "@/app/api/deposits/create-session/route";
import { GET as getSalonEmployee } from "@/app/api/salons/[id]/employees/[employeeId]/route";
import { GET as getSalonGallery } from "@/app/api/salons/[id]/gallery/route";
import { GET as getSalon } from "@/app/api/salons/[id]/route";
import { GET as getSalonService } from "@/app/api/salons/[id]/services/[serviceId]/route";
import { GET as listSalons } from "@/app/api/salons/route";
import { APPOINTMENT_NO_OVERLAP_CONSTRAINT, dbErrorCode, isAppointmentSlotTaken } from "@/lib/appointment-overlap";
import {
  appointments,
  clients,
  depositPayments,
  employees,
  galleryPhotos,
  promoCodes,
  promotions,
  salons,
  services,
  timeBlocks,
  user,
  workSchedules,
} from "@/lib/schema";
import { sendBookingConfirmationSms } from "@/lib/sms";
// Godzina `hh:mm` w dniu `day` (UTC) marca 2099 r.; dzień spoza 1–31 = wyjątek (CI @ cf2ee2e: 2099-03-32).
import { at, dayRange } from "./pg-dates";

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
vi.mock("@/lib/sms", () => ({
  sendBookingConfirmationSms: vi.fn().mockResolvedValue(undefined),
  sendBlikDepositBookingSms: vi.fn().mockResolvedValue(undefined),
}));
// Katalog salonu (GET /api/salons/[id]) używa unstable_cache, który poza
// serwerem Next rzuca „incrementalCache missing”. Tu bez cache: każde wywołanie
// czyta prawdziwą bazę (cache ma osobny test jednostkowy).
vi.mock("next/cache", async (orig) => ({
  ...(await orig<typeof import("next/cache")>()),
  unstable_cache: <T extends (...args: never[]) => unknown>(fn: T) => fn,
}));
vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
// Zadatek (wyścig create-session): kwotę podmieniamy tylko w testach zadatku,
// poza nimi prawdziwe wyliczenie (strażnik zadatku POST zostaje prawdziwy).
// Stripe nieskonfigurowany → symulacja (ALLOW_PAYMENT_SIMULATION w teście).
const deposit = vi.hoisted(() => ({
  override: null as null | { ok: true; required: true; amount: number; serviceName: string },
}));
vi.mock("@/lib/deposit-calculation", async (orig) => {
  const real = await orig<typeof import("@/lib/deposit-calculation")>();
  return {
    ...real,
    calculateExpectedDeposit: ((...a: Parameters<typeof real.calculateExpectedDeposit>) =>
      deposit.override ? Promise.resolve(deposit.override) : real.calculateExpectedDeposit(...a)) as typeof real.calculateExpectedDeposit,
  };
});
vi.mock("@/lib/stripe", async (orig) => ({
  ...(await orig<typeof import("@/lib/stripe")>()),
  isStripeConfigured: () => false,
}));

const RUN = randomUUID().slice(0, 8);
const USER_ID = `it-t3-ovl-${RUN}`;
const OWNER_B_ID = `it-t3-ovl-b-${RUN}`;
const OWNER_C_ID = `it-t3-ovl-c-${RUN}`;
const MSG = "Termin koliduje z istniejaca wizyta. Wybierz inna godzine";
let salonId = "";
let employeeId = "";
let employee2Id = "";
let clientId = "";
let serviceId = "";
let service2Id = "";
let promotionId = "";

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
  const { from, to } = dayRange(day);
  const rows = await h!.db
    .select({ startTime: appointments.startTime, endTime: appointments.endTime, status: appointments.status })
    .from(appointments)
    .where(
      and(
        eq(appointments.salonId, salonId),
        eq(appointments.employeeId, emp),
        gte(appointments.startTime, from),
        lt(appointments.startTime, to)
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

/** `hh:mm` = `base` + `minutes` (w obrębie doby). */
function hhmm(base: string, minutes: number): string {
  const [h0, m0] = base.split(":").map(Number);
  const total = h0! * 60 + m0! + minutes;
  if (total < 0 || total >= 24 * 60) throw new Error(`hhmm: ${base} + ${minutes} min poza dobą`);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

async function depositSession(start: string, end: string) {
  const res = await createDepositSession(
    new Request("http://localhost/api/deposits/create-session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        salonId,
        employeeId,
        serviceId,
        startTime: start,
        endTime: end,
        depositAmount: 50,
        paymentMethod: "stripe",
        guestName: "IT Gość",
        guestPhone: "500600700",
      }),
    })
  );
  return { status: res.status, body: (await res.json()) as { success: boolean; error?: string } };
}

/**
 * Wyścig w pętli: w każdej iteracji dwa równoległe zapisy tego samego terminu.
 * Zakleszczenie przy sprawdzaniu EXCLUDE (40P01) zdarza się mniej więcej raz na
 * ~15 par (main `db71a43`), więc pojedynczy wyścig to za mało. Zwraca iteracje,
 * w których wynik nie był „jeden zwycięzca + 409 z komunikatem”.
 */
async function raceLoop(
  n: number,
  pair: (i: number) => Promise<{ status: number; body: { error?: string } }[]>,
  win: number,
  msg: string
): Promise<string[]> {
  const bad: string[] = [];
  for (let i = 0; i < n; i++) {
    const rs = await pair(i);
    const st = statuses(rs);
    const loser = rs.find((r) => r.status === 409);
    if (st[0] !== win || st[1] !== 409 || st.length !== 2 || loser?.body.error !== msg) {
      bad.push(`#${i}: [${st.join(", ")}] ${rs.map((r) => r.body.error ?? "").join(" | ")}`);
    }
  }
  return bad;
}

/** Aktywne wizyty dnia nie nachodzą na siebie (lista posortowana po starcie). */
function noOverlaps(day: string[]): boolean {
  return day.every((r, i) => i === 0 || day[i - 1]!.split("–")[1]! <= r.split("–")[0]!);
}

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

    it("wyścig: dwie równoległe rezerwacje tego samego terminu → dokładnie jedna 201, druga 409", async () => {
      const results = await Promise.all([post(at(6, "10:00"), at(6, "11:00")), post(at(6, "10:00"), at(6, "11:00"))]);
      expect(statuses(results)).toEqual([201, 409]);
      expect(results.find((r) => r.status === 409)!.body.error).toBe(MSG);
      expect(await activeOnDay(6)).toEqual([`${at(6, "10:00")}–${at(6, "11:00")}`]);
    });

    it("wyścig: 6 równoległych rezerwacji tego samego terminu → jedna 201, pięć 409, żadnej 500", async () => {
      const results = await Promise.all(Array.from({ length: 6 }, () => post(at(5, "10:00"), at(5, "11:00"))));
      expect(statuses(results)).toEqual([201, 409, 409, 409, 409, 409]);
      for (const r of results.filter((x) => x.status === 409)) expect(r.body.error).toBe(MSG);
      expect(await activeOnDay(5)).toEqual([`${at(5, "10:00")}–${at(5, "11:00")}`]);
    });

    // #193: POST gościa biegnie przez forSalon (SET LOCAL ROLE aplikacji +
    // kontekst salonu). Zapytanie do SMS łączy `salons` — gdyby polityka RLS
    // salons nie przepuszczała wiersza salonu z kontekstu, innerJoin dałby
    // zero wierszy i SMS zniknąłby po cichu (best-effort, bez błędu).
    it("#193: gość pod rolą aplikacji — wizyta zapisana, SMS dostaje nazwę salonu", async () => {
      const sms = vi.mocked(sendBookingConfirmationSms);
      sms.mockClear();
      const res = await post(at(29, "10:00"), at(29, "11:00"));
      expect(res.status, res.body.error).toBe(201);
      expect(await activeOnDay(29)).toEqual([`${at(29, "10:00")}–${at(29, "11:00")}`]);
      expect(sms).toHaveBeenCalledTimes(1);
      expect(sms.mock.calls[0]![0]).toMatchObject({
        salonName: `IT T3 ovl ${RUN}`,
        salonId,
        serviceName: "IT Usługa 30",
        employeeName: "IT Pracownik",
        clientPhone: "+48500600700",
      });
    });

    it("#193: gość z kodem promocyjnym pod rolą aplikacji — kod zapisany na wizycie i zużyty", async () => {
      const [code] = await h!.db
        .insert(promoCodes)
        .values({ salonId, code: `IT-PROMO-${RUN}`, usageLimit: 5, usedCount: 0 })
        .returning();
      const res = await createAppointment(
        new Request("http://localhost/api/appointments", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            salonId,
            employeeId,
            serviceId,
            startTime: at(30, "10:00"),
            endTime: at(30, "11:00"),
            guestName: "IT Gość",
            guestPhone: "500600700",
            promoCodeId: code!.id,
          }),
        })
      );
      const body = (await res.json()) as { error?: string; data?: { id: string; promoCodeId: string | null } };
      expect(res.status, body.error).toBe(201);
      expect(body.data?.promoCodeId).toBe(code!.id);
      const [after] = await h!.db
        .select({ usedCount: promoCodes.usedCount })
        .from(promoCodes)
        .where(eq(promoCodes.id, code!.id));
      expect(after!.usedCount).toBe(1);
    });
  });

  describe("ograniczenia bazy wprost (migracja 0009)", () => {
    it("EXCLUDE: nakładająca się aktywna wizyta tego pracownika → 23P01 appointments_no_overlap", async () => {
      await insertAppt(at(10, "10:00"), at(10, "11:00"));
      const err = await dbError(insertAppt(at(10, "10:59"), at(10, "12:00")));
      expect(err.code).toBe("23P01");
      expect(err.constraint_name).toBe(APPOINTMENT_NO_OVERLAP_CONSTRAINT);
    });

    it("EXCLUDE: isAppointmentSlotTaken rozpoznaje błąd w kształcie z Drizzle", async () => {
      await insertAppt(at(11, "10:00"), at(11, "11:00"));
      let caught: unknown;
      try {
        await insertAppt(at(11, "10:30"), at(11, "11:30"));
      } catch (e) {
        caught = e;
      }
      expect(isAppointmentSlotTaken(caught)).toBe(true);
    });

    // Deterministyczne zakleszczenie (przepis Olivera): dwie transakcje przenoszą
    // wizyty „na krzyż” na terminy X i Y. A: a→X, B: b→Y, potem A: c→Y (czeka na
    // B), B: d→X (czeka na A). Po deadlock_timeout baza wycofuje jedną z 40P01 i
    // CONTEXT „while checking exclusion constraint … in relation "appointments"”.
    // Test na PRAWDZIWYM obiekcie błędu sterownika: zmiana lc_messages albo
    // wersji Postgresa (inny tekst/pole) czerwieni CI, zamiast po cichu dać 500.
    it("prawdziwe zakleszczenie przy sprawdzaniu EXCLUDE → 40P01, isAppointmentSlotTaken = true", async () => {
      const D = 16;
      const a = await insertAppt(at(D, "06:00"), at(D, "07:00"));
      const b = await insertAppt(at(D, "07:00"), at(D, "08:00"));
      const c = await insertAppt(at(D, "08:00"), at(D, "09:00"));
      const d = await insertAppt(at(D, "09:00"), at(D, "10:00"));
      const X = { startTime: new Date(at(D, "12:00")), endTime: new Date(at(D, "13:00")) };
      const Y = { startTime: new Date(at(D, "14:00")), endTime: new Date(at(D, "15:00")) };

      const gate = () => {
        let open = () => {};
        const p = new Promise<void>((r) => (open = r));
        return { p, open: () => open() };
      };
      const aMoved = gate();
      const bMoved = gate();
      type Tx = Parameters<Parameters<NonNullable<typeof h>["db"]["transaction"]>[0]>[0];
      const move = (tx: Tx, id: string, slot: typeof X) =>
        tx.update(appointments).set(slot).where(eq(appointments.id, id));

      const txA = h!.db.transaction(async (tx) => {
        try {
          await move(tx, a.id, X);
        } finally {
          aMoved.open();
        }
        await bMoved.p;
        await move(tx, c.id, Y); // czeka na B (b w Y, niezatwierdzone)
      });
      const txB = h!.db.transaction(async (tx) => {
        await aMoved.p;
        try {
          await move(tx, b.id, Y);
        } finally {
          bMoved.open();
        }
        await move(tx, d.id, X); // czeka na A (a w X, niezatwierdzone) → zakleszczenie
      });
      const settled = await Promise.allSettled([txA, txB]);

      const rejected = settled.filter((s): s is PromiseRejectedResult => s.status === "rejected");
      expect(rejected, "dokładnie jedna transakcja wycofana").toHaveLength(1);
      expect(settled.filter((s) => s.status === "fulfilled")).toHaveLength(1);
      const err = rejected[0]!.reason;
      let driver = err as { code?: string; where?: string; cause?: unknown };
      while (!driver.code && driver.cause) driver = driver.cause as typeof driver;
      const where = String(driver.where);
      expect(dbErrorCode(err), `kod: ${driver.code}, where: ${where}`).toBe("40P01");
      expect(where, "CONTEXT w polu `where` sterownika").toContain("exclusion constraint");
      expect(where).toContain('relation "appointments"');
      expect(isAppointmentSlotTaken(err), `where: ${where}`).toBe(true);

      // Zwycięska transakcja zatwierdzona w całości: po jednej wizycie w X i Y.
      const day = await activeOnDay(D);
      expect(day.filter((r) => r.startsWith(at(D, "12:00")))).toHaveLength(1);
      expect(day.filter((r) => r.startsWith(at(D, "14:00")))).toHaveLength(1);
      expect(noOverlaps(day)).toBe(true);
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

    it("wyścig w pętli: 40 × dwie wizyty przenoszone równolegle → zero 500, w każdej iteracji jedna 200 i jedna 409", async () => {
      // Źródła: dzień 18, co 20 min (a i b po 10 min); cele: dzień 19, co 15 min.
      const bad = await raceLoop(
        40,
        async (i) => {
          const a = await insertAppt(at(18, hhmm("06:00", i * 20)), at(18, hhmm("06:10", i * 20)));
          const b = await insertAppt(at(18, hhmm("06:10", i * 20)), at(18, hhmm("06:20", i * 20)));
          const target = { startTime: at(19, hhmm("06:00", i * 15)), endTime: at(19, hhmm("06:15", i * 15)) };
          return Promise.all([put(a.id, target), put(b.id, target)]);
        },
        200,
        MSG
      );
      expect(bad, bad.join("\n")).toEqual([]);
      const day = await activeOnDay(19);
      expect(day).toHaveLength(40);
      expect(noOverlaps(day)).toBe(true);
    }, 120_000);
  });

  describe("POST /api/appointments — wyścig w pętli (gość)", () => {
    beforeEach(() => {
      session.ctx = null;
    });

    it("40 × dwie równoległe rezerwacje tego samego terminu → zero 500, w każdej iteracji jedna 201 i jedna 409", async () => {
      const bad = await raceLoop(
        40,
        (i) => {
          const s = at(23, hhmm("06:00", i * 15));
          const e = at(23, hhmm("06:15", i * 15));
          return Promise.all([post(s, e), post(s, e)]);
        },
        201,
        MSG
      );
      expect(bad, bad.join("\n")).toEqual([]);
      const day = await activeOnDay(23);
      expect(day).toHaveLength(40);
      expect(noOverlaps(day)).toBe(true);
    }, 120_000);
  });

  describe("POST /api/deposits/create-session — wyścig (gość, symulacja płatności)", () => {
    const DEP_MSG = "Wybrany termin jest juz zajety. Wybierz inny termin.";
    beforeEach(() => {
      session.ctx = null;
      deposit.override = { ok: true, required: true, amount: 50, serviceName: "IT Usługa 30" };
      vi.stubEnv("ALLOW_PAYMENT_SIMULATION", "1");
      vi.stubEnv("VERCEL", "");
      vi.stubEnv("K_SERVICE", "");
    });
    afterEach(() => {
      deposit.override = null;
      vi.unstubAllEnvs();
    });

    it("10 × dwie równoległe sesje zadatku na ten sam termin → zero 500, w każdej iteracji jedna 201 i jedna 409", async () => {
      const bad = await raceLoop(
        10,
        (i) => {
          const s = at(28, hhmm("06:00", i * 15));
          const e = at(28, hhmm("06:15", i * 15));
          return Promise.all([depositSession(s, e), depositSession(s, e)]);
        },
        201,
        DEP_MSG
      );
      expect(bad, bad.join("\n")).toEqual([]);
      const day = await activeOnDay(28);
      expect(day).toHaveLength(10);
      expect(noOverlaps(day)).toBe(true);
    }, 120_000);
  });

  describe("POST /api/appointments/book-package (właściciel, RLS)", () => {
    // Pakiet: 30 + 45 min od startu, czyli jeden przedział [start, start + 75 min).
    beforeEach(() => {
      session.ctx = owner();
    });

    it("pakiet na styk z istniejącą wizytą → 201, obie wizyty pakietu zapisane", async () => {
      await insertAppt(at(25, "11:15"), at(25, "12:00"));
      const res = await book(at(25, "10:00"));
      expect(res.status, res.body.error).toBe(201);
      expect(await activeOnDay(25)).toEqual([
        `${at(25, "10:00")}–${at(25, "10:30")}`,
        `${at(25, "10:30")}–${at(25, "11:15")}`,
        `${at(25, "11:15")}–${at(25, "12:00")}`,
      ]);
    });

    it("pakiet nachodzący na wizytę → 409, żadna wizyta pakietu nie zapisana", async () => {
      await insertAppt(at(26, "11:00"), at(26, "12:00"));
      const res = await book(at(26, "10:00"));
      expect(res.status).toBe(409);
      expect(res.body.error).toBe(MSG);
      expect(await activeOnDay(26)).toEqual([`${at(26, "11:00")}–${at(26, "12:00")}`]);
    });

    it("wyścig: dwa pakiety równolegle na ten sam termin → jeden 201, drugi 409, bez połowicznego pakietu", async () => {
      const results = await Promise.all([book(at(27, "10:00")), book(at(27, "10:00"))]);
      expect(statuses(results)).toEqual([201, 409]);
      expect(await activeOnDay(27)).toEqual([
        `${at(27, "10:00")}–${at(27, "10:30")}`,
        `${at(27, "10:30")}–${at(27, "11:15")}`,
      ]);
    });

    it("wyścig w pętli: 10 × dwa pakiety równolegle → zero 500, w każdej iteracji jeden 201 i jeden 409", async () => {
      // Pakiet = 75 min; starty co 90 min od 05:00 (ostatni 18:30–19:45).
      const bad = await raceLoop(
        10,
        (i) => {
          const s = at(24, hhmm("05:00", i * 90));
          return Promise.all([book(s), book(s)]);
        },
        201,
        MSG
      );
      expect(bad, bad.join("\n")).toEqual([]);
      const day = await activeOnDay(24);
      expect(day).toHaveLength(20); // 10 pakietów × 2 wizyty, bez połowicznych
      expect(noOverlaps(day)).toBe(true);
    }, 120_000);
  });

  // Rezerwacja z zadatkiem BLIK na telefon salonu: forSalon(salonId z body)
  // pod rolą aplikacji, prawdziwe wyliczenie kwoty. Salon C ma numer BLIK
  // (testowy) i własnego właściciela (`salons_owner_id_uq`); salon A nie ma
  // numeru, dostaje tu usługę z zadatkiem (usuwaną w afterAll). Terminy: dni 7–9 i 17 marca 2099.
  describe("POST /api/deposits/blik-booking (gość, forSalon)", () => {
    const BLIK_PHONE = "+48000600703";
    const SALON_C_PHONE = "+48000600704";
    const BLIK_MSG = "Wybrany termin jest juz zajety. Wybierz inny termin.";
    let salonCId = "";
    let employeeCId = "";
    let serviceCId = "";
    let depositServiceAId = "";

    async function blikBooking(target: { salonId: string; employeeId: string; serviceId: string }, start: string, end: string) {
      const res = await createBlikBooking(
        new Request("http://localhost/api/deposits/blik-booking", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...target,
            startTime: start,
            endTime: end,
            depositAmount: 50,
            guestName: "IT Gość",
            guestPhone: "+48 000 600 700",
          }),
        })
      );
      return {
        status: res.status,
        body: (await res.json()) as {
          success: boolean;
          error?: string;
          code?: string;
          data?: { appointmentId: string; depositAmount: number; blik: { phone: string; recipient: string; title: string } };
        },
      };
    }

    const salonC = () => ({ salonId: salonCId, employeeId: employeeCId, serviceId: serviceCId });

    /** Wszystkie wizyty salonu w dniu (także anulowane). */
    async function salonDay(sid: string, day: number) {
      const { from, to } = dayRange(day);
      return h!.db
        .select({ id: appointments.id, status: appointments.status, depositPaid: appointments.depositPaid, depositAmount: appointments.depositAmount })
        .from(appointments)
        .where(and(eq(appointments.salonId, sid), gte(appointments.startTime, from), lt(appointments.startTime, to)));
    }

    beforeAll(async () => {
      const db = h!.db;
      await db.insert(user).values({ id: OWNER_C_ID, name: "IT T3 ovl C", email: `${OWNER_C_ID}@example.invalid` });
      const [salon] = await db
        .insert(salons)
        .values({
          name: `IT T3 ovl C ${RUN}`,
          ownerId: OWNER_C_ID,
          phone: SALON_C_PHONE,
          settingsJson: { deposits: { blikPhone: BLIK_PHONE, blikConsentAt: "2099-01-01T00:00:00.000Z" } },
        })
        .returning();
      salonCId = salon!.id;
      const [emp] = await db.insert(employees).values({ salonId: salonCId, firstName: "IT", lastName: "Pracownik C" }).returning();
      employeeCId = emp!.id;
      // Zadatek 50% z 100 zł = 50 zł (bez promocji w salonie).
      const [svc] = await db
        .insert(services)
        .values({ salonId: salonCId, name: "IT Usługa zadatek", basePrice: "100.00", baseDuration: 60, depositRequired: true, depositPercentage: 50 })
        .returning();
      serviceCId = svc!.id;
      const [svcA] = await db
        .insert(services)
        .values({ salonId, name: "IT Usługa zadatek A", basePrice: "100.00", baseDuration: 60, depositRequired: true, depositPercentage: 50 })
        .returning();
      depositServiceAId = svcA!.id;
    });

    afterAll(async () => {
      if (depositServiceAId) await h!.db.delete(services).where(eq(services.id, depositServiceAId));
      if (salonCId) await h!.db.delete(salons).where(eq(salons.id, salonCId));
      await h!.db.delete(user).where(eq(user.id, OWNER_C_ID));
    });

    beforeEach(() => {
      session.ctx = null;
    });

    it("salon z numerem i usługą z zadatkiem → 201, wizyta scheduled/false, 0 wierszy deposit_payments", async () => {
      const res = await blikBooking(salonC(), at(7, "10:00"), at(7, "11:00"));
      expect(res.status, res.body.error).toBe(201);
      const data = res.body.data!;
      expect(data.depositAmount).toBe(50);
      expect(data.blik).toEqual({
        phone: BLIK_PHONE,
        recipient: `IT T3 ovl C ${RUN}`,
        title: `Zadatek MH-${data.appointmentId.slice(0, 6).toUpperCase()}`,
      });

      const rows = await salonDay(salonCId, 7);
      expect(rows).toEqual([{ id: data.appointmentId, status: "scheduled", depositPaid: false, depositAmount: "50.00" }]);
      const payments = await h!.db
        .select({ id: depositPayments.id })
        .from(depositPayments)
        .where(eq(depositPayments.appointmentId, data.appointmentId));
      expect(payments).toEqual([]);
    });

    it("druga rezerwacja tego samego terminu → 409, w bazie jedna wizyta", async () => {
      expect((await blikBooking(salonC(), at(8, "10:00"), at(8, "11:00"))).status).toBe(201);
      const second = await blikBooking(salonC(), at(8, "10:30"), at(8, "11:30"));
      expect(second.status).toBe(409);
      expect(second.body.error).toBe(BLIK_MSG);
      expect(JSON.stringify(second.body)).not.toContain(BLIK_PHONE);
      expect(await salonDay(salonCId, 8)).toHaveLength(1);
    });

    it("wyścig: dwie równoległe rezerwacje tego samego terminu → jedna 201, druga 409", async () => {
      const results = await Promise.all([
        blikBooking(salonC(), at(17, "10:00"), at(17, "11:00")),
        blikBooking(salonC(), at(17, "10:00"), at(17, "11:00")),
      ]);
      expect(statuses(results)).toEqual([201, 409]);
      expect(await salonDay(salonCId, 17)).toHaveLength(1);
    });

    it("salon bez numeru BLIK → 409 DEPOSIT_BLIK_NOT_CONFIGURED, 0 nowych wizyt", async () => {
      const res = await blikBooking({ salonId, employeeId, serviceId: depositServiceAId }, at(9, "10:00"), at(9, "11:00"));
      expect(res.status).toBe(409);
      expect(res.body).toEqual({
        success: false,
        code: "DEPOSIT_BLIK_NOT_CONFIGURED",
        error: "Ten salon nie przyjmuje teraz rezerwacji online z zadatkiem.",
      });
      expect(await salonDay(salonId, 9)).toEqual([]);
    });
  });

  // Ręczne oznaczenie zadatku BLIK pod rolą aplikacji (forSalon salonu z sesji).
  // Wizyty salonu A na dniu 31 (różne godziny) i ich płatność usuwane w afterAll
  // bloku. Salon E ma własnego właściciela; jego wizyta znika kaskadą z salonem.
  describe("POST /api/appointments/[id]/deposit (właściciel, forSalon)", () => {
    const OWNER_E_ID = `it-t3-ovl-dep-${RUN}`;
    const D = 31;
    let salonEId = "";
    let employeeEId = "";
    const addedAppointmentIds: string[] = [];

    async function mark(id: string) {
      const res = await markDepositPaid(
        new Request(`http://localhost/api/appointments/${id}/deposit`, { method: "POST" }),
        { params: Promise.resolve({ id }) }
      );
      return { status: res.status, body: (await res.json()) as { success: boolean; code?: string; error?: string } };
    }

    async function depositPaidOf(id: string) {
      const [row] = await h!.db
        .select({ depositPaid: appointments.depositPaid })
        .from(appointments)
        .where(eq(appointments.id, id));
      return row?.depositPaid;
    }

    /** Wizyta BLIK salonu A: scheduled, zadatek 50 zł, nieopłacony. */
    async function blikAppointment(start: string, end: string) {
      const row = await insertAppt(start, end, { depositAmount: "50.00", depositPaid: false });
      addedAppointmentIds.push(row.id);
      return row;
    }

    beforeAll(async () => {
      const db = h!.db;
      await db.insert(user).values({ id: OWNER_E_ID, name: "IT T3 ovl dep", email: `${OWNER_E_ID}@example.invalid` });
      const [salonE] = await db.insert(salons).values({ name: `IT T3 ovl E ${RUN}`, ownerId: OWNER_E_ID }).returning();
      salonEId = salonE!.id;
      const [empE] = await db.insert(employees).values({ salonId: salonEId, firstName: "IT", lastName: "Pracownik E" }).returning();
      employeeEId = empE!.id;
    });

    afterAll(async () => {
      if (!h) return;
      // Płatność znika kaskadą z wizytą; wizyty salonu A usuwamy jawnie.
      for (const id of addedAppointmentIds) {
        await h.db.delete(depositPayments).where(eq(depositPayments.appointmentId, id));
        await h.db.delete(appointments).where(eq(appointments.id, id));
      }
      if (salonEId) await h.db.delete(salons).where(eq(salons.id, salonEId));
      await h.db.delete(user).where(eq(user.id, OWNER_E_ID));
    });

    beforeEach(() => {
      session.ctx = owner();
    });

    it("wizyta BLIK bez płatności → 200, depositPaid=true w bazie", async () => {
      const appt = await blikAppointment(at(D, "08:00"), at(D, "09:00"));
      const res = await mark(appt.id);
      expect(res.status, res.body.error).toBe(200);
      expect(await depositPaidOf(appt.id)).toBe(true);
    });

    it("wizyta z wierszem deposit_payments (failed) → 409 DEPOSIT_ONLINE_PAYMENT, stan bez zmian", async () => {
      const appt = await blikAppointment(at(D, "10:00"), at(D, "11:00"));
      await h!.db
        .insert(depositPayments)
        .values({ appointmentId: appt.id, salonId, amount: "50.00", paymentMethod: "stripe", status: "failed" });
      const res = await mark(appt.id);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("DEPOSIT_ONLINE_PAYMENT");
      expect(await depositPaidOf(appt.id)).toBe(false);
    });

    it("wizyta salonu E przez kontekst salonu A → 404, stan bez zmian", async () => {
      const [foreign] = await h!.db
        .insert(appointments)
        .values({
          salonId: salonEId,
          employeeId: employeeEId,
          startTime: new Date(at(D, "12:00")),
          endTime: new Date(at(D, "13:00")),
          status: "scheduled",
          depositAmount: "50.00",
          depositPaid: false,
        })
        .returning();
      const res = await mark(foreign!.id);
      expect(res.status).toBe(404);
      expect(await depositPaidOf(foreign!.id)).toBe(false);
    });
  });

  // Publiczne wolne terminy przez forSalon(salonId z zapytania), pod rolą
  // aplikacji. Salon B istnieje tylko po to, żeby zapytać o pracownika salonu A
  // w kontekście cudzego salonu. Daty w kwietniu 2099 (testy wyżej: marzec);
  // trasa liczy dzień w czasie lokalnym, więc terminy wizyt też lokalnie (bez Z).
  describe("GET /api/available-slots (publiczne, forSalon)", () => {
    const DATE = "2099-04-15";
    let salonBId = "";

    async function slots(querySalonId: string) {
      const res = await getAvailableSlots(
        new Request(
          `http://localhost/api/available-slots?salonId=${querySalonId}&employeeId=${employeeId}&date=${DATE}&duration=60`
        )
      );
      return {
        status: res.status,
        body: (await res.json()) as {
          success: boolean;
          error?: string;
          data?: { dayOff: boolean; slots: { time: string }[] };
        },
      };
    }

    beforeAll(async () => {
      const db = h!.db;
      // Jeden salon na właściciela (`salons_owner_id_uq`): salon B ma własnego właściciela.
      await db.insert(user).values({ id: OWNER_B_ID, name: "IT T3 ovl B", email: `${OWNER_B_ID}@example.invalid` });
      const [salonB] = await db.insert(salons).values({ name: `IT T3 ovl B ${RUN}`, ownerId: OWNER_B_ID }).returning();
      salonBId = salonB!.id;
      await db.insert(workSchedules).values({
        employeeId,
        dayOfWeek: new Date(`${DATE}T00:00:00`).getDay(),
        startTime: "09:00",
        endTime: "17:00",
      });
      await insertAppt(`${DATE}T10:00:00`, `${DATE}T11:00:00`);
    });

    afterAll(async () => {
      // Grafik i wizyta znikają kaskadą z salonu A w afterAll całego opisu.
      if (salonBId) await h!.db.delete(salons).where(eq(salons.id, salonBId));
      await h!.db.delete(user).where(eq(user.id, OWNER_B_ID));
    });

    it("pracownik salonu A zapytany z salonId = B → 404", async () => {
      const res = await slots(salonBId);
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ success: false, error: "Employee not found" });
    });

    it("salonId = A → 200 ze slotami pod rolą aplikacji (grafik, wizyta)", async () => {
      const res = await slots(salonId);
      expect(res.status, res.body.error).toBe(200);
      expect(res.body.data?.dayOff).toBe(false);
      const times = res.body.data!.slots.map((s) => s.time);
      expect(times).toContain("09:00");
      expect(times).toContain("11:00");
      expect(times).not.toContain("10:00"); // wizyta 10–11 widoczna w kontekście salonu A
      expect(times).not.toContain("10:30");
    });
  });

  // Publiczny katalog salonu pod forSalon(id z URL) (rola aplikacji, RLS
  // salonu): pracownik i usługa salonu A nie są widoczne pod adresem salonu B.
  describe("publiczny katalog salonu: GET salons/[id], usługa, pracownik (rola aplikacji)", () => {
    // Własny właściciel salonu B: salons_owner_id_uq = jeden salon na użytkownika.
    // Prefiks it-t3- zostaje (sprzątanie w pg-harness.ts).
    const OWNER_CATALOG_ID = `it-t3-ovl-cat-${RUN}`;
    let salonBId = "";
    let serviceBId = "";

    beforeAll(async () => {
      const db = h!.db;
      await db.insert(user).values({
        id: OWNER_CATALOG_ID,
        name: "IT T3 ovl cat",
        email: `${OWNER_CATALOG_ID}@example.invalid`,
      });
      const [salonB] = await db
        .insert(salons)
        .values({ name: `IT T3 ovl B ${RUN}`, ownerId: OWNER_CATALOG_ID })
        .returning();
      salonBId = salonB!.id;
      const [svcB] = await db
        .insert(services)
        .values({ salonId: salonBId, name: "IT Usługa B", basePrice: "10.00", baseDuration: 15 })
        .returning();
      serviceBId = svcB!.id;
    });

    afterAll(async () => {
      if (!h) return;
      // Najpierw salon (kaskada usług), potem jego właściciel.
      if (salonBId) await h.db.delete(salons).where(eq(salons.id, salonBId));
      await h.db.delete(user).where(eq(user.id, OWNER_CATALOG_ID));
    });

    const getJson = async (res: Response) => ({ status: res.status, body: (await res.json()) as Record<string, unknown> });
    const employee = (sid: string, eid: string) =>
      getSalonEmployee(new Request(`http://localhost/api/salons/${sid}/employees/${eid}`), {
        params: Promise.resolve({ id: sid, employeeId: eid }),
      }).then(getJson);
    const service = (sid: string, svc: string) =>
      getSalonService(new Request(`http://localhost/api/salons/${sid}/services/${svc}`), {
        params: Promise.resolve({ id: sid, serviceId: svc }),
      }).then(getJson);
    const salon = (sid: string) =>
      getSalon(new Request(`http://localhost/api/salons/${sid}`), { params: Promise.resolve({ id: sid }) }).then(getJson);

    it("pracownik A pod salonem A → 200 (bez phone i email); pod salonem B → 404 jak nieistniejący", async () => {
      const own = await employee(salonId, employeeId);
      expect(own.status, JSON.stringify(own.body)).toBe(200);
      const data = own.body.data as Record<string, unknown>;
      expect(data.id).toBe(employeeId);
      expect(data.salon).toEqual({ id: salonId, name: `IT T3 ovl ${RUN}` });
      expect(data).not.toHaveProperty("phone");
      expect(data).not.toHaveProperty("email");

      const foreign = await employee(salonBId, employeeId);
      const missing = await employee(salonBId, randomUUID());
      expect(foreign.status).toBe(404);
      expect(foreign.body).toEqual(missing.body);
    });

    it("usługa A pod salonem A → 200; pod salonem B → 404", async () => {
      const own = await service(salonId, serviceId);
      expect(own.status, JSON.stringify(own.body)).toBe(200);
      expect((own.body.data as { id: string }).id).toBe(serviceId);
      expect((await service(salonBId, serviceId)).status).toBe(404);
    });

    it("GET salons/{A} → 200 z usługami A, bez usługi B; bez settingsJson i ownerId", async () => {
      const res = await salon(salonId);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const data = res.body.data as { id: string; services: { id: string }[]; employees: { id: string }[] };
      expect(data.id).toBe(salonId);
      expect(data.services.map((s) => s.id).sort()).toEqual([serviceId, service2Id].sort());
      expect(data.services.map((s) => s.id)).not.toContain(serviceBId);
      expect(data.employees.map((e) => e.id).sort()).toEqual([employeeId, employee2Id].sort());
      expect(data).not.toHaveProperty("settingsJson");
      expect(data).not.toHaveProperty("ownerId");

      const b = await salon(salonBId);
      expect(b.status).toBe(200);
      expect((b.body.data as { services: { id: string }[] }).services.map((s) => s.id)).toEqual([serviceBId]);
    });

    it("zły format id → 400 (nie 500 z rzutowania ::uuid)", async () => {
      expect((await salon("not-a-uuid")).status).toBe(400);
      expect((await employee(salonId, "not-a-uuid")).status).toBe(400);
      expect((await service("not-a-uuid", serviceId)).status).toBe(400);
    });
  });

  // Galeria salonu pod forSalon(id z URL) i lista salonów przez funkcję
  // systemową. Salon D ma własnego właściciela, pełne dane katalogu (adres,
  // telefon, branża) i numer BLIK w settingsJson — musi trafić na listę bez
  // settingsJson i ownerId. Zdjęcie salonu A usuwane w afterAll bloku.
  describe("galeria salonu i lista salonów (rola aplikacji / pula systemowa)", () => {
    const OWNER_GALLERY_ID = `it-t3-ovl-gal-${RUN}`;
    const BLIK_PHONE_D = "+48000600705";
    let salonDId = "";
    let photoAId = "";
    let photoDId = "";

    beforeAll(async () => {
      const db = h!.db;
      await db.insert(user).values({
        id: OWNER_GALLERY_ID,
        name: "IT T3 ovl gal",
        email: `${OWNER_GALLERY_ID}@example.invalid`,
      });
      const [salonD] = await db
        .insert(salons)
        .values({
          name: `IT T3 ovl D ${RUN}`,
          ownerId: OWNER_GALLERY_ID,
          phone: "+48000600706",
          address: "Ul. Testowa 4",
          industryType: "spa",
          settingsJson: { deposits: { blikPhone: BLIK_PHONE_D, blikConsentAt: "2099-01-01T00:00:00.000Z" } },
        })
        .returning();
      salonDId = salonD!.id;
      const [photoA] = await db
        .insert(galleryPhotos)
        .values({ salonId, employeeId, description: `IT zdjęcie A ${RUN}` })
        .returning();
      photoAId = photoA!.id;
      const [photoD] = await db
        .insert(galleryPhotos)
        .values({ salonId: salonDId, description: `IT zdjęcie D ${RUN}` })
        .returning();
      photoDId = photoD!.id;
    });

    afterAll(async () => {
      if (!h) return;
      if (photoAId) await h.db.delete(galleryPhotos).where(eq(galleryPhotos.id, photoAId));
      // Salon D kaskadą zabiera swoje zdjęcie, potem jego właściciel.
      if (salonDId) await h.db.delete(salons).where(eq(salons.id, salonDId));
      await h.db.delete(user).where(eq(user.id, OWNER_GALLERY_ID));
    });

    const gallery = async (sid: string, query = "") => {
      const res = await getSalonGallery(new Request(`http://localhost/api/salons/${sid}/gallery${query}`), {
        params: Promise.resolve({ id: sid }),
      });
      return {
        status: res.status,
        body: (await res.json()) as {
          success: boolean;
          data?: { id: string; salonId: string; employeeFirstName: string | null }[];
          filters?: { employees: { id: string }[] };
        },
      };
    };

    it("GET salons/{A}/gallery → zdjęcie A z imieniem pracownika, bez zdjęcia D", async () => {
      const res = await gallery(salonId);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const ids = res.body.data!.map((p) => p.id);
      expect(ids).toContain(photoAId);
      expect(ids).not.toContain(photoDId);
      expect(res.body.data!.every((p) => p.salonId === salonId)).toBe(true);
      expect(res.body.data!.find((p) => p.id === photoAId)!.employeeFirstName).toBe("IT");
      expect(res.body.filters!.employees.map((e) => e.id)).toContain(employeeId);
    });

    it("GET salons/{D}/gallery z employeeId pracownika A → pusta lista", async () => {
      const res = await gallery(salonDId, `?employeeId=${employeeId}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });

    it("zły format id → 400 (nie 500 z rzutowania ::uuid)", async () => {
      expect((await gallery("not-a-uuid")).status).toBe(400);
      expect((await gallery(salonId, "?employeeId=not-a-uuid")).status).toBe(400);
    });

    it("GET /api/salons → 200; salon D na liście bez settingsJson i ownerId", async () => {
      const res = await listSalons();
      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean; data: Record<string, unknown>[]; count: number };
      expect(body.success).toBe(true);
      expect(body.count).toBe(body.data.length);
      const d = body.data.find((s) => s.id === salonDId);
      expect(d).toEqual({
        id: salonDId,
        name: `IT T3 ovl D ${RUN}`,
        phone: "+48000600706",
        email: null,
        address: "Ul. Testowa 4",
        industryType: "spa",
        serviceCount: 0,
        averageRating: null,
        reviewCount: 0,
      });
      for (const s of body.data) {
        expect(s).not.toHaveProperty("settingsJson");
        expect(s).not.toHaveProperty("ownerId");
      }
      expect(JSON.stringify(body)).not.toContain(BLIK_PHONE_D);
    });
  });
});
