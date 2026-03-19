import { generateText } from "ai";
import { z } from "zod";
import { generateImage } from "@/lib/ai/google-imagen";
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
  serviceName: z.string().min(1, "Nazwa uslugi jest wymagana").max(200),
  categoryName: z.string().max(100).optional(),
  style: z
    .enum(["modern", "vintage", "minimal", "luxurious", "natural", "vibrant"])
    .default("modern"),
});

// ────────────────────────────────────────────────────────────
// POST /api/ai/image/service-illustration
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

  const { serviceName, categoryName, style } = parsed.data;

  // Fetch salon context for industry-aware prompt generation
  const { industryLabel } = await getSalonContext(salonId);

  // Use AI to create an optimised English prompt from the service name.
  // The LLM translates the (often Polish) service name into a visually
  // descriptive English prompt suitable for image generation.
  let imagePrompt: string;
  try {
    const openrouter = createAIClient();
    const promptResult = await generateText({
      model: openrouter(getAIModel()),
      system: `You create short, visual image generation prompts for beauty/wellness service illustrations. The image should be:
- Professional and clean
- No text, no people's faces (just hands, tools, products, or abstract beauty elements)
- Suitable as a service card thumbnail
- Related to the specific service
Return ONLY the English prompt, max 50 words.`,
      prompt: `Service: "${serviceName}"${categoryName ? `, category: "${categoryName}"` : ""}, industry: ${industryLabel}`,
      maxOutputTokens: 100,
    });
    imagePrompt =
      promptResult.text.trim() ||
      `professional ${industryLabel} service illustration`;
  } catch (error) {
    logger.warn(
      "[AI Image] Prompt generation failed, using fallback prompt",
      { error },
    );
    imagePrompt =
      "professional beauty salon service illustration, clean, minimal";
  }

  // Generate the image using Google Imagen and persist it via storage
  try {
    const result = await generateImage(imagePrompt, {
      style,
      aspectRatio: "1:1",
    });

    const filename = `service-illustration-${salonId}-${Date.now()}.png`;
    const stored = await upload(
      result.imageData,
      filename,
      "service-illustrations",
    );

    return Response.json({
      success: true,
      imageUrl: stored.url,
      prompt: imagePrompt,
      style,
    });
  } catch (error) {
    logger.error("[AI Image] Service illustration error", { error });
    return Response.json(
      { error: "Blad podczas generowania ilustracji. Sprobuj ponownie." },
      { status: 500 },
    );
  }
}
