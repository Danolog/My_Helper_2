import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { validateBody, commissionRateSchema } from "@/lib/api-validation";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";
import { getUserSalonId } from "@/lib/get-user-salon";
import { logger } from "@/lib/logger";
import { employees } from "@/lib/schema";
import { forSalon } from "@/lib/server/repository";
// PUT /api/employees/commission-rate - Update employee's default commission rate
export async function PUT(request: Request) {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

    // Tenant isolation (ADR-001): derive the salon from the session — a
    // foreign-salon employee is invisible (scoped lookup -> 404).
    const salonId = await getUserSalonId();
    if (!salonId) {
      return NextResponse.json(
        { success: false, error: "Salon not found" },
        { status: 404 }
      );
    }

    const body = await request.json();
    const validationError = validateBody(commissionRateSchema, body);
    if (validationError) {
      return NextResponse.json(validationError, { status: 400 });
    }
    const { employeeId, commissionRate } = body;

    const rate = parseFloat(commissionRate);

    const repo = forSalon(salonId);

    // Check if employee exists (in the caller's salon)
    const employee = await repo.findOne(employees, employeeId);

    if (!employee) {
      return NextResponse.json(
        { success: false, error: "Employee not found" },
        { status: 404 }
      );
    }

    // Update the commission rate (scoped to the salon)
    const updated = await repo.updateOwned(employees, employeeId, {
      commissionRate: rate.toFixed(2),
    });

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

    // Tenant isolation (ADR-001): list only the caller's salon employees.
    const salonId = await getUserSalonId();
    if (!salonId) {
      return NextResponse.json(
        { success: false, error: "Salon not found" },
        { status: 404 }
      );
    }

    const result = await forSalon(salonId).raw((tx) =>
      tx
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
        .where(and(eq(employees.salonId, salonId), eq(employees.isActive, true)))
        .orderBy(employees.firstName)
    );

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
