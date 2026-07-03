import { eq } from "drizzle-orm";
import { resolveModules, type ModulesState } from "@/lib/features";
import { logger } from "@/lib/logger";
import { salons } from "@/lib/schema";
import { forSalon } from "@/lib/server/repository";

/**
 * Stan modułów salonu (feature flags) — do użycia w layoutach/stronach
 * serwerowych. Czyta `salons.settingsJson.modules` przez warstwę forSalon
 * (salons: tabela nadrzędna — filtr jawny po id = salonId).
 *
 * Błąd odczytu nie może wywrócić dashboardu — zwracamy wtedy stan domyślny
 * (chudy interfejs).
 */
export async function getSalonModules(salonId: string): Promise<ModulesState> {
  try {
    const [salon] = await forSalon(salonId).raw((tx) =>
      tx
        .select({ settingsJson: salons.settingsJson })
        .from(salons)
        .where(eq(salons.id, salonId))
        .limit(1)
    );
    return resolveModules(salon?.settingsJson ?? null);
  } catch (error) {
    logger.error("[Modules] Failed to read salon modules — falling back to defaults", {
      error,
      salonId,
    });
    return resolveModules(null);
  }
}
