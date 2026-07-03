import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { withApiHandler } from "@/lib/api-handler";
import { createServiceSchema } from "@/lib/api-validation";
import { getUserSalonId } from "@/lib/get-user-salon";
import { logger } from "@/lib/logger";
import { apiRateLimit } from "@/lib/rate-limit";
import { services, serviceCategories } from "@/lib/schema";
import { forSalon } from "@/lib/server/repository";
import type { z } from "zod";

// GET /api/services - List all services
export const GET = withApiHandler(
  {
    auth: "user",
    logLabel: "[Services API] GET",
    errorMessage: "Failed to fetch services",
  },
  async ({ request }) => {
    const { searchParams } = new URL(request.url);
    // Brak salonId w query => salon zalogowanego użytkownika (dawna gałąź
    // "lista bez zawężenia" była wyciekiem cross-salon).
    const salonId = searchParams.get("salonId") || (await getUserSalonId());
    const activeOnly = searchParams.get("activeOnly") === "true";

    if (!salonId) {
      return NextResponse.json(
        { success: false, error: "Salon not found" },
        { status: 404 }
      );
    }

    logger.info("[Services API] GET with params", { salonId, activeOnly });

    // Zapytanie z joinem — przez forSalon().raw() z jawnym eq(services.salonId).
    // Warunki złożone przez and() — drugie .where() nadpisywałoby filtr salonu.
    const result = await forSalon(salonId).raw((tx) =>
      tx.select({
        service: services,
        category: serviceCategories,
      })
      .from(services)
      .leftJoin(serviceCategories, eq(services.categoryId, serviceCategories.id))
      .where(
        activeOnly
          ? and(eq(services.salonId, salonId), eq(services.isActive, true))
          : eq(services.salonId, salonId)
      )
    );
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
  }
);

// POST /api/services - Create a new service
export const POST = withApiHandler(
  {
    auth: "user",
    rateLimit: apiRateLimit,
    schema: createServiceSchema as z.ZodType<{
      salonId: string;
      categoryId?: string | null;
      name: string;
      description?: string | null;
      basePrice: string | number;
      baseDuration: string | number;
    }>,
    logLabel: "[Services API] POST",
    errorMessage: "Failed to create service",
  },
  async ({ body }) => {
    const { salonId, categoryId, name, description, basePrice, baseDuration } = body;
    const parsedPrice = parseFloat(basePrice as string);
    const parsedDuration = parseInt(baseDuration as string, 10);

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
  }
);
