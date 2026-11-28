/**
 * Płatność przy zakończeniu wizyty (`paid_amount`, `payment_method`, migracja 0020)
 * na PRAWDZIWYM Postgresie, pod rolą aplikacji:
 * - właściciel A kończy wizytę A z kwotą i metodą → 200; obie kolumny zapisane,
 *   odpowiedź zwraca wartości z bazy; bez pól → kolumny puste;
 * - CHECK pod rolą aplikacji: metoda spoza listy, złamana para, kwota ujemna → 23514
 *   z nazwą ograniczenia, wiersz bez zmian;
 * - wizyta salonu B nietknięta: zakończenie wizyty A jej nie zmienia, a sesja A
 *   kończąca wizytę B dostaje 404 i nic nie zapisuje;
 * - błąd w dalszej części transakcji (testowy trigger na INSERT prowizji, po UPDATE
 *   statusu) wycofuje także kwotę i metodę: trigger potwierdza, że UPDATE był
 *   widoczny w transakcji, a po błędzie status, płatność, zabieg i prowizja bez zmian;
 *   log błędu bez kwoty i metody;
 * - trzy CHECK płatności zwalidowane (`convalidated = true`).
 *
 * Trasa wołana bezpośrednio; atrapa sesji (`auth.api.getSession`), nagłówków i loggera;
 * `@/lib/db` wskazuje bazę testową. Kontekst salonu i `forSalon` prawdziwe.
 *
 * Dane: konta `it-t3-pay-…` (właściciele A i B), salony A i B, pracownik i usługa
 * w każdym, wizyty z terminami w 2097. Salony usuwane w `afterAll` (kaskada).
 */
import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as completeRoute from "@/app/api/appointments/[id]/complete/route";
import {
  appointments,
  employeeCommissions,
  employees,
  services,
  salons,
  treatmentHistory,
  user,
} from "@/lib/schema";
import { forSalon } from "@/lib/server/repository";
import { createMockRequest, createRouteParams, parseResponse } from "../api/helpers";

const h = await vi.hoisted(async () => (await import("./pg-harness")).createIntegrationDb());
const ctl = vi.hoisted(() => ({ userId: "" }));
const mocks = vi.hoisted(() => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }));

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
const OWNER_A = `it-t3-pay-a-${RUN}`;
const OWNER_B = `it-t3-pay-b-${RUN}`;
const ids = { salonA: "", salonB: "", empA: "", empB: "", serviceA: "", serviceB: "", rollbackAppt: "" };
/** Testowy trigger wycofania (nazwy z przebiegu, żeby nie kolidować z innym uruchomieniem). */
const ROLLBACK_FN = `it_t3_pay_fail_${RUN.replace(/[^0-9a-f]/g, "")}`;
const ROLLBACK_TRIGGER = `${ROLLBACK_FN}_trg`;
/** SQLSTATE triggera: UPDATE wizyty widoczny w transakcji / niewidoczny. */
const ROLLBACK_SEEN_CODE = "XT001";
const ROLLBACK_UNSEEN_CODE = "XT002";
let slot = 0;

/** DDL w krótkiej transakcji z `lock_timeout`: bez czekania w nieskończoność na blokadę tabeli. */
async function ddl(statements: string[]) {
  await h!.db.transaction(async (tx) => {
    await tx.execute(sql.raw("set local lock_timeout = '5s'"));
    for (const s of statements) await tx.execute(sql.raw(s));
  });
}

/** Wizyta salonu (rola migracji); każda w osobnym terminie. */
async function appointment(salon: "A" | "B"): Promise<string> {
  const start = new Date(Date.UTC(2097, 4, 1, 8) + slot++ * 3_600_000);
  const [a] = await h!.db
    .insert(appointments)
    .values({
      salonId: salon === "A" ? ids.salonA : ids.salonB,
      employeeId: salon === "A" ? ids.empA : ids.empB,
      serviceId: salon === "A" ? ids.serviceA : ids.serviceB,
      startTime: start,
      endTime: new Date(start.getTime() + 1_800_000),
      status: "scheduled",
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
    })
    .from(appointments)
    .where(eq(appointments.id, appt));
  return a!;
}

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

/** UPDATE wizyty pod rolą aplikacji w kontekście salonu A. */
function updateAsAppRole(appt: string, values: Partial<typeof appointments.$inferInsert>) {
  return forSalon(ids.salonA).raw((tx) =>
    tx.update(appointments).set(values).where(eq(appointments.id, appt)).returning({ id: appointments.id })
  );
}

