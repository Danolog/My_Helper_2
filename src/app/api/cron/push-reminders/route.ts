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
import { sendAppointmentReminderPush } from "@/lib/push";

/**
 * POST /api/cron/push-reminders
 *
 * Triggered periodically (e.g., every 5 minutes by a cron job).
 * Finds appointments starting within 30-90 minutes from now that:
 *   - Have a linked client with a user account (bookedByUserId)
 *   - The user has push subscriptions registered
 *   - Are in 'scheduled' or 'confirmed' status (not cancelled/completed)
 *   - Haven't had a 1h push reminder sent yet (reminderPush1hSentAt is null)
 *
 * Sends a push notification to each matching client and marks the appointment
 * with reminderPush1hSentAt to prevent duplicate sends.
 */
export async function POST(request: Request) {
  try {
    // Optional: verify cron secret for production security
    const { searchParams } = new URL(request.url);
    const cronSecret = searchParams.get("secret");
    const expectedSecret = process.env.CRON_SECRET;

    if (expectedSecret && cronSecret !== expectedSecret) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const now = new Date();
    // Window: appointments starting between 30 minutes and 90 minutes from now
    const windowStart = new Date(now.getTime() + 30 * 60 * 1000); // 30 min
    const windowEnd = new Date(now.getTime() + 90 * 60 * 1000); // 90 min

    console.log(`[Push Reminders] Running at ${now.toISOString()}`);
    console.log(
      `[Push Reminders] Looking for appointments between ${windowStart.toISOString()} and ${windowEnd.toISOString()}`
    );

    // Find appointments in the window that haven't received a 1h push reminder
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
          isNull(appointments.reminderPush1hSentAt)
        )
      );

    console.log(
      `[Push Reminders] Found ${upcomingAppointments.length} appointments needing 1h push reminder`
    );

    const results: Array<{
      appointmentId: string;
      clientName: string;
      userId: string | null;
      success: boolean;
      sent: number;
      error?: string | undefined;
    }> = [];

    for (const appt of upcomingAppointments) {
      const clientName = `${appt.clientFirstName} ${appt.clientLastName}`;
      const employeeName = `${appt.employeeFirstName} ${appt.employeeLastName}`;
      const serviceName = appt.serviceName || "wizyta";
      const userId = appt.bookedByUserId;

      if (!userId) {
        console.log(
          `[Push Reminders] Skipping appointment ${appt.appointmentId} - no user account linked`
        );
        results.push({
          appointmentId: appt.appointmentId,
          clientName,
          userId: null,
          success: false,
          sent: 0,
          error: "No user account linked",
        });
        // Still mark as sent to avoid retrying
        await db
          .update(appointments)
          .set({ reminderPush1hSentAt: new Date() })
          .where(eq(appointments.id, appt.appointmentId));
        continue;
      }

      // Check if user has push subscriptions
      const subs = await db
        .select({ id: pushSubscriptions.id })
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.userId, userId))
        .limit(1);

      if (subs.length === 0) {
        console.log(
          `[Push Reminders] Skipping appointment ${appt.appointmentId} - user ${userId} has no push subscriptions`
        );
        results.push({
          appointmentId: appt.appointmentId,
          clientName,
          userId,
          success: false,
          sent: 0,
          error: "No push subscriptions",
        });
        // Mark as sent to avoid retrying
        await db
          .update(appointments)
          .set({ reminderPush1hSentAt: new Date() })
          .where(eq(appointments.id, appt.appointmentId));
        continue;
      }

      try {
        const pushResult = await sendAppointmentReminderPush({
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

        // Mark reminder as sent
        await db
          .update(appointments)
          .set({ reminderPush1hSentAt: new Date() })
          .where(eq(appointments.id, appt.appointmentId));

        console.log(
          `[Push Reminders] Push sent for appointment ${appt.appointmentId} to ${clientName}: ${pushResult.sent} devices`
        );

        results.push({
          appointmentId: appt.appointmentId,
          clientName,
          userId,
          success: pushResult.success,
          sent: pushResult.sent,
          error: pushResult.error,
        });
      } catch (error) {
        console.error(
          `[Push Reminders] Error processing appointment ${appt.appointmentId}:`,
          error
        );
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

    const sent = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    console.log(
      `[Push Reminders] Complete: ${sent} sent, ${failed} failed out of ${upcomingAppointments.length} total`
    );

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
    console.error("[Push Reminders] Fatal error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to process push reminders" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/cron/push-reminders
 *
 * Returns status information about the push reminder system.
 */
export async function GET() {
  try {
    const now = new Date();
    const windowStart = new Date(now.getTime() + 30 * 60 * 1000);
    const windowEnd = new Date(now.getTime() + 90 * 60 * 1000);

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
          isNull(appointments.reminderPush1hSentAt)
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
    console.error("[Push Reminders] Error checking status:", error);
    return NextResponse.json(
      { success: false, error: "Failed to check push reminder status" },
      { status: 500 }
    );
  }
}
