import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { employees } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";
import { validateBody, commissionRateSchema } from "@/lib/api-validation";

import { logger } from "@/lib/logger";
// PUT /api/employees/commission-rate - Update employee's default commission rate
export async function PUT(request: Request) {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

    const body = await request.json();
    const validationError = validateBody(commissionRateSchema, body);
    if (validationError) {
      return NextResponse.json(validationError, { status: 400 });
    }
    const { employeeId, commissionRate } = body;

    const rate = parseFloat(commissionRate);

    // Check if employee exists
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

    // Update the commission rate
    const result = await db
      .update(employees)
      .set({ commissionRate: rate.toFixed(2) })
      .where(eq(employees.id, employeeId))
      .returning();

    const updated = result[0];
    if (!updated) {
      return NextResponse.json(
        { success: false, error: "Failed to update employee" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        id: updated.id,
        firstName: updated.firstName,
        lastName: updated.lastName,
        commissionRate: updated.commissionRate,
      },
      message: `Prowizja dla ${updated.firstName} ${updated.lastName} ustawiona na ${rate}%`,
    });
  } catch (error) {
    logger.error("[Commission Rate API] Database error", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to update commission rate" },
      { status: 500 }
    );
  }
}

// GET /api/employees/commission-rate - Get all employees with their commission rates
export async function GET() {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

    const result = await db
      .select({
        id: employees.id,
        firstName: employees.firstName,
        lastName: employees.lastName,
        role: employees.role,
        color: employees.color,
        commissionRate: employees.commissionRate,
        isActive: employees.isActive,
      })
      .from(employees)
      .where(eq(employees.isActive, true))
      .orderBy(employees.firstName);

    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (error) {
    logger.error("[Commission Rate API] Database error", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to fetch commission rates" },
      { status: 500 }
    );
  }
}
