import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import Stripe from "stripe";
// ADR-001 sekcja 4: webhook Stripe — kontekst salonu z danych zdarzenia, nie z sesji; świadomie surowe db
import { db } from "@/lib/db";
import { confirmDepositPayment } from "@/lib/deposit-confirmation";
import { logger } from "@/lib/logger";
import { toErrorIdentity } from "@/lib/safe-error";
import {
  appointments,
  depositPayments,
  salonSubscriptions,
  subscriptionPayments,
  subscriptionPlans,
} from "@/lib/schema";
import { getStripe, getStripeWebhookSecret } from "@/lib/stripe";
import { type BillingPeriod, paidInvoicePeriod, type StripeInvoicePeriodSource } from "@/lib/stripe-period";
import {
  confirmSubscriptionCheckout,
  type SubscriptionCheckoutSession,
} from "@/lib/subscription-confirmation";
import { subscriptionStateFromStripe, withLockedStripeSubscriptionRow } from "@/lib/subscription-sync";

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
  // Stripe v1 API: top-level subscription field
  subscription?: string | { id: string };
  payment_intent?: string | { id: string };
  // Stripe v2 API: nested parent structure
  parent?: {
    subscription_details?: {
      subscription?: string | { id: string };
    };
  };
  // Invoice lines (the paid period is read from them); `has_more` = list truncated in the event
  lines?: (NonNullable<StripeInvoicePeriodSource["lines"]> & { has_more?: boolean }) | null;
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
 * Raw subscription data from Stripe webhook events. Only the id is used: the
 * state is read fresh from Stripe under the lock (subscription-sync.ts).
 */
