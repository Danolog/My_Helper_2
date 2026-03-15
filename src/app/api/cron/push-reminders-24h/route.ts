import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  appointments,
  clients,
  employees,
  services,
  salons,
  pushSubscriptions,
} from "@/lib/schema";
import { eq, and, gte, lte, isNull, not, inArray } from "drizzle-orm";
import { requireCronSecret } from "@/lib/auth-middleware";
import { logger } from "@/lib/logger";
import { sendAppointmentReminder24hPush } from "@/lib/push";

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
    const upcomingAppointments = await db
      .select({
        appointmentId: appointments.id,
        appointmentStartTime: appointments.startTime,
        salonId: appointments.salonId,
        salonName: salons.name,
        clientId: clients.id,
        clientFirstName: clients.firstName,
        clientLastName: clients.lastName,
        bookedByUserId: appointments.bookedByUserId,
        employeeFirstName: employees.firstName,
        employeeLastName: employees.lastName,
        serviceName: services.name,
      })
      .from(appointments)
      .innerJoin(clients, eq(appointments.clientId, clients.id))
      .innerJoin(employees, eq(appointments.employeeId, employees.id))
      .innerJoin(salons, eq(appointments.salonId, salons.id))
      .leftJoin(services, eq(appointments.serviceId, services.id))
      .where(
        and(
          gte(appointments.startTime, windowStart),
          lte(appointments.startTime, windowEnd),
          not(
            inArray(appointments.status, ["cancelled", "completed", "no_show"])
          ),
          isNull(appointments.reminderPushSentAt)
        )
      );

    logger.info("Appointments found for 24h push reminder", {
      count: upcomingAppointments.length,
    });

    const results: Array<{
      appointmentId: string;
      clientName: string;
      userId: string | null;
      success: boolean;
      sent: number;
      error?: string | undefined;
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
    const usersWithSubs = new Set<string>();
    if (userIds.length > 0) {
      const subsRows = await db
        .select({ userId: pushSubscriptions.userId })
        .from(pushSubscriptions)
        .where(inArray(pushSubscriptions.userId, userIds))
        .groupBy(pushSubscriptions.userId);
      for (const row of subsRows) {
        usersWithSubs.add(row.userId);
      }
    }

    // Track appointment IDs that should be marked as sent after processing
    const idsToMarkSent: string[] = [];

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
          clientName,
          userId: null,
          success: false,
          sent: 0,
          error: "No user account linked",
        });
        // Mark as sent to avoid retrying
        idsToMarkSent.push(appt.appointmentId);
        continue;
      }

      if (!usersWithSubs.has(userId)) {
        logger.debug("Skipping 24h push reminder - no push subscriptions", {
          appointmentId: appt.appointmentId,
          userId,
        });
        results.push({
          appointmentId: appt.appointmentId,
          clientName,
          userId,
          success: false,
          sent: 0,
          error: "No push subscriptions",
        });
        // Mark as sent to avoid retrying
        idsToMarkSent.push(appt.appointmentId);
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

        // Collect for batch update instead of individual UPDATE
        idsToMarkSent.push(appt.appointmentId);

        logger.info("24h push reminder sent", {
          appointmentId: appt.appointmentId,
          clientName,
          devicesSent: pushResult.sent,
        });

        results.push({
          appointmentId: appt.appointmentId,
          clientName,
          userId,
          success: pushResult.success,
          sent: pushResult.sent,
          error: pushResult.error,
        });
      } catch (error) {
        logger.error("24h push reminder processing failed", {
          appointmentId: appt.appointmentId,
          error,
        });
        results.push({
          appointmentId: appt.appointmentId,
          clientName,
          userId,
          success: false,
          sent: 0,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    // Batch-update all processed appointments in a single query instead of N individual UPDATEs
    if (idsToMarkSent.length > 0) {
      await db
        .update(appointments)
        .set({ reminderPushSentAt: new Date() })
        .where(inArray(appointments.id, idsToMarkSent));
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
 * Returns status information about the 24h push reminder system.
 */
export async function GET(request: Request) {
  try {
    const cronError = await requireCronSecret(request);
    if (cronError) return cronError;

    const now = new Date();
    const windowStart = new Date(now.getTime() + 20 * 60 * 60 * 1000);
    const windowEnd = new Date(now.getTime() + 28 * 60 * 60 * 1000);

    const pendingReminders = await db
      .select({
        appointmentId: appointments.id,
        startTime: appointments.startTime,
        status: appointments.status,
        bookedByUserId: appointments.bookedByUserId,
      })
      .from(appointments)
      .where(
        and(
          gte(appointments.startTime, windowStart),
          lte(appointments.startTime, windowEnd),
          not(
            inArray(appointments.status, ["cancelled", "completed", "no_show"])
          ),
          isNull(appointments.reminderPushSentAt)
        )
      );

    // Count total push subscriptions
    const totalSubs = await db
      .select({ id: pushSubscriptions.id })
      .from(pushSubscriptions);

    return NextResponse.json({
      success: true,
      data: {
        currentTime: now.toISOString(),
        window: {
          from: windowStart.toISOString(),
          to: windowEnd.toISOString(),
        },
        pendingReminders: pendingReminders.length,
        totalPushSubscriptions: totalSubs.length,
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
