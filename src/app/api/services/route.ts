import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { services, serviceCategories } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { validateBody, createServiceSchema } from "@/lib/api-validation";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";

import { logger } from "@/lib/logger";
// GET /api/services - List all services
export async function GET(request: Request) {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

    const { searchParams } = new URL(request.url);
    const salonId = searchParams.get("salonId");
    const activeOnly = searchParams.get("activeOnly") === "true";

    logger.info("[Services API] GET with params", { salonId, activeOnly });

    let query = db.select({
      service: services,
      category: serviceCategories,
    })
    .from(services)
    .leftJoin(serviceCategories, eq(services.categoryId, serviceCategories.id));

    if (salonId) {
      query = query.where(eq(services.salonId, salonId)) as typeof query;
    }
    if (activeOnly) {
      query = query.where(eq(services.isActive, true)) as typeof query;
    }

    const result = await query;
    logger.info(`[Services API] Query returned ${result.length} rows`);

    const formattedServices = result.map((row) => ({
      ...row.service,
      category: row.category,
    }));

    return NextResponse.json({
      success: true,
      data: formattedServices,
      count: formattedServices.length,
    });
  } catch (error) {
    logger.error("[Services API] Database error", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to fetch services" },
      { status: 500 }
    );
  }
}

// POST /api/services - Create a new service
export async function POST(request: Request) {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

    const body = await request.json();

    // Server-side validation with Zod schema
    const validationError = validateBody(createServiceSchema, body);
    if (validationError) {
      return NextResponse.json(validationError, { status: 400 });
    }

    const { salonId, categoryId, name, description, basePrice, baseDuration } = body;
    const parsedPrice = parseFloat(basePrice);
    const parsedDuration = parseInt(baseDuration, 10);

    logger.info(`[Services API] Creating service: ${name}`);
    const [newService] = await db
      .insert(services)
      .values({
        salonId,
        categoryId: categoryId || null,
        name,
        description: description || null,
        basePrice: parsedPrice.toString(),
        baseDuration: parsedDuration,
        isActive: true,
      })
      .returning();

    logger.info(`[Services API] Created service with id: ${newService?.id}`);

    return NextResponse.json({
      success: true,
      data: newService,
    }, { status: 201 });
  } catch (error) {
    logger.error("[Services API] Database error", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to create service" },
      { status: 500 }
    );
  }
}
