import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { loyaltyPoints, loyaltyTransactions } from "@/lib/schema";
import { eq, and, desc } from "drizzle-orm";
import { getUserSalonId } from "@/lib/get-user-salon";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";

/**
 * GET /api/clients/[id]/loyalty
 *
 * Returns the loyalty points balance and transaction history for a client.
 * Uses the authenticated user's salon.
 * Query params:
 *   - limit (optional, defaults to 50)
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

    const { id: clientId } = await params;
    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 100);

    const salonId = await getUserSalonId();
    if (!salonId) {
      return NextResponse.json(
        { success: false, error: "Salon not found" },
        { status: 404 }
      );
    }

    // Get loyalty points record
    const [loyaltyRecord] = await db
      .select()
      .from(loyaltyPoints)
      .where(
        and(
          eq(loyaltyPoints.clientId, clientId),
          eq(loyaltyPoints.salonId, salonId)
        )
      )
      .limit(1);

    if (!loyaltyRecord) {
      return NextResponse.json({
        success: true,
        data: {
          clientId,
          salonId,
          points: 0,
          loyaltyId: null,
          transactions: [],
          lastUpdated: null,
        },
      });
    }

    // Get transaction history
    const transactions = await db
      .select()
      .from(loyaltyTransactions)
      .where(eq(loyaltyTransactions.loyaltyId, loyaltyRecord.id))
      .orderBy(desc(loyaltyTransactions.createdAt))
      .limit(limit);

    return NextResponse.json({
      success: true,
      data: {
        clientId,
        salonId,
        points: loyaltyRecord.points,
        loyaltyId: loyaltyRecord.id,
        transactions: transactions.map((t) => ({
          id: t.id,
          pointsChange: t.pointsChange,
          reason: t.reason,
          appointmentId: t.appointmentId,
          createdAt: t.createdAt.toISOString(),
        })),
        lastUpdated: loyaltyRecord.lastUpdated.toISOString(),
      },
    });
  } catch (error) {
    console.error("[Client Loyalty API] GET error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch loyalty data" },
      { status: 500 }
    );
  }
}
