import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { serviceCategories } from "@/lib/schema";
import { eq } from "drizzle-orm";

// GET /api/service-categories - List all service categories
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const salonId = searchParams.get("salonId");

    console.log("[ServiceCategories API] GET with params:", { salonId });

    let result;
    if (salonId) {
      result = await db
        .select()
        .from(serviceCategories)
        .where(eq(serviceCategories.salonId, salonId))
        .orderBy(serviceCategories.sortOrder);
    } else {
      result = await db
        .select()
        .from(serviceCategories)
        .orderBy(serviceCategories.sortOrder);
    }

    console.log(`[ServiceCategories API] Query returned ${result.length} rows`);

    return NextResponse.json({
      success: true,
      data: result,
      count: result.length,
    });
  } catch (error) {
    console.error("[ServiceCategories API] Database error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch service categories" },
      { status: 500 }
    );
  }
}

// POST /api/service-categories - Create a new service category
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { salonId, name, sortOrder } = body;

    if (!salonId || !name) {
      return NextResponse.json(
        { success: false, error: "salonId and name are required" },
        { status: 400 }
      );
    }

    console.log(`[ServiceCategories API] Creating category: ${name}`);
    const [newCategory] = await db
      .insert(serviceCategories)
      .values({
        salonId,
        name,
        sortOrder: sortOrder ?? 0,
      })
      .returning();

    console.log(`[ServiceCategories API] Created category with id: ${newCategory?.id}`);

    return NextResponse.json(
      {
        success: true,
        data: newCategory,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("[ServiceCategories API] Database error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to create service category" },
      { status: 500 }
    );
  }
}
