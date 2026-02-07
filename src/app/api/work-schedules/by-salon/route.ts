import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { workSchedules, employees } from "@/lib/schema";
import { eq, and } from "drizzle-orm";

// GET /api/work-schedules/by-salon?salonId=xxx&dayOfWeek=1
// Returns all work schedules for active employees in a salon, optionally filtered by day
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const salonId = searchParams.get("salonId");
    const dayOfWeekStr = searchParams.get("dayOfWeek");

    if (!salonId) {
      return NextResponse.json(
        { success: false, error: "salonId is required" },
        { status: 400 }
      );
    }

    console.log("[WorkSchedules BySalon API] GET for salon:", salonId, "day:", dayOfWeekStr);

    // Get all active employees for the salon
    const activeEmployees = await db
      .select({ id: employees.id })
      .from(employees)
      .where(and(eq(employees.salonId, salonId), eq(employees.isActive, true)));

    const employeeIds = activeEmployees.map((e) => e.id);

    if (employeeIds.length === 0) {
      return NextResponse.json({
        success: true,
        data: [],
        count: 0,
      });
    }

    // Fetch schedules for all active employees
    let allSchedules: (typeof workSchedules.$inferSelect)[] = [];
    for (const empId of employeeIds) {
      let conditions;
      if (dayOfWeekStr !== null && dayOfWeekStr !== undefined) {
        const dayOfWeek = parseInt(dayOfWeekStr, 10);
        conditions = and(
          eq(workSchedules.employeeId, empId),
          eq(workSchedules.dayOfWeek, dayOfWeek)
        );
      } else {
        conditions = eq(workSchedules.employeeId, empId);
      }
      const schedules = await db
        .select()
        .from(workSchedules)
        .where(conditions);
      allSchedules.push(...schedules);
    }

    console.log(`[WorkSchedules BySalon API] Found ${allSchedules.length} schedule entries`);

    return NextResponse.json({
      success: true,
      data: allSchedules,
      count: allSchedules.length,
    });
  } catch (error) {
    console.error("[WorkSchedules BySalon API] Database error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch work schedules" },
      { status: 500 }
    );
  }
}
