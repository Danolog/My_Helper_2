import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  appointments,
  depositPayments,
  clients,
  services,
  employees,
} from "@/lib/schema";
import { sendPaymentConfirmationSms } from "@/lib/sms";

export interface ConfirmDepositOptions {
  /**
   * Stripe payment_intent id to persist on the deposit payment record.
   * refund.ts uses stripePaymentIntentId to issue refunds, so the webhook
   * MUST pass the real `pi_...` id here. When omitted, the existing value
   * (e.g. the Checkout session reference) is left untouched.
   */
  paymentIntentId?: string | undefined;
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
}

/**
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
 * Idempotent & race-safe: the UPDATE is guarded by `status = 'pending'`.
 * A second confirmation (duplicate webhook delivery) is a no-op, and a
 * "refunded"/"failed" payment is NEVER flipped back to succeeded.
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

  if (payment.status !== "pending") {
    // failed / refunded — terminal states, never resurrected here.
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

  // Update deposit payment and appointment atomically. The `status =
  // 'pending'` guard makes this idempotent under concurrent deliveries:
  // whoever loses the race gets zero rows back and no-ops.
  const txResult = await db.transaction(async (tx) => {
    const [updatedPayment] = await tx
      .update(depositPayments)
      .set({
        status: "succeeded",
        paidAt: new Date(),
        ...(options.paymentIntentId
          ? { stripePaymentIntentId: options.paymentIntentId }
          : {}),
      })
      .where(
        and(
          eq(depositPayments.id, depositPaymentId),
          eq(depositPayments.status, "pending")
        )
      )
      .returning();

    if (!updatedPayment) return null;

    const [updatedAppointment] = await tx
      .update(appointments)
      .set({
        depositPaid: true,
        status: "confirmed",
        updatedAt: new Date(),
      })
      .where(eq(appointments.id, payment.appointmentId))
      .returning();

    return { updatedPayment, updatedAppointment };
  });

  if (!txResult) {
    // Lost the race against a concurrent confirmation — already done.
    return { success: true, alreadyConfirmed: true, smsSent: false };
  }

  const { updatedPayment, updatedAppointment } = txResult;

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
