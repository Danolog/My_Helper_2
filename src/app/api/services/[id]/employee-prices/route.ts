import { NextResponse } from "next/server";
import { employeeServicePrices, employees, serviceVariants, services } from "@/lib/schema";
import { eq, and } from "drizzle-orm";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";
import { getUserSalonId } from "@/lib/get-user-salon";
import { validateBody, employeePriceSchema } from "@/lib/api-validation";
import { forSalon } from "@/lib/server/repository";

import { logger } from "@/lib/logger";
// eslint-disable-next-line no-restricted-imports -- import type db (DbExecutor); dane przez forSalon
import type { db } from "@/lib/db";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Verify the service belongs to the caller's salon — wykonywane WEWNĄTRZ kontekstu
 * RLS (tx z forSalon). Jawny eq(salonId) zachowany jako filtr aplikacyjny.
 */
async function serviceBelongsToSalon(tx: Tx, serviceId: string, salonId: string): Promise<boolean> {
  const [service] = await tx
    .select({ id: services.id })
    .from(services)
    .where(and(eq(services.id, serviceId), eq(services.salonId, salonId)))
    .limit(1);
  return !!service;
}
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

    // Ownership usługi + odczyt cen (leftJoin) w jednym kontekście RLS.
    // employeeServicePrices bez salonId — scope przez ownership usługi i FK.
    const { ownsService, prices } = await forSalon(salonId).raw(async (tx) => {
      if (!(await serviceBelongsToSalon(tx, serviceId, salonId))) {
        return { ownsService: false, prices: [] };
      }
      const rows = await tx
        .select({
          price: employeeServicePrices,
          employee: employees,
          variant: serviceVariants,
        })
        .from(employeeServicePrices)
        .leftJoin(employees, eq(employeeServicePrices.employeeId, employees.id))
        .leftJoin(serviceVariants, eq(employeeServicePrices.variantId, serviceVariants.id))
        .where(eq(employeeServicePrices.serviceId, serviceId));
      return { ownsService: true, prices: rows };
    });

    if (!ownsService) {
      return NextResponse.json(
        { success: false, error: "Service not found" },
        { status: 404 }
      );
    }

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

    // Cała operacja (ownership usługi + ownership pracownika + upsert ceny) w jednym
    // kontekście RLS, atomowo. employeeServicePrices bez salonId — scope przez
    // ownership usługi/pracownika (jawne eq salonId) i FK.
    const outcome = await forSalon(salonId).raw(async (tx) => {
      if (!(await serviceBelongsToSalon(tx, serviceId, salonId))) {
        return { kind: "no-service" as const };
      }

      // Verify the employee belongs to the caller's salon
      const [ownedEmployee] = await tx
        .select({ id: employees.id })
        .from(employees)
        .where(and(eq(employees.id, employeeId), eq(employees.salonId, salonId)))
        .limit(1);
      if (!ownedEmployee) {
        return { kind: "no-employee" as const };
      }

      // Check if an employee price already exists for this employee + service + variant combo
      const conditions = [
        eq(employeeServicePrices.employeeId, employeeId),
        eq(employeeServicePrices.serviceId, serviceId),
      ];

      if (variantId) {
        conditions.push(eq(employeeServicePrices.variantId, variantId));
      }

      const existing = await tx
        .select()
        .from(employeeServicePrices)
        .where(and(...conditions));

      // Filter for exact variantId match (including null)
      const exactMatch = existing.find(
        (e) => (e.variantId || null) === (variantId || null)
      );

      if (exactMatch) {
        const [updated] = await tx
          .update(employeeServicePrices)
          .set({ customPrice: customPrice.toString() })
          .where(eq(employeeServicePrices.id, exactMatch.id))
          .returning();
        return { kind: "updated" as const, data: updated };
      }

      const [newPrice] = await tx
        .insert(employeeServicePrices)
        .values({
          employeeId,
          serviceId,
          variantId: variantId || null,
          customPrice: customPrice.toString(),
        })
        .returning();
      return { kind: "created" as const, data: newPrice };
    });

    if (outcome.kind === "no-service") {
      return NextResponse.json(
        { success: false, error: "Service not found" },
        { status: 404 }
      );
    }
    if (outcome.kind === "no-employee") {
      return NextResponse.json(
        { success: false, error: "Employee not found" },
        { status: 404 }
      );
    }
    if (outcome.kind === "updated") {
      return NextResponse.json({
        success: true,
        data: outcome.data,
        updated: true,
      });
    }

    return NextResponse.json(
      {
        success: true,
        data: outcome.data,
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

    // Ownership usługi + delete ceny w jednym kontekście RLS, atomowo.
    const { ownsService, deleted } = await forSalon(salonId).raw(async (tx) => {
      if (!(await serviceBelongsToSalon(tx, serviceId, salonId))) {
        return { ownsService: false, deleted: undefined };
      }
      // Only delete a price that belongs to this (salon-owned) service
      const [row] = await tx
        .delete(employeeServicePrices)
        .where(
          and(
            eq(employeeServicePrices.id, priceId),
            eq(employeeServicePrices.serviceId, serviceId)
          )
        )
        .returning();
      return { ownsService: true, deleted: row };
    });

    if (!ownsService) {
      return NextResponse.json(
        { success: false, error: "Service not found" },
        { status: 404 }
      );
    }

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
