import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { withApiHandler } from "@/lib/api-handler";
import { validateBody, employeeAssignmentSchema } from "@/lib/api-validation";
import { getUserSalonId } from "@/lib/get-user-salon";
import { employeeServices, employees, services } from "@/lib/schema";
import { forSalon } from "@/lib/server/repository";

/** Verify the service belongs to the caller's salon. */
async function serviceBelongsToSalon(serviceId: string, salonId: string): Promise<boolean> {
  const service = await forSalon(salonId).findOne(services, serviceId);
  return !!service;
}

// GET /api/services/[id]/employee-assignments - List employees assigned to this service
export const GET = withApiHandler(
  {
    auth: "user",
    logLabel: "[Employee Assignments API] GET",
    errorMessage: "Failed to fetch employee assignments",
  },
  async ({ params }) => {
    const salonId = await getUserSalonId();
    if (!salonId) {
      return NextResponse.json(
        { success: false, error: "Salon not found" },
        { status: 404 }
      );
    }

    const serviceId = params.id!; // segment [id] zawsze obecny (noUncheckedIndexedAccess)

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
  }
);

// POST /api/services/[id]/employee-assignments - Assign an employee to this service
export const POST = withApiHandler(
  {
    auth: "user",
    logLabel: "[Employee Assignments API] POST",
    errorMessage: "Failed to assign employee",
  },
  async ({ request, params }) => {
    const salonId = await getUserSalonId();
    if (!salonId) {
      return NextResponse.json(
        { success: false, error: "Salon not found" },
        { status: 404 }
      );
    }

    const serviceId = params.id!; // segment [id] zawsze obecny (noUncheckedIndexedAccess)
    // Walidacja celowo w handlerze (po sprawdzeniu salonu) — jak dotąd.
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
  }
);

// DELETE /api/services/[id]/employee-assignments - Unassign an employee from this service
export const DELETE = withApiHandler(
  {
    auth: "user",
    logLabel: "[Employee Assignments API] DELETE",
    errorMessage: "Failed to unassign employee",
  },
  async ({ request, params }) => {
    const salonId = await getUserSalonId();
    if (!salonId) {
      return NextResponse.json(
        { success: false, error: "Salon not found" },
        { status: 404 }
      );
    }

    const serviceId = params.id!; // segment [id] zawsze obecny (noUncheckedIndexedAccess)
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
  }
);
