import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { pushSubscriptions } from "@/lib/schema";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";
import { eq, and } from "drizzle-orm";

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
    const { endpoint } = body;

    if (!endpoint) {
      return NextResponse.json(
        { success: false, error: "Endpoint is required" },
        { status: 400 }
      );
    }

    const deleted = await db
      .delete(pushSubscriptions)
      .where(
        and(
          eq(pushSubscriptions.userId, user.id),
          eq(pushSubscriptions.endpoint, endpoint)
        )
      )
      .returning();

    console.log(
      `[Push] Unsubscribed ${deleted.length} subscription(s) for user ${user.id}`
    );

    return NextResponse.json({
      success: true,
      data: { removed: deleted.length },
    });
  } catch (error) {
    console.error("[Push Unsubscribe] Error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to unsubscribe" },
      { status: 500 }
    );
  }
}
