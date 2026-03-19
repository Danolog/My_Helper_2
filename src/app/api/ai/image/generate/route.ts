import { generateText } from "ai";
import { z } from "zod";
import {
  generateImage,
  IMAGE_SIZES,
} from "@/lib/ai/google-imagen";
import {
  createAIClient,
  getAIModel,
  requireProAI,
  isProAIError,
  getSalonContext,
} from "@/lib/ai/openrouter";
import { logger } from "@/lib/logger";
import { upload } from "@/lib/storage";

// ────────────────────────────────────────────────────────────
// Request validation
// ────────────────────────────────────────────────────────────

const requestSchema = z.object({
  prompt: z.string().min(1, "Opis obrazu jest wymagany").max(500),
  style: z
    .enum(["modern", "vintage", "minimal", "luxurious", "natural", "vibrant"])
    .default("modern"),
  size: z.string().default("instagram-square"),
  autoPrompt: z.boolean().default(false),
});

// ────────────────────────────────────────────────────────────
// POST /api/ai/image/generate
// ────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  // Auth + Pro plan check
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
        error: "Invalid request",
        details: parsed.error.flatten().fieldErrors,
      },
      { status: 400 },
    );
  }

  const { prompt, style, size, autoPrompt } = parsed.data;

  // Fetch salon context for prompt enrichment
  const { salonName, industryLabel } = await getSalonContext(salonId);

  // Determine the final prompt to send to Imagen
  let finalPrompt = prompt;

  // When autoPrompt is enabled, use the OpenRouter LLM to convert the Polish
  // description into an optimised English image-generation prompt.
  if (autoPrompt) {
    try {
      const openrouter = createAIClient();
      const enhanceResult = await generateText({
        model: openrouter(getAIModel()),
        system: `You are an expert at writing image generation prompts. Convert the user's Polish description into an optimized English image generation prompt for a ${industryLabel} called "${salonName}". The prompt should be detailed, visual, and suitable for AI image generation. Return ONLY the English prompt text, nothing else.`,
        prompt,
        maxOutputTokens: 200,
      });
      const enhanced = enhanceResult.text.trim();
      if (enhanced) {
        finalPrompt = enhanced;
      }
    } catch (error) {
      logger.warn("[AI Image] Auto-prompt enhancement failed, using original", {
        error,
      });
      // Fall through — use the original prompt
    }
  }

  // Resolve aspect ratio from the chosen size preset
  const sizePreset = IMAGE_SIZES[size];
  const aspectRatio = sizePreset?.aspectRatio ?? "1:1";

  try {
    const result = await generateImage(finalPrompt, { style, aspectRatio });

    // Persist the generated image — or return a data URI in local dev
    const filename = `ai-image-${salonId}-${Date.now()}.png`;
    const hasVercelBlob = Boolean(process.env.BLOB_READ_WRITE_TOKEN);

    let imageUrl: string;
    if (hasVercelBlob) {
      const stored = await upload(result.imageData, filename, "ai-images");
      imageUrl = stored.url;
    } else {
      imageUrl = `data:image/png;base64,${result.imageData.toString("base64")}`;
    }

    return Response.json({
      success: true,
      imageUrl,
      prompt: result.prompt,
      style,
      size,
    });
  } catch (error) {
    logger.error("[AI Image] Error generating image", { error });
    return Response.json(
      { error: "Blad podczas generowania obrazu. Sprobuj ponownie." },
      { status: 500 },
    );
  }
}
