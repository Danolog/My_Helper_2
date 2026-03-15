import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { appointments, clients, employees, services, salons } from "@/lib/schema";
import { eq, and, gte, lte, isNull, not, inArray } from "drizzle-orm";
import { requireCronSecret } from "@/lib/auth-middleware";
import { logger } from "@/lib/logger";
import { sendAppointmentReminderSms } from "@/lib/sms";

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
    const upcomingAppointments = await db
      .select({
        appointmentId: appointments.id,
        appointmentStartTime: appointments.startTime,
        salonId: appointments.salonId,
        salonName: salons.name,
        clientId: clients.id,
        clientFirstName: clients.firstName,
        clientLastName: clients.lastName,
        clientPhone: clients.phone,
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
          // Appointment starts within window
          gte(appointments.startTime, windowStart),
          lte(appointments.startTime, windowEnd),
          // Not cancelled or completed
          not(inArray(appointments.status, ["cancelled", "completed", "no_show"])),
          // 1h reminder not yet sent
          isNull(appointments.reminder1hSentAt)
        )
      );

    logger.info("Appointments found for SMS reminder", {
      count: upcomingAppointments.length,
    });

    const results: Array<{
      appointmentId: string;
      clientName: string;
      success: boolean;
      error?: string | undefined;
    }> = [];

    // Track appointment IDs that should be marked as sent after processing
    const idsToMarkSent: string[] = [];

    for (const appt of upcomingAppointments) {
      const clientName = `${appt.clientFirstName} ${appt.clientLastName}`;
      const employeeName = `${appt.employeeFirstName} ${appt.employeeLastName}`;
      const serviceName = appt.serviceName || "wizyta";

      if (!appt.clientPhone) {
        logger.debug("Skipping SMS reminder - client has no phone number", {
          appointmentId: appt.appointmentId,
          clientName,
        });
        results.push({
          appointmentId: appt.appointmentId,
          clientName,
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

        // Collect for batch update instead of individual UPDATE
        // Mark regardless of SMS delivery status to prevent retry loops
        idsToMarkSent.push(appt.appointmentId);

        logger.info("SMS reminder sent", {
          appointmentId: appt.appointmentId,
          clientName,
          success: smsResult.success,
        });

        results.push({
          appointmentId: appt.appointmentId,
          clientName,
          success: smsResult.success,
          error: smsResult.error,
        });
      } catch (error) {
        logger.error("SMS reminder processing failed", {
          appointmentId: appt.appointmentId,
          error,
        });
        results.push({
          appointmentId: appt.appointmentId,
          clientName,
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    // Batch-update all processed appointments in a single query instead of N individual UPDATEs
    if (idsToMarkSent.length > 0) {
      await db
        .update(appointments)
        .set({ reminder1hSentAt: new Date() })
        .where(inArray(appointments.id, idsToMarkSent));
    }

    const sent = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    logger.info("SMS reminders cron completed", {
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
 * Returns status information about the SMS reminder system.
 * Useful for monitoring and debugging.
 */
export async function GET(request: Request) {
  try {
    const cronError = await requireCronSecret(request);
    if (cronError) return cronError;

    const now = new Date();
    const windowStart = new Date(now.getTime() + 30 * 60 * 1000);
    const windowEnd = new Date(now.getTime() + 90 * 60 * 1000);

    // Count appointments pending reminders
    const pendingReminders = await db
      .select({
        appointmentId: appointments.id,
        startTime: appointments.startTime,
        status: appointments.status,
      })
      .from(appointments)
      .where(
        and(
          gte(appointments.startTime, windowStart),
          lte(appointments.startTime, windowEnd),
          not(inArray(appointments.status, ["cancelled", "completed", "no_show"])),
          isNull(appointments.reminder1hSentAt)
        )
      );

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
