import { eq } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { salons } from "@/lib/schema";

/**
 * Protected routes that require authentication.
 * These are also configured in src/proxy.ts for optimistic redirects.
 */
export const protectedRoutes = ["/chat", "/dashboard", "/profile", "/admin"];

/**
 * Admin routes that require owner/admin role in addition to authentication.
 */
export const adminRoutes = ["/admin"];

/**
 * Checks if the current request is authenticated.
 * Should be called in Server Components for protected routes.
 *
 * @returns The session object if authenticated
 * @throws Redirects to home page if not authenticated
 */
export async function requireAuth() {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) {
    redirect("/");
  }

  return session;
}

/**
 * Checks if the current user is authenticated AND is a salon owner (admin).
 * Should be called in Server Components for admin-only routes.
 *
 * A user is considered admin if:
 * - Their user.role is "admin" or "owner", OR
 * - They own a salon (salons.ownerId matches their user ID)
 *
 * @returns Object with session and isAdmin boolean
 * @throws Redirects to login page if not authenticated
 */
export async function requireAdmin(): Promise<{
  session: Awaited<ReturnType<typeof auth.api.getSession>>;
  isAdmin: boolean;
}> {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) {
    redirect("/login");
  }

  // Check user role
  const userRole = (session.user as { role?: string }).role;
  if (userRole === "admin" || userRole === "owner") {
    return { session, isAdmin: true };
  }

  // Check salon ownership
  const [salon] = await db
    .select({ id: salons.id })
    .from(salons)
    .where(eq(salons.ownerId, session.user.id))
    .limit(1);

  return { session, isAdmin: !!salon };
}

/**
 * Gets the current session without requiring authentication.
 * Returns null if not authenticated.
 *
 * @returns The session object or null
 */
export async function getOptionalSession() {
  return await auth.api.getSession({ headers: await headers() });
}

/**
 * Checks if a session cookie exists without calling auth.api.getSession().
 *
 * Workaround for Better Auth v1.4.x bug where auth.api.getSession() returns
 * null in Next.js server components despite valid session cookies being present.
 * This function checks cookie existence directly, which is sufficient for
 * redirect-only guards on public pages (login, register, portal landing).
 *
 * NOTE: This does NOT validate the session against the database. Use
 * requireAuth() for protected routes that need a verified session object.
 *
 * @returns True if a session cookie is present
 */
export async function hasActiveSession(): Promise<boolean> {
  const cookieStore = await cookies();
  return (
    cookieStore.has("better-auth.session_token") ||
    cookieStore.has("__Secure-better-auth.session_token")
  );
}

/**
 * Checks if a given path is a protected route.
 *
 * @param path - The path to check
 * @returns True if the path requires authentication
 */
export function isProtectedRoute(path: string): boolean {
  return protectedRoutes.some(
    (route) => path === route || path.startsWith(`${route}/`)
  );
}

/**
 * Checks if a given path is an admin-only route.
 *
 * @param path - The path to check
 * @returns True if the path requires admin access
 */
export function isAdminRoute(path: string): boolean {
  return adminRoutes.some(
    (route) => path === route || path.startsWith(`${route}/`)
  );
}
