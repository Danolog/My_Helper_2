import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { appointments, depositPayments } from "@/lib/schema";
import { eq } from "drizzle-orm";

/**
 * POST /api/deposits/confirm
 *
 * Confirms a deposit payment and updates the appointment status.
 * In production, this would be called by Stripe webhook or after redirect from Stripe Checkout.
 * For development, this simulates the payment confirmation.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { depositPaymentId, sessionId } = body;

    if (!depositPaymentId) {
      return NextResponse.json(
        { success: false, error: "depositPaymentId is required" },
        { status: 400 }
      );
    }

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

    console.log(`[Deposit API] Payment confirmed: ${depositPaymentId}, appointment: ${payment.appointmentId}`);

    return NextResponse.json({
      success: true,
      data: {
        depositPayment: updatedPayment,
        appointment: updatedAppointment,
        message: "Platnosc zadatku potwierdzona",
      },
    });
  } catch (error) {
    console.error("[Deposit API] Error confirming payment:", error);
    return NextResponse.json(
      { success: false, error: "Failed to confirm deposit payment" },
      { status: 500 }
    );
  }
}
