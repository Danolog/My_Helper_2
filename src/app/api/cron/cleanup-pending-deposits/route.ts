import { NextResponse } from "next/server";
import { and, eq, inArray, lt } from "drizzle-orm";
import { requireCronSecret } from "@/lib/auth-middleware";
// ADR-001 sekcja 4: trasa systemowa (requireCronSecret, cross-salon) — świadomie surowe db
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { appointments, depositPayments } from "@/lib/schema";

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
 * System path — raw db access without salon scoping is intentional (ADR-001).
 */
const STALE_DEPOSIT_MINUTES = 45;

async function handleCleanup(request: Request) {
  try {
    const cronError = await requireCronSecret(request);
    if (cronError) return cronError;

    const cutoff = new Date(Date.now() - STALE_DEPOSIT_MINUTES * 60 * 1000);

    // Find stale deposit bookings: unpaid deposit payment older than the
    // cutoff whose appointment is still scheduled and unpaid.
    const stale = await db
      .select({
        paymentId: depositPayments.id,
        paymentStatus: depositPayments.status,
        appointmentId: depositPayments.appointmentId,
      })
      .from(depositPayments)
      .innerJoin(appointments, eq(depositPayments.appointmentId, appointments.id))
      .where(
        and(
          inArray(depositPayments.status, ["pending", "failed"]),
          lt(depositPayments.createdAt, cutoff),
          eq(appointments.status, "scheduled"),
          eq(appointments.depositPaid, false)
        )
      );

    if (stale.length === 0) {
      return NextResponse.json({
        success: true,
        message: "Brak martwych rezerwacji z nieoplaconym zadatkiem",
        cancelledAppointments: 0,
        failedPayments: 0,
      });
    }

    const pendingPaymentIds = stale
      .filter((row) => row.paymentStatus === "pending")
      .map((row) => row.paymentId);
    const appointmentIds = [...new Set(stale.map((row) => row.appointmentId))];

    await db.transaction(async (tx) => {
      if (pendingPaymentIds.length > 0) {
        await tx
          .update(depositPayments)
          .set({ status: "failed" })
          .where(
            and(
              inArray(depositPayments.id, pendingPaymentIds),
              // Guard against a webhook confirming concurrently
              eq(depositPayments.status, "pending")
            )
          );
      }

      await tx
        .update(appointments)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(
          and(
            inArray(appointments.id, appointmentIds),
            eq(appointments.status, "scheduled"),
            eq(appointments.depositPaid, false)
          )
        );
    });

    logger.info("[Cron] Cancelled stale unpaid deposit bookings", {
      cancelledAppointments: appointmentIds.length,
      failedPayments: pendingPaymentIds.length,
      cutoff: cutoff.toISOString(),
    });

    return NextResponse.json({
      success: true,
      message: `Anulowano ${appointmentIds.length} rezerwacji z nieoplaconym zadatkiem`,
      cancelledAppointments: appointmentIds.length,
      failedPayments: pendingPaymentIds.length,
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
