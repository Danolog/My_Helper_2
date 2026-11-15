import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import sharp from "sharp";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";
import { logger } from "@/lib/logger";
import { strictRateLimit, getClientIp } from "@/lib/rate-limit";
import { upload } from "@/lib/storage";


// Rozszerzenie nadajemy WYŁĄCZNIE z formatu wykrytego przez sharp (magic
// bytes), nigdy z nazwy pliku ani z deklarowanego przez klienta MIME —
// inaczej dałoby się zapisać np. .html/.svg do public/uploads (stored XSS).
const EXT_BY_FORMAT: Record<string, string> = {
  jpeg: "jpg",
  png: "png",
  webp: "webp",
  gif: "gif",
};
// POST /api/gallery/upload - Upload a photo file
export async function POST(request: Request) {
  try {
    const ip = getClientIp(request);
    const rateLimitResult = strictRateLimit.check(ip);
    if (!rateLimitResult.success) {
      return NextResponse.json(
        { success: false, error: "Zbyt wiele żądań. Spróbuj ponownie później." },
        { status: 429, headers: { "Retry-After": String(Math.ceil(rateLimitResult.reset / 1000)) } }
      );
    }

    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json(
        { success: false, error: "No file provided" },
        { status: 400 }
      );
    }

    // Validate file type
    const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json(
        { success: false, error: "Invalid file type. Allowed: JPEG, PNG, WebP, GIF" },
        { status: 400 }
      );
    }

    // Validate file size (max 10MB)
    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) {
      return NextResponse.json(
        { success: false, error: "File too large. Maximum size: 10MB" },
        { status: 400 }
      );
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Verify magic bytes: the buffer must decode as a real image and its
    // sniffed format must be on the allowlist. file.type above is only a
    // client-declared hint; this check is the actual gate.
    let detectedFormat: string | undefined;
    try {
      detectedFormat = (await sharp(buffer).metadata()).format;
    } catch {
      detectedFormat = undefined;
    }
    const ext = detectedFormat ? EXT_BY_FORMAT[detectedFormat] : undefined;
    if (!ext) {
      return NextResponse.json(
        { success: false, error: "Invalid file content. Allowed: JPEG, PNG, WebP, GIF" },
        { status: 400 }
      );
    }

    // Generate unique filename (extension from sniffed format, not file.name)
    const filename = `${randomUUID()}.${ext}`;

    // Real thumbnail (max 400px wide) instead of a full-size copy
    const thumbBuffer = await sharp(buffer)
      .resize({ width: 400, withoutEnlargement: true })
      .toBuffer();

    // Storage layer: driver from lib/storage.resolveStorageDriver (GCS, Vercel
    // Blob, or local filesystem in dev only). Writing straight to public/uploads would
    // 404 on Vercel — the runtime filesystem is ephemeral and per-instance.
    const maxConfig = { maxSize };
    const [fileResult, thumbResult] = await Promise.all([
      upload(buffer, filename, "gallery", maxConfig),
      upload(thumbBuffer, filename, "gallery/thumbs", maxConfig),
    ]);

    const url = fileResult.url;
    const thumbnailUrl = thumbResult.url;

    logger.info(`[Gallery Upload] File uploaded: ${filename} (${file.size} bytes)`);

    return NextResponse.json({
      success: true,
      data: {
        url,
        thumbnailUrl,
        filename,
        size: file.size,
        type: file.type,
      },
    });
  } catch (error) {
    logger.error("[Gallery Upload] Error", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to upload file" },
      { status: 500 }
    );
  }
}
