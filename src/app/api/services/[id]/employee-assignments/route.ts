import { NextResponse } from "next/server";
import { employeeServices, employees, services } from "@/lib/schema";
import { eq, and } from "drizzle-orm";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";
import { getUserSalonId } from "@/lib/get-user-salon";
import { validateBody, employeeAssignmentSchema } from "@/lib/api-validation";
import { forSalon } from "@/lib/server/repository";

/** Verify the service belongs to the caller's salon. */
async function serviceBelongsToSalon(serviceId: string, salonId: string): Promise<boolean> {
  const service = await forSalon(salonId).findOne(services, serviceId);
  return !!service;
}

import { logger } from "@/lib/logger";
// GET /api/services/[id]/employee-assignments - List employees assigned to this service
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
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

    const { id: serviceId } = await params;

    if (!(await serviceBelongsToSalon(serviceId, salonId))) {
      return NextResponse.json(
        { success: false, error: "Service not found" },
        { status: 404 }
      );
    }

    const assignments = await forSalon(salonId).raw((tx) =>
      tx
        .select({
          assignment: employeeServices,
          employee: employees,
        })
        .from(employeeServices)
        .leftJoin(employees, eq(employeeServices.employeeId, employees.id))
        .where(eq(employeeServices.serviceId, serviceId))
    );

    const formatted = assignments.map((row) => ({
      ...row.assignment,
      employee: row.employee,
    }));

    return NextResponse.json({
      success: true,
      data: formatted,
      count: formatted.length,
    });
  } catch (error) {
    logger.error("[Employee Assignments API] Error fetching assignments", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to fetch employee assignments" },
      { status: 500 }
    );
  }
}

// POST /api/services/[id]/employee-assignments - Assign an employee to this service
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
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

    const { id: serviceId } = await params;
    const body = await request.json();
    const validationError = validateBody(employeeAssignmentSchema, body);
    if (validationError) {
      return NextResponse.json(validationError, { status: 400 });
    }
    const { employeeId } = body;

    if (!(await serviceBelongsToSalon(serviceId, salonId))) {
      return NextResponse.json(
        { success: false, error: "Service not found" },
        { status: 404 }
      );
    }

    // Verify the employee belongs to the caller's salon
    const ownedEmployee = await forSalon(salonId).findOne(employees, employeeId);
    if (!ownedEmployee) {
      return NextResponse.json(
        { success: false, error: "Employee not found" },
        { status: 404 }
      );
    }

    // Sprawdzenie istniejacego przypisania + insert atomowo w transakcji RLS.
    const { row, alreadyAssigned } = await forSalon(salonId).raw(async (tx) => {
      // Check if already assigned
      const existing = await tx
        .select()
        .from(employeeServices)
        .where(
          and(
            eq(employeeServices.employeeId, employeeId),
            eq(employeeServices.serviceId, serviceId)
          )
        );

      if (existing.length > 0) {
        return { row: existing[0], alreadyAssigned: true };
      }

      const [newAssignment] = await tx
        .insert(employeeServices)
        .values({
          employeeId,
          serviceId,
        })
        .returning();
      return { row: newAssignment, alreadyAssigned: false };
    });

    if (alreadyAssigned) {
      return NextResponse.json({
        success: true,
        data: row,
        message: "Employee already assigned to this service",
      });
    }

    return NextResponse.json(
      {
        success: true,
        data: row,
      },
      { status: 201 }
    );
  } catch (error) {
    logger.error("[Employee Assignments API] Error creating assignment", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to assign employee" },
      { status: 500 }
    );
  }
}

// DELETE /api/services/[id]/employee-assignments - Unassign an employee from this service
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
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

    const { id: serviceId } = await params;
    const { searchParams } = new URL(request.url);
    const employeeId = searchParams.get("employeeId");

    if (!employeeId) {
      return NextResponse.json(
        { success: false, error: "employeeId is required" },
        { status: 400 }
      );
    }

    if (!(await serviceBelongsToSalon(serviceId, salonId))) {
      return NextResponse.json(
        { success: false, error: "Service not found" },
        { status: 404 }
      );
    }

    const deleted = await forSalon(salonId).raw((tx) =>
      tx
        .delete(employeeServices)
        .where(
          and(
            eq(employeeServices.employeeId, employeeId),
            eq(employeeServices.serviceId, serviceId)
          )
        )
        .returning()
    );

    if (deleted.length === 0) {
      return NextResponse.json(
        { success: false, error: "Assignment not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: deleted[0],
    });
  } catch (error) {
    logger.error("[Employee Assignments API] Error deleting assignment", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to unassign employee" },
      { status: 500 }
    );
  }
}
