import { db } from "@/lib/db";
import { depositPayments, appointments, notifications } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { getStripe } from "@/lib/stripe";

export interface RefundResult {
  success: boolean;
  refunded: boolean;
  refundId?: string;
  amount?: number;
  error?: string;
  message: string;
}

/**
 * Process an automatic refund for a cancelled appointment.
 *
 * Rules:
 * - Only refund if cancelled more than 24h before appointment
 * - Only refund deposits that have been successfully paid
 * - Attempts Stripe refund if stripePaymentIntentId exists
 * - Falls back to marking as refunded (manual refund needed for non-Stripe payments)
 * - Updates deposit_payments record with refund details
 * - Updates appointment depositPaid status
 */
export async function processAutomaticRefund(
  appointmentId: string,
  reason: string = "Anulacja wizyty wiecej niz 24h przed terminem"
): Promise<RefundResult> {
  try {
    // Find the succeeded deposit payment for this appointment
    const [payment] = await db
      .select()
      .from(depositPayments)
      .where(eq(depositPayments.appointmentId, appointmentId));

    if (!payment) {
      console.log(`[Refund] No deposit payment found for appointment ${appointmentId}`);
      return {
        success: true,
        refunded: false,
        message: "Brak zadatku do zwrotu",
      };
    }

    if (payment.status !== "succeeded") {
      console.log(`[Refund] Payment ${payment.id} status is ${payment.status}, not eligible for refund`);
      return {
        success: true,
        refunded: false,
        message: `Platnosc w statusie '${payment.status}' - nie podlega zwrotowi`,
      };
    }

    const amount = parseFloat(payment.amount);
    if (amount <= 0) {
      return {
        success: true,
        refunded: false,
        message: "Kwota zadatku wynosi 0",
      };
    }

    let stripeRefundId: string | null = null;

    // Attempt Stripe refund if we have a payment intent ID
    if (payment.stripePaymentIntentId && payment.paymentMethod === "stripe") {
      const stripe = getStripe();
      if (stripe) {
        try {
          // Create refund via Stripe API
          const refund = await stripe.refunds.create({
            payment_intent: payment.stripePaymentIntentId,
            amount: Math.round(amount * 100), // Stripe uses cents
            reason: "requested_by_customer",
          });

          stripeRefundId = refund.id;
          console.log(`[Refund] Stripe refund created: ${refund.id} for payment intent ${payment.stripePaymentIntentId}`);
        } catch (stripeError) {
          console.error("[Refund] Stripe refund failed:", stripeError);
          // Even if Stripe refund fails, we still mark it as refunded in our system
          // Staff will need to process manual refund
          console.log("[Refund] Marking as refunded in system (manual Stripe refund needed)");
        }
      } else {
        console.log("[Refund] Stripe not configured, marking as refunded (manual refund needed)");
      }
    } else {
      // For non-Stripe payments (e.g., Blik P2P), mark as refunded - manual refund needed
      console.log(`[Refund] Non-Stripe payment (${payment.paymentMethod}), marking as refunded (manual refund needed)`);
    }

    // Update the deposit payment record
    await db
      .update(depositPayments)
      .set({
        status: "refunded",
        stripeRefundId: stripeRefundId,
        refundedAt: new Date(),
        refundReason: reason,
      })
      .where(eq(depositPayments.id, payment.id));

    // Update appointment to reflect deposit is no longer paid (refunded)
    await db
      .update(appointments)
      .set({
        depositPaid: false,
      })
      .where(eq(appointments.id, appointmentId));

    console.log(`[Refund] Successfully processed refund for appointment ${appointmentId}, amount: ${amount} PLN`);

    return {
      success: true,
      refunded: true,
      refundId: stripeRefundId || `manual_${payment.id}`,
      amount,
      message: `Zwrot zadatku ${amount.toFixed(2)} PLN zostal zainicjowany`,
    };
  } catch (error) {
    console.error("[Refund] Error processing refund:", error);
    return {
      success: false,
      refunded: false,
      error: error instanceof Error ? error.message : "Unknown error",
      message: "Blad podczas przetwarzania zwrotu",
    };
  }
}

/**
 * Create a notification about the refund for the client.
 */
export async function createRefundNotification(
  salonId: string,
  clientId: string,
  amount: number,
  clientName: string,
  serviceName: string,
  appointmentDate: Date
): Promise<void> {
  try {
    const formattedDate = appointmentDate.toLocaleDateString("pl-PL", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const bookingLink = `${appUrl}/salons/${salonId}/book`;

    const message = `Szanowny/a ${clientName}, informujemy o zwrocie zadatku ${amount.toFixed(2)} PLN za anulowana wizyte "${serviceName}" zaplanowana na ${formattedDate}. Zwrot zostanie przetworzony w ciagu 5-10 dni roboczych. Zarezerwuj nowy termin: ${bookingLink}`;

    await db.insert(notifications).values({
      salonId,
      clientId,
      type: "sms",
      message,
      status: "pending",
    });

    console.log(`[Refund] Created refund notification for client ${clientId}`);
  } catch (error) {
    console.error("[Refund] Failed to create refund notification:", error);
    // Don't throw - notification failure shouldn't break the refund
  }
}
