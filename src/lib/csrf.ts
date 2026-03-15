/**
 * CSRF protection using the signed double-submit cookie pattern.
 *
 * Uses Web Crypto API (Edge Runtime compatible) for HMAC signing.
 * The csrf-csrf package is installed as the reference implementation;
 * this module reimplements the same pattern for Next.js Edge Runtime.
 *
 * Flow:
 * 1. Middleware sets two cookies on page loads:
 *    - csrf-secret (httpOnly) — random secret
 *    - csrf-token  (readable)  — HMAC(appSecret, csrf-secret)
 * 2. Client reads csrf-token cookie and sends it as x-csrf-token header
 * 3. Middleware validates: HMAC(appSecret, cookie-secret) === header-token
 */

export const CSRF_SECRET_COOKIE = "csrf-secret";
export const CSRF_TOKEN_COOKIE = "csrf-token";
export const CSRF_HEADER = "x-csrf-token";

const APP_SECRET = process.env.BETTER_AUTH_SECRET || "dev-csrf-secret-must-be-32-chars-long";

export async function hmacSign(data: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(APP_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function generateSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function validateCsrfToken(secret: string, token: string): Promise<boolean> {
  const expected = await hmacSign(secret);
  return expected === token;
}
