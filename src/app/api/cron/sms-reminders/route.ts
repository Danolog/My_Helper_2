import { NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/auth-middleware";
import { logger } from "@/lib/logger";
// #193 P5a-2: trasa systemowa (requireCronSecret, cross-salon) — wyjścia z rejestru system/
import { findDueSmsReminders, getPendingCronReminders, markCronRemindersSent } from "@/lib/server/system";
import { sendAppointmentReminderSms } from "@/lib/sms";

// Wysyłka SMS w pętli może trwać — bez tego domyślny timeout ucina cron w połowie
export const maxDuration = 300;

// Górna granica na jedno uruchomienie; cron co 5-10 min dogoni resztę
const BATCH_LIMIT = 200;

/**
 * POST /api/cron/sms-reminders
 *
 * Triggered periodically (e.g., every 5 minutes by a cron job or Vercel cron).
 * Finds appointments starting within 30-90 minutes from now that:
 *   - Have a linked client with a phone number
 *   - Are in 'scheduled' or 'confirmed' status (not cancelled/completed)
 *   - Haven't had a 1h reminder sent yet (reminder1hSentAt is null)
 *
 * Sends an SMS reminder to each matching client and marks the appointment
 * with reminder1hSentAt to prevent duplicate sends.
 *
 * Uses a 30-90 minute window to account for cron execution intervals.
 * A cron running every 5-10 minutes ensures no appointment is missed.
 */
export async function POST(request: Request) {
  try {
    const cronError = await requireCronSecret(request);
    if (cronError) return cronError;

    const now = new Date();
    // Window: appointments starting between 30 minutes and 90 minutes from now
    // This gives a 60-minute window to catch appointments, ensuring nothing is missed
    // even if cron runs are slightly delayed
    const windowStart = new Date(now.getTime() + 30 * 60 * 1000); // 30 min from now
    const windowEnd = new Date(now.getTime() + 90 * 60 * 1000);   // 90 min from now

    logger.info("SMS reminders cron started", {
      timestamp: now.toISOString(),
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
    });

    // Find appointments in the window that haven't received a 1h reminder
    // Starts within window, not cancelled/completed/no_show, 1h reminder not yet sent
    const upcomingAppointments = await findDueSmsReminders({ from: windowStart, to: windowEnd }, BATCH_LIMIT);

    logger.info("Appointments found for SMS reminder", {
      count: upcomingAppointments.length,
    });

    // Mark as sent BEFORE the send loop. If the function dies mid-loop,
    // a lost reminder is far cheaper than the alternative: flags never
    // written -> next run resends every already-delivered SMS (duplicate
    // loop, real SMSAPI cost, spam to clients).
    await markCronRemindersSent(
      "sms1h",
      upcomingAppointments.map((a) => a.appointmentId)
    );

    // #75 (Ryan): bez imienia i nazwiska klienta w logach i w odpowiedzi crona
    // (dane osobowe) — identyfikuje appointmentId.
    const results: Array<{
      appointmentId: string;
      success: boolean;
      skipped?: boolean | undefined;
      error?: string | undefined;
    }> = [];

    for (const appt of upcomingAppointments) {
      const clientName = `${appt.clientFirstName} ${appt.clientLastName}`;
      const employeeName = `${appt.employeeFirstName} ${appt.employeeLastName}`;
      const serviceName = appt.serviceName || "wizyta";

      if (!appt.clientPhone) {
        logger.debug("Skipping SMS reminder - client has no phone number", {
          appointmentId: appt.appointmentId,
        });
        results.push({
          appointmentId: appt.appointmentId,
          success: false,
          error: "No phone number",
        });
        continue;
      }

      try {
        // Send SMS
        const smsResult = await sendAppointmentReminderSms({
          clientPhone: appt.clientPhone,
          clientName,
          serviceName,
          employeeName,
          appointmentDate: appt.appointmentStartTime,
          salonName: appt.salonName,
          salonId: appt.salonId,
          clientId: appt.clientId,
        });

        logger.info("SMS reminder sent", {
          appointmentId: appt.appointmentId,
          success: smsResult.success,
          ...(smsResult.skipped ? { skipped: smsResult.skipped } : {}),
        });

        results.push({
          appointmentId: appt.appointmentId,
          success: smsResult.success,
          ...(smsResult.skipped ? { skipped: true } : {}),
          error: smsResult.error,
        });
      } catch (error) {
        logger.error("SMS reminder processing failed", {
          appointmentId: appt.appointmentId,
          error,
        });
        results.push({
          appointmentId: appt.appointmentId,
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    const sent = results.filter((r) => r.success).length;
    const skipped = results.filter((r) => r.skipped).length;
    const failed = results.filter((r) => !r.success && !r.skipped).length;

    logger.info("SMS reminders cron completed", {
      sent,
      skipped,
      failed,
      total: upcomingAppointments.length,
    });

    return NextResponse.json({
      success: true,
      data: {
        processed: upcomingAppointments.length,
        sent,
        skipped,
        failed,
        results,
        window: {
          from: windowStart.toISOString(),
          to: windowEnd.toISOString(),
        },
      },
    });
  } catch (error) {
    logger.error("SMS reminders cron fatal error", { error });
    return NextResponse.json(
      { success: false, error: "Failed to process SMS reminders" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/cron/sms-reminders
 *
 * Vercel Cron invokes the path with GET (Authorization: Bearer CRON_SECRET),
 * so a plain GET triggers the same send as POST. `?status=1` returns status
 * information instead (monitoring/debugging).
 */
export async function GET(request: Request) {
  if (new URL(request.url).searchParams.get("status") !== "1") {
    return POST(request);
  }
  try {
    const cronError = await requireCronSecret(request);
    if (cronError) return cronError;

    const now = new Date();
    const windowStart = new Date(now.getTime() + 30 * 60 * 1000);
    const windowEnd = new Date(now.getTime() + 90 * 60 * 1000);

    // Count appointments pending reminders
    const pendingReminders = await getPendingCronReminders("sms1h", { from: windowStart, to: windowEnd });

    return NextResponse.json({
      success: true,
      data: {
        currentTime: now.toISOString(),
        window: {
          from: windowStart.toISOString(),
          to: windowEnd.toISOString(),
        },
        pendingReminders: pendingReminders.length,
        appointments: pendingReminders.map((a) => ({
          id: a.appointmentId,
          startTime: a.startTime,
          status: a.status,
        })),
      },
    });
  } catch (error) {
    logger.error("SMS reminders status check failed", { error });
    return NextResponse.json(
      { success: false, error: "Failed to check SMS reminder status" },
      { status: 500 }
    );
  }
}
