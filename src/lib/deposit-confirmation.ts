import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { recordDepositStatusEvent } from "@/lib/deposit-status-events";
import { logger } from "@/lib/logger";
import { processAutomaticRefund } from "@/lib/refund";
import {
  appointments,
  depositPayments,
  clients,
  services,
  employees,
  salons,
} from "@/lib/schema";
import { forSalon } from "@/lib/server/repository";
import { sendPaymentConfirmationSms } from "@/lib/sms";

export interface ConfirmDepositOptions {
  /**
   * Stripe payment_intent id to persist on the deposit payment record.
   * refund.ts uses stripePaymentIntentId to issue refunds, so the webhook
   * MUST pass the real `pi_...` id here. When omitted, the existing value
   * (e.g. the Checkout session reference) is left untouched.
   */
  paymentIntentId?: string | undefined;
  /**
   * `payment_status` sesji Checkout ze zdarzenia Stripe. Tylko `"paid"`
   * pozwala zapisać wpłatę płatności już `failed` (anulowanie przed wpłatą,
   * #70; warunek Ethana). Bez tego (np. dev-symulator) `failed` = not_pending.
   */
  stripePaymentStatus?: string | undefined;
}

/**
 * Wpłata zadatku, której salon nie oczekuje (#70): płatność zapisana jako
 * `succeeded`, wizyta bez zmian, potem automatyczny zwrot TEJ płatności.
 * `reason`: wizyta już nieaktywna albo zadatek już opłacony inną płatnością.
 */
export interface InactiveAppointmentDeposit {
  appointmentStatus: string;
  reason: "appointment_inactive" | "deposit_already_paid";
  refunded: boolean;
  refundId?: string | undefined;
}

export interface ConfirmDepositResult {
  success: boolean;
  alreadyConfirmed: boolean;
  smsSent: boolean;
  depositPayment?: typeof depositPayments.$inferSelect | undefined;
  appointment?: typeof appointments.$inferSelect | undefined;
  /**
   * - "not_found": no such deposit payment
   * - "not_pending": payment is in a terminal state (failed/refunded) and is
   *   never resurrected — e.g. a late async payment success after the
   *   appointment was already cancelled. Requires manual handling (refund).
   */
  error?: "not_found" | "not_pending";
  /** Wizyta nie była `scheduled`/`confirmed` w chwili wpłaty (#70). */
  inactiveAppointment?: InactiveAppointmentDeposit | undefined;
}

/** Wpłata może zmienić tylko wizytę z tych stanów (#70 pkt 3). */
const PAYABLE_APPOINTMENT_STATUSES = new Set(["scheduled", "confirmed"]);
/**
 * `failed` ustawia anulowanie wizyty (DELETE, cron, `checkout.session.expired`)
 * PRZED wpłatą. Jeśli Stripe mimo to pobrał pieniądze (otwarta sesja,
 * `payment_status === "paid"`), księga musi to pokazać: osobny warunkowy
 * UPDATE `WHERE status = 'failed'` w tej samej transakcji co odczyt wizyty.
 * `refunded` jest końcowe (warunki Ethana, #70).
 */
function mayConfirmFailed(options: ConfirmDepositOptions): boolean {
  return options.stripePaymentStatus === "paid";
}

/**
 * #70 — wizyta anulowana (albo zakończona) przed wpłatą: płatność zostaje
 * `succeeded`, wizyta NIE zmienia statusu ani `depositPaid`, bez SMS
 * „potwierdzono wizytę”, potem automatyczny zwrot. Nieudany zwrot =
 * `logger.error` „manual refund” (płatność zostaje `succeeded`).
 *
 * Confirm a deposit payment: transactionally mark the payment "succeeded"
 * (storing the Stripe payment_intent id for future refunds) and the
 * appointment as confirmed with depositPaid=true, then send the SMS
 * confirmation to the client or guest (non-blocking — SMS failure never
 * fails the confirmation).
 *
 * Used by:
 * - /api/stripe/webhook on `checkout.session.completed` /
 *   `checkout.session.async_payment_succeeded` (production path, raw db
 *   access is fine here per ADR-001 — system path, no salon scoping)
 * - /api/deposits/confirm (dev-only simulator)
 *
 * Idempotent & race-safe: the UPDATE is guarded by `status IN ('pending',
 * 'failed')`. A second confirmation (duplicate webhook delivery) is a no-op,
 * and a "refunded" payment is NEVER flipped back to succeeded.
 *
 * Kolejność blokad jak w DELETE wizyty, cronie i `checkout.session.expired`:
 * najpierw wiersz płatności (UPDATE), potem wiersz wizyty (`FOR UPDATE`) —
 * decyzja o wizycie zapada na stanie po blokadzie, bez zakleszczeń.
 */
