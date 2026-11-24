import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { recordDepositStatusEvent } from "@/lib/deposit-status-events";
import { logger } from "@/lib/logger";
import { depositPayments, appointments } from "@/lib/schema";
import type { DbTx } from "@/lib/server/repository";
import { getStripe } from "@/lib/stripe";

export interface RefundResult {
  success: boolean;
  refunded: boolean;
  refundId?: string;
  amount?: number;
  /** Kod błędu — nigdy treść błędu Stripe (ta nie trafia do odpowiedzi HTTP). */
  error?: RefundErrorCode;
  message: string;
}

export type RefundErrorCode =
  | "stripe_not_configured"
  | "missing_payment_intent"
  | "payment_intent_unresolved"
  | "stripe_refund_failed"
  | "payment_changed_concurrently"
  | "refund_error";

/** Klucz idempotencji zwrotu w Stripe: jeden zwrot na płatność (recenzja, #70). */
export function depositRefundIdempotencyKey(depositPaymentId: string): string {
  return `deposit-refund:${depositPaymentId}`;
}

/** Limit czasu wywołań Stripe przy zwrocie (ms). */
const STRIPE_TIMEOUT_MS = 5000;

const MANUAL_REFUND_LOG = "Deposit refund failed — manual refund";

function manualRefund(
  payment: { id: string; appointmentId: string; salonId: string },
  error: RefundErrorCode,
  extra: Record<string, unknown> = {}
): RefundResult {
  // Same identyfikatory i kody — bez danych osobowych i bez treści błędów Stripe.
  logger.error(MANUAL_REFUND_LOG, {
    depositPaymentId: payment.id,
    appointmentId: payment.appointmentId,
    salonId: payment.salonId,
    error,
    ...extra,
  });
  return {
    success: false,
    refunded: false,
    error,
    message: "Zwrot zadatku nie powiodl sie - wymagana reczna obsluga zwrotu",
  };
}

/**
 * Stripe zapisuje w `stripe_payment_intent_id` id sesji Checkout (`cs_…`),
 * dopóki webhook nie podmieni go na `pi_…`. Zwrot wymaga PaymentIntentu.
 */
async function resolvePaymentIntentId(
  stripe: NonNullable<ReturnType<typeof getStripe>>,
  reference: string
): Promise<string | null> {
  if (reference.startsWith("pi_")) return reference;
  if (!reference.startsWith("cs_")) return null;
  const session = await stripe.checkout.sessions.retrieve(reference, {}, { timeout: STRIPE_TIMEOUT_MS });
  const pi = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
  return pi && pi.startsWith("pi_") ? pi : null;
}

/**
 * Zwrot JEDNEJ, wskazanej płatności zadatku (recenzja, #98). Obrona: płatność
 * musi należeć do tej wizyty i być `succeeded`. Nie zmienia
 * `appointments.depositPaid` — to robi wołający (`refundAppointmentDeposits`).
 *
 * - Stripe: zwrot z kluczem idempotencji; bez klienta Stripe / bez
 *   PaymentIntentu / błąd Stripe => płatność zostaje `succeeded`,
 *   logger.error „manual refund”, `refunded: false`.
 * - Metoda spoza Stripe (np. Blik P2P): `refunded`, zwrot ręczny w salonie.
 * - Zapis `refunded` warunkowy: `WHERE id AND status='succeeded'`.
 */
