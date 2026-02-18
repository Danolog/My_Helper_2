import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { products, notifications } from "@/lib/schema";
import { eq, and, sql } from "drizzle-orm";
import { validateBody, createProductSchema } from "@/lib/api-validation";

/**
 * Check if a product has low stock and create a notification if needed.
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

    // Server-side validation with Zod schema
    const validationError = validateBody(createProductSchema, body);
    if (validationError) {
      return NextResponse.json(validationError, { status: 400 });
    }

    const { salonId, name, category, quantity, minQuantity, unit, pricePerUnit } = body;

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

    if (!newProduct) {
      return NextResponse.json(
        { success: false, error: "Failed to create product" },
        { status: 500 }
      );
    }

    console.log(`[Products API] Created product: ${newProduct.name} (${newProduct.id})`);

    // Check for low stock and send notification if needed
    let lowStockAlert = null;
    try {
      lowStockAlert = await checkAndNotifyLowStock(newProduct);
    } catch (alertError) {
      console.error("[Products API] Low stock check failed (non-blocking):", alertError);
    }

    return NextResponse.json({
      success: true,
      data: newProduct,
      lowStockAlert,
    }, { status: 201 });
  } catch (error) {
    console.error("[Products API] Database error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to create product" },
      { status: 500 }
    );
  }
}
