import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { validateBody, createWorkScheduleSchema } from "@/lib/api-validation";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";
import { getUserSalonId } from "@/lib/get-user-salon";
import { logger } from "@/lib/logger";
import { apiRateLimit, getClientIp } from "@/lib/rate-limit";
import { workSchedules, employees } from "@/lib/schema";
import { forSalon } from "@/lib/server/repository";
// GET /api/work-schedules?employeeId=xxx
export async function GET(request: Request) {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;
    const { searchParams } = new URL(request.url);
    const employeeId = searchParams.get("employeeId");

    if (!employeeId) {
      return NextResponse.json(
        { success: false, error: "employeeId is required" },
        { status: 400 }
      );
    }

    const salonId = await getUserSalonId();
    if (!salonId) {
      return NextResponse.json(
        { success: false, error: "Salon not found" },
        { status: 404 }
      );
    }

    logger.info("[WorkSchedules API] GET for employee", { employeeId });

    // workSchedules nie ma kolumny salonId — scope przez join z employees
    // (tabela nadrzędna) i jawny eq(employees.salonId, salonId).
    const schedules = await forSalon(salonId).raw((tx) =>
      tx
        .select({
          id: workSchedules.id,
          employeeId: workSchedules.employeeId,
          dayOfWeek: workSchedules.dayOfWeek,
          startTime: workSchedules.startTime,
          endTime: workSchedules.endTime,
          createdAt: workSchedules.createdAt,
        })
        .from(workSchedules)
        .innerJoin(employees, eq(workSchedules.employeeId, employees.id))
        .where(
          and(
            eq(workSchedules.employeeId, employeeId),
            eq(employees.salonId, salonId)
          )
        )
        .orderBy(workSchedules.dayOfWeek)
    );

    logger.info(`[WorkSchedules API] Found ${schedules.length} schedule entries`);

    return NextResponse.json({
      success: true,
      data: schedules,
      count: schedules.length,
    });
  } catch (error) {
    logger.error("[WorkSchedules API] Database error", { error: error });
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
    const ip = getClientIp(request);
    const rateLimitResult = apiRateLimit.check(ip);
    if (!rateLimitResult.success) {
      return NextResponse.json(
        { success: false, error: "Zbyt wiele żądań. Spróbuj ponownie później." },
        { status: 429, headers: { "Retry-After": String(Math.ceil(rateLimitResult.reset / 1000)) } }
      );
    }

    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;
    const body = await request.json();
    const validationError = validateBody(createWorkScheduleSchema, body);
    if (validationError) {
      return NextResponse.json(validationError, { status: 400 });
    }
    const { employeeId, schedules } = body;

    const salonId = await getUserSalonId();
    if (!salonId) {
      return NextResponse.json(
        { success: false, error: "Salon not found" },
        { status: 404 }
      );
    }

    // Insert new schedules (skip days marked as day off)
    const schedulesToInsert = schedules
      .filter((s: { isDayOff?: boolean }) => !s.isDayOff)
      .map((s: { dayOfWeek: number; startTime: string; endTime: string }) => ({
        employeeId,
        dayOfWeek: s.dayOfWeek,
        startTime: s.startTime,
        endTime: s.endTime,
      }));

    // workSchedules nie ma kolumny salonId — najpierw weryfikacja, że pracownik
    // należy do salonu (jawny eq(employees.salonId, salonId) na tabeli
    // nadrzędnej), potem delete+insert w tej samej transakcji RLS.
    const insertedSchedules = await forSalon(salonId).raw(async (tx) => {
      const [employee] = await tx
        .select()
        .from(employees)
        .where(and(eq(employees.id, employeeId), eq(employees.salonId, salonId)))
        .limit(1);

      if (!employee) return null;

      logger.info(`[WorkSchedules API] Saving schedule for employee: ${employeeId}`);

      // Delete existing schedules for this employee
      await tx
        .delete(workSchedules)
        .where(eq(workSchedules.employeeId, employeeId));

      let inserted: typeof workSchedules.$inferSelect[] = [];
      if (schedulesToInsert.length > 0) {
        inserted = await tx
          .insert(workSchedules)
          .values(schedulesToInsert)
          .returning();
      }
      return inserted;
    });

    if (insertedSchedules === null) {
      return NextResponse.json(
        { success: false, error: "Employee not found" },
        { status: 404 }
      );
    }

    logger.info(`[WorkSchedules API] Saved ${insertedSchedules.length} schedule entries`);

    return NextResponse.json({
      success: true,
      data: insertedSchedules,
      count: insertedSchedules.length,
      message: `Schedule saved with ${insertedSchedules.length} working days`,
    });
  } catch (error) {
    logger.error("[WorkSchedules API] Database error", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to save work schedule" },
      { status: 500 }
    );
  }
}
