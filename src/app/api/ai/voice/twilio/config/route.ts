import { requireProAI, isProAIError } from "@/lib/ai/openrouter";
import { isTwilioConfigured, getTwilioPhoneNumber } from "@/lib/twilio";

// ────────────────────────────────────────────────────────────
// GET /api/ai/voice/twilio/config
//
// Returns the current Twilio telephony configuration for display
// in the dashboard settings panel. Requires Pro plan subscription.
// ────────────────────────────────────────────────────────────

export async function GET() {
  const proResult = await requireProAI();
  if (isProAIError(proResult)) return proResult;

  const configured = isTwilioConfigured();

  return Response.json({
    success: true,
    configured,
    phoneNumber: configured ? getTwilioPhoneNumber() : null,
    webhookUrl: "/api/ai/voice/twilio/webhook",
    statusCallbackUrl: "/api/ai/voice/twilio/status",
  });
}
