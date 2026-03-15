import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { employees, employeeServices } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { validateBody, updateEmployeeSchema } from "@/lib/api-validation";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";

// GET /api/employees/[id] - Get single employee with assigned services
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

    const { id } = await params;

    const [employee] = await db
      .select()
      .from(employees)
      .where(eq(employees.id, id));

    if (!employee) {
      return NextResponse.json(
        { success: false, error: "Nie znaleziono pracownika" },
        { status: 404 }
      );
    }

    const assignedServices = await db
      .select({ serviceId: employeeServices.serviceId })
      .from(employeeServices)
      .where(eq(employeeServices.employeeId, id));

    return NextResponse.json({
      success: true,
      data: {
        ...employee,
        serviceIds: assignedServices.map((s) => s.serviceId),
      },
    });
  } catch (error) {
    console.error("[Employees API] GET by id error:", error);
    return NextResponse.json(
      { success: false, error: "Nie udalo sie pobrac pracownika" },
      { status: 500 }
    );
  }
}

// PUT /api/employees/[id] - Update employee and their service assignments
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

    const { id } = await params;
    const body = await request.json();

    // Server-side validation with Zod schema
    const validationError = validateBody(updateEmployeeSchema, body);
    if (validationError) {
      return NextResponse.json(validationError, { status: 400 });
    }

    const { firstName, lastName, email, phone, role, isActive, serviceIds } =
      body;

    // Validate required fields for update — at least one of firstName or lastName
    // must be non-empty when provided
    if (firstName !== undefined && !firstName?.trim()) {
      return NextResponse.json(
        { success: false, error: "Imie nie moze byc puste" },
        { status: 400 }
      );
    }
    if (lastName !== undefined && !lastName?.trim()) {
      return NextResponse.json(
        { success: false, error: "Nazwisko nie moze byc puste" },
        { status: 400 }
      );
    }

    // Check employee exists
    const [existing] = await db
      .select()
      .from(employees)
      .where(eq(employees.id, id));

    if (!existing) {
      return NextResponse.json(
        { success: false, error: "Nie znaleziono pracownika" },
        { status: 404 }
      );
    }

    // Update employee
    const [updated] = await db
      .update(employees)
      .set({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email?.trim() || null,
        phone: phone?.trim() || null,
        role: role || existing.role,
        isActive: typeof isActive === "boolean" ? isActive : existing.isActive,
        updatedAt: new Date(),
      })
      .where(eq(employees.id, id))
      .returning();

    // Update service assignments if provided
    if (Array.isArray(serviceIds)) {
      // Remove all existing assignments
      await db
        .delete(employeeServices)
        .where(eq(employeeServices.employeeId, id));

      // Insert new assignments
      if (serviceIds.length > 0) {
        await db.insert(employeeServices).values(
          serviceIds.map((serviceId: string) => ({
            employeeId: id,
            serviceId,
          }))
        );
      }
    }

    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    console.error("[Employees API] PUT error:", error);
    return NextResponse.json(
      { success: false, error: "Nie udalo sie zaktualizowac pracownika" },
      { status: 500 }
    );
  }
}
