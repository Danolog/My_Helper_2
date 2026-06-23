import { NextResponse } from "next/server";
import { employees } from "@/lib/schema";
import { eq, and } from "drizzle-orm";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";
import { getUserSalonId } from "@/lib/get-user-salon";
import { validateBody, commissionRateSchema } from "@/lib/api-validation";
import { forSalon } from "@/lib/server/repository";

import { logger } from "@/lib/logger";
// PUT /api/employees/commission-rate - Update employee's default commission rate
export async function PUT(request: Request) {
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

    const body = await request.json();
    const validationError = validateBody(commissionRateSchema, body);
    if (validationError) {
      return NextResponse.json(validationError, { status: 400 });
    }
    const { employeeId, commissionRate } = body;

    const rate = parseFloat(commissionRate);

    // Weryfikacja istnienia + update prowizji w jednej transakcji forSalon.
    // employees pod RLS (bezpośredni salon_id, jawny eq jako defense in depth) —
    // odcina pracowników cudzych salonów (naprawa istniejącego braku filtra salonu).
    const txResult = await forSalon(salonId).raw(async (tx) => {
      const [employee] = await tx
        .select()
        .from(employees)
        .where(and(eq(employees.id, employeeId), eq(employees.salonId, salonId)))
        .limit(1);

      if (!employee) {
        return { notFound: true as const, updated: undefined as typeof employees.$inferSelect | undefined };
      }

      const rows = await tx
        .update(employees)
        .set({ commissionRate: rate.toFixed(2) })
        .where(and(eq(employees.id, employeeId), eq(employees.salonId, salonId)))
        .returning();

      return { notFound: false as const, updated: rows[0] };
    });

    if (txResult.notFound) {
      return NextResponse.json(
        { success: false, error: "Employee not found" },
        { status: 404 }
      );
    }

    const updated = txResult.updated;
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

    const salonId = await getUserSalonId();
    if (!salonId) {
      return NextResponse.json(
        { success: false, error: "Salon not found" },
        { status: 404 }
      );
    }

    // employees pod RLS — dopisany jawny eq(employees.salonId) (defense in depth
    // + naprawa: oryginał listował WSZYSTKICH aktywnych pracowników bez filtra salonu).
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
