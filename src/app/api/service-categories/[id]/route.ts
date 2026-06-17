import { NextResponse } from "next/server";
import { serviceCategories, services } from "@/lib/schema";
import { eq, and, count } from "drizzle-orm";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";
import { getUserSalonId } from "@/lib/get-user-salon";
import { validateBody, updateServiceCategorySchema } from "@/lib/api-validation";
import { forSalon } from "@/lib/server/repository";

import { logger } from "@/lib/logger";
// GET /api/service-categories/[id] - Get a single category
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

    const { id } = await params;

    const category = await forSalon(salonId).findOne(serviceCategories, id);

    if (!category) {
      return NextResponse.json(
        { success: false, error: "Category not found" },
        { status: 404 }
      );
    }

    // Get count of services in this category (services salon-scoped — RLS w kontekscie)
    const [serviceCount] = await forSalon(salonId).raw((tx) =>
      tx
        .select({ count: count() })
        .from(services)
        .where(eq(services.categoryId, id))
    );

    return NextResponse.json({
      success: true,
      data: {
        ...category,
        serviceCount: serviceCount?.count ?? 0,
      },
    });
  } catch (error) {
    logger.error("[ServiceCategories API] Database error", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to fetch category" },
      { status: 500 }
    );
  }
}

// PUT /api/service-categories/[id] - Update a category
export async function PUT(
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

    const { id } = await params;
    const body = await request.json();
    const validationError = validateBody(updateServiceCategorySchema, body);
    if (validationError) {
      return NextResponse.json(validationError, { status: 400 });
    }
    const { name, sortOrder } = body;

    // Check category exists in the caller's salon
    const existing = await forSalon(salonId).findOne(serviceCategories, id);

    if (!existing) {
      return NextResponse.json(
        { success: false, error: "Category not found" },
        { status: 404 }
      );
    }

    // Check for duplicate name in same salon
    const [duplicate] = await forSalon(salonId).raw((tx) =>
      tx
        .select()
        .from(serviceCategories)
        .where(
          and(
            eq(serviceCategories.salonId, existing.salonId),
            eq(serviceCategories.name, name.trim())
          )
        )
    );

    if (duplicate && duplicate.id !== id) {
      return NextResponse.json(
        { success: false, error: "A category with this name already exists" },
        { status: 409 }
      );
    }

    const updateData: Record<string, unknown> = { name: name.trim() };
    if (sortOrder !== undefined) {
      updateData.sortOrder = sortOrder;
    }

    const updated = await forSalon(salonId).updateOwned(serviceCategories, id, updateData);

    logger.info(`[ServiceCategories API] Updated category: ${updated?.name}`);

    return NextResponse.json({
      success: true,
      data: updated,
    });
  } catch (error) {
    logger.error("[ServiceCategories API] Database error", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to update category" },
      { status: 500 }
    );
  }
}

// DELETE /api/service-categories/[id] - Delete a category
export async function DELETE(
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

    const { id } = await params;

    // Check category exists in the caller's salon
    const existing = await forSalon(salonId).findOne(serviceCategories, id);

    if (!existing) {
      return NextResponse.json(
        { success: false, error: "Category not found" },
        { status: 404 }
      );
    }

    // Check if category has services assigned (services salon-scoped — RLS w kontekscie)
    const [serviceCount] = await forSalon(salonId).raw((tx) =>
      tx
        .select({ count: count() })
        .from(services)
        .where(eq(services.categoryId, id))
    );

    if (serviceCount && serviceCount.count > 0) {
      return NextResponse.json(
        {
          success: false,
          error: `Nie mozna usunac kategorii - ${serviceCount.count} uslug jest do niej przypisanych. Najpierw przenies uslugi do innej kategorii.`,
          serviceCount: serviceCount.count,
        },
        { status: 409 }
      );
    }

    // Delete the empty category (scoped to caller's salon)
    await forSalon(salonId).deleteOwned(serviceCategories, id);

    logger.info(`[ServiceCategories API] Deleted category: ${existing.name}`);

    return NextResponse.json({
      success: true,
      message: `Category "${existing.name}" deleted successfully`,
    });
  } catch (error) {
    logger.error("[ServiceCategories API] Database error", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to delete category" },
      { status: 500 }
    );
  }
}
