import { NextResponse } from "next/server";
// eslint-disable-next-line no-restricted-imports -- kontekst klienta (scope po userId z sesji)
import { db } from "@/lib/db";
import { favoriteSalons } from "@/lib/schema";
import { eq, and } from "drizzle-orm";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";

import { logger } from "@/lib/logger";

/**
 * Kontekst KLIENTA — surowy `db`, NIE `forSalon` (ADR-001 sekcja 4 / R2).
 * Sprawdzenie czy salon jest w ulubionych użytkownika: filtr po
 * `eq(favoriteSalons.clientUserId, userId)` z SESJI. Zakres wielo-salonowy —
 * kontekst właściciela (forSalon) nie pasuje.
 */
// GET /api/favorites/salons/check?salonId=<uuid> - Check if salon is in favorites
export async function GET(request: Request) {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

    const userId = authResult.user.id;
    const { searchParams } = new URL(request.url);
    const salonId = searchParams.get("salonId");

    if (!salonId) {
      return NextResponse.json(
        { success: false, error: "salonId query parameter is required" },
        { status: 400 }
      );
    }

    const [existing] = await db
      .select()
      .from(favoriteSalons)
      .where(
        and(
          eq(favoriteSalons.clientUserId, userId),
          eq(favoriteSalons.salonId, salonId)
        )
      );

    return NextResponse.json({
      success: true,
      isFavorite: !!existing,
    });
  } catch (error) {
    logger.error("[Favorites Check API] Error", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to check favorite status" },
      { status: 500 }
    );
  }
}
