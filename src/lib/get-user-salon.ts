import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getUserSalon as getUserSalonByOwner } from "@/lib/server/system";

/**
 * Server-side helper to get the authenticated user's salon.
 * Use in API routes to replace hardcoded DEMO_SALON_ID.
 *
 * Returns the salon row or null if not found / not authenticated.
 * Zapytanie: wyjście systemowe `system/session.ts` (#193).
 */
export async function getUserSalon() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;

  return getUserSalonByOwner(session.user.id);
}

/**
 * Gets just the salon ID for the authenticated user.
 * Convenience wrapper when you only need the ID.
 */
export async function getUserSalonId(): Promise<string | null> {
  const salon = await getUserSalon();
  return salon?.id ?? null;
}
