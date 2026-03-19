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
