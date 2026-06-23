import { NextResponse } from "next/server";
import { serviceVariants, services } from "@/lib/schema";
import { eq, and } from "drizzle-orm";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";
import { getUserSalonId } from "@/lib/get-user-salon";
import { validateBody, createServiceVariantSchema } from "@/lib/api-validation";
import { forSalon } from "@/lib/server/repository";

import { logger } from "@/lib/logger";
// GET /api/services/[id]/variants - List all variants for a service
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
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

    const { id } = await params;

    // Weryfikacja własności usługi (jawny eq(salonId)) i odczyt wariantów w jednym
    // kontekście RLS. serviceVariants nie ma salonId — scope idzie przez ownership
    // usługi-rodzica (FK serviceId -> services.salonId) wewnątrz forSalon.
    const { service, variants } = await forSalon(salonId).raw(async (tx) => {
      const [svc] = await tx
        .select()
        .from(services)
        .where(and(eq(services.id, id), eq(services.salonId, salonId)));
      if (!svc) return { service: null, variants: [] };
      const rows = await tx
        .select()
        .from(serviceVariants)
        .where(eq(serviceVariants.serviceId, id));
      return { service: svc, variants: rows };
    });

    if (!service) {
      return NextResponse.json(
        { success: false, error: "Service not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: variants,
      count: variants.length,
    });
  } catch (error) {
    logger.error("[Variants API] Error fetching variants", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to fetch variants" },
      { status: 500 }
    );
  }
}

// POST /api/services/[id]/variants - Create a new variant
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
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

    const { id } = await params;
    const body = await request.json();
    const validationError = validateBody(createServiceVariantSchema, body);
    if (validationError) {
      return NextResponse.json(validationError, { status: 400 });
    }
    const { name, priceModifier, durationModifier } = body;

    // Weryfikacja własności usługi + insert wariantu w jednym kontekście RLS.
    // serviceVariants bez salonId — scope przez ownership usługi (eq salonId) i FK.
    const { service, newVariant } = await forSalon(salonId).raw(async (tx) => {
      const [svc] = await tx
        .select()
        .from(services)
        .where(and(eq(services.id, id), eq(services.salonId, salonId)));
      if (!svc) return { service: null, newVariant: undefined };
      const [variant] = await tx
        .insert(serviceVariants)
        .values({
          serviceId: id,
          name: name.trim(),
          priceModifier: (priceModifier ?? 0).toString(),
          durationModifier: parseInt(durationModifier ?? "0", 10),
        })
        .returning();
      return { service: svc, newVariant: variant };
    });

    if (!service) {
      return NextResponse.json(
        { success: false, error: "Service not found" },
        { status: 404 }
      );
    }

    logger.info(`[Variants API] Created variant "${name}" for service ${id}`);

    return NextResponse.json(
      {
        success: true,
        data: newVariant,
      },
      { status: 201 }
    );
  } catch (error) {
    logger.error("[Variants API] Error creating variant", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to create variant" },
      { status: 500 }
    );
  }
}
