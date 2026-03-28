import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";
import { db } from "@/lib/db";
import { salons } from "@/lib/schema";

import { logger } from "@/lib/logger";
/**
 * GET /api/salons/mine
 *
 * Returns the salon owned by the currently authenticated user.
 * Looks up salons where ownerId matches the session user's ID.
 *
 * Response shape:
 *   { success: true, salon: { id, name, ... } }    -- salon found
 *   { success: true, salon: null }                  -- no salon for this user
 *   { success: false, error: "..." }                -- auth or server error
 */
export async function GET() {
  const authResult = await requireAuth();
  if (isAuthError(authResult)) return authResult;

  try {
    const [salon] = await db
      .select({
        id: salons.id,
        name: salons.name,
        phone: salons.phone,
        email: salons.email,
        address: salons.address,
        industryType: salons.industryType,
      })
      .from(salons)
      .where(eq(salons.ownerId, authResult.user.id))
      .limit(1);

    return NextResponse.json({
      success: true,
      salon: salon ?? null,
    });
  } catch (error) {
    logger.error("[Salons Mine API] Error", { error: error });
    return NextResponse.json(
      { success: false, error: "Nie udalo sie pobrac salonu" },
      { status: 500 },
    );
  }
}
