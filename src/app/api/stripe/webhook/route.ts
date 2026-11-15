import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import Stripe from "stripe";
// ADR-001 sekcja 4: webhook Stripe — kontekst salonu z danych zdarzenia, nie z sesji; świadomie surowe db
// eslint-disable-next-line no-restricted-imports
import { db } from "@/lib/db";
import { confirmDepositPayment } from "@/lib/deposit-confirmation";
import { logger } from "@/lib/logger";
import {
  appointments,
  depositPayments,
  salonSubscriptions,
  subscriptionPayments,
  subscriptionPlans,
} from "@/lib/schema";
import { getStripe, isStripeWebhookConfigured } from "@/lib/stripe";
import { stripeInvoicePeriod, stripeSubscriptionPeriod } from "@/lib/stripe-period";
import {
  confirmSubscriptionCheckout,
  withSalonSubscriptionLock,
  type SubscriptionCheckoutSession,
} from "@/lib/subscription-confirmation";

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
  /** Pozycje faktury — okres opłacony (`stripeInvoicePeriod`). */
  lines?: {
    data?: Array<{
      type?: string | null;
      parent?: { type?: string | null } | null;
      period?: { start?: number | null; end?: number | null } | null;
    }>;
  };
  // Stripe v2 API: nested parent structure
  parent?: {
    subscription_details?: {
      subscription?: string | { id: string };
    };
  };
}

/**
 * Raw Checkout Session data from Stripe webhook events
 * (checkout.session.completed / checkout.session.expired).
 * Deposit sessions are identified by metadata.kind === "deposit"
 * (set in /api/deposits/create-session).
 */
interface RawCheckoutSessionData {
  id: string;
  payment_intent?: string | { id: string } | null;
  /** "paid" | "unpaid" | "no_payment_required" — async methods (P24) send
   * `completed` with "unpaid" first. */
  payment_status?: string;
  metadata?: Record<string, string> | null;
  /** "payment" (zadatek) | "subscription" (plan salonu). */
  mode?: string | null;
  subscription?: string | { id: string } | null;
  customer?: string | { id: string } | null;
}

/**
 * Raw subscription data from Stripe webhook events.
 */
interface RawSubscriptionData {
  id: string;
  status: string;
  canceled_at: number | null;
  cancel_at_period_end: boolean;
  // Starsze API: okres na subskrypcji; nowsze: na items.data[0] (stripe-period.ts)
  current_period_start?: number;
  current_period_end?: number;
  items?: { data?: Array<{ current_period_start?: number; current_period_end?: number }> };
  trial_end?: number | null;
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
 * And deposit (zadatek) Checkout events (metadata.kind === "deposit"):
 * - checkout.session.completed (payment_status "paid") /
 *   checkout.session.async_payment_succeeded: confirm deposit + appointment
 * - checkout.session.expired / checkout.session.async_payment_failed:
 *   mark the pending deposit payment as failed + cancel the appointment
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

    // Webhook signature verification is MANDATORY. There is no dev fallback —
    // an unsigned event could fake payments / activate plans (P0-C).
    if (!isStripeWebhookConfigured() || !stripe) {
      logger.error("Stripe webhook rejected: secret or client not configured");
      return NextResponse.json(
        { error: "Webhook not configured" },
        { status: 503 }
      );
    }

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

      case "checkout.session.completed":
      // Delayed-notification methods (P24, sometimes BLIK) complete the
      // session first and report the payment result asynchronously.
      case "checkout.session.async_payment_succeeded":
        await handleCheckoutSessionCompleted(event, stripe);
        break;

      case "checkout.session.expired":
      case "checkout.session.async_payment_failed":
        await handleDepositSessionFailed(event);
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

  // Okres opłacony: z pozycji subskrypcji na fakturze (invoice.period_* to
  // okres poprzedni). Bez okresu ze Stripe nie zgadujemy — Stripe ponowi.
  const period = stripeInvoicePeriod(invoice);
  if (!period) {
    throw new Error(`invoice.paid without billing period: ${invoice.id}`);
  }
  const periodStart = period.start;
  const periodEnd = period.end;

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

  // Record the renewal payment and update the subscription atomically
  const paymentIntentId = getPaymentIntentIdFromInvoice(
    invoice,
    `stripe_pi_${event.id}`
  );

