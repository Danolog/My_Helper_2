import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { salonSubscriptions } from "@/lib/schema";

const DEMO_SALON_ID = "00000000-0000-0000-0000-000000000001";

/**
 * POST /api/subscriptions/cancel
 *
 * Cancels the current active subscription for the demo salon.
 * Sets the status to "canceled" and records the cancellation timestamp.
 *
 * In a production environment this would also cancel the Stripe
 * subscription via the Stripe API, but for dev mode it simply
 * updates the database record.
 */
export async function POST() {
  try {
    // Authenticate the user
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) {
      return NextResponse.json(
        { success: false, error: "Wymagane logowanie" },
        { status: 401 },
      );
    }

    // Find the current active subscription
    const [activeSub] = await db
      .select()
      .from(salonSubscriptions)
      .where(
        and(
          eq(salonSubscriptions.salonId, DEMO_SALON_ID),
          eq(salonSubscriptions.status, "active"),
        ),
      );

    if (!activeSub) {
      return NextResponse.json(
        { success: false, error: "Brak aktywnej subskrypcji do anulowania" },
        { status: 404 },
      );
    }

    const now = new Date();

    // Update the subscription status to canceled
    const [updated] = await db
      .update(salonSubscriptions)
      .set({
        status: "canceled",
        canceledAt: now,
      })
      .where(eq(salonSubscriptions.id, activeSub.id))
      .returning();

    if (!updated) {
      return NextResponse.json(
        { success: false, error: "Nie udalo sie anulowac subskrypcji" },
        { status: 500 },
      );
    }

    // eslint-disable-next-line no-console
    console.log(
      `[Subscriptions API] Subscription ${activeSub.id} canceled by user ${session.user.id}`,
    );

    return NextResponse.json({
      success: true,
      message: "Subskrypcja zostala anulowana",
      subscription: {
        id: updated.id,
        status: updated.status,
        canceledAt: updated.canceledAt,
        currentPeriodEnd: updated.currentPeriodEnd,
      },
    });
  } catch (error) {
    console.error("[Subscriptions API] Cancel error:", error);
    return NextResponse.json(
      { success: false, error: "Nie udalo sie anulowac subskrypcji" },
      { status: 500 },
    );
  }
}
