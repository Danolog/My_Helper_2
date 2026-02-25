import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { salons } from "@/lib/schema";

/**
 * Server-side helper to get the authenticated user's salon.
 * Use in API routes to replace hardcoded DEMO_SALON_ID.
 *
 * Returns the salon row or null if not found / not authenticated.
 */
export async function getUserSalon() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;

  const [salon] = await db
    .select()
    .from(salons)
    .where(eq(salons.ownerId, session.user.id))
    .limit(1);

  return salon ?? null;
}

/**
 * Gets just the salon ID for the authenticated user.
 * Convenience wrapper when you only need the ID.
 */
export async function getUserSalonId(): Promise<string | null> {
  const salon = await getUserSalon();
  return salon?.id ?? null;
}
