import { NextResponse } from "next/server";
import { eq, desc, sql } from "drizzle-orm";
import { withApiHandler } from "@/lib/api-handler";
import { createAlbumSchema } from "@/lib/api-validation";
import { logger } from "@/lib/logger";
import { albums, photoAlbums } from "@/lib/schema";
import { forSalon } from "@/lib/server/repository";
import type { z } from "zod";
// GET /api/albums - List albums for a salon
export const GET = withApiHandler(
  {
    auth: "user",
    logLabel: "[Albums API] GET",
    errorMessage: "Failed to fetch albums",
  },
  async ({ request }) => {
    const { searchParams } = new URL(request.url);
    const salonId = searchParams.get("salonId");

    if (!salonId) {
      return NextResponse.json(
        { success: false, error: "salonId is required" },
        { status: 400 }
      );
    }

    // Get albums with photo count
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
  }
);

// POST /api/albums - Create a new album
export const POST = withApiHandler(
  {
    auth: "user",
    schema: createAlbumSchema as z.ZodType<{
      salonId: string;
      name: string;
      description?: string | null;
      category?: string | null;
    }>,
    logLabel: "[Albums API] POST",
    errorMessage: "Failed to create album",
  },
  async ({ body }) => {
    const { salonId, name, category } = body;

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
  }
);
