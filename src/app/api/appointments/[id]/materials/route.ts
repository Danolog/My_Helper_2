import { NextResponse } from "next/server";
import { appointmentMaterials, products, appointments } from "@/lib/schema";
import { eq, and, sql } from "drizzle-orm";
import { validateBody, addAppointmentMaterialSchema } from "@/lib/api-validation";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";
import { getUserSalonId } from "@/lib/get-user-salon";
import { forSalon } from "@/lib/server/repository";

import { logger } from "@/lib/logger";
// GET /api/appointments/[id]/materials - List materials for an appointment
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

    const salonId = await getUserSalonId();
    if (!salonId) {
      return NextResponse.json(
        { success: false, error: "Salon not found" },
        { status: 404 }
      );
    }

    const { id } = await params;

    // Verify appointment exists in the caller's salon
    const appointment = await forSalon(salonId).findOne(appointments, id);

    if (!appointment) {
      return NextResponse.json(
        { success: false, error: "Appointment not found" },
        { status: 404 }
      );
    }

    // Get materials with product details (appointmentMaterials salon-scoped posrednio)
    const result = await forSalon(salonId).raw((tx) =>
      tx
        .select({
          material: appointmentMaterials,
          product: products,
        })
        .from(appointmentMaterials)
        .leftJoin(products, eq(appointmentMaterials.productId, products.id))
        .where(eq(appointmentMaterials.appointmentId, id))
    );

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

    const salonId = await getUserSalonId();
    if (!salonId) {
      return NextResponse.json(
        { success: false, error: "Salon not found" },
        { status: 404 }
      );
    }

    const { id } = await params;
    const body = await request.json();

    // Server-side validation with Zod schema
    const validationError = validateBody(addAppointmentMaterialSchema, body);
    if (validationError) {
      return NextResponse.json(validationError, { status: 400 });
    }

    const { productId, quantityUsed, notes } = body;

    // Verify appointment exists in the caller's salon
    const appointment = await forSalon(salonId).findOne(appointments, id);

    if (!appointment) {
      return NextResponse.json(
        { success: false, error: "Appointment not found" },
        { status: 404 }
      );
    }

    // Verify product exists in the caller's salon and check stock
    const product = await forSalon(salonId).findOne(products, productId);

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

    // Dodanie materialu + potracenie z magazynu + odczyt stanu atomowo w transakcji RLS.
    const { newMaterial, updatedProduct } = await forSalon(salonId).raw(async (tx) => {
      // 1. Add material record
      const [material] = await tx
        .insert(appointmentMaterials)
        .values({
          appointmentId: id,
          productId,
          quantityUsed: quantityUsed.toString(),
          notes: notes || null,
        })
        .returning();

      // 2. Deduct inventory
      await tx
        .update(products)
        .set({
          quantity: sql`${products.quantity}::numeric - ${usedQty}`,
        })
        .where(eq(products.id, productId));

      // 3. Fetch updated product to return current stock
      const [updated] = await tx
        .select()
        .from(products)
        .where(eq(products.id, productId))
        .limit(1);

      return { newMaterial: material, updatedProduct: updated };
    });

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

    const salonId = await getUserSalonId();
    if (!salonId) {
      return NextResponse.json(
        { success: false, error: "Salon not found" },
        { status: 404 }
      );
    }

    const { id: appointmentId } = await params;
    const { searchParams } = new URL(request.url);
    const materialId = searchParams.get("materialId");

    if (!materialId) {
      return NextResponse.json(
        { success: false, error: "materialId query parameter is required" },
        { status: 400 }
      );
    }

    // Verify the appointment belongs to the caller's salon
    const appointment = await forSalon(salonId).findOne(appointments, appointmentId);

    if (!appointment) {
      return NextResponse.json(
        { success: false, error: "Appointment not found" },
        { status: 404 }
      );
    }

    // Odczyt materialu + zwrot do magazynu + usuniecie atomowo w transakcji RLS.
    const result = await forSalon(salonId).raw(async (tx) => {
      // Find the material record (must belong to this appointment)
      const [material] = await tx
        .select()
        .from(appointmentMaterials)
        .where(
          and(
            eq(appointmentMaterials.id, materialId),
            eq(appointmentMaterials.appointmentId, appointmentId)
          )
        )
        .limit(1);

      if (!material) {
        return { notFound: true as const };
      }

      const usedQty = parseFloat(material.quantityUsed);

      // Restore inventory (scoped to caller's salon)
      await tx
        .update(products)
        .set({
          quantity: sql`${products.quantity}::numeric + ${usedQty}`,
        })
        .where(and(eq(products.id, material.productId), eq(products.salonId, salonId)));

      // Delete the material record
      const [deletedMaterial] = await tx
        .delete(appointmentMaterials)
        .where(eq(appointmentMaterials.id, materialId))
        .returning();

      logger.info(`[Appointment Materials API] Removed material ${materialId}, restored ${usedQty} to inventory`);
      return { notFound: false as const, deletedMaterial };
    });

    if (result.notFound) {
      return NextResponse.json(
        { success: false, error: "Material record not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: result.deletedMaterial,
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
