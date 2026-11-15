import { NextResponse } from "next/server";
import { eq, and, like, sql } from "drizzle-orm";
import { withApiHandler } from "@/lib/api-handler";
import { createProductSchema } from "@/lib/api-validation";
import { logger } from "@/lib/logger";
import { apiRateLimit } from "@/lib/rate-limit";
import { requireSalonStaff } from "@/lib/salon-context";
import { products, notifications } from "@/lib/schema";
import { forSalon } from "@/lib/server/repository";
import type { z } from "zod";
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
    // Sprawdzenie duplikatu + insert powiadomienia w jednej transakcji RLS.
    return forSalon(product.salonId).raw(async (tx) => {
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

// GET /api/products - List products with optional salonId filter
export const GET = withApiHandler(
  {
    auth: "user",
    logLabel: "[Products API] GET",
    errorMessage: "Failed to fetch products",
  },
  async ({ request }) => {
    const { searchParams } = new URL(request.url);
    // P1 (przegląd Ryana): salon WYŁĄCZNIE z sesji. Wcześniej właściciel był
    // zwolniony z kontroli (`ctx.role === "owner" ? ?salonId : ...`) — owner
    // salonu A listował magazyn salonu B. Query tylko porównywane (inne => 403),
    // brak => salon sesji. Dostęp: właściciel albo czasowy grant "products".
    const guard = await requireSalonStaff({
      feature: "products",
      requestedSalonId: searchParams.get("salonId"),
    });
    if (guard.error) return guard.error;
    const salonId = guard.ctx.salonId;

    // Select only the columns needed by the inventory UI
    const productColumns = {
      id: products.id,
      salonId: products.salonId,
      name: products.name,
      category: products.category,
      quantity: products.quantity,
      minQuantity: products.minQuantity,
      unit: products.unit,
      pricePerUnit: products.pricePerUnit,
      createdAt: products.createdAt,
      updatedAt: products.updatedAt,
    };

    const result = await forSalon(salonId).raw((tx) =>
      tx.select(productColumns).from(products).where(eq(products.salonId, salonId))
    );

    return NextResponse.json({
      success: true,
      data: result,
      count: result.length,
    });
  }
);

// POST /api/products - Create a new product
export const POST = withApiHandler(
  {
    auth: "user",
    rateLimit: apiRateLimit,
    schema: createProductSchema as z.ZodType<{
      salonId: string;
      name: string;
      category?: string | null;
      quantity?: string | number | null;
      minQuantity?: string | number | null;
      unit?: string | null;
      pricePerUnit?: string | number | null;
    }>,
    logLabel: "[Products API] POST",
    errorMessage: "Failed to create product",
  },
  async ({ body }) => {
    // P1 (przegląd Ryana): salon WYŁĄCZNIE z sesji. Wcześniej warunek
    // `ctx.role !== "owner" && ...` zwalniał każdego właściciela z porównania
    // salonu — owner salonu A dodawał produkt do salonu B (forSalon(body.salonId)).
    // body.salonId tylko porównywany (inny => 403); właściciel albo grant "products".
    const guard = await requireSalonStaff({
      feature: "products",
      requestedSalonId: body.salonId,
    });
    if (guard.error) return guard.error;
    const salonId = guard.ctx.salonId;

    const { name, category, quantity, minQuantity, unit, pricePerUnit } = body;

    const [newProduct] = await forSalon(salonId).raw((tx) =>
      tx
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
      .returning()
    );

    if (!newProduct) {
      return NextResponse.json(
        { success: false, error: "Failed to create product" },
        { status: 500 }
      );
    }

    logger.info(`[Products API] Created product: ${newProduct.name} (${newProduct.id})`);

    // Check for low stock and send notification if needed
    let lowStockAlert = null;
    try {
      lowStockAlert = await checkAndNotifyLowStock(newProduct);
    } catch (alertError) {
      logger.error("[Products API] Low stock check failed (non-blocking)", { error: alertError });
    }

    return NextResponse.json({
      success: true,
      data: newProduct,
      lowStockAlert,
    }, { status: 201 });
  }
);
