import { GoogleGenAI } from "@google/genai";
import { logger } from "@/lib/logger";

// ────────────────────────────────────────────────────────────
// Google Imagen client factory
// ────────────────────────────────────────────────────────────

/**
 * Create a Google GenAI client for image generation.
 * Throws if GOOGLE_AI_API_KEY is not set.
 */
export function createGoogleAIClient(): GoogleGenAI {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) {
    throw new Error("Google AI API key not configured");
  }
  return new GoogleGenAI({ apiKey });
}

// ────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────

/** Imagen model for image generation */
export const IMAGEN_MODEL = "imagen-3.0-generate-002";

/**
 * Style presets tailored for the salon / beauty industry.
 * Each key maps to a short English style description appended to the
 * generation prompt to steer the visual aesthetic.
 */
export const IMAGE_STYLE_PRESETS: Record<string, string> = {
  modern: "modern, clean, minimalist design with neutral tones",
  vintage: "vintage, retro aesthetic with warm filters and soft colors",
  minimal: "minimalist, lots of white space, simple elegant composition",
  luxurious: "luxurious, premium feel with gold accents and dark tones",
  natural: "natural, organic, earthy tones with botanical elements",
  vibrant: "vibrant, colorful, energetic with bold contrasts",
};

/**
 * Platform-specific image sizes.
 * The `aspectRatio` field contains a value supported by the Imagen API:
 * "1:1", "3:4", "4:3", "9:16", "16:9".
 */
export const IMAGE_SIZES: Record<
  string,
  { width: number; height: number; label: string; aspectRatio: string }
> = {
  "instagram-square": {
    width: 1080,
    height: 1080,
    label: "Instagram Post (1:1)",
    aspectRatio: "1:1",
  },
  "instagram-story": {
    width: 1080,
    height: 1920,
    label: "Instagram Story (9:16)",
    aspectRatio: "9:16",
  },
  "facebook-post": {
    width: 1200,
    height: 630,
    label: "Facebook Post (16:9)",
    aspectRatio: "16:9",
  },
  "facebook-cover": {
    width: 1640,
    height: 856,
    label: "Facebook Cover (16:9)",
    aspectRatio: "16:9",
  },
  "tiktok": {
    width: 1080,
    height: 1920,
    label: "TikTok (9:16)",
    aspectRatio: "9:16",
  },
};

// ────────────────────────────────────────────────────────────
// Image generation
// ────────────────────────────────────────────────────────────

export interface ImageGenerationResult {
  /** Raw PNG image data */
  imageData: Buffer;
  /** MIME type of the generated image */
  mimeType: string;
  /** The final prompt sent to the model (may include style suffix) */
  prompt: string;
}

/**
 * Generate an image using Google Imagen.
 *
 * @param prompt - Text description of the desired image
 * @param options.style - Key from IMAGE_STYLE_PRESETS to append a style hint
 * @param options.aspectRatio - One of "1:1", "3:4", "4:3", "9:16", "16:9"
 */
export async function generateImage(
  prompt: string,
  options: {
    style?: string;
    aspectRatio?: string;
  } = {},
): Promise<ImageGenerationResult> {
  const client = createGoogleAIClient();

  // Build enhanced prompt with optional style description
  const styleDesc =
    options.style && IMAGE_STYLE_PRESETS[options.style]
      ? IMAGE_STYLE_PRESETS[options.style]
      : undefined;
  const fullPrompt = styleDesc ? `${prompt}. Style: ${styleDesc}` : prompt;

  try {
    const response = await client.models.generateImages({
      model: IMAGEN_MODEL,
      prompt: fullPrompt,
      config: {
        numberOfImages: 1,
        aspectRatio: options.aspectRatio ?? "1:1",
      },
    });

    const image = response.generatedImages?.[0];
    if (!image?.image?.imageBytes) {
      throw new Error("No image generated — the model returned an empty result");
    }

    return {
      imageData: Buffer.from(image.image.imageBytes, "base64"),
      mimeType: "image/png",
      prompt: fullPrompt,
    };
  } catch (error) {
    logger.error("[AI Image] Generation error", { error });
    throw error;
  }
}
