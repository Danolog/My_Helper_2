import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { appointmentMaterials, products, appointments } from "@/lib/schema";
import { eq, sql } from "drizzle-orm";
import { validateBody, addAppointmentMaterialSchema } from "@/lib/api-validation";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";

import { logger } from "@/lib/logger";
// GET /api/appointments/[id]/materials - List materials for an appointment
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

    const { id } = await params;

    // Verify appointment exists
    const [appointment] = await db
      .select()
      .from(appointments)
      .where(eq(appointments.id, id))
      .limit(1);

    if (!appointment) {
      return NextResponse.json(
        { success: false, error: "Appointment not found" },
        { status: 404 }
      );
    }

    // Get materials with product details
    const result = await db
      .select({
        material: appointmentMaterials,
        product: products,
      })
      .from(appointmentMaterials)
      .leftJoin(products, eq(appointmentMaterials.productId, products.id))
      .where(eq(appointmentMaterials.appointmentId, id));

    const formattedMaterials = result.map((row) => ({
      ...row.material,
      product: row.product,
    }));

    return NextResponse.json({
      success: true,
      data: formattedMaterials,
      count: formattedMaterials.length,
    });
  } catch (error) {
    logger.error("[Appointment Materials API] Database error", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to fetch appointment materials" },
      { status: 500 }
    );
  }
}

// POST /api/appointments/[id]/materials - Add material to appointment & deduct inventory
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

    const { id } = await params;
    const body = await request.json();

    // Server-side validation with Zod schema
    const validationError = validateBody(addAppointmentMaterialSchema, body);
    if (validationError) {
      return NextResponse.json(validationError, { status: 400 });
    }

    const { productId, quantityUsed, notes } = body;

    // Verify appointment exists
    const [appointment] = await db
      .select()
      .from(appointments)
      .where(eq(appointments.id, id))
      .limit(1);

    if (!appointment) {
      return NextResponse.json(
        { success: false, error: "Appointment not found" },
        { status: 404 }
      );
    }

    // Verify product exists and check stock
    const [product] = await db
      .select()
      .from(products)
      .where(eq(products.id, productId))
      .limit(1);

    if (!product) {
      return NextResponse.json(
        { success: false, error: "Product not found" },
        { status: 404 }
      );
    }

    const currentQty = parseFloat(product.quantity || "0");
    const usedQty = parseFloat(quantityUsed);

    if (currentQty < usedQty) {
      return NextResponse.json(
        {
          success: false,
          error: `Niewystarczajaca ilosc w magazynie. Dostepne: ${currentQty} ${product.unit || "szt."}, wymagane: ${usedQty}`,
        },
        { status: 400 }
      );
    }

    // 1. Add material record
    const [newMaterial] = await db
      .insert(appointmentMaterials)
      .values({
        appointmentId: id,
        productId,
        quantityUsed: quantityUsed.toString(),
        notes: notes || null,
      })
      .returning();

    // 2. Deduct inventory
    await db
      .update(products)
      .set({
        quantity: sql`${products.quantity}::numeric - ${usedQty}`,
      })
      .where(eq(products.id, productId));

    // 3. Fetch updated product to return current stock
    const [updatedProduct] = await db
      .select()
      .from(products)
      .where(eq(products.id, productId))
      .limit(1);

    logger.info(`[Appointment Materials API] Added ${usedQty} ${product.unit || "szt."} of "${product.name}" to appointment ${id}. Stock: ${currentQty} -> ${updatedProduct?.quantity}`);

    return NextResponse.json(
      {
        success: true,
        data: {
          ...newMaterial,
          product: updatedProduct,
        },
        message: `Dodano ${usedQty} ${product.unit || "szt."} produktu "${product.name}". Pozostalo w magazynie: ${updatedProduct?.quantity} ${product.unit || "szt."}`,
      },
      { status: 201 }
    );
  } catch (error) {
    logger.error("[Appointment Materials API] Database error", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to add material to appointment" },
      { status: 500 }
    );
  }
}

// DELETE /api/appointments/[id]/materials - Remove a specific material (restore inventory)
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

    const { id: _appointmentId } = await params;
    const { searchParams } = new URL(request.url);
    const materialId = searchParams.get("materialId");

    if (!materialId) {
      return NextResponse.json(
        { success: false, error: "materialId query parameter is required" },
        { status: 400 }
      );
    }

    // Find the material record
    const [material] = await db
      .select()
      .from(appointmentMaterials)
      .where(eq(appointmentMaterials.id, materialId))
      .limit(1);

    if (!material) {
      return NextResponse.json(
        { success: false, error: "Material record not found" },
        { status: 404 }
      );
    }

    const usedQty = parseFloat(material.quantityUsed);

    // Restore inventory
    await db
      .update(products)
      .set({
        quantity: sql`${products.quantity}::numeric + ${usedQty}`,
      })
      .where(eq(products.id, material.productId));

    // Delete the material record
    const [deletedMaterial] = await db
      .delete(appointmentMaterials)
      .where(eq(appointmentMaterials.id, materialId))
      .returning();

    logger.info(`[Appointment Materials API] Removed material ${materialId}, restored ${usedQty} to inventory`);

    return NextResponse.json({
      success: true,
      data: deletedMaterial,
      message: "Material removed and inventory restored",
    });
  } catch (error) {
    logger.error("[Appointment Materials API] Database error", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to remove material" },
      { status: 500 }
    );
  }
}