export async function processAutomaticRefund(
  appointmentId: string,
  depositPaymentId: string,
  reason: string
): Promise<RefundResult> {
  try {
    const [payment] = await db
      .select()
      .from(depositPayments)
      .where(
        and(
          eq(depositPayments.id, depositPaymentId),
          eq(depositPayments.appointmentId, appointmentId),
          eq(depositPayments.status, "succeeded")
        )
      );

    if (!payment) {
      logger.debug("No succeeded deposit payment to refund", { appointmentId, depositPaymentId });
      return { success: true, refunded: false, message: "Brak zadatku do zwrotu" };
    }

    const amount = parseFloat(payment.amount);
    if (amount <= 0) {
      return { success: true, refunded: false, message: "Kwota zadatku wynosi 0" };
    }

    let stripeRefundId: string | null = null;

    if (payment.paymentMethod === "stripe") {
      const stripe = getStripe();
      if (!stripe) return manualRefund(payment, "stripe_not_configured");
      if (!payment.stripePaymentIntentId) return manualRefund(payment, "missing_payment_intent");

      try {
        const paymentIntentId = await resolvePaymentIntentId(stripe, payment.stripePaymentIntentId);
        if (!paymentIntentId) return manualRefund(payment, "payment_intent_unresolved");

        // Klucz idempotencji z id płatności: powtórzony webhook / ponowienie
        // nie zleci drugiego zwrotu tej samej wpłaty.
        const refund = await stripe.refunds.create(
          {
            payment_intent: paymentIntentId,
            amount: Math.round(amount * 100), // Stripe uses cents
            reason: "requested_by_customer",
          },
          { idempotencyKey: depositRefundIdempotencyKey(payment.id), timeout: STRIPE_TIMEOUT_MS }
        );
        stripeRefundId = refund.id;
        logger.info("Stripe refund created", { refundId: refund.id, depositPaymentId: payment.id });
      } catch (stripeError) {
        // Pieniądze wciąż u nas — płatność zostaje `succeeded` (ponowienie
        // z tym samym kluczem albo zwrot ręczny).
        const e = stripeError as { type?: unknown; code?: unknown };
        return manualRefund(payment, "stripe_refund_failed", {
          stripeErrorType: typeof e?.type === "string" ? e.type : undefined,
          stripeErrorCode: typeof e?.code === "string" ? e.code : undefined,
        });
      }
    } else {
      // Metoda spoza Stripe (np. Blik P2P) — zwrot ręczny w salonie.
      logger.info("Non-Stripe payment marked as refunded for manual processing", {
        depositPaymentId: payment.id,
        paymentMethod: payment.paymentMethod,
      });
    }

    const updated = await db
      .update(depositPayments)
      .set({
        status: "refunded",
        stripeRefundId: stripeRefundId,
        refundedAt: new Date(),
        refundReason: reason,
      })
      .where(and(eq(depositPayments.id, payment.id), eq(depositPayments.status, "succeeded")))
      .returning({ id: depositPayments.id });

    if (updated.length !== 1) {
      // Ktoś zmienił płatność między odczytem a zapisem. Zwrot w Stripe
      // (jeśli był) jest jeden dzięki kluczowi — stan do sprawdzenia ręcznie.
      return manualRefund(payment, "payment_changed_concurrently", { stripeRefundId });
    }

    logger.info("Refund processed successfully", { appointmentId, depositPaymentId: payment.id, amount });

    return {
      success: true,
      refunded: true,
      refundId: stripeRefundId || `manual_${payment.id}`,
      amount,
      message: `Zwrot zadatku ${amount.toFixed(2)} PLN zostal zainicjowany`,
    };
  } catch (error) {
    logger.error(MANUAL_REFUND_LOG, {
      depositPaymentId,
      appointmentId,
      error: "refund_error",
      errorName: error instanceof Error ? error.name : typeof error,
    });
    return {
      success: false,
      refunded: false,
      error: "refund_error",
      message: "Blad podczas przetwarzania zwrotu",
    };
  }
}

export interface AppointmentDepositsRefund extends RefundResult {
  /** Liczba płatności `succeeded` wizyty w chwili odczytu. */
  paymentCount: number;
  /**
   * Kwota, która NIE wróciła do klienta (suma płatności z nieudanym zwrotem).
   * `amount` to suma udanych zwrotów — przy porażce toast musi pokazać tę
   * (recenzja, #98). Brak, gdy nie udało się nawet odczytać płatności.
   */
  failedAmount?: number;
  /** Płatność zatrzymana przez salon (najstarsza `succeeded`), jeśli forfeit. */
  forfeitedPaymentId?: string;
  results: Array<{ depositPaymentId: string } & RefundResult>;
}

/**
 * Predykat „płatność `succeeded` tej wizyty” — jedno źródło dla odczytów,
 * które decydują o zwrocie (#193).
 */
export function succeededDepositsWhere(appointmentId: string) {
  return and(eq(depositPayments.appointmentId, appointmentId), eq(depositPayments.status, "succeeded"));
}

/** Porządek płatności wizyty: od najstarszej (paid_at, potem id). */
function succeededDepositsOrder() {
  return [asc(depositPayments.paidAt), asc(depositPayments.id)] as const;
}

/**
 * Wszystkie płatności `succeeded` wizyty, od najstarszej (recenzja, #98).
 */
export async function selectSucceededDeposits(appointmentId: string) {
  return db
    .select()
    .from(depositPayments)
    .where(succeededDepositsWhere(appointmentId))
    .orderBy(...succeededDepositsOrder());
}

/**
 * Płatności `succeeded` wizyty w transakcji z kontekstem RLS salonu
 * (`forSalon(salonId).raw`), #193. Ten sam predykat i porządek co
 * `selectSucceededDeposits`, do tego jawne `eq(salonId)`. Jawna lista
 * kolumn — bez identyfikatorów Stripe, numeru BLIK i powodu zwrotu.
 */
export async function selectSucceededDepositsInTx(tx: DbTx, salonId: string, appointmentId: string) {
  return tx
    .select({
      id: depositPayments.id,
      appointmentId: depositPayments.appointmentId,
      salonId: depositPayments.salonId,
      amount: depositPayments.amount,
      currency: depositPayments.currency,
      paymentMethod: depositPayments.paymentMethod,
      status: depositPayments.status,
      paidAt: depositPayments.paidAt,
    })
    .from(depositPayments)
    .where(and(succeededDepositsWhere(appointmentId), eq(depositPayments.salonId, salonId)))
    .orderBy(...succeededDepositsOrder());
}

