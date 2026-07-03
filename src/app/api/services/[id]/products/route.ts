import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { withApiHandler } from "@/lib/api-handler";
import { validateBody, serviceProductLinkSchema } from "@/lib/api-validation";
import { getUserSalonId } from "@/lib/get-user-salon";
import { logger } from "@/lib/logger";
import { serviceProducts, products, services } from "@/lib/schema";
import { forSalon } from "@/lib/server/repository";

/** Verify the service belongs to the caller's salon; returns true if owned. */
async function serviceBelongsToSalon(serviceId: string, salonId: string): Promise<boolean> {
  const service = await forSalon(salonId).findOne(services, serviceId);
  return !!service;
}

// GET /api/services/[id]/products - List products linked to a service (for auto-deduction)
export const GET = withApiHandler(
  {
    auth: "user",
    logLabel: "[Service Products API] GET",
    errorMessage: "Failed to fetch service products",
  },
  async ({ params }) => {
    const salonId = await getUserSalonId();
    if (!salonId) {
      return NextResponse.json(
        { success: false, error: "Salon not found" },
        { status: 404 }
      );
    }

    const serviceId = params.id!; // segment [id] zawsze obecny (noUncheckedIndexedAccess)

    if (!(await serviceBelongsToSalon(serviceId, salonId))) {
      return NextResponse.json(
        { success: false, error: "Service not found" },
        { status: 404 }
      );
    }

    const result = await forSalon(salonId).raw((tx) =>
      tx
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
        .where(eq(serviceProducts.serviceId, serviceId))
    );

    return NextResponse.json({
      success: true,
      data: result,
      count: result.length,
    });
  }
);

// POST /api/services/[id]/products - Link a product to a service for auto-deduction
export const POST = withApiHandler(
  {
    auth: "user",
    logLabel: "[Service Products API] POST",
    errorMessage: "Failed to link product to service",
  },
  async ({ request, params }) => {
    const salonId = await getUserSalonId();
    if (!salonId) {
      return NextResponse.json(
        { success: false, error: "Salon not found" },
        { status: 404 }
      );
    }

    const serviceId = params.id!; // segment [id] zawsze obecny (noUncheckedIndexedAccess)
    // Walidacja celowo w handlerze (po sprawdzeniu salonu) — jak dotąd.
    const body = await request.json();
    const validationError = validateBody(serviceProductLinkSchema, body);
    if (validationError) {
      return NextResponse.json(validationError, { status: 400 });
    }
    const { productId, defaultQuantity } = body;

    if (!(await serviceBelongsToSalon(serviceId, salonId))) {
      return NextResponse.json(
        { success: false, error: "Service not found" },
        { status: 404 }
      );
    }

    // Verify the product also belongs to the caller's salon
    const ownedProduct = await forSalon(salonId).findOne(products, productId);
    if (!ownedProduct) {
      return NextResponse.json(
        { success: false, error: "Product not found" },
        { status: 404 }
      );
    }

    // Upsert linku produkt<->usluga atomowo w jednej transakcji RLS.
    const { row, wasUpdate } = await forSalon(salonId).raw(async (tx) => {
      // Check if this product is already linked to this service
      const [existing] = await tx
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
        const [updated] = await tx
          .update(serviceProducts)
          .set({ defaultQuantity: (defaultQuantity || 1).toString() })
          .where(eq(serviceProducts.id, existing.id))
          .returning();
        return { row: updated, wasUpdate: true };
      }

      // Create new link
      const [newLink] = await tx
        .insert(serviceProducts)
        .values({
          serviceId,
          productId,
          defaultQuantity: (defaultQuantity || 1).toString(),
        })
        .returning();
      return { row: newLink, wasUpdate: false };
    });

    if (wasUpdate) {
      logger.info(`[Service Products API] Updated product link: service=${serviceId}, product=${productId}, qty=${defaultQuantity || 1}`);

      return NextResponse.json({
        success: true,
        data: row,
        updated: true,
      });
    }

    logger.info(`[Service Products API] Linked product to service: service=${serviceId}, product=${productId}, qty=${defaultQuantity || 1}`);

    return NextResponse.json(
      {
        success: true,
        data: row,
      },
      { status: 201 }
    );
  }
);

// DELETE /api/services/[id]/products - Remove a product link from a service
export const DELETE = withApiHandler(
  {
    auth: "user",
    logLabel: "[Service Products API] DELETE",
    errorMessage: "Failed to remove product link",
  },
  async ({ request, params }) => {
    const salonId = await getUserSalonId();
    if (!salonId) {
      return NextResponse.json(
        { success: false, error: "Salon not found" },
        { status: 404 }
      );
    }

    const serviceId = params.id!; // segment [id] zawsze obecny (noUncheckedIndexedAccess)
    const { searchParams } = new URL(request.url);
    const linkId = searchParams.get("linkId");

    if (!linkId) {
      return NextResponse.json(
        { success: false, error: "linkId query parameter is required" },
        { status: 400 }
      );
    }

    if (!(await serviceBelongsToSalon(serviceId, salonId))) {
      return NextResponse.json(
        { success: false, error: "Service not found" },
        { status: 404 }
      );
    }

    const [deleted] = await forSalon(salonId).raw((tx) =>
      tx
        .delete(serviceProducts)
        .where(
          and(
            eq(serviceProducts.id, linkId),
            eq(serviceProducts.serviceId, serviceId)
          )
        )
        .returning()
    );

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
  }
);
