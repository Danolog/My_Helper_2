import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { withApiHandler } from "@/lib/api-handler";
import { createServiceCategorySchema } from "@/lib/api-validation";
import { logger } from "@/lib/logger";
import { requireSalonStaff } from "@/lib/salon-context";
import { serviceCategories } from "@/lib/schema";
import { forSalon } from "@/lib/server/repository";
import { isValidUuid } from "@/lib/validations";
import type { z } from "zod";

// GET /api/service-categories - List service categories for a salon
export const GET = withApiHandler(
  {
    auth: "user",
    logLabel: "[ServiceCategories API] GET",
    errorMessage: "Failed to fetch service categories",
  },
  async ({ request }) => {
    const { searchParams } = new URL(request.url);
    // #94 (jak #82 w /api/services): salon WYŁĄCZNIE z sesji. Wcześniej salonId
    // z query szedł prosto do forSalon(), więc każde zalogowane konto czytało
    // kategorie dowolnego salonu. salonId z query jest tylko porównywany
    // (inny => 403). Role: domyślne requireSalonStaff (właściciel, recepcja,
    // pracownik), bo lista kategorii jest częścią podglądu usług.
    const requestedSalonId = searchParams.get("salonId")?.trim() || null;
    if (requestedSalonId !== null && !isValidUuid(requestedSalonId)) {
      return NextResponse.json(
        { success: false, error: "Invalid salon ID format" },
        { status: 400 }
      );
    }

    const guard = await requireSalonStaff({ requestedSalonId });
    if (guard.error) return guard.error;
    const salonId = guard.ctx.salonId;

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
    // Bez max-age/SWR: cache przegladarki lamal read-after-write w panelu
    // (lista o 1 w tyle po dodaniu — UAT B-6)
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
);

// POST /api/service-categories - Create a new service category
export const POST = withApiHandler(
  {
    auth: "user",
    schema: createServiceCategorySchema as z.ZodType<{
      salonId: string;
      name: string;
      sortOrder?: number;
    }>,
    logLabel: "[ServiceCategories API] POST",
    errorMessage: "Failed to create service category",
  },
  async ({ body }) => {
    // P1 (przegląd Ryana): salon WYŁĄCZNIE z sesji — wcześniej forSalon(body.salonId)
    // pozwalał każdemu zalogowanemu kontu dodać kategorię w cudzym salonie.
    // body.salonId tylko porównywany (inny => 403). Tylko właściciel — jak
    // PUT/DELETE /api/service-categories/[id].
    const guard = await requireSalonStaff({ roles: [], requestedSalonId: body.salonId });
    if (guard.error) return guard.error;
    const salonId = guard.ctx.salonId;

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
  }
);
