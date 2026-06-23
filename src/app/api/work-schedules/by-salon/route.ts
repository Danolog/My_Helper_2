import { NextResponse } from "next/server";
import { workSchedules, employees } from "@/lib/schema";
import { eq, and } from "drizzle-orm";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";
import { getUserSalonId } from "@/lib/get-user-salon";
import { forSalon } from "@/lib/server/repository";

import { logger } from "@/lib/logger";
// GET /api/work-schedules/by-salon?salonId=xxx&dayOfWeek=1
// Returns all work schedules for active employees in a salon, optionally filtered by day
export async function GET(request: Request) {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

    const salonId = await getUserSalonId();
    if (!salonId) {
      return NextResponse.json(
        { success: false, error: "Salon not found" },
        { status: 404 }
      );
    }

    const { searchParams } = new URL(request.url);
    const dayOfWeekStr = searchParams.get("dayOfWeek");

    logger.info("[WorkSchedules BySalon API] GET for salon", { salonId });

    // Pobranie aktywnych pracowników + ich harmonogramów w jednym kontekście RLS.
    // employees ma bezpośredni salon_id (jawny eq zachowany — defense in depth),
    // work_schedules izolowane pośrednio przez RLS (EXISTS na employees.salon_id).
    const allSchedules = await forSalon(salonId).raw(async (tx) => {
      // Get all active employees for the salon
      const activeEmployees = await tx
        .select({ id: employees.id })
        .from(employees)
        .where(and(eq(employees.salonId, salonId), eq(employees.isActive, true)));

      const employeeIds = activeEmployees.map((e) => e.id);

      const result: (typeof workSchedules.$inferSelect)[] = [];
      // Fetch schedules for all active employees
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
        result.push(...schedules);
      }
      return result;
    });

    logger.info(`[WorkSchedules BySalon API] Found ${allSchedules.length} schedule entries`);

    return NextResponse.json({
      success: true,
      data: allSchedules,
      count: allSchedules.length,
    });
  } catch (error) {
    logger.error("[WorkSchedules BySalon API] Database error", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to fetch work schedules" },
      { status: 500 }
    );
  }
}
