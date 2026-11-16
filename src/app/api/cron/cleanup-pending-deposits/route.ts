import { NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/auth-middleware";
import { logger } from "@/lib/logger";
// #193 P5a-2: trasa systemowa (requireCronSecret, cross-salon) — wyjście z rejestru system/
import { cleanupStaleDepositBookings } from "@/lib/server/system";

/**
 * POST /api/cron/cleanup-pending-deposits
 *
 * Backstop for lost Stripe webhooks: cancels "dead" deposit bookings so they
 * stop blocking slots.
 *
 * A deposit Checkout session lives ~31 minutes; on `checkout.session.expired`
 * / `async_payment_failed` the webhook marks the payment "failed" and cancels
 * the appointment. If that webhook never arrives, the appointment would block
 * the slot forever. This cron cancels appointments that are still "scheduled"
 * with depositPaid=false whose deposit payment is pending/failed and older
 * than 45 minutes (comfortably past the session lifetime).
 *
 * System path — the query runs in `system/deposits-cleanup.ts` (#193 P5a-2).
 */
async function handleCleanup(request: Request) {
  try {
    const cronError = await requireCronSecret(request);
    if (cronError) return cronError;

    const { cancelledAppointments, failedPayments } = await cleanupStaleDepositBookings();

    if (cancelledAppointments === 0) {
      return NextResponse.json({
        success: true,
        message: "Brak martwych rezerwacji z nieoplaconym zadatkiem",
        cancelledAppointments: 0,
        failedPayments: 0,
      });
    }

    return NextResponse.json({
      success: true,
      message: `Anulowano ${cancelledAppointments} rezerwacji z nieoplaconym zadatkiem`,
      cancelledAppointments,
      failedPayments,
    });
  } catch (error) {
    logger.error("[Cron] Cleanup pending deposits error", { error });
    return NextResponse.json(
      { success: false, error: "Nie udalo sie wyczyscic nieoplaconych zadatkow" },
      { status: 500 }
    );
  }
}

// Vercel Cron invokes the path with GET (Authorization: Bearer CRON_SECRET);
// POST stays for external schedulers. Both go through requireCronSecret.
export async function GET(request: Request) {
  return handleCleanup(request);
}

export async function POST(request: Request) {
  return handleCleanup(request);
}