export async function confirmDepositPayment(
  depositPaymentId: string,
  options: ConfirmDepositOptions = {}
): Promise<ConfirmDepositResult> {
  // Get the deposit payment record
  const [payment] = await db
    .select()
    .from(depositPayments)
    .where(eq(depositPayments.id, depositPaymentId));

  if (!payment) {
    return {
      success: false,
      alreadyConfirmed: false,
      smsSent: false,
      error: "not_found",
    };
  }

  if (payment.status === "succeeded") {
    return {
      success: true,
      alreadyConfirmed: true,
      smsSent: false,
      depositPayment: payment,
    };
  }

  if (payment.status !== "pending" && !(payment.status === "failed" && mayConfirmFailed(options))) {
    // refunded — terminal; failed bez potwierdzonej wpłaty Stripe — bez zmian.
    logger.warn("[Deposit] Confirmation attempted on non-pending payment", {
      depositPaymentId,
      status: payment.status,
    });
    return {
      success: false,
      alreadyConfirmed: false,
      smsSent: false,
      depositPayment: payment,
      error: "not_pending",
    };
  }

  // Update deposit payment and appointment atomically. The status guard
  // makes this idempotent under concurrent deliveries: whoever loses the
  // race gets zero rows back and no-ops.
  const paidValues = {
    status: "succeeded",
    paidAt: new Date(),
    ...(options.paymentIntentId ? { stripePaymentIntentId: options.paymentIntentId } : {}),
  };
  const txResult = await db.transaction(async (tx) => {
    let [updatedPayment] = await tx
      .update(depositPayments)
      .set(paidValues)
      .where(and(eq(depositPayments.id, depositPaymentId), eq(depositPayments.status, "pending")))
      .returning();

    // Anulowanie (DELETE / cron / expired) wygrało wyścig i ustawiło `failed`,
    // a Stripe pobrał pieniądze: warunkowo `failed → succeeded`.
    if (!updatedPayment && mayConfirmFailed(options)) {
      [updatedPayment] = await tx
        .update(depositPayments)
        .set(paidValues)
        .where(and(eq(depositPayments.id, depositPaymentId), eq(depositPayments.status, "failed")))
        .returning();
    }

    if (!updatedPayment) return null;

    // Stan wizyty PO blokadzie płatności — anulowanie (DELETE / cron)
    // czeka na nas albo już się zatwierdziło i to widzimy.
    const [current] = await tx
      .select({
        id: appointments.id,
        salonId: appointments.salonId,
        status: appointments.status,
        depositPaid: appointments.depositPaid,
      })
      .from(appointments)
      .where(eq(appointments.id, payment.appointmentId))
      .for("update");

    if (!current || !PAYABLE_APPOINTMENT_STATUSES.has(current.status)) {
      return {
        updatedPayment,
        refundInstead: { appointmentStatus: current?.status ?? "missing", reason: "appointment_inactive" as const },
      };
    }
    // Zadatek już opłacony inną płatnością (np. dwie sesje Checkout) —
    // druga wpłata wraca do klienta, wizyta bez zmian.
    if (current.depositPaid) {
      return {
        updatedPayment,
        refundInstead: { appointmentStatus: current.status, reason: "deposit_already_paid" as const },
      };
    }

    const wasScheduled = current.status === "scheduled";
    const [updatedAppointment] = await tx
      .update(appointments)
      .set({
        depositPaid: true,
        // `confirmed` (potwierdzona ręcznie przed wpłatą) zostaje `confirmed`.
        status: "confirmed",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(appointments.id, payment.appointmentId),
          inArray(appointments.status, [...PAYABLE_APPOINTMENT_STATUSES])
        )
      )
      .returning();

    // Dziennik zmian zadatku w TEJ SAMEJ transakcji, tylko przy faktycznej
    // zmianie false → true: błąd wpisu cofa płatność i wizytę razem.
    if (updatedAppointment) {
      await recordDepositStatusEvent(tx, {
        salonId: current.salonId,
        appointmentId: current.id,
        previousDepositPaid: current.depositPaid,
        depositPaid: true,
        source: "stripe_confirmation",
        actor: null,
      });
    }

    return { updatedPayment, updatedAppointment, wasScheduled };
  });

  if (!txResult) {
    // Guard nie złapał wiersza: konkurencyjne potwierdzenie (→ succeeded)
    // albo anulowanie ustawiło `failed` bez potwierdzonej wpłaty. Decyzja
    // na świeżym stanie, nie na odczycie sprzed transakcji.
    const [current] = await db
      .select()
      .from(depositPayments)
      .where(eq(depositPayments.id, depositPaymentId));
    if (current?.status === "succeeded") {
      return { success: true, alreadyConfirmed: true, smsSent: false, depositPayment: current };
    }
    logger.warn("[Deposit] Payment left pending before confirmation", {
      depositPaymentId,
      status: current?.status ?? "missing",
    });
    return {
      success: false,
      alreadyConfirmed: false,
      smsSent: false,
      ...(current ? { depositPayment: current } : {}),
      error: current ? "not_pending" : "not_found",
    };
  }

  if ("refundInstead" in txResult) {
    return refundUnexpectedDeposit(payment, txResult.updatedPayment, txResult.refundInstead);
  }

  const { updatedPayment, updatedAppointment, wasScheduled } = txResult;

  // Wizyta `confirmed` przed wpłatą: zadatek zapisany, bez drugiego SMS
  // „potwierdzono wizytę” (warunek Ethana).
  if (!wasScheduled) {
    logger.info("[Deposit] Deposit paid for an already confirmed appointment — no SMS", {
      depositPaymentId,
      appointmentId: payment.appointmentId,
    });
    return {
      success: true,
      alreadyConfirmed: false,
      smsSent: false,
      depositPayment: updatedPayment,
      appointment: updatedAppointment,
    };
  }

  logger.info(
    `[Deposit] Payment confirmed: ${depositPaymentId}, appointment: ${payment.appointmentId}`
  );

  // Send SMS confirmation to the client or guest (failure must not affect
  // the confirmation)
  let smsSent = false;
  try {
    if (updatedAppointment) {
      // Resolve the recipient: client record, or guest data on the appointment
      let recipientPhone: string | null = null;
      let recipientName = "Kliencie";
      let recipientClientId: string | undefined;

      if (updatedAppointment.clientId) {
        const [client] = await db
          .select()
          .from(clients)
          .where(eq(clients.id, updatedAppointment.clientId));
        if (client && client.phone) {
          recipientPhone = client.phone;
          recipientName = `${client.firstName} ${client.lastName}`;
          recipientClientId = client.id;
        }
      } else if (updatedAppointment.guestPhone) {
        recipientPhone = updatedAppointment.guestPhone;
        recipientName = updatedAppointment.guestName || "Kliencie";
      }

      if (recipientPhone) {
        // Fetch employee details
        const [employee] = await db
          .select()
          .from(employees)
          .where(eq(employees.id, updatedAppointment.employeeId));

        // Fetch service details
        let serviceName = "Wizyta";
        if (updatedAppointment.serviceId) {
          const [service] = await db
            .select()
            .from(services)
            .where(eq(services.id, updatedAppointment.serviceId));
          if (service) {
            serviceName = service.name;
          }
        }

        // Nazwa salonu do treści SMS przez bramę salonu płatności (#193);
        // brak wiersza → SMS bez nazwy salonu, błąd → catch poniżej.
        const [salon] = await forSalon(payment.salonId).raw((tx) =>
          tx
            .select({ name: salons.name })
            .from(salons)
            .where(eq(salons.id, payment.salonId))
        );

        const smsResult = await sendPaymentConfirmationSms({
          clientPhone: recipientPhone,
          clientName: recipientName,
          amount: parseFloat(updatedPayment.amount),
          currency: updatedPayment.currency,
          serviceName,
          appointmentDate: updatedAppointment.startTime,
          employeeName: employee
            ? `${employee.firstName} ${employee.lastName}`
            : "pracownik",
          salonName: salon?.name ?? null,
          salonId: payment.salonId,
          ...(recipientClientId ? { clientId: recipientClientId } : {}),
        });
        smsSent = smsResult.success;
        logger.info(
          `[Deposit] SMS confirmation ${smsSent ? "sent" : "failed"} (${recipientClientId ? `client ${recipientClientId}` : "guest"})`
        );
      } else {
        logger.info(`[Deposit] No phone number for client/guest, skipping SMS`);
      }
    }
  } catch (smsError) {
    // SMS failure should not affect payment confirmation
    logger.error("[Deposit] SMS notification error (non-blocking)", { error: smsError });
  }

  return {
    success: true,
    alreadyConfirmed: false,
    smsSent,
    depositPayment: updatedPayment,
    appointment: updatedAppointment,
  };
}

