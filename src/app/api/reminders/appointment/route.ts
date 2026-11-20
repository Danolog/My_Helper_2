import { NextResponse } from "next/server";
import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { isValidUuid } from "@/lib/api-validation";
import { requireCronSecret } from "@/lib/auth-middleware";
import { logger } from "@/lib/logger";
import { appointments, clients, employees, salons, services } from "@/lib/schema";
// #193 (decyzja CTO): podgląd (GET) dotyczy jednego salonu z obowiązkowym
// salonId → brama salonu; w raw jawny warunek salonu w where i w każdym złączeniu.
import { forSalon } from "@/lib/server/repository";
// #193 P5a-2 (decyzja CTO): wysyłka (POST) z sekretem crona, salonId to opcjonalny
// filtr (bez niego wszystkie salony) → wyjścia systemowe, nie pula żądań.
import { findDueAppointmentReminders, markAppointmentRemindersSent } from "@/lib/server/system";
import { sendAppointmentReminder24hSms } from "@/lib/sms";
/**
 * POST /api/reminders/appointment
 *
 * Sends SMS reminders for appointments happening in the next 24 hours.
 * Only sends to appointments that:
 * - Are scheduled or confirmed (not cancelled/completed/no_show)
 * - Have a linked client with a phone number
 * - Have NOT already received a reminder (reminderSentAt is null)
 *
 * Wymaga sekretu crona (wołający: cron / zadanie planowe). Parametr
 * ?salonId=<uuid> zawęża do jednego salonu; podany, ale nie-UUID (także pusty)
 * → 400 przed jakimkolwiek zapytaniem.
 *
 * Bez SMSAPI_TOKEN poza hostingiem (lokalnie, testy, CI) SMS jest tylko symulowany: log z zamaskowanym numerem i długością, bez treści.
 * Z ustawionym SMSAPI_TOKEN SMS wychodzi naprawdę, także lokalnie.
 */
export async function POST(request: Request) {
  try {
    const cronError = await requireCronSecret(request);
    if (cronError) return cronError;
    const { searchParams } = new URL(request.url);
    const salonId = searchParams.get("salonId");

    if (salonId !== null && !isValidUuid(salonId)) {
      return NextResponse.json(
        { success: false, error: "Nieprawidłowy salonId" },
        { status: 400 }
      );
    }

    const now = new Date();
    const in24Hours = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    // Odczyt kończy się przed wysyłką SMS; oznaczenie po wysyłce, po id z odczytu.
    const upcomingAppointments = await findDueAppointmentReminders({ from: now, to: in24Hours }, salonId);

    const results: Array<{
      appointmentId: string;
      clientName: string;
      success: boolean;
      skipped?: boolean | undefined;
      error?: string | undefined;
    }> = [];

    // Track appointment IDs that were successfully sent for batch update
    const idsToMarkSent: string[] = [];

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

      const clientName = `${appt.clientFirstName} ${appt.clientLastName}`;
      const employeeName = appt.employeeFirstName
        ? `${appt.employeeFirstName} ${appt.employeeLastName}`
        : "";

      // Treść wyłącznie z szablonu modułu SMS: imię, usługa, pracownik i salon
      // przez jego reguły, data i godzina w czasie warszawskim (#234).
      const smsResult = await sendAppointmentReminder24hSms({
        clientPhone: appt.clientPhone,
        clientName,
        serviceName: appt.serviceName,
        employeeName,
        appointmentDate: appt.startTime,
        salonName: appt.salonName,
        salonId: appt.salonId,
        clientId: appt.clientId,
      });

      // Numer testowy (#75): SMS świadomie pominięty, ale przypomnienie jest
      // obsłużone — bez oznaczenia każde wywołanie brałoby tę wizytę od nowa.
      if (smsResult.success || smsResult.skipped) {
        // Collect for batch update instead of individual UPDATE
        idsToMarkSent.push(appt.appointmentId);
      }

      results.push({
        appointmentId: appt.appointmentId,
        clientName,
        success: smsResult.success,
        ...(smsResult.skipped ? { skipped: true } : {}),
        error: smsResult.error,
      });
    }

    // Batch-update all successfully sent appointments in a single query instead of N individual UPDATEs
    await markAppointmentRemindersSent(idsToMarkSent);

    const sent = results.filter((r) => r.success).length;
    const skipped = results.filter((r) => r.skipped).length;
    const failed = results.filter((r) => !r.success && !r.skipped).length;

    logger.info(`[Reminders] Processed ${results.length} appointments: ${sent} sent, ${skipped} skipped, ${failed} failed`);

    return NextResponse.json({
      success: true,
      data: {
        processed: results.length,
        sent,
        skipped,
        failed,
        results,
      },
    });
  } catch (error) {
    logger.error("[Reminders] Error sending appointment reminders", { error: error });
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
 * (within next 24 hours, scheduled or confirmed) for one salon.
 * Wymaga sekretu crona i salonId (UUID).
 */
export async function GET(request: Request) {
  try {
    const cronError = await requireCronSecret(request);
    if (cronError) return cronError;

    const { searchParams } = new URL(request.url);
    const salonId = searchParams.get("salonId");

    if (!salonId) {
      return NextResponse.json(
        { success: false, error: "salonId is required" },
        { status: 400 }
      );
    }

    if (!isValidUuid(salonId)) {
      return NextResponse.json(
        { success: false, error: "Nieprawidłowy salonId" },
        { status: 400 }
      );
    }

    const now = new Date();
    const in24Hours = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    const upcoming = await forSalon(salonId).raw((tx) =>
      tx
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
        .leftJoin(clients, and(eq(appointments.clientId, clients.id), eq(clients.salonId, appointments.salonId)))
        .leftJoin(salons, eq(appointments.salonId, salons.id))
        .leftJoin(services, and(eq(appointments.serviceId, services.id), eq(services.salonId, appointments.salonId)))
        .leftJoin(employees, and(eq(appointments.employeeId, employees.id), eq(employees.salonId, appointments.salonId)))
        .where(
          and(
            eq(appointments.salonId, salonId),
            gte(appointments.startTime, now),
            lte(appointments.startTime, in24Hours),
            inArray(appointments.status, ["scheduled", "confirmed"])
          )
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
    logger.error("[Reminders] Error fetching reminder preview", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to fetch reminder preview" },
      { status: 500 }
    );
  }
}
