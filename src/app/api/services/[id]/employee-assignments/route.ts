import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { employeeServices, employees } from "@/lib/schema";
import { eq, and } from "drizzle-orm";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";

// GET /api/services/[id]/employee-assignments - List employees assigned to this service
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

    const { id: serviceId } = await params;

    const assignments = await db
      .select({
        assignment: employeeServices,
        employee: employees,
      })
      .from(employeeServices)
      .leftJoin(employees, eq(employeeServices.employeeId, employees.id))
      .where(eq(employeeServices.serviceId, serviceId));

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
    console.error("[Employee Assignments API] Error fetching assignments:", error);
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

    const { id: serviceId } = await params;
    const body = await request.json();
    const { employeeId } = body;

    if (!employeeId) {
      return NextResponse.json(
        { success: false, error: "employeeId is required" },
        { status: 400 }
      );
    }

    // Check if already assigned
    const existing = await db
      .select()
      .from(employeeServices)
      .where(
        and(
          eq(employeeServices.employeeId, employeeId),
          eq(employeeServices.serviceId, serviceId)
        )
      );

    if (existing.length > 0) {
      return NextResponse.json({
        success: true,
        data: existing[0],
        message: "Employee already assigned to this service",
      });
    }

    const [newAssignment] = await db
      .insert(employeeServices)
      .values({
        employeeId,
        serviceId,
      })
      .returning();

    return NextResponse.json(
      {
        success: true,
        data: newAssignment,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("[Employee Assignments API] Error creating assignment:", error);
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

    const { id: serviceId } = await params;
    const { searchParams } = new URL(request.url);
    const employeeId = searchParams.get("employeeId");

    if (!employeeId) {
      return NextResponse.json(
        { success: false, error: "employeeId is required" },
        { status: 400 }
      );
    }

    const deleted = await db
      .delete(employeeServices)
      .where(
        and(
          eq(employeeServices.employeeId, employeeId),
          eq(employeeServices.serviceId, serviceId)
        )
      )
      .returning();

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
    console.error("[Employee Assignments API] Error deleting assignment:", error);
    return NextResponse.json(
      { success: false, error: "Failed to unassign employee" },
      { status: 500 }
    );
  }
}
