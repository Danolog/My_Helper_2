/**
 * Next.js 16 Proxy — handles four concerns:
 * 0. Frozen modules (hardOff in src/lib/features.ts): API → 404, page → /dashboard
 * 1. CSP with per-request nonce (replaces 'unsafe-inline' in script-src)
 * 2. CSRF protection via signed double-submit cookie
 * 3. Auth protection for dashboard routes
 */
import { NextRequest, NextResponse } from "next/server";
import { getSessionCookie } from "better-auth/cookies";
import {
  CSRF_SECRET_COOKIE,
  CSRF_TOKEN_COOKIE,
  CSRF_HEADER,
  generateSecret,
  hmacSign,
  validateCsrfToken,
} from "@/lib/csrf";
import {
  MODULE_DISABLED_CODE,
  MODULE_DISABLED_MESSAGE,
  frozenModuleForApiPath,
  frozenModuleForPage,
} from "@/lib/features";

// ============================================================
// Auth helpers
// ============================================================

const PROTECTED_PREFIXES = [
  "/dashboard",
  "/chat",
  "/profile",
  "/admin",
];

function isProtectedRoute(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + "/")
  );
}

function isSafeReturnTo(url: string | null | undefined): string {
  if (!url) return "/dashboard";
  if (url.startsWith("/") && !url.startsWith("//")) return url;
  return "/dashboard";
}

// ============================================================
// CSRF helpers
// ============================================================

const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const CSRF_SKIP_PREFIXES = [
  "/api/auth/",
  "/api/stripe/",
  "/api/health",
  "/api/test/",
  // Cron routes are called by schedulers without cookies/CSRF tokens and are
  // each protected by requireCronSecret (Bearer CRON_SECRET, fail-closed).
  "/api/cron/",
];

// Cron-invoked endpoints outside /api/cron/ — same requireCronSecret guard.
const CRON_ENDPOINTS = new Set([
  "/api/notifications/birthday",
  "/api/notifications/low-stock",
  "/api/notifications/we-miss-you",
]);

function shouldSkipCsrf(pathname: string): boolean {
  for (const prefix of CSRF_SKIP_PREFIXES) {
    if (pathname.startsWith(prefix)) return true;
  }
  return CRON_ENDPOINTS.has(pathname);
}

async function ensureCsrfCookies(
  request: NextRequest,
  response: NextResponse
): Promise<void> {
  if (request.cookies.has(CSRF_SECRET_COOKIE)) return;

  const secret = generateSecret();
  const token = await hmacSign(secret);
  const isProduction = process.env.NODE_ENV === "production";

  response.cookies.set(CSRF_SECRET_COOKIE, secret, {
    httpOnly: true,
    sameSite: "strict",
    secure: isProduction,
    path: "/",
  });
  response.cookies.set(CSRF_TOKEN_COOKIE, token, {
    httpOnly: false,
    sameSite: "strict",
    secure: isProduction,
    path: "/",
  });
}

// ============================================================
// CSP with nonce
// ============================================================

function buildCsp(nonce: string): string {
  // Dev: React DevTools wymaga eval(), a next-devtools wstrzykuje inline
  // style bez nonce — bez tych zluzowan konsola tonie w ~20 bledach CSP
  // na strone (UAT B-11). Produkcyjna polityka pozostaje scisla.
  const isDev = process.env.NODE_ENV === "development";
  const scriptExtra = isDev ? " 'unsafe-eval'" : "";
  const styleSrc = isDev
    ? "style-src 'self' 'unsafe-inline' fonts.googleapis.com"
    : `style-src 'self' 'nonce-${nonce}' fonts.googleapis.com`;

  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${scriptExtra} storage.googleapis.com`,
    styleSrc,
    "font-src 'self' fonts.gstatic.com",
    "img-src 'self' data: blob: lh3.googleusercontent.com avatars.githubusercontent.com *.public.blob.vercel-storage.com images.unsplash.com",
    "connect-src 'self' *.googleapis.com accounts.google.com",
    "form-action 'self' accounts.google.com",
    "worker-src 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

// ============================================================
// Proxy entrypoint
// ============================================================

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // --- 0. Moduly zamrozone (hardOff) — przed CSRF i auth, dla kazdej metody ---
  // Rejestr (src/lib/features.ts) jest jedynym nosnikiem reguly; tu tylko
  // egzekucja. Trasa API => 404 MODULE_DISABLED, strona panelu => /dashboard.
  // Oba pytania ida do rejestru bez wstepnego filtra po prefiksie — rejestr
  // sam normalizuje sciezke (kodowanie, podwojne ukosniki, wielkosc liter).
  if (frozenModuleForApiPath(pathname)) {
    return NextResponse.json(
      { success: false, code: MODULE_DISABLED_CODE, error: MODULE_DISABLED_MESSAGE },
      { status: 404 }
    );
  }
  if (frozenModuleForPage(pathname)) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  // --- 1. API mutations: validate CSRF (no CSP needed for JSON responses) ---
  if (
    pathname.startsWith("/api/") &&
    MUTATION_METHODS.has(request.method) &&
    !shouldSkipCsrf(pathname)
  ) {
    const headerToken = request.headers.get(CSRF_HEADER);
    const secret = request.cookies.get(CSRF_SECRET_COOKIE)?.value;

    if (!headerToken || !secret) {
      return NextResponse.json(
        { success: false, error: "CSRF token missing" },
        { status: 403 }
      );
    }

    const valid = await validateCsrfToken(secret, headerToken);
    if (!valid) {
      return NextResponse.json(
        { success: false, error: "Invalid CSRF token" },
        { status: 403 }
      );
    }

    return NextResponse.next();
  }

  // --- 2. Auth check for protected routes ---
  if (isProtectedRoute(pathname)) {
    const sessionCookie = getSessionCookie(request);
    if (!sessionCookie) {
      const returnTo = isSafeReturnTo(pathname + request.nextUrl.search);
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("returnTo", returnTo);
      return NextResponse.redirect(loginUrl);
    }
  }

  // --- 3. All page/GET requests: set CSP nonce + CSRF cookies ---
  const nonce = crypto.randomUUID().replace(/-/g, "");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });

  response.headers.set("Content-Security-Policy", buildCsp(nonce));
  await ensureCsrfCookies(request, response);

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|manifest\\.json|icons|sw\\.js|offline\\.html).*)",
  ],
};
