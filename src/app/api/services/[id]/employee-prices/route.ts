import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { employeeServicePrices, employees, serviceVariants } from "@/lib/schema";
import { eq, and } from "drizzle-orm";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";

import { logger } from "@/lib/logger";
// GET /api/services/[id]/employee-prices - List all employee-specific prices for a service
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

    const { id: serviceId } = await params;

    const prices = await db
      .select({
        price: employeeServicePrices,
        employee: employees,
        variant: serviceVariants,
      })
      .from(employeeServicePrices)
      .leftJoin(employees, eq(employeeServicePrices.employeeId, employees.id))
      .leftJoin(serviceVariants, eq(employeeServicePrices.variantId, serviceVariants.id))
      .where(eq(employeeServicePrices.serviceId, serviceId));

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

    const { id: serviceId } = await params;
    const body = await request.json();
    const { employeeId, variantId, customPrice } = body;

    if (!employeeId || customPrice === undefined || customPrice === null) {
      return NextResponse.json(
        { success: false, error: "employeeId and customPrice are required" },
        { status: 400 }
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

    const existing = await db
      .select()
      .from(employeeServicePrices)
      .where(and(...conditions));

    // Filter for exact variantId match (including null)
    const exactMatch = existing.find(
      (e) => (e.variantId || null) === (variantId || null)
    );

    if (exactMatch) {
      // Update existing price
      const [updated] = await db
        .update(employeeServicePrices)
        .set({ customPrice: customPrice.toString() })
        .where(eq(employeeServicePrices.id, exactMatch.id))
        .returning();

      return NextResponse.json({
        success: true,
        data: updated,
        updated: true,
      });
    }

    // Create new employee price
    const [newPrice] = await db
      .insert(employeeServicePrices)
      .values({
        employeeId,
        serviceId,
        variantId: variantId || null,
        customPrice: customPrice.toString(),
      })
      .returning();

    return NextResponse.json(
      {
        success: true,
        data: newPrice,
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

    await params; // consume params
    const { searchParams } = new URL(request.url);
    const priceId = searchParams.get("priceId");

    if (!priceId) {
      return NextResponse.json(
        { success: false, error: "priceId is required" },
        { status: 400 }
      );
    }

    const [deleted] = await db
      .delete(employeeServicePrices)
      .where(eq(employeeServicePrices.id, priceId))
      .returning();

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
