import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { promotions } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { validateBody, updatePromotionSchema } from "@/lib/api-validation";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";

// GET /api/promotions/:id - Get a single promotion
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;
    const { id } = await params;

    const [promotion] = await db
      .select()
      .from(promotions)
      .where(eq(promotions.id, id))
      .limit(1);

    if (!promotion) {
      return NextResponse.json(
        { success: false, error: "Promotion not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: promotion,
    });
  } catch (error) {
    console.error("[Promotions API] Database error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch promotion" },
      { status: 500 }
    );
  }
}

// PUT /api/promotions/:id - Update a promotion
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;
    const { id } = await params;
    const body = await request.json();

    // Server-side validation with Zod schema
    const validationError = validateBody(updatePromotionSchema, body);
    if (validationError) {
      return NextResponse.json(validationError, { status: 400 });
    }

    const { name, type, value, startDate, endDate, conditionsJson, isActive } = body;

    // Check promotion exists
    const [existing] = await db
      .select()
      .from(promotions)
      .where(eq(promotions.id, id))
      .limit(1);

    if (!existing) {
      return NextResponse.json(
        { success: false, error: "Promotion not found" },
        { status: 404 }
      );
    }

    // Build update object with only provided fields
    const updateData: Record<string, unknown> = {};
    if (name !== undefined) updateData.name = name;
    if (type !== undefined) {
      const validTypes = ["percentage", "fixed", "package", "buy2get1", "happy_hours", "first_visit"];
      if (!validTypes.includes(type)) {
        return NextResponse.json(
          { success: false, error: `Invalid type. Must be one of: ${validTypes.join(", ")}` },
          { status: 400 }
        );
      }
      updateData.type = type;
    }
    if (value !== undefined) {
      const effectiveType = type || existing.type;
      if (effectiveType === "percentage" || effectiveType === "buy2get1" || effectiveType === "happy_hours" || effectiveType === "first_visit") {
        const numValue = parseFloat(value);
        if (isNaN(numValue) || numValue <= 0 || numValue > 100) {
          return NextResponse.json(
            { success: false, error: "Percentage discount must be between 1 and 100" },
            { status: 400 }
          );
        }
      }
      updateData.value = value.toString();
    }
    if (startDate !== undefined) updateData.startDate = startDate ? new Date(startDate) : null;
    if (endDate !== undefined) updateData.endDate = endDate ? new Date(endDate) : null;

    // Handle conditionsJson - merge applicableServiceIds if provided
    if (conditionsJson !== undefined) {
      updateData.conditionsJson = conditionsJson;
    }
    if (body.applicableServiceIds && Array.isArray(body.applicableServiceIds)) {
      const existingConditions = (conditionsJson !== undefined ? conditionsJson : existing.conditionsJson) || {};
      updateData.conditionsJson = {
        ...existingConditions,
        applicableServiceIds: body.applicableServiceIds,
      };
    }

    if (isActive !== undefined) updateData.isActive = isActive;

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json(
        { success: false, error: "No fields to update" },
        { status: 400 }
      );
    }

    const [updated] = await db
      .update(promotions)
      .set(updateData)
      .where(eq(promotions.id, id))
      .returning();

    if (!updated) {
      return NextResponse.json(
        { success: false, error: "Failed to update promotion" },
        { status: 500 }
      );
    }

    console.log(`[Promotions API] Updated promotion: ${updated.name} (${updated.id})`);

    return NextResponse.json({
      success: true,
      data: updated,
    });
  } catch (error) {
    console.error("[Promotions API] Database error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to update promotion" },
      { status: 500 }
    );
  }
}

// DELETE /api/promotions/:id - Delete a promotion
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;
    const { id } = await params;

    const [deleted] = await db
      .delete(promotions)
      .where(eq(promotions.id, id))
      .returning();

    if (!deleted) {
      return NextResponse.json(
        { success: false, error: "Promotion not found" },
        { status: 404 }
      );
    }

    console.log(`[Promotions API] Deleted promotion: ${deleted.name} (${deleted.id})`);

    return NextResponse.json({
      success: true,
      data: deleted,
    });
  } catch (error) {
    console.error("[Promotions API] Database error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to delete promotion" },
      { status: 500 }
    );
  }
}
