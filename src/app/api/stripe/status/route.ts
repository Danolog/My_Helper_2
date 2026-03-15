import { NextResponse } from "next/server";
import { testStripeConnection } from "@/lib/stripe";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";

import { logger } from "@/lib/logger";
/**
 * GET /api/stripe/status
 *
 * Returns the current Stripe integration status including:
 * - Whether API keys are configured
 * - Whether the connection to Stripe API works
 * - Account details if connected
 * - Webhook and price configuration status
 */
export async function GET() {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;
    const status = await testStripeConnection();

    logger.info("[Stripe Status API] Connection test result", {
      configured: status.configured,
      connected: status.connected,
      accountId: status.accountId,
      error: status.error,
    });

    return NextResponse.json({
      success: true,
      data: status,
    });
  } catch (error) {
    logger.error("[Stripe Status API] Error", { error: error });
    return NextResponse.json(
      {
        success: false,
        error: "Failed to check Stripe status",
        data: {
          configured: false,
          connected: false,
          publishableKeyConfigured: false,
          webhookConfigured: false,
          pricesConfigured: false,
          error: "Nie udalo sie polaczyc ze Stripe. Sprawdz konfiguracje kluczy API.",
        },
      },
      { status: 500 }
    );
  }
}
