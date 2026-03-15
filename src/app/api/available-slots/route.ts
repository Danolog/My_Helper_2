import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { appointments, workSchedules, timeBlocks } from "@/lib/schema";
import { eq, and, gte, lt, not } from "drizzle-orm";

import { logger } from "@/lib/logger";
// GET /api/available-slots?employeeId=xxx&date=2026-02-10&duration=60
// Returns available time slots for booking
export async function GET(request: Request) {
  try {
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

    const dayOfWeek = requestedDate.getDay(); // 0=Sunday, 1=Monday, ...

    logger.info(`[AvailableSlots API] Query for employee=${employeeId}, date=${date}, duration=${duration}min, dayOfWeek=${dayOfWeek}`);

    // 1. Get employee's work schedule for this day of week
    const schedules = await db
      .select()
      .from(workSchedules)
      .where(
        and(
          eq(workSchedules.employeeId, employeeId),
          eq(workSchedules.dayOfWeek, dayOfWeek)
        )
      );

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

    // 2. Get existing appointments for this employee on this date
    const dayStart = new Date(date + "T00:00:00");
    const dayEnd = new Date(date + "T23:59:59");

    const existingAppointments = await db
      .select()
      .from(appointments)
      .where(
        and(
          eq(appointments.employeeId, employeeId),
          not(eq(appointments.status, "cancelled")),
          gte(appointments.startTime, dayStart),
          lt(appointments.startTime, dayEnd)
        )
      );

    logger.info(`[AvailableSlots API] Found ${existingAppointments.length} existing appointments`);

    // 3. Get time blocks (vacations, breaks) for this employee on this date
    const existingBlocks = await db
      .select()
      .from(timeBlocks)
      .where(
        and(
          eq(timeBlocks.employeeId, employeeId),
          // Time block overlaps with the day
          lt(timeBlocks.startTime, dayEnd),
          gte(timeBlocks.endTime, dayStart)
        )
      );

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
        label: block.reason || block.blockType,
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

    for (let slotStart = workStartMinutes; slotStart + duration <= workEndMinutes; slotStart += SLOT_INTERVAL) {
      const slotEnd = slotStart + duration;

      // Check if this slot overlaps with any blocked range
      const isBlocked = blockedRanges.some((range) => {
        return slotStart < range.end && slotEnd > range.start;
      });

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
