import { logger } from "@/lib/logger";
import { isValidTwilioSignature } from "@/lib/twilio";

// ────────────────────────────────────────────────────────────
// POST /api/ai/voice/twilio/status
//
// Twilio posts call-status updates here (ringing, in-progress,
// completed, failed, busy, no-answer, canceled).
// Used for logging / analytics — no business logic yet.
//
// Like the webhook, this is called by Twilio servers directly and is
// not authenticated via session — the X-Twilio-Signature check below
// is the only gate (fail-closed, same as the voice webhook).
// ────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const params: Record<string, string> = {};
    formData.forEach((value, key) => {
      if (typeof value === "string") params[key] = value;
    });

    if (!isValidTwilioSignature(req, params)) {
      logger.warn("[Twilio] Invalid signature on status callback — rejected");
      return Response.json({ error: "Invalid signature" }, { status: 403 });
    }

    const callSid = params["CallSid"] ?? null;
    const callStatus = params["CallStatus"] ?? null;
    const callDuration = params["CallDuration"] ?? null;

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
