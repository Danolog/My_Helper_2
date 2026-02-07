import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { workSchedules, employees } from "@/lib/schema";
import { eq } from "drizzle-orm";

// GET /api/work-schedules?employeeId=xxx
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const employeeId = searchParams.get("employeeId");

    if (!employeeId) {
      return NextResponse.json(
        { success: false, error: "employeeId is required" },
        { status: 400 }
      );
    }

    console.log("[WorkSchedules API] GET for employee:", employeeId);

    const schedules = await db
      .select()
      .from(workSchedules)
      .where(eq(workSchedules.employeeId, employeeId))
      .orderBy(workSchedules.dayOfWeek);

    console.log(`[WorkSchedules API] Found ${schedules.length} schedule entries`);

    return NextResponse.json({
      success: true,
      data: schedules,
      count: schedules.length,
    });
  } catch (error) {
    console.error("[WorkSchedules API] Database error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch work schedules" },
      { status: 500 }
    );
  }
}

// POST /api/work-schedules - Create or update work schedule for an employee
// Accepts a full week schedule: { employeeId, schedules: [{ dayOfWeek, startTime, endTime, isDayOff }] }
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { employeeId, schedules } = body;

    if (!employeeId) {
      return NextResponse.json(
        { success: false, error: "employeeId is required" },
        { status: 400 }
      );
    }

    if (!schedules || !Array.isArray(schedules)) {
      return NextResponse.json(
        { success: false, error: "schedules array is required" },
        { status: 400 }
      );
    }

    // Verify employee exists
    const [employee] = await db
      .select()
      .from(employees)
      .where(eq(employees.id, employeeId))
      .limit(1);

    if (!employee) {
      return NextResponse.json(
        { success: false, error: "Employee not found" },
        { status: 404 }
      );
    }

    console.log(`[WorkSchedules API] Saving schedule for employee: ${employeeId}`);

    // Delete existing schedules for this employee
    await db
      .delete(workSchedules)
      .where(eq(workSchedules.employeeId, employeeId));

    // Insert new schedules (skip days marked as day off)
    const schedulesToInsert = schedules
      .filter((s: { isDayOff?: boolean }) => !s.isDayOff)
      .map((s: { dayOfWeek: number; startTime: string; endTime: string }) => ({
        employeeId,
        dayOfWeek: s.dayOfWeek,
        startTime: s.startTime,
        endTime: s.endTime,
      }));

    let insertedSchedules: typeof workSchedules.$inferSelect[] = [];
    if (schedulesToInsert.length > 0) {
      insertedSchedules = await db
        .insert(workSchedules)
        .values(schedulesToInsert)
        .returning();
    }

    console.log(`[WorkSchedules API] Saved ${insertedSchedules.length} schedule entries`);

    return NextResponse.json({
      success: true,
      data: insertedSchedules,
      count: insertedSchedules.length,
      message: `Schedule saved with ${insertedSchedules.length} working days`,
    });
  } catch (error) {
    console.error("[WorkSchedules API] Database error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to save work schedule" },
      { status: 500 }
    );
  }
}
