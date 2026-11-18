import { NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/auth-middleware";
import { logger } from "@/lib/logger";
import { sendAppointmentReminder24hPush } from "@/lib/push";
// #193 P5a-2: trasa systemowa (requireCronSecret, cross-salon) — wyjścia z rejestru system/
import {
  countPushSubscriptions,
  findDuePushReminders,
  getPendingCronReminders,
  getUserIdsWithPushSubscriptions,
  markCronRemindersSent,
} from "@/lib/server/system";

// Wysyłka push w pętli może trwać — bez tego domyślny timeout ucina cron w połowie
export const maxDuration = 300;

// Górna granica na jedno uruchomienie; cron uruchamiany cyklicznie dogoni resztę
const BATCH_LIMIT = 200;

// Stałe kody błędu elementu odpowiedzi; szczegół przyczyny tylko w logu serwera
type PushReminderErrorCode =
  | "no_user_account"
  | "no_push_subscriptions"
  | "send_failed"
  | "processing_failed";

/**
 * POST /api/cron/push-reminders-24h
 *
 * Triggered periodically (e.g., every 30 minutes by a cron job).
 * Finds appointments starting within 20-28 hours from now that:
 *   - Have a linked client with a user account (bookedByUserId)
 *   - The user has push subscriptions registered
 *   - Are in 'scheduled' or 'confirmed' status (not cancelled/completed)
 *   - Haven't had a 24h push reminder sent yet (reminderPushSentAt is null)
 *
 * Sends a push notification to each matching client and marks the appointment
 * with reminderPushSentAt to prevent duplicate sends.
 *
 * Uses a 20-28 hour window to account for cron execution intervals.
 * A cron running every 30 minutes ensures no appointment is missed.
 */
export async function POST(request: Request) {
  try {
    const cronError = await requireCronSecret(request);
    if (cronError) return cronError;

    const now = new Date();
    // Window: appointments starting between 20 hours and 28 hours from now
    // This 8-hour window centered around 24h gives plenty of margin
    const windowStart = new Date(now.getTime() + 20 * 60 * 60 * 1000); // 20h from now
    const windowEnd = new Date(now.getTime() + 28 * 60 * 60 * 1000); // 28h from now

    logger.info("Push 24h reminders cron started", {
      timestamp: now.toISOString(),
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
    });

    // Find appointments in the window that haven't received a 24h push reminder
    const upcomingAppointments = await findDuePushReminders(
      "push24h",
      { from: windowStart, to: windowEnd },
      BATCH_LIMIT
    );

    logger.info("Appointments found for 24h push reminder", {
      count: upcomingAppointments.length,
    });

    // Oznacz jako wysłane PRZED pętlą wysyłki. Jeśli funkcja padnie w trakcie,
    // zgubione przypomnienie jest tańsze niż niezapisane flagi -> kolejne
    // uruchomienie wysyła duplikaty do wszystkich już powiadomionych.
    await markCronRemindersSent(
      "push24h",
      upcomingAppointments.map((a) => a.appointmentId)
    );

    // Odpowiedź i logi bez imienia i nazwiska klienta — wpis identyfikuje appointmentId.
    const results: Array<{
      appointmentId: string;
      userId: string | null;
      success: boolean;
      sent: number;
      error?: PushReminderErrorCode | undefined;
    }> = [];

    // Collect all unique userIds to batch-check push subscriptions
    const userIds = [
      ...new Set(
        upcomingAppointments
          .map((a) => a.bookedByUserId)
          .filter((id): id is string => id !== null)
      ),
    ];

    // Batch-fetch which users have push subscriptions (single query instead of N)
    const usersWithSubs = new Set<string>(await getUserIdsWithPushSubscriptions(userIds));

    for (const appt of upcomingAppointments) {
      const clientName = `${appt.clientFirstName} ${appt.clientLastName}`;
      const employeeName = `${appt.employeeFirstName} ${appt.employeeLastName}`;
      const serviceName = appt.serviceName || "wizyta";
      const userId = appt.bookedByUserId;

      if (!userId) {
        logger.debug("Skipping 24h push reminder - no user account linked", {
          appointmentId: appt.appointmentId,
        });
        results.push({
          appointmentId: appt.appointmentId,
          userId: null,
          success: false,
          sent: 0,
          error: "no_user_account",
        });
        continue;
      }

      if (!usersWithSubs.has(userId)) {
        logger.debug("Skipping 24h push reminder - no push subscriptions", {
          appointmentId: appt.appointmentId,
          userId,
        });
        results.push({
          appointmentId: appt.appointmentId,
          userId,
          success: false,
          sent: 0,
          error: "no_push_subscriptions",
        });
        continue;
      }

      try {
        const pushResult = await sendAppointmentReminder24hPush({
          userId,
          clientName,
          serviceName,
          employeeName,
          appointmentDate: appt.appointmentStartTime,
          salonName: appt.salonName,
          salonId: appt.salonId,
          clientId: appt.clientId,
          appointmentId: appt.appointmentId,
        });

        logger.info("24h push reminder sent", {
          appointmentId: appt.appointmentId,
          devicesSent: pushResult.sent,
        });

        if (!pushResult.success) {
          logger.warn("24h push reminder not delivered", {
            appointmentId: appt.appointmentId,
            error: pushResult.error,
          });
        }

        results.push({
          appointmentId: appt.appointmentId,
          userId,
          success: pushResult.success,
          sent: pushResult.sent,
          ...(pushResult.success ? {} : { error: "send_failed" as const }),
        });
      } catch (error) {
        logger.error("24h push reminder processing failed", {
          appointmentId: appt.appointmentId,
          error,
        });
        results.push({
          appointmentId: appt.appointmentId,
          userId,
          success: false,
          sent: 0,
          error: "processing_failed",
        });
      }
    }

    const sent = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    logger.info("Push 24h reminders cron completed", {
      sent,
      failed,
      total: upcomingAppointments.length,
    });

    return NextResponse.json({
      success: true,
      data: {
        processed: upcomingAppointments.length,
        sent,
        failed,
        results,
        window: {
          from: windowStart.toISOString(),
          to: windowEnd.toISOString(),
        },
      },
    });
  } catch (error) {
    logger.error("Push 24h reminders cron fatal error", { error });
    return NextResponse.json(
      { success: false, error: "Failed to process 24h push reminders" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/cron/push-reminders-24h
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
    const windowStart = new Date(now.getTime() + 20 * 60 * 60 * 1000);
    const windowEnd = new Date(now.getTime() + 28 * 60 * 60 * 1000);

    const pendingReminders = await getPendingCronReminders("push24h", { from: windowStart, to: windowEnd });

    // Count total push subscriptions
    const totalPushSubscriptions = await countPushSubscriptions();

    return NextResponse.json({
      success: true,
      data: {
        currentTime: now.toISOString(),
        window: {
          from: windowStart.toISOString(),
          to: windowEnd.toISOString(),
        },
        pendingReminders: pendingReminders.length,
        totalPushSubscriptions,
        appointments: pendingReminders.map((a) => ({
          id: a.appointmentId,
          startTime: a.startTime,
          status: a.status,
          hasUserAccount: !!a.bookedByUserId,
        })),
      },
    });
  } catch (error) {
    logger.error("Push 24h reminders status check failed", { error });
    return NextResponse.json(
      { success: false, error: "Failed to check 24h push reminder status" },
      { status: 500 }
    );
  }
}
