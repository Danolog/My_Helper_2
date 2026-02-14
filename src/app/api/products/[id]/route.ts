import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { products, notifications } from "@/lib/schema";
import { eq, and, sql } from "drizzle-orm";

/**
 * Check if a product has low stock and create a notification if needed.
 * Prevents duplicate notifications within 24 hours.
 */
async function checkAndNotifyLowStock(product: {
  id: string;
  salonId: string;
  name: string;
  quantity: string | null;
  minQuantity: string | null;
  unit: string | null;
}) {
  const qty = parseFloat(product.quantity || "0");
  const minQty = product.minQuantity ? parseFloat(product.minQuantity) : null;

  if (minQty === null) return null;

  if (qty <= minQty) {
    // Check for existing notification in the last 24h to avoid duplicates
    const existingRecent = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.salonId, product.salonId),
          sql`${notifications.message} LIKE ${"%" + product.id + "%"}`,
          sql`${notifications.createdAt} > NOW() - INTERVAL '24 hours'`,
          sql`${notifications.type} = 'system'`
        )
      )
      .limit(1);

    if (existingRecent.length > 0) {
      return { notificationSent: false, reason: "duplicate" };
    }

    const unitLabel = product.unit || "szt.";
    const message = `Niski stan magazynowy: "${product.name}" - pozostalo ${qty} ${unitLabel} (minimum: ${minQty} ${unitLabel}). Uzupelnij zapasy! [product:${product.id}]`;

    const [notification] = await db
      .insert(notifications)
      .values({
        salonId: product.salonId,
        type: "system",
        message,
        status: "sent",
        sentAt: new Date(),
      })
      .returning();

    console.log(
      `[Low Stock Alert] Notification sent for "${product.name}" (${product.id}) - qty: ${qty}, min: ${minQty}`
    );

    return { notificationSent: true, notification };
  }

  return { notificationSent: false, reason: "stock_ok" };
}

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

    // Check for low stock and send notification if needed
    let lowStockAlert = null;
    try {
      lowStockAlert = await checkAndNotifyLowStock(updatedProduct);
    } catch (alertError) {
      console.error("[Products API] Low stock check failed (non-blocking):", alertError);
    }

    return NextResponse.json({
      success: true,
      data: updatedProduct,
      lowStockAlert,
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