/**
 * `depositPaid=false` po udanym zwrocie wszystkich płatności wizyty.
 * Odczyt z blokadą wiersza, UPDATE i wpis dziennika zmian zadatku w jednej
 * transakcji; wpis i UPDATE tylko przy faktycznej zmianie true → false
 * (flaga już false/NULL = bez zapisu). Błąd wpisu cofa UPDATE i leci do wołającego.
 */
async function clearDepositPaidAfterRefund(appointmentId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [current] = await tx
      .select({ id: appointments.id, salonId: appointments.salonId, depositPaid: appointments.depositPaid })
      .from(appointments)
      .where(eq(appointments.id, appointmentId))
      .for("update");
    if (!current || current.depositPaid !== true) return;

    await tx.update(appointments).set({ depositPaid: false }).where(eq(appointments.id, current.id));
    await recordDepositStatusEvent(tx, {
      salonId: current.salonId,
      appointmentId: current.id,
      previousDepositPaid: true,
      depositPaid: false,
      source: "refund",
      actor: null,
    });
  });
}

/**
 * Zwrot zadatków anulowanej wizyty (recenzja, #98):
 * - każda płatność `succeeded` osobno, każda z własnym kluczem idempotencji;
 * - `forfeitReason` (klient odwołuje < 24 h): najstarsza `succeeded` jest
 *   zatrzymana (`forfeited`), pozostałe zwracane;
 * - częściowa porażka: nieudana płatność zostaje `succeeded` (logger.error
 *   „manual refund” w processAutomaticRefund), reszta idzie dalej;
 * - `depositPaid=false` tylko gdy wszystkie zwroty się udały i nic nie
 *   zatrzymano.
 */
export async function refundAppointmentDeposits(
  appointmentId: string,
  reason: string,
  options: { forfeitReason?: string } = {}
): Promise<AppointmentDepositsRefund> {
  let payments: Awaited<ReturnType<typeof selectSucceededDeposits>>;
  try {
    payments = await selectSucceededDeposits(appointmentId);
  } catch (error) {
    logger.error("Error selecting deposits to refund", {
      appointmentId,
      errorName: error instanceof Error ? error.name : typeof error,
    });
    return {
      success: false,
      refunded: false,
      error: "refund_error",
      message: "Blad podczas przetwarzania zwrotu",
      paymentCount: 0,
      results: [],
    };
  }

  if (payments.length === 0) {
    return { success: true, refunded: false, message: "Brak zadatku do zwrotu", paymentCount: 0, results: [] };
  }

  let toRefund = payments;
  let forfeitedPaymentId: string | undefined;
  if (options.forfeitReason) {
    const [oldest, ...rest] = payments;
    toRefund = rest;
    const forfeited = await db
      .update(depositPayments)
      .set({ status: "forfeited", refundReason: options.forfeitReason })
      .where(and(eq(depositPayments.id, oldest!.id), eq(depositPayments.status, "succeeded")))
      .returning({ id: depositPayments.id });
    if (forfeited.length === 1) forfeitedPaymentId = oldest!.id;
  }

  const results: AppointmentDepositsRefund["results"] = [];
  for (const payment of toRefund) {
    const result = await processAutomaticRefund(appointmentId, payment.id, reason);
    results.push({ depositPaymentId: payment.id, ...result });
  }

  const allRefunded = results.length > 0 && results.every((r) => r.refunded);
  const anyFailed = results.some((r) => !r.success);
  const amount = results.reduce((sum, r) => sum + (r.refunded ? (r.amount ?? 0) : 0), 0);
  const paymentAmount = new Map(toRefund.map((p) => [p.id, parseFloat(p.amount)]));
  const failedAmount = results.reduce(
    (sum, r) => sum + (r.success ? 0 : (paymentAmount.get(r.depositPaymentId) ?? 0)),
    0
  );

  if (allRefunded && !forfeitedPaymentId) {
    await clearDepositPaidAfterRefund(appointmentId);
  }

  return {
    success: !anyFailed,
    refunded: allRefunded,
    ...(results.find((r) => r.refundId)?.refundId ? { refundId: results.find((r) => r.refundId)!.refundId! } : {}),
    amount,
    failedAmount,
    ...(anyFailed ? { error: results.find((r) => r.error)?.error ?? "refund_error" } : {}),
    message: anyFailed
      ? "Zwrot zadatku nie powiodl sie - wymagana reczna obsluga zwrotu"
      : allRefunded
        ? `Zwrot zadatku ${amount.toFixed(2)} PLN zostal zainicjowany`
        : forfeitedPaymentId
          ? "Zadatek zatrzymany przez salon"
          : "Brak zadatku do zwrotu",
    paymentCount: payments.length,
    ...(forfeitedPaymentId ? { forfeitedPaymentId } : {}),
    results,
  };
}
