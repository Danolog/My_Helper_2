import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { products } from "@/lib/schema";
import { eq } from "drizzle-orm";

// GET /api/products/[id] - Get a single product
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const [product] = await db
      .select()
      .from(products)
      .where(eq(products.id, id))
      .limit(1);

    if (!product) {
      return NextResponse.json(
        { success: false, error: "Product not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: product,
    });
  } catch (error) {
    console.error("[Products API] Database error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch product" },
      { status: 500 }
    );
  }
}

// PUT /api/products/[id] - Update a product
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { name, category, quantity, minQuantity, unit, pricePerUnit } = body;

    const updateData: Record<string, unknown> = {};
    if (name !== undefined) updateData.name = name;
    if (category !== undefined) updateData.category = category;
    if (quantity !== undefined) updateData.quantity = quantity.toString();
    if (minQuantity !== undefined) updateData.minQuantity = minQuantity?.toString() || null;
    if (unit !== undefined) updateData.unit = unit;
    if (pricePerUnit !== undefined) updateData.pricePerUnit = pricePerUnit?.toString() || null;

    const [updatedProduct] = await db
      .update(products)
      .set(updateData)
      .where(eq(products.id, id))
      .returning();

    if (!updatedProduct) {
      return NextResponse.json(
        { success: false, error: "Product not found" },
        { status: 404 }
      );
    }

    console.log(`[Products API] Updated product: ${updatedProduct.name} (${updatedProduct.id})`);

    return NextResponse.json({
      success: true,
      data: updatedProduct,
    });
  } catch (error) {
    console.error("[Products API] Database error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to update product" },
      { status: 500 }
    );
  }
}

// DELETE /api/products/[id] - Delete a product
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const [deletedProduct] = await db
      .delete(products)
      .where(eq(products.id, id))
      .returning();

    if (!deletedProduct) {
      return NextResponse.json(
        { success: false, error: "Product not found" },
        { status: 404 }
      );
    }

    console.log(`[Products API] Deleted product: ${deletedProduct.name} (${deletedProduct.id})`);

    return NextResponse.json({
      success: true,
      data: deletedProduct,
      message: "Product deleted successfully",
    });
  } catch (error) {
    console.error("[Products API] Database error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to delete product" },
      { status: 500 }
    );
  }
}
