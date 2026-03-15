import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { serviceCategories, services } from "@/lib/schema";
import { eq, and, count } from "drizzle-orm";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";

// GET /api/service-categories/[id] - Get a single category
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

    const { id } = await params;

    const [category] = await db
      .select()
      .from(serviceCategories)
      .where(eq(serviceCategories.id, id));

    if (!category) {
      return NextResponse.json(
        { success: false, error: "Category not found" },
        { status: 404 }
      );
    }

    // Get count of services in this category
    const [serviceCount] = await db
      .select({ count: count() })
      .from(services)
      .where(eq(services.categoryId, id));

    return NextResponse.json({
      success: true,
      data: {
        ...category,
        serviceCount: serviceCount?.count ?? 0,
      },
    });
  } catch (error) {
    console.error("[ServiceCategories API] Database error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch category" },
      { status: 500 }
    );
  }
}

// PUT /api/service-categories/[id] - Update a category
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

    const { id } = await params;
    const body = await request.json();
    const { name, sortOrder } = body;

    if (!name || !name.trim()) {
      return NextResponse.json(
        { success: false, error: "Category name is required" },
        { status: 400 }
      );
    }

    // Check category exists
    const [existing] = await db
      .select()
      .from(serviceCategories)
      .where(eq(serviceCategories.id, id));

    if (!existing) {
      return NextResponse.json(
        { success: false, error: "Category not found" },
        { status: 404 }
      );
    }

    // Check for duplicate name in same salon
    const [duplicate] = await db
      .select()
      .from(serviceCategories)
      .where(
        and(
          eq(serviceCategories.salonId, existing.salonId),
          eq(serviceCategories.name, name.trim())
        )
      );

    if (duplicate && duplicate.id !== id) {
      return NextResponse.json(
        { success: false, error: "A category with this name already exists" },
        { status: 409 }
      );
    }

    const updateData: Record<string, unknown> = { name: name.trim() };
    if (sortOrder !== undefined) {
      updateData.sortOrder = sortOrder;
    }

    const [updated] = await db
      .update(serviceCategories)
      .set(updateData)
      .where(eq(serviceCategories.id, id))
      .returning();

    console.log(`[ServiceCategories API] Updated category: ${updated?.name}`);

    return NextResponse.json({
      success: true,
      data: updated,
    });
  } catch (error) {
    console.error("[ServiceCategories API] Database error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to update category" },
      { status: 500 }
    );
  }
}

// DELETE /api/service-categories/[id] - Delete a category
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

    const { id } = await params;

    // Check category exists
    const [existing] = await db
      .select()
      .from(serviceCategories)
      .where(eq(serviceCategories.id, id));

    if (!existing) {
      return NextResponse.json(
        { success: false, error: "Category not found" },
        { status: 404 }
      );
    }

    // Check if category has services assigned
    const [serviceCount] = await db
      .select({ count: count() })
      .from(services)
      .where(eq(services.categoryId, id));

    if (serviceCount && serviceCount.count > 0) {
      return NextResponse.json(
        {
          success: false,
          error: `Nie mozna usunac kategorii - ${serviceCount.count} uslug jest do niej przypisanych. Najpierw przenies uslugi do innej kategorii.`,
          serviceCount: serviceCount.count,
        },
        { status: 409 }
      );
    }

    // Delete the empty category
    await db
      .delete(serviceCategories)
      .where(eq(serviceCategories.id, id));

    console.log(`[ServiceCategories API] Deleted category: ${existing.name}`);

    return NextResponse.json({
      success: true,
      message: `Category "${existing.name}" deleted successfully`,
    });
  } catch (error) {
    console.error("[ServiceCategories API] Database error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to delete category" },
      { status: 500 }
    );
  }
}
