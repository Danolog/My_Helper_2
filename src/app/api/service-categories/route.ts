import { NextResponse } from "next/server";
import { serviceCategories } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";
import { getUserSalonId } from "@/lib/get-user-salon";
import { validateBody, createServiceCategorySchema } from "@/lib/api-validation";
import { forSalon } from "@/lib/server/repository";

import { logger } from "@/lib/logger";
// GET /api/service-categories - List all service categories
export async function GET(_request: Request) {
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

    logger.info("[ServiceCategories API] GET with params", { salonId });

    const result = await forSalon(salonId).raw((tx) =>
      tx
        .select()
        .from(serviceCategories)
        .where(eq(serviceCategories.salonId, salonId))
        .orderBy(serviceCategories.sortOrder)
    );

    logger.info(`[ServiceCategories API] Query returned ${result.length} rows`);

    const response = NextResponse.json({
      success: true,
      data: result,
      count: result.length,
    });
    response.headers.set("Cache-Control", "private, max-age=15, stale-while-revalidate=30");
    return response;
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

    const salonId = await getUserSalonId();
    if (!salonId) {
      return NextResponse.json(
        { success: false, error: "Salon not found" },
        { status: 404 }
      );
    }

    const body = await request.json();
    const validationError = validateBody(createServiceCategorySchema, body);
    if (validationError) {
      return NextResponse.json(validationError, { status: 400 });
    }
    const { name, sortOrder } = body;

    logger.info(`[ServiceCategories API] Creating category: ${name}`);
    const [newCategory] = await forSalon(salonId).raw((tx) =>
      tx
        .insert(serviceCategories)
        .values({
          salonId,
          name,
          sortOrder: sortOrder ?? 0,
        })
        .returning()
    );

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
