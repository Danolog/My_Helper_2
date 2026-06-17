import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { appointments, depositPayments, clients, services, employees } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { sendPaymentConfirmationSms } from "@/lib/sms";
import { depositConfirmSchema } from "@/lib/api-validation";
import { strictRateLimit, getClientIp } from "@/lib/rate-limit";

import { logger } from "@/lib/logger";
/**
 * POST /api/deposits/confirm
 *
 * DEV-ONLY simulator for confirming a deposit payment. In production the
 * source of truth for deposit confirmation is the SIGNED Stripe webhook
 * (`/api/stripe/webhook`), never this open endpoint — confirming a payment
 * by record id alone, without a verified Stripe signature, would let anyone
 * mark a deposit "paid" without paying (P0-D). Therefore this route is
 * disabled when NODE_ENV === "production".
 *
 * Rate limiting (strictRateLimit) additionally throttles abuse in dev.
 */
export async function POST(request: Request) {
  try {
    // Hard production guard: confirmation in prod only via signed Stripe webhook.
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json(
        { success: false, error: "Not found" },
        { status: 404 }
      );
    }

    // Rate limit to throttle brute-force of the deposit id in dev.
    const ip = getClientIp(request);
    const rateLimitResult = strictRateLimit.check(ip);
    if (!rateLimitResult.success) {
      return NextResponse.json(
        { success: false, error: "Zbyt wiele żądań. Spróbuj ponownie później." },
        { status: 429, headers: { "Retry-After": String(Math.ceil(rateLimitResult.reset / 1000)) } }
      );
    }

    const body = await request.json();
    const parsed = depositConfirmSchema.safeParse(body);
    if (!parsed.success) {
      const details: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const path = issue.path.join(".") || "_root";
        if (!details[path]) details[path] = issue.message;
      }
      return NextResponse.json(
        { success: false, error: "Validation failed", details },
        { status: 400 }
      );
    }
    // Read ONLY validated data — never the raw body (P0-D / P1).
    const { depositPaymentId, sessionId } = parsed.data;

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

    // Update deposit payment and appointment atomically
    const { updatedPayment, updatedAppointment } = await db.transaction(async (tx) => {
      const [_updatedPayment] = await tx
        .update(depositPayments)
        .set({
          status: "succeeded",
          paidAt: new Date(),
          stripePaymentIntentId: sessionId || `sim_${Date.now()}`,
        })
        .where(eq(depositPayments.id, depositPaymentId))
        .returning();

      const [_updatedAppointment] = await tx
        .update(appointments)
        .set({
          depositPaid: true,
          status: "confirmed",
          updatedAt: new Date(),
        })
        .where(eq(appointments.id, payment.appointmentId))
        .returning();

      return { updatedPayment: _updatedPayment, updatedAppointment: _updatedAppointment };
    });

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
