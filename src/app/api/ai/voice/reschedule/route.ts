import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isProPlan } from "@/lib/subscription";
import { db } from "@/lib/db";
import {
  appointments,
  clients,
  employees,
  services,
  workSchedules,
  timeBlocks,
  aiConversations,
  salons,
} from "@/lib/schema";
import { eq, and, gte, lt, not } from "drizzle-orm";
import { sendSms } from "@/lib/sms";

const DEMO_SALON_ID = "00000000-0000-0000-0000-000000000001";

/** Slot interval in minutes used when generating available time slots. */
const SLOT_INTERVAL = 15;

interface RescheduleRequestBody {
  appointmentId?: string; // Direct appointment ID if known
  callerPhone: string; // Phone to look up client
  callerName?: string;
  preferredDate?: string; // YYYY-MM-DD
  preferredTime?: string; // HH:MM
  notes?: string;
}

/**
 * POST /api/ai/voice/reschedule
 *
 * Handles the voice AI reschedule flow:
 * 1. Find the client's upcoming appointment (by phone or appointment ID).
 * 2. Validate the new preferred date/time.
 * 3. Check availability for the new slot.
 * 4. Update the appointment in the database.
 * 5. Send SMS confirmation.
 * 6. Log the conversation.
 */
export async function POST(req: Request) {
  // --- Authentication ---
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // --- Pro plan gate ---
  const hasPro = await isProPlan();
  if (!hasPro) {
    return NextResponse.json(
      { error: "Funkcje AI sa dostepne tylko w Planie Pro.", code: "PLAN_UPGRADE_REQUIRED" },
      { status: 403 }
    );
  }

  // --- Parse request body ---
  let body: RescheduleRequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.callerPhone || typeof body.callerPhone !== "string") {
    return NextResponse.json({ error: "callerPhone is required" }, { status: 400 });
  }

  try {
    // ------------------------------------------------------------------
    // Step A: Find the client's upcoming appointment
    // ------------------------------------------------------------------
    let appointmentRow: {
      id: string;
      salonId: string;
      clientId: string | null;
      employeeId: string;
      serviceId: string | null;
      startTime: Date;
      endTime: Date;
      status: string;
      notes: string | null;
    } | undefined;

    let clientRecord: { id: string; firstName: string; lastName: string; phone: string | null } | undefined;
    let employeeRecord: { id: string; firstName: string; lastName: string } | undefined;
    let serviceRecord: { id: string; name: string; basePrice: string; baseDuration: number } | undefined;

    if (body.appointmentId) {
      // Direct lookup by appointment ID
      const rows = await db
        .select({
          appointment: appointments,
          client: clients,
          employee: employees,
          service: services,
        })
        .from(appointments)
        .leftJoin(clients, eq(appointments.clientId, clients.id))
        .leftJoin(employees, eq(appointments.employeeId, employees.id))
        .leftJoin(services, eq(appointments.serviceId, services.id))
        .where(
          and(
            eq(appointments.id, body.appointmentId),
            eq(appointments.salonId, DEMO_SALON_ID),
            not(eq(appointments.status, "cancelled"))
          )
        )
        .limit(1);

      if (rows.length > 0) {
        const row = rows[0]!;
        appointmentRow = row.appointment;
        if (row.client) clientRecord = row.client;
        if (row.employee) employeeRecord = row.employee;
        if (row.service) serviceRecord = row.service;
      }
    } else {
      // Look up client by phone first
      const clientRows = await db
        .select({
          id: clients.id,
          firstName: clients.firstName,
          lastName: clients.lastName,
          phone: clients.phone,
        })
        .from(clients)
        .where(
          and(
            eq(clients.salonId, DEMO_SALON_ID),
            eq(clients.phone, body.callerPhone)
          )
        )
        .limit(1);

      if (clientRows.length === 0) {
        return NextResponse.json(
          {
            error: "Nie znaleziono klienta z tym numerem telefonu.",
            code: "CLIENT_NOT_FOUND",
          },
          { status: 404 }
        );
      }

      clientRecord = clientRows[0]!;

      // Find their next upcoming appointment
      const now = new Date();
      const apptRows = await db
        .select({
          appointment: appointments,
          employee: employees,
          service: services,
        })
        .from(appointments)
        .leftJoin(employees, eq(appointments.employeeId, employees.id))
        .leftJoin(services, eq(appointments.serviceId, services.id))
        .where(
          and(
            eq(appointments.clientId, clientRecord.id),
            eq(appointments.salonId, DEMO_SALON_ID),
            not(eq(appointments.status, "cancelled")),
            not(eq(appointments.status, "completed")),
            gte(appointments.startTime, now)
          )
        )
        .orderBy(appointments.startTime)
        .limit(1);

      if (apptRows.length === 0) {
        return NextResponse.json(
          {
            error: "Nie znaleziono nadchodzacej wizyty dla tego klienta.",
            code: "NO_UPCOMING_APPOINTMENT",
          },
          { status: 404 }
        );
      }

      const row = apptRows[0]!;
      appointmentRow = row.appointment;
      if (row.employee) employeeRecord = row.employee;
      if (row.service) serviceRecord = row.service;
    }

    if (!appointmentRow) {
      return NextResponse.json(
        { error: "Nie znaleziono wizyty." },
        { status: 404 }
      );
    }

    // ------------------------------------------------------------------
    // Step B: Determine the new target date
    // ------------------------------------------------------------------
    let targetDateStr = body.preferredDate;

    if (!targetDateStr) {
      return NextResponse.json(
        {
          error: "Prosze podac nowy preferowany termin (date).",
          code: "DATE_REQUIRED",
          currentAppointment: {
            id: appointmentRow.id,
            startTime: appointmentRow.startTime.toISOString(),
            endTime: appointmentRow.endTime.toISOString(),
            employeeName: employeeRecord
              ? `${employeeRecord.firstName} ${employeeRecord.lastName}`
              : null,
            serviceName: serviceRecord?.name || null,
          },
        },
        { status: 400 }
      );
    }

    const targetDate = new Date(targetDateStr + "T00:00:00");
    if (isNaN(targetDate.getTime())) {
      return NextResponse.json(
        { error: "Nieprawidlowy format daty. Uzyj YYYY-MM-DD." },
        { status: 400 }
      );
    }

    const dayOfWeek = targetDate.getDay();
    const employeeId = appointmentRow.employeeId;

    // ------------------------------------------------------------------
    // Step C: Check employee works on the target day
    // ------------------------------------------------------------------
    const scheduleRows = await db
      .select({
        startTime: workSchedules.startTime,
        endTime: workSchedules.endTime,
      })
      .from(workSchedules)
      .where(
        and(
          eq(workSchedules.employeeId, employeeId),
          eq(workSchedules.dayOfWeek, dayOfWeek)
        )
      );

    if (scheduleRows.length === 0) {
      return NextResponse.json(
        {
          error: "Pracownik nie pracuje w wybranym dniu.",
          code: "EMPLOYEE_DAY_OFF",
        },
        { status: 400 }
      );
    }

    const schedule = scheduleRows[0]!;
    const workStartParts = schedule.startTime.split(":").map(Number);
    const workEndParts = schedule.endTime.split(":").map(Number);
    const workStartMinutes = (workStartParts[0] ?? 0) * 60 + (workStartParts[1] ?? 0);
    const workEndMinutes = (workEndParts[0] ?? 0) * 60 + (workEndParts[1] ?? 0);

    // ------------------------------------------------------------------
    // Step D: Gather blocked ranges for the target day
    // ------------------------------------------------------------------
    const dayStart = new Date(targetDateStr + "T00:00:00");
    const dayEnd = new Date(targetDateStr + "T23:59:59");

    const [existingAppointments, existingBlocks] = await Promise.all([
      db
        .select({
          id: appointments.id,
          startTime: appointments.startTime,
          endTime: appointments.endTime,
        })
        .from(appointments)
        .where(
          and(
            eq(appointments.employeeId, employeeId),
            not(eq(appointments.status, "cancelled")),
            not(eq(appointments.id, appointmentRow.id)), // Exclude the appointment being rescheduled
            gte(appointments.startTime, dayStart),
            lt(appointments.startTime, dayEnd)
          )
        ),
      db
        .select({
          startTime: timeBlocks.startTime,
          endTime: timeBlocks.endTime,
        })
        .from(timeBlocks)
        .where(
          and(
            eq(timeBlocks.employeeId, employeeId),
            lt(timeBlocks.startTime, dayEnd),
            gte(timeBlocks.endTime, dayStart)
          )
        ),
    ]);

    // Build blocked time ranges (in minutes from midnight)
    interface TimeRange {
      start: number;
      end: number;
    }

    const blockedRanges: TimeRange[] = [];

    for (const appt of existingAppointments) {
      const s = new Date(appt.startTime);
      const e = new Date(appt.endTime);
      blockedRanges.push({
        start: s.getHours() * 60 + s.getMinutes(),
        end: e.getHours() * 60 + e.getMinutes(),
      });
    }

    for (const block of existingBlocks) {
      const bStart = new Date(block.startTime);
      const bEnd = new Date(block.endTime);

      const startMinutes =
        bStart.toDateString() === targetDate.toDateString()
          ? bStart.getHours() * 60 + bStart.getMinutes()
          : 0;
      const endMinutes =
        bEnd.toDateString() === targetDate.toDateString()
          ? bEnd.getHours() * 60 + bEnd.getMinutes()
          : 24 * 60;

      blockedRanges.push({ start: startMinutes, end: endMinutes });
    }

    // ------------------------------------------------------------------
    // Step E: Generate available slots and find the best match
    // ------------------------------------------------------------------
    const originalDuration =
      (appointmentRow.endTime.getTime() - appointmentRow.startTime.getTime()) / (60 * 1000);
    const duration = serviceRecord ? serviceRecord.baseDuration : originalDuration;

    const availableSlots: { time: string; minutes: number }[] = [];

    for (
      let slotStart = workStartMinutes;
      slotStart + duration <= workEndMinutes;
      slotStart += SLOT_INTERVAL
    ) {
      const slotEnd = slotStart + duration;

      const isBlocked = blockedRanges.some(
        (range) => slotStart < range.end && slotEnd > range.start
      );

      if (!isBlocked) {
        const hours = Math.floor(slotStart / 60);
        const mins = slotStart % 60;
        availableSlots.push({
          time: `${hours.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}`,
          minutes: slotStart,
        });
      }
    }

    if (availableSlots.length === 0) {
      return NextResponse.json(
        {
          error: "Brak wolnych terminow w wybranym dniu. Prosze sprobowac inny dzien.",
          code: "NO_SLOTS_AVAILABLE",
          availableSlots: [],
        },
        { status: 400 }
      );
    }

    // Pick the best slot: closest to the preferred time, or the first available
    let bestSlot = availableSlots[0]!;

    if (body.preferredTime) {
      const prefParts = body.preferredTime.split(":").map(Number);
      const prefMinutes = (prefParts[0] ?? 0) * 60 + (prefParts[1] ?? 0);

      let bestDistance = Math.abs(bestSlot.minutes - prefMinutes);
      for (const slot of availableSlots) {
        const distance = Math.abs(slot.minutes - prefMinutes);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestSlot = slot;
        }
      }
    }

    // ------------------------------------------------------------------
    // Step F: Update the appointment
    // ------------------------------------------------------------------
    const oldStartTime = appointmentRow.startTime;

    const newStartDate = new Date(targetDateStr + `T${bestSlot.time}:00`);
    const newEndDate = new Date(newStartDate.getTime() + duration * 60 * 1000);

    const [updatedAppointment] = await db
      .update(appointments)
      .set({
        startTime: newStartDate,
        endTime: newEndDate,
        notes: body.notes
          ? `${appointmentRow.notes ? appointmentRow.notes + " | " : ""}Przeterminowano przez AI: ${body.notes}`
          : appointmentRow.notes
            ? `${appointmentRow.notes} | Przeterminowano przez asystenta glosowego AI`
            : "Przeterminowano przez asystenta glosowego AI",
      })
      .where(eq(appointments.id, appointmentRow.id))
      .returning();

    // ------------------------------------------------------------------
    // Step G: Send SMS confirmation
    // ------------------------------------------------------------------
    const salonRows = await db
      .select({ name: salons.name })
      .from(salons)
      .where(eq(salons.id, DEMO_SALON_ID))
      .limit(1);

    const salonName = salonRows[0]?.name || "Nasz salon";
    const employeeName = employeeRecord
      ? `${employeeRecord.firstName} ${employeeRecord.lastName}`
      : "pracownik";

    const oldDateStr = oldStartTime.toLocaleDateString("pl-PL", {
      day: "numeric",
      month: "long",
    });
    const oldTimeStr = oldStartTime.toLocaleTimeString("pl-PL", {
      hour: "2-digit",
      minute: "2-digit",
    });

    const smsMessage = `Zmiana terminu: ${serviceRecord?.name || "wizyta"} u ${employeeName} przeniesiona z ${oldDateStr} ${oldTimeStr} na ${targetDateStr} o ${bestSlot.time}. Salon: ${salonName}.`;

    let smsSent = false;
    try {
      const smsResult = await sendSms({
        to: body.callerPhone,
        message: smsMessage,
        salonId: DEMO_SALON_ID,
        clientId: clientRecord?.id,
      });
      smsSent = smsResult.success;
    } catch (smsError) {
      console.error("[Voice AI Reschedule] SMS send failed:", smsError);
    }

    // ------------------------------------------------------------------
    // Step H: Log the conversation
    // ------------------------------------------------------------------
    const [conversation] = await db
      .insert(aiConversations)
      .values({
        salonId: DEMO_SALON_ID,
        clientId: clientRecord?.id || null,
        channel: "voice",
        transcript: JSON.stringify({
          type: "reschedule_completed",
          callerPhone: body.callerPhone,
          callerName: body.callerName || null,
          appointmentId: appointmentRow.id,
          serviceName: serviceRecord?.name || null,
          employeeName,
          oldDate: oldStartTime.toISOString().split("T")[0],
          oldTime: oldTimeStr,
          newDate: targetDateStr,
          newTime: bestSlot.time,
          duration,
          smsSent,
          timestamp: new Date().toISOString(),
        }),
      })
      .returning();

    // ------------------------------------------------------------------
    // Return the reschedule result
    // ------------------------------------------------------------------
    return NextResponse.json({
      success: true,
      appointment: updatedAppointment,
      details: {
        appointmentId: appointmentRow.id,
        serviceName: serviceRecord?.name || "Wizyta",
        employeeName,
        oldDate: oldStartTime.toISOString().split("T")[0],
        oldTime: oldTimeStr,
        newDate: targetDateStr,
        newTime: bestSlot.time,
        duration,
        availableSlots: availableSlots.map((s) => s.time),
      },
      smsConfirmation: {
        sent: smsSent,
        phone: body.callerPhone,
      },
      conversationId: conversation?.id || null,
    });
  } catch (error) {
    console.error("[Voice AI Reschedule] Error:", error);
    return NextResponse.json(
      { error: "Blad przetwarzania zmiany terminu" },
      { status: 500 }
    );
  }
}
