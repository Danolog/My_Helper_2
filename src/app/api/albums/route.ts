import { NextResponse } from "next/server";
import { eq, desc, sql } from "drizzle-orm";
import { withApiHandler } from "@/lib/api-handler";
import { createAlbumSchema } from "@/lib/api-validation";
import { logger } from "@/lib/logger";
import { requireSalonStaff } from "@/lib/salon-context";
import { albums, photoAlbums } from "@/lib/schema";
import { forSalon } from "@/lib/server/repository";
import type { z } from "zod";
/** Dostęp do albumów = dostęp do galerii: owner, employee; receptionist z grantem. */
const GALLERY_ACCESS = { roles: ["employee"], feature: "gallery-manage" } as const;

// GET /api/albums - List albums for a salon
export const GET = withApiHandler(
  {
    auth: "user",
    logLabel: "[Albums API] GET",
    errorMessage: "Failed to fetch albums",
  },
  async ({ request }) => {
    const { searchParams } = new URL(request.url);
    // P2 (przegląd bezpieczeństwa): salon WYŁĄCZNIE z sesji — wcześniej ?salonId=<cudzy>
    // listował albumy galerii dowolnego salonu. Query tylko porównywane (inne =>
    // 403), brak => salon sesji. Role jak w galerii (POST /api/gallery,
    // ROUTE_ROLE_MAP /dashboard/gallery): właściciel i pracownik, recepcja z
    // grantem "gallery-manage".
    const guard = await requireSalonStaff({
      ...GALLERY_ACCESS,
      requestedSalonId: searchParams.get("salonId"),
    });
    if (guard.error) return guard.error;
    const salonId = guard.ctx.salonId;

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
    // P1 (przegląd bezpieczeństwa): salon WYŁĄCZNIE z sesji — wcześniej forSalon(body.salonId)
    // pozwalał każdemu zalogowanemu kontu założyć album w cudzym salonie.
    // body.salonId tylko porównywany (inny => 403).
    const guard = await requireSalonStaff({
      ...GALLERY_ACCESS,
      requestedSalonId: body.salonId,
    });
    if (guard.error) return guard.error;
    const salonId = guard.ctx.salonId;

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
  }
);
