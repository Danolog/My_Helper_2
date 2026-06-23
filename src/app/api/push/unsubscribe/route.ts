import { NextResponse } from "next/server";
// pushSubscriptions jest kluczowane userId (NIE salonId) — zasób per-USER, nie
// per-salon. Trasa NIE migruje na forSalon: brak kolumny salon_id do zawężenia.
// Pozostaje na surowym db, scope przez eq(userId) z sesji. (R2)
import { db } from "@/lib/db";
import { pushSubscriptions } from "@/lib/schema";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";
import { validateBody, pushUnsubscribeSchema } from "@/lib/api-validation";
import { eq, and } from "drizzle-orm";

import { logger } from "@/lib/logger";
/**
 * POST /api/push/unsubscribe
 *
 * Remove a push subscription for the authenticated user.
 */
export async function POST(request: Request) {
  const authResult = await requireAuth();
  if (isAuthError(authResult)) return authResult;
  const { user } = authResult;

  try {
    const body = await request.json();
    const validationError = validateBody(pushUnsubscribeSchema, body);
    if (validationError) {
      return NextResponse.json(validationError, { status: 400 });
    }
    const { endpoint } = body;

    const deleted = await db
      .delete(pushSubscriptions)
      .where(
        and(
          eq(pushSubscriptions.userId, user.id),
          eq(pushSubscriptions.endpoint, endpoint)
        )
      )
      .returning();

    logger.info(`[Push] Unsubscribed ${deleted.length} subscription(s) for user ${user.id}`);

    return NextResponse.json({
      success: true,
      data: { removed: deleted.length },
    });
  } catch (error) {
    logger.error("[Push Unsubscribe] Error", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to unsubscribe" },
      { status: 500 }
    );
  }
}
