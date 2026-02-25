import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { salonSubscriptions, subscriptionPayments, subscriptionPlans } from "@/lib/schema";
import { getStripe } from "@/lib/stripe";
import { getUserSalonId } from "@/lib/get-user-salon";

/**
 * POST /api/subscriptions/confirm
 *
 * Called by the success page after Stripe redirects back.
 * Retrieves the Stripe Checkout Session, creates or updates the
 * salonSubscription record, and records a subscriptionPayment.
 *
 * Request body: { sessionId: string }
 */
export async function POST(request: Request) {
  try {
    const currentSalonId = await getUserSalonId();
    if (!currentSalonId) {
      return NextResponse.json(
        { success: false, error: "Salon not found" },
        { status: 404 },
      );
    }

    const body: unknown = await request.json();
    if (
      !body ||
      typeof body !== "object" ||
      !("sessionId" in body) ||
      typeof (body as Record<string, unknown>).sessionId !== "string"
    ) {
      return NextResponse.json(
        { success: false, error: "sessionId is required" },
        { status: 400 },
      );
    }

    const { sessionId } = body as { sessionId: string };

    // Check if we already recorded this session (idempotency guard)
    const existingPayments = await db
      .select()
      .from(subscriptionPayments)
      .where(eq(subscriptionPayments.stripePaymentIntentId, sessionId));

    if (existingPayments.length > 0) {
      // Already confirmed -- return the existing subscription
      const existingPayment = existingPayments[0];
      if (!existingPayment) {
        return NextResponse.json(
          { success: false, error: "Inconsistent payment state" },
          { status: 500 },
        );
      }

      const subscriptionRows = await db
        .select()
        .from(salonSubscriptions)
        .where(eq(salonSubscriptions.id, existingPayment.subscriptionId));

      return NextResponse.json({
        success: true,
        alreadyConfirmed: true,
        subscription: subscriptionRows[0] ?? null,
      });
    }

    const stripe = getStripe();

    if (!stripe) {
      // If Stripe is not configured, the checkout flow would have used the
      // dev fallback which creates a subscription directly in the DB.
      // The success page may still call confirm with a dev session ID -- just
      // return a success indicator.
      return NextResponse.json({
        success: true,
        alreadyConfirmed: true,
        message: "Stripe is not configured; subscription was created during checkout.",
      });
    }

    // Retrieve the Checkout Session from Stripe
    let checkoutSession;
    try {
      checkoutSession = await stripe.checkout.sessions.retrieve(sessionId, {
        expand: ["subscription", "line_items"],
      });
    } catch (stripeError) {
      console.error("[Subscriptions API] Failed to retrieve Stripe session:", stripeError);
      return NextResponse.json(
        { success: false, error: "Nie udalo sie zweryfikowac sesji Stripe" },
        { status: 502 },
      );
    }

    if (checkoutSession.payment_status !== "paid") {
      return NextResponse.json(
        { success: false, error: "Platnosc nie zostala zrealizowana" },
        { status: 400 },
      );
    }

    // Extract metadata written during checkout creation
    const salonId = checkoutSession.metadata?.salonId || currentSalonId;
    const planId = checkoutSession.metadata?.planId;

    if (!planId) {
      return NextResponse.json(
        { success: false, error: "Brak identyfikatora planu w sesji" },
        { status: 400 },
      );
    }

    // Verify plan exists
    const planRows = await db
      .select()
      .from(subscriptionPlans)
      .where(eq(subscriptionPlans.id, planId));

    const plan = planRows[0];
    if (!plan) {
      return NextResponse.json(
        { success: false, error: "Plan nie zostal znaleziony" },
        { status: 404 },
      );
    }

    // Determine subscription details from the Stripe subscription object
    const stripeSubscription = checkoutSession.subscription;
    const stripeSubId =
      typeof stripeSubscription === "string"
        ? stripeSubscription
        : stripeSubscription?.id ?? `stripe_sub_${Date.now()}`;

    const stripeCustomerId =
      typeof checkoutSession.customer === "string"
        ? checkoutSession.customer
        : checkoutSession.customer?.id ?? null;

    // Check if subscription already exists for this salon (update vs insert)
    const existingSubs = await db
      .select()
      .from(salonSubscriptions)
      .where(
        and(
          eq(salonSubscriptions.salonId, salonId),
          eq(salonSubscriptions.status, "active"),
        ),
      );

    const now = new Date();
    const periodEnd = new Date(now);
    periodEnd.setMonth(periodEnd.getMonth() + 1);

    let subscriptionRecord;

    if (existingSubs.length > 0 && existingSubs[0]) {
      // Update existing subscription
      const [updated] = await db
        .update(salonSubscriptions)
        .set({
          planId,
          stripeSubscriptionId: stripeSubId,
          stripeCustomerId,
          status: "active",
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
        })
        .where(eq(salonSubscriptions.id, existingSubs[0].id))
        .returning();

      subscriptionRecord = updated;
    } else {
      // Create new subscription
      const [created] = await db
        .insert(salonSubscriptions)
        .values({
          salonId,
          planId,
          stripeSubscriptionId: stripeSubId,
          stripeCustomerId,
          status: "active",
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
        })
        .returning();

      subscriptionRecord = created;
    }

    if (!subscriptionRecord) {
      return NextResponse.json(
        { success: false, error: "Nie udalo sie zapisac subskrypcji" },
        { status: 500 },
      );
    }

    // Record the payment
    await db.insert(subscriptionPayments).values({
      subscriptionId: subscriptionRecord.id,
      salonId,
      amount: plan.priceMonthly,
      currency: "PLN",
      stripePaymentIntentId: sessionId,
      status: "succeeded",
      paidAt: now,
    });

    // eslint-disable-next-line no-console
    console.log(
      `[Subscriptions API] Subscription confirmed: ${subscriptionRecord.id}, plan: ${plan.slug}`,
    );

    return NextResponse.json({
      success: true,
      subscription: subscriptionRecord,
      plan: {
        id: plan.id,
        name: plan.name,
        slug: plan.slug,
        priceMonthly: plan.priceMonthly,
      },
    });
  } catch (error) {
    console.error("[Subscriptions API] Confirm error:", error);
    return NextResponse.json(
      { success: false, error: "Nie udalo sie potwierdzic subskrypcji" },
      { status: 500 },
    );
  }
}
