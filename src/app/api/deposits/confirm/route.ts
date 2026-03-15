import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { appointments, depositPayments, clients, services, employees } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { sendPaymentConfirmationSms } from "@/lib/sms";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";
import { validateBody, depositConfirmSchema } from "@/lib/api-validation";

import { logger } from "@/lib/logger";
/**
 * POST /api/deposits/confirm
 *
 * Confirms a deposit payment and updates the appointment status.
 * Sends SMS confirmation to the client with payment and appointment details.
 * In production, this would be called by Stripe webhook or after redirect from Stripe Checkout.
 * For development, this simulates the payment confirmation.
 */
export async function POST(request: Request) {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;
    const body = await request.json();
    const validationError = validateBody(depositConfirmSchema, body);
    if (validationError) {
      return NextResponse.json(validationError, { status: 400 });
    }
    const { depositPaymentId, sessionId } = body;

    // Get the deposit payment record
    const [payment] = await db
      .select()
      .from(depositPayments)
      .where(eq(depositPayments.id, depositPaymentId));

    if (!payment) {
      return NextResponse.json(
        { success: false, error: "Deposit payment not found" },
        { status: 404 }
      );
    }

    if (payment.status === "succeeded") {
      return NextResponse.json({
        success: true,
        data: { message: "Payment already confirmed", depositPaymentId },
      });
    }

    // Update the deposit payment to "succeeded"
    const [updatedPayment] = await db
      .update(depositPayments)
      .set({
        status: "succeeded",
        paidAt: new Date(),
        stripePaymentIntentId: sessionId || `sim_${Date.now()}`,
      })
      .where(eq(depositPayments.id, depositPaymentId))
      .returning();

    // Update the appointment to mark deposit as paid and confirm
    const [updatedAppointment] = await db
      .update(appointments)
      .set({
        depositPaid: true,
        status: "confirmed",
        updatedAt: new Date(),
      })
      .where(eq(appointments.id, payment.appointmentId))
      .returning();

    logger.info(`[Deposit API] Payment confirmed: ${depositPaymentId}, appointment: ${payment.appointmentId}`);

    // Send SMS confirmation to client (async, don't block the response)
    let smsSent = false;
    try {
      if (updatedAppointment && updatedAppointment.clientId) {
        // Fetch client details
        const [client] = await db
          .select()
          .from(clients)
          .where(eq(clients.id, updatedAppointment.clientId));

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

        if (client && client.phone) {
          const smsResult = await sendPaymentConfirmationSms({
            clientPhone: client.phone,
            clientName: `${client.firstName} ${client.lastName}`,
            amount: parseFloat(updatedPayment!.amount),
            currency: updatedPayment!.currency,
            serviceName,
            appointmentDate: updatedAppointment.startTime,
            employeeName: employee
              ? `${employee.firstName} ${employee.lastName}`
              : "pracownik",
            salonId: payment.salonId,
            clientId: client.id,
          });
          smsSent = smsResult.success;
          logger.info(`[Deposit API] SMS confirmation ${smsSent ? "sent" : "failed"} for client ${client.id}`);
        } else {
          logger.info(`[Deposit API] No phone number for client, skipping SMS`);
        }
      }
    } catch (smsError) {
      // SMS failure should not affect payment confirmation
      logger.error("[Deposit API] SMS notification error (non-blocking)", { error: smsError });
    }

    return NextResponse.json({
      success: true,
      data: {
        depositPayment: updatedPayment,
        appointment: updatedAppointment,
        message: "Platnosc zadatku potwierdzona",
        smsSent,
      },
    });
  } catch (error) {
    logger.error("[Deposit API] Error confirming payment", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to confirm deposit payment" },
      { status: 500 }
    );
  }
}
