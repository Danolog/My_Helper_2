import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { loyaltyPoints, loyaltyTransactions } from "@/lib/schema";
import { eq, and, desc } from "drizzle-orm";

const DEMO_SALON_ID = "00000000-0000-0000-0000-000000000001";

/**
 * GET /api/clients/[id]/loyalty
 *
 * Returns the loyalty points balance and transaction history for a client.
 * Query params:
 *   - salonId (optional, defaults to DEMO_SALON_ID)
 *   - limit (optional, defaults to 50)
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: clientId } = await params;
    const { searchParams } = new URL(request.url);
    const salonId = searchParams.get("salonId") || DEMO_SALON_ID;
    const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 100);

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
