/**
 * expireCheckoutSessions — wygaszanie sesji Checkout po odwołaniu przez salon.
 * Audyt bezpieczeństwa, P2 (#98): błąd Stripe logowany wyłącznie jako toErrorIdentity
 * (nazwa + kod), bez message/stack — komunikat może nieść dane klienta.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockExpire, stripeState } = vi.hoisted(() => ({
  mockExpire: vi.fn(),
  stripeState: { configured: true },
}));

vi.mock("@/lib/stripe", () => ({
  getStripe: vi.fn(() =>
    stripeState.configured ? { checkout: { sessions: { expire: (...a: unknown[]) => mockExpire(...a) } } } : null
  ),
}));
vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { AppointmentGoneError, type AppointmentCaller } from "@/lib/appointment-access";
import { AppointmentCompletedError } from "@/lib/appointment-completion";
import { logger } from "@/lib/logger";
import {
  AppointmentMarkedNoShowError,
  cancelAppointmentInTx,
  expireCheckoutSessions,
} from "@/lib/salon-cancellation";
import { appointments } from "@/lib/schema";
import type { DbTx } from "@/lib/server/repository";

const OWNER: AppointmentCaller = { role: "owner", employeeId: null };
const RECEPTION: AppointmentCaller = { role: "receptionist", employeeId: null };
const EMPLOYEE: AppointmentCaller = { role: "employee", employeeId: "emp-own" };
const EMPLOYEE_WITHOUT_ID: AppointmentCaller = { role: "employee", employeeId: null };

/**
 * Atrapa transakcji: pierwszy UPDATE (płatności `pending → failed`) zwraca
 * pustą listę, odczyt `for update` zwraca `lockedRow`, UPDATE wizyty zwraca
 * `cancelledRows`. Zapisuje tabele UPDATE-ów i ich warunki, żeby sprawdzić,
 * że po odmowie nie ma UPDATE wizyty.
 */
function fakeTx(lockedRow: Record<string, unknown> | null, cancelledRows?: unknown[]) {
  const updates: unknown[] = [];
  const updateWheres: SQL[] = [];
  const chain = (result: unknown[], onWhere?: (w: SQL) => void) => {
    const c: Record<string, unknown> = {};
    for (const m of ["set", "returning", "from", "for", "limit"]) c[m] = () => c;
    c.where = (w: SQL) => {
      onWhere?.(w);
      return c;
    };
    c.then = (resolve: (v: unknown) => unknown) => resolve(result);
    return c;
  };
  const tx = {
    update: (table: unknown) => {
      updates.push(table);
      const isAppointment = table === appointments;
      const result = isAppointment ? (cancelledRows ?? (lockedRow ? [{ ...lockedRow, status: "cancelled" }] : [])) : [];
      return chain(result, isAppointment ? (w) => updateWheres.push(w) : undefined);
    },
    select: () => chain(lockedRow ? [lockedRow] : []),
  };
  return { tx: tx as unknown as DbTx, updates, updateWheres };
}

const dialect = new PgDialect();

describe("cancelAppointmentInTx — stan po blokadzie wiersza", () => {
  it("wizyta no_show (oznaczenie weszło po odczycie w trasie) → błąd wycofujący transakcję, bez anulowania", async () => {
    const { tx, updates } = fakeTx({ id: "appt-1", salonId: "salon-a", status: "no_show" });

    await expect(cancelAppointmentInTx(tx, "salon-a", "appt-1", OWNER)).rejects.toBeInstanceOf(
      AppointmentMarkedNoShowError
    );
    // Tylko krok 1 (płatności) przed blokadą; UPDATE wizyty nie zapadł.
    expect(updates).toHaveLength(1);
  });

  it("wizyta completed (zakończenie weszło po odczycie w trasie) → błąd wycofujący transakcję, bez anulowania", async () => {
    const { tx, updates } = fakeTx({ id: "appt-1", salonId: "salon-a", status: "completed" });

    await expect(cancelAppointmentInTx(tx, "salon-a", "appt-1", OWNER)).rejects.toBeInstanceOf(
      AppointmentCompletedError
    );
    // Tylko krok 1 (płatności, wycofany razem z transakcją); UPDATE wizyty nie zapadł.
    expect(updates).toHaveLength(1);
  });

  it("kontrola: wizyta cancelled → alreadyCancelled, bez błędu", async () => {
    const { tx, updates } = fakeTx({ id: "appt-1", salonId: "salon-a", status: "cancelled" });

    await expect(cancelAppointmentInTx(tx, "salon-a", "appt-1", OWNER)).resolves.toEqual({ alreadyCancelled: true });
    expect(updates).toHaveLength(1);
  });
});

