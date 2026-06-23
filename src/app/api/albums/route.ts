import { NextResponse } from "next/server";
import { albums, photoAlbums } from "@/lib/schema";
import { eq, desc, sql } from "drizzle-orm";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";
import { getUserSalonId } from "@/lib/get-user-salon";
import { validateBody, createAlbumSchema } from "@/lib/api-validation";
import { forSalon } from "@/lib/server/repository";

import { logger } from "@/lib/logger";
// GET /api/albums - List albums for a salon
export async function GET(_request: Request) {
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

    // Get albums with photo count — przez forSalon (RLS); jawny eq(albums.salonId) zachowany.
    const albumsList = await forSalon(salonId).raw((tx) =>
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
        .where(eq(albums.salonId, salonId))
        .groupBy(albums.id)
        .orderBy(desc(albums.createdAt))
    );

    logger.info(`[Albums API] GET: ${albumsList.length} albums found for salon ${salonId}`);

    return NextResponse.json({
      success: true,
      data: albumsList,
      count: albumsList.length,
    });
  } catch (error) {
    logger.error("[Albums API] Database error", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to fetch albums" },
      { status: 500 }
    );
  }
}

// POST /api/albums - Create a new album
export async function POST(request: Request) {
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

    const body = await request.json();
    const validationError = validateBody(createAlbumSchema, body);
    if (validationError) {
      return NextResponse.json(validationError, { status: 400 });
    }
    const { name, category } = body;

    const [newAlbum] = await forSalon(salonId).raw((tx) =>
      tx
        .insert(albums)
        .values({
          salonId,
          name: name.trim(),
          category: category?.trim() || null,
        })
        .returning()
    );

    logger.info(`[Albums API] Created album: ${newAlbum?.id} - "${newAlbum?.name}"`);

    return NextResponse.json(
      {
        success: true,
        data: { ...newAlbum, photoCount: 0 },
      },
      { status: 201 }
    );
  } catch (error) {
    logger.error("[Albums API] Database error", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to create album" },
      { status: 500 }
    );
  }
}
