import { NextResponse } from "next/server";
import { loyaltyPoints, loyaltyTransactions, salons } from "@/lib/schema";
import { eq, and } from "drizzle-orm";
import type { LoyaltySettings, RewardTier } from "@/app/api/salons/[id]/loyalty-settings/route";
import { getUserSalonId } from "@/lib/get-user-salon";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";
import { validateBody, loyaltyRedeemSchema } from "@/lib/api-validation";
import { forSalon } from "@/lib/server/repository";

import { logger } from "@/lib/logger";
/**
 * POST /api/clients/[id]/loyalty/redeem
 *
 * Redeem loyalty points for a reward.
 * Body:
 *   - rewardTierId: string (the ID of the reward tier to redeem)
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
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

    const { id: clientId } = await params;
    const body = await request.json();
    const validationError = validateBody(loyaltyRedeemSchema, body);
    if (validationError) {
      return NextResponse.json(validationError, { status: 400 });
    }
    const { rewardTierId } = body;

    const salonId = await getUserSalonId();
    if (!salonId) {
      return NextResponse.json(
        { success: false, error: "Salon not found" },
        { status: 404 }
      );
    }

    // Cała transakcja (odczyt salonu + ustawień, odczyt punktów, update salda,
    // insert transakcji) atomowo w jednym kontekście RLS. loyaltyPoints ma salonId
    // (jawny eq zachowany); loyaltyTransactions bez salonId — scope przez FK loyaltyId.
    // Wieloetapowość w jednym raw() = atomowość (brak częściowego odjęcia punktów).
    const outcome = await forSalon(salonId).raw(async (tx) => {
      // 1. Fetch salon loyalty settings and find the reward tier
      const [salon] = await tx
        .select({ id: salons.id, settingsJson: salons.settingsJson })
        .from(salons)
        .where(eq(salons.id, salonId))
        .limit(1);

      if (!salon) {
        return { kind: "no-salon" as const };
      }

      const settings = salon.settingsJson as Record<string, unknown> | null;
      const loyaltySettings = settings?.loyalty as LoyaltySettings | undefined;

      if (!loyaltySettings?.enabled) {
        return { kind: "not-active" as const };
      }

      // Find the reward tier
      const rewardTier: RewardTier | undefined = loyaltySettings.rewardTiers?.find(
        (tier) => tier.id === rewardTierId
      );

      if (!rewardTier) {
        return { kind: "no-tier" as const };
      }

      // 2. Check client has enough points
      const [loyaltyRecord] = await tx
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
        return { kind: "insufficient" as const, required: rewardTier.pointsRequired, available: 0 };
      }

      if (loyaltyRecord.points < rewardTier.pointsRequired) {
        return {
          kind: "insufficient" as const,
          required: rewardTier.pointsRequired,
          available: loyaltyRecord.points,
        };
      }

      // 3. Deduct points from balance
      const newBalance = loyaltyRecord.points - rewardTier.pointsRequired;

      await tx
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

      const transactionResult = await tx
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

      return {
        kind: "ok" as const,
        rewardTier,
        transaction,
        previousPoints: loyaltyRecord.points,
        newBalance,
      };
    });

    if (outcome.kind === "no-salon") {
      return NextResponse.json(
        { success: false, error: "Salon nie znaleziony" },
        { status: 404 }
      );
    }
    if (outcome.kind === "not-active") {
      return NextResponse.json(
        { success: false, error: "Program lojalnosciowy nie jest aktywny" },
        { status: 400 }
      );
    }
    if (outcome.kind === "no-tier") {
      return NextResponse.json(
        { success: false, error: "Nie znaleziono nagrody o podanym ID" },
        { status: 404 }
      );
    }
    if (outcome.kind === "insufficient") {
      return NextResponse.json(
        {
          success: false,
          error: `Niewystarczajaca liczba punktow. Wymagane: ${outcome.required}, dostepne: ${outcome.available}`,
        },
        { status: 400 }
      );
    }

    const { rewardTier, transaction, previousPoints, newBalance } = outcome;

    logger.info(`[Loyalty Redeem] Client ${clientId} redeemed "${rewardTier.name}" for ${rewardTier.pointsRequired} points. Balance: ${previousPoints} -> ${newBalance}`);

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
          previousPoints,
          currentPoints: newBalance,
        },
      },
      message: `Nagroda "${rewardTier.name}" zostala zrealizowana! Wykorzystano ${rewardTier.pointsRequired} punktow.`,
    });
  } catch (error) {
    logger.error("[Loyalty Redeem API] Error", { error: error });
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
 * Uses the authenticated user's salon.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

    const { id: clientId } = await params;

    const salonId = await getUserSalonId();
    if (!salonId) {
      return NextResponse.json(
        { success: false, error: "Salon not found" },
        { status: 404 }
      );
    }

    // Odczyt salonu + punktów klienta w jednym kontekście RLS. loyaltyPoints ma
    // salonId (jawny eq zachowany); salons scope = eq(salons.id, salonId).
    const { salon, loyaltyRecord } = await forSalon(salonId).raw(async (tx) => {
      const [s] = await tx
        .select({ id: salons.id, settingsJson: salons.settingsJson })
        .from(salons)
        .where(eq(salons.id, salonId))
        .limit(1);
      if (!s) return { salon: null, loyaltyRecord: null };
      const [lr] = await tx
        .select()
        .from(loyaltyPoints)
        .where(
          and(
            eq(loyaltyPoints.clientId, clientId),
            eq(loyaltyPoints.salonId, salonId)
          )
        )
        .limit(1);
      return { salon: s, loyaltyRecord: lr ?? null };
    });

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
    logger.error("[Loyalty Redeem API] GET Error", { error: error });
    return NextResponse.json(
      { success: false, error: "Blad podczas pobierania nagrod" },
      { status: 500 }
    );
  }
}
