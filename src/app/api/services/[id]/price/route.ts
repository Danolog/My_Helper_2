import { NextResponse } from "next/server";
import { services, employeeServicePrices, serviceVariants, employees } from "@/lib/schema";
import { eq, and } from "drizzle-orm";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";
import { getUserSalonId } from "@/lib/get-user-salon";
import { forSalon } from "@/lib/server/repository";

import { logger } from "@/lib/logger";
// GET /api/services/[id]/price?employeeId=xxx&variantId=yyy
// Returns the effective price for a service based on employee-specific pricing
export async function GET(
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
    const variantId = searchParams.get("variantId");

    // Get the base service (scoped to the caller's salon)
    const service = await forSalon(salonId).findOne(services, serviceId);

    if (!service) {
      return NextResponse.json(
        { success: false, error: "Service not found" },
        { status: 404 }
      );
    }

    let basePrice = parseFloat(service.basePrice);
    let variantModifier = 0;

    // Rozwiazanie ceny (warianty/pracownik/ceny indywidualne) w kontekscie RLS.
    const { standardPrice, effectivePrice, hasCustomPrice, employeeName } =
      await forSalon(salonId).raw(async (tx) => {
        // If variant specified, get its price modifier
        if (variantId) {
          const [variant] = await tx
            .select()
            .from(serviceVariants)
            .where(eq(serviceVariants.id, variantId));

          if (variant) {
            variantModifier = parseFloat(variant.priceModifier || "0");
          }
        }

        const standardPrice = basePrice + variantModifier;
        let effectivePrice = standardPrice;
        let hasCustomPrice = false;
        let employeeName: string | null = null;

        // If employee specified, check for custom pricing
        if (employeeId) {
          // Get employee name
          const [employee] = await tx
            .select()
            .from(employees)
            .where(eq(employees.id, employeeId));

          if (employee) {
            employeeName = `${employee.firstName} ${employee.lastName}`;
          }

          // Check for employee-specific price
          const conditions = [
            eq(employeeServicePrices.employeeId, employeeId),
            eq(employeeServicePrices.serviceId, serviceId),
          ];

          const prices = await tx
            .select()
            .from(employeeServicePrices)
            .where(and(...conditions));

          // Look for exact variant match first, then base service price
          const variantMatch = variantId
            ? prices.find((p) => p.variantId === variantId)
            : null;
          const baseMatch = prices.find((p) => !p.variantId);

          if (variantMatch) {
            effectivePrice = parseFloat(variantMatch.customPrice);
            hasCustomPrice = true;
          } else if (baseMatch) {
          // Use employee base price + variant modifier
          effectivePrice = parseFloat(baseMatch.customPrice) + variantModifier;
          hasCustomPrice = true;
        }
      }

      return { standardPrice, effectivePrice, hasCustomPrice, employeeName };
    });

    return NextResponse.json({
      success: true,
      data: {
        serviceId,
        serviceName: service.name,
        employeeId: employeeId || null,
        employeeName,
        variantId: variantId || null,
        basePrice: basePrice.toFixed(2),
        variantModifier: variantModifier.toFixed(2),
        standardPrice: standardPrice.toFixed(2),
        effectivePrice: effectivePrice.toFixed(2),
        hasCustomPrice,
      },
    });
  } catch (error) {
    logger.error("[Price Resolution API] Error", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to resolve price" },
      { status: 500 }
    );
  }
}
