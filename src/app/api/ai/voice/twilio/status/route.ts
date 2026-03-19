import { logger } from "@/lib/logger";

// ────────────────────────────────────────────────────────────
// POST /api/ai/voice/twilio/status
//
// Twilio posts call-status updates here (ringing, in-progress,
// completed, failed, busy, no-answer, canceled).
// Used for logging / analytics — no business logic yet.
//
// NOTE: Like the webhook, this is called by Twilio servers directly
// and is not authenticated via session. In production, validate the
// Twilio request signature (X-Twilio-Signature).
// ────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  try {
    const formData = await req.formData();

    const callSid = formData.get("CallSid") as string | null;
    const callStatus = formData.get("CallStatus") as string | null;
    const callDuration = formData.get("CallDuration") as string | null;

    logger.info("[Twilio] Call status update", {
      callSid,
      callStatus,
      callDuration,
    });

    return Response.json({ success: true });
  } catch (error) {
    logger.error("[Twilio] Status callback error", { error });
    return Response.json(
      { error: "Status callback failed" },
      { status: 500 },
    );
  }
}
