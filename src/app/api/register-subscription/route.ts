import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { subscriptionPlans, salonSubscriptions, salons, user as userTable } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { TRIAL_DAYS } from "@/lib/constants";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";

/**
 * POST /api/register-subscription
 *
 * Called after user registration to store the selected subscription plan.
 * Creates a salon subscription in 'trialing' status with a trial period.
 *
 * Body: { planSlug: "basic" | "pro", email: string }
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;
    const body = await request.json();
    const { planSlug, email } = body;

    if (!planSlug || !email) {
      return NextResponse.json(
        { success: false, error: "planSlug and email are required" },
        { status: 400 }
      );
    }

    // Find the subscription plan
    const [plan] = await db
      .select()
      .from(subscriptionPlans)
      .where(eq(subscriptionPlans.slug, planSlug))
      .limit(1);

    if (!plan) {
      return NextResponse.json(
        { success: false, error: "Plan not found" },
        { status: 404 }
      );
    }

    // Find the user by email
    const [registeredUser] = await db
      .select()
      .from(userTable)
      .where(eq(userTable.email, email))
      .limit(1);

    if (!registeredUser) {
      return NextResponse.json(
        { success: false, error: "User not found" },
        { status: 404 }
      );
    }

    // Find the salon owned by this user
    const [salon] = await db
      .select()
      .from(salons)
      .where(eq(salons.ownerId, registeredUser.id))
      .limit(1);

    let salonId: string;

    if (salon) {
      salonId = salon.id;
    } else {
      // Create a default salon for the user
      const [newSalon] = await db
        .insert(salons)
        .values({
          name: `Salon ${registeredUser.name || "Nowy"}`,
          email: registeredUser.email,
          ownerId: registeredUser.id,
        })
        .returning();
      salonId = newSalon!.id;
    }

    // Check for existing subscription
    const [existingSub] = await db
      .select()
      .from(salonSubscriptions)
      .where(eq(salonSubscriptions.salonId, salonId))
      .limit(1);

    if (existingSub) {
      // Update existing subscription with new plan
      await db
        .update(salonSubscriptions)
        .set({
          planId: plan.id,
        })
        .where(eq(salonSubscriptions.id, existingSub.id));

      return NextResponse.json({
        success: true,
        data: {
          subscriptionId: existingSub.id,
          planName: plan.name,
          planSlug: plan.slug,
          status: existingSub.status,
        },
      });
    }

    // Create salon subscription with trial period
    const trialEnd = new Date();
    trialEnd.setDate(trialEnd.getDate() + TRIAL_DAYS);

    const [subscription] = await db
      .insert(salonSubscriptions)
      .values({
        salonId,
        planId: plan.id,
        status: "trialing",
        trialEndsAt: trialEnd,
        currentPeriodStart: new Date(),
        currentPeriodEnd: trialEnd,
      })
      .returning();

    console.log(
      `[Register Subscription] Created subscription for salon ${salonId}: plan=${plan.name}, status=trialing, trial_ends=${trialEnd.toISOString()}`
    );

    return NextResponse.json({
      success: true,
      data: {
        subscriptionId: subscription!.id,
        planName: plan.name,
        planSlug: plan.slug,
        status: subscription!.status,
        trialEndsAt: subscription!.trialEndsAt,
      },
    });
  } catch (error) {
    console.error("[Register Subscription] Error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to create subscription" },
      { status: 500 }
    );
  }
}
