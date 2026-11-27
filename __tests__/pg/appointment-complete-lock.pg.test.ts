/**
 * Transakcja zakończenia wizyty na PRAWDZIWYM Postgresie, pod rolą aplikacji:
 * - przeniesienie wizyty na innego pracownika i usługę zatwierdzone, gdy
 *   zakończenie czeka na blokadę wiersza → prowizja nowego pracownika od ceny
 *   nowej usługi (odczyt pod blokadą, nie odczyt sprzed transakcji);
 * - pracownik kończy swoją wizytę, którą w tej chwili przepisano na innego
 *   pracownika → 404, nic nie zapisane;
 * - dwa równoległe zakończenia → dokładnie jedno 200 i jedno 409
 *   `APPOINTMENT_COMPLETED`; jeden zabieg, jedna prowizja;
 * - kontekst salonu po wycofaniu savepointu: alert pierwszego produktu pada
 *   (testowy trigger), alert drugiego zapisuje się PO wycofaniu — trigger
 *   dopisuje do treści rolę, salon z `app.current_salon_id` i liczbę salonów
 *   widocznych pod RLS. Rola aplikacji, salon A i jeden widoczny salon
 *   dowodzą, że kolejne zapytanie w transakcji nadal widzi tylko dane salonu.
 *
 * Kolejność w wyścigach wymusza obserwator: trzyma blokadę wiersza wizyty
 * w swojej transakcji, czeka (`pg_blocking_pids`), aż żądania staną na jego
 * blokadzie, i dopiero wtedy zatwierdza. Bez uśpień na czas.
 *
 * Trasa wołana bezpośrednio; atrapa sesji (`auth.api.getSession`), nagłówków
 * i loggera. `@/lib/db` wskazuje bazę testową, kontekst salonu i `forSalon`
 * prawdziwe.
 *
 * Dane: konta `it-t3-lock-…` (właściciel A, pracownik A), salony A i B,
 * dwóch pracowników, usługi, wizyty w 2098. Salony usuwane w `afterAll` (kaskada).
 */
import { randomUUID } from "node:crypto";
import { and, eq, inArray, like, or, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as completeRoute from "@/app/api/appointments/[id]/complete/route";
import { APPOINTMENT_COMPLETED_CODE, COMPLETE_ERROR_CODES } from "@/lib/appointment-completion";
import {
  appointmentMaterials,
  appointments,
  employeeCommissions,
  employeeServicePrices,
  employees,
  notifications,
  products,
  serviceProducts,
  services,
  salons,
  treatmentHistory,
  user,
} from "@/lib/schema";
import { createMockRequest, createRouteParams, parseResponse } from "../api/helpers";

const h = await vi.hoisted(async () => (await import("./pg-harness")).createIntegrationDb());
const ctl = vi.hoisted(() => ({ userId: "" }));
const mocks = vi.hoisted(() => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
}));

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
vi.mock("@/lib/logger", () => ({
  logger: { error: mocks.error, info: mocks.info, warn: mocks.warn, debug: vi.fn() },
}));

const suite = h ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const RUN_ID = RUN.replace(/[^0-9a-f]/g, "");
const OWNER_A = `it-t3-lock-a-${RUN}`;
const OWNER_B = `it-t3-lock-b-${RUN}`;
const EMP_USER = `it-t3-lock-e-${RUN}`;
/** Rola aplikacji, na którą `forSalon` przełącza transakcję. */
const APP_ROLE = process.env.MYHELPER_APP_DB_ROLE ?? "myhelper_app";
if (!/^[a-z_][a-z0-9_]*$/.test(APP_ROLE)) throw new Error("nieoczekiwana nazwa roli aplikacji");

const ids = {
  salonA: "",
  salonB: "",
  empA: "",
  empB: "",
  serviceA: "",
  serviceB: "",
  serviceStock: "",
  product1: "",
  product2: "",
};
/** Testowy trigger alertu i licznik (nazwy z przebiegu). */
const STOCK_FN = `it_t3_lock_stock_${RUN_ID}`;
const STOCK_TRIGGER = `${STOCK_FN}_trg`;
const STOCK_SEQ = `${STOCK_FN}_seq`;
/** SQLSTATE triggera — potwierdza, że padł właśnie pierwszy alert. */
const STOCK_FAIL_CODE = "XT203";
let slot = 0;

