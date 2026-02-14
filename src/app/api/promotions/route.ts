import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { promotions } from "@/lib/schema";
import { eq, desc } from "drizzle-orm";

// GET /api/promotions - List promotions with optional salonId filter
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const salonId = searchParams.get("salonId");

    let query = db.select().from(promotions).orderBy(desc(promotions.createdAt));

    if (salonId) {
      query = query.where(eq(promotions.salonId, salonId)) as typeof query;
    }

    const result = await query;

    return NextResponse.json({
      success: true,
      data: result,
      count: result.length,
    });
  } catch (error) {
    console.error("[Promotions API] Database error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch promotions" },
      { status: 500 }
    );
  }
}

// POST /api/promotions - Create a new promotion
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { salonId, name, type, value, startDate, endDate, conditionsJson, isActive } = body;

    if (!salonId || !name || !type || value === undefined || value === null) {
      return NextResponse.json(
        { success: false, error: "salonId, name, type, and value are required" },
        { status: 400 }
      );
    }

    // Validate type
    const validTypes = ["percentage", "fixed", "package"];
    if (!validTypes.includes(type)) {
      return NextResponse.json(
        { success: false, error: `Invalid type. Must be one of: ${validTypes.join(", ")}` },
        { status: 400 }
      );
    }

    // Validate percentage value (0-100)
    if (type === "percentage") {
      const numValue = parseFloat(value);
      if (isNaN(numValue) || numValue <= 0 || numValue > 100) {
        return NextResponse.json(
          { success: false, error: "Percentage discount must be between 1 and 100" },
          { status: 400 }
        );
      }
    }

    // Validate fixed value
    if (type === "fixed") {
      const numValue = parseFloat(value);
      if (isNaN(numValue) || numValue <= 0) {
        return NextResponse.json(
          { success: false, error: "Fixed discount must be greater than 0" },
          { status: 400 }
        );
      }
    }

    const [newPromotion] = await db
      .insert(promotions)
      .values({
        salonId,
        name,
        type,
        value: value.toString(),
        startDate: startDate ? new Date(startDate) : null,
        endDate: endDate ? new Date(endDate) : null,
        conditionsJson: conditionsJson || {},
        isActive: isActive !== undefined ? isActive : true,
      })
      .returning();

    if (!newPromotion) {
      return NextResponse.json(
        { success: false, error: "Failed to create promotion" },
        { status: 500 }
      );
    }

    console.log(`[Promotions API] Created promotion: ${newPromotion.name} (${newPromotion.id}) - type: ${newPromotion.type}, value: ${newPromotion.value}`);

    return NextResponse.json({
      success: true,
      data: newPromotion,
    }, { status: 201 });
  } catch (error) {
    console.error("[Promotions API] Database error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to create promotion" },
      { status: 500 }
    );
  }
}
