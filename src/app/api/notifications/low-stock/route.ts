import { NextResponse } from "next/server";
import { eq, and, isNotNull, like, sql } from "drizzle-orm";
import { isValidUuid, validateBody, lowStockNotificationSchema } from "@/lib/api-validation";
import { requireCronSecret } from "@/lib/auth-middleware";
import { logger } from "@/lib/logger";
import { products, notifications } from "@/lib/schema";
// #193 P5a-2 (decyzja z recenzji D1): jeden salon z obowiązkowego salonId → brama salonu;
// w raw jawny warunek salonu w każdym zapytaniu.
import { forSalon } from "@/lib/server/repository";
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

    if (!isValidUuid(salonId)) {
      return NextResponse.json(
        { success: false, error: "Nieprawidłowy salonId" },
        { status: 400 }
      );
    }

    // Find all products where quantity <= minQuantity
    const lowStockProducts = await forSalon(salonId).raw((tx) =>
      tx
        .select()
        .from(products)
        .where(
          and(
            eq(products.salonId, salonId),
            isNotNull(products.minQuantity),
            sql`CAST(${products.quantity} AS numeric) <= CAST(${products.minQuantity} AS numeric)`
          )
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
    logger.error("[Low Stock API] Error", { error: error });
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

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, error: "Invalid JSON" },
        { status: 400 }
      );
    }

    // Validate request body with Zod schema
    const validationError = validateBody(lowStockNotificationSchema, body);
    if (validationError) {
      return NextResponse.json(validationError, { status: 400 });
    }

    const { salonId, productId, productName, quantity, minQuantity, unit } = body as {
      salonId: string;
      productId: string;
      productName: string;
      quantity?: string | number;
      minQuantity?: string | number;
      unit?: string;
    };

    const unitLabel = unit || "szt.";
    const message = `Niski stan magazynowy: "${productName}" - pozostalo ${quantity} ${unitLabel} (minimum: ${minQuantity} ${unitLabel}). Uzupelnij zapasy! [product:${productId}]`;

    // Sprawdzenie duplikatu z ostatnich 24h i zapis w jednej transakcji bramy
    // (bez wywołań zewnętrznych w środku).
    const notification = await forSalon(salonId).raw(async (tx) => {
      const existingRecent = await tx
        .select({ id: notifications.id })
        .from(notifications)
        .where(
          and(
            eq(notifications.salonId, salonId),
            like(notifications.message, `%${productId}%`),
            sql`${notifications.createdAt} > NOW() - INTERVAL '24 hours'`,
            sql`${notifications.type} = 'system'`
          )
        )
        .limit(1);
      if (existingRecent.length > 0) return null;

      const [created] = await tx
        .insert(notifications)
        .values({
          salonId,
          type: "system",
          message,
          status: "sent",
          sentAt: new Date(),
        })
        .returning();
      return created ?? null;
    });

    if (!notification) {
      return NextResponse.json({
        success: true,
        data: {
          notificationSent: false,
          reason: "Recent notification already exists (within 24h)",
        },
      });
    }

    logger.info(`[Low Stock Alert] Notification sent for product "${productName}" (${productId}) - qty: ${quantity}, min: ${minQuantity}`);

    return NextResponse.json({
      success: true,
      data: {
        notificationSent: true,
        notification,
      },
    });
  } catch (error) {
    logger.error("[Low Stock Notification] Error", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to create low stock notification" },
      { status: 500 }
    );
  }
}
