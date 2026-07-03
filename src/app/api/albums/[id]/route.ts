import { NextResponse } from "next/server";
import { eq, and, sql } from "drizzle-orm";
import { withApiHandler } from "@/lib/api-handler";
import { validateBody, updateAlbumSchema } from "@/lib/api-validation";
import { getUserSalonId } from "@/lib/get-user-salon";
import { logger } from "@/lib/logger";
import { albums, photoAlbums } from "@/lib/schema";
import { forSalon } from "@/lib/server/repository";
// GET /api/albums/[id] - Get single album with photo count
export const GET = withApiHandler(
  {
    auth: "user",
    logLabel: "[Albums API] GET [id]",
    errorMessage: "Failed to fetch album",
  },
  async ({ params }) => {
    const salonId = await getUserSalonId();
    if (!salonId) {
      return NextResponse.json(
        { success: false, error: "Salon not found" },
        { status: 404 }
      );
    }

    const id = params.id!; // segment [id] zawsze obecny (noUncheckedIndexedAccess)

    const [album] = await forSalon(salonId).raw((tx) =>
      tx
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
        .groupBy(albums.id)
    );

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
  }
);

// PATCH /api/albums/[id] - Update album name/category
export const PATCH = withApiHandler(
  {
    auth: "user",
    logLabel: "[Albums API] PATCH",
    errorMessage: "Failed to update album",
  },
  async ({ request, params }) => {
    const salonId = await getUserSalonId();
    if (!salonId) {
      return NextResponse.json(
        { success: false, error: "Salon not found" },
        { status: 404 }
      );
    }

    const id = params.id!; // segment [id] zawsze obecny (noUncheckedIndexedAccess)
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

    const updated = await forSalon(salonId).updateOwned(albums, id, updateData);

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
  }
);

// DELETE /api/albums/[id] - Delete album (does NOT delete photos, only the album grouping)
export const DELETE = withApiHandler(
  {
    auth: "user",
    logLabel: "[Albums API] DELETE",
    errorMessage: "Failed to delete album",
  },
  async ({ params }) => {
    const salonId = await getUserSalonId();
    if (!salonId) {
      return NextResponse.json(
        { success: false, error: "Salon not found" },
        { status: 404 }
      );
    }

    const id = params.id!; // segment [id] zawsze obecny (noUncheckedIndexedAccess)

    // Check album exists in the caller's salon
    const album = await forSalon(salonId).findOne(albums, id);

    if (!album) {
      return NextResponse.json(
        { success: false, error: "Album not found" },
        { status: 404 }
      );
    }

    // Delete album (cascade will remove photo_albums entries)
    await forSalon(salonId).deleteOwned(albums, id);

    logger.info(`[Albums API] Deleted album: ${id} - "${album.name}"`);

    return NextResponse.json({
      success: true,
      message: "Album deleted successfully",
    });
  }
);
