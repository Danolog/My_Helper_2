import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { salons } from "@/lib/schema";

/**
 * GET /api/salons/mine
 *
 * Returns the salon owned by the currently authenticated user.
 * Looks up salons where ownerId matches the session user's ID.
 *
 * Response shape:
 *   { success: true, salon: { id, name, ... } }    -- salon found
 *   { success: true, salon: null }                  -- no salon for this user
 *   { success: false, error: "..." }                -- auth or server error
 */
export async function GET() {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      return NextResponse.json(
        { success: false, error: "Wymagane logowanie" },
        { status: 401 },
      );
    }

    const [salon] = await db
      .select({
        id: salons.id,
        name: salons.name,
        phone: salons.phone,
        email: salons.email,
        address: salons.address,
        industryType: salons.industryType,
      })
      .from(salons)
      .where(eq(salons.ownerId, session.user.id))
      .limit(1);

    return NextResponse.json({
      success: true,
      salon: salon ?? null,
    });
  } catch (error) {
    console.error("[Salons Mine API] Error:", error);
    return NextResponse.json(
      { success: false, error: "Nie udalo sie pobrac salonu" },
      { status: 500 },
    );
  }
}
