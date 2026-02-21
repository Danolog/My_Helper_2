import { NextRequest, NextResponse } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

/**
 * Validate returnTo URL to prevent open redirects.
 * Only allows relative paths that start with "/" but not "//".
 */
function isSafeReturnTo(url: string | null | undefined): string {
  if (!url) return "/dashboard";
  if (url.startsWith("/") && !url.startsWith("//")) return url;
  return "/dashboard";
}

/**
 * Next.js 16 Proxy for auth protection.
 * Uses cookie-based checks for fast, optimistic redirects.
 *
 * Note: This only checks for cookie existence, not validity.
 * Full session validation should be done in each protected page/route.
 */
export async function proxy(request: NextRequest) {
  const sessionCookie = getSessionCookie(request);

  // Optimistic redirect - cookie existence check only
  // Full validation happens in page components via auth.api.getSession()
  if (!sessionCookie) {
    const pathname = request.nextUrl.pathname;
    const search = request.nextUrl.search;

    // Build the returnTo parameter from the original URL path + search params
    // Validate to prevent open redirect via protocol-relative URLs
    const returnTo = isSafeReturnTo(pathname + search);

    // All protected routes redirect to login page with returnTo param
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("returnTo", returnTo);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard",
    "/dashboard/:path*",
    "/chat",
    "/chat/:path*",
    "/profile",
    "/profile/:path*",
    "/admin",
    "/admin/:path*",
  ],
};
