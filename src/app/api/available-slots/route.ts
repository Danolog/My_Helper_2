import { NextResponse } from "next/server";
import { eq, and, gte, lt, not } from "drizzle-orm";
import { isValidUuid } from "@/lib/api-validation";
import { rangesOverlap } from "@/lib/appointment-overlap";
import { logger } from "@/lib/logger";
import { apiRateLimit, getClientIp } from "@/lib/rate-limit";
import { appointments, employees, workSchedules, timeBlocks } from "@/lib/schema";
// Publiczny endpoint bookingu (bez auth, bez sesji salonu): wszystkie odczyty
// w jednej transakcji forSalon(salonId z zapytania). RLS przy salonId z URL
// niczego nie chroni (kontekst ustawia wołający) — ochroną są jawne listy
// kolumn, jawne eq(salonId) i sprawdzenie, że pracownik należy do salonu.
import { forSalon } from "@/lib/server/repository";

// Ta sama odpowiedź dla pracownika nieistniejącego i pracownika z obcego
// salonu — inaczej trasa byłaby wyrocznią do wyliczania pracowników.
const EMPLOYEE_NOT_FOUND_BODY = { success: false, error: "Employee not found" } as const;

// GET /api/available-slots?salonId=xxx&employeeId=xxx&date=2026-02-10&duration=60
// Returns available time slots for booking
export async function GET(request: Request) {
  try {
    // Publiczny endpoint (do 4 zapytań DB w jednej transakcji na wywołanie, employeeId z query)
    // — limit per IP; checkAsync uzywa Upstash gdy skonfigurowany, inaczej in-memory
    const ip = getClientIp(request);
    const rateLimitResult = await apiRateLimit.checkAsync(ip);
    if (!rateLimitResult.success) {
      return NextResponse.json(
        { success: false, error: "Zbyt wiele żądań. Spróbuj ponownie później." },
        { status: 429, headers: { "Retry-After": String(Math.ceil(rateLimitResult.reset / 1000)) } }
      );
    }

    const { searchParams } = new URL(request.url);
    const employeeId = searchParams.get("employeeId");
    const date = searchParams.get("date"); // YYYY-MM-DD format
    const durationStr = searchParams.get("duration"); // in minutes

    if (!employeeId || !date || !durationStr) {
      return NextResponse.json(
        { success: false, error: "employeeId, date, and duration are required" },
        { status: 400 }
      );
    }

    const duration = parseInt(durationStr, 10);
    if (isNaN(duration) || duration <= 0) {
      return NextResponse.json(
        { success: false, error: "duration must be a positive number (in minutes)" },
        { status: 400 }
      );
    }

    // Parse the date
    const requestedDate = new Date(date + "T00:00:00");
    if (isNaN(requestedDate.getTime())) {
      return NextResponse.json(
        { success: false, error: "Invalid date format. Use YYYY-MM-DD" },
        { status: 400 }
      );
    }

    // salonId walidowany PRZED forSalon: polityka RLS rzutuje kontekst na
    // ::uuid, więc zły format dałby 500 z bazy zamiast 400.
    const salonId = searchParams.get("salonId");
    if (!salonId || !isValidUuid(salonId)) {
      return NextResponse.json(
        { success: false, error: "salonId must be a valid UUID" },
        { status: 400 }
      );
    }

    // Zły format employeeId odrzucamy przed bazą (inaczej 500 z rzutowania
    // ::uuid). Odpowiedź zależy tylko od formatu, nie od istnienia pracownika.
    if (!isValidUuid(employeeId)) {
      return NextResponse.json(
        { success: false, error: "employeeId must be a valid UUID" },
        { status: 400 }
      );
    }

    const dayOfWeek = requestedDate.getDay(); // 0=Sunday, 1=Monday, ...

    logger.info(`[AvailableSlots API] Query for salon=${salonId}, employee=${employeeId}, date=${date}, duration=${duration}min, dayOfWeek=${dayOfWeek}`);

    const dayStart = new Date(date + "T00:00:00");
    const dayEnd = new Date(date + "T23:59:59");

    // Jedna transakcja forSalon: najpierw przynależność pracownika do salonu,
    // dopiero potem grafik, wizyty i blokady tego (sprawdzonego) pracownika.
    // work_schedules i time_blocks nie mają salon_id — filtrujemy je po
    // sprawdzonym employeeId, a RLS przez employees jest drugą tamą.
    const result = await forSalon(salonId).raw(async (tx) => {
      const employeeRows = await tx
        .select({ id: employees.id })
        .from(employees)
        .where(and(eq(employees.id, employeeId), eq(employees.salonId, salonId)))
        .limit(1);
      if (employeeRows.length === 0) {
        return { employeeFound: false as const };
      }

      // 1. Get employee's work schedule for this day of week
      const schedules = await tx
        .select({ startTime: workSchedules.startTime, endTime: workSchedules.endTime })
        .from(workSchedules)
        .where(
          and(
            eq(workSchedules.employeeId, employeeId),
            eq(workSchedules.dayOfWeek, dayOfWeek)
          )
        );
      if (schedules.length === 0) {
        return { employeeFound: true as const, schedules, existingAppointments: [], existingBlocks: [] };
      }

      // 2. Get existing appointments for this employee on this date
      const existingAppointments = await tx
        .select({ startTime: appointments.startTime, endTime: appointments.endTime })
        .from(appointments)
        .where(
          and(
            eq(appointments.salonId, salonId),
            eq(appointments.employeeId, employeeId),
            not(eq(appointments.status, "cancelled")),
            gte(appointments.startTime, dayStart),
            lt(appointments.startTime, dayEnd)
          )
        );

      // 3. Get time blocks (vacations, breaks) for this employee on this date
      const existingBlocks = await tx
        .select({
          startTime: timeBlocks.startTime,
          endTime: timeBlocks.endTime,
          blockType: timeBlocks.blockType,
        })
        .from(timeBlocks)
        .where(
          and(
            eq(timeBlocks.employeeId, employeeId),
            // Time block overlaps with the day
            lt(timeBlocks.startTime, dayEnd),
            gte(timeBlocks.endTime, dayStart)
          )
        );

      return { employeeFound: true as const, schedules, existingAppointments, existingBlocks };
    });

    if (!result.employeeFound) {
      return NextResponse.json(EMPLOYEE_NOT_FOUND_BODY, { status: 404 });
    }

    const { schedules, existingAppointments, existingBlocks } = result;

    if (schedules.length === 0) {
      // Employee doesn't work on this day
      return NextResponse.json({
        success: true,
        data: {
          date,
          employeeId,
          duration,
          dayOff: true,
          workStart: null,
          workEnd: null,
          slots: [],
          message: "Pracownik nie pracuje w tym dniu",
        },
      });
    }

    const schedule = schedules[0]!;
    const workStart = schedule.startTime; // e.g., "09:00"
    const workEnd = schedule.endTime; // e.g., "17:00"

    logger.info(`[AvailableSlots API] Found ${existingAppointments.length} existing appointments`);
    logger.info(`[AvailableSlots API] Found ${existingBlocks.length} time blocks`);

    // 4. Build list of blocked time ranges
    interface TimeRange {
      start: number; // minutes from midnight
      end: number; // minutes from midnight
      type: string;
      label?: string;
    }

    const blockedRanges: TimeRange[] = [];

    // Add appointments as blocked ranges
    for (const appt of existingAppointments) {
      const apptStart = new Date(appt.startTime);
      const apptEnd = new Date(appt.endTime);
      blockedRanges.push({
        start: apptStart.getHours() * 60 + apptStart.getMinutes(),
        end: apptEnd.getHours() * 60 + apptEnd.getMinutes(),
        type: "appointment",
        label: `Wizyta ${apptStart.getHours().toString().padStart(2, "0")}:${apptStart.getMinutes().toString().padStart(2, "0")}-${apptEnd.getHours().toString().padStart(2, "0")}:${apptEnd.getMinutes().toString().padStart(2, "0")}`,
      });
    }

    // Add time blocks as blocked ranges
    for (const block of existingBlocks) {
      const blockStart = new Date(block.startTime);
      const blockEnd = new Date(block.endTime);

      // Clamp to the current day
      const startMinutes = blockStart.toDateString() === requestedDate.toDateString()
        ? blockStart.getHours() * 60 + blockStart.getMinutes()
        : 0;
      const endMinutes = blockEnd.toDateString() === requestedDate.toDateString()
        ? blockEnd.getHours() * 60 + blockEnd.getMinutes()
        : 24 * 60;

      blockedRanges.push({
        start: startMinutes,
        end: endMinutes,
        type: block.blockType,
        // NIE ujawniamy `block.reason` (prywatny powód blokady, np. „wizyta lekarska")
        // w publicznej odpowiedzi rezerwacji — etykieta to wyłącznie typ bloku.
        label: block.blockType,
      });
    }

    // 5. Generate available slots with 15-minute intervals
    const SLOT_INTERVAL = 15; // Check every 15 minutes
    const workStartParts = workStart.split(":").map(Number);
    const workEndParts = workEnd.split(":").map(Number);
    const workStartHour = workStartParts[0] ?? 0;
    const workStartMin = workStartParts[1] ?? 0;
    const workEndHour = workEndParts[0] ?? 0;
    const workEndMin = workEndParts[1] ?? 0;
    const workStartMinutes = workStartHour * 60 + workStartMin;
    const workEndMinutes = workEndHour * 60 + workEndMin;

    const slots: Array<{ time: string; available: boolean }> = [];

    // Sloty z przeszlosci nie sa rezerwowalne: dla dnia dzisiejszego odcinamy
    // godziny <= teraz, dla dat wstecznych caly dzien (UAT B-5)
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const isPastDay = requestedDate < todayStart;
    const isToday = requestedDate.getTime() === todayStart.getTime();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();

    for (let slotStart = workStartMinutes; slotStart + duration <= workEndMinutes; slotStart += SLOT_INTERVAL) {
      const slotEnd = slotStart + duration;

      const isPast = isPastDay || (isToday && slotStart <= nowMinutes);

      // Kolizja półotwarta [start, end) — ta sama definicja co przy zapisie (#165)
      const isBlocked = isPast || blockedRanges.some((range) =>
        rangesOverlap(slotStart, slotEnd, range.start, range.end)
      );

      const hours = Math.floor(slotStart / 60);
      const mins = slotStart % 60;
      const timeStr = `${hours.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}`;

      slots.push({
        time: timeStr,
        available: !isBlocked,
      });
    }

    const availableSlots = slots.filter((s) => s.available);

    logger.info(`[AvailableSlots API] Generated ${slots.length} total slots, ${availableSlots.length} available`);

    return NextResponse.json({
      success: true,
      data: {
        date,
        employeeId,
        duration,
        dayOff: false,
        workStart,
        workEnd,
        slots: availableSlots,
        allSlots: slots,
        blockedRanges: blockedRanges.map((r) => ({
          start: `${Math.floor(r.start / 60).toString().padStart(2, "0")}:${(r.start % 60).toString().padStart(2, "0")}`,
          end: `${Math.floor(r.end / 60).toString().padStart(2, "0")}:${(r.end % 60).toString().padStart(2, "0")}`,
          type: r.type,
          label: r.label,
        })),
      },
    });
  } catch (error) {
    logger.error("[AvailableSlots API] Database error", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to calculate available slots" },
      { status: 500 }
    );
  }
}
