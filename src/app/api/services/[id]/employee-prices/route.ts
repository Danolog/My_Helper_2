import { NextResponse } from "next/server";
import { employeeServicePrices, employees, serviceVariants, services } from "@/lib/schema";
import { eq, and } from "drizzle-orm";
import { validateBody, employeePriceSchema } from "@/lib/api-validation";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";
import { getUserSalonId } from "@/lib/get-user-salon";
import { forSalon } from "@/lib/server/repository";

/** Verify the service belongs to the caller's salon. */
async function serviceBelongsToSalon(serviceId: string, salonId: string): Promise<boolean> {
  const service = await forSalon(salonId).findOne(services, serviceId);
  return !!service;
}

import { logger } from "@/lib/logger";
// GET /api/services/[id]/employee-prices - List all employee-specific prices for a service
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

    // employeeServicePrices nie ma salonId — scope przez zweryfikowany wyżej serwis.
    const prices = await forSalon(salonId).raw((tx) =>
      tx
        .select({
          price: employeeServicePrices,
          employee: employees,
          variant: serviceVariants,
        })
        .from(employeeServicePrices)
        .leftJoin(employees, eq(employeeServicePrices.employeeId, employees.id))
        .leftJoin(serviceVariants, eq(employeeServicePrices.variantId, serviceVariants.id))
        .where(eq(employeeServicePrices.serviceId, serviceId))
    );

    const formatted = prices.map((row) => ({
      ...row.price,
      employee: row.employee,
      variant: row.variant,
    }));

    return NextResponse.json({
      success: true,
      data: formatted,
      count: formatted.length,
    });
  } catch (error) {
    logger.error("[Employee Prices API] Error fetching prices", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to fetch employee prices" },
      { status: 500 }
    );
  }
}

// POST /api/services/[id]/employee-prices - Create or update employee-specific price
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
    const validationError = validateBody(employeePriceSchema, body);
    if (validationError) {
      return NextResponse.json(validationError, { status: 400 });
    }
    const { employeeId, variantId, customPrice } = body;

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

    // Check if an employee price already exists for this employee + service + variant combo
    const conditions = [
      eq(employeeServicePrices.employeeId, employeeId),
      eq(employeeServicePrices.serviceId, serviceId),
    ];

    if (variantId) {
      conditions.push(eq(employeeServicePrices.variantId, variantId));
    }

    // Sprawdzenie istniejącej ceny + update/insert atomowo w transakcji RLS.
    // employeeServicePrices nie ma salonId — scope przez zweryfikowany wyżej
    // serwis i pracownika salonu.
    const { row, wasUpdated } = await forSalon(salonId).raw(async (tx) => {
      const existing = await tx
        .select()
        .from(employeeServicePrices)
        .where(and(...conditions));

      // Filter for exact variantId match (including null)
      const exactMatch = existing.find(
        (e) => (e.variantId || null) === (variantId || null)
      );

      if (exactMatch) {
        // Update existing price
        const [updated] = await tx
          .update(employeeServicePrices)
          .set({ customPrice: customPrice.toString() })
          .where(eq(employeeServicePrices.id, exactMatch.id))
          .returning();
        return { row: updated, wasUpdated: true };
      }

      // Create new employee price
      const [newPrice] = await tx
        .insert(employeeServicePrices)
        .values({
          employeeId,
          serviceId,
          variantId: variantId || null,
          customPrice: customPrice.toString(),
        })
        .returning();
      return { row: newPrice, wasUpdated: false };
    });

    if (wasUpdated) {
      return NextResponse.json({
        success: true,
        data: row,
        updated: true,
      });
    }

    return NextResponse.json(
      {
        success: true,
        data: row,
        updated: false,
      },
      { status: 201 }
    );
  } catch (error) {
    logger.error("[Employee Prices API] Error saving price", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to save employee price" },
      { status: 500 }
    );
  }
}

// DELETE /api/services/[id]/employee-prices - Delete an employee-specific price
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
    const priceId = searchParams.get("priceId");

    if (!priceId) {
      return NextResponse.json(
        { success: false, error: "priceId is required" },
        { status: 400 }
      );
    }

    if (!(await serviceBelongsToSalon(serviceId, salonId))) {
      return NextResponse.json(
        { success: false, error: "Service not found" },
        { status: 404 }
      );
    }

    // Only delete a price that belongs to this (salon-owned) service
    const [deleted] = await forSalon(salonId).raw((tx) =>
      tx
        .delete(employeeServicePrices)
        .where(
          and(
            eq(employeeServicePrices.id, priceId),
            eq(employeeServicePrices.serviceId, serviceId)
          )
        )
        .returning()
    );

    if (!deleted) {
      return NextResponse.json(
        { success: false, error: "Employee price not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: deleted,
    });
  } catch (error) {
    logger.error("[Employee Prices API] Error deleting price", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to delete employee price" },
      { status: 500 }
    );
  }
}
