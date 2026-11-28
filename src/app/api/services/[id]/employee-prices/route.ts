import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { withApiHandler } from "@/lib/api-handler";
import { validateBody, employeePriceSchema } from "@/lib/api-validation";
import { getUserSalonId } from "@/lib/get-user-salon";
import { getSalonContext } from "@/lib/salon-context";
import { employeeServicePrices, employees, serviceVariants, services } from "@/lib/schema";
import { forSalon } from "@/lib/server/repository";

/** Verify the service belongs to the caller's salon. */
async function serviceBelongsToSalon(serviceId: string, salonId: string): Promise<boolean> {
  const service = await forSalon(salonId).findOne(services, serviceId);
  return !!service;
}

const OWNER_ONLY_CODE = "EMPLOYEE_PRICE_OWNER_ONLY";
const OWNER_ONLY_MESSAGE = "Ceny indywidualne pracowników może zmieniać tylko właściciel salonu.";

/**
 * Salon z sesji dla zapisu i usunięcia ceny indywidualnej. Cena pracownika
 * zmienia jego prowizję, a wynagrodzenie ustala właściciel, więc pracownik
 * i recepcja dostają 403 z kodem — przed walidacją body i odczytem bazy.
 */
async function requireOwnerSalonId(): Promise<
  { salonId: string; response?: undefined } | { salonId?: undefined; response: NextResponse }
> {
  const ctx = await getSalonContext();
  if (!ctx) {
    return {
      response: NextResponse.json({ success: false, error: "Salon not found" }, { status: 404 }),
    };
  }
  if (ctx.role !== "owner") {
    return {
      response: NextResponse.json(
        { success: false, code: OWNER_ONLY_CODE, error: OWNER_ONLY_MESSAGE },
        { status: 403 }
      ),
    };
  }
  return { salonId: ctx.salonId };
}

// GET /api/services/[id]/employee-prices - List all employee-specific prices for a service
export const GET = withApiHandler(
  {
    auth: "user",
    logLabel: "[Employee Prices API] GET",
    errorMessage: "Failed to fetch employee prices",
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
  }
);

// POST /api/services/[id]/employee-prices - Create or update employee-specific price
export const POST = withApiHandler(
  {
    auth: "user",
    logLabel: "[Employee Prices API] POST",
    errorMessage: "Failed to save employee price",
  },
  async ({ request, params }) => {
    const owner = await requireOwnerSalonId();
    if (owner.response) return owner.response;
    const salonId = owner.salonId;

    const serviceId = params.id!; // segment [id] zawsze obecny (noUncheckedIndexedAccess)
    // Walidacja celowo w handlerze (po sprawdzeniu salonu i roli) — jak dotąd.
    const body = await request.json();
    const validationError = validateBody(employeePriceSchema, body);
    if (validationError) {
      return NextResponse.json(validationError, { status: 400 });
    }
    // Sparsowane dane, nie surowe body: cena zapisuje się jako liczba ze schematu.
    const { employeeId, variantId, customPrice } = employeePriceSchema.parse(body);

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
  }
);

// DELETE /api/services/[id]/employee-prices - Delete an employee-specific price
export const DELETE = withApiHandler(
  {
    auth: "user",
    logLabel: "[Employee Prices API] DELETE",
    errorMessage: "Failed to delete employee price",
  },
  async ({ request, params }) => {
    const owner = await requireOwnerSalonId();
    if (owner.response) return owner.response;
    const salonId = owner.salonId;

    const serviceId = params.id!; // segment [id] zawsze obecny (noUncheckedIndexedAccess)
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
  }
);
