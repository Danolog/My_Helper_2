import { NextResponse } from "next/server";
import { depositConfirmSchema } from "@/lib/api-validation";
import { confirmDepositPayment } from "@/lib/deposit-confirmation";
import { logger } from "@/lib/logger";
import { strictRateLimit, getClientIp } from "@/lib/rate-limit";
/**
 * POST /api/deposits/confirm
 *
 * DEV-ONLY simulator for confirming a deposit payment. In production the
 * source of truth for deposit confirmation is the SIGNED Stripe webhook
 * (`/api/stripe/webhook`), never this open endpoint — confirming a payment
 * by record id alone, without a verified Stripe signature, would let anyone
 * mark a deposit "paid" without paying (P0-D). Therefore this route is
 * disabled when NODE_ENV === "production".
 *
 * Rate limiting (strictRateLimit) additionally throttles abuse in dev.
 *
 * The actual confirmation logic (payment + appointment update + SMS) is
 * shared with the Stripe webhook via confirmDepositPayment().
 */
export async function POST(request: Request) {
  try {
    // Hard production guard: confirmation in prod only via signed Stripe webhook.
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json(
        { success: false, error: "Not found" },
        { status: 404 }
      );
    }

    // Rate limit to throttle brute-force of the deposit id in dev.
    const ip = getClientIp(request);
    const rateLimitResult = strictRateLimit.check(ip);
    if (!rateLimitResult.success) {
      return NextResponse.json(
        { success: false, error: "Zbyt wiele żądań. Spróbuj ponownie później." },
        { status: 429, headers: { "Retry-After": String(Math.ceil(rateLimitResult.reset / 1000)) } }
      );
    }

    const body = await request.json();
    const parsed = depositConfirmSchema.safeParse(body);
    if (!parsed.success) {
      const details: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const path = issue.path.join(".") || "_root";
        if (!details[path]) details[path] = issue.message;
      }
      return NextResponse.json(
        { success: false, error: "Validation failed", details },
        { status: 400 }
      );
    }
    // Read ONLY validated data — never the raw body (P0-D / P1).
    const { depositPaymentId, sessionId } = parsed.data;

    const result = await confirmDepositPayment(depositPaymentId, {
      paymentIntentId: sessionId || undefined,
    });

    if (!result.success) {
      if (result.error === "not_pending") {
        return NextResponse.json(
          {
            success: false,
            error: `Platnosc w statusie '${result.depositPayment?.status}' nie moze byc potwierdzona`,
          },
          { status: 409 }
        );
      }
      return NextResponse.json(
        { success: false, error: "Deposit payment not found" },
        { status: 404 }
      );
    }

    if (result.alreadyConfirmed) {
      return NextResponse.json({
        success: true,
        data: { message: "Payment already confirmed", depositPaymentId },
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        depositPayment: result.depositPayment,
        appointment: result.appointment,
        message: "Platnosc zadatku potwierdzona",
        smsSent: result.smsSent,
      },
    });
  } catch (error) {
    logger.error("[Deposit API] Error confirming payment", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to confirm deposit payment" },
      { status: 500 }
    );
  }
}
