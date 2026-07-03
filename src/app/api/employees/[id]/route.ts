import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { withApiHandler } from "@/lib/api-handler";
import { validateBody, updateEmployeeSchema } from "@/lib/api-validation";
import { getUserSalonId } from "@/lib/get-user-salon";
import { employees, employeeServices } from "@/lib/schema";
import { forSalon } from "@/lib/server/repository";
// GET /api/employees/[id] - Get single employee with assigned services
export const GET = withApiHandler(
  {
    auth: "user",
    logLabel: "[Employees API] GET by id",
    errorMessage: "Nie udalo sie pobrac pracownika",
  },
  async ({ params }) => {
    const salonId = await getUserSalonId();
    if (!salonId) {
      return NextResponse.json(
        { success: false, error: "Salon not found" },
        { status: 404 }
      );
    }

    const id = params.id!; // segment [id] zawsze obecny w trasie dynamicznej

    const employee = await forSalon(salonId).findOne(employees, id);

    if (!employee) {
      return NextResponse.json(
        { success: false, error: "Nie znaleziono pracownika" },
        { status: 404 }
      );
    }

    // employeeServices jest salon-scoped POSREDNIO (przez employees.salon_id) —
    // czytamy w kontekscie RLS przez raw; wlasciciel juz zweryfikowany powyzej.
    const assignedServices = await forSalon(salonId).raw((tx) =>
      tx
        .select({ serviceId: employeeServices.serviceId })
        .from(employeeServices)
        .where(eq(employeeServices.employeeId, id))
    );

    return NextResponse.json({
      success: true,
      data: {
        ...employee,
        serviceIds: assignedServices.map((s) => s.serviceId),
      },
    });
  }
);

// PUT /api/employees/[id] - Update employee and their service assignments
export const PUT = withApiHandler(
  {
    auth: "user",
    logLabel: "[Employees API] PUT",
    errorMessage: "Nie udalo sie zaktualizowac pracownika",
  },
  async ({ request, params }) => {
    const salonId = await getUserSalonId();
    if (!salonId) {
      return NextResponse.json(
        { success: false, error: "Salon not found" },
        { status: 404 }
      );
    }

    const id = params.id!; // segment [id] zawsze obecny w trasie dynamicznej
    // Walidacja pozostaje w handlerze (nie w opcji schema): oryginalna
    // kolejnosc krokow to salon -> walidacja, a wrapper walidowalby wczesniej.
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

    // Check employee exists in the caller's salon
    const existing = await forSalon(salonId).findOne(employees, id);

    if (!existing) {
      return NextResponse.json(
        { success: false, error: "Nie znaleziono pracownika" },
        { status: 404 }
      );
    }

    // Aktualizacja pracownika + przypisan uslug atomowo w jednej transakcji
    // z kontekstem RLS (employeeServices salon-scoped posrednio przez employees).
    const updated = await forSalon(salonId).raw(async (tx) => {
      const [row] = await tx
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
        .where(and(eq(employees.id, id), eq(employees.salonId, salonId)))
        .returning();

      // Update service assignments if provided
      if (Array.isArray(serviceIds)) {
        // Remove all existing assignments
        await tx
          .delete(employeeServices)
          .where(eq(employeeServices.employeeId, id));

        // Insert new assignments
        if (serviceIds.length > 0) {
          await tx.insert(employeeServices).values(
            serviceIds.map((serviceId: string) => ({
              employeeId: id,
              serviceId,
            }))
          );
        }
      }

      return row;
    });

    return NextResponse.json({ success: true, data: updated });
  }
);
