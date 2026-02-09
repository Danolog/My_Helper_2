import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { galleryPhotos, employees, services } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { unlink } from "fs/promises";
import path from "path";

type RouteParams = { params: Promise<{ id: string }> };

// GET /api/gallery/[id] - Get a single gallery photo
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;

    const [photo] = await db
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
        createdAt: galleryPhotos.createdAt,
        employeeFirstName: employees.firstName,
        employeeLastName: employees.lastName,
        serviceName: services.name,
      })
      .from(galleryPhotos)
      .leftJoin(employees, eq(galleryPhotos.employeeId, employees.id))
      .leftJoin(services, eq(galleryPhotos.serviceId, services.id))
      .where(eq(galleryPhotos.id, id));

    if (!photo) {
      return NextResponse.json(
        { success: false, error: "Photo not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: photo,
    });
  } catch (error) {
    console.error("[Gallery API] Error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch photo" },
      { status: 500 }
    );
  }
}

// DELETE /api/gallery/[id] - Delete a gallery photo
export async function DELETE(_request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;

    // Get photo first to find file path
    const [photo] = await db
      .select()
      .from(galleryPhotos)
      .where(eq(galleryPhotos.id, id));

    if (!photo) {
      return NextResponse.json(
        { success: false, error: "Photo not found" },
        { status: 404 }
      );
    }

    // Delete from database
    await db.delete(galleryPhotos).where(eq(galleryPhotos.id, id));

    // Try to delete files from disk (non-critical)
    const photoUrls = [photo.beforePhotoUrl, photo.afterPhotoUrl].filter(Boolean);
    for (const url of photoUrls) {
      if (url && url.startsWith("/uploads/")) {
        try {
          const filePath = path.join(process.cwd(), "public", url);
          await unlink(filePath);
          // Also try to delete thumbnail
          const thumbPath = filePath.replace("/gallery/", "/gallery/thumbs/");
          await unlink(thumbPath).catch(() => {});
        } catch {
          // File might not exist, that's ok
        }
      }
    }

    console.log(`[Gallery API] Deleted photo: ${id}`);

    return NextResponse.json({
      success: true,
      message: "Photo deleted successfully",
    });
  } catch (error) {
    console.error("[Gallery API] Error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to delete photo" },
      { status: 500 }
    );
  }
}
