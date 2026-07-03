import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { withApiHandler } from "@/lib/api-handler";
import { validateBody, commissionRateSchema } from "@/lib/api-validation";
import { getUserSalonId } from "@/lib/get-user-salon";
import { employees } from "@/lib/schema";
import { forSalon } from "@/lib/server/repository";
// PUT /api/employees/commission-rate - Update employee's default commission rate
export const PUT = withApiHandler(
  {
    auth: "user",
    logLabel: "[Commission Rate API] PUT",
    errorMessage: "Failed to update commission rate",
  },
  async ({ request }) => {
    // Tenant isolation (ADR-001): derive the salon from the session — a
    // foreign-salon employee is invisible (scoped lookup -> 404).
    const salonId = await getUserSalonId();
    if (!salonId) {
      return NextResponse.json(
        { success: false, error: "Salon not found" },
        { status: 404 }
      );
    }

    // Walidacja pozostaje w handlerze (nie w opcji schema): oryginalna
    // kolejnosc krokow to salon -> walidacja, a wrapper walidowalby wczesniej.
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
  }
);

// GET /api/employees/commission-rate - Get all employees with their commission rates
export const GET = withApiHandler(
  {
    auth: "user",
    logLabel: "[Commission Rate API] GET",
    errorMessage: "Failed to fetch commission rates",
  },
  async () => {
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
  }
);
