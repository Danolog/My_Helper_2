import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { serviceCategories } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";
import { validateBody, createServiceCategorySchema } from "@/lib/api-validation";

import { logger } from "@/lib/logger";
// GET /api/service-categories - List all service categories
export async function GET(request: Request) {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

    const { searchParams } = new URL(request.url);
    const salonId = searchParams.get("salonId");

    logger.info("[ServiceCategories API] GET with params", { salonId });

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

    logger.info(`[ServiceCategories API] Query returned ${result.length} rows`);

    return NextResponse.json({
      success: true,
      data: result,
      count: result.length,
    });
  } catch (error) {
    logger.error("[ServiceCategories API] Database error", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to fetch service categories" },
      { status: 500 }
    );
  }
}

// POST /api/service-categories - Create a new service category
export async function POST(request: Request) {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

    const body = await request.json();
    const validationError = validateBody(createServiceCategorySchema, body);
    if (validationError) {
      return NextResponse.json(validationError, { status: 400 });
    }
    const { salonId, name, sortOrder } = body;

    logger.info(`[ServiceCategories API] Creating category: ${name}`);
    const [newCategory] = await db
      .insert(serviceCategories)
      .values({
        salonId,
        name,
        sortOrder: sortOrder ?? 0,
      })
      .returning();

    logger.info(`[ServiceCategories API] Created category with id: ${newCategory?.id}`);

    return NextResponse.json(
      {
        success: true,
        data: newCategory,
      },
      { status: 201 }
    );
  } catch (error) {
    logger.error("[ServiceCategories API] Database error", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to create service category" },
      { status: 500 }
    );
  }
}
