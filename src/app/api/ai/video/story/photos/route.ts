import { eq, desc } from "drizzle-orm";
import { requireProAI, isProAIError } from "@/lib/ai/openrouter";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { galleryPhotos, services } from "@/lib/schema";

// ────────────────────────────────────────────────────────────
// GET /api/ai/video/story/photos
//
// Returns a lightweight list of the salon's gallery photos for
// the story generator's optional photo picker. Limited to the
// 20 most recent photos to keep the response small.
// ────────────────────────────────────────────────────────────

const MAX_PHOTOS = 20;

export async function GET() {
  // Auth + Pro plan check (same gate as story generation)
  const proResult = await requireProAI();
  if (isProAIError(proResult)) return proResult;
  const { salonId } = proResult;

  try {
    const photos = await db
      .select({
        id: galleryPhotos.id,
        afterPhotoUrl: galleryPhotos.afterPhotoUrl,
        beforePhotoUrl: galleryPhotos.beforePhotoUrl,
        description: galleryPhotos.description,
        serviceName: services.name,
      })
      .from(galleryPhotos)
      .leftJoin(services, eq(galleryPhotos.serviceId, services.id))
      .where(eq(galleryPhotos.salonId, salonId))
      .orderBy(desc(galleryPhotos.createdAt))
      .limit(MAX_PHOTOS);

    // Only return photos that have at least one image URL
    const withImages = photos.filter(
      (p) => p.afterPhotoUrl || p.beforePhotoUrl,
    );

    return Response.json({ success: true, photos: withImages });
  } catch (error) {
    logger.error("[AI Video] Failed to fetch gallery photos for story", {
      error,
      salonId,
    });
    return Response.json(
      { error: "Nie udalo sie pobrac zdjec z galerii" },
      { status: 500 },
    );
  }
}
