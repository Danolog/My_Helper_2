import { NextResponse } from "next/server";
import { eq, and, like, sql } from "drizzle-orm";
import { withApiHandler } from "@/lib/api-handler";
import { validateBody, updateProductSchema } from "@/lib/api-validation";
import { getUserSalonId } from "@/lib/get-user-salon";
import { logger } from "@/lib/logger";
import { products, notifications } from "@/lib/schema";
import { forSalon } from "@/lib/server/repository";
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
    // notifications jest salon-scoped (product.salonId = salon wlasciciela) —
    // czytamy/piszemy przez forSalon(...).raw, kontekst RLS + jawne eq(salonId).
    return forSalon(product.salonId).raw(async (tx) => {
      // Check for existing notification in the last 24h to avoid duplicates
      const existingRecent = await tx
        .select({ id: notifications.id })
        .from(notifications)
        .where(
          and(
            eq(notifications.salonId, product.salonId),
            like(notifications.message, `%${product.id}%`),
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

      const [notification] = await tx
        .insert(notifications)
        .values({
          salonId: product.salonId,
          type: "system",
          message,
          status: "sent",
          sentAt: new Date(),
        })
        .returning();

      logger.info(`[Low Stock Alert] Notification sent for "${product.name}" (${product.id}) - qty: ${qty}, min: ${minQty}`);

      return { notificationSent: true, notification };
    });
  }

  return { notificationSent: false, reason: "stock_ok" };
}

// GET /api/products/[id] - Get a single product
export const GET = withApiHandler(
  {
    auth: "user",
    logLabel: "[Products API] GET",
    errorMessage: "Failed to fetch product",
  },
  async ({ params }) => {
    const salonId = await getUserSalonId();
    if (!salonId) {
      return NextResponse.json(
        { success: false, error: "Salon not found" },
        { status: 404 }
      );
    }

    const id = params.id!; // segment [id] zawsze obecny (noUncheckedIndexedAccess)

    const product = await forSalon(salonId).findOne(products, id);

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
  }
);

// PUT /api/products/[id] - Update a product
export const PUT = withApiHandler(
  {
    auth: "user",
    logLabel: "[Products API] PUT",
    errorMessage: "Failed to update product",
  },
  async ({ request, params }) => {
    const salonId = await getUserSalonId();
    if (!salonId) {
      return NextResponse.json(
        { success: false, error: "Salon not found" },
        { status: 404 }
      );
    }

    const id = params.id!; // segment [id] zawsze obecny (noUncheckedIndexedAccess)
    // Walidacja celowo w handlerze (po sprawdzeniu salonu) — jak dotąd.
    const body = await request.json();

    // Server-side validation with Zod schema
    const validationError = validateBody(updateProductSchema, body);
    if (validationError) {
      return NextResponse.json(validationError, { status: 400 });
    }

    const { name, category, quantity, minQuantity, unit, pricePerUnit } = body;

    const updateData: Record<string, unknown> = {};
    if (name !== undefined) updateData.name = name;
    if (category !== undefined) updateData.category = category;
    if (quantity !== undefined) updateData.quantity = quantity.toString();
    if (minQuantity !== undefined) updateData.minQuantity = minQuantity?.toString() || null;
    if (unit !== undefined) updateData.unit = unit;
    if (pricePerUnit !== undefined) updateData.pricePerUnit = pricePerUnit?.toString() || null;

    const updatedProduct = await forSalon(salonId).updateOwned(products, id, updateData);

    if (!updatedProduct) {
      return NextResponse.json(
        { success: false, error: "Product not found" },
        { status: 404 }
      );
    }

    logger.info(`[Products API] Updated product: ${updatedProduct.name} (${updatedProduct.id})`);

    // Check for low stock and send notification if needed
    let lowStockAlert = null;
    try {
      lowStockAlert = await checkAndNotifyLowStock(updatedProduct);
    } catch (alertError) {
      logger.error("[Products API] Low stock check failed (non-blocking)", { error: alertError });
    }

    return NextResponse.json({
      success: true,
      data: updatedProduct,
      lowStockAlert,
    });
  }
);

// DELETE /api/products/[id] - Delete a product
export const DELETE = withApiHandler(
  {
    auth: "user",
    logLabel: "[Products API] DELETE",
    errorMessage: "Failed to delete product",
  },
  async ({ params }) => {
    const salonId = await getUserSalonId();
    if (!salonId) {
      return NextResponse.json(
        { success: false, error: "Salon not found" },
        { status: 404 }
      );
    }

    const id = params.id!; // segment [id] zawsze obecny (noUncheckedIndexedAccess)

    const deletedProduct = await forSalon(salonId).deleteOwned(products, id);

    if (!deletedProduct) {
      return NextResponse.json(
        { success: false, error: "Product not found" },
        { status: 404 }
      );
    }

    logger.info(`[Products API] Deleted product: ${deletedProduct.name} (${deletedProduct.id})`);

    return NextResponse.json({
      success: true,
      data: deletedProduct,
      message: "Product deleted successfully",
    });
  }
);