/** DDL w krótkiej transakcji z `lock_timeout`: bez czekania w nieskończoność na blokadę tabeli. */
async function ddl(statements: string[]) {
  await h!.db.transaction(async (tx) => {
    await tx.execute(sql.raw("set local lock_timeout = '5s'"));
    for (const s of statements) await tx.execute(sql.raw(s));
  });
}

/** Wizyta salonu A (rola migracji), pracownik A i usługa A; każda w osobnym terminie. */
async function appointment(values: Partial<typeof appointments.$inferInsert> = {}): Promise<string> {
  const start = new Date(Date.UTC(2098, 4, 1, 8) + slot++ * 3_600_000);
  const [a] = await h!.db
    .insert(appointments)
    .values({
      salonId: ids.salonA,
      employeeId: ids.empA,
      serviceId: ids.serviceA,
      startTime: start,
      endTime: new Date(start.getTime() + 1_800_000),
      status: "scheduled",
      ...values,
    })
    .returning({ id: appointments.id });
  return a!.id;
}

const complete = (id: string, body: Record<string, unknown> = {}) =>
  completeRoute.POST(
    createMockRequest(`http://localhost/api/appointments/${id}/complete`, { method: "POST", body }),
    createRouteParams(id)
  );

type Body = { success: boolean; code?: string; error?: string; data?: Record<string, unknown> };

/** Czeka, aż `count` połączeń czeka na blokadę trzymaną przez `pid`. */
async function waitForBlockedBy(pid: number, count: number, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const [row] = await h!.observer<{ n: number }[]>`
      select count(*)::int as n
      from pg_stat_activity
      where ${pid}::int = any(pg_blocking_pids(pid))
    `;
    if ((row?.n ?? 0) >= count) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`bariera: mniej niż ${count} połączeń czeka na blokadę po ${timeoutMs} ms`);
}

/**
 * Obserwator blokuje wiersz wizyty, uruchamia `start`, czeka, aż `blocked`
 * połączeń stanie na jego blokadzie, wykonuje `whileLocked` w tej samej
 * transakcji i zatwierdza. Zwraca wynik `start`.
 */
async function underRowLock<T>(
  appt: string,
  blocked: number,
  start: () => Promise<T>,
  whileLocked: (tx: { unsafe: (q: string, p: unknown[]) => Promise<unknown> }) => Promise<void> = async () => {}
): Promise<T> {
  const box: { pending?: Promise<T> } = {};
  await h!.observer.begin(async (tx) => {
    await tx.unsafe("set local lock_timeout = '15s'");
    await tx.unsafe("select id from appointments where id = $1 for update", [appt]);
    const [me] = (await tx.unsafe("select pg_backend_pid() as pid")) as unknown as { pid: number }[];
    const pending = start();
    box.pending = pending;
    // Błąd żądania przed barierą nie może zostać nieobsłużoną obietnicą.
    pending.catch(() => {});
    await waitForBlockedBy(me!.pid, blocked);
    await whileLocked(tx as never);
  });
  if (!box.pending) throw new Error("żądanie nie wystartowało");
  return box.pending;
}

async function commissionsOf(appt: string) {
  return h!.db
    .select({
      employeeId: employeeCommissions.employeeId,
      amount: employeeCommissions.amount,
      percentage: employeeCommissions.percentage,
    })
    .from(employeeCommissions)
    .where(eq(employeeCommissions.appointmentId, appt));
}

async function statusOf(appt: string) {
  const [a] = await h!.db
    .select({ status: appointments.status })
    .from(appointments)
    .where(eq(appointments.id, appt));
  return a!.status;
}

