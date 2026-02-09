import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { appointments, clients, salons, services, employees } from "@/lib/schema";
import { and, eq, gte, lte, isNull, inArray } from "drizzle-orm";
import { sendSms } from "@/lib/sms";

/**
 * POST /api/reminders/appointment
 *
 * Sends SMS reminders for appointments happening in the next 24 hours.
 * Only sends to appointments that:
 * - Are scheduled or confirmed (not cancelled/completed/no_show)
 * - Have a linked client with a phone number
 * - Have NOT already received a reminder (reminderSentAt is null)
 *
 * This endpoint can be called:
 * - Manually by salon owner
 * - By a cron job / scheduled task
 * - Via query param ?salonId=xxx to limit to a specific salon
 *
 * In development mode, SMS messages are logged to the console.
 */
export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const salonId = searchParams.get("salonId");

    const now = new Date();
    const in24Hours = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    // Build conditions for finding appointments needing reminders
    const conditions = [
      gte(appointments.startTime, now), // appointment is in the future
      lte(appointments.startTime, in24Hours), // within next 24 hours
      isNull(appointments.reminderSentAt), // reminder not yet sent
      // Only scheduled or confirmed appointments
      inArray(appointments.status, ["scheduled", "confirmed"]),
    ];

    // Optionally filter by salon
    if (salonId) {
      conditions.push(eq(appointments.salonId, salonId));
    }

    // Find all upcoming appointments needing reminders with related data
    const upcomingAppointments = await db
      .select({
        appointmentId: appointments.id,
        startTime: appointments.startTime,
        endTime: appointments.endTime,
        salonId: appointments.salonId,
        clientId: appointments.clientId,
        serviceId: appointments.serviceId,
        employeeId: appointments.employeeId,
        status: appointments.status,
        // Client info
        clientFirstName: clients.firstName,
        clientLastName: clients.lastName,
        clientPhone: clients.phone,
        // Salon info
        salonName: salons.name,
        // Service info
        serviceName: services.name,
        // Employee info
        employeeFirstName: employees.firstName,
        employeeLastName: employees.lastName,
      })
      .from(appointments)
      .leftJoin(clients, eq(appointments.clientId, clients.id))
      .leftJoin(salons, eq(appointments.salonId, salons.id))
      .leftJoin(services, eq(appointments.serviceId, services.id))
      .leftJoin(employees, eq(appointments.employeeId, employees.id))
      .where(and(...conditions));

    const results: Array<{
      appointmentId: string;
      clientName: string;
      success: boolean;
      error?: string;
    }> = [];

    for (const appt of upcomingAppointments) {
      // Skip if no client phone
      if (!appt.clientPhone || !appt.clientId) {
        results.push({
          appointmentId: appt.appointmentId,
          clientName: appt.clientFirstName
            ? `${appt.clientFirstName} ${appt.clientLastName}`
            : "Nieznany",
          success: false,
          error: "Brak numeru telefonu klienta",
        });
        continue;
      }

      // Format appointment date in Polish
      const formattedDate = appt.startTime.toLocaleDateString("pl-PL", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      });
      const formattedTime = appt.startTime.toLocaleTimeString("pl-PL", {
        hour: "2-digit",
        minute: "2-digit",
      });

      const clientName = `${appt.clientFirstName} ${appt.clientLastName}`;
      const salonName = appt.salonName || "salon";
      const serviceName = appt.serviceName || "wizyta";
      const employeeName = appt.employeeFirstName
        ? `${appt.employeeFirstName} ${appt.employeeLastName}`
        : "";

      // Build SMS message
      let message = `Przypomnienie: ${clientName}, Twoja wizyta "${serviceName}" w ${salonName}`;
      if (employeeName) {
        message += ` u ${employeeName}`;
      }
      message += ` odbedzie sie ${formattedDate} o godz. ${formattedTime}. Do zobaczenia!`;

      // Send SMS
      const smsResult = await sendSms({
        to: appt.clientPhone,
        message,
        salonId: appt.salonId,
        clientId: appt.clientId,
      });

      if (smsResult.success) {
        // Mark reminder as sent
        await db
          .update(appointments)
          .set({ reminderSentAt: new Date() })
          .where(eq(appointments.id, appt.appointmentId));
      }

      results.push({
        appointmentId: appt.appointmentId,
        clientName,
        success: smsResult.success,
        error: smsResult.error,
      });
    }

    const sent = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    console.log(
      `[Reminders] Processed ${results.length} appointments: ${sent} sent, ${failed} failed`
    );

    return NextResponse.json({
      success: true,
      data: {
        processed: results.length,
        sent,
        failed,
        results,
      },
    });
  } catch (error) {
    console.error("[Reminders] Error sending appointment reminders:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to send appointment reminders",
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/reminders/appointment
 *
 * Returns a preview of appointments that would receive reminders
 * (within next 24 hours, not yet reminded, not cancelled).
 * Useful for salon owners to see what reminders will be sent.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const salonId = searchParams.get("salonId");

    if (!salonId) {
      return NextResponse.json(
        { success: false, error: "salonId is required" },
        { status: 400 }
      );
    }

    const now = new Date();
    const in24Hours = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    const upcoming = await db
      .select({
        appointmentId: appointments.id,
        startTime: appointments.startTime,
        status: appointments.status,
        reminderSentAt: appointments.reminderSentAt,
        clientFirstName: clients.firstName,
        clientLastName: clients.lastName,
        clientPhone: clients.phone,
        salonName: salons.name,
        serviceName: services.name,
        employeeFirstName: employees.firstName,
        employeeLastName: employees.lastName,
      })
      .from(appointments)
      .leftJoin(clients, eq(appointments.clientId, clients.id))
      .leftJoin(salons, eq(appointments.salonId, salons.id))
      .leftJoin(services, eq(appointments.serviceId, services.id))
      .leftJoin(employees, eq(appointments.employeeId, employees.id))
      .where(
        and(
          eq(appointments.salonId, salonId),
          gte(appointments.startTime, now),
          lte(appointments.startTime, in24Hours),
          inArray(appointments.status, ["scheduled", "confirmed"])
        )
      );

    return NextResponse.json({
      success: true,
      data: {
        appointments: upcoming.map((a) => ({
          id: a.appointmentId,
          startTime: a.startTime,
          status: a.status,
          reminderSent: !!a.reminderSentAt,
          reminderSentAt: a.reminderSentAt,
          clientName: a.clientFirstName
            ? `${a.clientFirstName} ${a.clientLastName}`
            : null,
          clientPhone: a.clientPhone,
          salonName: a.salonName,
          serviceName: a.serviceName,
          employeeName: a.employeeFirstName
            ? `${a.employeeFirstName} ${a.employeeLastName}`
            : null,
        })),
        total: upcoming.length,
        pendingReminders: upcoming.filter((a) => !a.reminderSentAt).length,
      },
    });
  } catch (error) {
    console.error("[Reminders] Error fetching reminder preview:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch reminder preview" },
      { status: 500 }
    );
  }
}