async function refundUnexpectedDeposit(
  payment: typeof depositPayments.$inferSelect,
  updatedPayment: typeof depositPayments.$inferSelect,
  why: { appointmentStatus: string; reason: InactiveAppointmentDeposit["reason"] }
): Promise<ConfirmDepositResult> {
  // Same identyfikatory — bez danych osobowych.
  const context = {
    depositPaymentId: payment.id,
    appointmentId: payment.appointmentId,
    salonId: payment.salonId,
    appointmentStatus: why.appointmentStatus,
    reason: why.reason,
  };
  logger.warn("[Deposit] Unexpected deposit payment — refunding", context);

  // Zwrot TEJ płatności (klucz idempotencji z jej id w refund.ts);
  // `depositPaid` wizyty bez zmian.
  const refund = await processAutomaticRefund(
    payment.appointmentId,
    payment.id,
    why.reason === "appointment_inactive"
      ? "Wplata zadatku po anulowaniu wizyty - automatyczny zwrot"
      : "Druga wplata zadatku za te sama wizyte - automatyczny zwrot"
  );
  if (!refund.refunded) {
    logger.error("Deposit paid for cancelled appointment — manual refund", context);
  } else {
    logger.info("[Deposit] Unexpected deposit refunded automatically", { ...context, refundId: refund.refundId });
  }

  return {
    success: true,
    alreadyConfirmed: false,
    smsSent: false,
    depositPayment: updatedPayment,
    inactiveAppointment: {
      appointmentStatus: why.appointmentStatus,
      reason: why.reason,
      refunded: refund.refunded,
      refundId: refund.refundId,
    },
  };
}
