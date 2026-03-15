import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  salonSubscriptions,
  subscriptionPayments,
  subscriptionPlans,
} from "@/lib/schema";
import { logger } from "@/lib/logger";
import { getStripe, isStripeWebhookConfigured } from "@/lib/stripe";
import Stripe from "stripe";

/**
 * Raw invoice data from Stripe webhook events.
 * We use a raw interface because Stripe SDK v20 changed the Invoice type
 * significantly (subscription/payment_intent moved to nested structures).
 * Webhook payloads may use older API versions, so we handle both formats.
 */
interface RawInvoiceData {
  id: string;
  amount_paid: number;
  billing_reason: string | null;
  period_start: number;
  period_end: number;
  // Stripe v1 API: top-level subscription field
  subscription?: string | { id: string };
  payment_intent?: string | { id: string };
  // Stripe v2 API: nested parent structure
  parent?: {
    subscription_details?: {
      subscription?: string | { id: string };
    };
  };
}

/**
 * Raw subscription data from Stripe webhook events.
 */
interface RawSubscriptionData {
  id: string;
  status: string;
  canceled_at: number | null;
  cancel_at_period_end: boolean;
  // May or may not exist depending on Stripe API version
  current_period_start?: number;
  current_period_end?: number;
}

/**
 * Extract subscription ID from an invoice, handling both old and new Stripe API formats.
 */
function getSubscriptionIdFromInvoice(invoice: RawInvoiceData): string | null {
  // Try direct subscription field (older Stripe API versions)
  if (invoice.subscription) {
    return typeof invoice.subscription === "string"
      ? invoice.subscription
      : invoice.subscription.id;
  }
  // Try nested parent structure (Stripe v2/SDK v20+)
  const subDetails = invoice.parent?.subscription_details;
  if (subDetails?.subscription) {
    return typeof subDetails.subscription === "string"
      ? subDetails.subscription
      : subDetails.subscription.id;
  }
  return null;
}

/**
 * Extract payment intent ID from an invoice.
 */
function getPaymentIntentIdFromInvoice(invoice: RawInvoiceData, fallback: string): string {
  if (invoice.payment_intent) {
    return typeof invoice.payment_intent === "string"
      ? invoice.payment_intent
      : invoice.payment_intent.id;
  }
  return fallback;
}

/**
 * POST /api/stripe/webhook
 *
 * Stripe webhook endpoint that handles subscription lifecycle events:
 * - invoice.paid: Automatic subscription renewal (monthly billing continues)
 * - invoice.payment_failed: Mark subscription as past_due
 * - customer.subscription.updated: Sync subscription state
 * - customer.subscription.deleted: Mark subscription as canceled
 *
 * In production, Stripe sends these events automatically when:
 * 1. A recurring payment succeeds (renewal)
 * 2. A recurring payment fails
 * 3. A subscription is modified or canceled
 *
 * The webhook secret is used to verify the event signature.
 */
