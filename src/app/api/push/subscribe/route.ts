import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import { pushSubscriptions } from "@/lib/schema";
import { auth } from "@/lib/auth";
import { eq, and } from "drizzle-orm";

/**
 * POST /api/push/subscribe
 *
 * Register a push subscription for the authenticated user.
 * Accepts a PushSubscription object from the browser Push API.
 */
export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { subscription, userAgent } = body;

    if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
      return NextResponse.json(
        { success: false, error: "Invalid push subscription data" },
        { status: 400 }
      );
    }

    // Check if this endpoint already exists for this user
    const existing = await db
      .select()
      .from(pushSubscriptions)
      .where(
        and(
          eq(pushSubscriptions.userId, session.user.id),
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

      console.log(`[Push] Updated subscription for user ${session.user.id}`);

      return NextResponse.json({
        success: true,
        data: { id: existingRow.id, updated: true },
      });
    }

    // Create new subscription
    const [sub] = await db
      .insert(pushSubscriptions)
      .values({
        userId: session.user.id,
        endpoint: subscription.endpoint,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        userAgent: userAgent || null,
      })
      .returning();

    const subId = sub?.id;
    console.log(`[Push] New subscription registered for user ${session.user.id}: ${subId}`);

    return NextResponse.json({
      success: true,
      data: { id: subId, created: true },
    });
  } catch (error) {
    console.error("[Push Subscribe] Error:", error);
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
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const subs = await db
      .select({
        id: pushSubscriptions.id,
        endpoint: pushSubscriptions.endpoint,
        userAgent: pushSubscriptions.userAgent,
        createdAt: pushSubscriptions.createdAt,
      })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, session.user.id));

    return NextResponse.json({
      success: true,
      data: {
        subscriptions: subs,
        count: subs.length,
        isSubscribed: subs.length > 0,
      },
    });
  } catch (error) {
    console.error("[Push Subscribe] Error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to check push subscriptions" },
      { status: 500 }
    );
  }
}
