import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { products, notifications } from "@/lib/schema";
import { eq, and, isNotNull, sql } from "drizzle-orm";
import { requireCronSecret } from "@/lib/auth-middleware";

/**
 * GET /api/notifications/low-stock
 *
 * Checks for products with low stock (quantity <= minQuantity)
 * and creates notifications for newly detected low-stock products.
 *
 * Query params:
 *   - salonId: required - the salon to check
 *
 * Returns:
 *   - lowStockProducts: list of products with low stock
 *   - notificationsSent: number of new notifications created
 */
export async function GET(request: Request) {
  try {
    const cronError = await requireCronSecret(request);
    if (cronError) return cronError;
    const { searchParams } = new URL(request.url);
    const salonId = searchParams.get("salonId");

    if (!salonId) {
      return NextResponse.json(
        { success: false, error: "salonId is required" },
        { status: 400 }
      );
    }

    // Find all products where quantity <= minQuantity
    const lowStockProducts = await db
      .select()
      .from(products)
      .where(
        and(
          eq(products.salonId, salonId),
          isNotNull(products.minQuantity),
          sql`CAST(${products.quantity} AS numeric) <= CAST(${products.minQuantity} AS numeric)`
        )
      );

    return NextResponse.json({
      success: true,
      data: {
        lowStockProducts,
        count: lowStockProducts.length,
      },
    });
  } catch (error) {
    console.error("[Low Stock API] Error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to check low stock" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/notifications/low-stock
 *
 * Creates a low-stock notification for a specific product.
 * Checks if a recent notification already exists to avoid duplicates.
 *
 * Body:
 *   - salonId: required
 *   - productId: required
 *   - productName: required
 *   - quantity: required - current quantity
 *   - minQuantity: required - minimum threshold
 *   - unit: optional - unit of measurement
 */
export async function POST(request: Request) {
  try {
    const cronError = await requireCronSecret(request);
    if (cronError) return cronError;
    const body = await request.json();
    const { salonId, productId, productName, quantity, minQuantity, unit } = body;

    if (!salonId || !productId || !productName) {
      return NextResponse.json(
        { success: false, error: "salonId, productId, and productName are required" },
        { status: 400 }
      );
    }

    // Check for existing low-stock notification for this product in the last 24h
    // to avoid duplicate notifications
    const existingRecent = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.salonId, salonId),
          sql`${notifications.message} LIKE ${"%" + productId + "%"}`,
          sql`${notifications.createdAt} > NOW() - INTERVAL '24 hours'`,
          sql`${notifications.type} = 'system'`
        )
      )
      .limit(1);

    if (existingRecent.length > 0) {
      return NextResponse.json({
        success: true,
        data: {
          notificationSent: false,
          reason: "Recent notification already exists (within 24h)",
        },
      });
    }

    // Create notification
    const unitLabel = unit || "szt.";
    const message = `Niski stan magazynowy: "${productName}" - pozostalo ${quantity} ${unitLabel} (minimum: ${minQuantity} ${unitLabel}). Uzupelnij zapasy! [product:${productId}]`;

    const [notification] = await db
      .insert(notifications)
      .values({
        salonId,
        type: "system",
        message,
        status: "sent",
        sentAt: new Date(),
      })
      .returning();

    console.log(
      `[Low Stock Alert] Notification sent for product "${productName}" (${productId}) - qty: ${quantity}, min: ${minQuantity}`
    );

    return NextResponse.json({
      success: true,
      data: {
        notificationSent: true,
        notification,
      },
    });
  } catch (error) {
    console.error("[Low Stock Notification] Error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to create low stock notification" },
      { status: 500 }
    );
  }
}
