/**
 * Jedna droga zamknięcia wizyty i „najlepszy wysiłek” w trasie zakończenia —
 * na PRAWDZIWYM Postgresie, pod rolą aplikacji:
 * - błąd bazy w bloku punktów lojalnościowych (testowy trigger na INSERT karty
 *   punktów klienta) → 200; status, kwota i metoda płatności oraz zabieg są w bazie,
 *   karty punktów nie ma. Bez zagnieżdżonej transakcji (savepoint) Postgres
 *   przerwałby całą transakcję, COMMIT by ją wycofał, a trasa oddałaby 200
 *   z płatnością, której nie ma. Log błędu bez treści zapytania, log zakończenia
 *   po zatwierdzeniu;
 * - błąd bazy w bloku alertu niskiego stanu (testowy trigger na INSERT
 *   powiadomienia o testowym produkcie) → 200; zakończenie, płatność, odjęty
 *   stan produktu i wiersz zużycia materiału są w bazie, powiadomienia brak;
 * - PUT zmieniający status wizyty zakończonej → 409, DELETE (anulowanie) → 409;
 *   wiersz bez zmian (status, płatność, `updated_at`);
 * - PUT zmieniający termin wizyty zakończonej → 409, wiersz bez zmian; cały
 *   obiekt z niezmienionymi polami i nową notatką → 200, zapisana tylko notatka;
 * - `cancelAppointmentInTx` (ścieżka DELETE po blokadzie wiersza) na wizycie
 *   zakończonej z płatnością zadatku `pending` → `AppointmentCompletedError`;
 *   płatność nadal `pending`, wiersz wizyty bez zmian (krok `pending → failed`
 *   wycofany razem z transakcją);
 * - PUT ze statusem `completed` → 400 z polskim komunikatem, wiersz bez zmian.
 *
 * Moduł lojalności jest zamrożony w rejestrze (`hardOff`) — `resolveModules`
 * w atrapie zwraca `loyalty: true`, żeby trasa doszła do zapisu punktów.
 *
 * Trasy wołane bezpośrednio; atrapa sesji (`auth.api.getSession`), nagłówków,
 * loggera, zwrotu zadatku i listy oczekujących. `@/lib/db` wskazuje bazę testową,
 * kontekst salonu i `forSalon` prawdziwe.
 *
 * Dane: konto `it-t3-best-…` (właściciel A), salon A z programem punktów,
 * pracownik, usługa, klient, wizyty w 2096. Salon usuwany w `afterAll` (kaskada).
 */
