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

import { AppointmentCompletedError } from "@/lib/appointment-completion";
import { logger } from "@/lib/logger";
import {
  AppointmentMarkedNoShowError,
  cancelAppointmentInTx,
  expireCheckoutSessions,
} from "@/lib/salon-cancellation";
import type { DbTx } from "@/lib/server/repository";

/**
 * Atrapa transakcji: pierwszy UPDATE (płatności `pending → failed`) zwraca
 * `failedRows`, odczyt `for update` zwraca `lockedRow`. Zapisuje, które
 * zapisy wykonano, żeby sprawdzić, że po `no_show` nie ma UPDATE wizyty.
 */
function fakeTx(lockedRow: Record<string, unknown> | null) {
  const updates: unknown[] = [];
  const chain = (result: unknown[]) => {
    const c: Record<string, unknown> = {};
    for (const m of ["set", "where", "returning", "from", "for", "limit"]) c[m] = () => c;
    c.then = (resolve: (v: unknown) => unknown) => resolve(result);
    return c;
  };
  const tx = {
    update: (table: unknown) => {
      updates.push(table);
      return chain([]);
    },
    select: () => chain(lockedRow ? [lockedRow] : []),
  };
  return { tx: tx as unknown as DbTx, updates };
}

describe("cancelAppointmentInTx — stan po blokadzie wiersza", () => {
  it("wizyta no_show (oznaczenie weszło po odczycie w trasie) → błąd wycofujący transakcję, bez anulowania", async () => {
    const { tx, updates } = fakeTx({ id: "appt-1", salonId: "salon-a", status: "no_show" });

    await expect(cancelAppointmentInTx(tx, "salon-a", "appt-1")).rejects.toBeInstanceOf(
      AppointmentMarkedNoShowError
    );
    // Tylko krok 1 (płatności) przed blokadą; UPDATE wizyty nie zapadł.
    expect(updates).toHaveLength(1);
  });

  it("wizyta completed (zakończenie weszło po odczycie w trasie) → błąd wycofujący transakcję, bez anulowania", async () => {
    const { tx, updates } = fakeTx({ id: "appt-1", salonId: "salon-a", status: "completed" });

    await expect(cancelAppointmentInTx(tx, "salon-a", "appt-1")).rejects.toBeInstanceOf(
      AppointmentCompletedError
    );
    // Tylko krok 1 (płatności, wycofany razem z transakcją); UPDATE wizyty nie zapadł.
    expect(updates).toHaveLength(1);
  });

  it("kontrola: wizyta cancelled → alreadyCancelled, bez błędu", async () => {
    const { tx, updates } = fakeTx({ id: "appt-1", salonId: "salon-a", status: "cancelled" });

    await expect(cancelAppointmentInTx(tx, "salon-a", "appt-1")).resolves.toEqual({ alreadyCancelled: true });
    expect(updates).toHaveLength(1);
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
