import { NextResponse } from "next/server";
import { workSchedules, employees } from "@/lib/schema";
import { eq, and } from "drizzle-orm";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";
import { getUserSalonId } from "@/lib/get-user-salon";
import { validateBody, createWorkScheduleSchema } from "@/lib/api-validation";
import { apiRateLimit, getClientIp } from "@/lib/rate-limit";
import { forSalon } from "@/lib/server/repository";

import { logger } from "@/lib/logger";
// GET /api/work-schedules?employeeId=xxx
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
    const employeeId = searchParams.get("employeeId");

    if (!employeeId) {
      return NextResponse.json(
        { success: false, error: "employeeId is required" },
        { status: 400 }
      );
    }

    logger.info("[WorkSchedules API] GET for employee", { employeeId });

    // work_schedules nie ma kolumny salon_id — izolacja przez RLS pośrednią
    // (polityka EXISTS na employees.salon_id, migracja 0005). forSalon ustawia
    // kontekst app.current_salon_id, więc baza odcina harmonogramy cudzych salonów.
    const schedules = await forSalon(salonId).raw((tx) =>
      tx
        .select()
        .from(workSchedules)
        .where(eq(workSchedules.employeeId, employeeId))
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

    const salonId = await getUserSalonId();
    if (!salonId) {
      return NextResponse.json(
        { success: false, error: "Salon not found" },
        { status: 404 }
      );
    }

    const body = await request.json();
    const validationError = validateBody(createWorkScheduleSchema, body);
    if (validationError) {
      return NextResponse.json(validationError, { status: 400 });
    }
    const { employeeId, schedules } = body;

    // Insert new schedules (skip days marked as day off)
    const schedulesToInsert = schedules
      .filter((s: { isDayOff?: boolean }) => !s.isDayOff)
      .map((s: { dayOfWeek: number; startTime: string; endTime: string }) => ({
        employeeId,
        dayOfWeek: s.dayOfWeek,
        startTime: s.startTime,
        endTime: s.endTime,
      }));

    logger.info(`[WorkSchedules API] Saving schedule for employee: ${employeeId}`);

    // Multi-step (weryfikacja pracownika + delete + insert) w jednej transakcji
    // forSalon — atomowość zachowana. employees/work_schedules pod RLS (bezpośredni
    // i pośredni salon_id) odcinają cudze wiersze nawet bez jawnego eq(salonId)
    // na work_schedules (ta tabela kolumny salon_id nie ma).
    const txResult = await forSalon(salonId).raw(async (tx) => {
      // Verify employee exists (RLS zawęża do pracowników tego salonu)
      const [employee] = await tx
        .select()
        .from(employees)
        .where(and(eq(employees.id, employeeId), eq(employees.salonId, salonId)))
        .limit(1);

      if (!employee) {
        return { notFound: true as const, inserted: [] as typeof workSchedules.$inferSelect[] };
      }

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
      return { notFound: false as const, inserted };
    });

    if (txResult.notFound) {
      return NextResponse.json(
        { success: false, error: "Employee not found" },
        { status: 404 }
      );
    }

    const insertedSchedules = txResult.inserted;
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
