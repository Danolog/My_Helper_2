import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";
import { getUserSalonId } from "@/lib/get-user-salon";
import { logger } from "@/lib/logger";
import { depositPayments, appointments } from "@/lib/schema";
import { forSalon } from "@/lib/server/repository";
// GET /api/appointments/[id]/refund-status - Get refund status for an appointment
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

    const salonId = await getUserSalonId();
    if (!salonId) {
      return NextResponse.json(
        { success: false, error: "Salon not found" },
        { status: 404 }
      );
    }

    const { id } = await params;

    // Check if appointment exists in the caller's salon
    const appointment = await forSalon(salonId).findOne(appointments, id);

    if (!appointment) {
      return NextResponse.json(
        { success: false, error: "Appointment not found" },
        { status: 404 }
      );
    }

    // Find deposit payment for this appointment (depositPayments salon-scoped — RLS w kontekscie)
    const [payment] = await forSalon(salonId).raw((tx) =>
      tx
        .select()
        .from(depositPayments)
        .where(
          and(
            eq(depositPayments.appointmentId, id),
            eq(depositPayments.salonId, salonId)
          )
        )
    );

    if (!payment) {
      // Brak wiersza platnosci online: zadatek (jesli jest w wizycie) salon
      // rozlicza poza MyHelper (np. BLIK na telefon salonu, reczne oznaczenie
      // wplaty). Aplikacja nie zna ani nie decyduje o zwrocie — stad
      // refundStatus "none" i zerowe kwoty zwrotu/przepadku.
      // Number(null|""|"abc") daje 0 albo NaN, a oba nie przechodza "> 0".
      const depositAmount = Number(appointment.depositAmount);
      const hasDeposit = depositAmount > 0;
      return NextResponse.json({
        success: true,
        data: {
          appointmentId: id,
          hasDeposit,
          ...(hasDeposit ? { depositAmount } : {}),
          depositPaid: appointment.depositPaid,
          paymentMethod: null,
          paymentStatus: null,
          refundStatus: "none",
          refundAmount: 0,
          forfeitedAmount: 0,
          settledOutsideApp: true,
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
        settledOutsideApp: false,
      },
    });
  } catch (error) {
    logger.error("[Refund Status API] Error", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to get refund status" },
      { status: 500 }
    );
  }
}