import { randomUUID } from "node:crypto";
import { and, eq, inArray, like, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as completeRoute from "@/app/api/appointments/[id]/complete/route";
import * as appointmentRoute from "@/app/api/appointments/[id]/route";
import {
  APPOINTMENT_COMPLETED_CODE,
  AppointmentCompletedError,
  COMPLETE_DEDICATED_ROUTE_CODE,
} from "@/lib/appointment-completion";
import { cancelAppointmentInTx } from "@/lib/salon-cancellation";
import {
  appointmentMaterials,
  appointments,
  clients,
  depositPayments,
  employees,
  loyaltyPoints,
  notifications,
  products,
  serviceProducts,
  services,
  salons,
  treatmentHistory,
  user,
} from "@/lib/schema";
import { forSalon } from "@/lib/server/repository";
import { createMockRequest, createRouteParams, parseResponse } from "../api/helpers";

const h = await vi.hoisted(async () => (await import("./pg-harness")).createIntegrationDb());
const ctl = vi.hoisted(() => ({ userId: "" }));
const mocks = vi.hoisted(() => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  refund: vi.fn(),
  notifyWaitingList: vi.fn(),
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
vi.mock("@/lib/refund", () => ({
  refundAppointmentDeposits: (...args: unknown[]) => mocks.refund(...args),
}));
vi.mock("@/lib/waiting-list", () => ({
  notifyWaitingList: (...args: unknown[]) => mocks.notifyWaitingList(...args),
}));
vi.mock("@/lib/features", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/features")>();
  return {
    ...actual,
    resolveModules: (settingsJson: unknown) => ({ ...actual.resolveModules(settingsJson), loyalty: true }),
  };
});

const suite = h ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const OWNER_A = `it-t3-best-a-${RUN}`;
const ids = { salonA: "", empA: "", serviceA: "", clientA: "", serviceStock: "", productStock: "" };
/** Testowy trigger (nazwy z przebiegu, żeby nie kolidować z innym uruchomieniem). */
const LOYALTY_FN = `it_t3_best_fail_${RUN.replace(/[^0-9a-f]/g, "")}`;
const LOYALTY_TRIGGER = `${LOYALTY_FN}_trg`;
/** SQLSTATE triggera — potwierdza, że błąd padł właśnie w bloku punktów. */
const LOYALTY_FAIL_CODE = "XT201";
/** Trigger na powiadomieniu o niskim stanie testowego produktu. */
const STOCK_FN = `it_t3_best_stock_${RUN.replace(/[^0-9a-f]/g, "")}`;
const STOCK_TRIGGER = `${STOCK_FN}_trg`;
/** SQLSTATE triggera — potwierdza, że błąd padł właśnie w bloku alertu. */
const STOCK_FAIL_CODE = "XT202";
let slot = 0;

/** DDL w krótkiej transakcji z `lock_timeout`: bez czekania w nieskończoność na blokadę tabeli. */
async function ddl(statements: string[]) {
  await h!.db.transaction(async (tx) => {
    await tx.execute(sql.raw("set local lock_timeout = '5s'"));
    for (const s of statements) await tx.execute(sql.raw(s));
  });
}

/** Wizyta salonu A (rola migracji); każda w osobnym terminie. */
async function appointment(values: Partial<typeof appointments.$inferInsert> = {}): Promise<string> {
  const start = new Date(Date.UTC(2096, 2, 1, 8) + slot++ * 3_600_000);
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

async function rowOf(appt: string) {
  const [a] = await h!.db
    .select({
      status: appointments.status,
      paidAmount: appointments.paidAmount,
      paymentMethod: appointments.paymentMethod,
      updatedAt: appointments.updatedAt,
    })
    .from(appointments)
    .where(eq(appointments.id, appt));
  return a!;
}

/** Kwota i metoda płatności są wymagane przy zakończeniu wizyty; body może je nadpisać. */
const complete = (id: string, body: Record<string, unknown> = {}) =>
  completeRoute.POST(
    createMockRequest(`http://localhost/api/appointments/${id}/complete`, {
      method: "POST",
      body: { paidAmount: "100.00", paymentMethod: "cash", ...body },
    }),
    createRouteParams(id)
  );

const put = (id: string, body: Record<string, unknown>) =>
  appointmentRoute.PUT(
    createMockRequest(`http://localhost/api/appointments/${id}`, { method: "PUT", body }),
    createRouteParams(id)
  );

const del = (id: string) =>
  appointmentRoute.DELETE(
    new Request(`http://localhost/api/appointments/${id}`, { method: "DELETE" }),
    createRouteParams(id)
  );

type Body = { success: boolean; code?: string; error?: string; data?: Record<string, unknown> };

suite("zamknięcie wizyty — savepointy i jedna droga statusu, prawdziwy Postgres", () => {
  beforeAll(async () => {
    const db = h!.db;
    await db.insert(user).values([{ id: OWNER_A, name: "IT best A", email: `${OWNER_A}@example.invalid` }]);
    const [a] = await db
      .insert(salons)
      .values({
        name: `IT best A ${RUN}`,
        ownerId: OWNER_A,
        settingsJson: { loyalty: { enabled: true, pointsPerCurrencyUnit: 1, currencyUnit: 1 } },
      })
      .returning({ id: salons.id });
    ids.salonA = a!.id;
    const [e] = await db
      .insert(employees)
      .values({ salonId: ids.salonA, firstName: "IT", lastName: "Pracownik", commissionRate: "40" })
      .returning({ id: employees.id });
    ids.empA = e!.id;
    const [s] = await db
      .insert(services)
      .values({ salonId: ids.salonA, name: "IT best usługa", basePrice: "150.00", baseDuration: 30 })
      .returning({ id: services.id });
    ids.serviceA = s!.id;
    const [c] = await db
      .insert(clients)
      .values({ salonId: ids.salonA, firstName: "IT", lastName: "Klientka" })
      .returning({ id: clients.id });
    ids.clientA = c!.id;
    if (!/^[0-9a-f-]{36}$/.test(ids.clientA)) throw new Error("nieoczekiwany format id klienta");

    // Testowy trigger (rola migracji): INSERT karty punktów tego klienta kończy się
    // błędem bazy. Inni klienci, także z równoległych testów, nie są dotknięci.
    await ddl([
      `create function ${LOYALTY_FN}() returns trigger language plpgsql as $fn$
       begin
         if new.client_id = '${ids.clientA}'::uuid then
           raise exception 'it-t3 best: wymuszony błąd punktów' using errcode = '${LOYALTY_FAIL_CODE}';
         end if;
         return new;
       end
       $fn$`,
      `create trigger ${LOYALTY_TRIGGER} before insert on public.loyalty_points ` +
        `for each row execute function ${LOYALTY_FN}()`,
    ]);

    // Osobna usługa z produktem poniżej minimum: zakończenie odejmuje stan
    // i próbuje zapisać alert. Inne testy pliku używają usługi bez produktów.
    const [ss] = await db
      .insert(services)
      .values({ salonId: ids.salonA, name: "IT best usługa z produktem", basePrice: "100.00", baseDuration: 30 })
      .returning({ id: services.id });
    ids.serviceStock = ss!.id;
    const [p] = await db
      .insert(products)
      .values({ salonId: ids.salonA, name: "IT best farba", quantity: "5", minQuantity: "10", unit: "ml" })
      .returning({ id: products.id });
    ids.productStock = p!.id;
    if (!/^[0-9a-f-]{36}$/.test(ids.productStock)) throw new Error("nieoczekiwany format id produktu");
    await db.insert(serviceProducts).values({ serviceId: ids.serviceStock, productId: ids.productStock, defaultQuantity: "2" });

    // Testowy trigger: INSERT powiadomienia systemowego o tym produkcie kończy się
    // błędem bazy. Powiadomienia o innych produktach nie są dotknięte.
    await ddl([
      `create function ${STOCK_FN}() returns trigger language plpgsql as $fn$
       begin
         if new.type = 'system' and new.message like '%[product:${ids.productStock}]%' then
           raise exception 'it-t3 best: wymuszony błąd alertu' using errcode = '${STOCK_FAIL_CODE}';
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
          `drop trigger if exists ${LOYALTY_TRIGGER} on public.loyalty_points`,
          `drop function if exists ${LOYALTY_FN}()`,
        ]);
      } catch (e) {
        mocks.warn("trigger cleanup failed", e);
      }
      try {
        await ddl([
          `drop trigger if exists ${STOCK_TRIGGER} on public.notifications`,
          `drop function if exists ${STOCK_FN}()`,
        ]);
      } catch (e) {
        mocks.warn("stock trigger cleanup failed", e);
      }
      if (ids.salonA) await h.db.delete(salons).where(eq(salons.id, ids.salonA));
      await h.db.delete(user).where(inArray(user.id, [OWNER_A]));
    } finally {
      await h.end();
    }
  });

  beforeEach(() => {
    ctl.userId = OWNER_A;
    mocks.error.mockClear();
    mocks.warn.mockClear();
    mocks.info.mockClear();
    mocks.refund.mockClear();
    mocks.notifyWaitingList.mockClear();
  });

  it("błąd bazy w bloku punktów → 200; status, płatność i zabieg w bazie, karty punktów brak", async () => {
    const appt = await appointment({ clientId: ids.clientA });

    const res = await parseResponse<Body>(
      await complete(appt, { paidAmount: "150", paymentMethod: "cash", notes: "it-best punkty" })
    );

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data?.loyalty).toBeNull();
    expect(res.body.data?.payment).toEqual({ paidAmount: "150.00", paymentMethod: "cash" });
    // Zatwierdzone w bazie — nie tylko w odpowiedzi.
    expect(await rowOf(appt)).toMatchObject({ status: "completed", paidAmount: "150.00", paymentMethod: "cash" });
    expect(await h!.db.select().from(treatmentHistory).where(eq(treatmentHistory.appointmentId, appt))).toHaveLength(1);
    expect(await h!.db.select().from(loyaltyPoints).where(eq(loyaltyPoints.clientId, ids.clientA))).toHaveLength(0);
    // Błąd padł w bloku punktów (kod triggera), log bez treści zapytania.
    expect(mocks.error).toHaveBeenCalledWith("Loyalty points error (non-blocking)", {
      errorName: expect.any(String),
      errorCode: LOYALTY_FAIL_CODE,
    });
    expect(JSON.stringify(mocks.error.mock.calls)).not.toContain("insert into");
    expect(mocks.error).not.toHaveBeenCalledWith("Failed to complete appointment", expect.anything());
    expect(mocks.info).toHaveBeenCalledWith("Appointment marked as completed", { appointmentId: appt });
  });

  it("błąd bazy w bloku alertu niskiego stanu → 200; zakończenie, płatność, stan produktu i zużycie w bazie", async () => {
    const appt = await appointment({ serviceId: ids.serviceStock });

    const res = await parseResponse<Body>(
      await complete(appt, { paidAmount: "100", paymentMethod: "card", commissionPercentage: 0 })
    );

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const deductions = res.body.data?.stockDeductions as Array<Record<string, unknown>>;
    expect(deductions).toHaveLength(1);
    expect(deductions[0]).toMatchObject({ productId: ids.productStock, newQuantity: 3, lowStockAlert: null });
    // Zatwierdzone w bazie — nie tylko w odpowiedzi.
    expect(await rowOf(appt)).toMatchObject({ status: "completed", paidAmount: "100.00", paymentMethod: "card" });
    const [product] = await h!.db
      .select({ quantity: products.quantity })
      .from(products)
      .where(eq(products.id, ids.productStock));
    expect(product!.quantity).toBe("3.00");
    const materials = await h!.db
      .select({ productId: appointmentMaterials.productId, quantityUsed: appointmentMaterials.quantityUsed })
      .from(appointmentMaterials)
      .where(eq(appointmentMaterials.appointmentId, appt));
    expect(materials).toEqual([{ productId: ids.productStock, quantityUsed: "2.00" }]);
    // Powiadomienie wycofane razem z savepointem.
    const alerts = await h!.db
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.salonId, ids.salonA),
          like(notifications.message, `%[product:${ids.productStock}]%`)
        )
      );
    expect(alerts).toHaveLength(0);
    // Błąd padł w bloku alertu (kod triggera), log bez treści zapytania.
    expect(mocks.error).toHaveBeenCalledWith("Low stock check failed (non-blocking)", {
      errorName: expect.any(String),
      errorCode: STOCK_FAIL_CODE,
    });
    expect(JSON.stringify(mocks.error.mock.calls)).not.toContain("insert into");
    expect(mocks.error).not.toHaveBeenCalledWith("Failed to complete appointment", expect.anything());
    expect(mocks.info).toHaveBeenCalledWith("Appointment marked as completed", { appointmentId: appt });
  });

  it("cancelAppointmentInTx na wizycie zakończonej z płatnością pending → AppointmentCompletedError, nic nie zmienione", async () => {
    const appt = await appointment({ status: "completed", paidAmount: "80.00", paymentMethod: "card", depositAmount: "20.00" });
    const [payment] = await h!.db
      .insert(depositPayments)
      .values({ salonId: ids.salonA, appointmentId: appt, amount: "20.00", paymentMethod: "blik", status: "pending" })
      .returning({ id: depositPayments.id });
    const before = await rowOf(appt);

    await expect(
      forSalon(ids.salonA).raw((tx) =>
        cancelAppointmentInTx(tx, ids.salonA, appt, { role: "owner", employeeId: null })
      )
    ).rejects.toBeInstanceOf(AppointmentCompletedError);

    expect(await rowOf(appt)).toEqual(before);
    const [after] = await h!.db
      .select({ status: depositPayments.status })
      .from(depositPayments)
      .where(eq(depositPayments.id, payment!.id));
    expect(after!.status).toBe("pending");
  });

  it("DELETE trasą na wizycie zakończonej z płatnością pending → 409, płatność i wiersz bez zmian", async () => {
    const appt = await appointment({ status: "completed", paidAmount: "80.00", paymentMethod: "card", depositAmount: "20.00" });
    const [payment] = await h!.db
      .insert(depositPayments)
      .values({ salonId: ids.salonA, appointmentId: appt, amount: "20.00", paymentMethod: "blik", status: "pending" })
      .returning({ id: depositPayments.id });
    const before = await rowOf(appt);

    const res = await parseResponse<Body>(await del(appt));

    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.code).toBe(APPOINTMENT_COMPLETED_CODE);
    expect(await rowOf(appt)).toEqual(before);
    const [after] = await h!.db
      .select({ status: depositPayments.status })
      .from(depositPayments)
      .where(eq(depositPayments.id, payment!.id));
    expect(after!.status).toBe("pending");
    expect(mocks.refund).not.toHaveBeenCalled();
  });

  it("PUT zmieniający termin wizyty zakończonej → 409 z komunikatem o notatkach, wiersz bez zmian", async () => {
    const appt = await appointment({ status: "completed", paidAmount: "80.00", paymentMethod: "card" });
    const [beforeSlot] = await h!.db
      .select({ startTime: appointments.startTime, endTime: appointments.endTime, employeeId: appointments.employeeId })
      .from(appointments)
      .where(eq(appointments.id, appt));
    const before = await rowOf(appt);
    const moved = new Date(beforeSlot!.startTime.getTime() + 86_400_000);

    const res = await parseResponse<Body>(
      await put(appt, {
        startTime: moved.toISOString(),
        endTime: new Date(moved.getTime() + 1_800_000).toISOString(),
        employeeId: ids.empA,
      })
    );

    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body).toEqual({
      success: false,
      code: APPOINTMENT_COMPLETED_CODE,
      error: "Zakończonej wizyty nie można zmienić. Możesz edytować tylko notatki.",
    });
    expect(await rowOf(appt)).toEqual(before);
    const [afterSlot] = await h!.db
      .select({ startTime: appointments.startTime, endTime: appointments.endTime, employeeId: appointments.employeeId })
      .from(appointments)
      .where(eq(appointments.id, appt));
    expect(afterSlot).toEqual(beforeSlot);
  });

  it("PUT całego obiektu z niezmienionymi polami i nową notatką na wizycie zakończonej → 200, zapisana tylko notatka", async () => {
    const appt = await appointment({ status: "completed", paidAmount: "80.00", paymentMethod: "card" });
    const [current] = await h!.db
      .select({ startTime: appointments.startTime, endTime: appointments.endTime })
      .from(appointments)
      .where(eq(appointments.id, appt));

    const res = await parseResponse<Body>(
      await put(appt, {
        startTime: current!.startTime.toISOString(),
        endTime: current!.endTime.toISOString(),
        employeeId: ids.empA,
        serviceId: ids.serviceA,
        clientId: null,
        notes: "it-best notatka po wizycie",
      })
    );

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const [row] = await h!.db
      .select({ notes: appointments.notes, status: appointments.status, startTime: appointments.startTime })
      .from(appointments)
      .where(eq(appointments.id, appt));
    expect(row).toEqual({ notes: "it-best notatka po wizycie", status: "completed", startTime: current!.startTime });
  });

  it.each(["scheduled", "confirmed", "cancelled"])(
    "PUT wizyty zakończonej ze statusem %s → 409, wiersz bez zmian",
    async (next) => {
      const appt = await appointment({ status: "completed", paidAmount: "80.00", paymentMethod: "card" });
      const before = await rowOf(appt);

      const res = await parseResponse<Body>(await put(appt, { status: next }));

      expect(res.status, JSON.stringify(res.body)).toBe(409);
      expect(res.body.code).toBe(APPOINTMENT_COMPLETED_CODE);
      expect(await rowOf(appt)).toEqual(before);
    }
  );

  it("DELETE wizyty zakończonej → 409, wiersz bez zmian, bez zwrotu i listy oczekujących", async () => {
    const appt = await appointment({ status: "completed", paidAmount: "80.00", paymentMethod: "card" });
    const before = await rowOf(appt);

    const res = await parseResponse<Body>(await del(appt));

    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.code).toBe(APPOINTMENT_COMPLETED_CODE);
    expect(await rowOf(appt)).toEqual(before);
    expect(mocks.refund).not.toHaveBeenCalled();
    expect(mocks.notifyWaitingList).not.toHaveBeenCalled();
  });

  it("PUT ze statusem completed na wizycie zaplanowanej → 400 z polskim komunikatem, wiersz bez zmian", async () => {
    const appt = await appointment();
    const before = await rowOf(appt);

    const res = await parseResponse<Body>(await put(appt, { status: "completed" }));

    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body).toEqual({
      success: false,
      code: COMPLETE_DEDICATED_ROUTE_CODE,
      error: "Wizytę zakończ przyciskiem Zakończ wizytę",
    });
    expect(await rowOf(appt)).toEqual(before);
  });

  it("kontrola: PUT samej notatki na wizycie zakończonej → 200, status i płatność bez zmian", async () => {
    const appt = await appointment({ status: "completed", paidAmount: "80.00", paymentMethod: "card" });

    const res = await parseResponse<Body>(await put(appt, { notes: "it-best po wizycie" }));

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await rowOf(appt)).toMatchObject({ status: "completed", paidAmount: "80.00", paymentMethod: "card" });
  });
});
