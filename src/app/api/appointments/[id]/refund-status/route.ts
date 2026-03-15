import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { depositPayments, appointments } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";

// GET /api/appointments/[id]/refund-status - Get refund status for an appointment
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

    const { id } = await params;

    // Check if appointment exists
    const [appointment] = await db
      .select()
      .from(appointments)
      .where(eq(appointments.id, id))
      .limit(1);

    if (!appointment) {
      return NextResponse.json(
        { success: false, error: "Appointment not found" },
        { status: 404 }
      );
    }

    // Find deposit payment for this appointment
    const [payment] = await db
      .select()
      .from(depositPayments)
      .where(eq(depositPayments.appointmentId, id));

    if (!payment) {
      return NextResponse.json({
        success: true,
        data: {
          appointmentId: id,
          hasDeposit: false,
          depositPaid: false,
          refundStatus: "none",
          refundAmount: 0,
        },
      });
    }

    // Determine refund/forfeit status
    let refundStatus: "refunded" | "forfeited" | "none" = "none";
    if (payment.status === "refunded") {
      refundStatus = "refunded";
    } else if (payment.status === "forfeited") {
      refundStatus = "forfeited";
    }

    return NextResponse.json({
      success: true,
      data: {
        appointmentId: id,
        hasDeposit: true,
        depositAmount: parseFloat(payment.amount),
        depositPaid: appointment.depositPaid,
        paymentMethod: payment.paymentMethod,
        paymentStatus: payment.status,
        refundStatus,
        refundAmount: payment.status === "refunded" ? parseFloat(payment.amount) : 0,
        forfeitedAmount: payment.status === "forfeited" ? parseFloat(payment.amount) : 0,
        refundedAt: payment.refundedAt,
        stripeRefundId: payment.stripeRefundId,
        refundReason: payment.refundReason,
      },
    });
  } catch (error) {
    console.error("[Refund Status API] Error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to get refund status" },
      { status: 500 }
    );
  }
}
