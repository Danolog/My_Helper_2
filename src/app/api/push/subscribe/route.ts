import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { pushSubscriptions } from "@/lib/schema";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";
import { validateBody, pushSubscribeSchema } from "@/lib/api-validation";
import { eq, and } from "drizzle-orm";
import { apiRateLimit, getClientIp } from "@/lib/rate-limit";

import { logger } from "@/lib/logger";
/**
 * POST /api/push/subscribe
 *
 * Register a push subscription for the authenticated user.
 * Accepts a PushSubscription object from the browser Push API.
 */
export async function POST(request: Request) {
  const ip = getClientIp(request);
  const rateLimitResult = apiRateLimit.check(ip);
  if (!rateLimitResult.success) {
    return NextResponse.json(
      { success: false, error: "Zbyt wiele żądań. Spróbuj ponownie później." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rateLimitResult.reset / 1000)) } }
    );
  }

  const authResult = await requireAuth();
  if (isAuthError(authResult)) return authResult;
  const { user } = authResult;

  try {
    const body = await request.json();
    const validationError = validateBody(pushSubscribeSchema, body.subscription || {});
    if (validationError) {
      return NextResponse.json(validationError, { status: 400 });
    }
    const { subscription, userAgent } = body;

    // Check if this endpoint already exists for this user
    const existing = await db
      .select()
      .from(pushSubscriptions)
      .where(
        and(
          eq(pushSubscriptions.userId, user.id),
          eq(pushSubscriptions.endpoint, subscription.endpoint)
        )
      );

    const existingRow = existing[0];
    if (existingRow) {
      // Update existing subscription (keys may have changed)
      await db
        .update(pushSubscriptions)
        .set({
          p256dh: subscription.keys.p256dh,
          auth: subscription.keys.auth,
          userAgent: userAgent || null,
        })
        .where(eq(pushSubscriptions.id, existingRow.id));

      logger.info(`[Push] Updated subscription for user ${user.id}`);

      return NextResponse.json({
        success: true,
        data: { id: existingRow.id, updated: true },
      });
    }

    // Create new subscription
    const [sub] = await db
      .insert(pushSubscriptions)
      .values({
        userId: user.id,
        endpoint: subscription.endpoint,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        userAgent: userAgent || null,
      })
      .returning();

    const subId = sub?.id;
    logger.info(`[Push] New subscription registered for user ${user.id}: ${subId}`);

    return NextResponse.json({
      success: true,
      data: { id: subId, created: true },
    });
  } catch (error) {
    logger.error("[Push Subscribe] Error", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to register push subscription" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/push/subscribe
 *
 * Check if the current user has any push subscriptions registered.
 */
export async function GET() {
  const authResult = await requireAuth();
  if (isAuthError(authResult)) return authResult;
  const { user } = authResult;

  try {
    const subs = await db
      .select({
        id: pushSubscriptions.id,
        endpoint: pushSubscriptions.endpoint,
        userAgent: pushSubscriptions.userAgent,
        createdAt: pushSubscriptions.createdAt,
      })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, user.id));

    return NextResponse.json({
      success: true,
      data: {
        subscriptions: subs,
        count: subs.length,
        isSubscribed: subs.length > 0,
      },
    });
  } catch (error) {
    logger.error("[Push Subscribe] Error", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to check push subscriptions" },
      { status: 500 }
    );
  }
}