const complete = (id: string, body: Record<string, unknown> = {}) =>
  completeRoute.POST(
    createMockRequest(`http://localhost/api/appointments/${id}/complete`, { method: "POST", body }),
    createRouteParams(id)
  );

type CompleteBody = {
  success: boolean;
  data: {
    appointment: { status: string; paidAmount: string | null; paymentMethod: string | null };
    payment: { paidAmount: string | null; paymentMethod: string | null };
  };
};

suite("płatność przy zakończeniu wizyty pod rolą aplikacji — prawdziwy Postgres", () => {
  beforeAll(async () => {
    const db = h!.db;
    await db.insert(user).values([
      { id: OWNER_A, name: "IT pay A", email: `${OWNER_A}@example.invalid` },
      { id: OWNER_B, name: "IT pay B", email: `${OWNER_B}@example.invalid` },
    ]);
    const [a] = await db.insert(salons).values({ name: `IT pay A ${RUN}`, ownerId: OWNER_A }).returning({ id: salons.id });
    const [b] = await db.insert(salons).values({ name: `IT pay B ${RUN}`, ownerId: OWNER_B }).returning({ id: salons.id });
    ids.salonA = a!.id;
    ids.salonB = b!.id;
    const [ea] = await db
      .insert(employees)
      .values({ salonId: ids.salonA, firstName: "IT", lastName: "Pracownik A", commissionRate: "40" })
      .returning({ id: employees.id });
    const [eb] = await db
      .insert(employees)
      .values({ salonId: ids.salonB, firstName: "IT", lastName: "Pracownik B", commissionRate: "40" })
      .returning({ id: employees.id });
    ids.empA = ea!.id;
    ids.empB = eb!.id;
    const [sa] = await db
      .insert(services)
      .values({ salonId: ids.salonA, name: "IT pay usługa A", basePrice: "200.00", baseDuration: 30 })
      .returning({ id: services.id });
    const [sb] = await db
      .insert(services)
      .values({ salonId: ids.salonB, name: "IT pay usługa B", basePrice: "200.00", baseDuration: 30 })
      .returning({ id: services.id });
    ids.serviceA = sa!.id;
    ids.serviceB = sb!.id;

    // Testowy trigger (rola migracji, jak reszta danych testu): INSERT prowizji
    // wizyty `rollbackAppt` kończy się błędem. Kod błędu mówi, czy trigger widział
    // w tej transakcji wynik UPDATE (status completed z kwotą 120.00 i kartą).
    // Inne wizyty, także z równoległych testów, nie są dotknięte.
    ids.rollbackAppt = await appointment("A");
    if (!/^[0-9a-f-]{36}$/.test(ids.rollbackAppt)) throw new Error("nieoczekiwany format id wizyty");
    await ddl([
      `
        create function ${ROLLBACK_FN}() returns trigger language plpgsql as $fn$
        begin
          if new.appointment_id = '${ids.rollbackAppt}'::uuid then
            if exists (
              select 1 from public.appointments a
              where a.id = new.appointment_id
                and a.status = 'completed'
                and a.paid_amount = 120.00
                and a.payment_method = 'card'
            ) then
              raise exception 'it-t3 pay: wymuszony błąd po UPDATE' using errcode = '${ROLLBACK_SEEN_CODE}';
            end if;
            raise exception 'it-t3 pay: UPDATE niewidoczny' using errcode = '${ROLLBACK_UNSEEN_CODE}';
          end if;
          return new;
        end
        $fn$
      `,
      `create trigger ${ROLLBACK_TRIGGER} before insert on public.employee_commissions ` +
        `for each row execute function ${ROLLBACK_FN}()`,
    ]);
  });

  afterAll(async () => {
    if (!h) return;
    try {
      // Sprzątanie triggera osobno: jego błąd nie może zostawić danych testu.
      try {
        await ddl([
          `drop trigger if exists ${ROLLBACK_TRIGGER} on public.employee_commissions`,
          `drop function if exists ${ROLLBACK_FN}()`,
        ]);
      } catch (e) {
        mocks.warn("trigger cleanup failed", e);
      }
      for (const s of [ids.salonA, ids.salonB]) if (s) await h.db.delete(salons).where(eq(salons.id, s));
      await h.db.delete(user).where(inArray(user.id, [OWNER_A, OWNER_B]));
    } finally {
      await h.end();
    }
  });

  beforeEach(() => {
    ctl.userId = "";
    mocks.error.mockClear();
    mocks.warn.mockClear();
    mocks.info.mockClear();
  });

  describe("zapis przez trasę", () => {
    it("właściciel A z kwotą i metodą → 200; obie kolumny zapisane, odpowiedź z wartościami z bazy", async () => {
      const appt = await appointment("A");
      ctl.userId = OWNER_A;

      const res = await parseResponse<CompleteBody>(await complete(appt, { paidAmount: "150.5", paymentMethod: "blik" }));

      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.payment).toEqual({ paidAmount: "150.50", paymentMethod: "blik" });
      expect(res.body.data.appointment).toMatchObject({ status: "completed", paidAmount: "150.50", paymentMethod: "blik" });
      expect(await rowOf(appt)).toEqual({ status: "completed", paidAmount: "150.50", paymentMethod: "blik" });
      // Kwota i metoda nie trafiają do logów.
      const logged = JSON.stringify([mocks.info.mock.calls, mocks.warn.mock.calls, mocks.error.mock.calls]);
      expect(logged).not.toContain("150.5");
      expect(logged).not.toContain("blik");
      expect(mocks.error).not.toHaveBeenCalled();
    });

    it("kwota 0 i metoda gotówka → 200, zapis 0.00", async () => {
      const appt = await appointment("A");
      ctl.userId = OWNER_A;

      const res = await parseResponse<CompleteBody>(await complete(appt, { paidAmount: 0, paymentMethod: "cash" }));

      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(await rowOf(appt)).toEqual({ status: "completed", paidAmount: "0.00", paymentMethod: "cash" });
    });

    it("bez kwoty i metody → 200, kolumny puste", async () => {
      const appt = await appointment("A");
      ctl.userId = OWNER_A;

      const res = await parseResponse<CompleteBody>(await complete(appt, { notes: "it-pay bez płatności" }));

      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.payment).toEqual({ paidAmount: null, paymentMethod: null });
      expect(await rowOf(appt)).toEqual({ status: "completed", paidAmount: null, paymentMethod: null });
    });
  });

  describe("CHECK pod rolą aplikacji", () => {
    it("metoda spoza listy → 23514 appointments_payment_method_valid, wiersz bez zmian", async () => {
      const appt = await appointment("A");

      const err = await dbError(updateAsAppRole(appt, { paidAmount: "10.00", paymentMethod: "transfer" }));

      expect(err.code).toBe("23514");
      expect(err.constraint_name).toBe("appointments_payment_method_valid");
      expect(await rowOf(appt)).toEqual({ status: "scheduled", paidAmount: null, paymentMethod: null });
    });

    it.each([
      ["kwota bez metody", { paidAmount: "10.00" }],
      ["metoda bez kwoty", { paymentMethod: "card" }],
    ])("złamana para (%s) → 23514 appointments_payment_pair", async (_n, values) => {
      const appt = await appointment("A");

      const err = await dbError(updateAsAppRole(appt, values));

      expect(err.code).toBe("23514");
      expect(err.constraint_name).toBe("appointments_payment_pair");
      expect(await rowOf(appt)).toEqual({ status: "scheduled", paidAmount: null, paymentMethod: null });
    });

    it("kwota ujemna → 23514 appointments_paid_amount_nonneg", async () => {
      const appt = await appointment("A");

      const err = await dbError(updateAsAppRole(appt, { paidAmount: "-0.01", paymentMethod: "cash" }));

      expect(err.code).toBe("23514");
      expect(err.constraint_name).toBe("appointments_paid_amount_nonneg");
      expect(await rowOf(appt)).toEqual({ status: "scheduled", paidAmount: null, paymentMethod: null });
    });
  });

  describe("rozdzielenie salonów", () => {
    it("zakończenie wizyty A z płatnością nie zmienia wizyty B", async () => {
      const apptA = await appointment("A");
      const apptB = await appointment("B");
      ctl.userId = OWNER_A;

      const res = await parseResponse(await complete(apptA, { paidAmount: "99.99", paymentMethod: "card" }));

      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(await rowOf(apptA)).toEqual({ status: "completed", paidAmount: "99.99", paymentMethod: "card" });
      expect(await rowOf(apptB)).toEqual({ status: "scheduled", paidAmount: null, paymentMethod: null });
    });

    it("sesja salonu A na wizycie B → 404, wizyta B bez statusu i płatności", async () => {
      const apptB = await appointment("B");
      ctl.userId = OWNER_A;

      const res = await parseResponse(await complete(apptB, { paidAmount: "50.00", paymentMethod: "cash" }));

      expect(res.status).toBe(404);
      expect(res.body).toEqual({
        success: false,
        code: "APPOINTMENT_NOT_FOUND",
        error: "Nie znaleziono tej wizyty albo nie jest już przypisana do Ciebie. Odśwież kalendarz.",
      });
      // Cudza wizyta i nieistniejąca: ta sama odpowiedź, bez śladu istnienia wizyty B.
      const missing = await parseResponse(await complete(randomUUID(), { paidAmount: "50.00", paymentMethod: "cash" }));
      expect({ status: missing.status, body: missing.body }).toEqual({ status: res.status, body: res.body });
      expect(await rowOf(apptB)).toEqual({ status: "scheduled", paidAmount: null, paymentMethod: null });
      expect(await h!.db.select().from(treatmentHistory).where(eq(treatmentHistory.appointmentId, apptB))).toHaveLength(0);
    });

    it("UPDATE pod rolą aplikacji w kontekście A nie trafia w wizytę B (RLS)", async () => {
      const apptB = await appointment("B");

      const updated = await updateAsAppRole(apptB, { paidAmount: "10.00", paymentMethod: "cash" });

      expect(updated).toEqual([]);
      expect(await rowOf(apptB)).toEqual({ status: "scheduled", paidAmount: null, paymentMethod: null });
    });
  });

  describe("transakcja", () => {
    it("błąd zapisu prowizji po UPDATE statusu → 500; status, płatność i zabieg wycofane", async () => {
      const appt = ids.rollbackAppt;
      ctl.userId = OWNER_A;

      // Testowy trigger na employee_commissions rzuca błąd przy INSERT prowizji tej
      // wizyty, czyli po UPDATE statusu z płatnością w tej samej transakcji.
      const res = await parseResponse(
        await complete(appt, { paidAmount: "120.00", paymentMethod: "card", notes: "it-pay wycofanie" })
      );

      expect(res.status, JSON.stringify(res.body)).toBe(500);
      expect(res.body).toEqual({
        success: false,
        error: "Nie udało się zakończyć wizyty. Nic nie zostało zapisane. Spróbuj ponownie za chwilę.",
      });
      // UPDATE się wykonał: trigger zobaczył w tej transakcji status i płatność
      // wizyty (kod ROLLBACK_SEEN_CODE, nie UNSEEN). Log zakończenia pada dopiero
      // po zatwierdzeniu transakcji, więc przy wycofaniu go nie ma.
      expect(mocks.info).not.toHaveBeenCalledWith("Appointment marked as completed", { appointmentId: appt });
      expect(mocks.error).toHaveBeenCalledWith(
        "Failed to complete appointment",
        expect.objectContaining({ errorCode: ROLLBACK_SEEN_CODE })
      );
      // ...a potem został wycofany razem z zabiegiem.
      expect(await rowOf(appt)).toEqual({ status: "scheduled", paidAmount: null, paymentMethod: null });
      expect(await h!.db.select().from(treatmentHistory).where(eq(treatmentHistory.appointmentId, appt))).toHaveLength(0);
      expect(await h!.db.select().from(employeeCommissions).where(eq(employeeCommissions.appointmentId, appt))).toHaveLength(0);
      // Log błędu bez kwoty i metody.
      const logged = JSON.stringify(mocks.error.mock.calls);
      expect(logged).not.toContain("120");
      expect(logged).not.toContain("card");
    });
  });

  describe("migracja", () => {
    it("trzy CHECK płatności są zwalidowane (VALIDATE po NOT VALID)", async () => {
      const rows = (await h!.db.execute(sql`
        select conname, convalidated from pg_constraint
        where conrelid = 'appointments'::regclass
          and conname in ('appointments_payment_method_valid', 'appointments_payment_pair', 'appointments_paid_amount_nonneg')
        order by conname
      `)) as unknown as Array<{ conname: string; convalidated: boolean }>;

      expect(Array.from(rows)).toEqual([
        { conname: "appointments_paid_amount_nonneg", convalidated: true },
        { conname: "appointments_payment_method_valid", convalidated: true },
        { conname: "appointments_payment_pair", convalidated: true },
      ]);
    });
  });
});
