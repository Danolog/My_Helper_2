import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { albums, photoAlbums } from "@/lib/schema";
import { eq, and, sql } from "drizzle-orm";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";
import { getUserSalonId } from "@/lib/get-user-salon";
import { validateBody, updateAlbumSchema } from "@/lib/api-validation";

import { logger } from "@/lib/logger";
// GET /api/albums/[id] - Get single album with photo count
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

    const salonId = await getUserSalonId();
    if (!salonId) {
      return NextResponse.json(
        { success: false, error: "Salon not found" },
        { status: 404 }
      );
    }

    const { id } = await params;

    const [album] = await db
      .select({
        id: albums.id,
        salonId: albums.salonId,
        name: albums.name,
        category: albums.category,
        createdAt: albums.createdAt,
        photoCount: sql<number>`COALESCE(COUNT(${photoAlbums.id}), 0)::int`,
      })
      .from(albums)
      .leftJoin(photoAlbums, eq(albums.id, photoAlbums.albumId))
      .where(and(eq(albums.id, id), eq(albums.salonId, salonId)))
      .groupBy(albums.id);

    if (!album) {
      return NextResponse.json(
        { success: false, error: "Album not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: album,
    });
  } catch (error) {
    logger.error("[Albums API] Database error", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to fetch album" },
      { status: 500 }
    );
  }
}

// PATCH /api/albums/[id] - Update album name/category
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

    const salonId = await getUserSalonId();
    if (!salonId) {
      return NextResponse.json(
        { success: false, error: "Salon not found" },
        { status: 404 }
      );
    }

    const { id } = await params;
    const body = await request.json();
    const validationError = validateBody(updateAlbumSchema, body);
    if (validationError) {
      return NextResponse.json(validationError, { status: 400 });
    }
    const { name, category } = body;

    const updateData: Record<string, string | null> = {};
    if (name !== undefined) {
      if (!name.trim()) {
        return NextResponse.json(
          { success: false, error: "Album name cannot be empty" },
          { status: 400 }
        );
      }
      updateData.name = name.trim();
    }
    if (category !== undefined) {
      updateData.category = category?.trim() || null;
    }

    const [updated] = await db
      .update(albums)
      .set(updateData)
      .where(and(eq(albums.id, id), eq(albums.salonId, salonId)))
      .returning();

    if (!updated) {
      return NextResponse.json(
        { success: false, error: "Album not found" },
        { status: 404 }
      );
    }

    logger.info(`[Albums API] Updated album: ${id}`);

    return NextResponse.json({
      success: true,
      data: updated,
    });
  } catch (error) {
    logger.error("[Albums API] Database error", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to update album" },
      { status: 500 }
    );
  }
}

// DELETE /api/albums/[id] - Delete album (does NOT delete photos, only the album grouping)
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

    const salonId = await getUserSalonId();
    if (!salonId) {
      return NextResponse.json(
        { success: false, error: "Salon not found" },
        { status: 404 }
      );
    }

    const { id } = await params;

    // Check album exists in the caller's salon
    const [album] = await db
      .select()
      .from(albums)
      .where(and(eq(albums.id, id), eq(albums.salonId, salonId)));

    if (!album) {
      return NextResponse.json(
        { success: false, error: "Album not found" },
        { status: 404 }
      );
    }

    // Delete album (cascade will remove photo_albums entries)
    await db.delete(albums).where(and(eq(albums.id, id), eq(albums.salonId, salonId)));

    logger.info(`[Albums API] Deleted album: ${id} - "${album.name}"`);

    return NextResponse.json({
      success: true,
      message: "Album deleted successfully",
    });
  } catch (error) {
    logger.error("[Albums API] Database error", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to delete album" },
      { status: 500 }
    );
  }
}
