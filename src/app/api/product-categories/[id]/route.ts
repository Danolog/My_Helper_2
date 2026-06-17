import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { productCategories, products } from "@/lib/schema";
import { eq, and, sql } from "drizzle-orm";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";
import { getUserSalonId } from "@/lib/get-user-salon";
import { validateBody, updateProductCategorySchema } from "@/lib/api-validation";

import { logger } from "@/lib/logger";
// GET /api/product-categories/[id] - Get a single category with product count
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

    const result = await db
      .select({
        id: productCategories.id,
        salonId: productCategories.salonId,
        name: productCategories.name,
        sortOrder: productCategories.sortOrder,
        createdAt: productCategories.createdAt,
        productCount: sql<number>`count(${products.id})::int`,
      })
      .from(productCategories)
      .leftJoin(products, eq(products.category, productCategories.name))
      .where(and(eq(productCategories.id, id), eq(productCategories.salonId, salonId)))
      .groupBy(productCategories.id)
      .limit(1);

    if (result.length === 0) {
      return NextResponse.json(
        { success: false, error: "Category not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: result[0],
    });
  } catch (error) {
    logger.error("[Product Categories API] Database error", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to fetch category" },
      { status: 500 }
    );
  }
}

// PUT /api/product-categories/[id] - Update (rename) a category
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
    const validationError = validateBody(updateProductCategorySchema, body);
    if (validationError) {
      return NextResponse.json(validationError, { status: 400 });
    }
    const { name } = body;

    // Get the existing category in the caller's salon
    const [existing] = await db
      .select()
      .from(productCategories)
      .where(and(eq(productCategories.id, id), eq(productCategories.salonId, salonId)))
      .limit(1);

    if (!existing) {
      return NextResponse.json(
        { success: false, error: "Category not found" },
        { status: 404 }
      );
    }

    const oldName = existing.name;
    const newName = name.trim();

    // Check for duplicate name within same salon (excluding current category)
    if (oldName.toLowerCase() !== newName.toLowerCase()) {
      const duplicate = await db
        .select({ id: productCategories.id })
        .from(productCategories)
        .where(
          sql`${productCategories.salonId} = ${existing.salonId} AND LOWER(${productCategories.name}) = LOWER(${newName}) AND ${productCategories.id} != ${id}`
        )
        .limit(1);

      if (duplicate.length > 0) {
        return NextResponse.json(
          { success: false, error: "Kategoria o tej nazwie juz istnieje" },
          { status: 409 }
        );
      }
    }

    // Update category name (scoped to caller's salon)
    const [updated] = await db
      .update(productCategories)
      .set({ name: newName })
      .where(and(eq(productCategories.id, id), eq(productCategories.salonId, salonId)))
      .returning();

    // Also update all products in this salon that reference the old name
    if (oldName !== newName) {
      await db
        .update(products)
        .set({ category: newName })
        .where(and(eq(products.category, oldName), eq(products.salonId, salonId)));

      logger.info(`[Product Categories API] Renamed "${oldName}" -> "${newName}", updated associated products`);
    }

    return NextResponse.json({
      success: true,
      data: updated,
    });
  } catch (error) {
    logger.error("[Product Categories API] Database error", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to update category" },
      { status: 500 }
    );
  }
}

// DELETE /api/product-categories/[id] - Delete an empty category
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

    // Get the category in the caller's salon
    const [category] = await db
      .select()
      .from(productCategories)
      .where(and(eq(productCategories.id, id), eq(productCategories.salonId, salonId)))
      .limit(1);

    if (!category) {
      return NextResponse.json(
        { success: false, error: "Category not found" },
        { status: 404 }
      );
    }

    // Check if category has products (within this salon)
    const productCount = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(products)
      .where(and(eq(products.category, category.name), eq(products.salonId, salonId)));

    if ((productCount[0]?.count || 0) > 0) {
      return NextResponse.json(
        {
          success: false,
          error: `Nie mozna usunac kategorii "${category.name}" - zawiera ${productCount[0]!.count} produktow. Najpierw przenies lub usun produkty.`,
        },
        { status: 409 }
      );
    }

    // Delete the category (scoped to caller's salon)
    const [deleted] = await db
      .delete(productCategories)
      .where(and(eq(productCategories.id, id), eq(productCategories.salonId, salonId)))
      .returning();

    logger.info(`[Product Categories API] Deleted category: ${deleted!.name} (${deleted!.id})`);

    return NextResponse.json({
      success: true,
      data: deleted,
      message: "Category deleted successfully",
    });
  } catch (error) {
    logger.error("[Product Categories API] Database error", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to delete category" },
      { status: 500 }
    );
  }
}