describe("cancelAppointmentInTx — wizyta wołającego pod blokadą", () => {
  const locked = (overrides: Record<string, unknown> = {}) => ({
    id: "appt-1",
    salonId: "salon-a",
    employeeId: "emp-own",
    status: "scheduled",
    depositAmount: "40.00",
    depositPaid: false,
    ...overrides,
  });

  it("brak wiersza pod blokadą → AppointmentGoneError (wycofanie kroku płatności), bez UPDATE wizyty", async () => {
    const { tx, updates } = fakeTx(null);

    await expect(cancelAppointmentInTx(tx, "salon-a", "appt-1", OWNER)).rejects.toBeInstanceOf(AppointmentGoneError);
    expect(updates).toHaveLength(1);
  });

  it("pracownik: wizyta przepisana na innego pod blokadą → AppointmentGoneError, bez UPDATE wizyty", async () => {
    const { tx, updates } = fakeTx(locked({ employeeId: "emp-other" }));

    await expect(cancelAppointmentInTx(tx, "salon-a", "appt-1", EMPLOYEE)).rejects.toBeInstanceOf(
      AppointmentGoneError
    );
    expect(updates).toHaveLength(1);
  });

  it.each([
    ["anulowana", "cancelled"],
    ["Nie przyszedł", "no_show"],
    ["zakończona", "completed"],
  ])("pracownik: wizyta przepisana i %s → AppointmentGoneError przed statusem", async (_n, status) => {
    const { tx, updates } = fakeTx(locked({ employeeId: "emp-other", status }));

    await expect(cancelAppointmentInTx(tx, "salon-a", "appt-1", EMPLOYEE)).rejects.toBeInstanceOf(
      AppointmentGoneError
    );
    expect(updates).toHaveLength(1);
  });

  it("pracownik: wizyta bez pracownika pod blokadą → AppointmentGoneError", async () => {
    const { tx } = fakeTx(locked({ employeeId: null }));

    await expect(cancelAppointmentInTx(tx, "salon-a", "appt-1", EMPLOYEE)).rejects.toBeInstanceOf(
      AppointmentGoneError
    );
  });

  it("pracownik bez identyfikatora pracownika → AppointmentGoneError (przy błędzie zamyka)", async () => {
    const { tx, updates } = fakeTx(locked({ employeeId: null }));

    await expect(cancelAppointmentInTx(tx, "salon-a", "appt-1", EMPLOYEE_WITHOUT_ID)).rejects.toBeInstanceOf(
      AppointmentGoneError
    );
    expect(updates).toHaveLength(1);
  });

  it("pracownik: własna wizyta → anulowana, kwota i zadatek spod blokady, UPDATE z warunkiem pracownika", async () => {
    const { tx, updates, updateWheres } = fakeTx(locked({ depositAmount: "40.00", depositPaid: true }));

    const result = await cancelAppointmentInTx(tx, "salon-a", "appt-1", EMPLOYEE);

    expect(result).toMatchObject({
      cancelled: { id: "appt-1", status: "cancelled" },
      depositPaid: true,
      depositAmount: "40.00",
    });
    expect(updates).toHaveLength(2);
    expect(dialect.sqlToQuery(updateWheres[0]!).params).toEqual(["appt-1", "salon-a", "emp-own"]);
  });

  it.each([
    ["właściciel", OWNER],
    ["recepcja", RECEPTION],
  ])("%s: wizyta innego pracownika → anulowana, UPDATE bez warunku pracownika", async (_n, caller) => {
    const { tx, updateWheres } = fakeTx(locked({ employeeId: "emp-other" }));

    const result = await cancelAppointmentInTx(tx, "salon-a", "appt-1", caller);

    expect(result).toMatchObject({ cancelled: { status: "cancelled" }, depositAmount: "40.00", depositPaid: false });
    expect(dialect.sqlToQuery(updateWheres[0]!).params).toEqual(["appt-1", "salon-a"]);
  });

  it("UPDATE wizyty bez trafienia → AppointmentGoneError (nie wynik, który zatwierdza krok płatności)", async () => {
    const { tx } = fakeTx(locked(), []);

    await expect(cancelAppointmentInTx(tx, "salon-a", "appt-1", OWNER)).rejects.toBeInstanceOf(AppointmentGoneError);
  });
});

describe("expireCheckoutSessions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stripeState.configured = true;
  });

  it("wygasza tylko sesje cs_, pomija pi_ i null", async () => {
    mockExpire.mockResolvedValue({ status: "expired" });
    await expireCheckoutSessions("appt-1", [
      { id: "dp-1", stripePaymentIntentId: "cs_test_1" },
      { id: "dp-2", stripePaymentIntentId: "pi_1" },
      { id: "dp-3", stripePaymentIntentId: null },
    ]);
    expect(mockExpire).toHaveBeenCalledTimes(1);
    expect(mockExpire).toHaveBeenCalledWith("cs_test_1");
  });

  it("błąd Stripe => warn tylko z nazwą i kodem błędu, bez message i stack", async () => {
    class StripeInvalidRequestError extends Error {
      type = "StripeInvalidRequestError";
      code = "resource_missing";
    }
    const err = new StripeInvalidRequestError("No such checkout.session for anna@example.com +48600700800");
    err.name = "StripeInvalidRequestError";
    mockExpire.mockRejectedValue(err);

    await expireCheckoutSessions("appt-1", [{ id: "dp-1", stripePaymentIntentId: "cs_test_1" }]);

    expect(logger.warn).toHaveBeenCalledTimes(1);
    const [msg, meta] = vi.mocked(logger.warn).mock.calls[0]!;
    expect(msg).toContain("Checkout session expire failed");
    expect(meta).toEqual({
      appointmentId: "appt-1",
      depositPaymentId: "dp-1",
      errorName: "StripeInvalidRequestError",
      errorCode: "resource_missing",
    });
    const serialized = JSON.stringify(meta);
    expect(serialized).not.toContain("anna@example.com");
    expect(serialized).not.toContain("+48600700800");
  });

  it("brak Stripe => warn z id płatności, bez wywołań", async () => {
    stripeState.configured = false;
    await expireCheckoutSessions("appt-1", [{ id: "dp-1", stripePaymentIntentId: "cs_test_1" }]);
    expect(mockExpire).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("Stripe not configured"), {
      appointmentId: "appt-1",
      depositPaymentIds: ["dp-1"],
    });
  });
});
