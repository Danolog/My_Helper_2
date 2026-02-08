import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import { favoriteSalons, salons } from "@/lib/schema";
import { eq, and } from "drizzle-orm";
import { auth } from "@/lib/auth";

// GET /api/favorites/salons - List favorite salons for authenticated user
export async function GET() {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const userId = session.user.id;

    const favorites = await db
      .select({
        id: favoriteSalons.id,
        salonId: favoriteSalons.salonId,
        createdAt: favoriteSalons.createdAt,
        salonName: salons.name,
        salonPhone: salons.phone,
        salonEmail: salons.email,
        salonAddress: salons.address,
        salonIndustryType: salons.industryType,
      })
      .from(favoriteSalons)
      .innerJoin(salons, eq(favoriteSalons.salonId, salons.id))
      .where(eq(favoriteSalons.clientUserId, userId));

    return NextResponse.json({
      success: true,
      data: favorites,
      count: favorites.length,
    });
  } catch (error) {
    console.error("[Favorites API] Error fetching favorites:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch favorite salons" },
      { status: 500 }
    );
  }
}

// POST /api/favorites/salons - Add a salon to favorites
export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const userId = session.user.id;
    const body = await request.json();
    const { salonId } = body;

    if (!salonId) {
      return NextResponse.json(
        { success: false, error: "salonId is required" },
        { status: 400 }
      );
    }

    // Check if salon exists
    const [salon] = await db.select().from(salons).where(eq(salons.id, salonId));
    if (!salon) {
      return NextResponse.json(
        { success: false, error: "Salon not found" },
        { status: 404 }
      );
    }

    // Check if already favorited
    const [existing] = await db
      .select()
      .from(favoriteSalons)
      .where(
        and(
          eq(favoriteSalons.clientUserId, userId),
          eq(favoriteSalons.salonId, salonId)
        )
      );

    if (existing) {
      return NextResponse.json(
        { success: false, error: "Salon already in favorites" },
        { status: 409 }
      );
    }

    const [newFavorite] = await db
      .insert(favoriteSalons)
      .values({
        clientUserId: userId,
        salonId,
      })
      .returning();

    return NextResponse.json(
      {
        success: true,
        data: newFavorite,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("[Favorites API] Error adding favorite:", error);
    return NextResponse.json(
      { success: false, error: "Failed to add salon to favorites" },
      { status: 500 }
    );
  }
}

// DELETE /api/favorites/salons?salonId=<uuid> - Remove a salon from favorites
export async function DELETE(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const userId = session.user.id;
    const { searchParams } = new URL(request.url);
    const salonId = searchParams.get("salonId");

    if (!salonId) {
      return NextResponse.json(
        { success: false, error: "salonId query parameter is required" },
        { status: 400 }
      );
    }

    const [deleted] = await db
      .delete(favoriteSalons)
      .where(
        and(
          eq(favoriteSalons.clientUserId, userId),
          eq(favoriteSalons.salonId, salonId)
        )
      )
      .returning();

    if (!deleted) {
      return NextResponse.json(
        { success: false, error: "Favorite not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: deleted,
    });
  } catch (error) {
    console.error("[Favorites API] Error removing favorite:", error);
    return NextResponse.json(
      { success: false, error: "Failed to remove salon from favorites" },
      { status: 500 }
    );
  }
}
