import sharp from "sharp";
import { z } from "zod";
import { requireProAI, isProAIError } from "@/lib/ai/openrouter";
import { logger } from "@/lib/logger";
import { upload } from "@/lib/storage";

/**
 * Maximum allowed image size for enhancement (10 MB).
 * Larger files are rejected to protect server memory.
 */
const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;

const requestSchema = z.object({
  imageUrl: z.string().url("Nieprawidlowy URL obrazu"),
  preset: z
    .enum(["auto", "brighten", "sharpen", "warm", "cool", "vibrant", "bw"])
    .default("auto"),
});

/**
 * Enhancement presets. Each function takes a sharp pipeline and returns
 * the same pipeline with image-processing operations chained on.
 *
 * All presets are non-destructive — they operate on a copy of the original
 * and produce a new JPEG output.
 */
const PRESETS: Record<string, (img: sharp.Sharp) => sharp.Sharp> = {
  auto: (img) =>
    img
      .modulate({ brightness: 1.05, saturation: 1.1 })
      .sharpen({ sigma: 1.2 })
      .normalise(),

  brighten: (img) =>
    img
      .modulate({ brightness: 1.15 })
      .gamma(1.1)
      .normalise(),

  sharpen: (img) =>
    img
      .sharpen({ sigma: 2.0, m1: 1.0, m2: 0.5 })
      .modulate({ brightness: 1.02 }),

  warm: (img) =>
    img
      .modulate({ brightness: 1.05, saturation: 1.15, hue: 10 })
      .tint({ r: 255, g: 240, b: 220 }),

  cool: (img) =>
    img
      .modulate({ brightness: 1.05, saturation: 0.95, hue: -10 })
      .tint({ r: 220, g: 230, b: 255 }),

  vibrant: (img) =>
    img
      .modulate({ brightness: 1.05, saturation: 1.35 })
      .sharpen({ sigma: 1.0 })
      .normalise(),

  bw: (img) =>
    img
      .grayscale()
      .modulate({ brightness: 1.05 })
      .sharpen({ sigma: 1.5 })
      .normalise(),
};

export async function POST(req: Request) {
  // Auth + Pro plan gate
  const proResult = await requireProAI();
  if (isProAIError(proResult)) return proResult;
  const { salonId } = proResult;

  // Parse request body
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      {
        error: "Nieprawidlowe dane wejsciowe",
        details: parsed.error.flatten().fieldErrors,
      },
      { status: 400 },
    );
  }

  const { imageUrl, preset } = parsed.data;

  try {
    // Fetch the original image from storage
    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) {
      return Response.json(
        { error: "Nie udalo sie pobrac obrazu" },
        { status: 400 },
      );
    }

    const arrayBuffer = await imageResponse.arrayBuffer();
    const imageBuffer = Buffer.from(arrayBuffer);

    // Guard against oversized images to protect server memory
    if (imageBuffer.length > MAX_IMAGE_SIZE_BYTES) {
      return Response.json(
        { error: "Obraz jest zbyt duzy. Maksymalny rozmiar to 10 MB." },
        { status: 400 },
      );
    }

    // Read original metadata before enhancement (for the response)
    const metadata = await sharp(imageBuffer).metadata();

    // Apply the selected enhancement preset.
    // `preset` is validated by zod to be one of the PRESETS keys,
    // so the fallback to "auto" is purely a safety net.
    const presetFn = preset in PRESETS ? PRESETS[preset] : PRESETS.auto;
    const pipeline = presetFn!(sharp(imageBuffer));

    // Output as high-quality JPEG
    const enhancedBuffer = await pipeline
      .jpeg({ quality: 90 })
      .toBuffer();

    // Upload enhanced image to storage
    const filename = `enhanced-${salonId}-${Date.now()}.jpg`;
    const stored = await upload(enhancedBuffer, filename, "enhanced", {
      maxSize: MAX_IMAGE_SIZE_BYTES,
      allowedTypes: ["image/jpeg"],
    });

    logger.info("[AI Image] Photo enhanced", {
      salonId,
      preset,
      originalSize: imageBuffer.length,
      enhancedSize: enhancedBuffer.length,
    });

    return Response.json({
      success: true,
      enhancedUrl: stored.url,
      originalUrl: imageUrl,
      preset,
      metadata: {
        width: metadata.width,
        height: metadata.height,
        format: metadata.format,
      },
    });
  } catch (error) {
    logger.error("[AI Image] Enhancement error", { error });
    return Response.json(
      { error: "Blad podczas ulepszania zdjecia. Sprobuj ponownie." },
      { status: 500 },
    );
  }
}
