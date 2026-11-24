import { NextResponse } from "next/server";
import { eq, asc, sql } from "drizzle-orm";
import { withApiHandler } from "@/lib/api-handler";
import { createProductCategorySchema } from "@/lib/api-validation";
import { logger } from "@/lib/logger";
import { requireSalonStaff } from "@/lib/salon-context";
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
    // P2 (przegląd bezpieczeństwa): salon WYŁĄCZNIE z sesji — wcześniej ?salonId=<cudzy>
    // listował kategorie magazynu dowolnego salonu. Query tylko porównywane
    // (inny => 403), brak => salon sesji. Dostęp jak do /api/products:
    // właściciel albo czasowy grant "products".
    const guard = await requireSalonStaff({
      feature: "products",
      requestedSalonId: searchParams.get("salonId"),
    });
    if (guard.error) return guard.error;
    const salonId = guard.ctx.salonId;

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
    // P1 (przegląd bezpieczeństwa): salon WYŁĄCZNIE z sesji — wcześniej forSalon(body.salonId)
    // pozwalał każdemu zalogowanemu kontu dodać kategorię w cudzym salonie.
    // body.salonId tylko porównywany (inny => 403); właściciel albo grant "products".
    const guard = await requireSalonStaff({
      feature: "products",
      requestedSalonId: body.salonId,
    });
    if (guard.error) return guard.error;
    const salonId = guard.ctx.salonId;

    const { name } = body;

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
