import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { withApiHandler } from "@/lib/api-handler";
import { logger } from "@/lib/logger";
import { workSchedules, employees } from "@/lib/schema";
import { forSalon } from "@/lib/server/repository";
// GET /api/work-schedules/by-salon?salonId=xxx&dayOfWeek=1
// Returns all work schedules for active employees in a salon, optionally filtered by day
export const GET = withApiHandler(
  {
    auth: "user",
    logLabel: "[WorkSchedules BySalon API] GET",
    errorMessage: "Failed to fetch work schedules",
  },
  async ({ request }) => {
    const { searchParams } = new URL(request.url);
    const salonId = searchParams.get("salonId");
    const dayOfWeekStr = searchParams.get("dayOfWeek");

    if (!salonId) {
      return NextResponse.json(
        { success: false, error: "salonId is required" },
        { status: 400 }
      );
    }

    logger.info("[WorkSchedules BySalon API] GET for salon", { salonId });

    // workSchedules nie ma kolumny salonId — scope przez tabelę nadrzędną
    // employees (jawny eq(employees.salonId, salonId)) w jednej transakcji RLS.
    const allSchedules = await forSalon(salonId).raw(async (tx) => {
      // Get all active employees for the salon
      const activeEmployees = await tx
        .select({ id: employees.id })
        .from(employees)
        .where(and(eq(employees.salonId, salonId), eq(employees.isActive, true)));

      const employeeIds = activeEmployees.map((e) => e.id);

      // Fetch schedules for all active employees
      const schedulesForSalon: (typeof workSchedules.$inferSelect)[] = [];
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
        const schedules = await tx
          .select()
          .from(workSchedules)
          .where(conditions);
        schedulesForSalon.push(...schedules);
      }
      return schedulesForSalon;
    });

    logger.info(`[WorkSchedules BySalon API] Found ${allSchedules.length} schedule entries`);

    return NextResponse.json({
      success: true,
      data: allSchedules,
      count: allSchedules.length,
    });
  }
);
