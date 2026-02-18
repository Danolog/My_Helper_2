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
  employeeServices,
  salons,
} from "@/lib/schema";
import { eq, and, gte, lt, not } from "drizzle-orm";
import { sendSms } from "@/lib/sms";

const DEMO_SALON_ID = "00000000-0000-0000-0000-000000000001";

/** Slot interval in minutes used when generating available time slots. */
const SLOT_INTERVAL = 15;

interface BookingRequestBody {
  serviceId: string;
  employeeId?: string;
  preferredDate?: string; // YYYY-MM-DD
  preferredTime?: string; // HH:MM
  callerPhone: string;
  callerName?: string;
  notes?: string;
}

/**
 * POST /api/ai/voice/book
 *
 * Completes a voice AI booking flow by:
 * 1. Validating the caller's request (service, employee, date/time).
 * 2. Finding the best available slot.
 * 3. Creating an appointment.
 * 4. Finding or creating a client record.
 * 5. Sending an SMS confirmation.
 * 6. Logging the conversation for audit.
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
  let body: BookingRequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.serviceId || typeof body.serviceId !== "string") {
    return NextResponse.json({ error: "serviceId is required" }, { status: 400 });
  }

  if (!body.callerPhone || typeof body.callerPhone !== "string") {
    return NextResponse.json({ error: "callerPhone is required" }, { status: 400 });
  }

  try {
    // ------------------------------------------------------------------
    // Step A: Look up the requested service
    // ------------------------------------------------------------------
    const serviceRows = await db
      .select({
        id: services.id,
        name: services.name,
        basePrice: services.basePrice,
        baseDuration: services.baseDuration,
        salonId: services.salonId,
      })
      .from(services)
      .where(
        and(
          eq(services.id, body.serviceId),
          eq(services.salonId, DEMO_SALON_ID),
          eq(services.isActive, true)
        )
      )
      .limit(1);

    const service = serviceRows[0];
    if (!service) {
      return NextResponse.json(
        { error: "Usluga nie zostala znaleziona." },
        { status: 404 }
      );
    }

    // ------------------------------------------------------------------
    // Step B: Determine the target date (needed before employee resolution)
    // ------------------------------------------------------------------
    let targetDateStr = body.preferredDate;

    if (!targetDateStr) {
      // Default to tomorrow
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      targetDateStr = tomorrow.toISOString().split("T")[0]!;
    }

    const targetDate = new Date(targetDateStr + "T00:00:00");
    if (isNaN(targetDate.getTime())) {
      return NextResponse.json(
        { error: "Nieprawidlowy format daty. Uzyj YYYY-MM-DD." },
        { status: 400 }
      );
    }

    const dayOfWeek = targetDate.getDay(); // 0=Sunday, 1=Monday, ...

    // ------------------------------------------------------------------
    // Step C: Resolve the employee (prefer one who works on the target day)
    // ------------------------------------------------------------------
    let employeeId = body.employeeId;

    if (!employeeId) {
      // Try to find an active employee assigned to this service via the
      // employeeServices junction table who also works on the target day.
      const assignedRows = await db
        .select({ employeeId: employeeServices.employeeId })
        .from(employeeServices)
        .innerJoin(employees, eq(employees.id, employeeServices.employeeId))
        .innerJoin(
          workSchedules,
          and(
            eq(workSchedules.employeeId, employeeServices.employeeId),
            eq(workSchedules.dayOfWeek, dayOfWeek)
          )
        )
        .where(
          and(
            eq(employeeServices.serviceId, body.serviceId),
            eq(employees.salonId, DEMO_SALON_ID),
            eq(employees.isActive, true)
          )
        )
        .limit(1);

      if (assignedRows.length > 0) {
        employeeId = assignedRows[0]!.employeeId;
      } else {
        // Fallback: pick any active employee in the salon who works on
        // the target day (join with workSchedules to guarantee schedule).
        const fallbackRows = await db
          .select({ id: employees.id })
          .from(employees)
          .innerJoin(
            workSchedules,
            and(
              eq(workSchedules.employeeId, employees.id),
              eq(workSchedules.dayOfWeek, dayOfWeek)
            )
          )
          .where(
            and(
              eq(employees.salonId, DEMO_SALON_ID),
              eq(employees.isActive, true)
            )
          )
          .limit(1);

        if (fallbackRows.length === 0) {
          return NextResponse.json(
            { error: "Brak dostepnych pracownikow dla tej uslugi." },
            { status: 404 }
          );
        }

        employeeId = fallbackRows[0]!.id;
      }
    }

    // Fetch employee details (name) for the confirmation message
    const employeeRows = await db
      .select({
        id: employees.id,
        firstName: employees.firstName,
        lastName: employees.lastName,
      })
      .from(employees)
      .where(
        and(
          eq(employees.id, employeeId),
          eq(employees.salonId, DEMO_SALON_ID),
          eq(employees.isActive, true)
        )
      )
      .limit(1);

    const employee = employeeRows[0];
    if (!employee) {
      return NextResponse.json(
        { error: "Brak dostepnych pracownikow dla tej uslugi." },
        { status: 404 }
      );
    }

    // ------------------------------------------------------------------
    // Step D: Query the employee's work schedule for that day
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
        { error: "Wybrany pracownik nie pracuje w tym dniu." },
        { status: 400 }
      );
    }

    const schedule = scheduleRows[0]!;
    const workStartParts = schedule.startTime.split(":").map(Number);
    const workEndParts = schedule.endTime.split(":").map(Number);
    const workStartMinutes = (workStartParts[0] ?? 0) * 60 + (workStartParts[1] ?? 0);
    const workEndMinutes = (workEndParts[0] ?? 0) * 60 + (workEndParts[1] ?? 0);

    // ------------------------------------------------------------------
    // Step E: Gather existing appointments and time blocks for the day
    // ------------------------------------------------------------------
    const dayStart = new Date(targetDateStr + "T00:00:00");
    const dayEnd = new Date(targetDateStr + "T23:59:59");

    const [existingAppointments, existingBlocks] = await Promise.all([
      db
        .select({
          startTime: appointments.startTime,
          endTime: appointments.endTime,
        })
        .from(appointments)
        .where(
          and(
            eq(appointments.employeeId, employeeId),
            not(eq(appointments.status, "cancelled")),
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

      // Clamp multi-day blocks to the current day
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
    // Step F: Generate 15-minute interval slots and find the best match
    // ------------------------------------------------------------------
    const duration = service.baseDuration;
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
        { error: "Brak wolnych terminow w wybranym dniu. Prosze sprobowac inny dzien." },
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
    // Step G: Create the appointment
    // ------------------------------------------------------------------
    const slotStartDate = new Date(targetDateStr + `T${bestSlot.time}:00`);
    const slotEndDate = new Date(slotStartDate.getTime() + duration * 60 * 1000);

    const [newAppointment] = await db
      .insert(appointments)
      .values({
        salonId: DEMO_SALON_ID,
        employeeId: employeeId,
        serviceId: service.id,
        startTime: slotStartDate,
        endTime: slotEndDate,
        status: "scheduled",
        notes: body.notes || null,
      })
      .returning();

    // ------------------------------------------------------------------
    // Step H: Find or create a client record from the caller phone
    // ------------------------------------------------------------------
    let clientRecord: { id: string; firstName: string; lastName: string } | undefined;

    const existingClients = await db
      .select({
        id: clients.id,
        firstName: clients.firstName,
        lastName: clients.lastName,
      })
      .from(clients)
      .where(
        and(
          eq(clients.salonId, DEMO_SALON_ID),
          eq(clients.phone, body.callerPhone)
        )
      )
      .limit(1);

    if (existingClients.length > 0) {
      clientRecord = existingClients[0]!;
    } else {
      // Create a new client with the phone number
      const callerNameParts = (body.callerName || "Klient telefoniczny").split(" ");
      const firstName = callerNameParts[0] || "Klient";
      const lastName = callerNameParts.slice(1).join(" ") || "telefoniczny";

      const [newClient] = await db
        .insert(clients)
        .values({
          salonId: DEMO_SALON_ID,
          firstName,
          lastName,
          phone: body.callerPhone,
        })
        .returning();

      if (newClient) {
        clientRecord = {
          id: newClient.id,
          firstName: newClient.firstName,
          lastName: newClient.lastName,
        };
      }
    }

    // Link the client to the appointment if we have a record
    if (clientRecord && newAppointment) {
      await db
        .update(appointments)
        .set({ clientId: clientRecord.id })
        .where(eq(appointments.id, newAppointment.id));
    }

    // ------------------------------------------------------------------
    // Step I: Send SMS confirmation
    // ------------------------------------------------------------------
    const salonRows = await db
      .select({ name: salons.name })
      .from(salons)
      .where(eq(salons.id, DEMO_SALON_ID))
      .limit(1);

    const salonName = salonRows[0]?.name || "Nasz salon";
    const employeeName = `${employee.firstName} ${employee.lastName}`;

    const smsMessage =
      `Potwierdzenie rezerwacji: ${service.name} u ${employeeName}, ${targetDateStr} o ${bestSlot.time}. Salon: ${salonName}. Do zobaczenia!`;

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
      console.error("[Voice AI Book] SMS send failed:", smsError);
      // SMS failure should not block the booking itself
    }

    // ------------------------------------------------------------------
    // Step J: Log the conversation in aiConversations
    // ------------------------------------------------------------------
    const [conversation] = await db
      .insert(aiConversations)
      .values({
        salonId: DEMO_SALON_ID,
        clientId: clientRecord?.id || null,
        channel: "voice",
        transcript: JSON.stringify({
          type: "booking_completed",
          callerPhone: body.callerPhone,
          callerName: body.callerName || null,
          serviceId: service.id,
          serviceName: service.name,
          employeeId: employeeId,
          employeeName,
          date: targetDateStr,
          time: bestSlot.time,
          duration,
          appointmentId: newAppointment?.id,
          smsSent,
          timestamp: new Date().toISOString(),
        }),
      })
      .returning();

    // ------------------------------------------------------------------
    // Return the booking result
    // ------------------------------------------------------------------
    return NextResponse.json({
      success: true,
      appointment: newAppointment,
      details: {
        serviceName: service.name,
        employeeName,
        date: targetDateStr,
        time: bestSlot.time,
        duration,
        price: service.basePrice,
      },
      smsConfirmation: {
        sent: smsSent,
        phone: body.callerPhone,
      },
      conversationId: conversation?.id || null,
    });
  } catch (error) {
    console.error("[Voice AI Book] Error:", error);
    return NextResponse.json(
      { error: "Blad przetwarzania rezerwacji glosowej" },
      { status: 500 }
    );
  }
}