  // Ta sama blokada salonu co potwierdzenie Checkoutu (TOCTOU, T3).
  await withSalonSubscriptionLock(sub.salonId, async (tx) => {
    await tx
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

    // Stripe retry tego samego eventu nie może zdublować historii płatności
    await tx
      .insert(subscriptionPayments)
      .values({
        subscriptionId: sub.id,
        salonId: sub.salonId,
        amount,
        currency: "PLN",
        stripePaymentIntentId: paymentIntentId,
        status: "succeeded",
        paidAt: new Date(),
      })
      .onConflictDoNothing({ target: subscriptionPayments.stripePaymentIntentId });
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

  // Record the failed payment attempt
  const [plan] = await db
    .select()
    .from(subscriptionPlans)
    .where(eq(subscriptionPlans.id, sub.planId));

  const paymentIntentId = getPaymentIntentIdFromInvoice(
    invoice,
    `stripe_pi_failed_${event.id}`
  );

  await withSalonSubscriptionLock(sub.salonId, async (tx) => {
    await tx
      .update(salonSubscriptions)
      .set({ status: "past_due" })
      .where(eq(salonSubscriptions.id, sub.id));

    await tx
      .insert(subscriptionPayments)
      .values({
        subscriptionId: sub.id,
        salonId: sub.salonId,
        amount: plan ? plan.priceMonthly : "0.00",
        currency: "PLN",
        stripePaymentIntentId: paymentIntentId,
        status: "failed",
        paidAt: null,
      })
      .onConflictDoNothing({ target: subscriptionPayments.stripePaymentIntentId });
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

  // Okres z items.data[0] (nowsze API) albo z poziomu subskrypcji (starsze).
  const period = stripeSubscriptionPeriod(stripeSub);
  if (!period) {
    logger.warn("customer.subscription.updated without billing period — keeping stored period", {
      stripeSubscriptionId: stripeSub.id,
    });
  }
  const periodStart = period?.start ?? sub.currentPeriodStart;
  const periodEnd = period?.end ?? sub.currentPeriodEnd;

  // Ta sama blokada salonu co potwierdzenie Checkoutu (TOCTOU, T3): zapis
  // stanu ze Stripe nie przeplata się z potwierdzeniem w toku.
  await withSalonSubscriptionLock(sub.salonId, async (tx) => {
    await tx
      .update(salonSubscriptions)
      .set({
        status,
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        canceledAt: stripeSub.canceled_at
          ? new Date(stripeSub.canceled_at * 1000)
          : sub.canceledAt,
        // Trial po stronie Stripe: koniec ze Stripe, nie z rejestracji.
        ...(stripeSub.status === "trialing" && typeof stripeSub.trial_end === "number"
          ? { trialEndsAt: new Date(stripeSub.trial_end * 1000) }
          : {}),
      })
      .where(eq(salonSubscriptions.id, sub.id));
  });

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

  await withSalonSubscriptionLock(sub.salonId, async (tx) => {
    await tx
      .update(salonSubscriptions)
      .set({
        status: "canceled",
        canceledAt: new Date(),
      })
      .where(eq(salonSubscriptions.id, sub.id));
  });

  logger.info("Subscription deleted/canceled via Stripe", { subscriptionId: sub.id });
}

/**
 * Handle checkout.session.completed / checkout.session.async_payment_succeeded
 * for deposit payments.
 *
 * This is the PRODUCTION source of truth for deposit confirmation (the
 * signature was already verified above). Confirms the deposit payment and
 * appointment via the shared confirmDepositPayment() (transactional update +
 * SMS notification), storing the real payment_intent id so refund.ts can
 * issue automatic refunds later.
 *
 * Delayed-notification methods (P24, sometimes BLIK): the `completed` event
 * can arrive with payment_status "unpaid" — in that case we do NOT confirm
 * and wait for `async_payment_succeeded` (or `async_payment_failed`).
 */
async function handleCheckoutSessionCompleted(event: Stripe.Event, stripe: Stripe) {
  const checkoutSession = event.data.object as unknown as RawCheckoutSessionData;

  if (checkoutSession.metadata?.kind !== "deposit" && checkoutSession.mode === "subscription") {
    await handleSubscriptionCheckoutCompleted(event, stripe, checkoutSession);
    return;
  }

  if (checkoutSession.metadata?.kind !== "deposit") {
    logger.debug("Checkout session event without deposit metadata, skipping", {
      eventType: event.type,
      sessionId: checkoutSession.id,
    });
    return;
  }

  const depositPaymentId = checkoutSession.metadata.depositPaymentId;
  if (!depositPaymentId) {
    logger.error("Deposit checkout session event without depositPaymentId", {
      eventType: event.type,
      sessionId: checkoutSession.id,
    });
    return;
  }

  if (checkoutSession.payment_status !== "paid") {
    logger.info(
      "Deposit checkout session completed but not paid yet (async payment) — waiting",
      {
        eventType: event.type,
        sessionId: checkoutSession.id,
        depositPaymentId,
        paymentStatus: checkoutSession.payment_status,
      }
    );
    return;
  }

  // Persist the payment_intent id only when it is a real pi_ id — otherwise
  // keep the existing stored reference (the cs_ session id from
  // create-session) instead of corrupting it.
  const rawPaymentIntent =
    typeof checkoutSession.payment_intent === "string"
      ? checkoutSession.payment_intent
      : checkoutSession.payment_intent?.id;
  const paymentIntentId =
    rawPaymentIntent && rawPaymentIntent.startsWith("pi_")
      ? rawPaymentIntent
      : undefined;

  const result = await confirmDepositPayment(
    depositPaymentId,
    paymentIntentId ? { paymentIntentId } : {}
  );

  if (!result.success) {
    // not_found: broken reference; not_pending: e.g. a late async success
    // after the cleanup cron cancelled the appointment — money was taken,
    // manual refund needed.
    logger.error("Deposit confirmation via webhook failed — manual attention required", {
      depositPaymentId,
      sessionId: checkoutSession.id,
      error: result.error,
    });
    return;
  }

  logger.info("Deposit confirmed via Stripe webhook", {
    depositPaymentId,
    sessionId: checkoutSession.id,
    paymentIntentId,
    alreadyConfirmed: result.alreadyConfirmed,
  });
}

/**
 * Subscription Checkout (mode "subscription") completed — the same
 * confirmSubscriptionCheckout() as /api/subscriptions/confirm (T3), so the
 * plan is granted even when the user never returns to the success page, and
 * whichever comes second gets alreadyConfirmed instead of a duplicate.
 *
 * Salon from the signed event's metadata (no user session here).
 * - unpaid (async method): wait for async_payment_succeeded,
 * - Stripe error (502): throw → 500 → Stripe retries the event,
 * - invalid data / conflict (400/404/409): logged for manual handling, 200
 *   (a retry would not change the outcome).
 */
async function handleSubscriptionCheckoutCompleted(
  event: Stripe.Event,
  stripe: Stripe,
  checkoutSession: RawCheckoutSessionData
) {
  if (checkoutSession.payment_status !== "paid") {
    logger.info("Subscription checkout completed but not paid yet — waiting", {
      eventType: event.type,
      sessionId: checkoutSession.id,
    });
    return;
  }

  const result = await confirmSubscriptionCheckout(
    stripe,
    checkoutSession as SubscriptionCheckoutSession
  );

  if (result.ok) {
    logger.info("Subscription checkout confirmed via webhook", {
      eventId: event.id,
      sessionId: checkoutSession.id,
      alreadyConfirmed: result.alreadyConfirmed,
      subscriptionId: result.subscription?.id,
    });
    return;
  }

  if (result.status === 502) {
    throw new Error(`Subscription checkout confirmation failed: ${result.code}`);
  }

  logger.error("Subscription checkout NOT confirmed via webhook — manual handling", {
    eventId: event.id,
    sessionId: checkoutSession.id,
    code: result.code,
    status: result.status,
  });
}

/**
 * Handle checkout.session.expired / checkout.session.async_payment_failed
 * for deposit payments.
 *
 * The customer did not pay — mark the still-pending payment as "failed"
 * (consistent with the depositPayments status set: pending/succeeded/
 * failed/refunded) and CANCEL the appointment so the slot is freed instead
 * of staying blocked by a dead "scheduled" booking.
 */
async function handleDepositSessionFailed(event: Stripe.Event) {
  const checkoutSession = event.data.object as unknown as RawCheckoutSessionData;

  if (checkoutSession.metadata?.kind !== "deposit") return;

  const depositPaymentId = checkoutSession.metadata.depositPaymentId;
  if (!depositPaymentId) return;

  // Only flip payments that are still pending — never downgrade a payment
  // that already succeeded (e.g. out-of-order webhook delivery).
  const cancelled = await db.transaction(async (tx) => {
    const [payment] = await tx
      .update(depositPayments)
      .set({ status: "failed" })
      .where(
        and(
          eq(depositPayments.id, depositPaymentId),
          eq(depositPayments.status, "pending")
        )
      )
      .returning();

    if (!payment) return false;

    await tx
      .update(appointments)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(
        and(
          eq(appointments.id, payment.appointmentId),
          eq(appointments.status, "scheduled")
        )
      );
    return true;
  });

  logger.info("Deposit checkout session failed/expired", {
    eventType: event.type,
    depositPaymentId,
    sessionId: checkoutSession.id,
    appointmentCancelled: cancelled,
  });
}
