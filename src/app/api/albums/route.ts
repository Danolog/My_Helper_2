import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { albums, photoAlbums, galleryPhotos } from "@/lib/schema";
import { eq, desc, and, sql, count } from "drizzle-orm";

// GET /api/albums - List albums for a salon
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const salonId = searchParams.get("salonId");

    if (!salonId) {
      return NextResponse.json(
        { success: false, error: "salonId is required" },
        { status: 400 }
      );
    }

    // Get albums with photo count
    const albumsList = await db
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
      .orderBy(desc(albums.createdAt));

    console.log(`[Albums API] GET: ${albumsList.length} albums found for salon ${salonId}`);

    return NextResponse.json({
      success: true,
      data: albumsList,
      count: albumsList.length,
    });
  } catch (error) {
    console.error("[Albums API] Database error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch albums" },
      { status: 500 }
    );
  }
}

// POST /api/albums - Create a new album
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { salonId, name, category } = body;

    if (!salonId) {
      return NextResponse.json(
        { success: false, error: "salonId is required" },
        { status: 400 }
      );
    }

    if (!name || !name.trim()) {
      return NextResponse.json(
        { success: false, error: "Album name is required" },
        { status: 400 }
      );
    }

    const [newAlbum] = await db
      .insert(albums)
      .values({
        salonId,
        name: name.trim(),
        category: category?.trim() || null,
      })
      .returning();

    console.log(`[Albums API] Created album: ${newAlbum?.id} - "${newAlbum?.name}"`);

    return NextResponse.json(
      {
        success: true,
        data: { ...newAlbum, photoCount: 0 },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("[Albums API] Database error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to create album" },
      { status: 500 }
    );
  }
}
