import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { withApiHandler } from "@/lib/api-handler";
import { createServiceSchema } from "@/lib/api-validation";
import { logger } from "@/lib/logger";
import { apiRateLimit } from "@/lib/rate-limit";
import { requireSalonStaff } from "@/lib/salon-context";
import { services, serviceCategories } from "@/lib/schema";
import { forSalon } from "@/lib/server/repository";
import { isValidUuid } from "@/lib/validations";
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
    // #73: salon WYŁĄCZNIE z sesji. Wcześniej salonId z query szedł prosto do
    // forSalon(), więc każde zalogowane konto (także klient portalu) czytało
    // pełną listę usług dowolnego salonu, z nieaktywnymi włącznie. salonId
    // z query jest tylko porównywany (inny => 403), jak w POST.
    // Faza 3 (role): domyślne role requireSalonStaff to recepcja i pracownik
    // (podgląd kalendarza), właściciel zawsze; mutacje zostają owner-only.
    const requestedSalonId = searchParams.get("salonId")?.trim() || null;
    const activeOnly = searchParams.get("activeOnly") === "true";

    // #73: "null"/"undefined" z panelu dawały 500 (22P02) zamiast 400.
    if (requestedSalonId !== null && !isValidUuid(requestedSalonId)) {
      return NextResponse.json(
        { success: false, error: "Invalid salon ID format" },
        { status: 400 }
      );
    }

    const guard = await requireSalonStaff({ requestedSalonId });
    if (guard.error) return guard.error;
    const salonId = guard.ctx.salonId;

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
    // Bez max-age/SWR: cache przegladarki lamal read-after-write w panelu
    // (lista uslug o 1 w tyle po dodaniu — UAT B-6)
    response.headers.set("Cache-Control", "private, no-store");
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
    // P1 (przegląd bezpieczeństwa): salon WYŁĄCZNIE z sesji — wcześniej forSalon(body.salonId)
    // pozwalał każdemu zalogowanemu kontu dodać usługę (z ceną) do cudzego salonu.
    // body.salonId tylko porównywany (inny => 403). Tworzenie usług: tylko
    // właściciel, bez grantów — jak PUT/DELETE /api/services/[id].
    const guard = await requireSalonStaff({ roles: [], requestedSalonId: body.salonId });
    if (guard.error) return guard.error;
    const salonId = guard.ctx.salonId;

    const { categoryId, name, description, basePrice, baseDuration } = body;
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
