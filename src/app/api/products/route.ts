import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { products } from "@/lib/schema";
import { eq } from "drizzle-orm";

// GET /api/products - List products with optional salonId filter
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const salonId = searchParams.get("salonId");

    let query = db.select().from(products);

    if (salonId) {
      query = query.where(eq(products.salonId, salonId)) as typeof query;
    }

    const result = await query;

    return NextResponse.json({
      success: true,
      data: result,
      count: result.length,
    });
  } catch (error) {
    console.error("[Products API] Database error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch products" },
      { status: 500 }
    );
  }
}

// POST /api/products - Create a new product
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { salonId, name, category, quantity, minQuantity, unit, pricePerUnit } = body;

    if (!salonId || !name) {
      return NextResponse.json(
        { success: false, error: "salonId and name are required" },
        { status: 400 }
      );
    }

    const [newProduct] = await db
      .insert(products)
      .values({
        salonId,
        name,
        category: category || null,
        quantity: quantity?.toString() || "0",
        minQuantity: minQuantity?.toString() || null,
        unit: unit || null,
        pricePerUnit: pricePerUnit?.toString() || null,
      })
      .returning();

    console.log(`[Products API] Created product: ${newProduct?.name} (${newProduct?.id})`);

    return NextResponse.json({
      success: true,
      data: newProduct,
    }, { status: 201 });
  } catch (error) {
    console.error("[Products API] Database error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to create product" },
      { status: 500 }
    );
  }
}
