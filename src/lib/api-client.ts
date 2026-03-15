/**
 * Client-side fetch wrapper that auto-includes the CSRF token header
 * for mutation requests (POST, PUT, PATCH, DELETE).
 *
 * Usage: replace `fetch(url, { method: "POST", ... })` with
 *        `mutationFetch(url, { method: "POST", ... })`
 */

const CSRF_TOKEN_COOKIE = "csrf-token";
const CSRF_HEADER = "x-csrf-token";

function getCsrfToken(): string {
  if (typeof document === "undefined") return "";
  const match = document.cookie.match(
    new RegExp(`(?:^|; )${CSRF_TOKEN_COOKIE}=([^;]*)`)
  );
  return match?.[1] ? decodeURIComponent(match[1]) : "";
}

export async function mutationFetch(
  url: string | URL | Request,
  options: RequestInit = {}
): Promise<Response> {
  const headers = new Headers(options.headers);
  if (!headers.has(CSRF_HEADER)) {
    const token = getCsrfToken();
    if (token) {
      headers.set(CSRF_HEADER, token);
    }
  }
  return fetch(url, { ...options, headers });
}