suite("zakończenie wizyty — odczyt pod blokadą wiersza i kontekst po savepoincie, prawdziwy Postgres", () => {
  beforeAll(async () => {
    const db = h!.db;
    await db.insert(user).values([
      { id: OWNER_A, name: "IT lock A", email: `${OWNER_A}@example.invalid` },
      { id: OWNER_B, name: "IT lock B", email: `${OWNER_B}@example.invalid` },
      { id: EMP_USER, name: "IT lock pracownik", email: `${EMP_USER}@example.invalid` },
    ]);
    const [a] = await db
      .insert(salons)
      .values({ name: `IT lock A ${RUN}`, ownerId: OWNER_A })
      .returning({ id: salons.id });
    ids.salonA = a!.id;
    // Drugi salon: pod RLS salon A nie może go widzieć (licznik w triggerze).
    const [b] = await db
      .insert(salons)
      .values({ name: `IT lock B ${RUN}`, ownerId: OWNER_B })
      .returning({ id: salons.id });
    ids.salonB = b!.id;

    const [ea] = await db
      .insert(employees)
      .values({
        salonId: ids.salonA,
        userId: EMP_USER,
        role: "employee",
        firstName: "IT",
        lastName: "Pracownik A",
        commissionRate: "40",
      })
      .returning({ id: employees.id });
    ids.empA = ea!.id;
    const [eb] = await db
      .insert(employees)
      .values({ salonId: ids.salonA, firstName: "IT", lastName: "Pracownik B", commissionRate: "10" })
      .returning({ id: employees.id });
    ids.empB = eb!.id;

    const [sa] = await db
      .insert(services)
      .values({ salonId: ids.salonA, name: "IT lock usługa A", basePrice: "150.00", baseDuration: 30 })
      .returning({ id: services.id });
    ids.serviceA = sa!.id;
    const [sb] = await db
      .insert(services)
      .values({ salonId: ids.salonA, name: "IT lock usługa B", basePrice: "300.00", baseDuration: 30 })
      .returning({ id: services.id });
    ids.serviceB = sb!.id;
    // Cena pracownika B za usługę B: prowizja nowego pracownika liczy się od niej.
    await db.insert(employeeServicePrices).values({ employeeId: ids.empB, serviceId: ids.serviceB, customPrice: "280.00" });

    // Usługa z dwoma produktami poniżej minimum po odjęciu (5 − 1 = 4 < 10).
    const [ss] = await db
      .insert(services)
      .values({ salonId: ids.salonA, name: "IT lock usługa z produktami", basePrice: "100.00", baseDuration: 30 })
      .returning({ id: services.id });
    ids.serviceStock = ss!.id;
    const [p1] = await db
      .insert(products)
      .values({ salonId: ids.salonA, name: "IT lock farba 1", quantity: "5", minQuantity: "10", unit: "ml" })
      .returning({ id: products.id });
    const [p2] = await db
      .insert(products)
      .values({ salonId: ids.salonA, name: "IT lock farba 2", quantity: "5", minQuantity: "10", unit: "ml" })
      .returning({ id: products.id });
    ids.product1 = p1!.id;
    ids.product2 = p2!.id;
    for (const id of [ids.product1, ids.product2]) {
      if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error("nieoczekiwany format id produktu");
    }
    await db.insert(serviceProducts).values([
      { serviceId: ids.serviceStock, productId: ids.product1, defaultQuantity: "1" },
      { serviceId: ids.serviceStock, productId: ids.product2, defaultQuantity: "1" },
    ]);

    // Testowy trigger (rola migracji) na powiadomieniach o tych dwóch produktach:
    // pierwsze w ogóle (licznik — sekwencji nie cofa ROLLBACK TO SAVEPOINT) kończy
    // się błędem, każde następne dostaje w treści rolę, salon z kontekstu i liczbę
    // salonów widocznych dla bieżącej roli. Funkcja bez SECURITY DEFINER, więc
    // działa jako rola wołającego, z jej RLS.
    const productMatch =
      `(new.message like '%[product:${ids.product1}]%' or new.message like '%[product:${ids.product2}]%')`;
    await ddl([
      `create sequence ${STOCK_SEQ}`,
      `grant usage on sequence ${STOCK_SEQ} to ${APP_ROLE}`,
      `create function ${STOCK_FN}() returns trigger language plpgsql as $fn$
       begin
         if new.type = 'system' and ${productMatch} then
           if nextval('${STOCK_SEQ}') = 1 then
             raise exception 'it-t3 lock: wymuszony błąd pierwszego alertu' using errcode = '${STOCK_FAIL_CODE}';
           end if;
           new.message := new.message || ' [ctx:' || current_user || ':' ||
             coalesce(current_setting('app.current_salon_id', true), '-') || ':' ||
             (select count(*) from public.salons)::text || ']';
         end if;
         return new;
       end
       $fn$`,
      `create trigger ${STOCK_TRIGGER} before insert on public.notifications ` +
        `for each row execute function ${STOCK_FN}()`,
    ]);
  });

  afterAll(async () => {
    if (!h) return;
    try {
      // Sprzątanie triggera osobno: jego błąd nie może zostawić danych testu.
      try {
        await ddl([
          `drop trigger if exists ${STOCK_TRIGGER} on public.notifications`,
          `drop function if exists ${STOCK_FN}()`,
          `drop sequence if exists ${STOCK_SEQ}`,
        ]);
      } catch (e) {
        mocks.warn("stock trigger cleanup failed", e);
      }
      const salonIds = [ids.salonA, ids.salonB].filter(Boolean);
      if (salonIds.length > 0) await h.db.delete(salons).where(inArray(salons.id, salonIds));
      await h.db.delete(user).where(inArray(user.id, [OWNER_A, OWNER_B, EMP_USER]));
    } finally {
      await h.end();
    }
  });

  beforeEach(() => {
    ctl.userId = OWNER_A;
    mocks.error.mockClear();
    mocks.warn.mockClear();
    mocks.info.mockClear();
  });

  it(
    "przeniesienie zatwierdzone, gdy zakończenie czeka na blokadę → prowizja nowego pracownika od ceny nowej usługi",
    async () => {
      const appt = await appointment();

      const res = await underRowLock(
        appt,
        1,
        async () => parseResponse<Body>(await complete(appt)),
        async (tx) => {
          await tx.unsafe("update appointments set employee_id = $1, service_id = $2 where id = $3", [
            ids.empB,
            ids.serviceB,
            appt,
          ]);
        }
      );

      expect(res.status, JSON.stringify(res.body)).toBe(200);
      // Pracownik B, stawka B (10%), cena pracownika B za usługę B (280) — nie 40% od 150.
      expect(await commissionsOf(appt)).toEqual([{ employeeId: ids.empB, amount: "28.00", percentage: "10.00" }]);
      expect(await statusOf(appt)).toBe("completed");
      expect((res.body.data?.appointment as { employeeId?: string })?.employeeId).toBe(ids.empB);
    },
    30_000
  );

  it(
    "pracownik kończy swoją wizytę przepisaną w tej chwili na innego → 404 z kodem, nic nie zapisane",
    async () => {
      ctl.userId = EMP_USER;
      const appt = await appointment();

      const res = await underRowLock(
        appt,
        1,
        async () => parseResponse<Body>(await complete(appt, { paidAmount: "150", paymentMethod: "cash" })),
        async (tx) => {
          await tx.unsafe("update appointments set employee_id = $1 where id = $2", [ids.empB, appt]);
        }
      );

      expect(res.status, JSON.stringify(res.body)).toBe(404);
      expect(res.body.code).toBe(COMPLETE_ERROR_CODES.appointmentNotFound);
      const [row] = await h!.db
        .select({ status: appointments.status, paidAmount: appointments.paidAmount })
        .from(appointments)
        .where(eq(appointments.id, appt));
      expect(row).toEqual({ status: "scheduled", paidAmount: null });
      expect(await h!.db.select().from(treatmentHistory).where(eq(treatmentHistory.appointmentId, appt))).toHaveLength(0);
      expect(await commissionsOf(appt)).toHaveLength(0);
    },
    30_000
  );

  it(
    "kontrola: pracownik kończy swoją wizytę bez przeniesienia → 200, prowizja pracownika A",
    async () => {
      ctl.userId = EMP_USER;
      const appt = await appointment();

      const res = await parseResponse<Body>(await complete(appt));

      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(await commissionsOf(appt)).toEqual([{ employeeId: ids.empA, amount: "60.00", percentage: "40.00" }]);
    },
    30_000
  );

  it(
    "dwa równoległe zakończenia na dwóch połączeniach → jedno 200 i jedno 409 APPOINTMENT_COMPLETED; jeden zabieg, jedna prowizja",
    async () => {
      const appt = await appointment();

      const results = await underRowLock(appt, 2, () =>
        Promise.all([
          complete(appt, { paidAmount: "150", paymentMethod: "cash" }).then((r) => parseResponse<Body>(r)),
          complete(appt, { paidAmount: "150", paymentMethod: "card" }).then((r) => parseResponse<Body>(r)),
        ])
      );

      const statuses = results.map((r) => r.status).sort();
      expect(statuses, JSON.stringify(results.map((r) => r.body))).toEqual([200, 409]);
      const conflict = results.find((r) => r.status === 409)!;
      expect(conflict.body.code).toBe(APPOINTMENT_COMPLETED_CODE);
      expect(await statusOf(appt)).toBe("completed");
      expect(await h!.db.select().from(treatmentHistory).where(eq(treatmentHistory.appointmentId, appt))).toHaveLength(1);
      expect(await commissionsOf(appt)).toEqual([{ employeeId: ids.empA, amount: "60.00", percentage: "40.00" }]);
      expect(mocks.error).not.toHaveBeenCalledWith("Failed to complete appointment", expect.anything());
    },
    30_000
  );

  it(
    "po wycofaniu savepointu pierwszego alertu drugi zapisuje się pod rolą aplikacji, w kontekście salonu A, z jednym widocznym salonem",
    async () => {
      const appt = await appointment({ serviceId: ids.serviceStock });

      const res = await parseResponse<Body>(await complete(appt, { commissionPercentage: 0 }));

      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const deductions = res.body.data?.stockDeductions as Array<{
        productId: string;
        newQuantity: number;
        lowStockAlert: { notificationSent: boolean } | null;
      }>;
      expect(deductions).toHaveLength(2);
      // Jeden alert wycofany (null), drugi zapisany — kolejność produktów dowolna.
      const failed = deductions.filter((d) => d.lowStockAlert === null);
      const sent = deductions.filter((d) => d.lowStockAlert?.notificationSent === true);
      expect(failed).toHaveLength(1);
      expect(sent).toHaveLength(1);

      const alerts = await h!.db
        .select({ message: notifications.message })
        .from(notifications)
        .where(
          and(
            eq(notifications.salonId, ids.salonA),
            or(
              like(notifications.message, `%[product:${ids.product1}]%`),
              like(notifications.message, `%[product:${ids.product2}]%`)
            )
          )
        );
      expect(alerts).toHaveLength(1);
      expect(alerts[0]!.message).toContain(`[product:${sent[0]!.productId}]`);
      // Rola aplikacji (nie rola migracji), salon A z kontekstu, pod RLS widać tylko salon A.
      expect(alerts[0]!.message).toContain(`[ctx:${APP_ROLE}:${ids.salonA}:1]`);

      // Oba produkty odjęte, oba wiersze zużycia — zakończenie zatwierdzone.
      const stock = await h!.db
        .select({ quantity: products.quantity })
        .from(products)
        .where(inArray(products.id, [ids.product1, ids.product2]));
      expect(stock.map((p) => p.quantity)).toEqual(["4.00", "4.00"]);
      const materials = await h!.db
        .select({ productId: appointmentMaterials.productId })
        .from(appointmentMaterials)
        .where(eq(appointmentMaterials.appointmentId, appt));
      expect(materials).toHaveLength(2);
      expect(await statusOf(appt)).toBe("completed");

      // Pierwszy alert padł w triggerze; log tylko z nazwą i kodem błędu.
      expect(mocks.error).toHaveBeenCalledTimes(1);
      expect(mocks.error).toHaveBeenCalledWith("Low stock check failed (non-blocking)", {
        errorName: expect.any(String),
        errorCode: STOCK_FAIL_CODE,
      });
      // Log wysłanego alertu po zatwierdzeniu, tylko z id wizyty i produktu.
      expect(mocks.info).toHaveBeenCalledWith("Low stock alert notification sent", {
        appointmentId: appt,
        productId: sent[0]!.productId,
      });
    },
    30_000
  );
});