export async function POST(request: Request) {
  try {
    const body = await request.text();
    const stripe = getStripe();

    let event: Stripe.Event;

    // Verify webhook signature if configured
    if (isStripeWebhookConfigured() && stripe) {
      const signature = request.headers.get("stripe-signature");
      if (!signature) {
        return NextResponse.json(
          { error: "Missing stripe-signature header" },
          { status: 400 }
        );
      }

      try {
        event = stripe.webhooks.constructEvent(
          body,
          signature,
          process.env.STRIPE_WEBHOOK_SECRET!
        );
      } catch (err) {
        logger.error("Stripe webhook signature verification failed", {
          error: err instanceof Error ? err.message : err,
        });
        return NextResponse.json(
          { error: "Webhook signature verification failed" },
          { status: 400 }
        );
      }
    } else {
      // Dev mode: parse the body as JSON directly (no signature verification)
      try {
        event = JSON.parse(body) as Stripe.Event;
      } catch {
        return NextResponse.json(
          { error: "Invalid JSON body" },
          { status: 400 }
        );
      }
    }

    logger.info("Stripe webhook event received", { eventType: event.type, eventId: event.id });

    switch (event.type) {
      case "invoice.paid":
        await handleInvoicePaid(event);
        break;

      case "invoice.payment_failed":
        await handleInvoicePaymentFailed(event);
        break;

      case "customer.subscription.updated":
        await handleSubscriptionUpdated(event);
        break;

      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(event);
        break;

      default:
        logger.debug("Unhandled Stripe webhook event type", { eventType: event.type });
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    logger.error("Stripe webhook processing failed", { error });
    return NextResponse.json(
      { error: "Webhook processing failed" },
      { status: 500 }
    );
  }
}

/**
 * Handle invoice.paid event - this is the main renewal handler.
 * When Stripe successfully charges the customer for a recurring subscription,
 * it sends this event. We update the subscription period dates and record the payment.
 */
async function handleInvoicePaid(event: Stripe.Event) {
  const invoice = event.data.object as unknown as RawInvoiceData;
  const stripeSubscriptionId = getSubscriptionIdFromInvoice(invoice);

  if (!stripeSubscriptionId) {
    logger.debug("invoice.paid without subscription ID, skipping");
    return;
  }

  // Skip the first invoice (initial subscription creation is handled by checkout/confirm)
  if (invoice.billing_reason === "subscription_create") {
    logger.debug("Skipping subscription_create invoice (handled by checkout)");
    return;
  }

  // Find the subscription in our database
  const [sub] = await db
    .select()
    .from(salonSubscriptions)
    .where(eq(salonSubscriptions.stripeSubscriptionId, stripeSubscriptionId));

  if (!sub) {
    logger.error("No subscription found for Stripe ID", { stripeSubscriptionId });
    return;
  }

  // Calculate new period dates from the invoice
  const periodStart = invoice.period_start
    ? new Date(invoice.period_start * 1000)
    : new Date();
  const periodEnd = invoice.period_end
    ? new Date(invoice.period_end * 1000)
    : (() => {
        const d = new Date();
        d.setMonth(d.getMonth() + 1);
        return d;
      })();

  // Check for scheduled plan change (downgrade)
  let newPlanId = sub.planId;
  if (sub.scheduledPlanId && sub.scheduledChangeAt) {
    const changeAt = new Date(sub.scheduledChangeAt);
    if (changeAt <= new Date()) {
      newPlanId = sub.scheduledPlanId;
      logger.info("Applying scheduled plan change", { subscriptionId: sub.id });
    }
  }

  // Get the plan to determine the payment amount
  const [plan] = await db
    .select()
    .from(subscriptionPlans)
    .where(eq(subscriptionPlans.id, newPlanId));

  const amount = plan
    ? plan.priceMonthly
    : (invoice.amount_paid / 100).toFixed(2);

  // Update the subscription with new period dates
  await db
    .update(salonSubscriptions)
    .set({
      status: "active",
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      planId: newPlanId,
      // Clear scheduled changes if applied
      ...(newPlanId !== sub.planId
        ? { scheduledPlanId: null, scheduledChangeAt: null }
        : {}),
    })
    .where(eq(salonSubscriptions.id, sub.id));

  // Record the renewal payment
  const paymentIntentId = getPaymentIntentIdFromInvoice(
    invoice,
    `stripe_pi_${event.id}`
  );

  await db.insert(subscriptionPayments).values({
    subscriptionId: sub.id,
    salonId: sub.salonId,
    amount,
    currency: "PLN",
    stripePaymentIntentId: paymentIntentId,
    status: "succeeded",
    paidAt: new Date(),
  });

  logger.info("Subscription renewed", {
    subscriptionId: sub.id,
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
  });
}

/**
 * Handle invoice.payment_failed - mark subscription as past_due.
 */
async function handleInvoicePaymentFailed(event: Stripe.Event) {
  const invoice = event.data.object as unknown as RawInvoiceData;
  const stripeSubscriptionId = getSubscriptionIdFromInvoice(invoice);

  if (!stripeSubscriptionId) return;

  const [sub] = await db
    .select()
    .from(salonSubscriptions)
    .where(eq(salonSubscriptions.stripeSubscriptionId, stripeSubscriptionId));

  if (!sub) {
    logger.error("No subscription found for Stripe ID (payment failed)", { stripeSubscriptionId });
    return;
  }

  await db
    .update(salonSubscriptions)
    .set({ status: "past_due" })
    .where(eq(salonSubscriptions.id, sub.id));

  // Record the failed payment attempt
  const [plan] = await db
    .select()
    .from(subscriptionPlans)
    .where(eq(subscriptionPlans.id, sub.planId));

  const paymentIntentId = getPaymentIntentIdFromInvoice(
    invoice,
    `stripe_pi_failed_${event.id}`
  );

  await db.insert(subscriptionPayments).values({
    subscriptionId: sub.id,
    salonId: sub.salonId,
    amount: plan ? plan.priceMonthly : "0.00",
    currency: "PLN",
    stripePaymentIntentId: paymentIntentId,
    status: "failed",
    paidAt: null,
  });

  logger.warn("Payment failed, subscription set to past_due", { subscriptionId: sub.id });
}

/**
 * Handle customer.subscription.updated - sync subscription state.
 */
async function handleSubscriptionUpdated(event: Stripe.Event) {
  const stripeSub = event.data.object as unknown as RawSubscriptionData;

  const [sub] = await db
    .select()
    .from(salonSubscriptions)
    .where(eq(salonSubscriptions.stripeSubscriptionId, stripeSub.id));

  if (!sub) {
    logger.debug("No local subscription found for Stripe ID (updated)", { stripeSubscriptionId: stripeSub.id });
    return;
  }

  // Map Stripe status to our status
  let status = sub.status;
  if (stripeSub.status === "active") status = "active";
  else if (stripeSub.status === "past_due") status = "past_due";
  else if (stripeSub.status === "canceled") status = "canceled";
  else if (stripeSub.status === "trialing") status = "trialing";

  // current_period_start/end may not exist in newer Stripe API versions
  const periodStart = stripeSub.current_period_start
    ? new Date(stripeSub.current_period_start * 1000)
    : sub.currentPeriodStart;
  const periodEnd = stripeSub.current_period_end
    ? new Date(stripeSub.current_period_end * 1000)
    : sub.currentPeriodEnd;

  await db
    .update(salonSubscriptions)
    .set({
      status,
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      canceledAt: stripeSub.canceled_at
        ? new Date(stripeSub.canceled_at * 1000)
        : sub.canceledAt,
    })
    .where(eq(salonSubscriptions.id, sub.id));

  logger.info("Subscription updated", { subscriptionId: sub.id, status });
}

/**
 * Handle customer.subscription.deleted - mark as canceled.
 */
async function handleSubscriptionDeleted(event: Stripe.Event) {
  const stripeSub = event.data.object as unknown as RawSubscriptionData;

  const [sub] = await db
    .select()
    .from(salonSubscriptions)
    .where(eq(salonSubscriptions.stripeSubscriptionId, stripeSub.id));

  if (!sub) {
    logger.debug("No local subscription found for Stripe ID (deleted)", { stripeSubscriptionId: stripeSub.id });
    return;
  }

  await db
    .update(salonSubscriptions)
    .set({
      status: "canceled",
      canceledAt: new Date(),
    })
    .where(eq(salonSubscriptions.id, sub.id));

  logger.info("Subscription deleted/canceled via Stripe", { subscriptionId: sub.id });
}
