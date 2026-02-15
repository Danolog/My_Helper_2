import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { loyaltyPoints, loyaltyTransactions, salons } from "@/lib/schema";
import { eq, and } from "drizzle-orm";
import type { LoyaltySettings, RewardTier } from "@/app/api/salons/[id]/loyalty-settings/route";

const DEMO_SALON_ID = "00000000-0000-0000-0000-000000000001";

/**
 * POST /api/clients/[id]/loyalty/redeem
 *
 * Redeem loyalty points for a reward.
 * Body:
 *   - rewardTierId: string (the ID of the reward tier to redeem)
 *   - salonId: string (optional, defaults to DEMO_SALON_ID)
 *
 * Steps:
 *   1. Validate the salon's loyalty settings and find the reward tier
 *   2. Check the client has enough points
 *   3. Deduct points from their balance
 *   4. Create a transaction record with negative points
 *   5. Return the updated balance and redemption details
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: clientId } = await params;
    const body = await request.json();
    const { rewardTierId, salonId: requestedSalonId } = body;

    const salonId = requestedSalonId || DEMO_SALON_ID;

    if (!rewardTierId) {
      return NextResponse.json(
        { success: false, error: "Nie podano ID nagrody" },
        { status: 400 }
      );
    }

    // 1. Fetch salon loyalty settings and find the reward tier
    const [salon] = await db
      .select({ id: salons.id, settingsJson: salons.settingsJson })
      .from(salons)
      .where(eq(salons.id, salonId))
      .limit(1);

    if (!salon) {
      return NextResponse.json(
        { success: false, error: "Salon nie znaleziony" },
        { status: 404 }
      );
    }

    const settings = salon.settingsJson as Record<string, unknown> | null;
    const loyaltySettings = settings?.loyalty as LoyaltySettings | undefined;

    if (!loyaltySettings?.enabled) {
      return NextResponse.json(
        { success: false, error: "Program lojalnosciowy nie jest aktywny" },
        { status: 400 }
      );
    }

    // Find the reward tier
    const rewardTier: RewardTier | undefined = loyaltySettings.rewardTiers?.find(
      (tier) => tier.id === rewardTierId
    );

    if (!rewardTier) {
      return NextResponse.json(
        { success: false, error: "Nie znaleziono nagrody o podanym ID" },
        { status: 404 }
      );
    }

    // 2. Check client has enough points
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
      return NextResponse.json(
        {
          success: false,
          error: `Niewystarczajaca liczba punktow. Wymagane: ${rewardTier.pointsRequired}, dostepne: 0`,
        },
        { status: 400 }
      );
    }

    if (loyaltyRecord.points < rewardTier.pointsRequired) {
      return NextResponse.json(
        {
          success: false,
          error: `Niewystarczajaca liczba punktow. Wymagane: ${rewardTier.pointsRequired}, dostepne: ${loyaltyRecord.points}`,
        },
        { status: 400 }
      );
    }

    // 3. Deduct points from balance
    const newBalance = loyaltyRecord.points - rewardTier.pointsRequired;

    await db
      .update(loyaltyPoints)
      .set({
        points: newBalance,
        lastUpdated: new Date(),
      })
      .where(eq(loyaltyPoints.id, loyaltyRecord.id));

    // 4. Create transaction record
    const rewardTypeLabel =
      rewardTier.rewardType === "discount"
        ? `Rabat ${rewardTier.rewardValue}%`
        : rewardTier.rewardType === "free_service"
          ? `Darmowa usluga do ${rewardTier.rewardValue} PLN`
          : `Produkt gratis do ${rewardTier.rewardValue} PLN`;

    const transactionResult = await db
      .insert(loyaltyTransactions)
      .values({
        loyaltyId: loyaltyRecord.id,
        pointsChange: -rewardTier.pointsRequired,
        reason: `Wymiana punktow: ${rewardTier.name} (${rewardTypeLabel})`,
        appointmentId: null,
      })
      .returning();

    const transaction = transactionResult[0];
    if (!transaction) {
      throw new Error("Failed to create redemption transaction");
    }

    console.log(
      `[Loyalty Redeem] Client ${clientId} redeemed "${rewardTier.name}" for ${rewardTier.pointsRequired} points. Balance: ${loyaltyRecord.points} -> ${newBalance}`
    );

    // 5. Return success with details
    return NextResponse.json({
      success: true,
      data: {
        redemption: {
          rewardTierId: rewardTier.id,
          rewardName: rewardTier.name,
          rewardType: rewardTier.rewardType,
          rewardValue: rewardTier.rewardValue,
          pointsSpent: rewardTier.pointsRequired,
          transactionId: transaction.id,
        },
        balance: {
          previousPoints: loyaltyRecord.points,
          currentPoints: newBalance,
        },
      },
      message: `Nagroda "${rewardTier.name}" zostala zrealizowana! Wykorzystano ${rewardTier.pointsRequired} punktow.`,
    });
  } catch (error) {
    console.error("[Loyalty Redeem API] Error:", error);
    return NextResponse.json(
      { success: false, error: "Blad podczas realizacji nagrody" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/clients/[id]/loyalty/redeem
 *
 * Returns available rewards for redemption based on client's current points.
 * Query params:
 *   - salonId (optional, defaults to DEMO_SALON_ID)
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: clientId } = await params;
    const { searchParams } = new URL(request.url);
    const salonId = searchParams.get("salonId") || DEMO_SALON_ID;

    // 1. Fetch salon loyalty settings
    const [salon] = await db
      .select({ id: salons.id, settingsJson: salons.settingsJson })
      .from(salons)
      .where(eq(salons.id, salonId))
      .limit(1);

    if (!salon) {
      return NextResponse.json(
        { success: false, error: "Salon nie znaleziony" },
        { status: 404 }
      );
    }

    const settings = salon.settingsJson as Record<string, unknown> | null;
    const loyaltySettings = settings?.loyalty as LoyaltySettings | undefined;

    if (!loyaltySettings?.enabled) {
      return NextResponse.json({
        success: true,
        data: {
          enabled: false,
          points: 0,
          availableRewards: [],
          allRewards: [],
        },
      });
    }

    // 2. Get client's current points
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

    const currentPoints = loyaltyRecord?.points ?? 0;

    // 3. Build rewards lists
    const allRewards = (loyaltySettings.rewardTiers || [])
      .map((tier) => ({
        ...tier,
        canRedeem: currentPoints >= tier.pointsRequired,
        pointsNeeded: Math.max(0, tier.pointsRequired - currentPoints),
      }))
      .sort((a, b) => a.pointsRequired - b.pointsRequired);

    const availableRewards = allRewards.filter((r) => r.canRedeem);

    return NextResponse.json({
      success: true,
      data: {
        enabled: true,
        points: currentPoints,
        availableRewards,
        allRewards,
      },
    });
  } catch (error) {
    console.error("[Loyalty Redeem API] GET Error:", error);
    return NextResponse.json(
      { success: false, error: "Blad podczas pobierania nagrod" },
      { status: 500 }
    );
  }
}
