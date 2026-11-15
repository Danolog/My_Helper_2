import sharp, { type Sharp } from "sharp";
import { z } from "zod";
import { requireProAI, isProAIError } from "@/lib/ai/openrouter";
import { logger } from "@/lib/logger";
import { loadOwnUploadImage } from "@/lib/own-upload-image";
import { upload } from "@/lib/storage";

/**
 * Maximum allowed image size for enhancement (10 MB).
 * Larger files are rejected to protect server memory.
 */
const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;

const requestSchema = z.object({
  // Format sprawdza allowlista w loadOwnUploadImage (lokalnie adres jest
  // względny: /uploads/gallery/..., wiec nie z.url()).
  imageUrl: z.string().min(1, "Nieprawidlowy URL obrazu").max(500, "Nieprawidlowy URL obrazu"),
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
const PRESETS: Record<string, (img: Sharp) => Sharp> = {
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
    // SSRF: obraz wylacznie z naszego storage (galeria / enhanced tego
    // salonu) — nigdy fetch po dowolnym adresie z zadania.
    const loaded = await loadOwnUploadImage(imageUrl, salonId, {
      maxBytes: MAX_IMAGE_SIZE_BYTES,
    });
    if (!loaded.ok) {
      const error =
        loaded.reason === "not_allowed"
          ? "Adres obrazu musi pochodzic z galerii salonu"
          : loaded.reason === "too_large"
            ? "Obraz jest zbyt duzy. Maksymalny rozmiar to 10 MB."
            : loaded.reason === "not_image"
              ? "Plik nie jest obslugiwanym obrazem"
              : "Nie udalo sie pobrac obrazu";
      if (loaded.reason === "not_allowed") {
        logger.warn("[AI Image] Enhance: rejected image source", { salonId });
      }
      return Response.json({ error }, { status: 400 });
    }
    const imageBuffer = loaded.buffer;

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

    // Upload enhanced image to storage (or return data URI in local dev)
    const filename = `enhanced-${salonId}-${Date.now()}.jpg`;
    const hasVercelBlob = Boolean(process.env.BLOB_READ_WRITE_TOKEN);

    let enhancedUrl: string;
    if (hasVercelBlob) {
      const stored = await upload(enhancedBuffer, filename, "enhanced", {
        maxSize: MAX_IMAGE_SIZE_BYTES,
        allowedTypes: ["image/jpeg"],
      });
      enhancedUrl = stored.url;
    } else {
      enhancedUrl = `data:image/jpeg;base64,${enhancedBuffer.toString("base64")}`;
    }

    logger.info("[AI Image] Photo enhanced", {
      salonId,
      preset,
      originalSize: imageBuffer.length,
      enhancedSize: enhancedBuffer.length,
    });

    return Response.json({
      success: true,
      enhancedUrl,
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
