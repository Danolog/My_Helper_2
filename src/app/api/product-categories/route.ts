import { NextResponse } from "next/server";
import { eq, asc, sql } from "drizzle-orm";
import { withApiHandler } from "@/lib/api-handler";
import { createProductCategorySchema } from "@/lib/api-validation";
import { logger } from "@/lib/logger";
import { productCategories, products } from "@/lib/schema";
import { forSalon } from "@/lib/server/repository";
import type { z } from "zod";
// GET /api/product-categories - List product categories with product counts
export const GET = withApiHandler(
  {
    auth: "user",
    logLabel: "[Product Categories API] GET",
    errorMessage: "Failed to fetch product categories",
  },
  async ({ request }) => {
    const { searchParams } = new URL(request.url);
    const salonId = searchParams.get("salonId");

    if (!salonId) {
      return NextResponse.json(
        { success: false, error: "salonId is required" },
        { status: 400 }
      );
    }

    // Get categories with product counts using a left join
    const categories = await forSalon(salonId).raw((tx) =>
      tx
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
      .where(eq(productCategories.salonId, salonId))
      .groupBy(productCategories.id)
      .orderBy(asc(productCategories.sortOrder), asc(productCategories.name))
    );

    return NextResponse.json({
      success: true,
      data: categories,
      count: categories.length,
    });
  }
);

// POST /api/product-categories - Create a new product category
export const POST = withApiHandler(
  {
    auth: "user",
    schema: createProductCategorySchema as z.ZodType<{
      salonId: string;
      name: string;
    }>,
    logLabel: "[Product Categories API] POST",
    errorMessage: "Failed to create product category",
  },
  async ({ body }) => {
    const { salonId, name } = body;

    // Check for duplicate name within salon
    const existing = await forSalon(salonId).raw((tx) =>
      tx
      .select({ id: productCategories.id })
      .from(productCategories)
      .where(
        sql`${productCategories.salonId} = ${salonId} AND LOWER(${productCategories.name}) = LOWER(${name.trim()})`
      )
      .limit(1)
    );

    if (existing.length > 0) {
      return NextResponse.json(
        { success: false, error: "Kategoria o tej nazwie juz istnieje" },
        { status: 409 }
      );
    }

    // Get max sort order for this salon
    const maxOrder = await forSalon(salonId).raw((tx) =>
      tx
      .select({ max: sql<number>`COALESCE(MAX(${productCategories.sortOrder}), 0)` })
      .from(productCategories)
      .where(eq(productCategories.salonId, salonId))
    );

    const nextOrder = (maxOrder[0]?.max || 0) + 1;

    const [newCategory] = await forSalon(salonId).raw((tx) =>
      tx
      .insert(productCategories)
      .values({
        salonId,
        name: name.trim(),
        sortOrder: nextOrder,
      })
      .returning()
    );

    logger.info(`[Product Categories API] Created category: ${newCategory!.name} (${newCategory!.id})`);

    return NextResponse.json({
      success: true,
      data: newCategory,
    }, { status: 201 });
  }
);
