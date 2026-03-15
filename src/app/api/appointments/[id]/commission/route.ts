import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { employeeCommissions, employees } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";

import { logger } from "@/lib/logger";
// GET /api/appointments/[id]/commission - Get commission info for an appointment
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

    const { id } = await params;

    const result = await db
      .select({
        commission: employeeCommissions,
        employee: employees,
      })
      .from(employeeCommissions)
      .leftJoin(employees, eq(employeeCommissions.employeeId, employees.id))
      .where(eq(employeeCommissions.appointmentId, id))
      .limit(1);

    const row = result[0];

    return NextResponse.json({
      success: true,
      data: row
        ? {
            ...row.commission,
            employee: row.employee
              ? {
                  id: row.employee.id,
                  firstName: row.employee.firstName,
                  lastName: row.employee.lastName,
                }
              : null,
          }
        : null,
    });
  } catch (error) {
    logger.error("[Commission API] Database error", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to fetch commission" },
      { status: 500 }
    );
  }
}
