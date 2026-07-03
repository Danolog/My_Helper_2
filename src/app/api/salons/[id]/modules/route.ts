import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { validateBody, salonModulesSchema } from "@/lib/api-validation";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";
import { resolveModules, TOGGLEABLE_MODULES, type ModuleKey } from "@/lib/features";
import { logger } from "@/lib/logger";
import { salons } from "@/lib/schema";
import { forSalon } from "@/lib/server/repository";

/**
 * GET /api/salons/[id]/modules
 *
 * Zwraca rozwiązany stan modułów salonu (feature flags, Faza 2).
 * Defaults + zapis z `salons.settingsJson.modules`; hardOff zawsze false.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

    const { id } = await params;

    const [salon] = await forSalon(id).raw((tx) =>
      tx
        .select({ id: salons.id, ownerId: salons.ownerId, settingsJson: salons.settingsJson })
        .from(salons)
        .where(eq(salons.id, id))
        .limit(1)
    );

    if (!salon) {
      return NextResponse.json(
        { success: false, error: "Salon not found" },
        { status: 404 }
      );
    }

    if (salon.ownerId !== authResult.user.id) {
      return NextResponse.json(
        { success: false, error: "Brak uprawnien" },
        { status: 403 }
      );
    }

    return NextResponse.json({
      success: true,
      data: resolveModules(salon.settingsJson),
    });
  } catch (error) {
    logger.error("[Modules API] GET Error", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to fetch salon modules" },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/salons/[id]/modules
 *
 * Zapisuje przełączniki modułów do `salons.settingsJson.modules`.
 * Body: { modules: Record<ModuleKey, boolean> } — klucze spoza listy
 * przełączalnych modułów (w tym hardOff) są ignorowane.
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

    const { id } = await params;
    const body = await request.json();

    const validationError = validateBody(salonModulesSchema, body);
    if (validationError) {
      return NextResponse.json(validationError, { status: 400 });
    }

    const [salon] = await forSalon(id).raw((tx) =>
      tx
        .select({ id: salons.id, ownerId: salons.ownerId, settingsJson: salons.settingsJson })
        .from(salons)
        .where(eq(salons.id, id))
        .limit(1)
    );

    if (!salon) {
      return NextResponse.json(
        { success: false, error: "Salon not found" },
        { status: 404 }
      );
    }

    if (salon.ownerId !== authResult.user.id) {
      return NextResponse.json(
        { success: false, error: "Brak uprawnien" },
        { status: 403 }
      );
    }

    // Tylko znane, przełączalne moduły — reszta wejścia jest ignorowana.
    const requested = (body as { modules: Record<string, boolean> }).modules;
    const existingSettings = (salon.settingsJson as Record<string, unknown>) || {};
    const existingModules =
      (existingSettings.modules as Partial<Record<ModuleKey, boolean>>) || {};

    const nextModules: Partial<Record<ModuleKey, boolean>> = { ...existingModules };
    for (const mod of TOGGLEABLE_MODULES) {
      const value = requested[mod.key];
      if (typeof value === "boolean") {
        nextModules[mod.key] = value;
      }
    }

    const updatedSettings = { ...existingSettings, modules: nextModules };

    // salons: tabela nadrzędna — filtr jawny po id = salonId.
    await forSalon(id).raw((tx) =>
      tx
        .update(salons)
        .set({ settingsJson: updatedSettings })
        .where(eq(salons.id, id))
        .returning()
    );

    const resolved = resolveModules(updatedSettings);
    logger.info(`[Modules API] Updated modules for salon ${id}`, {
      modules: nextModules as Record<string, unknown>,
    });

    return NextResponse.json({
      success: true,
      data: resolved,
      message: "Ustawienia modulow zostaly zapisane",
    });
  } catch (error) {
    logger.error("[Modules API] PUT Error", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to update salon modules" },
      { status: 500 }
    );
  }
}
