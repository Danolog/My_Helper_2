import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { serviceProducts, products } from "@/lib/schema";
import { eq, and } from "drizzle-orm";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";
import { validateBody, serviceProductLinkSchema } from "@/lib/api-validation";

import { logger } from "@/lib/logger";
// GET /api/services/[id]/products - List products linked to a service (for auto-deduction)
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

    const { id: serviceId } = await params;

    const result = await db
      .select({
        id: serviceProducts.id,
        serviceId: serviceProducts.serviceId,
        productId: serviceProducts.productId,
        defaultQuantity: serviceProducts.defaultQuantity,
        createdAt: serviceProducts.createdAt,
        productName: products.name,
        productCategory: products.category,
        productUnit: products.unit,
        productQuantity: products.quantity,
        productMinQuantity: products.minQuantity,
      })
      .from(serviceProducts)
      .leftJoin(products, eq(serviceProducts.productId, products.id))
      .where(eq(serviceProducts.serviceId, serviceId));

    return NextResponse.json({
      success: true,
      data: result,
      count: result.length,
    });
  } catch (error) {
    logger.error("[Service Products API] Database error", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to fetch service products" },
      { status: 500 }
    );
  }
}

// POST /api/services/[id]/products - Link a product to a service for auto-deduction
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

    const { id: serviceId } = await params;
    const body = await request.json();
    const validationError = validateBody(serviceProductLinkSchema, body);
    if (validationError) {
      return NextResponse.json(validationError, { status: 400 });
    }
    const { productId, defaultQuantity } = body;

    // Check if this product is already linked to this service
    const [existing] = await db
      .select()
      .from(serviceProducts)
      .where(
        and(
          eq(serviceProducts.serviceId, serviceId),
          eq(serviceProducts.productId, productId)
        )
      )
      .limit(1);

    if (existing) {
      // Update existing link
      const [updated] = await db
        .update(serviceProducts)
        .set({ defaultQuantity: (defaultQuantity || 1).toString() })
        .where(eq(serviceProducts.id, existing.id))
        .returning();

      logger.info(`[Service Products API] Updated product link: service=${serviceId}, product=${productId}, qty=${defaultQuantity || 1}`);

      return NextResponse.json({
        success: true,
        data: updated,
        updated: true,
      });
    }

    // Create new link
    const [newLink] = await db
      .insert(serviceProducts)
      .values({
        serviceId,
        productId,
        defaultQuantity: (defaultQuantity || 1).toString(),
      })
      .returning();

    logger.info(`[Service Products API] Linked product to service: service=${serviceId}, product=${productId}, qty=${defaultQuantity || 1}`);

    return NextResponse.json(
      {
        success: true,
        data: newLink,
      },
      { status: 201 }
    );
  } catch (error) {
    logger.error("[Service Products API] Database error", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to link product to service" },
      { status: 500 }
    );
  }
}

// DELETE /api/services/[id]/products - Remove a product link from a service
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

    const { id: serviceId } = await params;
    const { searchParams } = new URL(request.url);
    const linkId = searchParams.get("linkId");

    if (!linkId) {
      return NextResponse.json(
        { success: false, error: "linkId query parameter is required" },
        { status: 400 }
      );
    }

    const [deleted] = await db
      .delete(serviceProducts)
      .where(
        and(
          eq(serviceProducts.id, linkId),
          eq(serviceProducts.serviceId, serviceId)
        )
      )
      .returning();

    if (!deleted) {
      return NextResponse.json(
        { success: false, error: "Service-product link not found" },
        { status: 404 }
      );
    }

    logger.info(`[Service Products API] Removed product link: service=${serviceId}, linkId=${linkId}`);

    return NextResponse.json({
      success: true,
      data: deleted,
      message: "Product link removed",
    });
  } catch (error) {
    logger.error("[Service Products API] Database error", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to remove product link" },
      { status: 500 }
    );
  }
}
