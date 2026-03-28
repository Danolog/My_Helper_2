import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";
import {
  hasTemporaryAccess,
  getActiveTemporaryAccess,
} from "@/lib/temporary-access";

import { logger } from "@/lib/logger";
/**
 * GET /api/temporary-access/check
 *
 * Check if the currently authenticated user has temporary access to a feature.
 * This endpoint enforces expiration: only grants with expiresAt > now are considered active.
 *
 * Query params:
 *   featureName (optional) - Check access for a specific feature. If omitted, returns all active grants.
 *
 * Returns:
 *   { success: true, hasAccess: boolean, grants: [...] }
 */
export async function GET(request: Request) {
  const authResult = await requireAuth();
  if (isAuthError(authResult)) return authResult;

  try {
    const { searchParams } = new URL(request.url);
    const featureName = searchParams.get("featureName");

    if (featureName) {
      // Check specific feature access
      const access = await hasTemporaryAccess(authResult.user.id, featureName);

      return NextResponse.json({
        success: true,
        hasAccess: access,
        featureName,
      });
    }

    // Return all active grants for the user
    const grants = await getActiveTemporaryAccess(authResult.user.id);

    return NextResponse.json({
      success: true,
      grants,
      count: grants.length,
    });
  } catch (error) {
    logger.error("[Temporary Access Check] Error", { error: error });
    return NextResponse.json(
      { success: false, error: "Nie udało się sprawdzić uprawnień tymczasowych" },
      { status: 500 }
    );
  }
}
