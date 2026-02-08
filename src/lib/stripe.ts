import Stripe from "stripe";

/**
 * Stripe client singleton.
 * Uses the secret key from environment variables.
 * Returns null if no secret key is configured.
 */
function createStripeClient(): Stripe | null {
  const secretKey = process.env.STRIPE_SECRET_KEY;

  if (!secretKey) {
    console.warn("[Stripe] STRIPE_SECRET_KEY is not configured");
    return null;
  }

  return new Stripe(secretKey);
}

// Lazy singleton
let _stripe: Stripe | null | undefined;

export function getStripe(): Stripe | null {
  if (_stripe === undefined) {
    _stripe = createStripeClient();
  }
  return _stripe;
}

/**
 * Check if Stripe is configured (secret key exists in env).
 */
export function isStripeConfigured(): boolean {
  return !!process.env.STRIPE_SECRET_KEY;
}

/**
 * Check if Stripe publishable key is configured.
 */
export function isStripePublishableKeyConfigured(): boolean {
  return !!process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
}

/**
 * Check if Stripe webhook secret is configured.
 */
export function isStripeWebhookConfigured(): boolean {
  return !!process.env.STRIPE_WEBHOOK_SECRET;
}

/**
 * Check if Stripe price IDs for subscription plans are configured.
 */
export function isStripePricesConfigured(): boolean {
  return !!process.env.STRIPE_PRICE_BASIC && !!process.env.STRIPE_PRICE_PRO;
}

export type StripeConnectionStatus = {
  configured: boolean;
  connected: boolean;
  publishableKeyConfigured: boolean;
  webhookConfigured: boolean;
  pricesConfigured: boolean;
  accountName?: string;
  accountId?: string;
  liveMode?: boolean;
  error?: string;
};

/**
 * Test the Stripe connection by making an API call.
 * Returns a status object with connection details.
 */
export async function testStripeConnection(): Promise<StripeConnectionStatus> {
  const status: StripeConnectionStatus = {
    configured: isStripeConfigured(),
    connected: false,
    publishableKeyConfigured: isStripePublishableKeyConfigured(),
    webhookConfigured: isStripeWebhookConfigured(),
    pricesConfigured: isStripePricesConfigured(),
  };

  if (!status.configured) {
    status.error = "STRIPE_SECRET_KEY is not configured";
    return status;
  }

  const stripe = getStripe();
  if (!stripe) {
    status.error = "Failed to initialize Stripe client";
    return status;
  }

  try {
    // Make a simple API call to verify the connection
    const account = await stripe.accounts.retrieve();

    status.connected = true;
    status.accountId = account.id;
    status.liveMode = account.charges_enabled;

    // Try to get account display name
    if (account.settings?.dashboard?.display_name) {
      status.accountName = account.settings.dashboard.display_name;
    } else if (account.business_profile?.name) {
      status.accountName = account.business_profile.name;
    }

    return status;
  } catch (err) {
    // Stripe API returns specific error types
    if (err instanceof Stripe.errors.StripeAuthenticationError) {
      status.error = "Invalid API key - authentication failed";
    } else if (err instanceof Stripe.errors.StripeConnectionError) {
      status.error = "Cannot connect to Stripe API";
    } else if (err instanceof Stripe.errors.StripePermissionError) {
      status.error = "API key does not have required permissions";
    } else if (err instanceof Error) {
      status.error = err.message;
    } else {
      status.error = "Unknown error testing Stripe connection";
    }

    return status;
  }
}
