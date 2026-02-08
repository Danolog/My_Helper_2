import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { services, serviceCategories, serviceVariants } from "@/lib/schema";
import { eq } from "drizzle-orm";

// GET /api/services/[id] - Get a single service with its variants
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const [serviceRow] = await db
      .select({
        service: services,
        category: serviceCategories,
      })
      .from(services)
      .leftJoin(serviceCategories, eq(services.categoryId, serviceCategories.id))
      .where(eq(services.id, id));

    if (!serviceRow) {
      return NextResponse.json(
        { success: false, error: "Service not found" },
        { status: 404 }
      );
    }

    // Fetch variants for this service
    const variants = await db
      .select()
      .from(serviceVariants)
      .where(eq(serviceVariants.serviceId, id));

    return NextResponse.json({
      success: true,
      data: {
        ...serviceRow.service,
        category: serviceRow.category,
        variants,
      },
    });
  } catch (error) {
    console.error("[Services API] Error fetching service:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch service" },
      { status: 500 }
    );
  }
}

// PUT /api/services/[id] - Update a service
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { name, description, basePrice, baseDuration, isActive, categoryId, depositRequired, depositPercentage } = body;

    const updateData: Record<string, unknown> = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (basePrice !== undefined) updateData.basePrice = basePrice.toString();
    if (baseDuration !== undefined) updateData.baseDuration = parseInt(baseDuration, 10);
    if (isActive !== undefined) updateData.isActive = isActive;
    if (categoryId !== undefined) updateData.categoryId = categoryId;
    if (depositRequired !== undefined) updateData.depositRequired = depositRequired;
    if (depositPercentage !== undefined) updateData.depositPercentage = parseInt(depositPercentage, 10);

    const [updated] = await db
      .update(services)
      .set(updateData)
      .where(eq(services.id, id))
      .returning();

    if (!updated) {
      return NextResponse.json(
        { success: false, error: "Service not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: updated,
    });
  } catch (error) {
    console.error("[Services API] Error updating service:", error);
    return NextResponse.json(
      { success: false, error: "Failed to update service" },
      { status: 500 }
    );
  }
}

// DELETE /api/services/[id] - Delete a service
// Related records are handled by database cascade rules:
// - service_variants: CASCADE (deleted)
// - employee_services: CASCADE (deleted)
// - employee_service_prices: CASCADE (deleted)
// - appointments.serviceId: SET NULL (appointments preserved, serviceId nullified)
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const [deleted] = await db
      .delete(services)
      .where(eq(services.id, id))
      .returning();

    if (!deleted) {
      return NextResponse.json(
        { success: false, error: "Service not found" },
        { status: 404 }
      );
    }

    console.log(`[Services API] Deleted service: ${deleted.name} (${deleted.id})`);

    return NextResponse.json({
      success: true,
      data: deleted,
    });
  } catch (error) {
    console.error("[Services API] Error deleting service:", error);
    return NextResponse.json(
      { success: false, error: "Failed to delete service" },
      { status: 500 }
    );
  }
}
