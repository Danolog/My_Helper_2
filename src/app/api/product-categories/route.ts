import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { productCategories, products } from "@/lib/schema";
import { eq, asc, sql } from "drizzle-orm";

// GET /api/product-categories - List product categories with product counts
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const salonId = searchParams.get("salonId");

    if (!salonId) {
      return NextResponse.json(
        { success: false, error: "salonId is required" },
        { status: 400 }
      );
    }

    // Get categories with product counts using a left join
    const categories = await db
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
      .orderBy(asc(productCategories.sortOrder), asc(productCategories.name));

    return NextResponse.json({
      success: true,
      data: categories,
      count: categories.length,
    });
  } catch (error) {
    console.error("[Product Categories API] Database error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch product categories" },
      { status: 500 }
    );
  }
}

// POST /api/product-categories - Create a new product category
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { salonId, name } = body;

    if (!salonId || !name?.trim()) {
      return NextResponse.json(
        { success: false, error: "salonId and name are required" },
        { status: 400 }
      );
    }

    // Check for duplicate name within salon
    const existing = await db
      .select({ id: productCategories.id })
      .from(productCategories)
      .where(
        sql`${productCategories.salonId} = ${salonId} AND LOWER(${productCategories.name}) = LOWER(${name.trim()})`
      )
      .limit(1);

    if (existing.length > 0) {
      return NextResponse.json(
        { success: false, error: "Kategoria o tej nazwie juz istnieje" },
        { status: 409 }
      );
    }

    // Get max sort order for this salon
    const maxOrder = await db
      .select({ max: sql<number>`COALESCE(MAX(${productCategories.sortOrder}), 0)` })
      .from(productCategories)
      .where(eq(productCategories.salonId, salonId));

    const nextOrder = (maxOrder[0]?.max || 0) + 1;

    const [newCategory] = await db
      .insert(productCategories)
      .values({
        salonId,
        name: name.trim(),
        sortOrder: nextOrder,
      })
      .returning();

    console.log(`[Product Categories API] Created category: ${newCategory!.name} (${newCategory!.id})`);

    return NextResponse.json({
      success: true,
      data: newCategory,
    }, { status: 201 });
  } catch (error) {
    console.error("[Product Categories API] Database error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to create product category" },
      { status: 500 }
    );
  }
}