interface RawSubscriptionData {
  id: string;
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
 * - invoice.paid: renewal payment recorded, state synced from Stripe
 * - invoice.payment_failed: failed payment recorded, state synced from Stripe
 * - customer.subscription.updated / deleted: state synced from Stripe
 *   (the event is only a signal — see src/lib/subscription-sync.ts)
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
  let received: { eventId: string; eventType: string } | undefined;
  try {
    const body = await request.text();
    const stripe = getStripe();

    let event: Stripe.Event;

    // Webhook signature verification is MANDATORY. There is no dev fallback —
    // an unsigned event could fake payments / activate plans (P0-C).
    const webhookSecret = getStripeWebhookSecret();
    if (!webhookSecret || !stripe) {
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
        webhookSecret
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

    received = { eventId: event.id, eventType: event.type };
    logger.info("Stripe webhook event received", { eventType: event.type, eventId: event.id });

    switch (event.type) {
      case "invoice.paid":
        await handleInvoicePaid(event, stripe);
        break;

      case "invoice.payment_failed":
        await handleInvoicePaymentFailed(event, stripe);
        break;

      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        await handleSubscriptionChanged(event, stripe);
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
    // N1 (Ryan, #62): ten catch obsługuje też zadatki (dane gości w
    // parametrach zapytań) — w logu tylko nazwa i kod błędu oraz id
    // zdarzenia (pełne zdarzenie jest w panelu Stripe), bez message/stack.
    logger.error("Stripe webhook processing failed", { ...toErrorIdentity(error), ...received });
    return NextResponse.json(
      { error: "Webhook processing failed" },
      { status: 500 }
    );
  }
}

/** Brak wiersza pod blokadą: 2xx + warn z id zdarzenia (patrz withLockedStripeSubscriptionRow). */
function logNoLocalSubscription(event: Stripe.Event, stripeSubscriptionId: string) {
  logger.warn("No local subscription for Stripe ID under lock — event acknowledged", {
    eventId: event.id,
    eventType: event.type,
    stripeSubscriptionId,
  });
}

/**
 * Paid period written in SQL under the row lock (the row passed to the handler
 * is read before the salon lock, so the comparison cannot be done in JS):
 * the end never moves back (`greatest` skips NULL), the start follows only a
 * strictly later end — a retried event or an older invoice changes nothing.
 */
function paidPeriodEndSql(period: BillingPeriod) {
  return sql`greatest(${salonSubscriptions.currentPeriodEnd}, ${period.end.toISOString()}::timestamp)`;
}

function paidPeriodStartSql(period: BillingPeriod) {
  const end = sql`${period.end.toISOString()}::timestamp`;
  const storedEnd = salonSubscriptions.currentPeriodEnd;
  return sql`case when ${storedEnd} is null or ${end} > ${storedEnd} then ${period.start.toISOString()}::timestamp else ${salonSubscriptions.currentPeriodStart} end`;
}

/**
 * Handle invoice.paid — renewal. The event is only a signal (T3): under the
 * stripe_sub lock the CURRENT status is read from Stripe, never a hard-coded
 * "active" (a late invoice.paid after deleted must not revive a canceled
 * subscription). The period comes from the lines of the PAID invoice (not
 * from the current Stripe period, not from `invoice.period_*`) and never moves
 * back; a canceled final row is only extended to the end of the paid period.
 * Lines without a full period → stored period unchanged + warn; a truncated
 * line list (`has_more`) → warn. The payment is always recorded (idempotent).
 */
async function handleInvoicePaid(event: Stripe.Event, stripe: Stripe) {
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

  const paymentIntentId = getPaymentIntentIdFromInvoice(invoice, `stripe_pi_${event.id}`);
  const paidPeriod = paidInvoicePeriod(invoice);
  const linesHasMore = invoice.lines?.has_more === true;

  const result = await withLockedStripeSubscriptionRow(stripe, stripeSubscriptionId, async (tx, sub, stripeSub) => {
    const state = subscriptionStateFromStripe(sub, stripeSub);
    const logContext = { eventId: event.id, subscriptionId: sub.id, linesHasMore };
    if (!paidPeriod) {
      logger.warn("Paid invoice without a billing period on its lines — keeping stored period", logContext);
    } else if (linesHasMore) {
      logger.warn("Paid invoice line list incomplete in the event — period taken from the lines present", logContext);
    }

    // Scheduled plan change (downgrade) — only on a live subscription.
    let newPlanId = sub.planId;
    if (state && sub.scheduledPlanId && sub.scheduledChangeAt && new Date(sub.scheduledChangeAt) <= new Date()) {
      newPlanId = sub.scheduledPlanId;
      logger.info("Applying scheduled plan change", { subscriptionId: sub.id });
    }

    const [plan] = await tx.select().from(subscriptionPlans).where(eq(subscriptionPlans.id, newPlanId));
    const amount = plan ? plan.priceMonthly : (invoice.amount_paid / 100).toFixed(2);

    if (state) {
      // Status from Stripe; the Stripe period (state.currentPeriod*) is not written here.
      const { status, canceledAt, trialEndsAt } = state;
      await tx
        .update(salonSubscriptions)
        .set({
          status,
          canceledAt,
          ...(trialEndsAt !== undefined ? { trialEndsAt } : {}),
          ...(paidPeriod
            ? { currentPeriodStart: paidPeriodStartSql(paidPeriod), currentPeriodEnd: paidPeriodEndSql(paidPeriod) }
            : {}),
          planId: newPlanId,
          ...(newPlanId !== sub.planId ? { scheduledPlanId: null, scheduledChangeAt: null } : {}),
        })
        .where(eq(salonSubscriptions.id, sub.id));
    } else if (paidPeriod) {
      // Final row (canceled, confirmed by Stripe): only the paid period, no revival.
      await tx
        .update(salonSubscriptions)
        .set({ currentPeriodStart: paidPeriodStartSql(paidPeriod), currentPeriodEnd: paidPeriodEndSql(paidPeriod) })
        .where(eq(salonSubscriptions.id, sub.id));
    }

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

    return { subscriptionId: sub.id, status: state?.status ?? sub.status, final: !state };
  });

  if (!result.found) {
    logNoLocalSubscription(event, stripeSubscriptionId);
    return;
  }
  logger.info("Subscription invoice paid", { eventId: event.id, ...result.value });
}

/**
 * Handle invoice.payment_failed — record the failed attempt; the status comes
 * from Stripe (a late payment_failed after a later invoice.paid must not
 * give a false past_due).
 */
async function handleInvoicePaymentFailed(event: Stripe.Event, stripe: Stripe) {
  const invoice = event.data.object as unknown as RawInvoiceData;
  const stripeSubscriptionId = getSubscriptionIdFromInvoice(invoice);

  if (!stripeSubscriptionId) return;

  const paymentIntentId = getPaymentIntentIdFromInvoice(invoice, `stripe_pi_failed_${event.id}`);

  const result = await withLockedStripeSubscriptionRow(stripe, stripeSubscriptionId, async (tx, sub, stripeSub) => {
    const state = subscriptionStateFromStripe(sub, stripeSub);
    const [plan] = await tx.select().from(subscriptionPlans).where(eq(subscriptionPlans.id, sub.planId));

    if (state) {
      await tx.update(salonSubscriptions).set(state).where(eq(salonSubscriptions.id, sub.id));
    }

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

    return { subscriptionId: sub.id, status: state?.status ?? sub.status, final: !state };
  });

  if (!result.found) {
    logNoLocalSubscription(event, stripeSubscriptionId);
    return;
  }
  logger.warn("Subscription payment failed", { eventId: event.id, ...result.value });
}

/**
 * customer.subscription.updated / customer.subscription.deleted — sync the
 * CURRENT Stripe state (not the event payload) under the stripe_sub lock.
 */
async function handleSubscriptionChanged(event: Stripe.Event, stripe: Stripe) {
  const stripeSubscriptionId = (event.data.object as unknown as RawSubscriptionData).id;

  const result = await withLockedStripeSubscriptionRow(stripe, stripeSubscriptionId, async (tx, sub, stripeSub) => {
    const state = subscriptionStateFromStripe(sub, stripeSub);
    if (state) {
      await tx.update(salonSubscriptions).set(state).where(eq(salonSubscriptions.id, sub.id));
    }
    return { subscriptionId: sub.id, status: state?.status ?? sub.status, final: !state };
  });

  if (!result.found) {
    logNoLocalSubscription(event, stripeSubscriptionId);
    return;
  }
  logger.info("Subscription synced from Stripe", {
    eventId: event.id,
    eventType: event.type,
    ...result.value,
  });
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
    {
      ...(paymentIntentId ? { paymentIntentId } : {}),
      // "paid" (sprawdzone wyżej) pozwala zapisać wpłatę płatności `failed` (#70).
      stripePaymentStatus: checkoutSession.payment_status,
    }
  );

  if (!result.success) {
    // not_found: broken reference; not_pending: payment already refunded
    // (terminal) — money taken again, manual handling. A late payment after
    // cancellation (pending/failed) is confirmed and refunded (#70).
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
    // #70: wpłata za wizytę już nieaktywną — zapisana i zwrócona (albo manual refund w logu error)
    inactiveAppointment: result.inactiveAppointment ?? null,
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
 * - Stripe error / lock busy (502/503): throw → 500 → Stripe retries,
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

  if (result.status === 502 || result.status === 503) {
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
