import twilio from "twilio";

// ────────────────────────────────────────────────────────────
// Twilio client factory
// ────────────────────────────────────────────────────────────

/**
 * Create a Twilio REST client.
 * Throws if TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN is not set.
 */
export function createTwilioClient() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  if (!accountSid || !authToken) {
    throw new Error("Twilio credentials not configured");
  }

  return twilio(accountSid, authToken);
}

/**
 * Get the configured Twilio phone number (the "From" number for outbound calls).
 * Throws if TWILIO_PHONE_NUMBER is not set.
 */
export function getTwilioPhoneNumber(): string {
  const phoneNumber = process.env.TWILIO_PHONE_NUMBER;
  if (!phoneNumber) {
    throw new Error("TWILIO_PHONE_NUMBER not configured");
  }
  return phoneNumber;
}

/**
 * Reconstruct the absolute public URL Twilio used to sign the request.
 * Twilio computes the signature over the exact URL it POSTed to, so we must
 * rebuild it from the forwarded proto/host headers (Vercel/Cloud Run set these).
 */
export function getTwilioRequestUrl(req: Request): string {
  const url = new URL(req.url);
  const proto = req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? url.host;
  return `${proto}://${host}${url.pathname}${url.search}`;
}

/**
 * Verify the X-Twilio-Signature header against the request (P0-E).
 * Fail-closed: missing credential or header => reject.
 */
export function isValidTwilioSignature(
  req: Request,
  params: Record<string, string>
): boolean {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) return false;
  const signature = req.headers.get("x-twilio-signature");
  if (!signature) return false;
  try {
    return twilio.validateRequest(authToken, signature, getTwilioRequestUrl(req), params);
  } catch {
    return false;
  }
}

/**
 * Check whether all Twilio env vars are present (non-destructive check).
 * Use this to conditionally show Twilio-related UI in the dashboard.
 */
export function isTwilioConfigured(): boolean {
  return !!(
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    process.env.TWILIO_PHONE_NUMBER
  );
}
