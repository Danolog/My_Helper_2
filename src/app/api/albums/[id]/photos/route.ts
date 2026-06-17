import { NextResponse } from "next/server";
import { albums, photoAlbums, galleryPhotos, employees, services } from "@/lib/schema";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";
import { getUserSalonId } from "@/lib/get-user-salon";
import { validateBody, albumPhotosSchema } from "@/lib/api-validation";
import { forSalon } from "@/lib/server/repository";

import { logger } from "@/lib/logger";
// GET /api/albums/[id]/photos - Get all photos in an album
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

    // Verify album exists in the caller's salon
    const album = await forSalon(salonId).findOne(albums, id);

    if (!album) {
      return NextResponse.json(
        { success: false, error: "Album not found" },
        { status: 404 }
      );
    }

    // Get photos in this album with metadata (tabele salon-scoped — RLS w kontekscie)
    const photos = await forSalon(salonId).raw((tx) =>
      tx
      .select({
        id: galleryPhotos.id,
        salonId: galleryPhotos.salonId,
        employeeId: galleryPhotos.employeeId,
        serviceId: galleryPhotos.serviceId,
        beforePhotoUrl: galleryPhotos.beforePhotoUrl,
        afterPhotoUrl: galleryPhotos.afterPhotoUrl,
        description: galleryPhotos.description,
        productsUsed: galleryPhotos.productsUsed,
        techniques: galleryPhotos.techniques,
        duration: galleryPhotos.duration,
        showProductsToClients: galleryPhotos.showProductsToClients,
        createdAt: galleryPhotos.createdAt,
        employeeFirstName: employees.firstName,
        employeeLastName: employees.lastName,
        serviceName: services.name,
        photoAlbumId: photoAlbums.id,
      })
      .from(photoAlbums)
      .innerJoin(galleryPhotos, eq(photoAlbums.photoId, galleryPhotos.id))
      .leftJoin(employees, eq(galleryPhotos.employeeId, employees.id))
      .leftJoin(services, eq(galleryPhotos.serviceId, services.id))
      .where(eq(photoAlbums.albumId, id))
      .orderBy(desc(galleryPhotos.createdAt))
    );

    logger.info(`[Albums API] GET photos: ${photos.length} photos in album "${album.name}"`);

    return NextResponse.json({
      success: true,
      data: photos,
      album: {
        id: album.id,
        name: album.name,
        category: album.category,
      },
      count: photos.length,
    });
  } catch (error) {
    logger.error("[Albums API] Database error", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to fetch album photos" },
      { status: 500 }
    );
  }
}

// POST /api/albums/[id]/photos - Add photo(s) to album
export async function POST(
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
    const validationError = validateBody(albumPhotosSchema, body);
    if (validationError) {
      return NextResponse.json(validationError, { status: 400 });
    }
    const { photoIds } = body;

    // Verify album exists in the caller's salon
    const album = await forSalon(salonId).findOne(albums, id);

    if (!album) {
      return NextResponse.json(
        { success: false, error: "Album not found" },
        { status: 404 }
      );
    }

    // Walidacja wlasnosci zdjec + dedup + insert atomowo w jednej transakcji RLS.
    const newPhotoIds = await forSalon(salonId).raw(async (tx) => {
      // Only allow photos that belong to the caller's salon
      const ownedPhotos = await tx
        .select({ id: galleryPhotos.id })
        .from(galleryPhotos)
        .where(and(eq(galleryPhotos.salonId, salonId)));
      const ownedPhotoIds = new Set(ownedPhotos.map((p) => p.id));
      const requestedOwned = (photoIds as string[]).filter((pid) => ownedPhotoIds.has(pid));

      // Check which photos are already in the album to avoid duplicates
      const existing = await tx
        .select({ photoId: photoAlbums.photoId })
        .from(photoAlbums)
        .where(eq(photoAlbums.albumId, id));

      const existingIds = new Set(existing.map((e) => e.photoId));
      const toAdd = requestedOwned.filter((pid: string) => !existingIds.has(pid));

      if (toAdd.length > 0) {
        // Insert photo-album associations
        const values = toAdd.map((photoId: string) => ({
          photoId,
          albumId: id,
        }));
        await tx.insert(photoAlbums).values(values);
      }

      return toAdd;
    });

    if (newPhotoIds.length === 0) {
      return NextResponse.json({
        success: true,
        message: "All photos are already in this album",
        added: 0,
      });
    }

    logger.info(`[Albums API] Added ${newPhotoIds.length} photos to album "${album.name}"`);

    return NextResponse.json(
      {
        success: true,
        message: `Added ${newPhotoIds.length} photo(s) to album`,
        added: newPhotoIds.length,
      },
      { status: 201 }
    );
  } catch (error) {
    logger.error("[Albums API] Database error", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to add photos to album" },
      { status: 500 }
    );
  }
}

// DELETE /api/albums/[id]/photos - Remove photo(s) from album
export async function DELETE(
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
    const { searchParams } = new URL(request.url);
    const photoId = searchParams.get("photoId");

    if (!photoId) {
      return NextResponse.json(
        { success: false, error: "photoId query parameter is required" },
        { status: 400 }
      );
    }

    // Verify the album belongs to the caller's salon
    const album = await forSalon(salonId).findOne(albums, id);
    if (!album) {
      return NextResponse.json(
        { success: false, error: "Album not found" },
        { status: 404 }
      );
    }

    // Delete the photo-album association (photoAlbums salon-scoped posrednio — RLS w kontekscie)
    const deleted = await forSalon(salonId).raw((tx) =>
      tx
        .delete(photoAlbums)
        .where(
          and(
            eq(photoAlbums.albumId, id),
            eq(photoAlbums.photoId, photoId)
          )
        )
        .returning()
    );

    if (deleted.length === 0) {
      return NextResponse.json(
        { success: false, error: "Photo not found in this album" },
        { status: 404 }
      );
    }

    logger.info(`[Albums API] Removed photo ${photoId} from album ${id}`);

    return NextResponse.json({
      success: true,
      message: "Photo removed from album",
    });
  } catch (error) {
    logger.error("[Albums API] Database error", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to remove photo from album" },
      { status: 500 }
    );
  }
}
