import { NextResponse } from "next/server";
import { services, serviceCategories } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { validateBody, createServiceSchema } from "@/lib/api-validation";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";
import { getUserSalonId } from "@/lib/get-user-salon";
import { apiRateLimit, getClientIp } from "@/lib/rate-limit";
import { forSalon } from "@/lib/server/repository";

import { logger } from "@/lib/logger";
// GET /api/services - List all services
export async function GET(request: Request) {
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

    const { searchParams } = new URL(request.url);
    const activeOnly = searchParams.get("activeOnly") === "true";

    logger.info("[Services API] GET with params", { salonId, activeOnly });

    // Join — przez raw(tx) z jawnym eq(salonId) (defense in depth: filtr
    // aplikacyjny widoczny, plus kontekst RLS ustawiony przez forSalon).
    const result = await forSalon(salonId).raw(async (tx) => {
      let query = tx.select({
        service: services,
        category: serviceCategories,
      })
      .from(services)
      .leftJoin(serviceCategories, eq(services.categoryId, serviceCategories.id));

      query = query.where(eq(services.salonId, salonId)) as typeof query;
      if (activeOnly) {
        query = query.where(eq(services.isActive, true)) as typeof query;
      }

      return query;
    });
    logger.info(`[Services API] Query returned ${result.length} rows`);

    const formattedServices = result.map((row) => ({
      ...row.service,
      category: row.category,
    }));

    const response = NextResponse.json({
      success: true,
      data: formattedServices,
      count: formattedServices.length,
    });
    response.headers.set("Cache-Control", "private, max-age=15, stale-while-revalidate=30");
    return response;
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
    const ip = getClientIp(request);
    const rateLimitResult = apiRateLimit.check(ip);
    if (!rateLimitResult.success) {
      return NextResponse.json(
        { success: false, error: "Zbyt wiele żądań. Spróbuj ponownie później." },
        { status: 429, headers: { "Retry-After": String(Math.ceil(rateLimitResult.reset / 1000)) } }
      );
    }

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

    // Server-side validation with Zod schema
    const validationError = validateBody(createServiceSchema, body);
    if (validationError) {
      return NextResponse.json(validationError, { status: 400 });
    }

    const { categoryId, name, description, basePrice, baseDuration } = body;
    const parsedPrice = parseFloat(basePrice);
    const parsedDuration = parseInt(baseDuration, 10);

    logger.info(`[Services API] Creating service: ${name}`);
    const [newService] = await forSalon(salonId).raw((tx) =>
      tx
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
      .returning()
    );

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
