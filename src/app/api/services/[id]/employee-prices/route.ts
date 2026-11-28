import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { withApiHandler } from "@/lib/api-handler";
import { parseBody, employeePriceSchema } from "@/lib/api-validation";
import { getSalonContext } from "@/lib/salon-context";
import { employeeServicePrices, employees, serviceVariants, services } from "@/lib/schema";
import { forSalon } from "@/lib/server/repository";
import { isValidUuid } from "@/lib/validations";

/** Verify the service belongs to the caller's salon. */
async function serviceBelongsToSalon(serviceId: string, salonId: string): Promise<boolean> {
  const service = await forSalon(salonId).findOne(services, serviceId);
  return !!service;
}

const OWNER_ONLY_CODE = "EMPLOYEE_PRICE_OWNER_ONLY";
const OWNER_ONLY_MESSAGE = "Ceny indywidualne pracowników może zmieniać tylko właściciel salonu.";
const OWNER_ONLY_READ_MESSAGE =
  "Ceny indywidualne pracowników może przeglądać tylko właściciel salonu.";

const INVALID_JSON_CODE = "INVALID_JSON";
const INVALID_JSON_MESSAGE =
  "Nie udało się odczytać danych formularza. Odśwież stronę i spróbuj ponownie.";

const INVALID_VARIANT_ID_CODE = "INVALID_VARIANT_ID";
const INVALID_VARIANT_ID_MESSAGE = "Nieprawidłowy identyfikator wariantu usługi.";
const VARIANT_NOT_FOUND_CODE = "SERVICE_VARIANT_NOT_FOUND";
const VARIANT_NOT_FOUND_MESSAGE = "Nie znaleziono wariantu tej usługi.";
const INVALID_PRICE_ID_CODE = "INVALID_PRICE_ID";
const INVALID_PRICE_ID_MESSAGE = "Nieprawidłowy identyfikator ceny.";

/**
 * Salon z sesji dla odczytu, zapisu i usunięcia ceny indywidualnej. Cena
 * pracownika zmienia jego prowizję, a wynagrodzenie ustala właściciel, więc
 * pracownik i recepcja dostają 403 z kodem — przed walidacją body i przed
 * odczytem danych usługi, pracownika i ceny. Grant czasowy nie otwiera dostępu.
 */
async function requireOwnerSalonId(
  message: string
): Promise<
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
        { success: false, code: OWNER_ONLY_CODE, error: message },
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
    const owner = await requireOwnerSalonId(OWNER_ONLY_READ_MESSAGE);
    if (owner.response) return owner.response;
    const salonId = owner.salonId;

    const serviceId = params.id!; // segment [id] zawsze obecny (noUncheckedIndexedAccess)

    if (!(await serviceBelongsToSalon(serviceId, salonId))) {
      return NextResponse.json(
        { success: false, error: "Service not found" },
        { status: 404 }
      );
    }

    // employeeServicePrices nie ma salonId — scope przez zweryfikowany wyżej serwis.
    // Pracownik tylko z polami karty cen (bez telefonu, e-maila, konta i prowizji).
    const prices = await forSalon(salonId).raw((tx) =>
      tx
        .select({
          price: employeeServicePrices,
          employee: {
            id: employees.id,
            firstName: employees.firstName,
            lastName: employees.lastName,
            color: employees.color,
            role: employees.role,
          },
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
    const owner = await requireOwnerSalonId(OWNER_ONLY_MESSAGE);
    if (owner.response) return owner.response;
    const salonId = owner.salonId;

    const serviceId = params.id!; // segment [id] zawsze obecny (noUncheckedIndexedAccess)
    // Walidacja celowo w handlerze (po sprawdzeniu salonu i roli) — jak dotąd.
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, code: INVALID_JSON_CODE, error: INVALID_JSON_MESSAGE },
        { status: 400 }
      );
    }
    const parsed = parseBody(employeePriceSchema, body);
    if (!parsed.ok) {
      return NextResponse.json(parsed.error, { status: 400 });
    }
    // Sparsowane dane, nie surowe body: cena zapisuje się jako liczba ze schematu.
    const { employeeId, variantId, customPrice } = parsed.data;

    if (variantId && !isValidUuid(variantId)) {
      return NextResponse.json(
        { success: false, code: INVALID_VARIANT_ID_CODE, error: INVALID_VARIANT_ID_MESSAGE },
        { status: 400 }
      );
    }

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

    // Wariant musi należeć do tej usługi (zweryfikowanej wyżej w salonie z sesji).
    // serviceVariants nie ma salonId — scope przez serviceId. Wariant innej usługi
    // albo innego salonu daje tę samą odpowiedź co wariant nieistniejący.
    if (variantId) {
      const [variant] = await forSalon(salonId).raw((tx) =>
        tx
          .select({ id: serviceVariants.id })
          .from(serviceVariants)
          .where(and(eq(serviceVariants.id, variantId), eq(serviceVariants.serviceId, serviceId)))
          .limit(1)
      );
      if (!variant) {
        return NextResponse.json(
          { success: false, code: VARIANT_NOT_FOUND_CODE, error: VARIANT_NOT_FOUND_MESSAGE },
          { status: 404 }
        );
      }
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
    const owner = await requireOwnerSalonId(OWNER_ONLY_MESSAGE);
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

    if (!isValidUuid(priceId)) {
      return NextResponse.json(
        { success: false, code: INVALID_PRICE_ID_CODE, error: INVALID_PRICE_ID_MESSAGE },
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
